import { Alert, Collapse, Select, Button, Input } from 'antd';
import { useId, useRef, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import type { Step } from '../shared/types';
import type { Destination } from './flow-editing';
import { taskStepTitle } from './task-step-presentation';
import { kinds } from './node-kinds';
import { newStep } from './node-defaults';
import { browserActions, newBrowserStep, type BrowserOperation } from './browser-actions';
import { activateCollapseWithSpace } from './collapseKeyboard';
import './action-library.css';

const groups = [
  { id: 'browser', label: '网页操作', types: ['browser'] },
  { id: 'value', label: '数据与变量', types: ['value'] },
  { id: 'ai', label: 'AI 调用', types: ['ai', 'conversation'] },
  { id: 'http', label: 'HTTP 请求', types: ['http'] },
  { id: 'script', label: 'JS / TS 脚本', types: ['script'] },
  { id: 'file', label: '文件处理 / Excel', types: ['document', 'file', 'excel'] },
  { id: 'logic', label: '条件 / 串行循环', types: ['condition', 'loop'] },
  { id: 'review', label: '结果断言 / 等待人工', types: ['assert', 'human'] },
];
const descriptions: Record<string, string> = {
  document: '提取PDF、DOCX或文本，并保留来源与内容缺口',
  value: '准备文本、数字或结构化数据',
  assert: '核对结果，不满足时停止运行',
  conversation: '保存多轮对话并在待办继续，确认后供流程读取',
  ai: '使用用户自己的 AI 服务生成可校验的结构化结果',
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
  let ordinal = 0;
  const collect = (nodes: Step[], prefix: string): DestinationChoice[] =>
    nodes.flatMap((step) => {
      const name = `${prefix}${String(++ordinal).padStart(2, '0')} ${taskStepTitle(step)}`;
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
            { value: `${step.id}:${branch}`, label: `${label} / 末尾`, owner: step.id, branch },
            ...collect((step as any)[branch], `${label} / `),
          ];
        }),
      ];
    });
  return collect(steps, path);
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
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string }>();
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
          <Input
            size="small"
            ref={(instance) => {
              search.current = instance?.input ?? null;
            }}
            prefix={<Search size={14} aria-hidden="true" />}
            suffix={
              query && (
                <Button
                  size="small"
                  type="text"
                  aria-label="清空动作搜索"
                  icon={<X size={12} aria-hidden="true" />}
                  onClick={clear}
                />
              )
            }
            aria-label="搜索动作"
            placeholder="搜索名称 / 操作"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setClosedSearchGroups([]);
            }}
          />
        </label>
        <label className="action-destination">
          添加到
          <Select<string>
            aria-label="动作添加位置"
            size="small"
            status={!target ? 'error' : undefined}
            aria-invalid={!target}
            aria-describedby={!target ? `${scope}-target-error` : undefined}
            title={target?.label}
            value={target ? destination : ''}
            onChange={(value) => setDestination(value)}
            options={[
              ...(!target
                ? [{ value: '', disabled: true, label: '原位置已删除，请重新选择' }]
                : []),
              ...targets.map((item) => ({ value: item.value, label: item.label })),
            ]}
          />
        </label>
        {terms.length > 0 && (
          <p className="action-result-count" role="status">
            {matches.length} 个匹配动作
          </p>
        )}
        {!target && (
          <Alert
            id={`${scope}-target-error`}
            type="error"
            showIcon
            title="添加位置已失效，请先重新选择位置。"
          />
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
            <div key={group.id} onKeyDown={activateCollapseWithSpace}>
              <Collapse
                className="action-group"
                size="small"
                activeKey={open ? [group.id] : []}
                onChange={(keys) => {
                  const nextOpen = keys.includes(group.id);
                  if (terms.length) {
                    setClosedSearchGroups((current) =>
                      nextOpen
                        ? current.filter((id) => id !== group.id)
                        : [...new Set([...current, group.id])],
                    );
                  } else setExpanded(nextOpen ? group.id : '');
                }}
                items={[
                  {
                    key: group.id,
                    label: `${group.label}${group.id === 'browser' ? ` · ${members.length}` : ''}`,
                    showArrow: false,
                    forceRender: true,
                    children: (
                      <div id={panelId} className="action-category-members">
                        {members.map((entry) => {
                          const Icon = kinds[entry.type].icon;
                          return (
                            <Button
                              key={entry.id}
                              className="action-entry"
                              type="text"
                              block
                              aria-label={`添加 ${entry.label}`}
                              title={`${entry.detail} · ${target?.label ?? '请选择添加位置'}`}
                              disabled={!target || undefined}
                              onClick={() => {
                                if (!target) return;
                                const added = add(entry.create(), target);
                                setNotice({
                                  type: added ? 'success' : 'error',
                                  text: added
                                    ? `已添加“${entry.label}”至 ${target.label}；可在当前步骤配置中继续编辑。`
                                    : '未添加动作，请先处理当前编辑器中的错误。',
                                });
                              }}
                            >
                              <Icon size={15} aria-hidden="true" />
                              <span className="action-entry-copy">
                                <strong>{entry.label}</strong>
                                <small>{entry.detail}</small>
                              </span>
                              <Plus size={12} className="action-add-icon" aria-hidden="true" />
                            </Button>
                          );
                        })}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          );
        })}
        {!matches.length && (
          <div className="action-library-empty">
            <Alert type="info" showIcon title="没有匹配动作" description="调整关键词后重试。" />
            {query && <Button onClick={clear}>清空搜索</Button>}
          </div>
        )}
      </div>
      <Alert
        type={notice?.type ?? 'info'}
        showIcon
        role="status"
        aria-live="polite"
        title={notice?.text ?? '选择动作，将其添加到指定位置。添加不会执行流程。'}
      />
    </aside>
  );
}
