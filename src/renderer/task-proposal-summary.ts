import type { TaskDetail } from '../shared/planning';
import { flatten } from './flow-editing';
import { taskStepSummary, taskStepTitle } from './task-step-presentation';

/** Describe the validated proposal and host diff, without interpreting model prose. */
export function taskProposalSummary(detail: TaskDetail): string | undefined {
  const proposal = detail.proposal;
  if (proposal?.result.kind !== 'plan' || !proposal.result.flow) return undefined;
  const flow = proposal.result.flow;
  const steps = flatten(flow.steps);
  if (!proposal.baseFlow)
    return `已生成 ${steps.length} 个步骤（含分支和循环内步骤）。请核对右侧方案，你可以继续修改要求，或打开完整流程图。`;

  const affected = new Set(
    detail.changes.flatMap((change) => (change.nodeId ? [change.nodeId] : [])),
  );
  const fields = detail.changes.filter((change) => !change.nodeId).length;
  const current = steps.find((step) => affected.has(step.id));
  const configurationOnly = detail.changes
    .filter((change) => change.nodeId)
    .every((change) => change.kind === 'changed');
  const settings = fields ? `另有 ${fields} 项流程设置变化。` : '';
  if (affected.size === 1 && current && configurationOnly)
    return `建议修改第 ${steps.indexOf(current) + 1} 步「${taskStepTitle(current)}」：${taskStepSummary(current, flow, detail.task)}。${settings}请核对差异，采纳后才会更新草稿。`;
  if (!detail.changes.length) return '本次提案与原流程内容一致。你可以继续调整要求，或保留原方案。';
  return `本次提案涉及 ${affected.size} 个步骤${fields ? `和 ${fields} 项流程设置` : ''}，共 ${detail.changes.length} 项差异。请核对原值与新值，采纳后才会更新草稿。`;
}
