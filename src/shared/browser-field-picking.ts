import { z } from 'zod';

const selector = z
  .string()
  .min(1)
  .max(2000)
  .refine((v) => !!v.trim());
const framePath = z.array(selector).max(8);
export const fieldsPickRootSchema = z.object({ selector, framePath }).strict();
export const fieldsPickScopeSchema = z.discriminatedUnion('kind', [
  z.object({ version: z.literal(1), kind: z.literal('root') }).strict(),
  z
    .object({ version: z.literal(1), kind: z.literal('field'), root: fieldsPickRootSchema })
    .strict(),
]);
const metadata = {
  version: z.literal(1),
  root: fieldsPickRootSchema,
  label: z.string().max(100),
  tag: z.string().min(1).max(100),
  structural: z.boolean(),
};
export const fieldsPickCandidateSchema = z.discriminatedUnion('kind', [
  z.object({ ...metadata, kind: z.literal('root'), field: z.null() }).strict(),
  z
    .object({ ...metadata, kind: z.literal('field'), field: z.object({ selector }).strict() })
    .strict(),
]);
const requestId = z.string().min(1).max(100);
export const fieldsPickStateSchema = z.discriminatedUnion('phase', [
  z.object({ requestId, phase: z.literal('picking') }).strict(),
  z
    .object({ requestId, phase: z.literal('selected'), candidate: fieldsPickCandidateSchema })
    .strict(),
  z.object({ requestId, phase: z.literal('cancelled') }).strict(),
  z.object({ requestId, phase: z.literal('error'), error: z.string().min(1).max(2000) }).strict(),
]);
export type FieldsPickRoot = z.infer<typeof fieldsPickRootSchema>;
export type FieldsPickScope = z.infer<typeof fieldsPickScopeSchema>;
export type FieldsPickCandidate = z.infer<typeof fieldsPickCandidateSchema>;
export type FieldsPickState = z.infer<typeof fieldsPickStateSchema>;
export const fieldsPickMethods = {
  'browser.embedded.fields.pick.start': z
    .object({ requestId, scope: fieldsPickScopeSchema })
    .strict(),
  'browser.embedded.fields.pick.status': z.object({ requestId }).strict(),
  'browser.embedded.fields.pick.cancel': z.object({ requestId }).strict(),
  'browser.embedded.fields.pick.confirm': z.object({ requestId }).strict(),
  'browser.embedded.fields.pick.validate': z
    .object({ scope: fieldsPickScopeSchema, selector, framePath })
    .strict()
    .refine(
      (v) =>
        v.scope.kind === 'root' ||
        JSON.stringify(v.framePath) === JSON.stringify(v.scope.root.framePath),
      '字段验证不能更换根的框架路径',
    ),
};
