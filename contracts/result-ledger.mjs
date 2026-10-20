/** Pure metadata/accounting reference; no Store identity or execution authority. */
import { canonical, digest, inspect, merge, LIMITS } from './result-retention.mjs';

export const rawFamilies = Object.freeze([
  'state-operation', 'effect-operation', 'entry-result', 'entry-display', 'entry-reuse',
  'browser-input-proof', 'document-source-proof', 'typed-result-record', 'typed-result-index',
  'ai-receipt', 'run-output',
]);
const types = new Set(['document', 'skill', 'context', 'conversation', 'browser', 'run-result',
  'source', 'source-reduce', 'effect']);
const bytes = (value) => Buffer.byteLength(canonical(value), 'utf8');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (reason) => { throw Error(reason); };
const key = (row) => row.family + ':' + row.id;
const ordered = (a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

function fields(value, expected) {
  // Validate JSON data properties before reading them. Does not accept executable object adapters.
  canonical(value);
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) fail('ledger fields');
}
function text(value, limit, empty = false) {
  if (typeof value !== 'string' || (!empty && !value) || [...value].length > limit ||
      [...value].some((c) => { const n = c.codePointAt(0); return n >= 0xd800 && n <= 0xdfff; }))
    fail('ledger text');
}
function owner(value) {
  fields(value, ['runId', 'flowId', 'versionId', 'snapshotSha256']);
  text(value.runId, 100); text(value.flowId, 100);
  if (!hash(value.versionId) || !hash(value.snapshotSha256)) fail('ledger owner digest');
}
function copyIdentity(family, id) {
  if (!rawFamilies.includes(family) || !hash(id)) fail('raw copy identity');
}
function meta(row) {
  fields(row, ['id', 'nodeId', 'nodeInstance', 'type', 'label', 'bytes', 'sha256']);
  text(row.nodeId, 1000); text(row.nodeInstance, 4000); text(row.label, 2000, true);
  if (!hash(row.id) || !hash(row.sha256) || !types.has(row.type) ||
      !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > LIMITS.value)
    fail('logical result metadata');
}

export function createLedger(expectedOwner) {
  owner(expectedOwner);
  const result = { version: 1, policy: 'run-owned-results-v1', owner: structuredClone(expectedOwner),
    revision: 0, values: { version: 1, runId: expectedOwner.runId, roots: [], cells: [] },
    results: [], copies: [] };
  inspectLedger(result, expectedOwner);
  return result;
}

/** Declared accounting only; actual rows additionally require verifyCopies and host ownership checks. */
export function inspectLedger(ledger, expectedOwner) {
  fields(ledger, ['version', 'policy', 'owner', 'revision', 'values', 'results', 'copies']);
  owner(ledger.owner); owner(expectedOwner);
  if (ledger.version !== 1 || ledger.policy !== 'run-owned-results-v1' ||
      canonical(ledger.owner) !== canonical(expectedOwner) || !Number.isSafeInteger(ledger.revision) ||
      ledger.revision < 0 || ledger.revision >= Number.MAX_SAFE_INTEGER ||
      !Array.isArray(ledger.results) || ledger.results.length > LIMITS.roots ||
      !Array.isArray(ledger.copies) || ledger.copies.length > 8192) fail('ledger scope or limit');
  const valueInfo = inspect(ledger.values, expectedOwner.runId);
  const roots = new Map(ledger.values.roots.map((r) => [r.resultId, r]));
  const ids = new Set();
  for (const row of ledger.results) {
    meta(row);
    const root = roots.get(row.id);
    if (ids.has(row.id) || !root || root.sha256 !== row.sha256 || root.bytes !== row.bytes)
      fail('result index and complete root differ');
    ids.add(row.id);
  }
  if (ids.size !== roots.size) fail('unindexed complete root');
  let previous = '', copyBytes = 0;
  for (const row of ledger.copies) {
    fields(row, ['family', 'id', 'sha256', 'bytes']);
    copyIdentity(row.family, row.id);
    if (key(row) <= previous || !hash(row.sha256) || !Number.isSafeInteger(row.bytes) ||
        row.bytes < 1 || row.bytes > LIMITS.retained) fail('raw copy order, digest or size');
    previous = key(row);
    copyBytes += row.bytes;
    if (copyBytes > LIMITS.retained) fail('raw copy budget');
  }
  const catalogBytes = bytes(ledger), retainedBytes = catalogBytes + copyBytes;
  if (retainedBytes > LIMITS.retained) fail('complete result and raw copy budget');
  return { count: ledger.results.length, logicalBytes: valueInfo.logicalBytes,
    catalogBytes, copyBytes, retainedBytes, copyCount: ledger.copies.length };
}

export function rawCharge(family, id, value) {
  copyIdentity(family, id);
  const size = bytes(value);
  if (size < 1 || size > LIMITS.retained) fail('raw copy size');
  return { family, id, sha256: digest(value), bytes: size };
}

/** Inputs must be captured from authenticated, owner-scoped actual rows in one stable host view. */
export function verifyCopies(ledger, expectedOwner, actual) {
  const result = inspectLedger(ledger, expectedOwner);
  if (!Array.isArray(actual) || actual.length !== ledger.copies.length) fail('actual copy inventory');
  const expected = new Map(ledger.copies.map((r) => [key(r), r])), seen = new Set();
  for (const row of actual) {
    fields(row, ['family', 'id', 'value']);
    const charge = rawCharge(row.family, row.id, row.value), id = key(charge);
    if (seen.has(id) || !expected.has(id) || canonical(charge) !== canonical(expected.get(id)))
      fail('actual retained copy changed or missing');
    seen.add(id);
  }
  return result;
}

/** Proposal only. A producer must persist rows, roots/index and this revision in the same transaction. */
export function propose(ledger, expectedOwner, expectedRevision, change) {
  inspectLedger(ledger, expectedOwner);
  fields(change, ['values', 'results', 'copies']);
  if (ledger.revision !== expectedRevision || expectedRevision >= Number.MAX_SAFE_INTEGER - 1 ||
      !Array.isArray(change.results) || change.results.length > LIMITS.roots ||
      !Array.isArray(change.copies) || change.copies.length > 8192) fail('ledger revision or proposal');
  const values = change.values === null ? ledger.values : merge(ledger.values, change.values);
  const results = [...ledger.results], entries = new Map(results.map((r) => [r.id, r]));
  for (const row of change.results) {
    meta(row);
    const old = entries.get(row.id);
    if (old && canonical(old) !== canonical(row)) fail('logical metadata identity conflict');
    if (!old) { results.push(structuredClone(row)); entries.set(row.id, row); }
  }
  const copies = new Map(ledger.copies.map((r) => [key(r), r])), changed = new Set();
  for (const row of change.copies) {
    fields(row, ['family', 'id', 'before', 'value']);
    const charge = rawCharge(row.family, row.id, row.value), id = key(charge), old = copies.get(id);
    if (changed.has(id) || (old ? old.sha256 !== row.before : row.before !== null))
      fail('raw copy compare-and-swap conflict');
    changed.add(id); copies.set(id, charge);
  }
  const result = { ...ledger, revision: ledger.revision + 1, values, results,
    copies: [...copies.values()].sort(ordered) };
  if (canonical({ ...result, revision: ledger.revision }) === canonical(ledger))
    return structuredClone(ledger);
  inspectLedger(result, expectedOwner);
  return structuredClone(result);
}
