#!/usr/bin/env node
import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const cmd = args.shift() || 'help';

function opt(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}

const base = (opt('--server', process.env.TRACEDECK_URL || 'http://localhost:4177')).replace(/\/$/, '');
const key = opt('--key', process.env.TRACEDECK_KEY || 'td_local_dev');

async function request(path, options = {}) {
  const r = await fetch(base + path, {
    ...options,
    headers: {
      'x-tracedeck-key': key,
      ...(options.headers || {})
    }
  });
  if (r.status === 204) return { ok: true, status: 204, json: async () => ({ success: true }) };
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 500)}`);
  return r;
}

async function json(path, options) {
  return (await request(path, options)).json();
}

async function main() {
  if (cmd === 'help') {
    console.log(`TraceDeck CLI

Commands:
  health
  list
  inspect <captureId>
  triage <captureId>
  reproduce <captureId> [--no-check]
  analyze <captureId>
  share <captureId>
  playwright <captureId> [--out file]
  har <captureId> [--out file]
  comment <captureId> <message>
  issue <captureId> <provider> [optionsJson]
  export <captureId> [--out file]
  mocks <captureId> [--format msw|fetch] [--out file]
  autofix <captureId>
  probe <captureId>
  drift <captureId>
  a11y <captureId>
  chaos <captureId> [--out file]
  lineage <captureId>
  audit <url> [--max 15]
  audits
  import <capture.json | file.trace.zip>
  delete <captureId>
  create <capture.json>

Options:
  --server URL       TraceDeck server (default http://localhost:4177)
  --key PROJECT_KEY  Project access key (default td_local_dev)`);
    return;
  }

  if (cmd === 'health') {
    console.log(JSON.stringify(await json('/api/health'), null, 2));
    return;
  }

  if (cmd === 'list') {
    console.log(JSON.stringify(await json('/api/captures'), null, 2));
    return;
  }

  if (cmd === 'audits') {
    console.log(JSON.stringify(await json('/api/audit'), null, 2));
    return;
  }

  if (cmd === 'audit') {
    const url = args[0];
    if (!url) throw new Error('Target URL required for audit. Run `node tools/cli/tracedeck.mjs help`.');
    const max = parseInt(opt('--max', '15'), 10);
    const r = await request('/api/audit/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, maxRoutes: max })
    });
    console.log(JSON.stringify(await r.json(), null, 2));
    return;
  }

  const id = args[0];
  const idCommands = ['inspect', 'triage', 'reproduce', 'analyze', 'share', 'playwright', 'har', 'comment', 'issue', 'delete', 'export', 'mocks', 'autofix', 'probe', 'drift', 'a11y', 'chaos', 'lineage'];
  if (idCommands.includes(cmd) && !id) {
    throw new Error(`Capture ID required for command '${cmd}'. Run 'node tools/cli/tracedeck.mjs help'.`);
  }

  if (cmd === 'inspect') {
    console.log(JSON.stringify((await json(`/api/captures/${encodeURIComponent(id)}`)).capture, null, 2));
    return;
  }

  if (cmd === 'triage') {
    console.log(JSON.stringify(await json(`/api/captures/${encodeURIComponent(id)}/triage`), null, 2));
    return;
  }

  if (cmd === 'reproduce') {
    const noCheck = args.includes('--no-check');
    console.log(JSON.stringify(await json(`/api/captures/${encodeURIComponent(id)}/reproduce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkEndpoints: !noCheck })
    }), null, 2));
    return;
  }

  if (cmd === 'analyze') {
    console.log(JSON.stringify(await json(`/api/captures/${encodeURIComponent(id)}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }), null, 2));
    return;
  }

  if (cmd === 'share') {
    console.log(JSON.stringify(await json(`/api/captures/${encodeURIComponent(id)}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }), null, 2));
    return;
  }

  if (cmd === 'playwright') {
    const out = opt('--out', `${id}.spec.ts`);
    await fs.writeFile(out, await (await request(`/api/captures/${encodeURIComponent(id)}/playwright`)).text());
    console.log(out);
    return;
  }

  if (cmd === 'har') {
    const out = opt('--out', `${id}.har`);
    await fs.writeFile(out, await (await request(`/api/captures/${encodeURIComponent(id)}/har`)).text());
    console.log(out);
    return;
  }

  if (cmd === 'comment') {
    const body = args[1] || '';
    if (!body) throw new Error('Comment message required');
    const r = await json(`/api/captures/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ author: 'CLI', body })
    });
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === 'issue') {
    const provider = args[1];
    let options = {};
    if (args[2]) {
      try { options = JSON.parse(args[2]); } catch { throw new Error('Options must be valid JSON'); }
    }
    const r = await json(`/api/captures/${encodeURIComponent(id)}/issues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, options })
    });
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === 'delete') {
    await request(`/api/captures/${encodeURIComponent(id)}`, { method: 'DELETE' });
    console.log(`Deleted capture ${id}`);
    return;
  }

  if (cmd === 'export') {
    const out = opt('--out', `${id}.trace.zip`);
    await fs.writeFile(out, Buffer.from(await (await request(`/api/captures/${encodeURIComponent(id)}/export`)).arrayBuffer()));
    console.log(out);
    return;
  }

  if (cmd === 'mocks') {
    const format = opt('--format', 'msw');
    const r = await request(`/api/captures/${encodeURIComponent(id)}/mocks?format=${encodeURIComponent(format)}`);
    const code = await r.text();
    const out = opt('--out', null);
    if (out) {
      await fs.writeFile(out, code, 'utf8');
      console.log(`Saved ${format} mocks to ${out}`);
    } else {
      console.log(code);
    }
    return;
  }

  if (cmd === 'autofix') {
    const r = await request(`/api/captures/${encodeURIComponent(id)}/auto-fix`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    console.log(JSON.stringify(await r.json(), null, 2));
    return;
  }

  if (cmd === 'probe') {
    const r = await request(`/api/captures/${encodeURIComponent(id)}/security-probe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    console.log(JSON.stringify(await r.json(), null, 2));
    return;
  }

  if (cmd === 'drift') {
    const contractFile = opt('--contract', null);
    let contracts = {};
    if (contractFile) {
      try {
        contracts = JSON.parse(await fs.readFile(contractFile, 'utf8'));
      } catch (err) {
        throw new Error(`Failed to read contract file: ${err.message}`);
      }
    }
    const r = await request(`/api/captures/${encodeURIComponent(id)}/schema-drift`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contracts })
    });
    console.log(JSON.stringify(await r.json(), null, 2));
    return;
  }

  if (cmd === 'a11y') {
    const htmlFile = opt('--html', null);
    let html = undefined;
    if (htmlFile) {
      html = await fs.readFile(htmlFile, 'utf8');
    }
    const r = await request(`/api/captures/${encodeURIComponent(id)}/a11y-tree`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(html ? { html } : {})
    });
    console.log(JSON.stringify(await r.json(), null, 2));
    return;
  }

  if (cmd === 'chaos') {
    const r = await request(`/api/captures/${encodeURIComponent(id)}/chaos`);
    const code = await r.text();
    const out = opt('--out', null);
    if (out) {
      await fs.writeFile(out, code, 'utf8');
      console.log(`Saved chaos reproduction spec to ${out}`);
    } else {
      console.log(code);
    }
    return;
  }

  if (cmd === 'lineage') {
    const r = await request(`/api/captures/${encodeURIComponent(id)}/lineage`);
    console.log(JSON.stringify(await r.json(), null, 2));
    return;
  }

  if (cmd === 'import') {
    const file = args[0];
    if (!file) throw new Error('File path required for import. Run `node tools/cli/tracedeck.mjs help`.');
    const zip = /\.(trace\.)?zip$/i.test(file);
    const body = await fs.readFile(file);
    const r = await request('/api/captures/import', {
      method: 'POST',
      headers: { 'content-type': zip ? 'application/zip' : 'application/json' },
      body: zip ? body : body.toString('utf8')
    });
    console.log(JSON.stringify(await r.json(), null, 2));
    return;
  }

  if (cmd === 'create') {
    const file = args[0];
    if (!file) throw new Error('File path required for create. Run `node tools/cli/tracedeck.mjs help`.');
    const content = await fs.readFile(file, 'utf8');
    const r = await request('/api/captures', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: content
    });
    console.log(JSON.stringify(await r.json(), null, 2));
    return;
  }

  throw new Error('Unknown command. Run `node tools/cli/tracedeck.mjs help`.');
}

main().catch((e) => {
  console.error('TraceDeck CLI:', e.message);
  process.exitCode = 1;
});
