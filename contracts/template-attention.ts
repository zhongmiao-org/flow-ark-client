/** Normative host-owned template attention origin; no application or I/O imports. */
export interface TemplateAttentionOrigin {
  version: 1;
  runId: string;
  instanceId: string;
  entryId: string;
}

const originKeys = new Set(['version', 'runId', 'instanceId', 'entryId']);
const invalidIdentifierCharacter = /[^a-zA-Z0-9_-]/;
export function isTemplateAttentionOrigin(value: unknown): value is TemplateAttentionOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 4 && keys.every(key => originKeys.has(key)) &&
    record.version === 1 && ['runId', 'instanceId', 'entryId'].every(key =>
      Object.prototype.hasOwnProperty.call(record, key) &&
      typeof record[key] === 'string' && (record[key] as string).length >= 1 &&
      (record[key] as string).length <= 100 &&
      !invalidIdentifierCharacter.test(record[key] as string));
}
