import { z } from 'zod';
import type { FlowArkP1 } from './contracts.generated';
import {
  author_definition_v1,
  author_draft_v1,
  author_exportreceipt_v1,
} from './node-schema.generated';
export type AuthorDefinition = NonNullable<FlowArkP1['TemplateAuthorDefinition']>;
export type AuthorDraft = NonNullable<FlowArkP1['TemplateAuthorDraft']>;
export type AuthorEntry = AuthorDefinition['entries'][number];
export type AuthorCheckout = NonNullable<FlowArkP1['TemplateAuthorCheckout']>;
export type AuthorReceipt = NonNullable<FlowArkP1['TemplateAuthorExportReceipt']>;
export function authorPngPreview(asset?: AuthorDefinition['assets'][number]) {
  if (
    asset?.encoding !== 'base64' ||
    !/\.png$/i.test(asset.path) ||
    !asset.body.startsWith('iVBORw0KGgo') ||
    asset.body.length > 1048576 ||
    asset.body.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(asset.body)
  )
    return;
  const size =
    (asset.body.length / 4) * 3 -
    (asset.body.endsWith('==') ? 2 : asset.body.endsWith('=') ? 1 : 0);
  if (size > 768 * 1024) return;
  try {
    const header = Uint8Array.from(atob(asset.body.slice(0, 44)), (c) => c.charCodeAt(0));
    if (header.length < 33 || String.fromCharCode(...header.slice(12, 16)) !== 'IHDR') return;
    const data = new DataView(header.buffer),
      width = data.getUint32(16),
      height = data.getUint32(20);
    if (
      data.getUint32(8) !== 13 ||
      !width ||
      !height ||
      width > 8192 ||
      height > 8192 ||
      width * height > 16000000
    )
      return;
    return { url: 'data:image/png;base64,' + asset.body, size };
  } catch {
    return;
  }
}
export const promptMarker = (id: string) => '@author:prompt/' + id;
export function assertAuthorDefinition(v: unknown): asserts v is AuthorDefinition {
  if (!author_definition_v1(v)) throw Error('模板制作定义无效，请核对字段与入口');
}
export function assertAuthorDraft(v: unknown): asserts v is AuthorDraft {
  if (!author_draft_v1(v)) throw Error('模板制作草稿记录无效');
}
export function assertAuthorReceipt(v: unknown): asserts v is AuthorReceipt {
  if (!author_exportreceipt_v1(v)) throw Error('模板导出回执无效');
}
const id = z.string().min(1).max(100),
  revision = z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1);
const token = z.string().regex(/^[a-f0-9]{64}$/),
  packageKey = z.string().min(1).max(240);
export const authorMethods = {
  'author.asset.choose': z.object({}).strict(),
  'author.schema.check': z.object({ schema: z.unknown(), form: z.boolean() }).strict(),
  'author.sdk.result': z.object({ runId: id }).strict(),
  'author.list': z.object({}).strict(),
  'author.create': z.object({ requestId: id }).strict(),
  'author.detail': z.object({ id }).strict(),
  'author.save': z.object({ id, revision, definition: z.unknown() }).strict(),
  'author.fork': z.object({ key: packageKey, requestId: id }).strict(),
  'author.checkout': z.object({ id, revision, entryId: id, requestId: id }).strict(),
  'author.checkout.origin': z.object({ flowId: id }).strict(),
  'author.flow.source': z.object({ flowId: id }).strict(),
  'author.adopt.preview': z
    .object({ checkoutId: id, revision, detach: z.array(id).max(1000).default([]) })
    .strict(),
  'author.adopt.confirm': z
    .object({ id, revision, token, requestId: id, reviewed: z.literal(true) })
    .strict(),
  'author.preview': z.object({ id, revision }).strict(),
  'author.file': z.object({ id, token, path: z.string().min(1).max(240) }).strict(),
  'author.export': z
    .object({ id, revision, token, requestId: id, reviewed: z.literal(true) })
    .strict(),
  'author.export.inspect': z.object({ id, requestId: id }).strict(),
  'author.export.cancel': z.object({ id, requestId: id, reviewed: z.literal(true) }).strict(),
};
export function newAuthorEntry(id: string, name = '新入口'): AuthorEntry {
  return {
    id,
    name,
    schedulable: false,
    flow: {
      formatVersion: '1.0',
      id,
      name,
      description: '',
      parameters: {},
      steps: [],
      requiredCapabilities: [],
    },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {},
    capabilities: [],
    resourceIds: [],
    actionIds: [],
    promptBindings: [],
  };
}
