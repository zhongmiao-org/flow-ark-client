/** Pure normative reference; formats do not attest Store ownership or action permission. */
export type Cell =
  | { kind: 'json'; text: string }
  | { kind: 'bytes'; data: string }
  | { kind: 'text'; body: string }
  | { kind: 'concat' | 'list' | 'array' | 'object'; parts: string[] }
  | { kind: 'members'; entries: { key: string; value: string }[] };
export type ValueRoot = { resultId: string; root: string; sha256: string; bytes: number };
export type RetentionSet = {
  version: 1;
  runId: string;
  roots: ValueRoot[];
  cells: { id: string; cell: Cell }[];
};
export type Capacity = { count: number; cells: number; logicalBytes: number; retainedBytes: number };
export const LIMITS: Readonly<{
  roots: 1000; cells: 16384; value: 8388608; retained: 8388608;
  leaf: 4096; cell: 16384; fanout: 32; jsonDepth: 64; graphDepth: 256;
  visits: 262144; workBytes: number;
}>;
export function canonical(value: unknown): string;
export function digest(value: unknown): string;
export function cellId(cell: Cell): string;
export function inspect(set: unknown, expectedRunId: string): Capacity;
export function encode(value: unknown, runId: string, resultId: string): RetentionSet;
export function read(set: unknown, expectedRunId: string, resultId: string): unknown;
export function merge(saved: unknown, candidate: unknown): RetentionSet;
