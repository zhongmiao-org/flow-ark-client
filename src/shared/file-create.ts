import { resolveValue } from '../core/engine';
import type { Flow, Step } from './types';

export const MAX_TEXT_BYTES = 10 * 1024 * 1024;
export const MAX_CREATED_NAMES = 1000;
export function numberedFilename(name: string, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_CREATED_NAMES)
    throw new Error('文件序号超出支持范围');
  if (!index) return name;
  const slash = name.lastIndexOf('/');
  const dot = name.lastIndexOf('.');
  const split = dot > slash + 1 ? dot : name.length;
  return name.slice(0, split) + ` (${index})` + name.slice(split);
}
export function validateCreatedName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    /[\\\x00-\x1f\x7f:]/.test(name) ||
    name.split('/').some((part) => ['', '.', '..'].includes(part))
  )
    throw new Error('新建文件名必须是绑定目录内的安全相对路径');
}
export function validateCreatedText(content: unknown): asserts content is string {
  if (typeof content !== 'string') throw new Error('新建文本文件的内容必须是文本');
  if (
    content.length > MAX_TEXT_BYTES ||
    new TextEncoder().encode(content).byteLength > MAX_TEXT_BYTES
  )
    throw new Error('新建文本文件的 UTF-8 内容超过 10 MiB');
}
/** Do not execute earlier steps to inspect their output. Known parameters still validate now. */
export function validateFileCreate(
  node: Extract<Step, { type: 'file'; operation: 'create' }>,
  parameters: Flow['parameters'],
) {
  const check = (value: unknown, validate: (value: unknown) => void) => {
    if (
      value &&
      typeof value === 'object' &&
      Object.keys(value).length === 1 &&
      '$ref' in value &&
      typeof value.$ref === 'string' &&
      /^(steps\.|item(?:\.|$)|index$)/.test(value.$ref)
    )
      return;
    validate(resolveValue(value, { params: parameters }));
  };
  check(node.name, validateCreatedName);
  check(node.content, validateCreatedText);
}
