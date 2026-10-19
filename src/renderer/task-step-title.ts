import { effectOperations } from '../shared/effect-node';
import type { Step } from '../shared/types';
import { kinds } from './node-kinds';
import { contextOperations } from '../shared/template-data';

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
export function taskStepTitle(step: Step): string {
  if (step.type === 'file') return fileLabels[step.operation];
  if (step.type === 'excel') return excelLabels[step.operation];
  const title = (
    step.name?.trim() ||
    (step.type === 'browser'
      ? step.version >= 6
        ? '关联字段与正文'
        : browserLabels[step.operation]
      : step.type === 'effect'
        ? effectOperations[step.operation]
        : step.type === 'context'
          ? contextOperations[step.operation]
          : kinds[step.type].label)
  )
    .replace(/\s+/g, ' ')
    .trim();
  return title.length > 80 ? title.slice(0, 79) + '…' : title;
}
