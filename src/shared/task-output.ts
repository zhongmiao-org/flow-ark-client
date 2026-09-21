import { z } from 'zod';
import { staticUploadFields } from './upload-source';
import { resolveValue } from '../core/engine';
import { validateCreatedText } from './file-create';
import type { Flow, Step } from './types';
import type { PlanningContext } from './planning';

export const OUTPUT_BINDING = 'task_output';
export const OUTPUT_CONTEXT_ID = '_flowark_selected_output';
export type TaskOutputTarget = {
  selectionId: string;
  taskId: string;
  directory: string;
  dev: string;
  ino: string;
  name: string;
  onConflict: 'number' | 'overwrite';
  selectedAt: string;
};
const version = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  revision: z
    .number()
    .int()
    .min(1)
    .max(Number.MAX_SAFE_INTEGER - 1),
};
const options = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (v) => !/[\\/\x00-\x1f\x7f:]/.test(v) && !['.', '..'].includes(v),
      '请输入不含路径的文件名',
    ),
  onConflict: z.enum(['number', 'overwrite']),
};
export const outputMethods = {
  'task.output.choose': z.object({ ...version, ...options }).strict(),
  'task.output.configure': z.object({ ...version, ...options }).strict(),
  'task.output.clear': z.object(version).strict(),
};
export function outputContext(target: TaskOutputTarget): PlanningContext {
  return {
    id: OUTPUT_CONTEXT_ID,
    kind: 'text',
    label: '已选输出 · 路径留在本机',
    text: JSON.stringify(
      {
        binding: OUTPUT_BINDING,
        name: target.name,
        onConflict: target.onConflict,
        rule:
          target.onConflict === 'number'
            ? '在用户已选目录新建文本，同名自动加序号，保留原文件；使用 file version 4 operation create onConflict number，声明 file-create-numbered-v1。'
            : '用户明确选择覆盖该文件；使用 file version 1 operation write，声明 file 能力。只允许这个固定文件名，不读取输出目录。',
      },
      null,
      2,
    ),
  };
}
export function selectedOutputWrite(node: Step, target?: TaskOutputTarget): boolean {
  return (
    !!target &&
    target.onConflict === 'overwrite' &&
    node.type === 'file' &&
    node.binding === OUTPUT_BINDING &&
    node.name === target.name &&
    node.version === 1 &&
    node.operation === 'write'
  );
}
export function assertOutputFlow(flow: Flow, target: TaskOutputTarget) {
  let outputs = 0;
  const visit = (steps: Step[]) => {
    for (const node of steps) {
      // Script SDK receives the complete binding map. Until it has a matching per-call
      // output guard it cannot run under this constrained output selection.
      if (node.type === 'browser' && node.operation === 'upload') {
        const source = staticUploadFields(node.value, flow.parameters);
        if (!source?.binding.known || source.binding.value === OUTPUT_BINDING)
          throw new Error('网页上传不能读取所选输出目录');
      }
      if (node.type === 'script')
        throw new Error('带固定输出选择的任务暂不支持脚本，请使用文本文件步骤');
      if ((node.type === 'file' || node.type === 'excel') && node.binding === OUTPUT_BINDING) {
        if (
          !(
            selectedOutputWrite(node, target) ||
            (target.onConflict === 'number' &&
              node.type === 'file' &&
              node.version === 4 &&
              node.operation === 'create' &&
              node.onConflict === 'number' &&
              node.name === target.name)
          )
        )
          throw new Error('方案必须使用已选输出的固定文件名和同名处理规则');
        if (node.type === 'file' && 'content' in node) {
          const content = node.content;
          const deferred =
            content &&
            typeof content === 'object' &&
            !Array.isArray(content) &&
            Object.keys(content).length === 1 &&
            '$ref' in content &&
            typeof content.$ref === 'string' &&
            /^(steps\.|item(?:\.|$)|index$)/.test(content.$ref);
          if (!deferred) validateCreatedText(resolveValue(content, { params: flow.parameters }));
        }
        outputs++;
      }
      if (node.type === 'condition') {
        visit(node.then);
        visit(node.else);
      }
      if (node.type === 'loop') visit(node.body);
    }
  };
  visit(flow.steps);
  if (!outputs) throw new Error('方案未使用已选输出目录，请重新核对需求与方案');
}
