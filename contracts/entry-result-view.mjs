/** Wire relationships only. Does not prove Store ownership, privacy or historical provenance. */
import { createHash } from 'node:crypto';

export function canonical(value) {
  const encode = (v, depth = 0) => {
    if (depth > 64) throw Error('JSON depth limit');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw Error('Non-finite JSON number');
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, i)) throw Error('Sparse JSON array');
      return '[' + v.map(x => encode(x, depth + 1)).join(',') + ']';
    }
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype)
      return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + encode(v[k], depth + 1)).join(',') + '}';
    throw Error('Not a JSON value');
  };
  return encode(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const bytes = value => Buffer.byteLength(canonical(value), 'utf8');
/** Apply before recursive JSON Schema validation as well as before accepting a response. */
export function assertWireBudget(value) {
  if (bytes(value) > 524288) throw Error('Response read limit');
}
export function seal(body) {
  if (Object.hasOwn(body, 'readStamp')) throw Error('Already sealed');
  return { ...body, readStamp: digest(body) };
}

function pointerExists(value, path) {
  if (path === '') return true;
  if (!/^(?:\/(?:[^~/]|~[01])*)*$/.test(path)) return false;
  for (const token of path.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(token)) return false;
    if (!Object.hasOwn(value, token)) return false;
    value = value[token];
  }
  return true;
}

/** Call after JSON Schema validation; proves only wire relationships, not real source ownership. */
export function verify(response, expectedRun, expectedSource) {
  const { readStamp, ...body } = response;
  assertWireBudget(response);
  if (digest(body) !== readStamp) throw Error('Read fingerprint mismatch');
  if (canonical(response.run) !== canonical(expectedRun)) throw Error('Run identity or state changed');
  if (expectedSource && response.viewStatus === 'not-applicable') throw Error('Known source cannot become not-applicable');
  if (response.source) {
    const s = response.source;
    if (expectedSource && canonical(s) !== canonical(expectedSource)) throw Error('Fixed source mismatch');
    if (s.kind === 'template') {
      if (s.packageKey !== s.templateId + '@' + s.templateVersion) throw Error('Package key mismatch');
      if (s.schemaPath.split('/').some(s => !s || s === '.' || s === '..')) throw Error('Unsafe schema path');
      if (/(^|\/)node_modules(\/|$)/i.test(s.schemaPath) || /\.(node|exe|dll|dylib|so|app|dmg)$/i.test(s.schemaPath))
        throw Error('Forbidden package resource path');
    } else if (s.kind === 'author-checkout' && s.flowId !== response.run.flowId)
      throw Error('Author flow mismatch');
  }
  if (response.viewStatus === 'available') {
    if (!Object.hasOwn(response, 'value')) throw Error('Missing result property');
    if (bytes(response.value) !== response.valueBytes || digest(response.value) !== response.valueSha256)
      throw Error('Delivered value integrity mismatch');
    const seen = new Set();
    for (const label of response.labels) {
      if (seen.has(label.path) || !pointerExists(response.value, label.path)) throw Error('Invalid label target');
      seen.add(label.path);
    }
  }
  return response;
}
