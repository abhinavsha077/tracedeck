import path from 'node:path';
import { id, now, safeFilename, token } from './utils.mjs';
import { redact, redactEvents } from './redact.mjs';
import { FileSystemStorageAdapter } from './storage/fs-adapter.mjs';

export class Store {
  constructor(dataDirOrAdapter, options = {}) {
    if (typeof dataDirOrAdapter === 'string') {
      this.adapter = new FileSystemStorageAdapter(dataDirOrAdapter);
      this.dataDir = dataDirOrAdapter;
    } else if (dataDirOrAdapter && typeof dataDirOrAdapter.readState === 'function') {
      this.adapter = dataDirOrAdapter;
      this.dataDir = dataDirOrAdapter.dataDir || null;
    } else {
      throw new Error('Store requires a dataDir string or StorageAdapter instance');
    }
    this.options = options;
    this.stateFile = this.adapter.stateFile || (this.dataDir ? path.join(this.dataDir, 'state.json') : null);
    this.artifactsDir = this.adapter.artifactsDir || (this.dataDir ? path.join(this.dataDir, 'artifacts') : null);
    this.state = null;
    this.writeChain = Promise.resolve();
  }

  async init() {
    await this.adapter.init();
    try {
      this.state = await this.adapter.readState();
      if (!this.state) throw new Error('No state found');
    } catch {
      const projectId = id('prj_');
      this.state = {
        version: 1,
        projects: [{ id: projectId, name: 'Default Project', key: 'td_local_dev', createdAt: now() }],
        captures: [],
        comments: [],
        shares: [],
        recordingLinks: [],
        webhooks: [],
        integrations: [],
        webhookDeliveries: [],
        liveSessions: []
      };
      await this.persist();
    }
    for (const key of ['projects','captures','comments','shares','recordingLinks','webhooks','integrations','webhookDeliveries','liveSessions']) {
      if (!Array.isArray(this.state[key])) this.state[key] = [];
    }
    await this.persist();
    return this;
  }

  persist() {
    this.writeChain = this.writeChain.then(() => this.adapter.writeState(this.state));
    return this.writeChain;
  }

  listProjects() { return this.state.projects; }

  async createProject(input) {
    const project = { id: id('prj_'), name: String(input.name || 'Untitled Project'), key: token(18), createdAt: now() };
    this.state.projects.push(project);
    await this.persist();
    return project;
  }

  projectForKey(key) {
    return this.state.projects.find((p) => p.key === key) || null;
  }

  listCaptures(projectId) {
    return this.state.captures
      .filter((c) => !projectId || c.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getCapture(captureId) {
    const capture = this.state.captures.find((c) => c.id === captureId);
    if (!capture) return null;
    return {
      ...capture,
      comments: this.state.comments.filter((c) => c.captureId === captureId),
      shares: this.state.shares.filter((s) => s.captureId === captureId)
    };
  }

  async createCapture(input, projectId) {
    const capture = {
      id: id('cap_'),
      projectId,
      title: String(input.title || 'Untitled capture').slice(0, 240),
      description: String(input.description || '').slice(0, 20_000),
      url: String(input.url || '').slice(0, 4000),
      source: input.source || 'api',
      createdAt: now(),
      startedAt: input.startedAt || now(),
      durationMs: Number(input.durationMs || 0),
      environment: redact(input.environment || {}),
      metadata: redact(input.metadata || {}),
      events: redactEvents(input.events || []),
      artifacts: [],
      status: 'ready',
      analysis: null,
      externalIssues: []
    };
    this.state.captures.push(capture);
    await this.persist();
    return capture;
  }

  async updateCapture(captureId, patch) {
    const capture = this.state.captures.find((c) => c.id === captureId);
    if (!capture) return null;
    for (const key of ['title', 'description', 'durationMs', 'status']) {
      if (patch[key] !== undefined) capture[key] = patch[key];
    }
    if (patch.metadata) capture.metadata = { ...capture.metadata, ...redact(patch.metadata) };
    if (patch.analysis !== undefined) capture.analysis = patch.analysis;
    await this.persist();
    return capture;
  }

  async deleteCapture(captureId) {
    const index = this.state.captures.findIndex((c) => c.id === captureId);
    if (index === -1) return false;
    this.state.captures.splice(index, 1);
    this.state.comments = this.state.comments.filter((c) => c.captureId !== captureId);
    this.state.shares = this.state.shares.filter((s) => s.captureId !== captureId);
    await this.adapter.deleteCaptureArtifacts(captureId);
    await this.persist();
    return true;
  }

  async addArtifact(captureId, artifactInput, bytes) {
    const capture = this.state.captures.find((c) => c.id === captureId);
    if (!capture) return null;
    const artifactId = id('art_');
    const filename = `${artifactId}-${safeFilename(artifactInput.name || 'artifact.bin')}`;
    const saved = await this.adapter.saveArtifact(captureId, artifactId, filename, bytes);
    const artifact = {
      id: artifactId,
      kind: String(artifactInput.kind || 'attachment'),
      name: safeFilename(artifactInput.name || 'artifact.bin'),
      contentType: String(artifactInput.contentType || 'application/octet-stream'),
      bytes: saved.size,
      file: filename,
      path: saved.path,
      createdAt: now()
    };
    capture.artifacts.push(artifact);
    await this.persist();
    return artifact;
  }

  artifactPath(captureId, artifactId) {
    const capture = this.state.captures.find((c) => c.id === captureId);
    const artifact = capture?.artifacts.find((a) => a.id === artifactId);
    if (!artifact) return null;
    const resolvedPath = this.adapter.getArtifactPath(captureId, artifactId, artifact.file);
    return { artifact, path: resolvedPath };
  }

  async readArtifact(captureId, artifactId) {
    const info = this.artifactPath(captureId, artifactId);
    if (!info) return null;
    return await this.adapter.readArtifact(captureId, artifactId, info.artifact.file);
  }

  async addComment(captureId, input) {
    if (!this.state.captures.some((c) => c.id === captureId)) return null;
    const comment = {
      id: id('com_'), captureId,
      author: String(input.author || 'Anonymous').slice(0, 120),
      body: String(input.body || '').slice(0, 20_000),
      ts: input.ts === undefined ? null : Number(input.ts),
      createdAt: now()
    };
    this.state.comments.push(comment);
    await this.persist();
    return comment;
  }

  async createShare(captureId, input = {}) {
    if (!this.state.captures.some((c) => c.id === captureId)) return null;
    const share = {
      id: id('shr_'), captureId,
      token: token(24),
      expiresAt: input.expiresAt || null,
      createdAt: now()
    };
    this.state.shares.push(share);
    await this.persist();
    return share;
  }

  captureForShare(shareToken) {
    const share = this.state.shares.find((s) => s.token === shareToken);
    if (!share) return null;
    if (share.expiresAt && Date.parse(share.expiresAt) < Date.now()) return null;
    return this.getCapture(share.captureId);
  }

  async createRecordingLink(input) {
    const project = this.state.projects.find((p) => p.id === input.projectId) || this.state.projects[0];
    const link = {
      id: id('rec_'), token: token(24), projectId: project.id,
      title: String(input.title || 'Report an issue').slice(0, 240),
      prompt: String(input.prompt || 'Show us what went wrong and submit the recording.').slice(0, 1000),
      targetUrl: String(input.targetUrl || '').slice(0, 4000),
      expiresAt: input.expiresAt || null,
      createdAt: now()
    };
    this.state.recordingLinks.push(link);
    await this.persist();
    return link;
  }

  recordingLinkForToken(linkToken) {
    const link = this.state.recordingLinks.find((l) => l.token === linkToken);
    if (!link) return null;
    if (link.expiresAt && Date.parse(link.expiresAt) < Date.now()) return null;
    return link;
  }

  async createLiveSession(recordingLink) {
    const session = {
      id: id('ses_'), token: token(28), recordingLinkId: recordingLink.id,
      projectId: recordingLink.projectId, createdAt: now(), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      events: [], environment: {}, metadata: {}, identity: {}
    };
    this.state.liveSessions.push(session);
    this.state.liveSessions = this.state.liveSessions.filter((s) => Date.parse(s.expiresAt) > Date.now() - 60 * 60 * 1000);
    await this.persist();
    return session;
  }

  liveSession(sessionToken) {
    const session = this.state.liveSessions.find((s) => s.token === sessionToken);
    if (!session || Date.parse(session.expiresAt) < Date.now()) return null;
    return session;
  }

  async ingestLiveSession(sessionToken, input) {
    const session = this.liveSession(sessionToken);
    if (!session) return null;
    const incoming = Array.isArray(input.events) ? input.events : [];
    session.events.push(...redactEvents(incoming).slice(0, 1000));
    if (session.events.length > 10000) session.events.splice(0, session.events.length - 10000);
    session.environment = { ...session.environment, ...redact(input.environment || {}) };
    session.metadata = { ...session.metadata, ...redact(input.metadata || {}) };
    session.identity = { ...session.identity, ...redact(input.identity || {}) };
    await this.persist();
    return session;
  }

  async addWebhook(input) {
    const hook = {
      id: id('wh_'), projectId: input.projectId || this.state.projects[0].id,
      url: String(input.url || ''),
      secret: String(input.secret || token(20)),
      events: Array.isArray(input.events) && input.events.length ? input.events : ['capture.created'],
      active: input.active !== false,
      createdAt: now()
    };
    this.state.webhooks.push(hook);
    await this.persist();
    return hook;
  }

  webhooksFor(projectId, event) {
    return this.state.webhooks.filter((w) => w.active && w.projectId === projectId && w.events.includes(event));
  }

  async addWebhookDelivery(delivery) {
    this.state.webhookDeliveries.unshift({ id: id('whd_'), ...delivery, createdAt: now() });
    this.state.webhookDeliveries = this.state.webhookDeliveries.slice(0, 500);
    await this.persist();
  }

  async addExternalIssue(captureId, issue) {
    const capture = this.state.captures.find((c) => c.id === captureId);
    if (!capture) return null;
    capture.externalIssues.push({ ...issue, createdAt: now() });
    await this.persist();
    return issue;
  }

  async applyRetention(options = {}) {
    const {
      maxAgeDays = null,
      maxCaptures = null,
      maxStorageBytes = null,
      protectActiveShares = true
    } = options;

    const nowMs = Date.now();
    const activeShareCaptureIds = new Set();
    if (protectActiveShares) {
      for (const share of this.state.shares) {
        if (!share.expiresAt || Date.parse(share.expiresAt) > nowMs) {
          activeShareCaptureIds.add(share.captureId);
        }
      }
    }

    const eligibleToDelete = (c) => !activeShareCaptureIds.has(c.id);
    const toDeleteSet = new Set();

    // 1. TTL Policy: maxAgeDays
    if (typeof maxAgeDays === 'number' && maxAgeDays >= 0) {
      const cutoffMs = nowMs - (maxAgeDays * 24 * 60 * 60 * 1000);
      for (const capture of this.state.captures) {
        const createdMs = Date.parse(capture.createdAt);
        if (createdMs < cutoffMs && eligibleToDelete(capture)) {
          toDeleteSet.add(capture.id);
        }
      }
    }

    // 2. Count Cap: maxCaptures
    if (typeof maxCaptures === 'number' && maxCaptures >= 0) {
      const remainingCaptures = this.state.captures
        .filter((c) => !toDeleteSet.has(c.id))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first

      if (remainingCaptures.length > maxCaptures) {
        const excess = remainingCaptures.length - maxCaptures;
        let count = 0;
        for (const capture of remainingCaptures) {
          if (count >= excess) break;
          if (eligibleToDelete(capture)) {
            toDeleteSet.add(capture.id);
            count++;
          }
        }
      }
    }

    // 3. Storage Quota: maxStorageBytes
    if (typeof maxStorageBytes === 'number' && maxStorageBytes >= 0) {
      let currentSize = await this.adapter.getStorageSize();
      if (currentSize > maxStorageBytes) {
        const remainingCaptures = this.state.captures
          .filter((c) => !toDeleteSet.has(c.id))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first

        for (const capture of remainingCaptures) {
          if (currentSize <= maxStorageBytes) break;
          if (eligibleToDelete(capture)) {
            const capBytes = (capture.artifacts || []).reduce((sum, a) => sum + (a.bytes || 0), 0);
            toDeleteSet.add(capture.id);
            currentSize -= capBytes;
          }
        }
      }
    }

    const deletedCaptureIds = Array.from(toDeleteSet);
    let reclaimedBytes = 0;
    for (const cid of deletedCaptureIds) {
      const cap = this.state.captures.find((c) => c.id === cid);
      if (cap) {
        reclaimedBytes += (cap.artifacts || []).reduce((sum, a) => sum + (a.bytes || 0), 0);
      }
      await this.deleteCapture(cid);
    }

    return { deletedCaptureIds, reclaimedBytes };
  }
}
