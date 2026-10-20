import type { ResultLedger, LedgerOwner } from './result-ledger.mjs';
export type RetentionPolicy = { version: 1; policy: 'run-owned-results-v1' };
type CapacityAvailable = {
  version: 1; runId: string; status: 'available';
  limits: { count: 1000; retainedBytes: 8388608 };
  count: number; logicalBytes: number; retainedBytes: number;
};
export type RunResultCapacity =
  | (CapacityAvailable & { policy: 'legacy-full-values-v1' })
  | (CapacityAvailable & { policy: 'run-owned-results-v1'; revision: number;
      catalogBytes: number; copyBytes: number; copyCount: number })
  | { version: 1; runId: string; status: 'unavailable';
      policy: 'run-owned-results-v1' | 'legacy-full-values-v1';
      reason: 'missing' | 'owner-mismatch' | 'integrity' | 'limit' | 'storage' };
export const resultRetentionPolicy: Readonly<RetentionPolicy>;
export function verifyCapacity(value: RunResultCapacity, expectedRunId: string): void;
export function ledgerCapacity(ledger: ResultLedger, owner: LedgerOwner): RunResultCapacity;
