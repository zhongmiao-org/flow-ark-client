import { assertBrowserVisibleTextCapabilities } from './browser-visible-text';
import { assertBrowserEmptyLeafTextCapabilities } from './browser-empty-leaf-text';
import { assertAIGenerationCapabilities } from './ai-generation';
import { assertBrowserSelectionTextCapabilities } from './browser-selection-text';
import { assertBrowserTargetCapabilities } from './browser-target-input';
import { assertRunResultNode, assertRunResultResources } from './run-result-binding';
import { assertEffectNodeCapabilities } from './effect-node';
import { assertBrowserRenderedFieldsCapabilities } from './browser-rendered-fields';
import { assertBrowserFieldsCapabilities } from './browser-fields';
import { assertSkillUpdateNode } from './skill-update-review';
import { assertSourceReductionNode } from './source-reduction';
import { assertConversationSourceNode } from './conversation-source';
import { assertContinuousConversationCapabilities } from './continuous-conversation';
/** Normative author definitions and optional portable metadata, contracts 0.31.0. */
import { assertDirectoryDefaults } from './directory-defaults';
import { assertAIOutcomeCapabilities } from './ai-outcome';
import Ajv from 'ajv/dist/2020.js';
import schema from './p1.schema.json';
import { validateConfigurationSchema } from './configuration-schema';

export const AUTHOR_LIMITS = { bytes: 2 * 1024 * 1024, values: 50000, depth: 40, bindings: 1000 };
export const AUTHOR_METADATA_PATH = 'assets/template-author.json';
export const authorPromptMarker = (id: string) => '@author:prompt/' + id;
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
function shape(name: string, value: unknown) {
  const validate = ajv.getSchema(schema.$id + '#/$defs/' + name)!;
  if (!validate(value)) throw Error(name + '无效：' + ajv.errorsText(validate.errors));
}
function unique(items: string[], label: string) {
  if (new Set(items).size !== items.length) throw Error(label + '重复');
}
function utf8(bytes: Uint8Array) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
function path(value: string) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,239}$/.test(value) ||
    value.split('/').some((p) => !p || p === '.' || p === '..') ||
    /(^|\/)node_modules(\/|$)/i.test(value) ||
    /\.(node|exe|dll|dylib|so|app|dmg)$/i.test(value)
  ) throw Error('作者资源路径无效');
}
function budget(value: unknown) {
  let count = 0;
  const stack = new Set<object>();
  const visit = (v: any, depth: number) => {
    if (++count > AUTHOR_LIMITS.values || depth > AUTHOR_LIMITS.depth)
      throw Error('作者定义层级或成员数量超限');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') {
      if (utf8(Buffer.from(v, 'utf8')) !== v) throw Error('作者定义包含无效Unicode');
      return;
    }
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (!v || typeof v !== 'object' || stack.has(v) ||
      (!Array.isArray(v) && ![null, Object.prototype].includes(Object.getPrototypeOf(v))))
      throw Error('作者定义只允许有限JSON数据');
    stack.add(v);
    for (const [key, child] of Object.entries(v)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw Error('作者定义包含保留字段键');
      visit(child, depth + 1);
    }
    stack.delete(v);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > AUTHOR_LIMITS.bytes)
    throw Error('作者定义超过2MiB');
}
function localSchema(value: any) {
  const visit = (v: any) => {
    if (!v || typeof v !== 'object') return;
    for (const [key, child] of Object.entries(v)) {
      if (key === '$id' || ((key === '$ref' || key === '$dynamicRef') &&
        (typeof child !== 'string' || !child.startsWith('#/'))))
        throw Error('作者Schema禁止外部引用或自定义身份');
      visit(child);
    }
  };
  visit(value);
  new Ajv({ strict: false, allErrors: true }).compile(value);
}
function nodes(steps: any[], depth = 0, result: any[] = []): any[] {
  if (depth > 16) throw Error('作者流程层级超限');
  for (const n of steps) {
    if (result.length >= 1000) throw Error('作者入口节点超过1000个');
    result.push(n);
    if (n.type === 'condition') {
      nodes(n.then, depth + 1, result);
      nodes(n.else, depth + 1, result);
    }
    if (n.type === 'loop') nodes(n.body, depth + 1, result);
  }
  return result;
}

/** Saves may contain zero entries; compilation separately requires at least one. */
export function validateAuthorDefinition(value: unknown): any {
  budget(value);
  shape('TemplateAuthorDefinition', value);
  assertRunResultResources(value);
  const d = value as any;
  unique(d.entries.map((e: any) => e.id), '作者入口');
  unique(d.resources.map((r: any) => r.id), '作者资源');
  assertDirectoryDefaults(d.resources);
  unique(d.actions.map((a: any) => a.id), '作者动作');
  unique(d.prompts.map((p: any) => p.id), '作者提示词');
  if (d.readme.length > 60000 || d.prompts.some((p: any) => p.body.length > 60000))
    throw Error('公开正文超过60000个UTF-16字符');
  unique(d.assets.map((a: any) => a.path.toLowerCase()), '作者资产');
  unique(d.dependencies.map((a: any) => a.name), '作者依赖声明');
  for (const r of d.resources)
    if (['browser', 'ai'].includes(r.kind) ? r.access !== 'use' : r.access === 'use')
      throw Error('作者资源访问形式不一致：' + r.id);
  validateConfigurationSchema(d.configurationSchema);
  localSchema(d.configurationSchema);
  localSchema(d.stateSchema);
  let bindings = 0;
  for (const entry of d.entries) {
    validateConfigurationSchema(entry.inputSchema);
    localSchema(entry.inputSchema);
    localSchema(entry.resultSchema);
    for (const id of entry.resourceIds)
      if (!d.resources.some((r: any) => r.id === id)) throw Error('入口引用未知资源：' + id);
    for (const id of entry.actionIds)
      if (!d.actions.some((a: any) => a.id === id)) throw Error('入口引用未知动作：' + id);
    const steps = nodes(entry.flow.steps);
    for (const node of steps) {
      assertRunResultNode(node, entry.flow.requiredCapabilities, d, { capabilities: entry.capabilities, resources: entry.resourceIds });
      assertEffectNodeCapabilities(node, entry.flow.requiredCapabilities, d, { capabilities: entry.flow.requiredCapabilities, actions: entry.actionIds });
      assertBrowserRenderedFieldsCapabilities(node, entry.flow.requiredCapabilities, d, { resources: entry.resourceIds });
      assertBrowserFieldsCapabilities(node, entry.flow.requiredCapabilities, d, { resources: entry.resourceIds });
      assertBrowserTargetCapabilities(node, entry.flow.requiredCapabilities, d, { capabilities: [...entry.flow.requiredCapabilities, ...entry.capabilities], resources: entry.resourceIds, actions: entry.actionIds });
      assertBrowserSelectionTextCapabilities(node, entry.flow.requiredCapabilities, d, { capabilities: [...entry.flow.requiredCapabilities, ...entry.capabilities], resources: entry.resourceIds });
      assertBrowserEmptyLeafTextCapabilities(node, entry.flow.requiredCapabilities, d, { capabilities: [...entry.flow.requiredCapabilities, ...entry.capabilities], resources: entry.resourceIds });
      assertBrowserVisibleTextCapabilities(node, entry.flow.requiredCapabilities, d, { capabilities: [...entry.flow.requiredCapabilities, ...entry.capabilities], resources: entry.resourceIds });
      assertAIOutcomeCapabilities(node, entry.flow.requiredCapabilities);
      assertAIGenerationCapabilities(node, entry.flow.requiredCapabilities, d, { capabilities: [...entry.flow.requiredCapabilities, ...entry.capabilities], resources: entry.resourceIds });
      assertContinuousConversationCapabilities(node, entry.flow.requiredCapabilities);
      assertConversationSourceNode(node, entry.flow.requiredCapabilities, d, { capabilities: entry.flow.requiredCapabilities, resources: entry.resourceIds });
      assertSourceReductionNode(node, entry.flow.requiredCapabilities, d, { capabilities: entry.flow.requiredCapabilities, resources: entry.resourceIds });
      assertSkillUpdateNode(node, entry.flow.requiredCapabilities, d, { capabilities: entry.flow.requiredCapabilities, resources: entry.resourceIds });
      if (node.type === 'conversation' && node.version === 2) {
        const r = d.resources.find((r: any) => r.id === node.binding);
        if (!entry.resourceIds.includes(node.binding) || r?.kind !== 'ai' || r.access !== 'use')
          throw Error('持续会话作者入口未声明自己的ai/use资源');
      }
    }
    unique(steps.map((n: any) => n.id), '入口节点');
    unique(entry.promptBindings.map((b: any) => b.nodeId), '入口提示词目标');
    for (const binding of entry.promptBindings) {
      if (++bindings > AUTHOR_LIMITS.bindings) throw Error('提示词绑定总数超限');
      const prompt = d.prompts.find((p: any) => p.id === binding.promptId);
      const n = steps.find((n: any) => n.id === binding.nodeId);
      if (!prompt || !n || !['ai', 'conversation', 'source-reduce'].includes(n.type) ||
        n.instructions !== authorPromptMarker(prompt.id))
        throw Error('提示词绑定或正文标记不一致：' + entry.id + '/' + binding.nodeId);
    }
    for (const n of steps)
      if (typeof n.instructions === 'string' && n.instructions.startsWith('@author:prompt/') &&
        !entry.promptBindings.some((b: any) => b.nodeId === n.id))
        throw Error('入口含未绑定的作者提示词标记：' + entry.id + '/' + n.id);
  }
  for (const asset of d.assets) {
    path(asset.path);
    if (asset.path.toLowerCase() === AUTHOR_METADATA_PATH ||
      (asset.path.startsWith('scripts/') && !asset.path.endsWith('.js')))
      throw Error('附加公开文件占用保留路径或不是静态JS脚本');
    if (asset.encoding === 'base64' &&
      Buffer.from(asset.body, 'base64').toString('base64') !== asset.body)
      throw Error('作者资产Base64编码无效：' + asset.path);
  }
  return d;
}

/** Metadata explains editing only; executable flows already contain exact prompt text. */
export function validateAuthorMetadata(
  files: Map<string, Buffer>,
  manifest: { entries: { id: string; flow: string }[] },
): void {
  const bytes = files.get(AUTHOR_METADATA_PATH);
  if (!bytes) return;
  if (bytes.length > AUTHOR_LIMITS.bytes) throw Error('作者映射超过2MiB');
  const meta = JSON.parse(utf8(bytes));
  budget(meta);
  shape('TemplateAuthorPackageMetadata', meta);
  unique(meta.prompts.map((p: any) => p.id), '公开提示词键');
  unique(meta.prompts.map((p: any) => p.path.toLowerCase()), '公开提示词路径');
  unique(meta.bindings.map((b: any) => b.entryId + '/' + b.nodeId), '公开提示词目标');
  const prompts = new Map<string, string>();
  for (const prompt of meta.prompts) {
    path(prompt.path);
    if (prompt.path !== 'prompts/' + prompt.id + '.md') throw Error('公开提示词路径与键不一致');
    const body = files.get(prompt.path);
    if (!body || body.length > 4 * 60000) throw Error('公开提示词缺失或超限');
    const text = utf8(body);
    if (!text.length || text.length > 60000) throw Error('公开提示词字符长度无效');
    prompts.set(prompt.id, text);
  }
  const entries = new Map<string, any[]>();
  for (const binding of meta.bindings) {
    const entry = manifest.entries.find((e) => e.id === binding.entryId);
    if (!entry || !prompts.has(binding.promptId)) throw Error('公开提示词绑定对象不存在');
    if (!entries.has(entry.id)) {
      const flow = files.get(entry.flow);
      if (!flow) throw Error('公开提示词目标流程缺失');
      entries.set(entry.id, nodes(JSON.parse(utf8(flow)).steps));
    }
    const node = entries.get(entry.id)!.find((n) => n.id === binding.nodeId);
    if (!node || !['ai', 'conversation', 'source-reduce'].includes(node.type) ||
      node.instructions !== prompts.get(binding.promptId))
      throw Error('公开提示词原文与步骤不一致：' + binding.entryId + '/' + binding.nodeId);
  }
}
