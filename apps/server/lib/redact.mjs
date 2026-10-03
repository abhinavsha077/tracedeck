const SECRET_KEYS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|password|passwd|secret|access[-_]?token|refresh[-_]?token|credit[-_]?card|cvv)$/i;
const TOKENISH = /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/gi;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;

function redactString(value) {
  if (value.length > 200_000) return '[REDACTED: oversized value]';
  return value.replace(TOKENISH, '[REDACTED:TOKEN]').replace(CARD, '[REDACTED:CARD]');
}

export function redact(value, key = '') {
  if (SECRET_KEYS.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

export function redactEvents(events = []) {
  return events.slice(0, 100_000).map((event) => redact(event));
}
