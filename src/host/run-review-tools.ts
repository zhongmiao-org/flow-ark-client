import type { FlowRecord, Step } from '../shared/types';
import type { TaskMcpState } from '../shared/task-mcp-targets';
import { reviewMcpArguments } from './mcp-argument-review';
import type { ReviewToolCall } from '../shared/run-review';
import { taskStepTitle } from '../shared/step-title';

/** Never resolves arguments, reads credentials, or contacts a service. */
export function reviewToolCalls(record: FlowRecord, states: TaskMcpState[] = []): ReviewToolCall[] {
  const calls: ReviewToolCall[] = [];
  let ordinal = 0;
  const visit = (steps: Step[], context: string[]) => {
    for (const step of steps) {
      const position = ++ordinal;
      if (step.type === 'mcp') {
        const target = record.toolTargets?.find((entry) => entry.selectionId === step.target);
        const definition = target?.tools.find((entry) => entry.name === step.tool);
        const state = states.find((entry) => entry.selectionId === step.target);
        const current = !!target && !!definition && !!state?.current;
        calls.push({
          step: structuredClone(step),
          ordinal: position,
          context,
          ...(target
            ? {
                target: {
                  displayName: target.displayName,
                  source: target.source,
                  transport: target.transport,
                  protocolVersion: target.protocolVersion,
                  connectionRevision: target.connectionRevision,
                  selectedAt: target.selectedAt,
                },
              }
            : {}),
          ...(definition ? { definition: structuredClone(definition) } : {}),
          argumentCheck: reviewMcpArguments(definition?.inputSchema, step.arguments),
          current,
          reason: !target
            ? '没有匹配的本机工具对象，请回到原任务重新选择。'
            : !definition
              ? '此工具不在保存的选择中，请重新选择并生成完整方案。'
              : current
                ? '已保存选择与当前本机连接记录一致；尚未核对远端、账号与权限。'
                : state?.reason || '尚未核对当前工具对象，请回到原任务检查。',
        });
      }
      if (step.type === 'condition') {
        visit(step.then, [...context, `第 ${position} 步「${taskStepTitle(step)}」条件成立时`]);
        visit(step.else, [...context, `第 ${position} 步「${taskStepTitle(step)}」条件不成立时`]);
      }
      if (step.type === 'loop')
        visit(step.body, [...context, `第 ${position} 步「${taskStepTitle(step)}」的每次循环`]);
    }
  };
  visit(record.flow.steps, []);
  return calls;
}
