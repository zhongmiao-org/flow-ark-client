import type { Step } from '../shared/types';

export function newStep(type: string): Step {
  const defaults: Record<string, object> = {
    value: { value: '你好，序舟' },
    assert: { actual: true, operator: 'equals', expected: true },
    http: {
      url: 'https://example.com',
      method: 'GET',
      headers: {},
      body: null,
    },
    script: {
      language: 'ts',
      code: 'export default async ({ input, logger, progress }) => {\n  logger.info("开始处理");\n  progress(1, 1);\n  return input;\n};',
      input: {},
      dependencies: [],
    },
    file: {
      operation: 'write',
      binding: 'workspace',
      name: 'result.txt',
      content: '示例',
    },
    excel: {
      operation: 'write',
      binding: 'workspace',
      name: 'result.xlsx',
      rows: [
        ['名称', '数量'],
        ['示例', 1],
      ],
    },
    human: { message: '请完成当前操作后点击继续' },
    condition: {
      actual: true,
      operator: 'equals',
      expected: true,
      then: [],
      else: [],
    },
    loop: { items: [1, 2, 3], body: [] },
  };
  if (!defaults[type]) throw new Error('未知节点类型');
  return {
    id: 'n_' + crypto.randomUUID().slice(0, 8),
    type,
    version: 1,
    ...structuredClone(defaults[type]),
  } as Step;
}
