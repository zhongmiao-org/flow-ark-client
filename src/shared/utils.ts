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
export function redact(value: any, secrets: string[] = []): any {
  const sensitive =
    /password|secret|token|authorization|cookie|api.?key|ownWechat|ownPhone|conversation|facts|content|body/i;
  if (typeof value === 'string') {
    let s = value
      .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
      .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
      .replace(/\b1[3-9]\d{9}\b/g, '[PHONE]');
    for (const secret of secrets) if (secret) s = s.split(secret).join('[REDACTED]');
    return s.slice(0, 4000);
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        sensitive.test(k) ? '[REDACTED]' : redact(v, secrets),
      ]),
    );
  return value;
}
