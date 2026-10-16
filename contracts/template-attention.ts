/** Normative host-owned template attention origins; no application or I/O imports. */
export interface TemplateInstanceAttentionOrigin {
  version: 1;
  runId: string;
  instanceId: string;
  entryId: string;
}
export interface TemplateAuthorAttentionOrigin {
  version: 2;
  runId: string;
  checkoutId: string;
  draftId: string;
  entryId: string;
  baseRevision: number;
}
export type TemplateAttentionOrigin = TemplateInstanceAttentionOrigin | TemplateAuthorAttentionOrigin;
const identifier = (v: unknown): v is string => typeof v === 'string' &&
  v.length >= 1 && v.length <= 100 && !/[^a-zA-Z0-9_-]/.test(v);
export function isTemplateAttentionOrigin(value: unknown): value is TemplateAttentionOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (r.version === 1) return Object.keys(r).length === 4 &&
    ['version', 'runId', 'instanceId', 'entryId'].every(k => Object.hasOwn(r, k)) &&
    [r.runId, r.instanceId, r.entryId].every(identifier);
  if (r.version === 2) return Object.keys(r).length === 6 &&
    ['version', 'runId', 'checkoutId', 'draftId', 'entryId', 'baseRevision'].every(k => Object.hasOwn(r, k)) &&
    [r.runId, r.checkoutId, r.draftId].every(identifier) &&
    identifier(r.entryId) && /^[a-z]/.test(r.entryId) && !/[^a-z0-9-]/.test(r.entryId) &&
    Number.isSafeInteger(r.baseRevision) && (r.baseRevision as number) >= 1 &&
    (r.baseRevision as number) <= Number.MAX_SAFE_INTEGER - 1;
  return false;
}
