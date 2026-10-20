import type { RetentionSet } from './result-retention.mjs';
export type LedgerOwner = { runId: string; flowId: string; versionId: string; snapshotSha256: string };
export type ResultMeta = { id: string; nodeId: string; nodeInstance: string;
  type: 'document' | 'skill' | 'context' | 'conversation' | 'browser' | 'run-result' | 'source' | 'source-reduce' | 'effect';
  label: string; bytes: number; sha256: string };
export type RawFamily = 'state-operation' | 'effect-operation' | 'entry-result' | 'entry-display' |
  'entry-reuse' | 'browser-input-proof' | 'document-source-proof' | 'typed-result-record' |
  'typed-result-index' | 'ai-receipt' | 'run-output';
export type RawCopy = { family: RawFamily; id: string; sha256: string; bytes: number };
export type ActualCopy = { family: RawFamily; id: string; value: unknown };
export type ResultLedger = { version: 1; policy: 'run-owned-results-v1'; owner: LedgerOwner;
  revision: number; values: RetentionSet; results: ResultMeta[]; copies: RawCopy[] };
export type LedgerCapacity = { count: number; logicalBytes: number; catalogBytes: number;
  copyBytes: number; retainedBytes: number; copyCount: number };
export type LedgerProposal = { values: RetentionSet | null; results: ResultMeta[];
  copies: (ActualCopy & { before: string | null })[] };
export const rawFamilies: readonly RawFamily[];
export function createLedger(owner: LedgerOwner): ResultLedger;
export function inspectLedger(ledger: unknown, owner: LedgerOwner): LedgerCapacity;
export function rawCharge(family: RawFamily, id: string, value: unknown): RawCopy;
export function verifyCopies(ledger: unknown, owner: LedgerOwner, actual: ActualCopy[]): LedgerCapacity;
export function propose(ledger: unknown, owner: LedgerOwner, revision: number, change: LedgerProposal): ResultLedger;
