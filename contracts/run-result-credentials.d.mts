/** Pure transform only; no storage, Schema validation or permission. */
export function credentialField(key: string): boolean;
export function credentialPolicy(known: string[]): {
  text(input: string): string;
  value(input: unknown): { value: unknown; dataChanged: boolean; dataSha256: string; dataBytes: number };
};
