import { walk } from '../core/validate';
import type { Flow } from '../shared/types';
import type { ReviewEffect } from '../shared/run-review';

/** Describe every declared branch. Do not infer actual loop counts or business success. */
export function reviewEffects(flow: Flow): ReviewEffect[] {
  return walk(flow.steps).map((node) => {
    const base = { nodeId: node.id, name: typeof node.name === 'string' ? node.name : node.id };
    const effect = (kind: ReviewEffect['kind'], detail: string): ReviewEffect => ({
      ...base,
      kind,
      detail,
    });
    switch (node.type) {
      case 'file':
      case 'excel': {
        const file = typeof node.name === 'string' ? `“${node.name}”` : '执行时确定名称的文件';
        const operation = {
          write: '写入',
          copy: '复制',
          archive: '打包保存',
          fill: '填写表格并保存',
          read: '读取',
        }[node.operation];
        return node.operation === 'read'
          ? effect('read', `读取目录“${node.binding}”中的${file}。`)
          : effect('write', `在目录“${node.binding}”${operation}${file}，可能覆盖同名文件。`);
      }
      case 'browser':
        if (node.operation === 'upload')
          return effect('network', '读取所绑定文件并上传到网页，可能向网站发送文件内容。');
        if (node.operation === 'download')
          return effect('write', '从网页下载并保存到本次运行产物目录。');
        if (node.operation === 'screenshot')
          return effect('write', '读取网页画面并保存截图到本次运行产物目录。');
        if (node.operation === 'read') return effect('read', '读取本步骤指定的网页文字。');
        if (node.operation === 'inputValue')
          return effect('read', '读取本步骤指定的表单输入内容。');
        if (node.operation === 'wait') return effect('read', '等待本步骤指定的网页元素出现。');
        if (node.operation === 'navigate')
          return effect(
            'network',
            typeof node.value === 'string' ? '打开网页：' + node.value : '打开执行时确定的网址。',
          );
        return effect(
          'network',
          `${{ click: '点击网页元素', fill: '填写网页表单', select: '选择表单选项', check: '更改勾选状态', press: '向网页发送按键' }[node.operation]}，可能改变表单或触发网站操作。`,
        );
      case 'http':
        return effect(
          'network',
          '发送 HTTP 请求，可能向服务端提交数据或产生副作用；请求成功不等于业务已核对。',
        );
      case 'script':
        return effect(
          'unknown',
          '执行可信脚本或模板代码；静态检查不能穷尽文件、网页、AI 或网络影响，请核对完整代码与资源授权。模板逐动作确认继续生效。',
        );
      case 'condition':
        return effect('control', '运行时选择一个分支；此检查同时列出两路可能的影响。');
      case 'loop':
        return effect('control', '按运行时数据重复执行循环体；此处不估计实际执行次数。');
      case 'human':
        return effect('control', '等待人工处理后继续。');
      case 'value':
      case 'assert':
        return effect(
          'control',
          node.type === 'value' ? '在本机处理步骤中的值。' : '在本机检查步骤结果是否满足条件。',
        );
    }
  });
}
