import type { Step, Json } from '../shared/types';

export type BrowserNode = Extract<Step, { type: 'browser' }>;
export type BrowserOperation = BrowserNode['operation'];
// Editor presets only; execution remains the versioned browser node contract.
export const browserActions: Record<
  BrowserOperation,
  {
    label: string;
    detail: string;
    keywords: string;
    value: Json;
    version: 2 | 3 | 4 | 5 | 6;
  }
> = {
  collect: {
    label: '读取关联字段与正文',
    detail: '在唯一根元素内同步采集指定字段，分别保留缺失、空值和不唯一状态',
    keywords: 'collect fields 关联字段 同次 只读',
    value: null,
    version: 6,
  },
  url: {
    label: '读取当前网址',
    detail: '读取所选浏览器顶层页面的实际地址，不进行导航',
    keywords: 'url location 当前地址 只读',
    value: null,
    version: 4,
  },
  count: {
    label: '统计匹配元素',
    detail: '读取当前目标的匹配数量，无匹配返回0',
    keywords: 'count selector 列表 数量 只读',
    value: null,
    version: 4,
  },
  attribute: {
    label: '读取元素属性',
    detail: '读取唯一目标的原始属性，属性不存在返回null',
    keywords: 'attribute href src 属性 链接 只读',
    value: 'href',
    version: 4,
  },
  navigate: {
    label: '打开网页',
    detail: '访问指定网址',
    keywords: 'url navigate 导航',
    value: '',
    version: 2,
  },
  fill: {
    label: '填写内容',
    detail: '向输入框填写文本',
    keywords: 'input textarea fill 输入',
    value: '',
    version: 2,
  },
  click: {
    label: '点击元素',
    detail: '点击按钮或链接',
    keywords: 'click button 按钮',
    value: null,
    version: 2,
  },
  select: {
    label: '选择下拉选项',
    detail: '选择原生下拉框的选项',
    keywords: 'select option 下拉框',
    value: '',
    version: 3,
  },
  check: {
    label: '设置勾选状态',
    detail: '设置单选或复选框',
    keywords: 'radio checkbox check 单选 复选',
    value: true,
    version: 3,
  },
  read: {
    label: '读取文字',
    detail: '读取元素显示的文字',
    keywords: 'read text 文本',
    value: null,
    version: 2,
  },
  inputValue: {
    label: '读取当前输入值',
    detail: '读取控件实际填写的值',
    keywords: 'input value 输入框',
    value: null,
    version: 3,
  },
  wait: {
    label: '等待可见',
    detail: '等到目标元素出现',
    keywords: 'wait 等待元素',
    value: null,
    version: 2,
  },
  upload: {
    label: '选择上传文件',
    detail: '将本地文件交给网页上传控件',
    keywords: 'upload file 上传',
    value: { binding: 'workspace', name: '' },
    version: 2,
  },
  download: {
    label: '点击并下载',
    detail: '点击下载并保存运行产物',
    keywords: 'download 下载文件',
    value: 'download.bin',
    version: 2,
  },
  screenshot: {
    label: '页面截图',
    detail: '保存当前网页视口',
    keywords: 'screenshot capture 截图',
    value: null,
    version: 2,
  },
  press: {
    label: '按下表单按键',
    detail: '向目标控件发送按键',
    keywords: 'press keyboard enter tab 键盘',
    value: 'Tab',
    version: 3,
  },
};

export function changeBrowserOperation(
  node: BrowserNode,
  operation: BrowserOperation,
): BrowserNode {
  const preset = browserActions[operation];
  const topLevel = ['navigate', 'screenshot', 'url'].includes(operation);
  const base = {
    id: node.id,
    type: 'browser' as const,
    ...(node.name !== undefined ? { name: node.name } : {}),
    ...(node.timeoutMs !== undefined ? { timeoutMs: node.timeoutMs } : {}),
  };
  if (operation === 'collect' && node.operation === 'collect') return node;
  if (operation === 'collect')
    return {
      ...base,
      version: 6,
      operation,
      selector: node.selector || 'body',
      framePath: 'framePath' in node ? node.framePath : [],
      fields: [{ key: 'field1', selector: '', operation: 'text', attribute: null, required: true }],
    };
  return {
    ...base,
    operation,
    version: preset.version === 4 ? 4 : node.version === 3 ? 3 : preset.version,
    selector: topLevel
      ? ''
      : preset.version === 4
        ? node.selector
        : typeof node.selector === 'string'
          ? node.selector
          : '',
    value: structuredClone(preset.value),
    framePath: topLevel ? [] : 'framePath' in node ? node.framePath : [],
  } as BrowserNode;
}

export function newBrowserStep(operation: BrowserOperation): BrowserNode {
  const preset = browserActions[operation];
  if (operation === 'collect')
    return {
      id: 'n_' + crypto.randomUUID().slice(0, 8),
      type: 'browser',
      version: 6,
      operation,
      selector: 'body',
      framePath: [],
      fields: [{ key: 'field1', selector: '', operation: 'text', attribute: null, required: true }],
    };
  return {
    id: 'n_' + crypto.randomUUID().slice(0, 8),
    type: 'browser',
    version: preset.version,
    operation,
    selector: '',
    framePath: [],
    value: structuredClone(preset.value),
  } as BrowserNode;
}
