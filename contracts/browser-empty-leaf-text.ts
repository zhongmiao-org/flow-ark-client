/** Normative format/association reference only; no DOM execution or proof of leaf eligibility. */
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';
import {
  assertBrowserSelectionTextNode,
  assertBrowserSelectionTextInvocation,
  assertBrowserSelectionTextResult,
  browserSelectionTextLimits,
} from './browser-selection-text';

export const browserEmptyLeafTextCapability = 'browser-empty-leaf-text-v1';
export const browserEmptyLeafTextPolicy = 'bounded-selection-text-v2';
export const browserEmptyLeafTextLimits = { ...browserSelectionTextLimits, excludedHiddenEmptyLeaves: 2000 };
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
function shape(name: string, value: unknown) {
  const validate = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validate(value)) throw Error('隐藏空叶子文字格式无效：' + name + ' ' + ajv.errorsText(validate.errors));
}
const priorNode = (value: any) => ({ ...value, version: 9, renderPolicy: 'bounded-selection-text-v1' });
function priorResult(value: any) {
  return {
    ...value,
    version: 4,
    renderPolicy: 'bounded-selection-text-v1',
    fields: value.fields.map(({ excludedHiddenEmptyLeaves, ...field }: any) => field),
  };
}
export function assertBrowserEmptyLeafTextNode(value: unknown, resolved = false): any {
  shape('BrowserEmptyLeafTextFieldsNode', value);
  assertBrowserSelectionTextNode(priorNode(value), resolved);
  return value;
}
export function assertBrowserEmptyLeafTextInvocation(source: unknown, value: unknown): any {
  assertBrowserEmptyLeafTextNode(source);
  shape('BrowserEmptyLeafTextFieldsInvocation', value);
  assertBrowserSelectionTextInvocation(priorNode(source), priorNode(value));
  return value;
}
export function assertBrowserEmptyLeafTextResult(source: unknown, value: unknown): any {
  assertBrowserEmptyLeafTextNode(source, true);
  shape('BrowserEmptyLeafTextFieldsResult', value);
  const result = value as any;
  assertBrowserSelectionTextResult(priorNode(source), priorResult(result));
  let excluded = 0;
  for (const field of result.fields) {
    if ((field.operation !== 'selection-text' || field.count !== 1) && field.excludedHiddenEmptyLeaves !== 0)
      throw Error('非选区或非唯一字段不得声明隐藏空叶子排除');
    excluded += field.excludedHiddenEmptyLeaves;
  }
  if (excluded > browserEmptyLeafTextLimits.scanElements ||
      new TextEncoder().encode(JSON.stringify(result)).length > browserEmptyLeafTextLimits.resultBytes)
    throw Error('隐藏空叶子排除总数或完整结果字节超限');
  return value;
}
export function assertBrowserEmptyLeafTextCapabilities(value: any, capabilities: string[], manifest?: any, entry?: any) {
  if (value?.type !== 'browser' || value.version !== 10) return;
  assertBrowserEmptyLeafTextNode(value);
  const required = ['browser', browserEmptyLeafTextCapability];
  if (!required.every(capability => capabilities.includes(capability)))
    throw Error('隐藏空叶子文字节点缺少browser或独立能力');
  if (!manifest) return;
  if (!entry || !required.every(capability => entry.capabilities?.includes(capability)) ||
      !manifest.resources.some((resource: any) => resource.kind === 'browser' && resource.access === 'use' && entry.resources?.includes(resource.id)))
    throw Error('隐藏空叶子文字入口未声明自己的能力及browser/use资源');
}
