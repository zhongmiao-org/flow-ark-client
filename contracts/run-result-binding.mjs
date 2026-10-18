/** Pure relationships only. Does not prove host privacy, ownership, TTL, storage or current grants. */
import { canonical, digest, bytes, seal, verify } from './entry-result-view.mjs';
export function verifyReference(ref, owner, resource) {
  if (resource.kind !== 'run-result' || resource.access !== 'read' ||
      !resource.sourceEntries.includes(ref.source.entryId)) throw Error('resource scope');
  const source = ref.source;
  if (source.kind === 'template' ? owner.kind !== 'instance' || owner.id !== source.instanceId :
      owner.kind !== 'author-draft' || owner.id !== source.draftId) throw Error('owner mismatch');
  if (source.kind === 'template' && (owner.packageKey !== source.packageKey ||
      owner.packageDigest !== source.packageDigest)) throw Error('pinned package mismatch');
  // Reuse the sealed wire source relationships without claiming an actual historical read.
  const run = { ...ref.run, state: 'SUCCEEDED' };
  verify(seal({ formatVersion: '1.0', run, viewStatus: 'missing', source }), run, source);
  return ref;
}
export function verifyRead(value, owner, resource) {
  verifyReference(value.ref, owner, resource);
  if (value.binding !== resource.id || bytes(value.value) > 196608 ||
      value.ref.dataBytes !== bytes(value.value) || value.ref.dataSha256 !== digest(value.value))
    throw Error('read data mismatch');
  if (bytes(value) > 524288) throw Error('read response budget');
  const run = { ...value.ref.run, state: 'SUCCEEDED' };
  verify(seal({ formatVersion: '1.0', run, viewStatus: 'available',
    source: value.ref.source, completion: 'run-succeeded', privacy: 'host-redacted-v1',
    value: value.value, displayChanged: value.dataChanged,
    valueSha256: value.ref.dataSha256, valueBytes: value.ref.dataBytes,
    labels: value.labels, labelsComplete: value.labelsComplete }), run, value.ref.source);
  return value;
}
export function verifyCursor(cursor, expected) {
  if (cursor.targetSha256 !== expected.targetSha256 || cursor.binding !== expected.binding ||
      cursor.querySha256 !== expected.querySha256 || cursor.ceiling !== expected.ceiling ||
      cursor.before > cursor.ceiling + 1 || cursor.cursorId !== expected.cursorId) throw Error('cursor scope');
  return cursor;
}
export function verifyResponse(response, request, owner, resource) {
  if (bytes(response) > 524288 || canonical(response.target) !== canonical(request.target) ||
      response.binding !== request.binding) throw Error('response target');
  if ('readStamp' in response) {
    const { readStamp, ...body } = response;
    if (digest(body) !== readStamp) throw Error('response stamp');
  }
  if ('ref' in response && owner && resource) verifyReference(response.ref, owner, resource);
  if ('ref' in response && 'value' in response) {
    if (bytes(response.value) !== response.ref.dataBytes ||
        digest(response.value) !== response.ref.dataSha256) throw Error('preview data');
    if (owner && resource) verifyRead({ ...response, version: 1, operation: 'read' }, owner, resource);
  }
  if ('choices' in response) {
    const seen = new Set();
    for (const row of response.choices) {
      if (seen.has(row.run.id) || (row.status === 'candidate' && row.run.state !== 'SUCCEEDED'))
        throw Error('catalog candidate');
      seen.add(row.run.id);
    }
    if (response.next && (response.next.targetSha256 !== response.targetSha256 ||
        response.next.binding !== response.binding ||
        response.next.querySha256 !== digest(request.query) ||
        response.next.before > response.next.ceiling + 1)) throw Error('catalog cursor');
  }
  return response;
}
export function verifyPrepared(sources, consumerRunId) {
  for (const [binding, source] of Object.entries(sources)) {
    if (binding !== source.binding || source.ref.run.id === consumerRunId) throw Error('prepared source relation');
    verifyReference(source.ref, source.owner, { kind: 'run-result', access: 'read',
      sourceEntries: [source.ref.source.entryId] });
  }
  return sources;
}
export function verifyProof(proof, owner, resource) {
  const { proofSha256, ...body } = proof;
  if (digest(body) !== proofSha256 || canonical(owner) !== canonical(proof.owner) ||
      canonical(proof.run) !== canonical(proof.ref.run) ||
      proof.dataChanged !== (proof.originalValueSha256 !== proof.ref.dataSha256)) throw Error('private proof relation');
  verifyRead({ version: 1, operation: 'read', binding: resource.id, ref: proof.ref,
    value: proof.value, dataChanged: proof.dataChanged, schemaValidation: 'passed',
    labels: proof.labels, labelsComplete: proof.labelsComplete }, owner, resource);
  return proof;
}
export function verifyLease(lease, now, expected) {
  if (!Number.isFinite(now) || lease.issuedMonotonicMs > now ||
      lease.expiresMonotonicMs <= now || lease.expiresMonotonicMs <= lease.issuedMonotonicMs ||
      lease.expiresMonotonicMs - lease.issuedMonotonicMs > 600000 ||
      lease.kind !== expected.kind || lease.id !== expected.id ||
      lease.targetSha256 !== expected.targetSha256 || lease.binding !== expected.binding ||
      canonical(lease.target) !== canonical(expected.target)) throw Error('private lease relation');
  for (const key of ['ref', 'proofSha256', 'readStamp', 'reviewId', 'cursor'])
    if (canonical(lease[key] ?? null) !== canonical(expected[key] ?? null)) throw Error('private lease identity');
  return lease;
}
export function assertDeclaration(definition) {
  const entries = new Set(definition.entries.map(e => e.id));
  for (const resource of definition.resources.filter(r => r.kind === 'run-result')) {
    if (resource.access !== 'read' || !resource.sourceEntries?.length ||
        resource.sourceEntries.some(id => !entries.has(id))) throw Error('source entry declaration');
  }
  return definition;
}
export { canonical, digest, bytes };
