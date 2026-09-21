import { z } from 'zod';
import type { EmbeddedReview } from './run-review';
import type { PlanningContext } from './planning';
import type { Flow, Step } from './types';
import { resolveValue } from '../core/engine';

export type WebPageIdentity = {
  resourceId: string;
  documentRevision: number;
  url: string;
  title: string;
};
export type TaskWebTarget = {
  selectionId: string;
  taskId: string;
  browserId: 'embedded';
  access: 'read';
  page: WebPageIdentity;
  selectedAt: string;
};
export type TaskWebPreview = {
  ready: boolean;
  page?: WebPageIdentity;
  token?: string;
  reason?: string;
};
export const WEB_CONTEXT_ID = '_flowark_selected_web';
const selection = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  revision: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER - 1),
};
export const webTargetMethods = {
  'task.web.preview': z.object(selection).strict(),
  'task.web.select': z.object({ ...selection, token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  'task.web.clear': z.object(selection).strict(),
};
export function pageIdentity(value: EmbeddedReview): WebPageIdentity {
  if (
    !value?.started ||
    value.loading ||
    value.blocked ||
    typeof value.resourceId !== 'string' ||
    !value.resourceId ||
    typeof value.url !== 'string' ||
    typeof value.title !== 'string' ||
    !Number.isSafeInteger(value.documentRevision) ||
    value.documentRevision < 0
  )
    throw new Error(value?.blocked || '请先打开内置网页，并等待加载完成后重新检查');
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new Error('请先打开 HTTP(S) 网页');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    value.url.length > 8192 ||
    value.title.length > 10000
  )
    throw new Error('当前网页地址或标题不在支持范围内');
  return {
    resourceId: value.resourceId,
    documentRevision: value.documentRevision,
    url: value.url,
    title: value.title,
  };
}
export const sameWebPage = (a: WebPageIdentity, b: WebPageIdentity) =>
  a.resourceId === b.resourceId &&
  a.documentRevision === b.documentRevision &&
  a.url === b.url &&
  a.title === b.title;
export function webContext(target: TaskWebTarget): PlanningContext {
  return {
    id: WEB_CONTEXT_ID,
    kind: 'web',
    label: '已选网页 · 只读',
    text: JSON.stringify(
      {
        url: target.page.url,
        title: target.page.title,
        account: '未核对',
        workspace: '本机内置浏览器',
        access: '只读取本次选择的网页，可新建本地文本文件；不提交表单、不发送消息、不覆盖文件。',
      },
      null,
      2,
    ),
  };
}
export function assertWebContext(context: readonly PlanningContext[], target: TaskWebTarget) {
  const entries = [...context, webContext(target)];
  if (entries.length > 20) throw new Error('已选网页占用一项上下文，最多再附加 19 项资料');
  if (
    entries.some((e) => e.text.length > 50000) ||
    entries.reduce((n, e) => n + e.text.length, 0) > 200000
  )
    throw new Error('包含网页资料的上下文超过文本上限，请缩短资料后重新选择');
}
export function assertWebFlow(flow: Flow, target: TaskWebTarget) {
  const block = (steps: Step[]) => {
    for (const n of steps) {
      if (n.type === 'browser') {
        if (n.operation === 'navigate') {
          let url: unknown;
          try {
            url = resolveValue(n.value, { params: flow.parameters });
          } catch {}
          if (url !== target.page.url)
            throw new Error('网页目标只允许打开已选地址，不能使用其他或动态网址');
        } else if (!['read', 'wait'].includes(n.operation))
          throw new Error('已选网页为只读范围，不能提交表单、填写或执行其他网页操作');
      } else if (n.type === 'file' && n.operation === 'create') continue;
      else if (n.type === 'condition') {
        block(n.then);
        block(n.else);
      } else if (n.type === 'loop') block(n.body);
      else if (!['value', 'assert', 'human'].includes(n.type))
        throw new Error('当前网页任务只允许读取网页和新建文本，请先调整方案与所需能力');
    }
  };
  block(flow.steps);
}
