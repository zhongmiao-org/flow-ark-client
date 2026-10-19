import { resolveParameterSources } from '../shared/parameter-sources';
import type { Flow, Step } from '../shared/types';
import { flowOutline } from './flow-outline';
import { taskStepTitle } from './task-step-title';

export type ReferenceChoice = {
  path: string;
  label: string;
  group: '流程参数' | '前序步骤' | '当前循环';
  hint: string;
};

export function readableReference(reference: string, choices: readonly ReferenceChoice[]): string {
  const source =
    choices.find((choice) => choice.path === reference) ??
    choices
      .filter((choice) => reference.startsWith(choice.path + '.'))
      .sort((a, b) => b.path.length - a.path.length)[0];
  if (!source) return '变量来源待核对';
  const suffix = reference.slice(source.path.length).split('.').filter(Boolean).join(' / ');
  return `${source.group} / ${source.label}${suffix ? ' / ' + suffix : ''}`;
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export const referenceKey = (key: string) => !!key && !key.includes('.') && !forbidden.has(key);
export function referenceOf(value: unknown): string | undefined {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    '$ref' in value &&
    typeof value.$ref === 'string'
  )
    return value.$ref;
}

/** The same lexical, preceding-sibling scope used by execute and referenceIssues. */
export function referenceScope(
  steps: Step[],
  selected: string,
): { steps: Step[]; loop?: Step } | undefined {
  function block(nodes: Step[], inherited: Step[], loop?: Step): ReturnType<typeof referenceScope> {
    const prior = [...inherited];
    for (const node of nodes) {
      if (node.id === selected) return { steps: prior, loop };
      const child =
        node.type === 'condition'
          ? (block(node.then, prior, loop) ?? block(node.else, prior, loop))
          : node.type === 'loop'
            ? block(node.body, prior, node)
            : undefined;
      if (child) return child;
      prior.push(node);
    }
  }
  return block(steps, []);
}
export function referenceChoices(flow: Flow, selected: string): ReferenceChoice[] {
  const scope = referenceScope(flow.steps, selected);
  if (!scope) return [];
  const result: ReferenceChoice[] = [];
  const outline = flowOutline(flow.steps);
  function add(path: string, label: string, group: ReferenceChoice['group'], hint: string) {
    result.push({ path, label, group, hint });
  }
  // Do not inspect runtime data. Limit expanded examples, retaining every source root.
  function fields(
    value: unknown,
    path: string,
    label: string,
    group: ReferenceChoice['group'],
    depth = 0,
    budget = { left: 100 },
  ) {
    if (!value || typeof value !== 'object' || referenceOf(value) !== undefined || depth >= 4)
      return;
    for (const [key, child] of Object.entries(value)) {
      if (!referenceKey(key) || budget.left-- <= 0) continue;
      add(path + '.' + key, label + ' / ' + key, group, '字段来自草稿结构；实际值以本次运行为准');
      fields(child, path + '.' + key, label + ' / ' + key, group, depth + 1, budget);
    }
  }
  let parameters = flow.parameters;
  let available = true;
  try {
    parameters = resolveParameterSources(flow);
  } catch {
    available = false;
  }
  for (const [key, value] of Object.entries(parameters)) {
    if (!referenceKey(key)) continue;
    add('params.' + key, key, '流程参数', '使用本次运行的参数值');
    if (available) fields(value, 'params.' + key, key, '流程参数');
  }
  for (const node of scope.steps) {
    const ordinal = outline.byId.get(node.id)!.ordinal;
    const label = `${String(ordinal).padStart(2, '0')} ${taskStepTitle(node)}`;
    const path = 'steps.' + node.id;
    add(
      path,
      label,
      '前序步骤',
      node.type === 'condition'
        ? '仅实际执行分支的子步骤有输出；子路径需与分支一致'
        : node.type === 'loop'
          ? '结果为每次迭代的输出数组；索引取决于实际迭代次数'
          : '本步骤的完整输出；未知字段可在高级子路径中指定',
    );
    if (node.type === 'source-reduce')
      for (const key of [
        'phase',
        'checkpoint.accumulator',
        'proof',
        'checkpoint.records',
        'checkpoint.chunks',
        'reportedTotalTokens',
        'unknownUsageRequests',
      ])
        add(
          path + '.' + key,
          label + ' / ' + key,
          '前序步骤',
          '固定整理结果；先判断 phase 是否为 complete',
        );
    if (node.type === 'source-reduce')
      fields(
        node.schema?.properties
          ? Object.fromEntries(Object.keys(node.schema.properties).map((k) => [k, null]))
          : {},
        path + '.checkpoint.accumulator',
        label + ' / 整理草稿',
        '前序步骤',
      );
    if (node.type === 'run-result')
      for (const [key, title] of Object.entries({
        value: '可复用数据',
        ref: '固定来源',
        dataChanged: '是否经过过滤',
        schemaValidation: '结构校验',
        labels: '字段说明',
      }))
        add(
          path + '.' + key,
          label + ' / ' + title,
          '前序步骤',
          '完整已核验副本；读取不会扩大后续动作权限',
        );
    if (node.type === 'source')
      for (const key of node.operation === 'manifest'
        ? ['source', 'manifest', 'current', 'manifest.requestCount', 'manifest.recordCount']
        : ['cursor', 'chunk', 'chunk.text', 'next', 'done'])
        add(
          path + '.' + key,
          label + ' / ' + key,
          '前序步骤',
          key === 'next'
            ? '选择这个实际返回位置，继续读取同一固定来源；先判断done'
            : '本机来源读取输出，不等于模型处理覆盖',
        );
    if (node.type === 'skill')
      for (const key of node.operation !== 'read'
        ? ['proposalId', 'revision', 'status', 'ref', ...(node.version === 2 ? ['base'] : [])]
        : ['ref', 'title', 'markdown', 'data', 'evidence', 'parent', 'confirmedAt'])
        add(
          path + '.' + key,
          label + ' / ' + key,
          '前序步骤',
          '创建草稿须先判断status；读取固定确认版本不会授予模型或发送权限',
        );
    if (node.type === 'effect') {
      const labels: Record<string, string> = {
        execute: '允许执行',
        state: '状态',
        id: '操作身份',
        action: '声明动作',
        key: '原去重键',
        runId: '来源运行',
      };
      for (const key of node.operation === 'prepare'
        ? ['execute', 'state', 'id', 'action', 'key', 'runId']
        : ['id', 'state'])
        add(
          path + '.' + key,
          label + ' / ' + labels[key],
          '前序步骤',
          key === 'execute'
            ? '仅严格为真才进入实际动作；完整准备回执用于本次登记'
            : '固定回执字段；历史或去重回执不能重新授权',
        );
    }
    if (node.type === 'context')
      for (const key of [
        'value',
        'revision',
        'contextId',
        ...(node.operation === 'state.write'
          ? ['operationId', 'previousRevision', 'committedAt']
          : []),
      ])
        add(
          path + '.' + key,
          label + ' / ' + key,
          '前序步骤',
          key === 'revision'
            ? '状态写入须选择读取结果的修订；配置修订不能用作状态修订'
            : '完整配置或状态的输出字段',
        );
    if (node.type === 'document')
      for (const key of ['status', 'source', 'text', 'units', 'warnings'])
        add(
          path + '.' + key,
          label + ' / ' + key,
          '前序步骤',
          '先核对status与内容缺口，再选择明确单元',
        );
    if (node.type === 'conversation')
      for (const key of [
        'sessionId',
        'status',
        'revision',
        'sequence',
        'transcript',
        'evidence',
        ...(node.version === 2
          ? ['context', 'historyCount', 'historyHash', 'origin', 'proposalId']
          : []),
      ])
        add(path + '.' + key, label + ' / ' + key, '前序步骤', '确认后才有完整对话；先判断 status');
    if (node.type === 'ai') {
      const schema = node.schema as { properties?: Record<string, unknown> };
      const prefix = node.version === 2 ? '.result' : '';
      if (node.version === 2)
        for (const key of [
          'status',
          'result',
          'error',
          'error.code',
          'error.message',
          'error.httpStatus',
          'provider',
          'model',
          'requestId',
          'usage',
        ])
          add(
            path + '.' + key,
            label + ' / ' + key,
            '前序步骤',
            key === 'status'
              ? '先判断 success 或 failed'
              : key === 'result'
                ? '仅status=success时可读取完整AIResult'
                : '失败分支的回执；未知ID/用量为null，无可用正文',
          );
      for (const key of ['output', 'provider', 'model', 'requestId', 'usage'])
        add(
          path + prefix + '.' + key,
          label + ' / ' + (prefix ? 'result / ' : '') + key,
          '前序步骤',
          node.version === 2 ? '仅status=success时可读取完整结果' : 'AI已校验结果字段',
        );
      for (const key of Object.keys(schema.properties ?? {}))
        if (referenceKey(key))
          add(
            path + prefix + '.output.' + key,
            label + (prefix ? ' / result' : '') + ' / output / ' + key,
            '前序步骤',
            '已声明输出字段，实际值以本次运行为准',
          );
    }
    if (node.type === 'value') fields(node.value, path, label, '前序步骤');
    const known =
      node.type === 'assert'
        ? ['verified']
        : node.type === 'browser'
          ? ((
              {
                navigate: ['url', 'title'],
                click: ['clicked', 'verified'],
                check: ['checked'],
                collect: [
                  'complete',
                  'url',
                  'documentUrl',
                  'fields',
                  ...(node.version === 9 ? ['renderPolicy', 'externalAppearanceVerified'] : []),
                ],
              } as Record<string, string[]>
            )[node.operation] ?? [])
          : [];
    for (const key of known) add(path + '.' + key, label + ' / ' + key, '前序步骤', '步骤输出字段');
    if (
      node.type === 'browser' &&
      (node.version === 5 || node.version === 6 || node.version === 7 || node.version === 9)
    )
      node.fields.forEach((field, i) => {
        for (const key of [
          'value',
          'count',
          'status',
          ...(node.version >= 6 ? ['issues'] : []),
          ...(node.version === 7 || node.version === 9 ? ['ignoredAncestorSpaces'] : []),
          ...(node.version === 9 ? ['excludedAncestorDecorations'] : []),
        ])
          add(
            path + '.fields.' + i + '.' + key,
            label + ' / ' + field.key + ' / ' + key,
            '前序步骤',
            '关联字段输出；先核对complete及单项状态，数组顺序随节点配置固定',
          );
      });
  }
  if (scope.loop) {
    add('item', '当前项', '当前循环', '最近一层循环的当前项；对象字段可指定子路径');
    add('index', '当前序号（从 0 开始）', '当前循环', '最近一层循环的整数序号');
  }
  return result;
}
export function composeReference(choices: ReferenceChoice[], base: string, suffix: string): string {
  if (!choices.some((choice) => choice.path === base)) throw new Error('请选择当前可用的变量');
  if (!suffix) return base;
  if (base === 'index') throw new Error('循环序号没有子字段');
  if (suffix.split('.').some((key) => !referenceKey(key)))
    throw new Error('子路径不能有空段或原型相关属性');
  return base + '.' + suffix;
}
