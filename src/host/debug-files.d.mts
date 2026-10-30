export type DebugLocations = { version: 1; current: string; roots: string[] };
export const debugConfigPath: string;
export const defaultDebugRoot: string;
export function checkedDirectory(path: string, create?: boolean): string;
export function debugLocations(): DebugLocations;
export function setDebugLocation(path: string): DebugLocations;
export function debugRoot(): string;
export function debugEvidenceRoot(): string;
export function debugMkdtempSync(
  prefix: string,
  options?: { purpose?: string; category?: string; retained?: boolean },
): string;
export function debugMkdtemp(
  prefix: string,
  options?: { purpose?: string; category?: string; retained?: boolean },
): Promise<string>;
