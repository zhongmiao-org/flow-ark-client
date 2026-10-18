/** Pure reference types only; p1.schema.json is authoritative. */
export function canonical(value: unknown): string;
export function digest(value: unknown): string;
export function bytes(value: unknown): number;
export function verifyReference<T>(ref: T, owner: unknown, resource: unknown): T;
export function verifyRead<T>(value: T, owner: unknown, resource: unknown): T;
export function verifyResponse<T>(response: T, request: unknown, owner?: unknown, resource?: unknown): T;
export function verifyProof<T>(proof: T, owner: unknown, resource: unknown): T;
export function verifyCursor<T>(cursor: T, expected: unknown): T;
export function verifyLease<T>(lease: T, now: number, expected: unknown): T;
export function verifyPrepared<T>(sources: T, consumerRunId: string): T;
export function assertDeclaration<T>(definition: T): T;
