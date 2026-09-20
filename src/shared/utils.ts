import { createHash, randomUUID } from 'node:crypto';
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const canonical = (v: any): string => JSON.stringify(sort(v));
function sort(v: any): any {
  return Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sort(v[k])]),
        )
      : v;
}
export const digest = (v: any) => createHash('sha256').update(canonical(v)).digest('hex');
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function maskText(value: string, secrets: string[]): string {
  let result = value
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/\b1[3-9]\d{9}\b/g, '[PHONE]');
  for (const secret of secrets) if (secret) result = result.split(secret).join('[REDACTED]');
  return result;
}
export function redactedErrorText(e: unknown, secrets: string[] = []): string {
  const message =
    e instanceof Error && typeof e.message === 'string' && e.message ? e.message : '请求失败';
  return maskText(message, secrets).slice(0, 4000);
}
function anonymousAlphabet(secrets: string[]): [string, string] {
  const used = new Set<string>();
  for (const secret of secrets) for (const character of secret) used.add(character);
  const selected: string[] = [];
  // These rare fallback keys are anonymous presentation markers. Neither of
  // their characters occurs in a secret, so no secret can occur in the key.
  for (const [start, end] of [
    [0xe000, 0xf8ff],
    [0xf0000, 0xffffd],
    [0x100000, 0x10fffd],
  ]) {
    for (let point = start; point <= end; point++) {
      const character = String.fromCodePoint(point);
      if (!used.has(character)) selected.push(character);
      if (selected.length === 2) return [selected[0], selected[1]];
    }
  }
  throw new Error('凭据字符范围超出匿名脱敏标记支持范围');
}
export function redact(value: any, secrets: string[] = []): any {
  const sensitive =
    /password|secret|token|authorization|cookie|api.?key|ownWechat|ownPhone|conversation|facts|content|body/i;
  if (typeof value === 'string') return maskText(value, secrets).slice(0, 4000);
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    // Reserve all original names before allocating replacements, including names
    // occurring later in the input. No entry may silently overwrite another.
    const names = new Set(entries.map(([key]) => key));
    let nextKey = 1;
    let alphabet: [string, string] | undefined;
    return Object.fromEntries(
      entries.map(([key, entry]) => {
        let name = key;
        if (maskText(key, secrets) !== key) {
          do {
            const index = nextKey++;
            name = '[REDACTED_KEY_' + index + ']';
            if (maskText(name, secrets) !== name) {
              alphabet ??= anonymousAlphabet(secrets);
              name = [...index.toString(2)].map((digit) => alphabet![Number(digit)]).join('');
            }
          } while (names.has(name));
          names.add(name);
        }
        return [name, sensitive.test(key) ? '[REDACTED]' : redact(entry, secrets)];
      }),
    );
  }
  return value;
}
