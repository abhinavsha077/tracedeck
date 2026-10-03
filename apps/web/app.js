const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const state = { captures: [], current: null, config: null, readOnly: false, shareToken: null };

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}
function fmtTime(ms = 0) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
}
function ago(iso) {
  const diff = Math.max(0, Date.now() - Date.parse(iso));
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}
async function api(path, options = {}) {
  const res = await fetch(path, { headers: { ...(options.body && !(options.body instanceof Blob) ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }, ...options, body: options.body && !(typeof options.body === 'string') && !(options.body instanceof Blob) ? JSON.stringify(options.body) : options.body });
  if (!res.ok) { let msg = `${res.status}`; try { msg = (await res.json()).error || msg; } catch {} throw new Error(msg); }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}
function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('Copied to clipboard')); }

async function bootstrap() {
  try { const health = await api('/api/health'); $('#health').textContent = `Server ${health.version} online`; } catch { $('#health').textContent = 'Server unavailable'; }
  state.config = await api('/api/config');
  const params = new URLSearchParams(location.search);
  state.shareToken = params.get('share');
  if (state.shareToken) {
    state.readOnly = true;
    $('.sidebar').style.display = 'none';
    $('.shell').style.gridTemplateColumns = '1fr';
    $('.topbar').style.display = 'none';
    $('.capture-list-pane').style.display = 'none';
    $('.split').style.gridTemplateColumns = '1fr';
    $('.split').style.height = '100vh';
    const data = await api(`/api/share/${encodeURIComponent(state.shareToken)}`);
    state.current = data.capture;
    renderDetail(data.capture, true);
    return;
  }
  await loadCaptures();
  await loadLinks();
  await loadWebhooks();
  renderSettings();
  const selected = params.get('capture');
  if (selected) await selectCapture(selected);
}

async function loadCaptures() {
  const data = await api('/api/captures');
  state.captures = data.captures;
  $('#capture-count').textContent = data.captures.length;
  renderCaptureList(data.captures);
}
function renderCaptureList(captures) {
  const box = $('#capture-list');
  if (!captures.length) { box.innerHTML = `<div class="empty-state" style="height:auto;padding:40px 18px"><div class="empty-icon">◌</div><h2>No captures yet</h2><p>Load the Chrome extension or create a recording link to collect your first report.</p></div>`; return; }
  box.innerHTML = captures.map((c) => `<article class="capture-card ${state.current?.id === c.id ? 'active' : ''}" data-id="${c.id}">
    <h3>${escapeHtml(c.title)}</h3>
    <div class="capture-meta"><span>${escapeHtml(c.source)}</span><span>•</span><span>${ago(c.createdAt)}</span><span>•</span><span>${fmtTime(c.durationMs)}</span></div>
    <div class="capture-url">${escapeHtml(c.url || 'No source URL')}</div>
    <div class="badges"><span class="badge">${c.eventCount} events</span>${c.errorCount ? `<span class="badge err">${c.errorCount} errors</span>` : ''}${c.failedRequestCount ? `<span class="badge err">${c.failedRequestCount} failed requests</span>` : ''}</div>
  </article>`).join('');
  $$('.capture-card', box).forEach((el) => el.addEventListener('click', () => selectCapture(el.dataset.id)));
}
async function selectCapture(id) {
  const data = await api(`/api/captures/${encodeURIComponent(id)}`);
  state.current = data.capture;
  try { history.replaceState({}, '', `/app/?capture=${encodeURIComponent(id)}`); } catch { /* embedded/test contexts may have an opaque origin */ }
  renderCaptureList(state.captures);
  state.expandedEventIdx = null;
  state.activeArtifactId = null;
  state.eventSearch = '';
  state.statusFilter = 'all';
  state.levelFilter = 'all';
  state.activeTab = 'all';
  renderDetail(data.capture, false);
}

function captureDuration(capture) {
  if (!capture) return 1;
  return Math.max(capture.durationMs || 1, (capture.events || []).reduce((max, e) => Math.max(max, e.ts || 0), 0), 1);
}
function fmtBytes(bytes = 0) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderMediaGallery(capture) {
  const artifacts = capture.artifacts || [];
  if (!artifacts.length) {
    return `<div class="media-shell"><div class="media-placeholder"><b>No visual artifact attached</b><span>Console, network, actions, metadata, and comments are still available below.</span></div></div>`;
  }

  let activeArt = artifacts.find((a) => a.id === state.activeArtifactId);
  if (!activeArt) {
    activeArt = artifacts.find((a) => a.kind === 'video' || a.contentType?.startsWith('video/'))
      || artifacts.find((a) => a.kind === 'screenshot' || a.contentType?.startsWith('image/'))
      || artifacts[0];
    state.activeArtifactId = activeArt.id;
  }

  const tabsHtml = `<div class="media-gallery-bar"><span class="media-gallery-title">Artifacts (${artifacts.length}):</span>${artifacts.map((a) => {
    const isVideo = a.kind === 'video' || a.contentType?.startsWith('video/');
    const isImage = a.kind === 'screenshot' || a.contentType?.startsWith('image/');
    const icon = isVideo ? '▶' : isImage ? '📷' : '📄';
    const isActive = a.id === activeArt.id;
    return `<button class="gallery-tab ${isActive ? 'active' : ''}" data-art-id="${a.id}"><span class="gallery-icon">${icon}</span><span class="gallery-name">${escapeHtml(a.name || a.kind || 'artifact')}</span><span class="gallery-size">${fmtBytes(a.bytes)}</span></button>`;
  }).join('')}</div>`;

  let bodyHtml = '';
  if (activeArt.kind === 'video' || activeArt.contentType?.startsWith('video/')) {
    bodyHtml = `<video id="capture-video" controls preload="metadata" src="/api/captures/${capture.id}/artifacts/${activeArt.id}"></video>`;
  } else if (activeArt.kind === 'screenshot' || activeArt.contentType?.startsWith('image/')) {
    bodyHtml = `<div class="image-viewer"><img id="capture-image" src="/api/captures/${capture.id}/artifacts/${activeArt.id}" alt="${escapeHtml(activeArt.name || 'Screenshot')}" /><div class="image-actions"><a href="/api/captures/${capture.id}/artifacts/${activeArt.id}" target="_blank" class="button small">Open full size ↗</a><a href="/api/captures/${capture.id}/artifacts/${activeArt.id}" download="${escapeHtml(activeArt.name || 'screenshot.png')}" class="button small ghost">Download</a></div></div>`;
  } else {
    bodyHtml = `<div class="log-viewer"><div class="log-head"><span>${escapeHtml(activeArt.name || 'Attachment')} (${fmtBytes(activeArt.bytes)})</span><div class="row" style="gap:6px"><a href="/api/captures/${capture.id}/artifacts/${activeArt.id}" target="_blank" class="button small">Open in new tab ↗</a><a href="/api/captures/${capture.id}/artifacts/${activeArt.id}" download="${escapeHtml(activeArt.name || 'artifact')}" class="button small ghost">Download</a></div></div><iframe class="artifact-iframe" src="/api/captures/${capture.id}/artifacts/${activeArt.id}"></iframe></div>`;
  }

  return `${tabsHtml}<div class="media-shell">${bodyHtml}</div>`;
}

function eventLabel(e) {
  const d = e.data || {};
  if (e.type === 'console') return String(d.message || (Array.isArray(d.args) ? d.args.join(' ') : d.args) || d.name || 'Console event');
  if (e.type === 'network') return `${d.method || 'GET'} ${d.url || ''}`;
  if (e.type === 'action') return d.label || `${d.action || 'interaction'} ${d.selector || d.target || ''}`;
  if (e.type === 'navigation') return d.url || d.to || 'Navigation';
  if (e.type === 'app') return d.message || d.name || JSON.stringify(d);
  return JSON.stringify(d);
}
function eventExtra(e) {
  if (e.type === 'network') return e.data?.status ? String(e.data.status) : (e.data?.failed ? 'failed' : '');
  return e.level || '';
}
function eventClass(e) {
  const bad = (e.type === 'console' && ['error', 'exception'].includes(e.level || e.data?.level)) || (e.type === 'network' && (Number(e.data?.status || 0) >= 400 || e.data?.failed));
  return bad ? 'error' : '';
}

function getCategoryCounts(events = []) {
  return {
    all: events.length,
    console: events.filter((e) => e.type === 'console').length,
    network: events.filter((e) => e.type === 'network').length,
    action: events.filter((e) => e.type === 'action').length,
    errors: events.filter((e) => eventClass(e) === 'error').length
  };
}

function renderEventDetailDrawer(e, idx) {
  const d = e.data || {};
  const sections = [];

  const metaItems = [
    `<div class="detail-item"><label>Type</label><span>${escapeHtml(e.type)}</span></div>`,
    `<div class="detail-item"><label>Timestamp</label><span>${fmtTime(e.ts)} (${e.ts}ms)</span></div>`
  ];
  if (e.level || d.level) metaItems.push(`<div class="detail-item"><label>Level</label><span>${escapeHtml(e.level || d.level)}</span></div>`);
  if (d.status) metaItems.push(`<div class="detail-item"><label>HTTP Status</label><span>${escapeHtml(d.status)} ${escapeHtml(d.statusText || '')}</span></div>`);
  if (d.duration != null) metaItems.push(`<div class="detail-item"><label>Duration</label><span>${d.duration}ms</span></div>`);
  if (d.method) metaItems.push(`<div class="detail-item"><label>Method</label><span>${escapeHtml(d.method)}</span></div>`);
  if (d.phase) metaItems.push(`<div class="detail-item"><label>Phase</label><span>${escapeHtml(d.phase)}</span></div>`);
  sections.push(`<div class="event-detail-grid">${metaItems.join('')}</div>`);

  if (e.type === 'network') {
    if (d.url) sections.push(`<div class="detail-item"><label>URL</label><code>${escapeHtml(d.url)}</code></div>`);
    if (d.failed || d.error) sections.push(`<div class="detail-item" style="border-color:#582029"><label style="color:var(--red)">Failure / Error</label><span style="color:var(--red)">${escapeHtml(d.error || 'Network request failed')}</span></div>`);
    const reqHeaders = Object.entries(d.headers || d.requestHeaders || {});
    if (reqHeaders.length) {
      sections.push(`<div class="detail-item"><label>Request Headers (${reqHeaders.length})</label><table class="headers-table">${reqHeaders.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join('')}</table></div>`);
    }
    const resHeaders = Object.entries(d.responseHeaders || {});
    if (resHeaders.length) {
      sections.push(`<div class="detail-item"><label>Response Headers (${resHeaders.length})</label><table class="headers-table">${resHeaders.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join('')}</table></div>`);
    }
  }

  if (e.type === 'console') {
    const msg = d.message || (Array.isArray(d.args) ? d.args.join(' ') : d.args) || '';
    if (msg) sections.push(`<div class="detail-item"><label>Message</label><span style="white-space:pre-wrap">${escapeHtml(msg)}</span></div>`);
    const stack = d.stack || d.trace || d.stackTrace || (d.url ? `${d.url}:${d.line || 0}:${d.column || 0}` : null);
    if (stack) sections.push(`<div class="detail-item"><label>Stack Trace</label><pre class="stack-trace">${escapeHtml(stack)}</pre></div>`);
  }

  if (e.type === 'action') {
    if (d.selector) sections.push(`<div class="detail-item"><label>CSS Selector Path</label><code>${escapeHtml(d.selector)}</code></div>`);
    if (d.label) sections.push(`<div class="detail-item"><label>Element Label</label><span>${escapeHtml(d.label)}</span></div>`);
    if (d.action) sections.push(`<div class="detail-item"><label>Action Payload</label><span>Action: ${escapeHtml(d.action)}${d.valueLength != null ? ` · Value length: ${d.valueLength}` : ''}${d.sensitive ? ' · (Sensitive input masked)' : ''}</span></div>`);
  }

  const rawJson = JSON.stringify(e, null, 2);
  sections.push(`<div class="detail-json-wrap"><div class="row" style="justify-content:space-between;margin-bottom:6px"><details open><summary>Structured Event JSON</summary><pre><code>${escapeHtml(rawJson)}</code></pre></details><button class="button small copy-json" data-idx="${idx}" style="margin-left:auto">Copy JSON</button></div></div>`);

  return `<div class="event-detail-drawer" id="event-detail-${idx}">${sections.join('')}</div>`;
}

function renderEvents(capture) {
  const holder = $('#event-content'); if (!holder) return;
  const allEvents = [...(capture.events || [])].sort((a, b) => a.ts - b.ts);
  const counts = getCategoryCounts(allEvents);

  $$('.tab[data-tab]').forEach((tab) => {
    const key = tab.dataset.tab;
    if (counts[key] != null) {
      let badge = tab.querySelector('.tab-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = `tab-badge ${key === 'errors' && counts.errors > 0 ? 'err' : ''}`;
        tab.appendChild(badge);
      }
      badge.textContent = counts[key];
    }
  });

  const filterBarHtml = `
    <div class="event-filter-bar">
      <input id="event-search" class="search-input" placeholder="Search keyword (label, selector, URL, method, message, error)..." value="${escapeHtml(state.eventSearch || '')}" />
      <select id="event-status-filter">
        <option value="all" ${state.statusFilter === 'all' ? 'selected' : ''}>Status: All</option>
        <option value="2xx" ${state.statusFilter === '2xx' ? 'selected' : ''}>Status: 2xx Success</option>
        <option value="3xx" ${state.statusFilter === '3xx' ? 'selected' : ''}>Status: 3xx Redirect</option>
        <option value="4xx" ${state.statusFilter === '4xx' ? 'selected' : ''}>Status: 4xx Client Err</option>
        <option value="5xx" ${state.statusFilter === '5xx' ? 'selected' : ''}>Status: 5xx Server Err</option>
        <option value="failed" ${state.statusFilter === 'failed' ? 'selected' : ''}>Status: Failed</option>
      </select>
      <select id="event-level-filter">
        <option value="all" ${state.levelFilter === 'all' ? 'selected' : ''}>Level: All</option>
        <option value="info" ${state.levelFilter === 'info' ? 'selected' : ''}>Level: Info / Log</option>
        <option value="warn" ${state.levelFilter === 'warn' ? 'selected' : ''}>Level: Warn</option>
        <option value="error" ${state.levelFilter === 'error' ? 'selected' : ''}>Level: Error</option>
      </select>
      ${(state.eventSearch || state.statusFilter !== 'all' || state.levelFilter !== 'all') ? '<button class="button small ghost filter-reset" id="filter-reset">Reset</button>' : ''}
    </div>
  `;

  let filtered = allEvents;
  if (state.activeTab !== 'all') {
    filtered = filtered.filter((e) => state.activeTab === 'errors' ? eventClass(e) === 'error' : e.type === state.activeTab);
  }

  if (state.statusFilter !== 'all') {
    filtered = filtered.filter((e) => {
      const s = Number(e.data?.status || 0);
      if (state.statusFilter === 'failed') return e.data?.failed || s >= 400;
      if (state.statusFilter === '2xx') return s >= 200 && s < 300;
      if (state.statusFilter === '3xx') return s >= 300 && s < 400;
      if (state.statusFilter === '4xx') return s >= 400 && s < 500;
      if (state.statusFilter === '5xx') return s >= 500 && s < 600;
      return true;
    });
  }

  if (state.levelFilter !== 'all') {
    filtered = filtered.filter((e) => {
      const lvl = (e.level || e.data?.level || '').toLowerCase();
      if (state.levelFilter === 'error') return ['error', 'exception'].includes(lvl) || eventClass(e) === 'error';
      if (state.levelFilter === 'warn') return ['warn', 'warning'].includes(lvl);
      if (state.levelFilter === 'info') return ['info', 'log', 'debug'].includes(lvl) || (!lvl && e.type === 'console');
      return true;
    });
  }

  if (state.eventSearch) {
    const q = state.eventSearch.toLowerCase().trim();
    filtered = filtered.filter((e) => {
      const lbl = eventLabel(e).toLowerCase();
      const extra = eventExtra(e).toLowerCase();
      const sel = (e.data?.selector || '').toLowerCase();
      const url = (e.data?.url || '').toLowerCase();
      const meth = (e.data?.method || '').toLowerCase();
      const msg = (e.data?.message || '').toLowerCase();
      const err = (e.data?.error || '').toLowerCase();
      const status = String(e.data?.status || '');
      return lbl.includes(q) || extra.includes(q) || sel.includes(q) || url.includes(q) || meth.includes(q) || msg.includes(q) || err.includes(q) || status.includes(q) || JSON.stringify(e.data || {}).toLowerCase().includes(q);
    });
  }

  let tableHtml = '';
  if (!filtered.length) {
    tableHtml = `<div class="panel-card"><p>No matching events found.</p></div>`;
  } else {
    tableHtml = `<div class="event-table">${filtered.map((e, i) => {
      const isExpanded = state.expandedEventIdx === i;
      return `
        <div class="event-row has-detail ${eventClass(e)} ${isExpanded ? 'expanded' : ''}" data-ts="${e.ts}" data-idx="${i}">
          <span class="event-time">${fmtTime(e.ts)}</span>
          <span class="event-type">${escapeHtml(e.type)}</span>
          <span class="event-msg">${escapeHtml(eventLabel(e))}</span>
          <span class="event-extra">${escapeHtml(eventExtra(e))}</span>
        </div>
        ${isExpanded ? renderEventDetailDrawer(e, i) : ''}
      `;
    }).join('')}</div>`;
  }

  holder.innerHTML = filterBarHtml + tableHtml;

  $('#event-search')?.addEventListener('input', (e) => {
    state.eventSearch = e.target.value;
    state.expandedEventIdx = null;
    renderEvents(capture);
  });
  $('#event-status-filter')?.addEventListener('change', (e) => {
    state.statusFilter = e.target.value;
    state.expandedEventIdx = null;
    renderEvents(capture);
  });
  $('#event-level-filter')?.addEventListener('change', (e) => {
    state.levelFilter = e.target.value;
    state.expandedEventIdx = null;
    renderEvents(capture);
  });
  $('#filter-reset')?.addEventListener('click', () => {
    state.eventSearch = '';
    state.statusFilter = 'all';
    state.levelFilter = 'all';
    state.expandedEventIdx = null;
    renderEvents(capture);
  });

  $$('.event-row', holder).forEach((row) => {
    row.addEventListener('click', () => {
      const ts = Number(row.dataset.ts);
      const idx = Number(row.dataset.idx);
      seek(ts);
      state.expandedEventIdx = (state.expandedEventIdx === idx) ? null : idx;
      renderEvents(capture);
    });
  });

  $$('.copy-json', holder).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.idx);
      const targetEvent = filtered[idx];
      if (targetEvent) {
        copy(JSON.stringify(targetEvent, null, 2));
      }
    });
  });
}

function initTimelineScrubber(timelineEl, duration) {
  let dragging = false;
  const tooltip = $('#timeline-tooltip');

  function seekFromEvent(e) {
    const rect = timelineEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    seek(Math.round(pct * duration));
  }

  timelineEl.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { timelineEl.setPointerCapture(e.pointerId); } catch {}
    seekFromEvent(e);
  });

  timelineEl.addEventListener('pointermove', (e) => {
    const rect = timelineEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    const hoverMs = Math.round(pct * duration);
    if (tooltip) {
      tooltip.style.display = 'block';
      tooltip.style.left = `${pct * 100}%`;
      tooltip.textContent = fmtTime(hoverMs);
    }
    if (dragging) {
      seek(hoverMs);
    }
  });

  timelineEl.addEventListener('pointerleave', () => {
    if (!dragging && tooltip) tooltip.style.display = 'none';
  });

  const stopDrag = (e) => {
    if (dragging) {
      dragging = false;
      try { timelineEl.releasePointerCapture(e.pointerId); } catch {}
      if (tooltip) tooltip.style.display = 'none';
    }
  };

  timelineEl.addEventListener('pointerup', stopDrag);
  timelineEl.addEventListener('pointercancel', stopDrag);
}

function bindMediaListeners(capture, duration) {
  const video = $('#capture-video');
  if (video) {
    video.addEventListener('timeupdate', () => syncTimeline(video.currentTime * 1000, duration));
  }
  $$('.gallery-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const artId = tab.dataset.artId;
      if (artId && artId !== state.activeArtifactId) {
        state.activeArtifactId = artId;
        const mediaContainer = $('.media-shell')?.parentElement;
        if (mediaContainer) {
          mediaContainer.querySelector('.media-gallery-bar')?.remove();
          mediaContainer.querySelector('.media-shell')?.remove();
          const temp = document.createElement('div');
          temp.innerHTML = renderMediaGallery(capture);
          while (temp.firstChild) {
            mediaContainer.insertBefore(temp.firstChild, mediaContainer.querySelector('.timeline'));
          }
          bindMediaListeners(capture, duration);
        }
      }
    });
  });
}

function renderDetail(capture, shared) {
  const duration = captureDuration(capture);
  const markers = (capture.events || []).filter((e) => e.type === 'console' || e.type === 'network' || e.type === 'action').slice(0, 500).map((e) => {
    const cls = eventClass(e) ? 'error' : e.type === 'network' ? 'network' : '';
    return `<button class="marker ${cls}" style="left:${Math.min(100, e.ts / duration * 100)}%" title="${escapeHtml(eventLabel(e)).slice(0, 120)}" data-ts="${e.ts}"></button>`;
  }).join('');
  const env = Object.entries(capture.environment || {}).map(([k, v]) => `<div class="kv"><span>${escapeHtml(k)}</span><code>${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</code></div>`).join('');
  const meta = Object.entries(capture.metadata || {}).map(([k, v]) => `<div class="kv"><span>${escapeHtml(k)}</span><code>${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</code></div>`).join('');
  const analysis = capture.analysis ? `<div class="analysis"><h3>AI / local analysis</h3><p>${escapeHtml(capture.analysis.summary || '')}</p>${capture.analysis.reproductionSteps ? `<h3 style="margin-top:12px">Reproduction</h3><pre>${escapeHtml(capture.analysis.reproductionSteps)}</pre>` : ''}${capture.analysis.likelyCause ? `<h3 style="margin-top:12px">Likely cause</h3><p>${escapeHtml(capture.analysis.likelyCause)}</p>` : ''}</div>` : `<div class="panel-card"><p>No analysis has been generated yet.</p></div>`;
  const comments = (capture.comments || []).map((c) => `<div class="comment"><span>${escapeHtml(c.author)} · ${ago(c.createdAt)}${c.ts != null ? ` · ${fmtTime(c.ts)}` : ''}</span><p>${escapeHtml(c.body)}</p></div>`).join('') || `<p class="muted">No comments yet.</p>`;
  const issueButtons = !shared ? `<button class="button small" id="create-issue">Create issue</button>` : '';
  const actions = shared ? '' : `<div class="detail-actions"><button class="button small" id="analyze">Analyze</button>${issueButtons}<button class="button small" id="share">Share</button><button class="button small" id="playwright">Playwright</button><button class="button small" id="export">Export .trace</button><button class="button small danger" id="delete-capture">Delete</button></div>`;
  
  $('#detail').innerHTML = `<header class="detail-head"><div class="detail-head-top"><h1>${escapeHtml(capture.title)}</h1>${actions}</div><div class="detail-sub"><span class="source-chip">${escapeHtml(capture.source)}</span><span>${new Date(capture.createdAt).toLocaleString()}</span><span>•</span><span>${escapeHtml(capture.url || 'No URL')}</span></div></header>
    <div class="detail-body">
    ${renderMediaGallery(capture)}
    <div class="timeline" id="timeline"><div class="timeline-line"><div id="timeline-progress" class="timeline-progress"></div><div id="timeline-scrubber" class="timeline-scrubber"></div></div><div id="timeline-tooltip" class="timeline-tooltip"></div>${markers}</div>
    <div class="tabbar"><button class="tab active" data-tab="all">All</button><button class="tab" data-tab="console">Console</button><button class="tab" data-tab="network">Network</button><button class="tab" data-tab="action">Actions</button><button class="tab" data-tab="errors">Errors</button><button class="tab" data-tab="environment">Environment</button><button class="tab" data-tab="metadata">App data</button><button class="tab" data-tab="analysis">Analysis</button></div>
    <div id="event-content"></div>
    <h3 class="section-title">Comments</h3><div class="comments">${comments}</div>${shared ? '' : `<form id="comment-form" class="comment-form"><input class="input" name="body" required placeholder="Add context or a timestamped note…"/><button class="button">Comment</button></form>`}
    </div>`;

  renderEvents(capture);
  bindMediaListeners(capture, duration);
  initTimelineScrubber($('#timeline'), duration);

  $$('.marker').forEach((m) => m.addEventListener('click', (e) => {
    e.stopPropagation();
    seek(Number(m.dataset.ts));
  }));

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const key = tab.dataset.tab;
    state.activeTab = key;
    state.expandedEventIdx = null;
    if (key === 'environment') $('#event-content').innerHTML = `<div class="kv-grid">${env || '<p class="muted">No environment metadata.</p>'}</div>`;
    else if (key === 'metadata') $('#event-content').innerHTML = `<div class="kv-grid">${meta || '<p class="muted">No app metadata.</p>'}</div>`;
    else if (key === 'analysis') $('#event-content').innerHTML = analysis;
    else renderEvents(capture);
  }));

  if (!shared) bindDetailActions(capture);
}

function seek(ms) {
  const duration = captureDuration(state.current);
  const clamped = Math.max(0, Math.min(duration, ms));
  const v = $('#capture-video');
  if (v && Number.isFinite(v.duration) && v.duration > 0) {
    v.currentTime = clamped / 1000;
  }
  syncTimeline(clamped, duration);
}

function syncTimeline(ms, duration) {
  const pct = Math.min(100, Math.max(0, (ms / duration) * 100));
  const p = $('#timeline-progress'); if (p) p.style.width = `${pct}%`;
  const s = $('#timeline-scrubber'); if (s) s.style.left = `${pct}%`;
  $$('.marker').forEach((m) => m.classList.toggle('active', Math.abs(Number(m.dataset.ts) - ms) < 400));
  let activeRow = null;
  $$('.event-row').forEach((r) => {
    const isAct = Math.abs(Number(r.dataset.ts) - ms) < 400;
    r.classList.toggle('active', isAct);
    if (isAct && !activeRow) activeRow = r;
  });
  if (activeRow) {
    activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function bindDetailActions(capture) {
  $('#analyze')?.addEventListener('click', async () => { $('#analyze').disabled = true; try { const r = await api(`/api/captures/${capture.id}/analyze`, { method: 'POST', body: {} }); capture.analysis = r.analysis; toast('Analysis generated'); renderDetail(capture, false); } catch (e) { toast(e.message); } });
  $('#share')?.addEventListener('click', async () => { try { const r = await api(`/api/captures/${capture.id}/share`, { method: 'POST', body: {} }); copy(r.url); } catch (e) { toast(e.message); } });
  $('#export')?.addEventListener('click', () => location.href = `/api/captures/${capture.id}/export`);
  $('#playwright')?.addEventListener('click', () => location.href = `/api/captures/${capture.id}/playwright`);
  $('#create-issue')?.addEventListener('click', () => issueModal(capture));
  $('#delete-capture')?.addEventListener('click', async () => {
    if (!confirm(`Delete capture "${capture.title}"? This cannot be undone.`)) return;
    try {
      await api(`/api/captures/${capture.id}`, { method: 'DELETE' });
      toast('Capture deleted');
      state.current = null;
      $('#detail').innerHTML = `<div class="empty-state"><div class="empty-icon">◎</div><h2>Select a capture</h2><p>Choose a report on the left, record one with the browser extension, or create a recording link for someone else.</p></div>`;
      await loadCaptures();
    } catch (err) {
      toast(err.message);
    }
  });
  $('#comment-form')?.addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); try { await api(`/api/captures/${capture.id}/comments`, { method: 'POST', body: { author: 'Developer', body: fd.get('body'), ts: $('#capture-video') ? Math.round($('#capture-video').currentTime * 1000) : null } }); await selectCapture(capture.id); } catch (err) { toast(err.message); } });
}


function showModal(title, html, onConfirm) {
  const modal = $('#modal'); $('#modal-title').textContent = title; $('#modal-body').innerHTML = html;
  const form = $('#modal-form');
  const handler = async (e) => {
    if (e.submitter?.value !== 'default') return;
    e.preventDefault();
    try { const shouldClose = await onConfirm(new FormData(form)); if (shouldClose !== false) modal.close(); } catch (err) { toast(err.message); }
  };
  form.onsubmit = handler; modal.showModal();
}
function issueModal(capture) {
  const templates = {
    github: JSON.stringify({ repo: 'owner/repo' }, null, 2),
    linear: JSON.stringify({ teamId: 'YOUR_TEAM_ID' }, null, 2),
    jira: JSON.stringify({ baseUrl: 'https://company.atlassian.net', projectKey: 'DEV', issueType: 'Bug' }, null, 2),
    slack: JSON.stringify({ webhookUrl: 'https://hooks.slack.com/services/...' }, null, 2)
  };

  showModal('Create external issue', `
    <div class="field">
      <label>Provider</label>
      <select id="issue-provider" name="provider">
        <option value="github">GitHub Issues</option>
        <option value="linear">Linear</option>
        <option value="jira">Jira Cloud</option>
        <option value="slack">Slack</option>
      </select>
    </div>
    <div class="field">
      <label>Provider options (JSON)</label>
      <textarea id="issue-options" name="options" rows="7" class="mono">${escapeHtml(templates.github)}</textarea>
    </div>
    <p class="muted" style="font-size:11px;margin-top:6px">
      Credentials can be set via server env vars (<code>TRACEDECK_LINEAR_TOKEN</code>, <code>TRACEDECK_JIRA_TOKEN</code>, <code>TRACEDECK_JIRA_EMAIL</code>) or passed directly in options as <code>token</code>, <code>email</code>.
    </p>
  `, async (fd) => {
    let options; try { options = JSON.parse(fd.get('options') || '{}'); } catch { throw new Error('Options must be valid JSON'); }
    const r = await api(`/api/captures/${capture.id}/issues`, { method: 'POST', body: { provider: fd.get('provider'), options } });
    toast(`Created ${r.issue.provider} issue ${r.issue.id}`); await selectCapture(capture.id); return true;
  });

  const select = $('#issue-provider');
  const textarea = $('#issue-options');
  if (select && textarea) {
    select.addEventListener('change', () => {
      textarea.value = templates[select.value] || '{}';
    });
  }
}

async function createRecordingLink() {
  const project = state.config.projects[0];
  showModal('Create recording link', `<div class="field"><label>Title</label><input class="input" name="title" value="Report a bug" /></div><div class="field"><label>Reporter instructions</label><textarea name="prompt" rows="4">Record the screen, reproduce the issue, then describe what you expected to happen.</textarea></div><div class="field"><label>Instrumented app URL (optional)</label><input class="input" name="targetUrl" placeholder="https://app.example.com" /></div><p class="muted">If your app loads the TraceDeck browser SDK, reporters can open this URL with a temporary session token so app metadata and errors join the recording.</p>`, async (fd) => {
    const r = await api('/api/recording-links', { method: 'POST', body: { projectId: project.id, title: fd.get('title'), prompt: fd.get('prompt'), targetUrl: fd.get('targetUrl') } });
    copy(r.url); await loadLinks(); return true;
  });
}
async function loadLinks() {
  const r = await api('/api/recording-links');
  const box = $('#links-list');
  box.innerHTML = r.recordingLinks.length ? r.recordingLinks.map((l) => `<article class="panel-card"><h3>${escapeHtml(l.title)}</h3><p>${escapeHtml(l.prompt)}</p><div class="code-box">${escapeHtml(`${location.origin}/record/${l.token}`)}</div><div class="card-actions"><button class="button small copy-link" data-url="${escapeHtml(`${location.origin}/record/${l.token}`)}">Copy link</button><a class="button small" style="display:grid;place-items:center;text-decoration:none" href="/record/${l.token}" target="_blank">Open</a></div></article>`).join('') : `<div class="panel-card"><h3>No recording links</h3><p>Create one to let QA, support, or customers report an issue without installing the extension.</p></div>`;
  $$('.copy-link', box).forEach((b) => b.addEventListener('click', () => copy(b.dataset.url)));
}
async function createWebhook() {
  showModal('Create webhook', `<div class="field"><label>Destination URL</label><input class="input" name="url" placeholder="https://your-service.example/hooks/tracedeck" required/></div><div class="field"><label>Events (comma separated)</label><input class="input" name="events" value="capture.created,analysis.completed,issue.created"/></div>`, async (fd) => {
    await api('/api/webhooks', { method: 'POST', body: { projectId: state.config.projects[0].id, url: fd.get('url'), events: String(fd.get('events')).split(',').map((s) => s.trim()).filter(Boolean) } });
    await loadWebhooks(); return true;
  });
}
async function loadWebhooks() {
  const r = await api('/api/webhooks');
  $('#webhook-list').innerHTML = r.webhooks.length ? r.webhooks.map((w) => `<article class="panel-card"><h3>${escapeHtml(w.url)}</h3><p>${w.events.map(escapeHtml).join(' · ')}</p><p>${w.active ? 'Active' : 'Disabled'} · created ${ago(w.createdAt)}</p></article>`).join('') : `<div class="panel-card"><h3>No webhooks</h3><p>Add a webhook to start an agent, CI pipeline, or automation when debugging evidence arrives.</p></div>`;
}
function renderSettings() {
  const p = state.config.projects[0];
  const status = Object.entries(state.config.integrationStatus).map(([k, v]) => `<span class="badge ${v ? '' : 'err'}">${escapeHtml(k)} ${v ? 'configured' : 'not configured'}</span>`).join(' ');
  $('#settings-content').innerHTML = `<section class="panel-card"><h3>${escapeHtml(p?.name || 'Project')}</h3><p>Project ID</p><div class="code-box">${escapeHtml(p?.id || '')}</div><p style="margin-top:12px">Extension/API project keys are returned only by the local projects endpoint. Keep them private.</p><button class="button small" style="margin-top:10px" id="show-key">Show local project key</button></section>
  <section class="panel-card"><h3>Integrations</h3><p>Credential status from server environment variables.</p><div class="badges">${status}</div></section>
  <section class="panel-card"><h3>Browser SDK</h3><p>Embed this in apps that need richer Recording Link context.</p><div class="code-box">&lt;script src="${escapeHtml(location.origin)}/sdk/tracedeck.js"&gt;&lt;/script&gt;</div></section>`;
  $('#show-key')?.addEventListener('click', async () => { const r = await api('/api/projects'); const project = r.projects[0]; showModal('Local project key', `<div class="code-box">${escapeHtml(project.key)}</div><p class="muted">Use this in the extension Options page or the X-TraceDeck-Key header.</p>`, async () => true); });
}

$$('.nav').forEach((n) => n.addEventListener('click', () => {
  $$('.nav').forEach((x) => x.classList.toggle('active', x === n));
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#${n.dataset.view}-view`).classList.add('active');
}));
$('#import-trace').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file=e.target.files?.[0]; if(!file)return;
  try {
    const r=await api('/api/captures/import',{method:'POST',headers:{'content-type':'application/zip'},body:file});
    toast('Trace bundle imported'); await loadCaptures(); await selectCapture(r.capture.id);
  } catch(err){toast(`Import failed: ${err.message}`)} finally {e.target.value=''}
});
$('#refresh').addEventListener('click', () => loadCaptures().then(() => state.current && selectCapture(state.current.id)));
$('#new-record-link').addEventListener('click', createRecordingLink);
$('#new-record-link-2').addEventListener('click', createRecordingLink);
$('#new-webhook').addEventListener('click', createWebhook);
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = e.target.value.trim();
    if (!q) return renderCaptureList(state.captures);
    const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
    renderCaptureList(r.captures.map((c) => ({
      ...c,
      eventCount: c.eventCount ?? (c.events?.length || 0),
      artifactCount: c.artifactCount ?? (c.artifacts?.length || 0),
      errorCount: c.errorCount ?? (c.events?.filter((e) => e.type === 'console' && ['error', 'exception'].includes(e.level || e.data?.level)).length || 0),
      failedRequestCount: c.failedRequestCount ?? (c.events?.filter((e) => e.type === 'network' && (Number(e.data?.status || 0) >= 400 || e.data?.failed)).length || 0)
    })));
  }, 200);
});

bootstrap().catch((e) => { console.error(e); toast(e.message); });
