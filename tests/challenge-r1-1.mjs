import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { crc32, makeZip, readStoredZip, validateZip } from '../apps/server/lib/zip.mjs';

function dosDateTime(date = new Date(2026, 0, 1, 12, 0, 0)) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// Custom ZIP builder that allows creating arbitrary DEFLATE / STORE / corrupted archives
function buildCustomZip(entries, options = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const entry of entries) {
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const method = entry.method ?? 0; // 0=STORE, 8=DEFLATE
    let compressedData;
    if (entry.compressedData) {
      compressedData = entry.compressedData;
    } else if (method === 8) {
      compressedData = zlib.deflateRawSync(rawData);
    } else {
      compressedData = rawData;
    }

    const calculatedCrc = crc32(rawData);
    const crc = entry.crc ?? calculatedCrc;
    const localCrc = entry.localCrc ?? crc;
    const compSize = entry.compSize ?? compressedData.length;
    const localCompSize = entry.localCompSize ?? compSize;
    const uncompSize = entry.uncompSize ?? rawData.length;
    const localUncompSize = entry.localUncompSize ?? uncompSize;
    const flags = entry.flags ?? 0;
    const localFlags = entry.localFlags ?? flags;
    const localMethod = entry.localMethod ?? method;

    const name = Buffer.from(entry.name || 'test.txt');
    const localName = Buffer.from(entry.localName ?? entry.name ?? 'test.txt');
    const extra = entry.extra || Buffer.alloc(0);
    const localExtra = entry.localExtra || Buffer.alloc(0);
    const comment = entry.comment || Buffer.alloc(0);

    const localOffset = entry.customLocalOffset ?? offset;

    const local = Buffer.alloc(30 + localName.length + localExtra.length);
    local.writeUInt32LE(entry.localSig ?? 0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(localFlags, 6);
    local.writeUInt16LE(localMethod, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(localCrc, 14);
    local.writeUInt32LE(localCompSize, 18);
    local.writeUInt32LE(localUncompSize, 22);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    localName.copy(local, 30);
    localExtra.copy(local, 30 + localName.length);

    locals.push(local, compressedData);

    const central = Buffer.alloc(46 + name.length + extra.length + comment.length);
    central.writeUInt32LE(entry.cdSig ?? 0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compSize, 20);
    central.writeUInt32LE(uncompSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(comment.length, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    extra.copy(central, 46 + name.length);
    comment.copy(central, 46 + name.length + extra.length);

    centrals.push(central);
    offset += local.length + compressedData.length;
  }

  const centralStart = options.customCentralStart ?? offset;
  const rawCentralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const centralSize = options.customCentralSize ?? rawCentralSize;
  const archiveComment = options.archiveComment || Buffer.alloc(0);

  const end = Buffer.alloc(22 + archiveComment.length);
  end.writeUInt32LE(options.eocdSig ?? 0x06054b50, 0);
  end.writeUInt16LE(options.diskNumber ?? 0, 4);
  end.writeUInt16LE(options.startDisk ?? 0, 6);
  end.writeUInt16LE(options.diskEntries ?? entries.length, 8);
  end.writeUInt16LE(options.totalEntries ?? entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(options.commentLen ?? archiveComment.length, 20);
  archiveComment.copy(end, 22);

  return Buffer.concat([...locals, ...centrals, end]);
}

const stats = { passed: 0, failed: 0, tests: [] };

function runTest(name, fn) {
  try {
    fn();
    stats.passed++;
    stats.tests.push({ name, status: 'PASS' });
  } catch (err) {
    stats.failed++;
    stats.tests.push({ name, status: 'FAIL', error: err.message, stack: err.stack });
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

console.log('--- STARTING ADVERSARIAL CHALLENGE SUITE (R1-1) ---');

// ==========================================
// GROUP 1: Valid Archives
// ==========================================

runTest('1.1 Empty ZIP (0 files, 22-byte EOCD)', () => {
  const emptyZip = buildCustomZip([]);
  assert.equal(emptyZip.length, 22);
  const res = validateZip(emptyZip);
  assert.equal(res.valid, true, `Expected valid, got errors: ${res.errors.join('; ')}`);
  assert.equal(res.files.length, 0);
  assert.equal(res.errors.length, 0);
});

runTest('1.2 Valid single file STORE mode', () => {
  const zip = makeZip([{ name: 'test.txt', data: 'Hello World!' }]);
  const res = validateZip(zip);
  assert.equal(res.valid, true);
  assert.deepEqual(res.files, ['test.txt']);
  assert.equal(res.errors.length, 0);
});

runTest('1.3 Valid multi-file STORE mode with varying sizes & empty file', () => {
  const zip = makeZip([
    { name: 'empty.txt', data: '' },
    { name: 'small.txt', data: 'a' },
    { name: 'medium.json', data: JSON.stringify({ key: 'value', numbers: [1, 2, 3] }) },
    { name: 'large.bin', data: Buffer.alloc(100000, 0x42) }
  ]);
  const res = validateZip(zip);
  assert.equal(res.valid, true);
  assert.deepEqual(res.files, ['empty.txt', 'small.txt', 'medium.json', 'large.bin']);
  assert.equal(res.errors.length, 0);
});

runTest('1.4 Valid DEFLATE mode archive', () => {
  const rawText = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
  const zip = buildCustomZip([
    { name: 'compressed.txt', data: rawText, method: 8 }
  ]);
  const res = validateZip(zip);
  assert.equal(res.valid, true, `DEFLATE validation failed: ${res.errors.join('; ')}`);
  assert.deepEqual(res.files, ['compressed.txt']);
  assert.equal(res.errors.length, 0);
});

runTest('1.5 Mixed STORE and DEFLATE archive', () => {
  const zip = buildCustomZip([
    { name: 'store.txt', data: 'uncompressed data', method: 0 },
    { name: 'deflate.txt', data: 'highly compressible text '.repeat(100), method: 8 },
    { name: 'empty_deflate.txt', data: '', method: 8 }
  ]);
  const res = validateZip(zip);
  assert.equal(res.valid, true, `Mixed archive validation failed: ${res.errors.join('; ')}`);
  assert.deepEqual(res.files, ['store.txt', 'deflate.txt', 'empty_deflate.txt']);
  assert.equal(res.errors.length, 0);
});

runTest('1.6 Special characters in filenames (Unicode, emoji, spaces, deep path, traversal)', () => {
  const filenames = [
    'plain.txt',
    'folder/subfolder/file.json',
    'файл с пробелами.txt',
    '日本語のファイル.dat',
    '🔥🚀✨.trace',
    'path/with symbols & (brackets) [123] #4!.log',
    '../../etc/passwd'
  ];
  const entries = filenames.map(name => ({ name, data: `data for ${name}` }));
  const zip = makeZip(entries);
  const res = validateZip(zip);
  assert.equal(res.valid, true);
  assert.deepEqual(res.files, filenames);
  assert.equal(res.errors.length, 0);
});

runTest('1.7 Archive with valid archive comment', () => {
  const comment = Buffer.from('TraceDeck Archive Comment - 2026');
  const zip = buildCustomZip([
    { name: 'data.txt', data: 'hello' }
  ], { archiveComment: comment });
  const res = validateZip(zip);
  assert.equal(res.valid, true);
  assert.deepEqual(res.files, ['data.txt']);
});

runTest('1.8 Archive with file comments and extra fields', () => {
  const zip = buildCustomZip([
    {
      name: 'extra.txt',
      data: 'data',
      extra: Buffer.from([0x01, 0x00, 0x04, 0x00, 0xaa, 0xbb, 0xcc, 0xdd]),
      localExtra: Buffer.from([0x01, 0x00, 0x04, 0x00, 0xaa, 0xbb, 0xcc, 0xdd]),
      comment: Buffer.from('file-specific comment')
    }
  ]);
  const res = validateZip(zip);
  assert.equal(res.valid, true);
  assert.deepEqual(res.files, ['extra.txt']);
});

runTest('1.9 Data Descriptor flag (bit 3 / 0x08)', () => {
  const payload = Buffer.from('streamed data');
  const zip = buildCustomZip([
    {
      name: 'streamed.txt',
      data: payload,
      method: 0,
      flags: 0x08,
      localFlags: 0x08,
      localCrc: 0,
      localCompSize: 0,
      localUncompSize: 0
    }
  ]);
  const res = validateZip(zip);
  assert.equal(res.valid, true, `Data descriptor flag archive failed: ${res.errors.join('; ')}`);
});

// ==========================================
// GROUP 2: Corrupted CRC-32 & Content Tampering
// ==========================================

runTest('2.1 Corrupted payload byte in STORE mode', () => {
  const zip = makeZip([{ name: 'file.txt', data: 'original' }]);
  const tampered = Buffer.from(zip);
  const idx = tampered.indexOf(Buffer.from('original'));
  assert(idx > 0);
  tampered[idx] ^= 0x01;
  const res = validateZip(tampered);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('CRC-32 checksum failure')));
});

runTest('2.2 Corrupted payload byte in DEFLATE mode', () => {
  const zip = buildCustomZip([{ name: 'file.txt', data: 'deflated test data payload repeated '.repeat(10), method: 8 }]);
  const tampered = Buffer.from(zip);
  tampered[45] ^= 0xff;
  const res = validateZip(tampered);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Decompression failed') || e.includes('CRC-32 checksum failure')));
});

runTest('2.3 Corrupted CRC in Central Directory', () => {
  const zip = buildCustomZip([{ name: 'file.txt', data: 'hello', crc: 0x12345678, localCrc: 0x12345678 }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('CRC-32 checksum failure')));
});

runTest('2.4 Corrupted CRC in Local Header (when no data descriptor)', () => {
  const zip = buildCustomZip([{ name: 'file.txt', data: 'hello', localCrc: 0xdeadbeef }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('CRC mismatch between Central Directory and Local Header')));
});

runTest('2.5 STORE mode with compSize != uncompSize', () => {
  const zip = buildCustomZip([{ name: 'file.txt', data: 'hello', compSize: 10, uncompSize: 5 }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Stored file file.txt compressed size (10) != uncompressed size (5)')));
});

runTest('2.6 DEFLATE mode with uncompressed size mismatch', () => {
  const raw = 'repeat repeat repeat '.repeat(10);
  const zip = buildCustomZip([{ name: 'file.txt', data: raw, method: 8, uncompSize: 9999, localUncompSize: 9999 }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Uncompressed size mismatch')));
});

// ==========================================
// GROUP 3: Header Mismatches & Offset Tampering
// ==========================================

runTest('3.1 Filename mismatch between Local Header and Central Directory', () => {
  const zip = buildCustomZip([{ name: 'cd_name.txt', localName: 'local_name.txt', data: 'data' }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Filename mismatch')));
});

runTest('3.2 Compression method mismatch between Local Header and CD', () => {
  const zip = buildCustomZip([{ name: 'file.txt', data: 'data', method: 0, localMethod: 8 }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Compression method mismatch')));
});

runTest('3.3 Local Header offset exceeds archive size', () => {
  const zip = buildCustomZip([{ name: 'file.txt', data: 'data', customLocalOffset: 999999 }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('exceeds archive size')));
});

runTest('3.4 Invalid Local File Header signature (0xdeadbeef)', () => {
  const zip = buildCustomZip([{ name: 'file.txt', data: 'data', localSig: 0xdeadbeef }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Invalid Local File Header signature')));
});

runTest('3.5 Invalid Central Directory signature (0xdeadbeef)', () => {
  const zip = buildCustomZip([{ name: 'file.txt', data: 'data', cdSig: 0xdeadbeef }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Invalid Central Directory header signature')));
});

runTest('3.6 Unsupported compression method (e.g. 9 = Deflate64, 12 = BZIP2)', () => {
  const zip = buildCustomZip([{ name: 'file.txt', data: 'data', method: 12, localMethod: 12, compressedData: Buffer.from('dummy') }]);
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Unsupported compression method 12')));
});

runTest('3.7 Local header nameLen exceeds archive size', () => {
  const zip = makeZip([{ name: 'f.txt', data: 'abc' }]);
  const tampered = Buffer.from(zip);
  tampered.writeUInt16LE(5000, 26);
  const res = validateZip(tampered);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Local header fields for f.txt exceed archive size')));
});

runTest('3.8 Central directory nameLen exceeds entry bounds', () => {
  const zip = makeZip([{ name: 'f.txt', data: 'abc' }]);
  const cdOffset = zip.readUInt32LE(zip.length - 6);
  const tampered = Buffer.from(zip);
  tampered.writeUInt16LE(5000, cdOffset + 28);
  const res = validateZip(tampered);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('exceeds archive length') || e.includes('size mismatch')));
});

runTest('3.9 Payload bounds exceed archive size', () => {
  const zip = makeZip([{ name: 'f.txt', data: 'abc' }]);
  const cdOffset = zip.readUInt32LE(zip.length - 6);
  const tampered = Buffer.from(zip);
  tampered.writeUInt32LE(100000, cdOffset + 20);
  tampered.writeUInt32LE(100000, 18);
  const res = validateZip(tampered);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Payload for f.txt exceeds archive bounds')));
});

// ==========================================
// GROUP 4: Truncation, Negative & EOCD Edge Cases
// ==========================================

runTest('4.1 Non-buffer inputs (null, undefined, number, string, object)', () => {
  for (const input of [null, undefined, 42, 'string', {}, [], true, () => {}]) {
    const res = validateZip(input);
    assert.equal(res.valid, false);
    assert.equal(res.errors[0], 'Invalid input: buffer must be a Buffer or Uint8Array');
  }
});

runTest('4.2 Buffer length < 22 bytes', () => {
  for (const len of [0, 1, 5, 10, 21]) {
    const res = validateZip(Buffer.alloc(len));
    assert.equal(res.valid, false);
    assert(res.errors[0].includes('ZIP archive too small'));
  }
});

runTest('4.3 Buffer of 22 zero bytes (no EOCD signature)', () => {
  const res = validateZip(Buffer.alloc(22));
  assert.equal(res.valid, false);
  assert(res.errors[0].includes('End of Central Directory (EOCD) signature not found'));
});

runTest('4.4 Multi-disk archive indicators', () => {
  const zip = buildCustomZip([{ name: 'a.txt', data: 'a' }], { diskNumber: 1, startDisk: 1 });
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Multi-disk archives not supported')));
});

runTest('4.5 Disk entries count != total entries count', () => {
  const zip = buildCustomZip([{ name: 'a.txt', data: 'a' }], { diskEntries: 1, totalEntries: 2 });
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('does not match total entries count')));
});

runTest('4.6 Central Directory extends past EOCD', () => {
  const zip = buildCustomZip([{ name: 'a.txt', data: 'a' }], { customCentralStart: 100, customCentralSize: 500 });
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.some(e => e.includes('Central Directory extends past EOCD')));
});

runTest('4.7 Truncation across all slice boundaries (1 to N-1)', () => {
  const zip = makeZip([{ name: 'f1.txt', data: 'one' }, { name: 'f2.txt', data: 'two' }]);
  for (let cut = 0; cut < zip.length; cut++) {
    const truncated = zip.subarray(0, cut);
    const res = validateZip(truncated);
    assert.equal(res.valid, false);
    assert(res.errors.length > 0);
  }
});

runTest('4.8 Simulated negative uint32 (0xFFFFFFFF in size/offset)', () => {
  const zip = buildCustomZip([{ name: 'a.txt', data: 'a' }], { customCentralStart: 0xffffffff, customCentralSize: 0xffffffff });
  const res = validateZip(zip);
  assert.equal(res.valid, false);
  assert(res.errors.length > 0);
});

// ==========================================
// GROUP 5: Adversarial Payloads & Quirk Cases
// ==========================================

runTest('5.1 Fake EOCD signature embedded in file payload', () => {
  const fakeEocd = Buffer.alloc(30);
  fakeEocd.writeUInt32LE(0x06054b50, 0);
  fakeEocd.writeUInt16LE(0, 4);
  fakeEocd.writeUInt16LE(0, 6);
  fakeEocd.writeUInt16LE(99, 8);
  fakeEocd.writeUInt16LE(99, 10);
  fakeEocd.writeUInt32LE(1234, 12);
  fakeEocd.writeUInt32LE(0, 16);
  fakeEocd.writeUInt16LE(0, 20);

  const zip = makeZip([
    { name: 'fake_eocd.bin', data: fakeEocd },
    { name: 'normal.txt', data: 'normal content' }
  ]);

  const res = validateZip(zip);
  assert.equal(res.valid, true, `Fake EOCD in payload confused validator: ${res.errors.join('; ')}`);
  assert.deepEqual(res.files, ['fake_eocd.bin', 'normal.txt']);
});

runTest('5.2 Embedded ZIP archive within ZIP', () => {
  const innerZip = makeZip([{ name: 'inner.txt', data: 'inner content' }]);
  const outerZip = makeZip([{ name: 'embedded.zip', data: innerZip }]);
  const res = validateZip(outerZip);
  assert.equal(res.valid, true, `Embedded ZIP failed: ${res.errors.join('; ')}`);
  assert.deepEqual(res.files, ['embedded.zip']);
});

runTest('5.3 throwOnError option throws Error on invalid, does not throw on valid', () => {
  const validZip = makeZip([{ name: 'v.txt', data: 'ok' }]);
  const res = validateZip(validZip, { throwOnError: true });
  assert.equal(res.valid, true);

  const invalidZip = Buffer.from(validZip);
  invalidZip[35] ^= 0xff;
  assert.throws(() => {
    validateZip(invalidZip, { throwOnError: true });
  }, /Invalid ZIP archive:/);
});

runTest('5.4 validateZip never throws unhandled errors on arbitrary garbage', () => {
  const garbage = [
    Buffer.alloc(65536, 0),
    Buffer.alloc(65536, 0xff),
    Buffer.from('PK\x05\x06'),
    Buffer.from('PK\x03\x04'),
    Buffer.from('PK\x01\x02'),
    Buffer.from('PK\x05\x06'.repeat(1000))
  ];
  for (const g of garbage) {
    const res = validateZip(g);
    assert.equal(res.valid, false);
    assert(Array.isArray(res.errors));
    assert(Array.isArray(res.files));
  }
});

// ==========================================
// GROUP 6: Fuzz Testing (20,000 iterations)
// ==========================================

console.log('--- STARTING FUZZING ENGINE (20,000 ITERATIONS) ---');

function runFuzzer(iterations = 20000) {
  const baseStoreZip = makeZip([
    { name: 'manifest.json', data: '{"version": 1, "app": "TraceDeck"}' },
    { name: 'events/1.log', data: '2026-09-22 action: click #btn' },
    { name: 'binary.dat', data: Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]) }
  ]);

  const baseDeflateZip = buildCustomZip([
    { name: 'compressed1.txt', data: 'Log entry line with compressible content '.repeat(20), method: 8 },
    { name: 'compressed2.json', data: JSON.stringify({ items: new Array(50).fill('event') }), method: 8 }
  ]);

  let unhandledCrashes = 0;

  let s = 123456789;
  function rand() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  }
  function randInt(min, max) {
    return Math.floor(rand() * (max - min)) + min;
  }

  for (let i = 0; i < iterations; i++) {
    const fuzzerMode = i % 5;
    let testBuf;

    if (fuzzerMode === 0) {
      testBuf = Buffer.from(baseStoreZip);
      const numFlips = randInt(1, 10);
      for (let k = 0; k < numFlips; k++) {
        const pos = randInt(0, testBuf.length);
        testBuf[pos] ^= (1 << randInt(0, 8));
      }
    } else if (fuzzerMode === 1) {
      testBuf = Buffer.from(baseDeflateZip);
      const numFlips = randInt(1, 10);
      for (let k = 0; k < numFlips; k++) {
        const pos = randInt(0, testBuf.length);
        testBuf[pos] ^= (1 << randInt(0, 8));
      }
    } else if (fuzzerMode === 2) {
      const base = (rand() > 0.5) ? baseStoreZip : baseDeflateZip;
      const start = randInt(0, base.length - 1);
      const end = randInt(start + 1, base.length + 1);
      testBuf = base.subarray(start, end);
    } else if (fuzzerMode === 3) {
      const base = (rand() > 0.5) ? baseStoreZip : baseDeflateZip;
      const pos = randInt(0, base.length);
      const len = randInt(1, 20);
      if (rand() > 0.5) {
        testBuf = Buffer.concat([base.subarray(0, pos), base.subarray(Math.min(base.length, pos + len))]);
      } else {
        const insertBytes = Buffer.alloc(len);
        for (let b = 0; b < len; b++) insertBytes[b] = randInt(0, 256);
        testBuf = Buffer.concat([base.subarray(0, pos), insertBytes, base.subarray(pos)]);
      }
    } else {
      const len = randInt(0, 4096);
      testBuf = Buffer.alloc(len);
      for (let b = 0; b < len; b++) testBuf[b] = randInt(0, 256);
    }

    try {
      const res = validateZip(testBuf);
      if (typeof res.valid !== 'boolean' || !Array.isArray(res.files) || !Array.isArray(res.errors)) {
        unhandledCrashes++;
        console.error(`Iteration ${i}: Malformed response shape`, res);
      }
    } catch (err) {
      unhandledCrashes++;
      console.error(`Iteration ${i}: Unhandled exception thrown!`, err);
    }
  }

  assert.equal(unhandledCrashes, 0, `Fuzzing produced ${unhandledCrashes} unhandled crashes!`);
  console.log(`Fuzzing completed: ${iterations} iterations executed. Unhandled crashes: ${unhandledCrashes}`);
}

runTest('6.1 Fuzz testing across 20,000 mutations and garbage buffers', () => {
  runFuzzer(20000);
});

console.log('--- CHALLENGE SUITE COMPLETE ---');
console.log(`Summary: Passed: ${stats.passed}, Failed: ${stats.failed}`);

if (stats.failed > 0) {
  process.exit(1);
} else {
  console.log('ALL EMPIRICAL CHALLENGES PASSED PERFECTLY!');
}
