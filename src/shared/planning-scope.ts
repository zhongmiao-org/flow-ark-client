import { z } from 'zod';

export const planningScopeSchema = z
  .object({
    nodeId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    baseFlowHash: z.string().regex(/^[a-f0-9]{64}$/),
    instruction: z.string().max(10000),
  })
  .strict();
export type PlanningScope = z.infer<typeof planningScopeSchema>;

// Shared by the sending disclosure and Host so the displayed instruction is exact.
export function scopedDescription(scope: PlanningScope) {
  return [
    `本次只修改步骤 ${scope.nodeId} 自身的配置。返回完整流程。`,
    '其他步骤、顺序、身份、类型、版本、条件/循环子步骤、顶层字段、能力和静态资源字段保持不变。',
    '不能更换操作、文件/目录、网页目标或导航地址、HTTP 地址/方法/请求头、脚本依赖。不要新增权限。',
    '如要求超出此范围，返回 unsupported 并说明需要用户明确改为完整任务修改；信息不足返回 clarify。',
    '以下是用户对所选步骤的修改要求：',
    scope.instruction,
  ].join('\n');
}
