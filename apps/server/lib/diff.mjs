// Zero-dependency PNG decoder, encoder, and pixel-by-pixel visual diff engine
// Ported from Arc - UI Audit Studio (diff.py) to pure Node.js
import zlib from 'node:zlib';

export function readPng(buffer) {
  if (buffer.length < 8 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('Invalid PNG signature');
  }

  let pos = 8;
  let width = null;
  let height = null;
  let bitDepth = null;
  let colorType = null;
  const idatChunks = [];

  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    pos += 4;
    const chunkType = buffer.toString('ascii', pos, pos + 4);
    pos += 4;
    const chunkData = buffer.subarray(pos, pos + length);
    pos += length + 4; // Skip CRC

    if (chunkType === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (chunkType === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (chunkType === 'IEND') {
      break;
    }
  }

  if (!width || !height) {
    throw new Error('Failed to parse PNG dimensions');
  }

  const decompressed = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const rowBytes = width * bpp;
  const rawRgba = Buffer.alloc(width * height * 4);

  let offset = 0;
  let prevRow = Buffer.alloc(rowBytes);

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[offset++];
    const current = Buffer.from(decompressed.subarray(offset, offset + rowBytes));
    offset += rowBytes;

    if (filterType === 1) { // Sub
      for (let i = bpp; i < rowBytes; i++) {
        current[i] = (current[i] + current[i - bpp]) & 0xff;
      }
    } else if (filterType === 2) { // Up
      for (let i = 0; i < rowBytes; i++) {
        current[i] = (current[i] + prevRow[i]) & 0xff;
      }
    } else if (filterType === 3) { // Average
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= bpp ? current[i - bpp] : 0;
        const up = prevRow[i];
        current[i] = (current[i] + ((left + up) >> 1)) & 0xff;
      }
    } else if (filterType === 4) { // Paeth
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? current[i - bpp] : 0;
        const b = prevRow[i];
        const c = i >= bpp ? prevRow[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        current[i] = (current[i] + pr) & 0xff;
      }
    }
    prevRow = current;

    const rowOutOffset = y * width * 4;
    if (bpp === 4) {
      current.copy(rawRgba, rowOutOffset);
    } else if (bpp === 3) {
      for (let x = 0; x < width; x++) {
        const inIdx = x * 3;
        const outIdx = rowOutOffset + x * 4;
        rawRgba[outIdx] = current[inIdx];
        rawRgba[outIdx + 1] = current[inIdx + 1];
        rawRgba[outIdx + 2] = current[inIdx + 2];
        rawRgba[outIdx + 3] = 255;
      }
    } else {
      for (let x = 0; x < width; x++) {
        const v = current[x];
        const outIdx = rowOutOffset + x * 4;
        rawRgba[outIdx] = v;
        rawRgba[outIdx + 1] = v;
        rawRgba[outIdx + 2] = v;
        rawRgba[outIdx + 3] = 255;
      }
    }
  }

  return { width, height, rgba: rawRgba };
}

function writeChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuf, data]);
  const crc = zlib.crc32(crcData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function writePng(width, height, rgbaBuffer) {
  const rowLen = width * 4;
  const raw = Buffer.alloc(height * (rowLen + 1));
  let inOffset = 0;
  let outOffset = 0;

  for (let y = 0; y < height; y++) {
    raw[outOffset++] = 0; // Filter type 0: None
    rgbaBuffer.copy(raw, outOffset, inOffset, inOffset + rowLen);
    inOffset += rowLen;
    outOffset += rowLen;
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace

  const ihdr = writeChunk('IHDR', ihdrData);
  const idat = writeChunk('IDAT', compressed);
  const iend = writeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

export function diffPngBuffers(buf1, buf2, options = {}) {
  const tolerance = options.tolerance ?? 16;
  const img1 = readPng(buf1);
  const img2 = readPng(buf2);

  const maxW = Math.max(img1.width, img2.width);
  const maxH = Math.max(img1.height, img2.height);
  const totalPixels = maxW * maxH;

  const diffRgba = Buffer.alloc(totalPixels * 4);
  let mismatchCount = 0;
  let minX = maxW;
  let minY = maxH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < maxH; y++) {
    for (let x = 0; x < maxW; x++) {
      const idx = (y * maxW + x) * 4;

      let r1 = 0, g1 = 0, b1 = 0, a1 = 0;
      if (x < img1.width && y < img1.height) {
        const idx1 = (y * img1.width + x) * 4;
        r1 = img1.rgba[idx1];
        g1 = img1.rgba[idx1 + 1];
        b1 = img1.rgba[idx1 + 2];
        a1 = img1.rgba[idx1 + 3];
      }

      let r2 = 0, g2 = 0, b2 = 0, a2 = 0;
      if (x < img2.width && y < img2.height) {
        const idx2 = (y * img2.width + x) * 4;
        r2 = img2.rgba[idx2];
        g2 = img2.rgba[idx2 + 1];
        b2 = img2.rgba[idx2 + 2];
        a2 = img2.rgba[idx2 + 3];
      }

      const d = Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2), Math.abs(a1 - a2));
      if (d > tolerance) {
        mismatchCount++;
        // Magenta highlight: #ff0055 with 100% opacity
        diffRgba[idx] = 255;
        diffRgba[idx + 1] = 0;
        diffRgba[idx + 2] = 85;
        diffRgba[idx + 3] = 255;

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      } else {
        // Dim background for context
        const gray = Math.round(0.299 * r1 + 0.587 * g1 + 0.114 * b1);
        diffRgba[idx] = gray;
        diffRgba[idx + 1] = gray;
        diffRgba[idx + 2] = gray;
        diffRgba[idx + 3] = 60;
      }
    }
  }

  const mismatchPct = totalPixels > 0 ? Number(((mismatchCount / totalPixels) * 100).toFixed(4)) : 0;
  const diffPng = writePng(maxW, maxH, diffRgba);

  return {
    match: mismatchCount === 0,
    mismatchCount,
    totalPixels,
    mismatchPct,
    dimensions: { width: maxW, height: maxH },
    boundingBox: mismatchCount > 0 ? { minX, minY, maxX, maxY } : null,
    diffPng
  };
}
