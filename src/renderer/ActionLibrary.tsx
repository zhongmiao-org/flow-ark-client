import { useId, useRef, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import type { Step } from '../shared/types';
import type { Destination } from './flow-editing';
import { kinds } from './node-kinds';
import { newStep } from './node-defaults';
import { browserActions, newBrowserStep, type BrowserOperation } from './browser-actions';
import './action-library.css';

const groups = [
  { id: 'browser', label: '网页操作', types: ['browser'] },
  { id: 'value', label: '数据与变量', types: ['value'] },
  { id: 'http', label: 'HTTP 请求', types: ['http'] },
  { id: 'script', label: 'JS / TS 脚本', types: ['script'] },
  { id: 'file', label: '文件处理 / Excel', types: ['file', 'excel'] },
  { id: 'logic', label: '条件 / 串行循环', types: ['condition', 'loop'] },
  { id: 'review', label: '结果断言 / 等待人工', types: ['assert', 'human'] },
];
const descriptions: Record<string, string> = {
  value: '准备文本、数字或结构化数据',
  assert: '核对结果，不满足时停止运行',
  http: '发送 HTTP 请求并读取响应',
  script: '编写 JavaScript 或 TypeScript 处理逻辑',
  file: '读取、写入或整理绑定目录中的文件',
  excel: '读取、写入工作簿或配置表格映射',
  human: '暂停当前步骤，等待人工确认',
  condition: '根据判断结果进入不同分支',
  loop: '依次处理数组中的每一项',
};

const entries = [
  ...Object.entries(browserActions).map(([operation, preset]) => ({
    id: `browser.${operation}`,
    group: '网页',
    type: 'browser',
    ...preset,
    create: () => newBrowserStep(operation as BrowserOperation),
  })),
  ...Object.entries(kinds)
    .filter(([type]) => !['browser', 'mcp', 'desktop'].includes(type))
    .map(([type, kind]) => ({
      id: type,
      type,
      group: ['condition', 'loop', 'human', 'assert'].includes(type) ? '流程控制' : '数据与文件',
      label: kind.label,
      detail: descriptions[type] || kind.label,
      keywords: type,
      create: () => newStep(type),
    })),
];
export type DestinationChoice = Destination & { value: string; label: string };
export function destinations(steps: Step[], path = ''): DestinationChoice[] {
  return steps.flatMap((step, index) => {
    const name = `${path}${index + 1}. ${step.name || kinds[step.type]?.label || step.id}`;
    const branches =
      step.type === 'condition'
        ? (['then', 'else'] as const)
        : step.type === 'loop'
          ? (['body'] as const)
          : [];
    return [
      {
        value: `${step.id}:before`,
        label: `${name} / 前面`,
        anchor: step.id,
        side: 'before' as const,
      },
      {
        value: `${step.id}:after`,
        label: `${name} / 后面`,
        anchor: step.id,
        side: 'after' as const,
      },
      ...branches.flatMap((branch) => {
        const label = `${name} / ${{ then: '成立分支', else: '否则分支', body: '循环体' }[branch]}`;
        return [
          { value: `${step.id}:${branch}`, label, owner: step.id, branch },
          ...destinations((step as any)[branch], `${label} / `),
        ];
      }),
    ];
  });
}
export const destinationChoices = (steps: Step[]): DestinationChoice[] => [
  { value: 'main', label: '主流程末尾' },
  ...destinations(steps),
];

export default function ActionLibrary({
  steps,
  add,
  destination,
  setDestination,
}: {
  steps: Step[];
  add: (node: Step, destination: Destination) => boolean;
  destination: string;
  setDestination: (destination: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState('');
  const [closedSearchGroups, setClosedSearchGroups] = useState<string[]>([]);
  const scope = useId();
  const [notice, setNotice] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const targets = destinationChoices(steps);
  const target = targets.find((item) => item.value === destination);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = entries.filter((entry) =>
    terms.every((term) =>
      `${entry.label} ${entry.detail} ${entry.keywords} ${entry.group}`
        .toLocaleLowerCase()
        .includes(term),
    ),
  );
  const clear = () => {
    setQuery('');
    search.current?.focus();
  };
  return (
    <aside className="node-library" aria-label="动作库">
      <div className="action-library-tools">
        <h3>动作库</h3>
        <label className="action-search-label">
          <span>搜索动作</span>
          <div className="action-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={search}
              aria-label="搜索动作"
              placeholder="搜索名称 / 操作"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setClosedSearchGroups([]);
              }}
            />
            {query && (
              <button aria-label="清空动作搜索" onClick={clear}>
                <X size={12} />
              </button>
            )}
          </div>
        </label>
        <label className="action-destination">
          添加到
          <select
            aria-label="动作添加位置"
            value={target ? destination : ''}
            onChange={(e) => setDestination(e.target.value)}
          >
            {!target && (
              <option value="" disabled>
                原位置已删除，请重新选择
              </option>
            )}
            {targets.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {terms.length > 0 && (
          <p className="action-result-count" role="status">
            {matches.length} 个匹配动作
          </p>
        )}
        {!target && (
          <p className="field-error" role="alert">
            添加位置已失效，请先重新选择位置。
          </p>
        )}
      </div>
      <div className="action-list" aria-label="可添加动作">
        {groups.map((group) => {
          const members = matches.filter((entry) => group.types.includes(entry.type));
          if (!members.length) return null;
          const open =
            terms.length > 0 ? !closedSearchGroups.includes(group.id) : expanded === group.id;
          const panelId = `${scope}-${group.id}`;
          return (
            <section className="action-group" key={group.id} aria-label={group.label}>
              <button
                className="action-category"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => {
                  if (terms.length) {
                    setClosedSearchGroups((current) =>
                      open ? [...current, group.id] : current.filter((id) => id !== group.id),
                    );
                  } else setExpanded(open ? '' : group.id);
                }}
              >
                {group.label}
                {group.id === 'browser' ? ` · ${members.length}` : ''}
              </button>
              <div id={panelId} className="action-category-members" hidden={!open}>
                {members.map((entry) => {
                  const Icon = kinds[entry.type].icon;
                  return (
                    <button
                      key={entry.id}
                      aria-label={`添加 ${entry.label}`}
                      title={`${entry.detail} · ${target?.label ?? '请选择添加位置'}`}
                      disabled={!target}
                      onClick={() => {
                        if (!target) return;
                        const added = add(entry.create(), target);
                        setNotice(
                          added
                            ? `已添加“${entry.label}”至 ${target.label}；可在当前步骤配置中继续编辑。`
                            : '未添加动作，请先处理当前编辑器中的错误。',
                        );
                      }}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span className="action-entry-copy">
                        <strong>{entry.label}</strong>
                        <small>{entry.detail}</small>
                      </span>
                      <Plus size={12} className="action-add-icon" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!matches.length && (
          <div className="action-library-empty">
            <p>没有匹配动作</p>
            <p>调整关键词后重试。</p>
            {query && <button onClick={clear}>清空搜索</button>}
          </div>
        )}
      </div>
      <p className="action-library-notice" role="status" aria-live="polite">
        {notice || '选择动作，将其添加到指定位置。添加不会执行流程。'}
      </p>
    </aside>
  );
}
