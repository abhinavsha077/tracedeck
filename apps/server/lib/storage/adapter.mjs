/**
 * Abstract base class for TraceDeck storage adapters.
 * All custom storage adapters (FileSystem, Memory, DB) must implement these methods.
 */
export class StorageAdapter {
  /**
   * Initialize storage backend (create dirs, connect to DB, etc.)
   * @returns {Promise<void>}
   */
  async init() {
    throw new Error('StorageAdapter.init() must be implemented');
  }

  /**
   * Read stored state object.
   * @returns {Promise<object|null>}
   */
  async readState() {
    throw new Error('StorageAdapter.readState() must be implemented');
  }

  /**
   * Persist state object atomically.
   * @param {object} state
   * @returns {Promise<void>}
   */
  async writeState(state) {
    throw new Error('StorageAdapter.writeState() must be implemented');
  }

  /**
   * Save an artifact binary for a capture.
   * @param {string} captureId
   * @param {string} artifactId
   * @param {string} filename
   * @param {Buffer|Uint8Array} data
   * @returns {Promise<{ path: string, size: number }>}
   */
  async saveArtifact(captureId, artifactId, filename, data) {
    throw new Error('StorageAdapter.saveArtifact() must be implemented');
  }

  /**
   * Read an artifact binary.
   * @param {string} captureId
   * @param {string} artifactId
   * @param {string} filename
   * @returns {Promise<Buffer|null>}
   */
  async readArtifact(captureId, artifactId, filename) {
    throw new Error('StorageAdapter.readArtifact() must be implemented');
  }

  /**
   * Optional synchronous or asynchronous path resolver for filesystem-based serving.
   * @param {string} captureId
   * @param {string} artifactId
   * @param {string} filename
   * @returns {string|null}
   */
  getArtifactPath(captureId, artifactId, filename) {
    return null;
  }

  /**
   * Delete a single artifact.
   * @param {string} captureId
   * @param {string} artifactId
   * @param {string} filename
   * @returns {Promise<boolean>}
   */
  async deleteArtifact(captureId, artifactId, filename) {
    throw new Error('StorageAdapter.deleteArtifact() must be implemented');
  }

  /**
   * Delete all artifacts associated with a capture.
   * @param {string} captureId
   * @returns {Promise<void>}
   */
  async deleteCaptureArtifacts(captureId) {
    throw new Error('StorageAdapter.deleteCaptureArtifacts() must be implemented');
  }

  /**
   * Calculate total storage size in bytes (state + artifacts).
   * @returns {Promise<number>}
   */
  async getStorageSize() {
    throw new Error('StorageAdapter.getStorageSize() must be implemented');
  }
}
