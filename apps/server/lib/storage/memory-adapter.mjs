import { StorageAdapter } from './adapter.mjs';

export class MemoryStorageAdapter extends StorageAdapter {
  constructor() {
    super();
    this.state = null;
    this.artifacts = new Map(); // key: `${captureId}/${filename}`, value: Buffer
  }

  async init() {
    // No-op for in-memory
  }

  async readState() {
    return this.state ? JSON.parse(JSON.stringify(this.state)) : null;
  }

  async writeState(state) {
    this.state = JSON.parse(JSON.stringify(state));
  }

  async saveArtifact(captureId, artifactId, filename, data) {
    const buffer = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data || '');
    const key = `${captureId}/${filename}`;
    this.artifacts.set(key, buffer);
    return { path: `memory://${key}`, size: buffer.length };
  }

  async readArtifact(captureId, artifactId, filename) {
    const key = `${captureId}/${filename}`;
    const buffer = this.artifacts.get(key);
    return buffer ? Buffer.from(buffer) : null;
  }

  getArtifactPath(captureId, artifactId, filename) {
    const key = `${captureId}/${filename}`;
    return `memory://${key}`;
  }

  async deleteArtifact(captureId, artifactId, filename) {
    const key = `${captureId}/${filename}`;
    return this.artifacts.delete(key);
  }

  async deleteCaptureArtifacts(captureId) {
    const prefix = `${captureId}/`;
    for (const key of Array.from(this.artifacts.keys())) {
      if (key.startsWith(prefix)) {
        this.artifacts.delete(key);
      }
    }
  }

  async getStorageSize() {
    let size = 0;
    if (this.state) {
      size += Buffer.byteLength(JSON.stringify(this.state), 'utf8');
    }
    for (const buf of this.artifacts.values()) {
      size += buf.length;
    }
    return size;
  }
}
