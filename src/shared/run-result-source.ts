import { z } from 'zod';
import {
  run_result_request_v1,
  run_result_reference_v1,
  run_result_save_choices_v1,
} from './node-schema.generated';
import type {
  RunResultReference,
  RunResultSaveChoices,
  RunResultRequest,
} from './contracts.generated';
export type {
  RunResultTarget,
  RunResultReference,
  RunResultRead,
  RunResultResource,
  RunResultListResponse,
  RunResultPreviewResponse,
  RunResultSelectResponse,
  RunResultInspectResponse,
  RunResultSaveChoices,
} from './contracts.generated';
/** Budget and legal JSON guard before recursive validators; also safe under Renderer CSP. */
export function resultBudget(value: unknown, limit = 524288): boolean {
  const stack = new Set<object>();
  let count = 0;
  const visit = (v: unknown, depth: number): boolean => {
    if (++count > 100000 || depth > 64) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (
      !v ||
      typeof v !== 'object' ||
      stack.has(v) ||
      (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)
    )
      return false;
    stack.add(v);
    const values = Array.isArray(v) ? v : Object.values(v);
    for (let i = 0; i < values.length; i++)
      if (!Object.hasOwn(values, i) || !visit(values[i], depth + 1)) return false;
    stack.delete(v);
    return true;
  };
  try {
    return visit(value, 0) && new TextEncoder().encode(JSON.stringify(value)).length <= limit;
  } catch {
    return false;
  }
}
export const resultRefSchema = z.custom<RunResultReference>(
  (v) => resultBudget(v) && run_result_reference_v1(v),
  '结果引用格式无效',
);
export const resultChoicesSchema = z.custom<RunResultSaveChoices>(
  (v) => resultBudget(v) && run_result_save_choices_v1(v),
  '结果选择许可格式无效',
);
const method = (name: RunResultRequest['method']) =>
  z
    .unknown()
    .refine(
      (params) => resultBudget(params) && run_result_request_v1({ method: name, params }),
      '结果来源请求格式无效',
    );
export const resultMethods = {
  'resultSource.list': method('resultSource.list'),
  'resultSource.preview': method('resultSource.preview'),
  'resultSource.select': method('resultSource.select'),
  'resultSource.inspect': method('resultSource.inspect'),
};
