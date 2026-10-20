/** Pure response relationships. No database access, provenance or execution permit. */
import { inspectLedger } from './result-ledger.mjs';

export const resultRetentionPolicy = Object.freeze({ version: 1, policy: 'run-owned-results-v1' });
const limits = Object.freeze({ count: 1000, retainedBytes: 8388608 });
const fail = () => { throw Error('result capacity relationship mismatch'); };

/** Validate the fixed JSON Schema first. No unavailable response carries partial counters. */
export function verifyCapacity(value, expectedRunId) {
  if (value.runId !== expectedRunId) fail();
  if (value.status === 'unavailable') return;
  if (value.policy === 'legacy-full-values-v1') {
    if (value.logicalBytes !== value.retainedBytes ||
        (value.count === 0) !== (value.logicalBytes === 0)) fail();
    return;
  }
  if (value.retainedBytes !== value.catalogBytes + value.copyBytes ||
      (value.copyCount === 0) !== (value.copyBytes === 0) ||
      (value.count === 0) !== (value.logicalBytes === 0)) fail();
}

/** Caller must establish one stable Store view and verify every actual raw copy first. */
export function ledgerCapacity(ledger, owner) {
  const c = inspectLedger(ledger, owner);
  return {
    version: 1, runId: owner.runId, policy: 'run-owned-results-v1', status: 'available',
    revision: ledger.revision, limits: { ...limits }, count: c.count,
    logicalBytes: c.logicalBytes, catalogBytes: c.catalogBytes,
    copyBytes: c.copyBytes, copyCount: c.copyCount, retainedBytes: c.retainedBytes,
  };
}
