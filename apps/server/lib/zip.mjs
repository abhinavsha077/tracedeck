import zlib from 'node:zlib';

// Minimal ZIP writer using the STORE method. No runtime dependency is required.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, '/'));
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);
    const { time, day } = dosDateTime(file.date || new Date());
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralStart = offset;
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function readStoredZip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  // Locate EOCD in the final 65,557 bytes as allowed by the ZIP format.
  const start = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: end-of-central-directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    if (method !== 0) throw new Error(`Unsupported ZIP compression for ${name}; TraceDeck imports STORE-mode bundles`);
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local header');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    if (data.length !== uncompressedSize) throw new Error(`Invalid ZIP size for ${name}`);
    files.set(name, Buffer.from(data));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export function validateZip(buffer, options = {}) {
  const errors = [];
  const files = [];

  try {
    if (!buffer || (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array))) {
      errors.push('Invalid input: buffer must be a Buffer or Uint8Array');
    } else {
      const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      if (buf.length < 22) {
        errors.push('ZIP archive too small: length is less than 22 bytes');
      } else {
        // Locate EOCD signature (0x06054b50) searching backwards in the last 65,557 bytes
        const start = Math.max(0, buf.length - 65557);
        let eocd = -1;
        for (let i = buf.length - 22; i >= start; i--) {
          if (buf.readUInt32LE(i) === 0x06054b50) {
            const commentLen = buf.readUInt16LE(i + 20);
            if (i + 22 + commentLen === buf.length) {
              eocd = i;
              break;
            }
            if (eocd === -1) {
              eocd = i;
            }
          }
        }

        if (eocd < 0) {
          errors.push('End of Central Directory (EOCD) signature not found');
        } else {
          const diskNumber = buf.readUInt16LE(eocd + 4);
          const startDisk = buf.readUInt16LE(eocd + 6);
          const diskEntries = buf.readUInt16LE(eocd + 8);
          const totalEntries = buf.readUInt16LE(eocd + 10);
          const cdSize = buf.readUInt32LE(eocd + 12);
          const cdOffset = buf.readUInt32LE(eocd + 16);

    if (diskNumber !== 0 || startDisk !== 0) {
      errors.push('Multi-disk archives not supported');
    }
    if (diskEntries !== totalEntries) {
      errors.push(`Disk entries count (${diskEntries}) does not match total entries count (${totalEntries})`);
    }
    if (cdOffset + cdSize > eocd) {
      errors.push(`Central Directory extends past EOCD (offset ${cdOffset} + size ${cdSize} > eocd ${eocd})`);
    }
    if (cdOffset + cdSize > buf.length) {
      errors.push('Central Directory bounds exceed archive size');
    }

    let pos = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (pos + 46 > buf.length || pos + 46 > cdOffset + cdSize) {
        errors.push(`Central Directory entry ${i} header out of bounds`);
        break;
      }
      const cdSig = buf.readUInt32LE(pos);
      if (cdSig !== 0x02014b50) {
        errors.push(`Invalid Central Directory header signature at offset ${pos}: 0x${cdSig.toString(16)}`);
        break;
      }
      const flags = buf.readUInt16LE(pos + 8);
      const method = buf.readUInt16LE(pos + 10);
      const crc = buf.readUInt32LE(pos + 16);
      const compSize = buf.readUInt32LE(pos + 20);
      const uncompSize = buf.readUInt32LE(pos + 24);
      const nameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const localOffset = buf.readUInt32LE(pos + 42);

      if (pos + 46 + nameLen + extraLen + commentLen > buf.length) {
        errors.push(`Central Directory entry ${i} exceeds archive length`);
        break;
      }

      const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
      files.push(name);

      if (localOffset + 30 > buf.length) {
        errors.push(`Local header for ${name} at offset ${localOffset} exceeds archive size`);
      } else {
        const localSig = buf.readUInt32LE(localOffset);
        if (localSig !== 0x04034b50) {
          errors.push(`Invalid Local File Header signature for ${name} at offset ${localOffset}: 0x${localSig.toString(16)}`);
        } else {
          const localMethod = buf.readUInt16LE(localOffset + 8);
          const localCrc = buf.readUInt32LE(localOffset + 14);
          const localCompSize = buf.readUInt32LE(localOffset + 18);
          const localUncompSize = buf.readUInt32LE(localOffset + 22);
          const localNameLen = buf.readUInt16LE(localOffset + 26);
          const localExtraLen = buf.readUInt16LE(localOffset + 28);

          if (localOffset + 30 + localNameLen + localExtraLen > buf.length) {
            errors.push(`Local header fields for ${name} exceed archive size`);
          } else {
            const localName = buf.subarray(localOffset + 30, localOffset + 30 + localNameLen).toString('utf8');
            if (localName !== name) {
              errors.push(`Filename mismatch: Central Directory '${name}' vs Local Header '${localName}'`);
            }
            if (localMethod !== method) {
              errors.push(`Compression method mismatch for ${name}: CD ${method} vs Local ${localMethod}`);
            }

            const hasDataDescriptor = (flags & 0x08) !== 0;
            if (!hasDataDescriptor) {
              if (localCrc !== crc) {
                errors.push(`CRC mismatch between Central Directory and Local Header for ${name}`);
              }
              if (localCompSize !== compSize) {
                errors.push(`Compressed size mismatch between Central Directory and Local Header for ${name}`);
              }
              if (localUncompSize !== uncompSize) {
                errors.push(`Uncompressed size mismatch between Central Directory and Local Header for ${name}`);
              }
            }

            const dataStart = localOffset + 30 + localNameLen + localExtraLen;
            const dataEnd = dataStart + compSize;
            if (dataEnd > buf.length) {
              errors.push(`Payload for ${name} exceeds archive bounds (offset ${dataEnd} > ${buf.length})`);
            } else {
              const compressedData = buf.subarray(dataStart, dataEnd);
              if (method === 0) { // STORE
                if (compSize !== uncompSize) {
                  errors.push(`Stored file ${name} compressed size (${compSize}) != uncompressed size (${uncompSize})`);
                }
                const actualCrc = crc32(compressedData);
                if (actualCrc !== crc) {
                  errors.push(`CRC-32 checksum failure for ${name}: expected 0x${crc.toString(16).padStart(8, '0')}, calculated 0x${actualCrc.toString(16).padStart(8, '0')}`);
                }
              } else if (method === 8) { // DEFLATE
                try {
                  const uncompressed = zlib.inflateRawSync(compressedData);
                  if (uncompressed.length !== uncompSize) {
                    errors.push(`Uncompressed size mismatch for ${name}: expected ${uncompSize}, got ${uncompressed.length}`);
                  }
                  const actualCrc = crc32(uncompressed);
                  if (actualCrc !== crc) {
                    errors.push(`CRC-32 checksum failure for ${name}: expected 0x${crc.toString(16).padStart(8, '0')}, calculated 0x${actualCrc.toString(16).padStart(8, '0')}`);
                  }
                } catch (inflateErr) {
                  errors.push(`Decompression failed for ${name}: ${inflateErr.message}`);
                }
              } else {
                errors.push(`Unsupported compression method ${method} for ${name}`);
              }
            }
          }
        }
      }

      pos += 46 + nameLen + extraLen + commentLen;
    }

    if (pos !== cdOffset + cdSize) {
      errors.push(`Central Directory size mismatch: processed ${pos - cdOffset} bytes, expected ${cdSize} bytes`);
    }
        }
      }
    }
  } catch (err) {
    errors.push(`Fatal error parsing ZIP archive: ${err.message}`);
  }

  const valid = errors.length === 0;
  if (options && options.throwOnError && !valid) {
    throw new Error(`Invalid ZIP archive: ${errors.join('; ')}`);
  }
  return { valid, files, errors };
}

