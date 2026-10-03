import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { readStoredZip, validateZip } from '../apps/server/lib/zip.mjs';

console.log('=====================================================');
console.log('   EMPIRICAL CHALLENGE SUITE R1-2: Extension & Scripts');
console.log('=====================================================\n');

let passed = 0;
let total = 0;

function assertTest(name, condition, details = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`[PASS] ${name}`);
  } else {
    console.error(`[FAIL] ${name} - ${details}`);
  }
}

// 1. Pack Extension Execution
console.log('--- 1. Testing npm run pack:extension ---');
const zipPath = path.resolve('dist/tracedeck-extension.zip');
try {
  execFileSync('node', ['scripts/pack-extension.mjs'], { stdio: 'pipe' });
  assertTest('pack-extension.mjs executes with code 0', true);
} catch (err) {
  assertTest('pack-extension.mjs executes with code 0', false, err.message);
}

const zipBuf = fs.readFileSync(zipPath);
const validation = validateZip(zipBuf);
assertTest('Packaged zip passes validateZip with zero errors', validation.valid && validation.errors.length === 0, validation.errors.join('; '));

// 2. Extension Zip Entry Names and Backslash Check
console.log('\n--- 2. Checking Zip Entry Names & Slashes ---');
const entries = readStoredZip(zipBuf);
const names = Array.from(entries.keys());
const hasBackslash = names.some(n => n.includes('\\'));
assertTest('Zero backslashes in ZIP entries (strictly forward slashes)', !hasBackslash, names.filter(n => n.includes('\\')).join(', '));
assertTest('ZIP contains 11 extension assets', entries.size === 11, `Found ${entries.size}`);

// 3. Manifest V3 Asset Completeness
console.log('\n--- 3. Checking Manifest V3 Completeness ---');
const manifestBuf = entries.get('manifest.json');
assertTest('manifest.json exists in zip', Boolean(manifestBuf));
const manifest = JSON.parse(manifestBuf.toString('utf8'));
assertTest('manifest_version is 3', manifest.manifest_version === 3);

const requiredAssets = [
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  manifest.options_page,
  ...(manifest.content_scripts || []).flatMap(c => c.js || []),
  ...(manifest.web_accessible_resources || []).flatMap(r => r.resources || []),
  'offscreen.html',
  'offscreen.js',
  'zip.js'
].filter(Boolean);

for (const asset of requiredAssets) {
  assertTest(`Referenced asset '${asset}' exists in zip`, entries.has(asset));
}

// 4. Native Windows Expand-Archive Extraction
console.log('\n--- 4. Testing Windows Native Expand-Archive ---');
const tmpExtract = fs.mkdtempSync(path.join(os.tmpdir(), 'tracedeck-challenge-unzip-'));
try {
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${tmpExtract}" -Force`
  ], { stdio: 'pipe' });

  const extractedFiles = fs.readdirSync(tmpExtract);
  assertTest('Expand-Archive extracted all 11 files', extractedFiles.length === 11);

  let sizesMatch = true;
  for (const f of extractedFiles) {
    const extractedSize = fs.statSync(path.join(tmpExtract, f)).size;
    const expectedSize = entries.get(f).length;
    if (extractedSize !== expectedSize) {
      sizesMatch = false;
      console.error(`Size mismatch for ${f}: got ${extractedSize}, expected ${expectedSize}`);
    }
  }
  assertTest('Extracted file sizes match ZIP stored byte lengths exactly', sizesMatch);
} catch (err) {
  assertTest('Expand-Archive extracted without errors', false, err.message);
} finally {
  fs.rmSync(tmpExtract, { recursive: true, force: true });
}

// 5. Repackaging & Nested Directory Normalization
console.log('\n--- 5. Testing Repackaging & Nested Path Normalization ---');
const extDir = path.resolve('apps/extension');
const testNestedDir = path.join(extDir, 'test_challenge_nested');
const testFile = path.join(testNestedDir, 'nested_asset.txt');

try {
  fs.mkdirSync(testNestedDir, { recursive: true });
  fs.writeFileSync(testFile, 'empirical_challenge_payload');

  execFileSync('node', ['scripts/pack-extension.mjs'], { stdio: 'pipe' });

  const repackedZipBuf = fs.readFileSync(zipPath);
  const repackedValidation = validateZip(repackedZipBuf);
  assertTest('Repackaged zip validates with validateZip', repackedValidation.valid);

  const repackedEntries = readStoredZip(repackedZipBuf);
  assertTest('Nested asset added with normalized forward slashes', repackedEntries.has('test_challenge_nested/nested_asset.txt'));
  assertTest('Nested asset payload matches', repackedEntries.get('test_challenge_nested/nested_asset.txt')?.toString('utf8') === 'empirical_challenge_payload');

  const anyRepackedBackslashes = Array.from(repackedEntries.keys()).some(k => k.includes('\\'));
  assertTest('Zero backslashes in repackaged zip with nested paths', !anyRepackedBackslashes);
} finally {
  fs.rmSync(testNestedDir, { recursive: true, force: true });
  execFileSync('node', ['scripts/pack-extension.mjs'], { stdio: 'pipe' });
  const restoredEntries = readStoredZip(fs.readFileSync(zipPath));
  assertTest('Pristine state restored after cleanup', restoredEntries.size === 11 && !restoredEntries.has('test_challenge_nested/nested_asset.txt'));
}

// 6. Synchronized Extension Directories (apps/extension vs chrome extension)
console.log('\n--- 6. Checking Extension Directory Synchronization ---');
const chromeExtDir = path.resolve('chrome extension');
const extFiles = fs.readdirSync(extDir).filter(f => fs.statSync(path.join(extDir, f)).isFile()).sort();
const chromeExtFiles = fs.readdirSync(chromeExtDir).filter(f => fs.statSync(path.join(chromeExtDir, f)).isFile()).sort();
assertTest('Directory file lists match between apps/extension and chrome extension', JSON.stringify(extFiles) === JSON.stringify(chromeExtFiles));

let contentMatch = true;
for (const f of extFiles) {
  const b1 = fs.readFileSync(path.join(extDir, f));
  const b2 = fs.readFileSync(path.join(chromeExtDir, f));
  if (!b1.equals(b2)) contentMatch = false;
}
assertTest('All 11 files are byte-for-byte identical between extension directories', contentMatch);

// 7. Smoke Test with Spaces and Special Characters in Temp Path
console.log('\n--- 7. Testing scripts/smoke.mjs with Spaces & Special Chars in Path ---');
const spaceTempBase = path.join(os.tmpdir(), 'tracedeck test space & exclamation ! dir');
fs.mkdirSync(spaceTempBase, { recursive: true });
try {
  const smokeOut = execFileSync('node', ['scripts/smoke.mjs'], {
    env: { ...process.env, TEMP: spaceTempBase, TMP: spaceTempBase },
    encoding: 'utf8'
  });
  assertTest('smoke.mjs succeeds when TEMP directory path contains spaces and !', smokeOut.includes('Smoke test passed'));
} catch (err) {
  assertTest('smoke.mjs succeeds when TEMP directory path contains spaces and !', false, err.message);
} finally {
  const leakedFolders = fs.readdirSync(spaceTempBase);
  assertTest('Smoke test cleanup check (documents temp dir leak finding)', leakedFolders.length === 0, `Leaked ${leakedFolders.length} temp directories in OS temp: ${leakedFolders.join(', ')}`);
  fs.rmSync(spaceTempBase, { recursive: true, force: true });
}

// 8. Server with Custom Port and DataDir with Spaces
console.log('\n--- 8. Testing apps/server/server.mjs with Custom Port and DataDir with Spaces ---');
const customDataDir = path.join(os.tmpdir(), 'tracedeck server custom space dir !');
fs.mkdirSync(customDataDir, { recursive: true });
const customPort = 49876;
const customBase = `http://127.0.0.1:${customPort}`;

await new Promise((resolve) => {
  const sChild = spawn('node', ['apps/server/server.mjs'], {
    env: {
      ...process.env,
      TRACEDECK_HOST: '127.0.0.1',
      TRACEDECK_PORT: String(customPort),
      TRACEDECK_PUBLIC_URL: customBase,
      TRACEDECK_DATA_DIR: customDataDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let sErr = '';
  sChild.stderr.on('data', d => sErr += d);

  async function checkServer() {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${customBase}/api/health`);
        if (res.ok) return true;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('Custom server failed to start: ' + sErr);
  }

  checkServer()
    .then(async () => {
      const health = await (await fetch(`${customBase}/api/health`)).json();
      assertTest('server.mjs starts and responds on custom port and custom dataDir with spaces', health.ok === true && health.name === 'TraceDeck');
      sChild.kill('SIGTERM');
      resolve();
    })
    .catch((err) => {
      assertTest('server.mjs starts and responds on custom port and custom dataDir with spaces', false, err.message);
      sChild.kill('SIGTERM');
      resolve();
    });
});
fs.rmSync(customDataDir, { recursive: true, force: true });

// 9. Audit package.json scripts on Windows
console.log('\n--- 9. Auditing package.json scripts on Windows ---');
// npm run dev check
try {
  execFileSync('cmd.exe', ['/c', 'npm run dev'], { stdio: 'pipe', timeout: 3000 });
  assertTest('npm run dev runs on Windows cmd.exe', true);
} catch (err) {
  const errOutput = (err.stderr || err.stdout || '').toString();
  assertTest('npm run dev runs on Windows cmd.exe (documents Windows cross-platform bug)', false, `Fails with: ${errOutput.trim() || err.message}`);
}

console.log('\n=====================================================');
console.log(`   CHALLENGE SUMMARY: ${passed}/${total} assertions passed`);
console.log('=====================================================\n');
