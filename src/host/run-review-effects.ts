import { walk } from '../core/validate';
import type { Flow } from '../shared/types';
import type { ReviewEffect } from '../shared/run-review';
import { taskStepTitle } from '../shared/step-title';

/** Describe every declared branch. Do not infer actual loop counts or business success. */
export function reviewEffects(flow: Flow): ReviewEffect[] {
  return walk(flow.steps).map((node, index) => {
    const base = {
      nodeId: node.id,
      name: `${String(index + 1).padStart(2, '0')} ${taskStepTitle(node)}`,
    };
    const effect = (kind: ReviewEffect['kind'], detail: string): ReviewEffect => ({
      ...base,
      kind,
      detail,
    });
    switch (node.type) {
      case 'run-result':
        return effect(
          'read',
          `读取已明确选择的结果资源“${node.binding}”；固定来源与数据摘要，读取前复验当前绑定，不调用模型。`,
        );
      case 'source-reduce':
        return effect(
          'network',
          `读取固定来源“${node.binding}”，使用本人AI资源“${node.aiBinding}”分批整理，本节点本批最多${node.maxRequests}次请求；保存进度，未知结果不自动重试，不自动发布Skill。`,
        );
      case 'source':
        return effect(
          'read',
          `读取来源资源“${node.binding}”的固定${node.operation === 'manifest' ? '清单' : '有界片段'}；不调用模型，不生成Skill。`,
        );
      case 'effect':
        return effect(
          'write',
          node.operation === 'prepare'
            ? '在本机持久准备并去重当前入口的声明动作；需要确认时等待本人。本步骤不执行后续网页或文件动作，只有本次新回执允许进入执行分支。'
            : '按实际核对结果登记本次运行的提交中操作；未知会建立本地待办，不重新执行。',
        );
      case 'context':
        return node.operation === 'state.write'
          ? effect(
              'write',
              '按预期修订替换本实例或本调试副本的完整状态；冲突时停止，提交后的状态不因运行取消而撤销。',
            )
          : effect(
              'read',
              node.operation === 'configuration'
                ? '读取运行开始时固定的共享配置。'
                : '读取本实例或本调试副本的最新状态及修订。',
            );
      case 'desktop':
        return effect(
          'write',
          `仅替换应用目标“${node.target}”的原选区，并按原起点与新文字长度回读。不会自动保存文档；结果未知不自动重试。`,
        );
      case 'mcp':
        return effect(
          'unknown',
          `工具 ${node.tool} · 对象 ${node.target}；外部影响需按工具及参数核对，只有明确确认试运行后才会调用。`,
        );
      case 'file':
      case 'excel': {
        const file = typeof node.name === 'string' ? `“${node.name}”` : '执行时确定名称的文件';
        if (node.operation === 'create')
          return effect(
            'write',
            `在目录“${node.binding}”新建文本文件${file}；${node.version === 4 ? '同名自动加序号，不覆盖，实际名称在执行后确定' : '同名文件存在时停止，不覆盖'}。`,
          );
        if (node.operation === 'map')
          return effect(
            'write',
            `在目录“${node.binding}”新建映射工作簿${file}；同名文件存在时停止，不覆盖。`,
          );
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
      case 'skill':
        return node.operation === 'read'
          ? effect('read', `读取Skill资源“${node.binding}”的固定确认版本，不调用模型。`)
          : effect(
              'write',
              '在本机保存待确认Skill草稿，结束本批；工作区文件须用户另行核对确认，不自动发布。',
            );
      case 'document':
        return effect(
          'read',
          `仅读取目录“${node.binding}”中明确指定的资料，提取PDF/DOCX/UTF-8文本与来源；不调用AI，不自动OCR，缺口须核对。`,
        );
      case 'browser':
        if (node.operation === 'collect')
          return effect(
            'read',
            '在唯一根元素内同步读取' +
              node.fields.length +
              '个关联字段；缺失/空值/不唯一分别记录，导航、框架变化或超限整次拒绝，不产生动作授权。',
          );
        if (node.operation === 'upload')
          return effect('network', '读取所绑定文件并上传到网页，可能向网站发送文件内容。');
        if (node.operation === 'download')
          return effect('write', '从网页下载并保存到本次运行产物目录。');
        if (node.operation === 'screenshot')
          return effect('write', '读取网页画面并保存截图到本次运行产物目录。');
        if (node.operation === 'read') return effect('read', '读取本步骤指定的网页文字。');
        if (node.operation === 'url') return effect('read', '读取当前顶层页面地址，不进行导航。');
        if (node.operation === 'count')
          return effect('read', '统计指定范围的匹配数量，无匹配为0；不点击或填写。');
        if (node.operation === 'attribute')
          return effect('read', '读取唯一目标的原始DOM属性，属性缺失为null；不点击或填写。');
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
      case 'conversation':
        return effect(
          'write',
          '在本机创建或读取持久引导会话，本批不调用模型；等待用户不占运行槽，用户在待办核对自有 Key 费用后显式发送。仅确认后返回完整对话。',
        );
      case 'ai':
        return effect(
          'network',
          `将本节点指令和选定输入发送到AI资源“${node.binding}”绑定的模型，消耗用户自己的token额度；仅生成数据，不执行其他动作。${node.version !== 1 ? (node.failureMode === 'result' ? '请求故障返回失败状态供后续处理；取消、权限、资源和节点期限仍中断。' : '请求故障停止运行；成功结果在result.output。') : ''}${node.version === 3 ? `思考模式：${{ 'provider-default': '服务默认', disabled: '关闭', enabled: '开启' }[node.generation.thinking]}；最大输出${node.generation.maxOutputTokens} Token（含供应商计入的思考与正文）。` : ''}`,
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
