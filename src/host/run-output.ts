import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import Ajv from 'ajv/dist/2020.js';
import schema from '../../contracts/run-output-packed.schema.json';
import type { Store } from './store';

const KIND = 'run-output-packed';
const MAX_STORED = 8 * 1048576;
const MAX_EXPANDED = 64 * 1048576;
const validateRecord = new Ajv({ strict: true }).compile(schema);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Linear JSON byte accounting: never charge a subtree again for each ancestor. */
function expandedBytes(value: unknown) {
  let bytes = 0,
    visits = 0;
  const active = new Set<object>();
  const charge = (size: number) => {
    bytes += size;
    if (bytes > MAX_EXPANDED) throw Error('完整运行汇总展开后超过64 MiB');
  };
  const visit = (v: any, depth: number) => {
    if (++visits > 1048576 || depth > 64) throw Error('完整运行汇总结构超限');
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      charge(Buffer.byteLength(JSON.stringify(v)));
      return;
    }
    if (!v || typeof v !== 'object' || active.has(v)) throw Error('运行汇总不是有限JSON');
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype))
      throw Error('运行汇总必须使用纯JSON对象');
    const keys = Reflect.ownKeys(v);
    if (array && (keys.length !== v.length + 1 || Object.keys(v).some((k, i) => k !== String(i))))
      throw Error('运行汇总数组不完整');
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (
        typeof key !== 'string' ||
        !Object.hasOwn(d, 'value') ||
        (!d.enumerable && !(array && key === 'length'))
      )
        throw Error('运行汇总包含非JSON属性');
    }
    active.add(v);
    charge(2);
    const names = Object.keys(v);
    for (let i = 0; i < names.length; i++) {
      if (i) charge(1);
      const key = names[i];
      if (!array) charge(Buffer.byteLength(JSON.stringify(key)) + 1);
      visit(v[key], depth + 1);
    }
    active.delete(v);
  };
  visit(value, 0);
  return bytes;
}

type Packed = {
  version: 1;
  encoding: 'deflate-raw-json-v1';
  runId: string;
  expandedBytes: number;
  sha256: string;
  data: string;
};
function assertRecord(value: unknown, runId: string): asserts value is Packed {
  if (
    !validateRecord(value) ||
    (value as Packed).runId !== runId ||
    Buffer.byteLength(JSON.stringify(value)) > MAX_STORED
  )
    throw Error('完整运行汇总的压缩记录无效或超过8 MiB');
}

export function saveRunOutput(store: Store, runId: string, value: unknown) {
  if (!store.resultLedgers.owned(runId)) return store.put('output', runId, value);
  if (store.get('output', runId) !== undefined || store.get(KIND, runId) !== undefined)
    throw Error('此运行已有整体输出，不能覆盖');
  const expectedBytes = expandedBytes(value);
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.length !== expectedBytes) throw Error('完整运行汇总的JSON计量不一致');
  const record: Packed = {
    version: 1,
    encoding: 'deflate-raw-json-v1',
    runId,
    expandedBytes: bytes.length,
    sha256: sha256(bytes),
    data: deflateRawSync(bytes).toString('base64'),
  };
  assertRecord(record, runId);
  // The ledger charges this entire row, including Base64, within the existing Run budget.
  store.put(KIND, runId, record);
}

export function readRunOutput(store: Store, runId: string) {
  const packed = store.get(KIND, runId),
    raw = store.get('output', runId);
  if (packed === undefined) return raw;
  if (raw !== undefined || !store.resultLedgers.owned(runId))
    throw Error('完整运行汇总的存储来源不一致');
  assertRecord(packed, runId);
  const compressed = Buffer.from(packed.data, 'base64');
  if (compressed.toString('base64') !== packed.data) throw Error('运行汇总编码无效');
  const bytes = inflateRawSync(compressed, { maxOutputLength: packed.expandedBytes });
  if (bytes.length !== packed.expandedBytes || sha256(bytes) !== packed.sha256)
    throw Error('完整运行汇总长度或摘要不一致');
  const text = bytes.toString('utf8'),
    value = JSON.parse(text);
  if (JSON.stringify(value) !== text || expandedBytes(value) !== bytes.length)
    throw Error('完整运行汇总无法无损还原');
  return value;
}
