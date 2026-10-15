import type { Step } from '../shared/types';
import { taskStepTitle } from './task-step-presentation';
import type { McpReceipt } from '../shared/mcp-run';
import { mcpReceiptsForRun } from './mcp-run-presentation';
import { presentRun } from '../shared/run-presentation';
import { runTimeline } from './run-timeline';
import { flatten } from './flow-editing';
import { desktopRunPresentation, type DesktopRunInput } from './desktop-run-presentation';

export type TaskRunView = 'overview' | 'details' | 'rerun' | 'repair';
export type TaskRunIntent = 'plan' | 'modify' | 'home' | 'desktop-target';
export type RunArtifact = {
  artifactId: string;
  name: string;
  size: number;
  path: string;
  runId: string;
  available: boolean;
  integrity: string;
  storage?: string;
};
export const artifactLabel = (a: RunArtifact) =>
  ({
    verified: '已保存并核对副本',
    changed: '副本内容已改动',
    missing: '副本无法访问',
    cleared: '副本已清理',
    unverified: '旧记录，无法核对历史内容',
  })[a.integrity] ?? '副本状态待核对';

function operationLabel(node: Step) {
  switch (node.type) {
    case 'file':
      return {
        read: '读取文件',
        write: '写入文件',
        copy: '复制文件',
        archive: '打包文件',
        create: '创建文件',
      }[node.operation];
    case 'excel':
      return node.operation === 'read'
        ? '读取表格'
        : node.operation === 'fill'
          ? '填充表格'
          : '写入表格';
    case 'browser':
      return ['read', 'inputValue'].includes(node.operation)
        ? '读取网页'
        : node.operation === 'wait'
          ? '等待网页'
          : node.operation === 'navigate'
            ? '打开网页'
            : node.operation === 'screenshot'
              ? '网页截图'
              : '操作网页';
    case 'document':
      return '解析资料';
    case 'conversation':
      return '创建或读取引导会话';
    case 'ai':
      return '结构化 AI 调用';
    case 'http':
      return '网络请求';
    case 'script':
      return '执行脚本';
    case 'desktop':
      return '应用选区操作';
    case 'mcp':
      return '工具调用';
    default:
      return undefined;
  }
}

export function taskRunPresentation(
  input: DesktopRunInput & { artifacts?: RunArtifact[]; mcpReceipts?: McpReceipt[] },
  now = Date.now(),
) {
  const detail = { ...input, events: input.events.filter((e) => e.runId === input.run.id) };
  const view = presentRun(detail, now);
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(input.run.state);
  const desktop = desktopRunPresentation(
    detail,
    terminal,
    view.activity === 'active' && !input.fault,
  );
  const uncertain =
    !!input.fault ||
    !!desktop?.needsReview ||
    (terminal &&
      mcpReceiptsForRun(input.run.id, input.mcpReceipts, input.snapshot).some(
        (receipt) => receipt.status === 'unknown',
      )) ||
    (!terminal && input.run.state !== 'QUEUED' && view.activity !== 'active');
  const nodes = new Map(flatten(input.snapshot?.steps ?? []).map((n) => [n.id, n]));
  const rows = runTimeline(detail, now).map((row) => {
    const node = nodes.get(row.nodeId);
    return { ...row, name: node ? taskStepTitle(node) : row.name };
  });
  const completed = rows.filter((row) => row.ended);
  const unresolved = rows.filter((row) => row.started && !row.ended);
  const unvisited = rows.filter((row) => !row.started && !row.ended);
  const current = rows.find((row) => row.instance === view.step.instance);
  const stoppedStep = current?.started && !current.ended ? current : undefined;
  const stoppedPosition =
    stoppedStep &&
    input.snapshot?.steps.length === rows.length &&
    rows.every(
      (row) => row.instance === row.nodeId && !['condition', 'loop'].includes(row.type ?? ''),
    )
      ? input.snapshot.steps.findIndex((node) => node.id === stoppedStep.nodeId) + 1
      : 0;
  const success =
    input.run.state === 'SUCCEEDED' &&
    !uncertain &&
    !view.closing &&
    (!desktop || desktop.phase === 'verified');
  const mode = uncertain
    ? 'unknown'
    : view.closing
      ? 'closing'
      : success
        ? 'success'
        : terminal
          ? 'stopped'
          : 'active';
  const title = {
    unknown: '执行结果需要核对',
    closing: '正在完成运行收尾',
    success: '本次试运行已完成',
    stopped:
      input.run.state === 'FAILED'
        ? stoppedStep
          ? `停在${stoppedPosition ? `第 ${stoppedPosition} 步` : ''}：${stoppedStep.name}`
          : '本次试运行未完成'
        : input.run.state === 'CANCELLED'
          ? '本次试运行已取消'
          : '本次试运行已中断',
    active:
      input.run.state === 'QUEUED'
        ? '正在等待运行'
        : input.run.state === 'PAUSED'
          ? '试运行已暂停'
          : input.run.state === 'WAITING_INPUT'
            ? '试运行需要你处理'
            : '正在试运行',
  }[mode];
  const artifacts = (input.artifacts ?? []).filter((a) => a.runId === input.run.id);
  const verified = artifacts.filter((a) => a.available && a.integrity === 'verified');
  const operations = rows.filter(
    (row) =>
      (row.started || row.ended) &&
      ['browser', 'file', 'excel', 'http', 'script', 'desktop', 'mcp'].includes(row.type ?? ''),
  );
  const labels = new Map<string, { completed: number; unresolved: number }>();
  for (const row of operations) {
    const node = nodes.get(row.nodeId);
    const label = (node && operationLabel(node)) || '外部步骤';
    const counts = labels.get(label) ?? { completed: 0, unresolved: 0 };
    if (row.ended) counts.completed++;
    else counts.unresolved++;
    labels.set(label, counts);
  }
  const describe = (state: 'completed' | 'unresolved') =>
    [...labels]
      .filter(([, counts]) => counts[state] > 0)
      .map(([label, counts]) => `${label} ${counts[state]} 次`)
      .join('、');
  const completedOperations = describe('completed');
  const unresolvedOperations = describe('unresolved');
  const mayOverwrite = ['写入文件', '复制文件', '打包文件', '写入表格', '填充表格'].some((label) =>
    labels.has(label),
  );
  const effectNote = labels.size
    ? [
        completedOperations && `步骤回执已完成：${completedOperations}。`,
        unresolvedOperations && `已开始但未确认完成：${unresolvedOperations}。`,
        mayOverwrite && '文件副本不表示原位置没有覆盖。',
        (labels.has('网络请求') || labels.has('操作网页') || labels.has('工具调用')) &&
          '外部结果需结合业务回执核对。',
        labels.has('执行脚本') && '脚本可能还有未报告的操作。',
      ]
        .filter(Boolean)
        .join('')
    : uncertain
      ? '当前记录不足以核对外部影响。'
      : '未记录文件、网页、网络、脚本、工具或应用步骤的执行。';
  return {
    desktop,
    view,
    mode,
    title: desktop && (desktop.needsReview || success) ? desktop.title : title,
    terminal,
    uncertain,
    success,
    rows,
    completed,
    unresolved,
    unvisited,
    current,
    node: current ? nodes.get(current.nodeId) : undefined,
    artifacts,
    verified,
    operations,
    summary: desktop
      ? desktop.title
      : artifacts.length
        ? `已登记 ${artifacts.length} 个文件产物，${verified.length} 个副本已核对`
        : `已记录 ${completed.length} 次完成的步骤`,
    effectNote: desktop?.effect ?? effectNote,
  };
}
