import { z } from 'zod';
import { fieldsPickRootSchema } from './browser-field-picking';

const issueOrder = [
  'hidden-target',
  'hidden-descendant',
  'line-clamp',
  'overflow-clip',
  'unsupported-layout',
  'embedded-content',
  'generated-content',
] as const;
const issue = z.enum(issueOrder);
const location = z
  .object({
    issue,
    scope: z.enum(['target', 'ancestor', 'frame-ancestor', 'descendant', 'unavailable']),
    depth: z.number().int().min(0).max(6000).nullable(),
    scanIndex: z.number().int().min(1).max(6000).nullable(),
    tag: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z][a-zA-Z0-9:_-]*$/)
      .nullable(),
    pseudo: z.enum(['before', 'after']).nullable(),
    contentKind: z.enum(['whitespace-string', 'other-generated']).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const known = v.scope !== 'unavailable';
    if (
      (known && (v.depth === null || v.scanIndex === null || v.tag === null)) ||
      (!known && (v.depth !== null || v.scanIndex !== null || v.tag !== null)) ||
      (v.scope === 'target' && v.depth !== 0) ||
      (known && v.scope !== 'target' && v.depth === 0) ||
      (['ancestor', 'frame-ancestor'].includes(v.scope) && v.depth! > 63) ||
      (v.issue === 'generated-content'
        ? !v.pseudo || !v.contentKind
        : v.pseudo !== null || v.contentKind !== null)
    )
      ctx.addIssue({ code: 'custom', message: '拒绝位置关系无效' });
  });
const renderingDataBaseSchema = z
  .object({
    policy: z.enum(['bounded-rendered-text-v1', 'bounded-rendered-text-v2']),
    issues: z.array(issue).max(7),
    locations: z.array(location).max(32),
    truncated: z.boolean(),
    scannedElements: z.number().int().min(1).max(2000),
    scannedNodes: z.number().int().min(1).max(6000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.scannedElements > v.scannedNodes ||
      v.issues.some(
        (s, i) => i > 0 && issueOrder.indexOf(s) <= issueOrder.indexOf(v.issues[i - 1]),
      ) ||
      v.locations.some((l) => !v.issues.includes(l.issue) || (l.scanIndex ?? 0) > v.scannedNodes) ||
      (!v.truncated && v.issues.some((s) => !v.locations.some((l) => l.issue === s))) ||
      (v.truncated && v.locations.length !== 32)
    )
      ctx.addIssue({ code: 'custom', message: '拒绝原因、位置或扫描预算不一致' });
  });
const renderingDataV1Schema = renderingDataBaseSchema.safeExtend({
  policy: z.literal('bounded-rendered-text-v1'),
});
const renderingDataV2Schema = renderingDataBaseSchema.safeExtend({
  policy: z.literal('bounded-rendered-text-v2'),
  ignoredAncestorSpaces: z.number().int().min(0).max(128),
});
export const renderingDiagnosticDataSchema = z.discriminatedUnion('policy', [
  renderingDataV1Schema,
  renderingDataV2Schema,
]);
export const renderingInspectionRequestSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().min(1).max(100),
    root: fieldsPickRootSchema,
    selector: fieldsPickRootSchema.shape.selector,
    policy: z.enum(['bounded-rendered-text-v1', 'bounded-rendered-text-v2']).optional(),
  })
  .strict();
const sourceSchema = z
  .object({
    resourceId: z.string().min(1).max(256),
    documentRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const renderingInspectionStatusSchema = z.object({ current: z.boolean() }).strict();
const inspectionMetadata = {
  ...renderingInspectionRequestSchema.omit({ policy: true }).shape,
  source: sourceSchema,
};
export const renderingInspectionSchema = z.discriminatedUnion('policy', [
  renderingDataV1Schema.safeExtend(inspectionMetadata),
  renderingDataV2Schema.safeExtend(inspectionMetadata),
]);
export type RenderingDiagnosticData = z.infer<typeof renderingDiagnosticDataSchema>;
export type RenderingLocation = RenderingDiagnosticData['locations'][number];
export type RenderingInspectionRequest = z.infer<typeof renderingInspectionRequestSchema>;
export type RenderingInspection = z.infer<typeof renderingInspectionSchema>;

export function parseRenderingInspection(value: unknown, request: RenderingInspectionRequest) {
  const result = renderingInspectionSchema.parse(value);
  if (
    result.requestId !== request.requestId ||
    result.policy !== (request.policy ?? 'bounded-rendered-text-v1') ||
    result.selector !== request.selector ||
    result.root.selector !== request.root.selector ||
    JSON.stringify(result.root.framePath) !== JSON.stringify(request.root.framePath) ||
    new TextEncoder().encode(JSON.stringify(result)).length > 65536
  )
    throw Error('正文诊断与当前请求不一致或结果超限');
  return result;
}
export const renderingInspectionMethods = {
  'browser.embedded.fields.rendering.inspect': renderingInspectionRequestSchema,
  'browser.embedded.fields.rendering.status': z.object({ source: sourceSchema }).strict(),
};
