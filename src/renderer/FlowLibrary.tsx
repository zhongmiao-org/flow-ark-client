import { runStateColors } from './theme';
import { Card, Empty, Alert, Button, Input, Segmented, Tag, Badge } from 'antd';
import { useLayoutEffect, useRef, useState } from 'react';
import { FileText, Folder, Globe, Search, Workflow } from 'lucide-react';
import type { Bootstrap, FlowRecord, Run } from '../shared/types';
import { runStateLabels } from '../shared/run-history';
import { flatten } from './flow-editing';
import { filterFlows, relativeEditTime } from './flow-library';

type Props = {
  visible: boolean;
  data: Bootstrap;
  loaded: boolean;
  busy: boolean;
  active: Run | null;
  create: () => void | Promise<unknown>;
  open: (record: FlowRecord) => void;
  importTemplate: () => void | Promise<unknown>;
  showAttention: () => void;
};
export default function FlowLibrary({
  visible,
  data,
  loaded,
  busy,
  active,
  create,
  open,
  importTemplate,
  showAttention,
}: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'recent' | 'template'>('all');
  const page = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const scroll = useRef(0);
  const visited = useRef(false);
  const entryLocked = useRef(false);
  const [entryAction, setEntryAction] = useState<'create' | 'import' | ''>('');
  const [entryError, setEntryError] = useState('');
  const entryErrorPanel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (visible && entryError) entryErrorPanel.current?.focus();
  }, [visible, entryError]);
  const startEntry = async (kind: 'create' | 'import') => {
    if (busy || entryLocked.current) return;
    const trigger = document.activeElement as HTMLElement;
    entryLocked.current = true;
    setEntryAction(kind);
    setEntryError('');
    let failed = false;
    try {
      await (kind === 'create' ? create() : importTemplate());
    } catch (reason) {
      failed = true;
      setEntryError(reason instanceof Error ? reason.message : '操作未完成，请重试。');
    } finally {
      entryLocked.current = false;
      setEntryAction('');
      requestAnimationFrame(() => {
        if (!failed && trigger.isConnected && !trigger.closest('[hidden]')) trigger.focus();
      });
    }
  };
  useLayoutEffect(() => {
    if (!visible) return;
    const main = page.current?.closest('main');
    if (visited.current) {
      if (main) main.scrollTop = scroll.current;
      const target = returnFocus.current;
      if (target?.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true });
      else page.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    }
    visited.current = true;
    const rememberScroll = () => {
      scroll.current = main?.scrollTop ?? 0;
    };
    main?.addEventListener('scroll', rememberScroll, { passive: true });
    return () => main?.removeEventListener('scroll', rememberScroll);
  }, [visible]);
  const ready = loaded && !data.fault;
  const first = ready && data.flows.length === 0;
  const now = new Date();
  const records = filterFlows(data.flows, filter, query, now);
  const today = data.runOverview.today;
  const unread = data.attention.filter((a) => !a.read).length;
  return (
    <section
      ref={page}
      hidden={!visible}
      className="page flows-page"
      aria-label="流程工作空间"
      onFocusCapture={(event) => {
        returnFocus.current = event.target;
      }}
    >
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>{first ? '从第一个流程开始' : '我的流程'}</h1>
          <p>
            {first
              ? '把一次重复操作，变成可持续使用的流程。'
              : '让日常操作有序运行，把注意力留给更重要的事。'}
          </p>
        </div>
        {!first && (
          <Button
            type="primary"
            onClick={() => void startEntry('create')}
            disabled={busy || !ready || !!entryAction || undefined}
          >
            {entryAction === 'create' ? '正在创建…' : '新建流程'}
          </Button>
        )}
      </div>
      {!ready ? (
        <Card className="first-flow" role="status">
          {data.fault ? '本地记录读取异常，请先处理上方提示。' : '正在读取本地工作空间…'}
        </Card>
      ) : first ? (
        <Card className="first-flow" aria-busy={!!entryAction}>
          <Workflow size={56} strokeWidth={1.6} aria-hidden="true" />
          <h2>你的工作流，从这里开始。</h2>
          <p>从空白流程搭建，或导入可信模板。所有流程和运行记录保存在本机。</p>
          <div className="row">
            <Button
              type="primary"
              disabled={busy || !!entryAction || undefined}
              onClick={() => void startEntry('create')}
            >
              {entryAction === 'create' ? '正在创建…' : '创建空白流程'}
            </Button>
            <Button
              disabled={busy || !!entryAction || undefined}
              onClick={() => void startEntry('import')}
            >
              {entryAction === 'import' ? '正在检查模板…' : '导入模板包'}
            </Button>
          </div>
          <small>无需连接 FlowArk 平台即可开始。</small>
        </Card>
      ) : (
        <>
          <div className="workspace-summary" aria-label="本地工作空间统计">
            <Card size="small">
              <span>本地流程</span>
              <strong>{data.flows.length}</strong>
              <small>{filterFlows(data.flows, 'recent', '', now).length} 个最近编辑</small>
            </Card>
            <Card size="small">
              <span>今日运行</span>
              <strong>{today?.total ?? '—'}</strong>
              <small>
                {today
                  ? `${today.succeeded} 完成 · ${today.failed} 失败 · ${today.interrupted} 中断`
                  : '尚未取得今日记录'}
              </small>
            </Card>
            <Card size="small">
              <span>正在运行</span>
              <strong>{data.execution ? (data.execution.active ? '01' : '00') : '—'}</strong>
              <small title={active?.name}>
                {active
                  ? active.name
                  : data.execution?.active
                    ? '任务进行中，正在读取运行详情'
                    : data.fault || data.runtimeBlock
                      ? '资源状态待核对，请处理上方提示'
                      : data.execution
                        ? '当前没有活动任务'
                        : '正在核对执行状态'}
                {data.runOverview.queued > 0 ? ` · ${data.runOverview.queued} 个排队` : ''}
              </small>
            </Card>
            <Card size="small" styles={{ body: { padding: 0 } }}>
              <Button type="text" className="summary-attention" onClick={showAttention}>
                <span>需要处理</span>
                <strong>{String(unread).padStart(2, '0')}</strong>
                <small>查看待办与提醒 →</small>
              </Button>
            </Card>
          </div>
          <div className="flow-filters">
            <Segmented<'all' | 'recent' | 'template'>
              className="flow-filter-control"
              aria-label="流程筛选"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `全部流程 ${data.flows.length}` },
                { value: 'recent', label: <span title="最近七个日历日内编辑">最近编辑</span> },
                { value: 'template', label: '来自模板' },
              ]}
            />
            <Input
              className="flow-search"
              prefix={<Search size={20} strokeWidth={1.6} aria-hidden="true" />}
              ref={(instance) => {
                search.current = instance?.input ?? null;
              }}
              aria-label="搜索流程名称"
              placeholder="搜索流程名称"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flow-grid">
            {records.map((record) => {
              const steps = flatten(record.flow.steps);
              const Icon = steps.some((s) => s.type === 'browser')
                ? Globe
                : steps.some((s) => s.type === 'excel')
                  ? FileText
                  : steps.some((s) => s.type === 'file')
                    ? Folder
                    : Workflow;
              const run = data.runOverview.latest.find((r) => r.flowId === record.id);
              const state = run?.state;
              const historicalActive =
                run &&
                ['RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state) &&
                data.execution?.active?.runId !== run.id;
              return (
                <article key={record.id} aria-label={record.flow.name}>
                  <Card className="flow-card">
                    <div className="card-top">
                      <Icon size={28} strokeWidth={1.6} aria-hidden="true" />
                      <Tag
                        className="run-state-tag"
                        variant="filled"
                        color={
                          historicalActive ? 'warning' : state ? runStateColors[state] : 'default'
                        }
                        icon={
                          <Badge
                            status={
                              historicalActive
                                ? 'warning'
                                : state
                                  ? runStateColors[state]
                                  : 'default'
                            }
                          />
                        }
                      >
                        {historicalActive ? '待核对' : state ? runStateLabels[state] : '未运行'}
                      </Tag>
                    </div>
                    <h2 title={record.flow.name}>{record.flow.name}</h2>
                    <p title={record.flow.description}>
                      {record.flow.description || '你的下一个自动化流程'}
                    </p>
                    <footer>
                      <span title={new Date(record.updatedAt).toLocaleString('zh-CN')}>
                        {steps.length} 个步骤 · {relativeEditTime(record.updatedAt, now)}
                      </span>
                      <Button
                        disabled={busy || undefined}
                        aria-label={`编辑 ${record.flow.name}`}
                        onClick={() => open(record)}
                      >
                        打开
                      </Button>
                    </footer>
                  </Card>
                </article>
              );
            })}
          </div>
          {!records.length && (
            <div role="status">
              <Empty
                className="flow-no-results"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <>
                    <h2>没有找到匹配的流程</h2>
                    <p>调整名称或筛选条件后重试。</p>
                  </>
                }
              >
                <Button
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                    search.current?.focus();
                  }}
                >
                  清除筛选
                </Button>
              </Empty>
            </div>
          )}
        </>
      )}
      {entryError && (
        <div ref={entryErrorPanel} tabIndex={-1} className="flow-entry-error">
          <Alert type="error" showIcon title={entryError} />
        </div>
      )}
    </section>
  );
}
