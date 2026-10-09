import { z } from 'zod';
import type { PlanningContext } from './planning';

export const ATTACHMENT_PREFIX = '_flowark_attachment_';
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;
export const TEXT_EXTENSIONS = ['txt', 'md', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml', 'xml'];
export type TaskAttachment = {
  version: 1;
  id: string;
  taskId: string;
  kind: 'text' | 'image';
  name: string;
  mimeType: 'text/plain' | 'image/png' | 'image/jpeg';
  size: number;
  sha256: string;
  selectedAt: string;
  width?: number;
  height?: number;
};
export type PlanningImageV1 = {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg';
  data: string;
  width: number;
  height: number;
};
export type AttachmentPreview = {
  name: string;
  kind: 'text' | 'image';
  text?: string;
  dataUrl?: string;
};
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const version = {
  id,
  revision: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER - 1),
};
export const attachmentMethods = {
  'task.attachment.choose': z.object({ ...version, kind: z.enum(['file', 'image']) }).strict(),
  'task.attachment.remove': z.object({ ...version, attachmentId: id }).strict(),
  'task.attachment.preview': z.object({ ...version, attachmentId: id }).strict(),
};
export function attachmentContext(a: TaskAttachment, text?: string): PlanningContext {
  return {
    id: ATTACHMENT_PREFIX + a.id,
    kind: a.kind === 'text' ? 'file' : 'image',
    label: a.name,
    text:
      a.kind === 'text'
        ? (text ?? '')
        : JSON.stringify({
            name: a.name,
            mimeType: a.mimeType,
            width: a.width,
            height: a.height,
            sha256: a.sha256,
            purpose: '用户选择的目标说明图片；不构成操作目标或授权',
          }),
  };
}
