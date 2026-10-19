import { assertSkillUpdateNode } from '../../contracts/skill-update-review';
import { assertEffectNodeCapabilities, effectNodeCapability } from '../../contracts/effect-node';
import {
  assertBrowserFieldsNode,
  browserFieldsCapability,
  browserRenderedFieldsCapability,
  browserScopedRenderedFieldsCapability,
  browserFieldsCapabilityFor,
} from '../shared/browser-fields';
import { assertContinuousConversationCapabilities } from '../../contracts/continuous-conversation';
import { assertConversationSourceNode } from '../../contracts/conversation-source';
import { assertRunResultNode } from '../../contracts/run-result-binding';
import { sourceCapability } from '../shared/conversation-source';
import { assertSourceReductionNode } from '../../contracts/source-reduction';
import { skillCapability, skillBudget, skillUpdateCapability } from '../shared/skill';
import {
  browserInspectionCapability,
  assertBrowserInspectionNode,
} from '../shared/browser-inspection';
import { templateDataCapability } from '../shared/template-data';
import { conversationCapability, assertConversationNode } from '../shared/conversation';
import { documentCapability, assertDocumentNode } from '../shared/document';
import { aiNodeCapability, assertAIRequest } from '../shared/ai-node';
import { aiOutcomeCapability } from '../shared/ai-outcome';
import { assertAIOutcomeCapabilities } from '../../contracts/ai-outcome';
import { resolveParameterSources, parameterSourceCapability } from '../shared/parameter-sources';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../contracts/p1.schema.json';
import type { Flow, Step } from '../shared/types';
import { framePathOf, validateFormCommand } from './browser-command';
import { declaredDependencies } from './script-dependencies';
import { referenceIssues } from '../shared/flow-references';
import { mappingPreview } from '../shared/excel-mapping';
import { validateFileCreate } from '../shared/file-create';
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(schema);
export function validateObject<T>(name: string, value: unknown): T {
  const validator = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validator(value))
    throw new Error(
      `格式无效 (${name}): ` + ajv.errorsText(validator.errors, { separator: '; ' }).slice(0, 1500),
    );
  return value as T;
}
export const capabilities = [
  effectNodeCapability,
  'source-reduce-v1',
  'source-reduce',
  sourceCapability,
  'source',
  'run-result',
  'run-result-read-v1',
  browserInspectionCapability,
  browserFieldsCapability,
  browserRenderedFieldsCapability,
  browserScopedRenderedFieldsCapability,
  'conversation-evidence-v1',
  'conversation-v2',
  'conversation-checkpoint-v1',
  'skill-trial-v1',
  templateDataCapability,
  'context',
  skillCapability,
  skillUpdateCapability,
  'skill',
  documentCapability,
  'document',
  conversationCapability,
  'conversation',
  aiNodeCapability,
  aiOutcomeCapability,
  parameterSourceCapability,
  'desktop-selection-v1',
  'mcp-tool-v1',
  'value',
  'assert',
  'http',
  'script',
  'file',
  'file-create-v1',
  'file-create-numbered-v1',
  'excel',
  'excel-mapping-v1',
  'browser',
  'browser-frames-v1',
  'browser-forms-v1',
  'human',
  'human-review-v1',
  'condition',
  'loop',
  'openai-codex',
  'deepseek',
  'template-sdk-v1',
  'ai',
  'state',
  'attention',
  'effect',
];
export function validateFlow(value: unknown): Flow {
  const flow = validateObject<Flow>('FlowDefinition', value);
  for (const c of flow.requiredCapabilities)
    if (!capabilities.includes(c)) throw new Error('缺少能力：' + c);
  if (
    Object.keys(flow.parameterSources ?? {}).length &&
    !flow.requiredCapabilities.includes(parameterSourceCapability)
  )
    throw new Error('参数来源需要声明 parameter-sources-v1 能力');
  const parameters = resolveParameterSources(flow);
  const all = new Set<string>();
  let count = 0;
  function block(steps: Step[], depth: number) {
    if (depth > 16) throw new Error('流程嵌套超过 16 层');
    for (const n of steps) {
      if (++count > 1000 || all.has(n.id)) throw new Error('节点数量过多或 ID 重复：' + n.id);
      all.add(n.id);
      assertEffectNodeCapabilities(n, flow.requiredCapabilities);
      assertConversationSourceNode(n, flow.requiredCapabilities);
      assertSourceReductionNode(n, flow.requiredCapabilities);
      assertSkillUpdateNode(n, flow.requiredCapabilities);
      if (n.type === 'context' && !flow.requiredCapabilities.includes(templateDataCapability))
        throw Error('配置与状态需要声明template-data-v1能力');
      if (n.type === 'run-result') assertRunResultNode(n, flow.requiredCapabilities);
      if (n.type === 'skill') {
        if (!flow.requiredCapabilities.includes(skillCapability))
          throw Error('Skill需要声明skill-v1能力');
        skillBudget(n);
      }
      if (n.type === 'document') {
        if (!flow.requiredCapabilities.includes(documentCapability))
          throw new Error('资料解析需要声明 document-extract-v1 能力');
        assertDocumentNode(n);
      }
      if (n.type === 'conversation' && n.version === 2) {
        assertContinuousConversationCapabilities(n, flow.requiredCapabilities);
      }
      if (n.type === 'conversation' && n.version === 1) {
        if (!flow.requiredCapabilities.includes(conversationCapability))
          throw new Error('引导会话需要声明 conversation-v1 能力');
        assertConversationNode(n);
      }
      if (n.type === 'ai') {
        assertAIOutcomeCapabilities(n, flow.requiredCapabilities);
        if (!flow.requiredCapabilities.includes(aiNodeCapability))
          throw new Error('AI 节点需要声明 ai-node-v1 能力');
        assertAIRequest(n);
      }
      if (n.type === 'desktop') {
        if (!flow.requiredCapabilities.includes('desktop-selection-v1'))
          throw new Error('应用选区步骤需要声明 desktop-selection-v1 能力');
        if (!n.text.trim() || n.text.length > 20000)
          throw new Error('替换文字必须为 1 至 20000 个 UTF-16 单元的非空纯文本');
      }
      if (n.type === 'mcp') {
        if (!flow.requiredCapabilities.includes('mcp-tool-v1'))
          throw new Error('工具步骤需要声明 mcp-tool-v1 能力');
        if (!n.arguments || typeof n.arguments !== 'object' || Array.isArray(n.arguments))
          throw new Error('工具参数必须为对象或对象引用');
      }
      if (n.type === 'file' && n.operation === 'create') {
        const capability = n.version === 4 ? 'file-create-numbered-v1' : 'file-create-v1';
        if (!flow.requiredCapabilities.includes(capability))
          throw new Error('新建文本文件需要声明 ' + capability + ' 能力');
        validateFileCreate(n, parameters);
      }
      if (n.type === 'excel' && n.operation === 'map') {
        if (!flow.requiredCapabilities.includes('excel-mapping-v1'))
          throw new Error('Excel 字段映射需要声明 excel-mapping-v1 能力');
        mappingPreview(n, parameters);
      }
      if (n.type === 'browser') {
        if (n.version === 5 || n.version === 6 || n.version === 7) {
          assertBrowserFieldsNode(n);
          if (
            !['browser', browserFieldsCapabilityFor(n.version)].every((c) =>
              flow.requiredCapabilities.includes(c),
            )
          )
            throw Error('关联采集节点缺少其版本对应的browser和采集能力');
        }
        if (n.version === 4) {
          if (!flow.requiredCapabilities.includes(browserInspectionCapability))
            throw Error('网页只读节点需要声明browser-observe-v1能力');
          assertBrowserInspectionNode(n);
        }
        framePathOf(n);
        validateFormCommand(n, true);
      }
      if (n.type === 'condition') {
        block(n.then, depth + 1);
        block(n.else, depth + 1);
      }
      if (n.type === 'loop') block(n.body, depth + 1);
    }
  }
  block(flow.steps, 0);
  const issue = referenceIssues(flow.steps, parameters)[0];
  if (issue) throw new Error(`${issue.message}：${issue.reference}（${issue.nodeId}）`);
  declaredDependencies(walk(flow.steps));
  return flow;
}
export function walk(steps: Step[]): Step[] {
  return steps.flatMap((n) => [
    n,
    ...(n.type === 'condition'
      ? [...walk(n.then), ...walk(n.else)]
      : n.type === 'loop'
        ? walk(n.body)
        : []),
  ]);
}
