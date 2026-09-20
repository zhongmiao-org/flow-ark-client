import type { Step } from '../shared/types';

export type BrowserNode = Extract<Step, { type: 'browser' }>;
export type BrowserOperation = BrowserNode['operation'];
// Editor presets only; execution remains the versioned browser node contract.
export const browserActions: Record<
  BrowserOperation,
  { label: string; detail: string; keywords: string; value: BrowserNode['value']; version: 2 | 3 }
> = {
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

export function newBrowserStep(operation: BrowserOperation): BrowserNode {
  const preset = browserActions[operation];
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
