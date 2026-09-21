import { useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import type { Step } from '../shared/types';
import type { Destination } from './flow-editing';
import { kinds } from './node-kinds';
import { newStep } from './node-defaults';
import { browserActions, newBrowserStep, type BrowserOperation } from './browser-actions';

const entries = [
  ...Object.entries(browserActions).map(([operation, preset]) => ({
    id: `browser.${operation}`,
    group: '网页',
    type: 'browser',
    ...preset,
    create: () => newBrowserStep(operation as BrowserOperation),
  })),
  ...Object.entries(kinds)
    .filter(([type]) => !['browser'].includes(type))
    .map(([type, kind]) => ({
      id: type,
      type,
      group: ['condition', 'loop', 'human', 'assert'].includes(type) ? '流程控制' : '数据与文件',
      label: kind.label,
      detail: kind.label,
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
  add: (node: Step, destination: Destination) => void;
  destination: string;
  setDestination: (destination: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('全部');
  const targets = destinationChoices(steps);
  const target = targets.find((item) => item.value === destination);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = entries.filter((entry) =>
    terms.length
      ? terms.every((term) =>
          `${entry.label} ${entry.detail} ${entry.keywords} ${entry.group}`
            .toLocaleLowerCase()
            .includes(term),
        )
      : group === '全部' || entry.group === group,
  );
  return (
    <aside className="node-library" aria-label="动作库">
      <div className="action-library-tools">
        <span className="eyebrow">动作库</span>
        <div className="action-search">
          <Search size={14} aria-hidden="true" />
          <input
            aria-label="搜索动作"
            placeholder="搜索动作…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="清空动作搜索" onClick={() => setQuery('')}>
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
        <select
          aria-label="动作分类"
          value={terms.length ? '全部' : group}
          onChange={(e) => setGroup(e.target.value)}
          disabled={terms.length > 0}
        >
          {['全部', '网页', '数据与文件', '流程控制'].map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="action-list" aria-label="可添加动作">
        {matches.map((entry) => {
          const Icon = kinds[entry.type].icon;
          return (
            <button
              key={entry.id}
              aria-label={`添加 ${entry.label}`}
              title={`${entry.detail} · ${target?.label ?? '请选择添加位置'}`}
              disabled={!target}
              onClick={() => target && add(entry.create(), target)}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{entry.label}</span>
              <Plus size={12} className="action-add-icon" aria-hidden="true" />
            </button>
          );
        })}
        {!matches.length && <p role="status">没有匹配动作，试试“填写”或“select”。</p>}
      </div>
    </aside>
  );
}
