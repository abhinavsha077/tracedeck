#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip, validateZip } from '../apps/server/lib/zip.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const extDir = path.join(root, 'apps', 'extension');
const distDir = path.join(root, 'dist');
const outFile = path.join(distDir, 'tracedeck-extension.zip');

async function getFilesRecursively(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await getFilesRecursively(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function packExtension() {
  await fs.mkdir(distDir, { recursive: true });

  const filePaths = await getFilesRecursively(extDir);
  const zipEntries = [];

  for (const filePath of filePaths) {
    const relativeName = path.relative(extDir, filePath).replace(/\\/g, '/');
    const data = await fs.readFile(filePath);
    zipEntries.push({ name: relativeName, data });
  }

  // Sort entries for deterministic output
  zipEntries.sort((a, b) => a.name.localeCompare(b.name));

  const zip = makeZip(zipEntries);
  const validation = validateZip(zip);
  if (!validation.valid) {
    throw new Error('Extension packaging validation failed: ' + validation.errors.join('; '));
  }

  await fs.writeFile(outFile, zip);
  console.log(outFile);
}

packExtension().catch((err) => {
  console.error('Failed to pack extension:', err);
  process.exit(1);
});
