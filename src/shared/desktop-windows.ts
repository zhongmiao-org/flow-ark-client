import { z } from 'zod';

const uuid = z.string().uuid();
export const selectionIdentity = z.object({ observationId: uuid, windowId: uuid }).strict();
export const selectionReference = selectionIdentity.extend({ previewId: uuid });
export const desktopMethods = {
  'desktop.windows.list': z.object({ requestId: uuid }).strict(),
  'desktop.windows.release': z.object({ observationId: uuid }).strict(),
  'desktop.selection.preview': selectionIdentity,
  'desktop.selection.clear': selectionReference,
  'desktop.accessibility.openSettings': z.object({}).strict(),
};
const windowInfo = z.object({ title: z.string().max(1024), minimized: z.boolean() }).strict();
const availability = z.enum(['available', 'permission-required', 'unsupported', 'unavailable']);
const accessibility = z.enum(['granted', 'not-granted', 'unknown']);
const consistent = (value: { availability: string; accessibility: string; windows: unknown[] }) => {
  if (value.availability === 'available') return value.accessibility === 'granted';
  if (value.windows.length) return false;
  return value.availability !== 'permission-required' || value.accessibility === 'not-granted';
};
export const nativeWindowDiscovery = z
  .object({
    version: z.literal(2),
    accessibility,
    availability,
    windows: z.array(windowInfo.extend({ id: uuid })).max(30),
    truncated: z.boolean(),
  })
  .strict()
  .refine(consistent)
  .refine((value) => new Set(value.windows.map((w) => w.id)).size === value.windows.length);
export const desktopWindowDiscovery = z
  .object({
    version: z.literal(2),
    requestId: uuid,
    platform: z.enum(['macos', 'unsupported']),
    accessibility,
    availability,
    windows: z.array(windowInfo.extend({ id: uuid, application: z.literal('TextEdit') })).max(30),
    truncated: z.boolean(),
    observedAt: z.string().datetime(),
    reason: z.string().max(1000).optional(),
    observationId: uuid.optional(),
    expiresAt: z.number().int().positive().optional(),
  })
  .strict()
  .refine(consistent)
  .refine((value) =>
    value.platform === 'macos'
      ? value.availability !== 'unsupported'
      : value.availability === 'unsupported' && value.accessibility === 'unknown',
  )
  .refine((value) =>
    value.availability === 'available'
      ? !!value.observationId && !!value.expiresAt
      : value.observationId === undefined && value.expiresAt === undefined,
  )
  .refine((value) => new Set(value.windows.map((w) => w.id)).size === value.windows.length);

export const selectionReasons = {
  expired: '这次窗口检查已失效，请重新检查并选择窗口。',
  'permission-required': '辅助功能权限已失效，请在系统设置中核对后重新检查窗口。',
  'window-changed': '原窗口已关闭或身份发生变化，请重新检查并选择窗口。',
  'no-selection': '没有选中段落。请在这个 TextEdit 窗口中选中文字，再重新读取。',
  ambiguous: '无法确定唯一的文档编辑区或选区，请只保留一个明确选中的段落。',
  unsupported: '当前窗口没有提供可读取的文档选区，请确认选择的是文本编辑的文档窗口。',
  'selection-changed': '读取时窗口或选区发生变化，请确认选区后重新读取。',
  'too-large': '选中内容超过本次预览上限，请缩小到需要处理的段落。',
  unavailable: '本机窗口暂时无法读取，请重新检查窗口后再试。',
} as const;
export type SelectionFailure = keyof typeof selectionReasons;
const failureStatus = z.enum(
  Object.keys(selectionReasons) as [SelectionFailure, ...SelectionFailure[]],
);
const range = z
  .object({
    location: z.number().int().min(0).max(2147483647),
    length: z.number().int().min(1).max(20000),
  })
  .strict();
export const nativeSelectionPreview = z.discriminatedUnion('status', [
  z
    .object({ status: z.literal('ready'), text: z.string().min(1).max(20000), range })
    .strict()
    .refine((v) => v.text.length === v.range.length),
  z.object({ status: failureStatus }).strict(),
]);
const previewIdentity = { version: z.literal(1), observationId: uuid, windowId: uuid };
export const desktopSelectionPreview = z.discriminatedUnion('status', [
  z
    .object({
      ...previewIdentity,
      status: z.literal('ready'),
      previewId: uuid,
      text: z.string().min(1).max(20000),
      range,
      redacted: z.boolean(),
      readAt: z.string().datetime(),
      expiresAt: z.number().int().positive(),
    })
    .strict()
    .refine((v) => v.redacted || v.text.length === v.range.length),
  z
    .object({ ...previewIdentity, status: failureStatus, reason: z.string().min(1).max(1000) })
    .strict(),
]);
export type DesktopWindowDiscovery = z.infer<typeof desktopWindowDiscovery>;
export type DesktopWindow = DesktopWindowDiscovery['windows'][number];
export type SelectionIdentity = z.infer<typeof selectionIdentity>;
export type SelectionReference = z.infer<typeof selectionReference>;
export type DesktopSelectionPreview = z.infer<typeof desktopSelectionPreview>;

const selectionCapability = z.enum(['available', 'unsupported', 'unavailable']);
export const nativeSelectionInspection = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      text: z.string().min(1).max(20000),
      range,
      replacement: selectionCapability,
      readback: selectionCapability,
    })
    .strict()
    .refine((v) => v.text.length === v.range.length),
  z.object({ status: failureStatus }).strict(),
]);
export const desktopSelectionInspection = selectionReference.extend({
  version: z.literal(1),
  checkedAt: z.string().datetime(),
  expiresAt: z.number().int().positive(),
  replacement: selectionCapability,
  readback: selectionCapability,
});
export type DesktopSelectionInspection = z.infer<typeof desktopSelectionInspection>;
