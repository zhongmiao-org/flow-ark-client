/** Pure compatibility and receipt reference. The host still owns authorization and transactions. */
import { createHash } from 'node:crypto';

export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  throw Error('Expected finite JSON');
}
export function digest(value) { return createHash('sha256').update(canonical(value), 'utf8').digest('hex'); }
const equal = (a, b) => canonical(a) === canonical(b);
const packageRef = m => ({ id: m.id, version: m.version, digest: m.contentDigest });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const logical = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,99}$/.test(value);
const unique = a => new Set(a).size === a.length;
const prefix = (before, after) => after.length >= before.length && before.every((value, i) => equal(value, after[i]));
const assert = (value, message) => { if (!value) throw Error(message); };

/** Both packages must first pass the unchanged full standard-package validator. */
export function deriveExtension(base, extension) {
  const a = base.manifest, b = extension.manifest;
  assert(a.id === b.id && a.version !== b.version && a.contentDigest !== b.contentDigest, 'Extension package identity must be distinct but retain template id');
  assert(prefix(a.resources, b.resources) && b.resources.length > a.resources.length && b.resources.length <= 100, 'Only appended directory declarations are allowed');
  const resources = b.resources.slice(a.resources.length), oldIds = new Set(a.resources.map(r => r.id));
  assert(unique(b.resources.map(r => r.id)), 'Resource ids must remain unique');
  for (const resource of resources) {
    assert(exact(resource, ['id', 'name', 'kind', 'access', 'required']) && logical(resource.id) && !oldIds.has(resource.id) && typeof resource.name === 'string' && resource.name.length > 0 && resource.name.length <= 200 && resource.kind === 'directory' && ['write', 'readwrite'].includes(resource.access) && typeof resource.required === 'boolean', 'Only a new write/readwrite directory is permitted');
  }
  assert(a.entries.length === b.entries.length, 'Entries cannot be added or removed');
  const newIds = new Set(resources.map(r => r.id)), used = new Set(), entries = [];
  const normalized = structuredClone(b);
  for (let i = 0; i < a.entries.length; i++) {
    const old = a.entries[i], next = b.entries[i];
    assert(old.id === next.id && prefix(old.resources, next.resources) && next.resources.length <= 100 && unique(next.resources), 'Entry resources must preserve the original ordered prefix');
    const added = next.resources.slice(old.resources.length);
    if (added.length) {
      assert(old.capabilities.includes('file') && old.actions.length > 0 && unique(old.actions) && old.actions.every(id => a.actions.some(action => action.id === id)), 'Affected entry must already declare file and its write actions');
      assert(added.every(id => newIds.has(id)), 'Entry can only append new directory ids');
      added.forEach(id => used.add(id));
      entries.push({ entryId: old.id, resourceIds: added });
    }
    normalized.entries[i].resources = structuredClone(old.resources);
  }
  assert(entries.length > 0 && used.size === newIds.size, 'Every appended directory must belong to an affected entry');
  normalized.version = a.version;
  normalized.contentDigest = a.contentDigest;
  normalized.resources = structuredClone(a.resources);
  assert(equal(a, normalized), 'The package differs outside version, digest, and appended directory membership');
  assert(base.files instanceof Map && extension.files instanceof Map && base.files.size === a.files.length + 1 && extension.files.size === b.files.length + 1, 'Both complete raw package maps must include manifest.json');
  for (const pkg of [base, extension]) {
    const raw = pkg.files.get('manifest.json');
    assert(raw instanceof Uint8Array && equal(JSON.parse(Buffer.from(raw).toString('utf8')), pkg.manifest), 'Raw manifest differs from validated manifest');
  }
  for (const file of a.files) {
    const left = base.files.get(file.path), right = extension.files.get(file.path);
    assert(left instanceof Uint8Array && right instanceof Uint8Array && left.byteLength === file.size && right.byteLength === file.size, 'Raw file length differs');
    const leftHash = createHash('sha256').update(left).digest('hex');
    const rightHash = createHash('sha256').update(right).digest('hex');
    assert(leftHash === file.sha256 && rightHash === file.sha256 && Buffer.from(left).equals(Buffer.from(right)), 'Original package files must remain byte-identical');
  }
  return { basePackage: packageRef(a), extensionPackage: packageRef(b), resources: structuredClone(resources), entries };
}

export function requestFromReceipt(receipt) {
  return { version: 1, requestId: receipt.requestId, instanceId: receipt.instanceId, expectedRevision: receipt.previousRevision, basePackage: receipt.basePackage, extensionPackage: receipt.extensionPackage };
}
export function assertReceipt(receipt) {
  assert(exact(receipt, ['version', 'requestId', 'requestSha256', 'instanceId', 'previousRevision', 'basePackage', 'extensionPackage', 'resources', 'entries', 'appliedAt', 'receiptSha256']), 'Unexpected receipt fields');
  const { receiptSha256, ...body } = receipt;
  assert(receipt.version === 1 && digest(body) === receiptSha256, 'Extension receipt hash differs');
  assert(digest(requestFromReceipt(receipt)) === receipt.requestSha256, 'Extension request hash differs');
  assert(receipt.basePackage.id === receipt.extensionPackage.id && receipt.basePackage.version !== receipt.extensionPackage.version && receipt.basePackage.digest !== receipt.extensionPackage.digest, 'Extension package identity differs');
  assert(receipt.resources.length > 0 && unique(receipt.resources.map(r => r.id)) && receipt.entries.length > 0 && unique(receipt.entries.map(e => e.entryId)), 'Extension receipt additions must be unique');
  const ids = new Set(receipt.resources.map(r => r.id)), used = new Set();
  for (const entry of receipt.entries) {
    assert(entry.resourceIds.length > 0 && unique(entry.resourceIds) && entry.resourceIds.every(id => ids.has(id)), 'Extension receipt entry additions differ');
    entry.resourceIds.forEach(id => used.add(id));
  }
  assert(used.size === ids.size, 'Extension receipt contains unused directories');
}
/** This constructs a value only. It is not evidence that a host transaction committed. */
export function receiptValue(request, compatible, appliedAt) {
  assert(equal(request.basePackage, compatible.basePackage) && equal(request.extensionPackage, compatible.extensionPackage), 'Request differs from checked packages');
  const body = { version: 1, requestId: request.requestId, requestSha256: digest(request), instanceId: request.instanceId, previousRevision: request.expectedRevision, basePackage: structuredClone(compatible.basePackage), extensionPackage: structuredClone(compatible.extensionPackage), resources: structuredClone(compatible.resources), entries: structuredClone(compatible.entries), appliedAt };
  const receipt = { ...body, receiptSha256: digest(body) };
  assertReceipt(receipt);
  return receipt;
}
export function assertFixedReceipt(fixed, live, instanceId, entryId) {
  assertReceipt(fixed);
  assertReceipt(live);
  assert(equal(fixed, live) && fixed.instanceId === instanceId && fixed.entries.some(e => e.entryId === entryId), 'Fixed extension receipt does not belong to this instance and entry');
}
