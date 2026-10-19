import { effectOperations } from './effect-node';
import { contextOperations } from './template-data';
import type { Step } from './types';

export const stepKindLabels: Record<Step['type'], string> = {
  'source-reduce': '分批整理来源',
  'run-result': '读取已保存结果',
  source: '读取完整会话来源',
  context: '配置与状态',
  effect: '操作记录',
  skill: 'Skill工作区',
  document: '解析资料',
  desktop: '应用选区',
  mcp: '已连接工具',
  value: '数据',
  assert: '结果断言',
  conversation: '持久引导会话',
  ai: '结构化 AI 调用',
  http: 'HTTP 请求',
  script: 'JS / TS 脚本',
  file: '文件处理',
  excel: 'Excel 表格',
  browser: '浏览器',
  human: '等待人工',
  condition: '条件分支',
  loop: '串行循环',
};

export const browserLabels = {
  collect: '读取关联字段',
  url: '读取当前网址',
  count: '统计匹配元素',
  attribute: '读取元素属性',
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

/** Display only: a file node's name is its filename, not a custom step title. */
export function taskStepTitle(step: Step): string {
  if (step.type === 'file') return fileLabels[step.operation];
  if (step.type === 'excel') return excelLabels[step.operation];
  const title = (
    step.name?.trim() ||
    (step.type === 'browser'
      ? step.version === 9
        ? '读取关联字段与选区文字候选'
        : step.version === 6 || step.version === 7
          ? '关联字段与正文'
          : browserLabels[step.operation]
      : step.type === 'effect'
        ? effectOperations[step.operation]
        : step.type === 'context'
          ? contextOperations[step.operation]
          : stepKindLabels[step.type]) ||
    '步骤待核对'
  )
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(title);
  return characters.length > 80 ? characters.slice(0, 79).join('') + '…' : title;
}
