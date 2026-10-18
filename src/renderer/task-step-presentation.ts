import type { Bindings, Flow, Step } from '../shared/types';
import type { TaskWebTarget } from '../shared/task-web-target';
import type { TaskOutputTarget } from '../shared/task-output';
import type { TaskMcpTarget } from '../shared/task-mcp-targets';
import { browserLabels, taskStepTitle } from './task-step-title';
export { taskStepTitle } from './task-step-title';
import { referenceOf, referenceScope } from './value-references';

export type TaskStepContext = {
  snapshot?: boolean;
  bindings?: Bindings;
  webTarget?: TaskWebTarget;
  outputTarget?: TaskOutputTarget;
  toolTargets?: TaskMcpTarget[];
};
const concise = (value: string, limit = 120) => {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > limit ? line.slice(0, limit - 1) + '…' : line;
};

export function taskStepValue(input: unknown, flow: Flow, stepId: string): string {
  const scope = referenceScope(flow.steps, stepId);
  const reference = referenceOf(input);
  if (reference !== undefined) {
    const [root, key, ...path] = reference.split('.');
    const suffix = path.length ? ' / ' + path.join(' / ') : '';
    if (root === 'steps') {
      const source = scope?.steps.find((node) => node.id === key);
      if (source) return `「${taskStepTitle(source)}」的输出${suffix}`;
    }
    if (root === 'params' && key && Object.hasOwn(flow.parameters, key))
      return `参数「${concise(key)}」${suffix}`;
    if (root === 'item' && scope?.loop)
      return `当前循环项${key ? ' / ' + [key, ...path].join(' / ') : ''}`;
    if (root === 'index' && !key && scope?.loop) return '当前循环序号（从 0 开始）';
    return `引用 ${concise(reference)}（需核对来源）`;
  }
  if (typeof input === 'string')
    return input === '' ? '空文本' : !input.trim() ? '空白文本' : `「${concise(input)}」`;
  if (input === null) return '空值';
  if (input === undefined) return '未设置';
  if (Array.isArray(input)) return `列表（${input.length} 项）`;
  if (typeof input === 'object') return `数据对象（${Object.keys(input).length} 个字段）`;
  if (typeof input === 'boolean') return input ? '是' : '否';
  return String(input);
}

/** Describe the configured plan. Never resolve runtime values or infer execution success. */
export function taskStepSummary(step: Step, flow: Flow, context: TaskStepContext = {}): string {
  const value = (input: unknown) => taskStepValue(input, flow, step.id);
  const resource = (binding: string) => {
    if (binding === 'task_output' && context.outputTarget)
      return `任务输出：${concise(context.outputTarget.directory)}`;
    const path = context.bindings?.files[binding];
    return typeof path === 'string' && path
      ? concise(path)
      : context.snapshot
        ? `资源引用「${concise(binding)}」`
        : `资源「${concise(binding)}」（尚未绑定目录）`;
  };
  const comparison = (node: Extract<Step, { type: 'condition' | 'assert' }>) => {
    const operators = {
      equals: '等于',
      notEquals: '不等于',
      contains: '包含',
      gt: '大于（数字）',
      exists: '不是 null 或未定义',
    };
    return `${value(node.actual)} ${operators[node.operator]}${node.operator === 'exists' ? '' : ' ' + value(node.expected)}`;
  };
  switch (step.type) {
    case 'effect':
      return step.operation === 'prepare'
        ? `准备动作 ${step.action || '尚未选择'} · 同键不再授权，实际动作须以允许执行为真进入`
        : '登记核对结果；仅本次运行的提交中记录可变更，未知不重放';
    case 'context':
      return step.operation === 'configuration'
        ? '读取本次运行固定的共享配置'
        : step.operation === 'state.read'
          ? '读取最新状态与修订；同实例共享，调试副本独立'
          : `按预期修订 ${value(step.expectedRevision)} 替换完整状态；冲突时停止`;
    case 'desktop':
      return `替换已核对的应用选区 · ${step.text.length} 个字符 · 单次授权后修改并回读`;
    case 'value':
      return `输出数据：${value(step.value)}`;
    case 'assert':
      return `检查：${comparison(step)}；不满足则停止并报告失败`;
    case 'condition':
      return `${comparison(step)}；根据结果选择成立或不成立分支`;
    case 'loop':
      return `逐项处理 ${value(step.items)}；循环内串行执行`;
    case 'human':
      return `等待你处理：${concise(step.message)}`;
    case 'script':
      return `${step.language === 'ts' ? 'TypeScript' : 'JavaScript'} 脚本 · 输入：${value(step.input)} · ${step.dependencies.length} 项依赖`;
    case 'conversation':
      return `引导会话「${step.title}」 · 键：${value(step.key)} · ${step.version === 2 ? `历史窗口${step.historyWindow}轮，无总次数限制` : `最多${step.maxRequests}次请求`} · 待用户确认后继续`;
    case 'ai': {
      const binding = context.bindings?.resources?.[step.binding];
      return `AI资源「${step.binding}」 · ${binding?.provider ?? '尚未绑定服务'} / ${binding?.model || '尚未选择模型'} · 输入：${value(step.input)} · ${step.version === 2 ? (step.failureMode === 'result' ? 'v2：请求失败返回状态，取消与资源缺口仍停止' : 'v2：请求失败停止，成功结果在result.output') : 'v1：仅生成结构化结果，请求失败停止'}`;
    }
    case 'http':
      return `${step.method} 请求 · 地址：${value(step.url)}`;
    case 'mcp': {
      const target = context.toolTargets?.find((entry) => entry.selectionId === step.target);
      const tool = target?.tools.find((entry) => entry.name === step.tool);
      return `${target ? concise(target.displayName) : context.snapshot ? '工具对象引用：' + concise(step.target) : '工具对象尚未匹配'} · ${concise(tool?.title || step.tool)} · ${context.snapshot ? '外部影响以调用回执为准' : '试运行前核对外部影响'}`;
    }
    case 'source-reduce':
      return `来源「${step.binding}」 · 本人AI「${step.aiBinding}」 · 本批最多${step.maxRequests}次，保存位置后可继续`;
    case 'source':
      return `来源资源「${step.binding}」 · ${step.operation === 'manifest' ? '读取固定清单与当前性' : '读取一个有界片段'} · 不调用模型`;
    case 'skill':
      return step.operation === 'read'
        ? `Skill资源「${step.binding}」 · 固定确认版本`
        : step.version === 2
          ? `工作区「${step.binding}」 · 保存更新建议，手工内容默认保留`
          : `工作区「${step.binding}」 · 仅创建待确认草稿`;
    case 'document':
      return `${resource(step.binding)} · 文件：${value(step.file)} · 本机文本提取，缺口须核对`;
    case 'file': {
      const destination = `${resource(step.binding)} · 文件：${value(step.name)}`;
      if (step.operation === 'read') return `${destination} · 仅读取`;
      if (step.operation === 'create')
        return `${destination} · ${step.version === 4 ? '同名自动加序号，保留原文件' : '同名时停止，不覆盖'}`;
      if (step.operation === 'copy')
        return `${destination} · 来源：${value(step.content)} · 同名会替换`;
      if (step.operation === 'archive')
        return `${destination} · 归档 ${value(step.files)} · 同名会替换`;
      return `${destination} · 写入内容，同名会替换`;
    }
    case 'excel': {
      const destination = `${resource(step.binding)} · 文件：${value(step.name)}`;
      if (step.operation === 'read') return `${destination} · 仅读取`;
      if (step.operation === 'map')
        return `${destination} · 工作表：${concise(step.sheet)} · ${step.mappings.length} 项映射 · 同名时停止`;
      if (step.operation === 'fill')
        return `${destination} · 工作表：${concise(step.sheet) || '首个工作表'} · 模板：${value(step.templateName)} · 同名会替换`;
      return `${destination} · 写入 ${value(step.rows)} · 同名会替换`;
    }
    case 'browser': {
      if (step.operation === 'navigate') return `打开地址：${value(step.value)}`;
      if (step.operation === 'url') return '读取当前浏览器顶层页面地址 · 只读，不导航';
      const page = context.webTarget?.page.title
        ? concise(context.webTarget.page.title)
        : context.snapshot
          ? '本次运行的浏览器页面'
          : '当前浏览器页面';
      const frame =
        'framePath' in step && step.framePath.length
          ? ` · ${step.framePath.length} 层内嵌页面`
          : '';
      if (step.operation === 'screenshot') return `截取当前页面${frame}`;
      const element = context.webTarget?.element?.target;
      const stepFrames = 'framePath' in step ? step.framePath : [];
      const selectedElement =
        element &&
        step.selector === element.selector &&
        stepFrames.length === element.framePath.length &&
        stepFrames.every((selector, index) => selector === element.framePath[index]);
      const targetName = selectedElement
        ? `已选元素「${concise(element.label || element.tag)}」`
        : step.selector === 'title'
          ? '页面标题'
          : '目标：' +
            (typeof step.selector === 'string'
              ? concise(step.selector || '未设置')
              : value(step.selector));
      const target = `${page} · ${targetName}${frame}`;
      if (step.operation === 'collect')
        return `${target} · 同步采集${step.fields.length}个字段 · 不完整时供流程分支核对`;
      if (step.operation === 'count') return `${target} · 统计匹配数量，无匹配为0`;
      if (step.operation === 'attribute')
        return `${target} · 原始属性：${value(step.value)} · 缺失为null`;
      if (step.operation === 'read' || step.operation === 'inputValue') return `${target} · 仅读取`;
      if (step.operation === 'wait') return `${target} · 等待元素就绪`;
      if (step.operation === 'click') return `${target} · 点击此元素`;
      return `${target} · ${browserLabels[step.operation]}：${value(step.value)}`;
    }
  }
}
