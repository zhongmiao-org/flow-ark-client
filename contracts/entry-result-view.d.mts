/** Types for the wire reference only; p1.schema.json is authoritative. */
export function canonical(value: unknown): string;
export function digest(value: unknown): string;
export function bytes(value: unknown): number;
export function assertWireBudget(value: unknown): void;
export function seal<T extends object>(body: T): T & { readStamp: string };
export function verify<T>(response: T, expectedRun: unknown, expectedSource?: unknown): T;
