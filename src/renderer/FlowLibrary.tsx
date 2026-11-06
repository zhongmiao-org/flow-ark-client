import { runStateColors } from './theme';
import { Card, Empty, Alert, Button, Input, Segmented, Tag, Badge, Select } from 'antd';
import { useLayoutEffect, useRef, useState } from 'react';
import { FileText, Folder, Globe, Search, Workflow } from 'lucide-react';
import type { Bootstrap, FlowRecord, Run } from '../shared/types';
import { runStateLabels } from '../shared/run-history';
import { flatten } from './flow-editing';
import { relativeEditTime } from './flow-library';
import { libraryTasks, filterTasks } from './task-library';
import type { TemplateInstance } from '../templates/types';

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
  openInstance: (instance: TemplateInstance) => void;
  showResult: (run: Run) => void;
  classifyFlow: (record: FlowRecord, usage: 'task' | 'development') => Promise<unknown>;
  classify: (instance: TemplateInstance, usage: 'task' | 'development') => Promise<unknown>;
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
  showAttention, openInstance, showResult, classify, classifyFlow,
}: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'recent' | 'template' | 'development' | 'issues'>('all');
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
        if (
          !failed &&
          trigger.isConnected &&
          !trigger.closest('[hidden]') &&
          (document.activeElement === trigger || document.activeElement === document.body)
        )
          trigger.focus();
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
  const tasks = libraryTasks(data);
  const first = ready && tasks.length === 0;
  const normal = tasks.filter(t => t.usage === 'task');
  const now = new Date();
  const records = filterTasks(tasks, filter, query, now);
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
              <span>{filter === 'development' ? '开发任务' : filter === 'issues' ? '需检查记录' : '本地任务'}</span>
              <strong>{records.length}</strong>
              <small>{records.filter(t => Date.parse(t.updatedAt) >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime()).length} 个最近编辑</small>
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
            <Segmented<'all' | 'recent' | 'template' | 'development' | 'issues'>
              className="flow-filter-control"
              aria-label="流程筛选"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `全部任务 ${normal.length}` },
                { value: 'recent', label: <span title="最近七个日历日内编辑">最近编辑</span> },
                { value: 'template', label: '来自模板' },
                { value: 'development', label: `开发与调试 ${tasks.filter(t => t.usage === 'development').length}` },
                { value: 'issues', label: `需检查 ${tasks.filter(t => t.issue).length}` },
              ]}
            />
            <Input
              className="flow-search"
              prefix={<Search size={20} strokeWidth={1.6} aria-hidden="true" />}
              ref={(instance) => {
                search.current = instance?.input ?? null;
              }}
              aria-label="搜索任务或内部入口"
              placeholder="搜索任务或内部入口"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flow-grid">
            {records.map((task) => {
              const record = task.records[0];
              const steps = task.records.flatMap(r => flatten(r.flow.steps));
              const Icon = steps.some((s) => s.type === 'browser')
                ? Globe
                : steps.some((s) => s.type === 'excel')
                  ? FileText
                  : steps.some((s) => s.type === 'file')
                    ? Folder
                    : Workflow;
              const run = task.run;
              const state = run?.state;
              const historicalActive =
                run &&
                ['RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state) &&
                data.execution?.active?.runId !== run.id;
              return (
                <article key={task.id} aria-label={task.name}>
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
                    <h2 title={task.name}>{task.name}</h2>
                    {task.version && <Tag>v{task.version}</Tag>}
                    {task.readiness && <p>{task.readiness}</p>}
                    {task.issue && <Alert type="warning" title={task.issue} />}
                    <p title={task.description}>
                      {task.instance ? `${task.records.length} 个内部入口 · 打开任务配置和运行` : task.description || '你的下一个自动化流程'}
                    </p>
                    <footer>
                      <span title={new Date(task.updatedAt).toLocaleString('zh-CN')}>
                        {task.instance ? `${task.records.length} 个入口` : `${steps.length} 个步骤`} · {relativeEditTime(task.updatedAt, now)}
                      </span>
                      <Button
                        disabled={busy || undefined}
                        aria-label={`打开 ${task.name}`}
                        onClick={() => task.instance ? openInstance(task.instance) : record && open(record)}
                      >
                        打开
                      </Button>
                    </footer>
                    {(task.latestRun ?? run) && <Button type="link" onClick={() => showResult((task.latestRun ?? run)!)}>查看最近结果</Button>}
                    {(task.instance || (record && !record.bindings.template)) && <Select aria-label={`任务分类 ${task.name}`} value={task.usage} disabled={busy} style={{ marginTop: 12, width: 160 }} options={[{ value: 'task', label: '普通任务' }, { value: 'development', label: '开发与调试' }]} onChange={usage => { setEntryError(''); void (task.instance ? classify(task.instance, usage) : classifyFlow(record, usage)).catch(e => setEntryError(e.message)); }} />}
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
                    <h2>没有找到匹配的任务</h2>
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
