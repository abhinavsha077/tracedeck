#!/usr/bin/env node
// Dependency-free MCP stdio server. It speaks newline-delimited JSON-RPC, matching the MCP stdio transport.
const base = (process.env.TRACEDECK_URL || 'http://localhost:4177').replace(/\/$/, '');
const key = process.env.TRACEDECK_KEY || 'td_local_dev';

async function api(path, options = {}) {
  const r = await fetch(base + path, {
    ...options,
    body: typeof options.body === 'object' ? JSON.stringify(options.body) : options.body,
    headers: {
      'x-tracedeck-key': key,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (r.status === 204) return { success: true };
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 400)}`);
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r.text();
}

const tools = [
  {
    name: 'list_captures',
    description: 'List recent TraceDeck bug captures with event, error, and status counts.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } }
  },
  {
    name: 'get_capture',
    description: 'Get a complete TraceDeck capture including events, comments, and artifact metadata.',
    inputSchema: { type: 'object', required: ['captureId'], properties: { captureId: { type: 'string' } } }
  },
  {
    name: 'triage_capture',
    description: 'Get high-signal causal chain triage of a capture (Action -> Network Failure -> Exception) with fix direction and severity. Highly token-efficient for LLM reasoning.',
    inputSchema: { type: 'object', required: ['captureId'], properties: { captureId: { type: 'string' } } }
  },
  {
    name: 'create_capture',
    description: 'Create a new bug capture in TraceDeck. Allows AI agents to report bugs found during automated testing or code execution.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Brief summary of the issue' },
        description: { type: 'string', description: 'Detailed reproduction narrative' },
        url: { type: 'string', description: 'URL of the page where the error occurred' },
        events: { type: 'array', description: 'Timeline events (actions, console, network)' },
        metadata: { type: 'object', description: 'App metadata (build, release, tenant)' },
        environment: { type: 'object', description: 'Browser and OS environment' }
      }
    }
  },
  {
    name: 'add_comment',
    description: 'Add an analysis note or investigation comment to a capture timeline.',
    inputSchema: {
      type: 'object',
      required: ['captureId', 'body'],
      properties: {
        captureId: { type: 'string' },
        author: { type: 'string', description: 'Author name (defaults to AI Agent)' },
        body: { type: 'string', description: 'Comment body with findings or triage context' },
        ts: { type: 'number', description: 'Optional millisecond timestamp along the capture timeline' }
      }
    }
  },
  {
    name: 'create_issue',
    description: 'Export a capture to an external issue tracker (github, linear, jira, slack).',
    inputSchema: {
      type: 'object',
      required: ['captureId', 'provider'],
      properties: {
        captureId: { type: 'string' },
        provider: { type: 'string', enum: ['github', 'linear', 'jira', 'slack'] },
        options: {
          type: 'object',
          description: 'Provider options (e.g. { repo: "owner/repo" } for GitHub, { teamId: "..." } for Linear, { projectKey: "DEV" } for Jira)'
        }
      }
    }
  },
  {
    name: 'generate_playwright',
    description: 'Generate a Playwright reproduction draft from captured actions.',
    inputSchema: { type: 'object', required: ['captureId'], properties: { captureId: { type: 'string' } } }
  },
  {
    name: 'run_reproduction',
    description: 'Execute automated reproduction verification for a capture. Tests live backend endpoints and action steps, returning pass/fail verdict and Playwright reproduction script.',
    inputSchema: {
      type: 'object',
      required: ['captureId'],
      properties: {
        captureId: { type: 'string' },
        checkEndpoints: { type: 'boolean', description: 'Probe failing network endpoints to check if they are still returning errors or now resolved (default: true)' }
      }
    }
  },
  {
    name: 'export_har',
    description: 'Export network events from a capture as standard HTTP Archive (HAR 1.2) JSON.',
    inputSchema: { type: 'object', required: ['captureId'], properties: { captureId: { type: 'string' } } }
  },
  {
    name: 'analyze_capture',
    description: 'Run the configured AI or local heuristic analysis for a capture.',
    inputSchema: { type: 'object', required: ['captureId'], properties: { captureId: { type: 'string' } } }
  },
  {
    name: 'get_console_logs',
    description: 'Get console events from a capture.',
    inputSchema: { type: 'object', required: ['captureId'], properties: { captureId: { type: 'string' } } }
  },
  {
    name: 'get_network_requests',
    description: 'Get network events from a capture.',
    inputSchema: { type: 'object', required: ['captureId'], properties: { captureId: { type: 'string' } } }
  },
  {
    name: 'get_user_actions',
    description: 'Get user actions from a capture.',
    inputSchema: { type: 'object', required: ['captureId'], properties: { captureId: { type: 'string' } } }
  },
  {
    name: 'delete_capture',
    description: 'Permanently delete a capture and its associated artifacts and comments.',
    inputSchema: { type: 'object', required: ['captureId'], properties: { captureId: { type: 'string' } } }
  }
];

function result(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

async function call(name, a = {}) {
  if (name === 'list_captures') {
    const q = a.projectId ? `?projectId=${encodeURIComponent(a.projectId)}` : '';
    return result(await api(`/api/captures${q}`));
  }
  if (name === 'create_capture') {
    return result(await api('/api/captures', { method: 'POST', body: a }));
  }
  if (name === 'triage_capture') {
    return result(await api(`/api/captures/${encodeURIComponent(a.captureId)}/triage`));
  }
  if (name === 'add_comment') {
    return result(await api(`/api/captures/${encodeURIComponent(a.captureId)}/comments`, {
      method: 'POST',
      body: { author: a.author || 'AI Agent', body: a.body, ts: a.ts }
    }));
  }
  if (name === 'create_issue') {
    return result(await api(`/api/captures/${encodeURIComponent(a.captureId)}/issues`, {
      method: 'POST',
      body: { provider: a.provider, options: a.options || {} }
    }));
  }
  if (name === 'export_har') {
    return result(await api(`/api/captures/${encodeURIComponent(a.captureId)}/har`));
  }
  if (name === 'generate_playwright') {
    return result(await api(`/api/captures/${encodeURIComponent(a.captureId)}/playwright`));
  }
  if (name === 'run_reproduction') {
    return result(await api(`/api/captures/${encodeURIComponent(a.captureId)}/reproduce`, {
      method: 'POST',
      body: { checkEndpoints: a.checkEndpoints !== false }
    }));
  }
  if (name === 'analyze_capture') {
    return result(await api(`/api/captures/${encodeURIComponent(a.captureId)}/analyze`, { method: 'POST', body: '{}' }));
  }
  if (name === 'delete_capture') {
    return result(await api(`/api/captures/${encodeURIComponent(a.captureId)}`, { method: 'DELETE' }));
  }

  const c = (await api(`/api/captures/${encodeURIComponent(a.captureId)}`)).capture;
  if (!c) throw new Error(`Capture not found: ${a.captureId}`);
  const events = Array.isArray(c.events) ? c.events : [];
  if (name === 'get_capture') return result(c);
  if (name === 'get_console_logs') return result(events.filter((e) => e.type === 'console'));
  if (name === 'get_network_requests') return result(events.filter((e) => e.type === 'network'));
  if (name === 'get_user_actions') return result(events.filter((e) => e.type === 'action'));

  throw new Error(`Unknown tool: ${name}`);
}

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const meta = params?._meta || {};
  const modern = method === 'server/discover' || meta['io.modelcontextprotocol/protocolVersion'] === '2026-07-28';
  const stamp = (res) => modern ? {
    ...res,
    _meta: {
      ...(res?._meta || {}),
      'io.modelcontextprotocol/serverInfo': { name: 'tracedeck', version: '0.1.0', description: 'TraceDeck debugging evidence tools' }
    }
  } : res;

  if (method === 'server/discover') {
    return {
      jsonrpc: '2.0',
      id,
      result: stamp({
        supportedVersions: ['2026-07-28', '2025-11-25'],
        capabilities: { tools: { listChanged: false } },
        instructions: 'Use TraceDeck tools to triage captures, inspect causal chains, file issues, and generate Playwright reproductions.',
        ttlMs: 300000,
        cacheScope: 'private'
      })
    };
  }
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params.protocolVersion || '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'tracedeck', version: '0.1.0' }
      }
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: stamp({ tools }) };
  if (method === 'tools/call') {
    try {
      return { jsonrpc: '2.0', id, result: stamp(await call(params.name, params.arguments || {})) };
    } catch (e) {
      return { jsonrpc: '2.0', id, result: stamp({ isError: true, content: [{ type: 'text', text: e.message }] }) };
    }
  }
  if (id !== undefined) return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  return null;
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    Promise.resolve()
      .then(() => handle(JSON.parse(line)))
      .then((r) => { if (r) process.stdout.write(JSON.stringify(r) + '\n'); })
      .catch((e) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: e.message } }) + '\n'));
  }
});
