import type { Step } from './types';
export type ReferenceIssue = { nodeId: string; reference: string; message: string };
const badKeys = new Set(['__proto__', 'constructor', 'prototype']);
/** Only control-flow children are structural; an HTTP body is an input value. */
export function nodeReferenceValues(node: Step) {
  if (node.type === 'condition') {
    const { then, else: otherwise, ...values } = node;
    return values;
  }
  if (node.type === 'loop') {
    const { body, ...values } = node;
    return values;
  }
  return node;
}
/** Shared by draft structure edits and the authoritative save/run validator. */
export function referenceIssues(
  steps: Step[],
  parameters: Record<string, unknown>,
): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  function values(value: any, scope: Set<string>, inLoop: boolean, nodeId: string) {
    if (!value || typeof value !== 'object') return;
    const issue = (reference: string, message: string) =>
      issues.push({ nodeId, reference, message });
    if ('$ref' in value) {
      if (Object.keys(value).length !== 1 || typeof value.$ref !== 'string') {
        issue(String(value.$ref), '引用必须是单键 $ref 对象');
        return;
      }
      const [root, id] = value.$ref.split('.');
      if (value.$ref.split('.').some((p: string) => !p || badKeys.has(p)))
        issue(value.$ref, '非法引用属性或空路径段');
      else if (
        root === 'steps'
          ? !id || !scope.has(id)
          : root === 'params'
            ? !id || !Object.hasOwn(parameters, id)
            : root === 'item'
              ? !inLoop
              : root === 'index'
                ? !inLoop || id !== undefined
                : true
      )
        issue(value.$ref, '引用不存在或作用域越界');
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (badKeys.has(key)) issue(key, '非法属性');
      values(child, scope, inLoop, nodeId);
    }
  }
  function block(nodes: Step[], inherited: Set<string>, inLoop: boolean) {
    const scope = new Set(inherited);
    for (const node of nodes) {
      values(nodeReferenceValues(node), scope, inLoop, node.id);
      if (node.type === 'condition') {
        block(node.then, scope, inLoop);
        block(node.else, scope, inLoop);
      }
      if (node.type === 'loop') block(node.body, scope, true);
      scope.add(node.id);
    }
  }
  block(steps, new Set(), false);
  return issues;
}
