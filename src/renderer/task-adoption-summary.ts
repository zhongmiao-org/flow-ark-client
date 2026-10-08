import type { TaskDetail } from '../shared/planning';
import { flatten } from './flow-editing';
import { taskStepSummary, taskStepTitle } from './task-step-presentation';

const fieldLabels: Record<string, string> = {
  name: '方案名称',
  description: '方案说明',
  parameters: '输入参数',
  requiredCapabilities: '所需能力',
  sourceTemplate: '模板来源',
};
const kindLabels = { added: '新增', removed: '移除', changed: '修改', moved: '调整位置' };

export function taskAdoptionSummary(detail: TaskDetail): string | undefined {
  const { adoption, flow: record } = detail;
  if (
    !adoption ||
    adoption.version !== 1 ||
    !record ||
    detail.proposal ||
    detail.proposalRejected ||
    !detail.canUndo
  )
    return undefined;
  const flow = record.flow;
  const steps = flatten(flow.steps);
  if (adoption.created)
    return `已采纳方案，共 ${steps.length} 个步骤（含分支和循环内步骤）。你可以继续修改，或检查后试运行。`;

  const changed = adoption.steps[0];
  const current = changed && steps.find((step) => step.id === changed.id);
  if (
    adoption.stepCount === 1 &&
    changed?.kinds.length === 1 &&
    changed.kinds[0] === 'changed' &&
    current &&
    !adoption.flowFields.length
  ) {
    const summary = taskStepSummary(current, flow, {
      bindings: record.bindings,
      webTarget: detail.task.webTarget,
      outputTarget: detail.task.outputTarget,
      toolTargets: detail.task.toolTargets,
    });
    return `已采纳修改：第 ${steps.indexOf(current) + 1} 步「${taskStepTitle(current)}」。当前设置：${summary}。其他步骤保持原样。`;
  }

  const parts = adoption.steps.map((step) => {
    const name = step.name.replace(/\s+/g, ' ').trim();
    return `${step.kinds.map((kind) => kindLabels[kind]).join('并')}「${name.length > 80 ? name.slice(0, 79) + '…' : name}」`;
  });
  if (adoption.stepCount > adoption.steps.length)
    parts.push(`另有 ${adoption.stepCount - adoption.steps.length} 个步骤发生变化`);
  if (adoption.flowFields.length)
    parts.push(
      `更新${adoption.flowFields.map((field) => fieldLabels[field] ?? '方案设置').join('、')}`,
    );
  return parts.length
    ? `已采纳修改：${parts.join('；')}。当前草稿共 ${steps.length} 个步骤。`
    : '已采纳方案，流程内容与采纳前一致。';
}
