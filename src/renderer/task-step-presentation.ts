import type { Bindings, Flow, Step } from '../shared/types';
import type { TaskWebTarget } from '../shared/task-web-target';
import type { TaskOutputTarget } from '../shared/task-output';
import type { TaskMcpTarget } from '../shared/task-mcp-targets';
import { kinds } from './node-kinds';
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
const browserLabels = {
  navigate: '打开网页',
  read: '读取网页文字',
  click: '点击网页元素',
  fill: '填写网页内容',
  wait: '等待网页元素',
  upload: '上传文件',
  screenshot: '页面截图',
  download: '下载文件',
  select: '选择网页选项',
  check: '设置勾选',
  inputValue: '读取输入值',
  press: '按下按键',
};
const fileLabels = {
  read: '读取文本文件',
  write: '写入文本文件',
  copy: '复制文件',
  archive: '归档文件',
  create: '新建文本文件',
};
const excelLabels = {
  read: '读取表格',
  write: '写入表格',
  fill: '填写表格模板',
  map: '映射表格字段',
};
export function taskStepTitle(step: Step): string {
  if (step.type === 'file') return fileLabels[step.operation];
  if (step.type === 'excel') return excelLabels[step.operation];
  return concise(
    step.name?.trim() ||
      (step.type === 'browser' ? browserLabels[step.operation] : kinds[step.type].label),
    80,
  );
}

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
    case 'http':
      return `${step.method} 请求 · 地址：${value(step.url)}`;
    case 'mcp': {
      const target = context.toolTargets?.find((entry) => entry.selectionId === step.target);
      const tool = target?.tools.find((entry) => entry.name === step.tool);
      return `${target ? concise(target.displayName) : context.snapshot ? '工具对象引用：' + concise(step.target) : '工具对象尚未匹配'} · ${concise(tool?.title || step.tool)} · ${context.snapshot ? '外部影响以调用回执为准' : '试运行前核对外部影响'}`;
    }
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
          : '目标：' + concise(step.selector || '未设置');
      const target = `${page} · ${targetName}${frame}`;
      if (step.operation === 'read' || step.operation === 'inputValue') return `${target} · 仅读取`;
      if (step.operation === 'wait') return `${target} · 等待元素就绪`;
      if (step.operation === 'click') return `${target} · 点击此元素`;
      return `${target} · ${browserLabels[step.operation]}：${value(step.value)}`;
    }
  }
}
