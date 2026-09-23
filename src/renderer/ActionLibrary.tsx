import { useRef, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import type { Step } from '../shared/types';
import type { Destination } from './flow-editing';
import { kinds } from './node-kinds';
import { newStep } from './node-defaults';
import { browserActions, newBrowserStep, type BrowserOperation } from './browser-actions';
import './action-library.css';

const groups = ['网页', '数据与文件', '流程控制'];
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
    .filter(([type]) => !['browser', 'mcp'].includes(type))
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
  const [group, setGroup] = useState('全部');
  const [notice, setNotice] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const targets = destinationChoices(steps);
  const target = targets.find((item) => item.value === destination);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = entries.filter(
    (entry) =>
      (group === '全部' || entry.group === group) &&
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
        <div className="action-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={search}
            aria-label="搜索动作"
            placeholder="搜索动作…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="清空动作搜索" onClick={clear}>
              <X size={12} />
            </button>
          )}
        </div>
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
        <select aria-label="动作分类" value={group} onChange={(e) => setGroup(e.target.value)}>
          {['全部', ...groups].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <p className="action-result-count" role="status">
          {matches.length} 个可用动作
        </p>
        {!target && (
          <p className="field-error" role="alert">
            添加位置已失效，请先重新选择位置。
          </p>
        )}
      </div>
      <div className="action-list" aria-label="可添加动作">
        {groups.map((name) => {
          const members = matches.filter((entry) => entry.group === name);
          if (!members.length) return null;
          return (
            <section className="action-group" key={name} aria-label={name}>
              <h4>
                {name === '网页' ? '网页操作' : name}
                <span>{members.length}</span>
              </h4>
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
            </section>
          );
        })}
        {!matches.length && (
          <div className="action-library-empty">
            <p>没有匹配动作</p>
            <p>调整关键词或分类后重试。</p>
            {query && <button onClick={clear}>清空搜索</button>}
            {group !== '全部' && <button onClick={() => setGroup('全部')}>查看全部分类</button>}
          </div>
        )}
      </div>
      <p className="action-library-notice" role="status" aria-live="polite">
        {notice || '选择动作，将其添加到指定位置。添加不会执行流程。'}
      </p>
    </aside>
  );
}
