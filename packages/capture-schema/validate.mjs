/**
 * Zero-dependency validator for CaptureBundleV1 documents.
 * Validates against packages/capture-schema/capture-bundle.schema.json.
 */

const ALLOWED_SOURCES = new Set(['extension', 'recording-link', 'sdk', 'cli', 'api', 'import']);

export function validateCaptureBundle(bundle) {
  const errors = [];

  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { valid: false, errors: ['Bundle must be a non-null JSON object'] };
  }

  // schemaVersion
  if (bundle.schemaVersion !== '1.0') {
    errors.push(`schemaVersion must be exactly "1.0", received: ${JSON.stringify(bundle.schemaVersion)}`);
  }

  // capture
  if (!bundle.capture || typeof bundle.capture !== 'object' || Array.isArray(bundle.capture)) {
    errors.push('Property "capture" is required and must be an object');
  } else {
    if (typeof bundle.capture.title !== 'string' || bundle.capture.title.trim().length === 0) {
      errors.push('capture.title is required and must be a non-empty string');
    }
    if (bundle.capture.source !== undefined && !ALLOWED_SOURCES.has(bundle.capture.source)) {
      errors.push(`capture.source must be one of: ${Array.from(ALLOWED_SOURCES).join(', ')}`);
    }
    if (bundle.capture.durationMs !== undefined) {
      if (typeof bundle.capture.durationMs !== 'number' || Number.isNaN(bundle.capture.durationMs) || bundle.capture.durationMs < 0) {
        errors.push('capture.durationMs must be a non-negative number');
      }
    }
  }

  // events
  if (!Array.isArray(bundle.events)) {
    errors.push('Property "events" is required and must be an array');
  } else {
    for (let i = 0; i < bundle.events.length; i++) {
      const ev = bundle.events[i];
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
        errors.push(`events[${i}] must be an object`);
        continue;
      }
      if (typeof ev.type !== 'string' || !ev.type) {
        errors.push(`events[${i}].type is required and must be a string`);
      }
      if (typeof ev.ts !== 'number' || Number.isNaN(ev.ts) || ev.ts < 0) {
        errors.push(`events[${i}].ts is required and must be a non-negative number`);
      }
    }
  }

  // artifacts
  if (bundle.artifacts !== undefined) {
    if (!Array.isArray(bundle.artifacts)) {
      errors.push('Property "artifacts" must be an array if present');
    } else {
      for (let i = 0; i < bundle.artifacts.length; i++) {
        const art = bundle.artifacts[i];
        if (!art || typeof art !== 'object' || Array.isArray(art)) {
          errors.push(`artifacts[${i}] must be an object`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
