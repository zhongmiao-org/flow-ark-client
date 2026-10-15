import { document_result_v1 } from './node-schema.generated.js';
import type { Step } from './types';
import type { DocumentResult } from './contracts.generated';
export type { DocumentResult } from './contracts.generated';
export type DocumentNode = Extract<Step, { type: 'document' }>;
export type DocumentBody = Pick<DocumentResult, 'status' | 'text' | 'units' | 'warnings'>;
export const documentCapability = 'document-extract-v1';
export const DOCUMENT_BYTES = 8 * 1024 * 1024;
export function documentName(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1000 ||
    /^[A-Za-z]:/.test(value) ||
    /[\\\0]/.test(value) ||
    value.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('资料文件名须为安全的相对路径，最多1000字符');
}
export function assertDocumentNode(node: DocumentNode) {
  if (typeof node.file === 'string') documentName(node.file);
}
export function assertDocumentResult(value: unknown): asserts value is DocumentResult {
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > 1024 * 1024 ||
    !document_result_v1(value)
  )
    throw new Error('资料解析结果格式或大小无效');
  const v = value as DocumentResult;
  documentName(v.source.name);
  if (
    v.text.length > 50000 ||
    v.units.some((u, i) => u.index !== i + 1 || u.text.length > 50000) ||
    v.text !== v.units.map((u) => u.text).join('\n')
  )
    throw new Error('资料正文与来源单元不一致或超限');
  if (
    v.warnings.some(
      (w) =>
        w.unit !== null &&
        (w.unit > v.units.length ||
          (w.code === 'empty-unit' &&
            (v.source.format !== 'pdf' || v.units[w.unit - 1].text.trim()))),
    )
  )
    throw new Error('资料缺口定位无效');
  const hasGap = v.warnings.some((w) =>
    ['empty-unit', 'tracked-changes', 'embedded-content'].includes(w.code),
  );
  const status = !v.text.trim() ? 'empty' : hasGap ? 'partial' : 'ready';
  if (v.status !== status) throw new Error('资料状态与正文或缺口不一致');
}
