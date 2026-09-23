import { useId, useRef, useState } from 'react';
import type { PlanningChange } from '../shared/planning';
import type { Flow } from '../shared/types';
import { flatten } from './flow-editing';
import { kinds } from './node-kinds';
import './planning-changes.css';

const labels: Record<string, string> = {
  target: '工具对象',
  tool: '工具名称',
  arguments: '工具参数',
  name: '名称',
  description: '说明',
  parameters: '流程参数',
  requiredCapabilities: '所需能力',
  sourceTemplate: '模板来源',
  type: '动作类型',
  version: '动作版本',
  operation: '操作',
  actual: '判断内容',
  operator: '判断方式',
  expected: '预期值',
  value: '值',
  items: '循环来源',
  rows: '数据来源',
  mappings: '字段映射',
  includeHeaders: '表头',
  sheet: '工作表',
  code: '代码',
  input: '输入',
  language: '语言',
  timeoutMs: '超时（毫秒）',
  deadlineMs: '期限（毫秒）',
  message: '提示内容',
  content: '写入内容',
  cells: '单元格',
  files: '输出内容',
  body: '请求内容',
  binding: '目录绑定',
  selector: '目标定位',
  framePath: '框架层级',
  method: '请求方法',
  url: '请求地址',
  headers: '请求头',
  dependencies: '依赖',
};
const categories = { added: '新增', changed: '修改', moved: '移动', removed: '删除' } as const;
const raw = (value: unknown) => (value === undefined ? '未设置' : JSON.stringify(value, null, 2));
const readable = (value: unknown) => {
  if (value === null) return '空值';
  if (value === undefined) return '未设置';
  if (value === '') return '空文本';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value && typeof value === 'object' && '$ref' in value && typeof value.$ref === 'string')
    return `引用：${value.$ref}`;
  return typeof value === 'string' ? value : raw(value);
};
const fieldValue = (field: string, value: unknown) => {
  if (typeof value === 'string') {
    if (field === 'type' && Object.hasOwn(kinds, value))
      return kinds[value as keyof typeof kinds].label;
    const enums: Record<string, Record<string, string>> = {
      operator: {
        equals: '等于',
        notEquals: '不等于',
        contains: '包含',
        gt: '大于（数字）',
        exists: '不是 null 或未定义',
      },
      language: { js: 'JavaScript', ts: 'TypeScript' },
    };
    if (Object.hasOwn(enums[field] ?? {}, value)) return enums[field][value];
  }
  return readable(value);
};
const fieldName = (change: PlanningChange) =>
  change.kind === 'moved'
    ? '步骤位置'
    : change.kind === 'added' || change.kind === 'removed'
      ? '步骤配置'
      : (labels[change.path.split('/').at(-1)!] ?? change.path.split('/').at(-1)!);

export default function PlanningChanges({
  changes,
  before,
  after,
  revision,
  prioritizeDetail = false,
}: {
  changes: PlanningChange[];
  before: Flow | null;
  after: Flow;
  revision: number;
  prioritizeDetail?: boolean;
}) {
  const id = useId(),
    search = useRef<HTMLInputElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PlanningChange['kind'] | 'all'>('all');
  const [selected, setSelected] = useState(0);
  const oldSteps = flatten(before?.steps ?? []),
    newSteps = flatten(after.steps);
  const nodeName = (nodeId: string, side: 'before' | 'after') => {
    const step = (side === 'before' ? oldSteps : newSteps).find((node) => node.id === nodeId);
    return step ? step.name || kinds[step.type]?.label || step.id : nodeId;
  };
  const position = (value: unknown, side: 'before' | 'after') => {
    if (typeof value !== 'string') return readable(value);
    const match = /^(steps|([^/]+)\/(then|else|body))\/(\d+)$/.exec(value);
    if (!match) return value;
    const place = Number(match[4]) + 1;
    return match[1] === 'steps'
      ? `主流程 · 第 ${place} 步`
      : `${nodeName(match[2], side)} · ${{ then: '成立分支', else: '否则分支', body: '循环体' }[match[3]]} · 第 ${place} 步`;
  };
  const title = (change: PlanningChange) =>
    change.nodeId ? `${change.label} · ${fieldName(change)}` : `流程设置 · ${fieldName(change)}`;
  const needle = query.trim().toLocaleLowerCase();
  const visible = changes
    .map((change, index) => ({ change, index }))
    .filter(
      ({ change }) =>
        (filter === 'all' || change.kind === filter) &&
        [title(change), change.nodeId ?? '', change.path].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        ),
    );
  const active = visible.find((item) => item.index === selected) ?? visible[0];
  const change = active?.change;
  const affected = new Set(changes.flatMap((item) => (item.nodeId ? [item.nodeId] : []))).size;
  const settings = changes.filter((item) => !item.nodeId).length;
  const clear = () => {
    setQuery('');
    setFilter('all');
    search.current?.focus();
  };
  const detailContent = change && (
    <div id={`${id}-detail`} className="planning-change-detail" key={active.index}>
      <h3 ref={detailHeading} tabIndex={-1}>
        {title(change)}
      </h3>
      <div className="planning-change-values">
        {(['before', 'after'] as const).map((side) => {
          const value = change[side];
          const node =
            (change.kind === 'added' || change.kind === 'removed') &&
            value &&
            typeof value === 'object' &&
            'node' in value
              ? value.node
              : null;
          const missing =
            (change.kind === 'added' && side === 'before') ||
            (change.kind === 'removed' && side === 'after');
          return (
            <section key={side} className={`planning-change-${side}`}>
              <h4>{side === 'before' ? '原值' : '新值'}</h4>
              {missing ? (
                <p>{side === 'before' ? '原草稿没有此步骤' : '新方案移除此步骤'}</p>
              ) : node && typeof node === 'object' ? (
                <>
                  <p>{position((value as { position?: unknown }).position, side)}</p>
                  <dl>
                    {Object.entries(node).map(([field, item]) => (
                      <div key={field}>
                        <dt>{field === 'id' ? '步骤编号' : (labels[field] ?? field)}</dt>
                        <dd>
                          <pre>{fieldValue(field, item)}</pre>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <pre>
                  {change.kind === 'moved'
                    ? position(value, side)
                    : fieldValue(change.path.split('/').at(-1)!, value)}
                </pre>
              )}
            </section>
          );
        })}
      </div>
      <details>
        <summary>查看完整原始差异</summary>
        <p>{change.path}</p>
        <pre>{raw({ before: change.before, after: change.after })}</pre>
      </details>
    </div>
  );
  return (
    <section
      className="planning-changes"
      aria-labelledby={prioritizeDetail ? undefined : `${id}-heading`}
      aria-label={prioritizeDetail ? '逐项修改对照' : undefined}
    >
      {!prioritizeDetail && (
        <>
          <header>
            <h2 id={`${id}-heading`}>检查修改 · {changes.length} 项</h2>
            <span>{before ? `任务基线修订 ${revision}` : '首次生成方案'}</span>
          </header>
          <p>
            涉及 {affected} 个步骤、{settings} 项流程设置。
            {before ? `原草稿：${before.name}。` : '尚无原草稿。'}采纳只更新草稿。
          </p>
        </>
      )}
      {prioritizeDetail && detailContent}
      {changes.length ? (
        <>
          <label htmlFor={`${id}-search`}>查找修改</label>
          <div className="planning-changes-search">
            <input
              id={`${id}-search`}
              ref={search}
              value={query}
              placeholder="步骤名称、编号或字段"
              onChange={(event) => setQuery(event.target.value)}
            />
            {(query || filter !== 'all') && (
              <button type="button" onClick={clear}>
                清除筛选
              </button>
            )}
          </div>
          <div className="planning-changes-filters" aria-label="修改类型">
            {(['all', 'added', 'changed', 'moved', 'removed'] as const).map((kind) => (
              <button
                type="button"
                key={kind}
                aria-pressed={filter === kind}
                onClick={() => setFilter(kind)}
              >
                {kind === 'all' ? '全部' : categories[kind]} ·{' '}
                {kind === 'all'
                  ? changes.length
                  : changes.filter((item) => item.kind === kind).length}
              </button>
            ))}
          </div>
          <p className="planning-changes-count" role="status">
            显示 {visible.length} / {changes.length} 项；采纳作用于完整方案，筛选不会缩小修改范围。
          </p>
          <div className="planning-changes-list" role="group" aria-label="修改清单">
            {visible.map(({ change, index }) => (
              <button
                type="button"
                key={index}
                aria-pressed={active?.index === index}
                onClick={() => {
                  setSelected(index);
                  if (prioritizeDetail)
                    requestAnimationFrame(() => {
                      detailHeading.current?.scrollIntoView({ block: 'nearest' });
                      detailHeading.current?.focus({ preventScroll: true });
                    });
                }}
                aria-controls={`${id}-detail`}
              >
                <span>
                  <strong>{title(change)}</strong>
                  <small>{change.nodeId ? `步骤 ${change.nodeId}` : '整个流程'}</small>
                </span>
                <span className={`planning-change-kind ${change.kind}`}>
                  {categories[change.kind]}
                </span>
              </button>
            ))}
          </div>
          {!visible.length && (
            <p className="planning-changes-empty">没有匹配的修改。清除筛选可查看完整清单。</p>
          )}
          {!prioritizeDetail && detailContent}
        </>
      ) : (
        <p className="planning-changes-empty">没有检测到草稿内容变化。</p>
      )}
    </section>
  );
}
