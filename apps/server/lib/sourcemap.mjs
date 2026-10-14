// Zero-dependency Source Map v3 parser and stack trace symbolicator
// Unminifies production stack traces and extracts code context frames

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_MAP = new Int8Array(128).fill(-1);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_MAP[B64_CHARS.charCodeAt(i)] = i;
}

export function decodeVlq(str) {
  const result = [];
  let shift = 0;
  let value = 0;

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const digit = code < 128 ? B64_MAP[code] : -1;
    if (digit === -1) continue;

    const continuation = Boolean(digit & 32);
    value += (digit & 31) << shift;

    if (continuation) {
      shift += 5;
    } else {
      const isNegative = Boolean(value & 1);
      const decoded = (value >> 1) * (isNegative ? -1 : 1);
      result.push(decoded);
      value = 0;
      shift = 0;
    }
  }

  return result;
}

export class SourceMapConsumer {
  constructor(rawMap) {
    this.map = typeof rawMap === 'string' ? JSON.parse(rawMap) : rawMap;
    this.sources = this.map.sources || [];
    this.sourcesContent = this.map.sourcesContent || [];
    this.names = this.map.names || [];
    this._lines = this._parseMappings(this.map.mappings || '');
  }

  _parseMappings(mappingsStr) {
    const lines = [];
    const rawLines = mappingsStr.split(';');

    let prevSourceIdx = 0;
    let prevOrigLine = 0;
    let prevOrigCol = 0;
    let prevNameIdx = 0;

    for (const rawLine of rawLines) {
      const segments = [];
      let prevGenCol = 0;

      for (const rawSeg of rawLine.split(',')) {
        if (!rawSeg) continue;
        const decoded = decodeVlq(rawSeg);
        if (decoded.length === 0) continue;

        prevGenCol += decoded[0];
        const seg = { genCol: prevGenCol };

        if (decoded.length >= 4) {
          prevSourceIdx += decoded[1];
          prevOrigLine += decoded[2];
          prevOrigCol += decoded[3];
          seg.sourceIdx = prevSourceIdx;
          seg.origLine = prevOrigLine;
          seg.origCol = prevOrigCol;
        }

        if (decoded.length >= 5) {
          prevNameIdx += decoded[4];
          seg.nameIdx = prevNameIdx;
        }

        segments.push(seg);
      }

      lines.push(segments);
    }

    return lines;
  }

  originalPositionFor(genLine, genCol) {
    // genLine is 1-indexed, genCol is 0-indexed
    const lineSegments = this._lines[genLine - 1];
    if (!lineSegments || lineSegments.length === 0) return null;

    // Find segment with largest genCol <= target genCol
    let match = null;
    for (const seg of lineSegments) {
      if (seg.genCol <= genCol) {
        match = seg;
      } else {
        break;
      }
    }

    if (!match || match.sourceIdx === undefined) return null;

    const source = this.sources[match.sourceIdx] || null;
    const name = match.nameIdx !== undefined ? this.names[match.nameIdx] : null;
    const origLine = match.origLine + 1; // Convert to 1-indexed
    const origCol = match.origCol;

    let codeFrame = null;
    const content = this.sourcesContent[match.sourceIdx];
    if (content) {
      const allLines = content.split('\n');
      const start = Math.max(0, origLine - 3);
      const end = Math.min(allLines.length, origLine + 2);
      codeFrame = allLines.slice(start, end).map((l, idx) => {
        const lineNo = start + idx + 1;
        const pointer = lineNo === origLine ? ' > ' : '   ';
        return `${pointer}${lineNo} | ${l}`;
      }).join('\n');
    }

    return {
      source,
      line: origLine,
      column: origCol,
      name,
      codeFrame
    };
  }
}

export function symbolicateStackTrace(stackStr, sourceMapConsumer) {
  if (!stackStr) return stackStr;
  const lines = stackStr.split('\n');
  const frameRegex = /^(.*?\bat\s+(?:(.*?)\s+\()?)?(?:https?:\/\/[^/]+)?([^:\s]+):(\d+):(\d+)\)?$/;

  const symbolicatedLines = lines.map(line => {
    const match = line.match(frameRegex);
    if (!match) return line;

    const prefix = match[1] || '    at ';
    const funcName = match[2] || '';
    const file = match[3];
    const genLine = parseInt(match[4], 10);
    const genCol = parseInt(match[5], 10);

    const orig = sourceMapConsumer.originalPositionFor(genLine, genCol);
    if (!orig || !orig.source) return line;

    const resolvedName = orig.name || funcName || '<anonymous>';
    return `    at ${resolvedName} (${orig.source}:${orig.line}:${orig.column})`;
  });

  return symbolicatedLines.join('\n');
}
