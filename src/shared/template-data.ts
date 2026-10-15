import { z } from 'zod';
import type { FlowArkP1 } from './contracts.generated';
import type { Step } from './types';
import {
  data_context_v1,
  data_state_v1,
  data_output_v1,
  data_writereceipt_v1,
} from './node-schema.generated';
export type DataContext = NonNullable<FlowArkP1['TemplateDataContext']>;
export type DataState = NonNullable<FlowArkP1['TemplateDataState']>;
export type DataOutput = NonNullable<FlowArkP1['TemplateDataOutput']>;
export type DataReceipt = NonNullable<FlowArkP1['TemplateDataWriteReceipt']>;
export type DataWriteRequest = NonNullable<FlowArkP1['TemplateDataWriteRequest']>;
export type DataEdit = NonNullable<FlowArkP1['TemplateDataEditRequest']>;
export type ContextNode = Extract<Step, { type: 'context' }>;
export const templateDataCapability = 'template-data-v1';
export const contextOperations = {
  configuration: '读取本次配置',
  'state.read': '读取最新状态',
  'state.write': '按修订更新状态',
};
export function assertDataContext(v: unknown): asserts v is DataContext {
  if (!data_context_v1(v)) throw Error('配置与状态上下文格式无效');
}
export function assertDataState(v: unknown): asserts v is DataState {
  if (!data_state_v1(v)) throw Error('状态记录格式无效');
}
export function assertDataOutput(v: unknown): asserts v is DataOutput {
  if (!data_output_v1(v)) throw Error('配置与状态结果格式无效');
}
export function assertDataReceipt(v: unknown): asserts v is DataReceipt {
  if (!data_writereceipt_v1(v)) throw Error('状态写入回执格式无效');
}
const id = z.string().min(1).max(100),
  sha = z.string().regex(/^[a-f0-9]{64}$/);
export const dataMethods = {
  'context.debug.get': z.object({ flowId: id }).strict(),
  'context.debug.save': z.object({ edit: z.unknown() }).strict(),
  'context.operations': z.object({ runId: id }).strict(),
  'context.inspect': z.object({ runId: id, operationId: sha }).strict(),
};
