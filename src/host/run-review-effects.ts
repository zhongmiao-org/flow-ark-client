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
      case 'excel':
        return node.operation === 'read'
          ? effect('read', `从目录绑定“${node.binding}”读取文件；动态文件名在执行时确定。`)
          : effect(
              'write',
              `在目录绑定“${node.binding}”执行 ${node.operation}，可能覆盖同名文件；动态文件名在执行时确定。`,
            );
      case 'browser':
        if (node.operation === 'upload')
          return effect('network', '读取所绑定文件并上传到网页，可能向网站发送文件内容。');
        if (node.operation === 'download')
          return effect('write', '从网页下载并保存到本次运行产物目录。');
        if (node.operation === 'screenshot')
          return effect('write', '读取网页画面并保存截图到本次运行产物目录。');
        if (['read', 'inputValue', 'wait'].includes(node.operation))
          return effect(
            'read',
            `读取或等待网页（${node.operation}）；不代表页面身份或业务结果已经核对。`,
          );
        return effect(
          'network',
          `执行网页 ${node.operation}，可能导航、改变表单或向网站提交操作。`,
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
        return effect('control', `执行本地 ${node.type} 步骤。`);
    }
  });
}
