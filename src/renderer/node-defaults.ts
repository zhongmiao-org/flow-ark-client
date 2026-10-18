import { defaultAISchema } from '../shared/ai-node';
import type { Step } from '../shared/types';

export function newStep(type: string): Step {
  const defaults: Record<string, object> = {
    'source-reduce': {
      name: '分批整理来源',
      binding: 'source',
      aiBinding: 'ai',
      instructions:
        '按时间整理当前来源片段并保留上一草稿；区分原始材料、本人更正和助手建议，未知信息保持未知。',
      schema: defaultAISchema,
      seed: { answer: '' },
      maxRequests: 8,
    },
    'run-result': { name: '读取已保存结果', operation: 'read', binding: 'previous-result' },
    source: { name: '读取来源清单', operation: 'manifest', binding: 'source' },
    context: { operation: 'configuration' },
    effect: { operation: 'prepare', action: '', key: '', timeoutMs: 600000 },
    skill: {
      operation: 'propose',
      binding: 'workspace',
      key: 'personal-profile',
      title: '个人Skill',
      markdown: '',
      data: {},
      evidence: [],
      base: null,
    },
    document: { binding: 'materials', file: '示例资料.pdf' },
    value: { value: '你好，序舟' },
    assert: { actual: true, operator: 'equals', expected: true },
    conversation: {
      version: 2,
      binding: 'ai',
      key: 'main',
      title: '补充材料',
      instructions: '围绕用户明确选择的材料提问；未知信息保持未知。',
      input: {},
      historyWindow: 12,
    },
    ai: {
      version: 2,
      failureMode: 'stop',
      binding: 'ai',
      instructions: '按输入整理结果，未知信息明确说明。',
      input: {},
      schema: defaultAISchema,
    },
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
