import fs from 'node:fs/promises';
import path from 'node:path';
import { StorageAdapter } from './adapter.mjs';
import { atomicWriteJson, ensureDir } from '../utils.mjs';

export class FileSystemStorageAdapter extends StorageAdapter {
  constructor(dataDir) {
    super();
    this.dataDir = path.resolve(dataDir);
    this.stateFile = path.join(this.dataDir, 'state.json');
    this.artifactsDir = path.join(this.dataDir, 'artifacts');
  }

  async init() {
    await ensureDir(this.dataDir);
    await ensureDir(this.artifactsDir);
  }

  async readState() {
    try {
      const content = await fs.readFile(this.stateFile, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeState(state) {
    await atomicWriteJson(this.stateFile, state);
  }

  async saveArtifact(captureId, artifactId, filename, data) {
    const captureDir = path.join(this.artifactsDir, captureId);
    await ensureDir(captureDir);
    const filePath = path.join(captureDir, filename);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await fs.writeFile(filePath, buffer);
    return { path: filePath, size: buffer.length };
  }

  async readArtifact(captureId, artifactId, filename) {
    try {
      const filePath = path.join(this.artifactsDir, captureId, filename);
      return await fs.readFile(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  getArtifactPath(captureId, artifactId, filename) {
    return path.join(this.artifactsDir, captureId, filename);
  }

  async deleteArtifact(captureId, artifactId, filename) {
    try {
      const filePath = path.join(this.artifactsDir, captureId, filename);
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  async deleteCaptureArtifacts(captureId) {
    const captureDir = path.join(this.artifactsDir, captureId);
    try {
      await fs.rm(captureDir, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async getStorageSize() {
    let total = 0;
    try {
      const stat = await fs.stat(this.stateFile);
      total += stat.size;
    } catch {}

    async function walk(dir) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            const s = await fs.stat(fullPath);
            total += s.size;
          }
        }
      } catch {}
    }

    await walk(this.artifactsDir);
    return total;
  }
}
