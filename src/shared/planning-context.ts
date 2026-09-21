import type { PlanningContext } from './planning';
import { webContext, type TaskWebTarget } from './task-web-target';
import { outputContext, type TaskOutputTarget } from './task-output';

export function taskPlanningContext(
  context: readonly PlanningContext[],
  web?: TaskWebTarget,
  output?: TaskOutputTarget,
  attachments: readonly PlanningContext[] = [],
): PlanningContext[] {
  const entries = [
    ...context,
    ...attachments,
    ...(web ? [webContext(web, output)] : []),
    ...(output ? [outputContext(output)] : []),
  ];
  if (entries.length > 20) throw new Error('附件、网页和输出均计入上下文，全部资料最多 20 项');
  if (
    entries.some((e) => e.text.length > 50000) ||
    entries.reduce((n, e) => n + e.text.length, 0) > 200000
  )
    throw new Error('包含所选网页和输出的上下文超过文本上限');
  return entries;
}
