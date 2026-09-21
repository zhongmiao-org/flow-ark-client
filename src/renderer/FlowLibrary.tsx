import { useState } from 'react';
import { FileText, Folder, Globe, Search, Workflow } from 'lucide-react';
import type { Bootstrap, FlowRecord, Run } from '../shared/types';
import { runStateLabels } from '../shared/run-history';
import { flatten } from './flow-editing';
import { filterFlows, relativeEditTime } from './flow-library';

type Props = {
  data: Bootstrap;
  loaded: boolean;
  busy: boolean;
  active: Run | null;
  create: () => void;
  open: (record: FlowRecord) => void;
  importTemplate: () => void;
  showAttention: () => void;
};
export default function FlowLibrary({
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
  const ready = loaded && !data.fault;
  const first = ready && data.flows.length === 0;
  const now = new Date();
  const records = filterFlows(data.flows, filter, query, now);
  const today = data.runOverview.today;
  const unread = data.attention.filter((a) => !a.read).length;
  return (
    <section className="page flows-page" aria-label="流程工作空间">
      <div className="page-heading">
        <div>
          <h1>{first ? '从第一个流程开始' : '我的流程'}</h1>
          <p>
            {first
              ? '把一次重复操作，变成可持续使用的流程。'
              : '让日常操作有序运行，把注意力留给更重要的事。'}
          </p>
        </div>
        {!first && (
          <button className="primary" onClick={create} disabled={busy || !ready}>
            新建流程
          </button>
        )}
      </div>
      {!ready ? (
        <div className="first-flow" role="status">
          {data.fault ? '本地记录读取异常，请先处理上方提示。' : '正在读取本地工作空间…'}
        </div>
      ) : first ? (
        <div className="first-flow">
          <Workflow size={56} strokeWidth={1.6} aria-hidden="true" />
          <h2>你的工作流，从这里开始。</h2>
          <p>从空白流程搭建，或导入可信模板。所有流程和运行记录保存在本机。</p>
          <div className="row">
            <button className="primary" disabled={busy} onClick={create}>
              创建空白流程
            </button>
            <button disabled={busy} onClick={importTemplate}>
              导入模板包
            </button>
          </div>
          <small>无需连接 FlowArk 平台即可开始。</small>
        </div>
      ) : (
        <>
          <div className="workspace-summary" aria-label="本地工作空间统计">
            <div>
              <span>本地流程</span>
              <strong>{data.flows.length}</strong>
              <small>{filterFlows(data.flows, 'recent', '', now).length} 个最近编辑</small>
            </div>
            <div>
              <span>今日运行</span>
              <strong>{today?.total ?? '—'}</strong>
              <small>
                {today
                  ? `${today.succeeded} 完成 · ${today.failed} 失败 · ${today.interrupted} 中断`
                  : '尚未取得今日记录'}
              </small>
            </div>
            <div>
              <span>正在运行</span>
              <strong>{data.execution ? (active ? '01' : '00') : '—'}</strong>
              <small title={active?.name}>
                {active
                  ? active.name
                  : data.fault || data.runtimeBlock
                    ? '资源状态待核对，请处理上方提示'
                    : data.execution
                      ? '当前没有活动任务'
                      : '正在核对执行状态'}
                {data.runOverview.queued > 0 ? ` · ${data.runOverview.queued} 个排队` : ''}
              </small>
            </div>
            <button className="summary-attention" onClick={showAttention}>
              <span>需要处理</span>
              <strong>{String(unread).padStart(2, '0')}</strong>
              <small>查看待办与提醒 →</small>
            </button>
          </div>
          <div className="flow-filters">
            <div className="flow-tabs" role="group" aria-label="流程筛选">
              {(
                [
                  ['all', `全部流程  ${data.flows.length}`],
                  ['recent', '最近编辑'],
                  ['template', '来自模板'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  title={value === 'recent' ? '最近七个日历日内编辑' : undefined}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="search flow-search">
              <Search size={20} strokeWidth={1.6} aria-hidden="true" />
              <input
                aria-label="搜索流程名称"
                placeholder="搜索流程名称"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
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
                data.execution &&
                data.execution.active?.runId !== run.id;
              return (
                <article className="flow-card" key={record.id}>
                  <div className="card-top">
                    <Icon size={28} strokeWidth={1.6} aria-hidden="true" />
                    <span
                      className={`badge ${historicalActive ? 'state-INTERRUPTED' : state ? `state-${state}` : ''}`}
                    >
                      {historicalActive ? '待核对' : state ? runStateLabels[state] : '未运行'}
                    </span>
                  </div>
                  <h2>{record.flow.name}</h2>
                  <p title={record.flow.description}>
                    {record.flow.description || '你的下一个自动化流程'}
                  </p>
                  <footer>
                    <span title={new Date(record.updatedAt).toLocaleString('zh-CN')}>
                      {steps.length} 个步骤 · {relativeEditTime(record.updatedAt, now)}
                    </span>
                    <button aria-label={`编辑 ${record.flow.name}`} onClick={() => open(record)}>
                      打开
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
          {!records.length && (
            <div className="flow-no-results" role="status">
              <h2>没有找到匹配的流程</h2>
              <p>调整名称或筛选条件后重试。</p>
              <button
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                清除筛选
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
