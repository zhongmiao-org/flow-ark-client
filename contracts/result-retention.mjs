/** Pure in-memory codec. Never grants execution or proves stored provenance. */
import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({
  roots: 1000, cells: 16384, value: 8388608, retained: 8388608,
  leaf: 4096, cell: 16384, fanout: 32, jsonDepth: 64, graphDepth: 256,
  visits: 262144, workBytes: 128 * 1048576,
});
const utf8 = (s) => Buffer.byteLength(s, 'utf8');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const isHash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const fail = (message) => { throw Error(message); };
const indexKey = (key) => /^(0|[1-9][0-9]{0,9})$/.test(key) && Number(key) < 4294967295;
const keyOrder = (a, b) => indexKey(a) && indexKey(b) ? Number(a) - Number(b)
  : indexKey(a) ? -1 : indexKey(b) ? 1 : a < b ? -1 : a > b ? 1 : 0;

function plain(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('plain JSON object required');
  const names = Reflect.ownKeys(value);
  if (names.length > LIMITS.visits) fail('JSON member limit');
  for (const key of names) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !d?.enumerable || !Object.hasOwn(d, 'value'))
      fail('JSON data properties required');
  }
  return names;
}

/** Mirrors the current client's sort-then-JSON serialization, including array-index key order. */
export function canonical(value) {
  let visits = 0, work = 0;
  const active = new Set();
  const encode = (v, depth) => {
    if (++visits > LIMITS.visits || depth > LIMITS.jsonDepth) fail('JSON traversal limit');
    let text;
    if (v === null || typeof v === 'boolean') text = JSON.stringify(v);
    else if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('finite JSON number required');
      text = JSON.stringify(v);
    } else if (typeof v === 'string') {
      if (v.length > LIMITS.retained) fail('JSON text limit');
      text = JSON.stringify(v);
    } else {
      if (active.has(v)) fail('JSON cycle');
      active.add(v);
      if (Array.isArray(v)) {
        if (Object.getPrototypeOf(v) !== Array.prototype || v.length > LIMITS.visits ||
            Reflect.ownKeys(v).length !== v.length + 1) fail('dense plain JSON array required');
        const items = [];
        for (let i = 0; i < v.length; i++) {
          const d = Object.getOwnPropertyDescriptor(v, String(i));
          if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('dense JSON data array required');
          items.push(encode(d.value, depth + 1));
        }
        text = '[' + items.join(',') + ']';
      } else {
        const names = plain(v).sort(keyOrder);
        text = '{' + names.map((k) => JSON.stringify(k) + ':' + encode(v[k], depth + 1)).join(',') + '}';
      }
      active.delete(v);
    }
    const size = utf8(text);
    work += size;
    if (size > LIMITS.retained || work > LIMITS.workBytes) fail('JSON byte limit');
    return text;
  };
  return encode(value, 0);
}
export const digest = (value) => hash(canonical(value));
export const cellId = (cell) => hash('flowark-result-cell-v1\0' + canonical(cell));

function exact(value, names) {
  const actual = plain(value).sort();
  if (actual.join('\0') !== [...names].sort().join('\0')) fail('record fields');
}
function runName(runId) {
  if (typeof runId !== 'string' || !runId || [...runId].length > 100 ||
      [...runId].some((c) => { const n = c.codePointAt(0); return n >= 0xd800 && n <= 0xdfff; }))
    fail('run identity');
}
function references(cell) {
  switch (cell.kind) {
    case 'json': case 'bytes': return [];
    case 'text': return [cell.body];
    case 'members': return cell.entries.flatMap((e) => [e.key, e.value]);
    default: return cell.parts;
  }
}
function checkCell(cell) {
  plain(cell);
  const kind = cell.kind;
  if (kind === 'json') {
    exact(cell, ['kind', 'text']);
    if (typeof cell.text !== 'string' || !cell.text || utf8(cell.text) > LIMITS.leaf ||
        canonical(JSON.parse(cell.text)) !== cell.text) fail('canonical JSON leaf');
  } else if (kind === 'bytes') {
    exact(cell, ['kind', 'data']);
    if (typeof cell.data !== 'string' || cell.data.length > 5464) fail('byte leaf size');
    const b = Buffer.from(cell.data, 'base64');
    if (!b.length || b.length > LIMITS.leaf || b.toString('base64') !== cell.data) fail('canonical base64');
  } else if (kind === 'text') {
    exact(cell, ['kind', 'body']);
    if (!isHash(cell.body)) fail('text body reference');
  } else if (kind === 'members') {
    exact(cell, ['kind', 'entries']);
    if (!Array.isArray(cell.entries) || !cell.entries.length || cell.entries.length > LIMITS.fanout)
      fail('member fanout');
    for (const entry of cell.entries) {
      exact(entry, ['key', 'value']);
      if (!isHash(entry.key) || !isHash(entry.value)) fail('member references');
    }
  } else if (['concat', 'list', 'array', 'object'].includes(kind)) {
    exact(cell, ['kind', 'parts']);
    if (!Array.isArray(cell.parts) || !cell.parts.length || cell.parts.length > LIMITS.fanout ||
        cell.parts.some((id) => !isHash(id))) fail('reference fanout');
  } else fail('cell kind');
  if (utf8(canonical(cell)) > LIMITS.cell) fail('cell byte limit');
}

/** Metadata/graph verification only. A requested full root still requires read(). */
export function inspect(set, expectedRunId) {
  exact(set, ['version', 'runId', 'roots', 'cells']);
  runName(set.runId);
  if (set.version !== 1 || set.runId !== expectedRunId || !Array.isArray(set.roots) ||
      !Array.isArray(set.cells) || set.roots.length > LIMITS.roots || set.cells.length > LIMITS.cells)
    fail('retention scope or count');
  const map = new Map(), rootIds = new Set();
  let previous = '', logicalBytes = 0, retainedFloor = 0;
  for (const row of set.cells) {
    exact(row, ['id', 'cell']);
    if (!isHash(row.id) || row.id <= previous) fail('cell ordering or duplicate');
    checkCell(row.cell);
    if (row.id !== cellId(row.cell)) fail('cell digest');
    retainedFloor += utf8(canonical(row));
    if (retainedFloor > LIMITS.retained) fail('retained byte limit');
    previous = row.id;
    map.set(row.id, row.cell);
  }
  previous = '';
  for (const root of set.roots) {
    exact(root, ['resultId', 'root', 'sha256', 'bytes']);
    if (!isHash(root.resultId) || root.resultId <= previous || !isHash(root.root) ||
        !isHash(root.sha256) || !Number.isSafeInteger(root.bytes) || root.bytes < 1 ||
        root.bytes > LIMITS.value) fail('root identity, ordering or size');
    previous = root.resultId;
    rootIds.add(root.root);
    logicalBytes += root.bytes;
  }
  const seen = new Set(), active = new Set(), height = new Map();
  let edges = 0;
  const walk = (id, depth = 1) => {
    if (depth > LIMITS.graphDepth) fail('content depth');
    if (active.has(id)) fail('content cycle');
    if (height.has(id)) {
      if (depth + height.get(id) - 1 > LIMITS.graphDepth) fail('content depth');
      return height.get(id);
    }
    const c = map.get(id);
    if (!c) fail('missing content');
    active.add(id); seen.add(id);
    let h = 1;
    for (const ref of references(c)) {
      if (++edges > LIMITS.cells * LIMITS.fanout * 2) fail('graph work limit');
      const child = map.get(ref);
      if (!child) fail('missing referenced content');
      if ((c.kind === 'concat' || c.kind === 'text') && !['bytes', 'concat'].includes(child.kind))
        fail('byte reference role');
      if (c.kind === 'array' && !['list', 'array'].includes(child.kind)) fail('array reference role');
      if (c.kind === 'object' && !['members', 'object'].includes(child.kind)) fail('object reference role');
      if ((c.kind === 'list' || c.kind === 'members') && ['bytes', 'concat'].includes(child.kind))
        fail('value reference role');
      h = Math.max(h, 1 + walk(ref, depth + 1));
      if (h > LIMITS.graphDepth) fail('content depth');
    }
    active.delete(id); height.set(id, h); return h;
  };
  for (const id of rootIds) {
    if (['bytes', 'concat'].includes(map.get(id)?.kind)) fail('root reference role');
    walk(id);
  }
  if (seen.size !== map.size) fail('unowned or unreachable content');
  const retainedBytes = utf8(canonical(set));
  if (retainedBytes > LIMITS.retained) fail('retained byte limit');
  return { count: set.roots.length, cells: map.size, logicalBytes, retainedBytes };
}

export function encode(value, runId, resultId) {
  runName(runId);
  if (!isHash(resultId)) fail('logical result identity');
  const text = canonical(value);
  if (utf8(text) > LIMITS.value) fail('complete value byte limit');
  const cells = new Map();
  const put = (cell) => {
    checkCell(cell);
    const id = cellId(cell);
    if (cells.has(id) && canonical(cells.get(id)) !== canonical(cell)) fail('cell collision');
    cells.set(id, cell);
    if (cells.size > LIMITS.cells) fail('unique cell limit');
    return id;
  };
  const groups = (items, leaf, branch) => {
    let refs = [];
    for (let i = 0; i < items.length; i += LIMITS.fanout) {
      const part = items.slice(i, i + LIMITS.fanout);
      refs.push(put(leaf === 'members' ? { kind: leaf, entries: part } : { kind: leaf, parts: part }));
    }
    while (refs.length > 1) {
      const next = [];
      for (let i = 0; i < refs.length; i += LIMITS.fanout)
        next.push(put({ kind: branch, parts: refs.slice(i, i + LIMITS.fanout) }));
      refs = next;
    }
    return refs[0];
  };
  const pack = (v) => {
    const json = canonical(v);
    if (utf8(json) <= LIMITS.leaf) return put({ kind: 'json', text: json });
    if (typeof v === 'string') {
      const b = Buffer.from(json, 'utf8'), refs = [];
      for (let i = 0; i < b.length; i += LIMITS.leaf)
        refs.push(put({ kind: 'bytes', data: b.subarray(i, i + LIMITS.leaf).toString('base64') }));
      return put({ kind: 'text', body: refs.length === 1 ? refs[0] : groups(refs, 'concat', 'concat') });
    }
    if (Array.isArray(v)) return groups(v.map(pack), 'list', 'array');
    return groups(Object.keys(v).sort(keyOrder).map((key) => ({ key: pack(key), value: pack(v[key]) })),
      'members', 'object');
  };
  const root = { resultId, root: pack(value), sha256: hash(text), bytes: utf8(text) };
  const set = { version: 1, runId, roots: [root],
    cells: [...cells].sort(([a], [b]) => a < b ? -1 : 1).map(([id, cell]) => ({ id, cell })) };
  inspect(set, runId);
  return set;
}

export function read(set, expectedRunId, resultId) {
  inspect(set, expectedRunId);
  const root = set.roots.find((r) => r.resultId === resultId);
  if (!root) fail('root not registered');
  const cells = new Map(set.cells.map((r) => [r.id, r.cell]));
  let visits = 0, work = 0;
  const charge = (size) => {
    work += size;
    if (++visits > LIMITS.visits || size > LIMITS.value || work > LIMITS.workBytes)
      fail('complete reconstruction work limit');
  };
  const bytes = (id) => {
    const c = cells.get(id);
    const b = c.kind === 'bytes' ? Buffer.from(c.data, 'base64') : Buffer.concat(c.parts.map(bytes));
    charge(b.length); return b;
  };
  const valueText = (id) => {
    const c = cells.get(id);
    let text;
    if (c.kind === 'json') text = c.text;
    else if (c.kind === 'text') {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes(c.body));
      if (typeof JSON.parse(text) !== 'string') fail('string reconstruction');
    } else if (c.kind === 'list') text = '[' + c.parts.map(valueText).join(',') + ']';
    else if (c.kind === 'array') text = '[' + c.parts.map(valueText).map((s) => s.slice(1, -1)).join(',') + ']';
    else if (c.kind === 'members') {
      const members = c.entries.map((e) => {
        const key = valueText(e.key);
        if (typeof JSON.parse(key) !== 'string') fail('object member key');
        return key + ':' + valueText(e.value);
      });
      text = '{' + members.join(',') + '}';
    } else if (c.kind === 'object') text = '{' + c.parts.map(valueText).map((s) => s.slice(1, -1)).join(',') + '}';
    else fail('not a JSON value cell');
    charge(utf8(text)); return text;
  };
  const text = valueText(root.root);
  if (utf8(text) !== root.bytes || hash(text) !== root.sha256) fail('complete root integrity');
  const value = JSON.parse(text);
  if (canonical(value) !== text) fail('noncanonical reconstructed value');
  const expected = encode(value, expectedRunId, resultId);
  if (canonical(expected.roots[0]) !== canonical(root)) fail('noncanonical content partition');
  for (const row of expected.cells)
    if (canonical(row.cell) !== canonical(cells.get(row.id))) fail('re-encoded content mismatch');
  // inspect() authenticated every content record. Re-encoding the root authenticates its exact partition.
  return value;
}

export function merge(saved, candidate) {
  inspect(saved, saved.runId); inspect(candidate, saved.runId);
  const union = (a, b, field) => {
    const map = new Map(a.map((r) => [r[field], r]));
    for (const row of b) {
      const old = map.get(row[field]);
      if (old && canonical(old) !== canonical(row)) fail('retained identity conflict');
      map.set(row[field], row);
    }
    return [...map.values()].sort((a, b) => a[field] < b[field] ? -1 : 1);
  };
  const result = { version: 1, runId: saved.runId,
    roots: union(saved.roots, candidate.roots, 'resultId'), cells: union(saved.cells, candidate.cells, 'id') };
  inspect(result, saved.runId);
  return result;
}
