import { useEffect, useId, useRef, useState } from 'react';
import type { Run } from '../shared/types';
import { runDisplayLabels, type RunListPage } from '../shared/run-history';
import './task-latest-run.css';

export default function TaskLatestRun({
  taskId,
  revision,
  active,
  disabled,
  open,
}: {
  taskId: string;
  revision: number;
  active: boolean;
  disabled: boolean;
  open: (detail: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const [latest, setLatest] = useState<Run | null>();
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const context = useRef({ taskId, revision, active, expanded });
  context.current = { taskId, revision, active, expanded };
  const current = (ticket: number) =>
    ticket === epoch.current &&
    context.current.active &&
    context.current.expanded &&
    context.current.taskId === taskId &&
    context.current.revision === revision;
  async function refresh() {
    if (!active || !expanded) return;
    const ticket = ++epoch.current;
    setLoading(true);
    setOpening(false);
    setError('');
    setLatest(undefined);
    try {
      const result: RunListPage = await window.flowark.request('run.list', { taskId, limit: 1 });
      if (!current(ticket)) return;
      if (result.runs.some((run) => run.task?.id !== taskId))
        throw new Error('运行记录与当前任务不一致，请重新读取。');
      setLatest(result.runs[0] ?? null);
    } catch (e) {
      if (current(ticket)) setError(e instanceof Error ? e.message : '未能读取任务运行记录');
    } finally {
      if (current(ticket)) setLoading(false);
    }
  }
  useEffect(() => {
    if (active && expanded) void refresh();
    return () => {
      epoch.current++;
    };
  }, [active, expanded, taskId, revision]);
  async function view() {
    if (!latest || loading || opening || disabled || !active || !expanded) return;
    const ticket = ++epoch.current;
    const id = latest.id;
    setOpening(true);
    setError('');
    try {
      const detail = await window.flowark.request('run.detail', { id });
      if (!current(ticket)) return;
      if (detail?.run?.id !== id || detail.run.task?.id !== taskId)
        throw new Error('运行详情与所选任务记录不一致，请重新读取。');
      open(detail);
    } catch (e) {
      if (current(ticket)) setError(e instanceof Error ? e.message : '未能打开运行记录');
    } finally {
      if (current(ticket)) setOpening(false);
    }
  }
  if (!active) return null;
  const date = latest ? Date.parse(latest.createdAt) : NaN;
  return (
    <section className="task-latest-run" aria-label="当前任务的最近运行">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          disabled={disabled && !expanded}
          onClick={() => {
            epoch.current++;
            setExpanded(!expanded);
          }}
        >
          {expanded ? '收起最近一次运行' : '查看最近一次运行'}
        </button>
      </h3>
      <div
        id={bodyId}
        hidden={!expanded}
        className="task-latest-run-body"
        aria-busy={loading || opening}
      >
        {loading && <p role="status">正在读取这个任务的运行记录…</p>}
        {latest === null && <p>这个任务还没有关联的运行记录。确认方案后可进入试运行前检查。</p>}
        {latest && (
          <>
            <p>记录状态：{runDisplayLabels[latest.state]}</p>
            <p>{latest.name}</p>
            <p>
              创建于 {Number.isFinite(date) ? new Date(date).toLocaleString('zh-CN') : '时间待核对'}
            </p>
            <p>
              运行来自任务修订 {latest.task!.revision} · 当前草稿修订 {revision}。
              {latest.task!.revision !== revision && '这次运行采用的任务修订与当前草稿不同。'}
            </p>
            <details>
              <summary>运行标识与固定版本</summary>
              <p>运行：{latest.id}</p>
              <p>版本：{latest.versionId}</p>
            </details>
            <button
              className="primary"
              disabled={disabled || loading || opening}
              onClick={() => void view()}
            >
              {opening ? '正在打开…' : '查看本次进度与结果'}
            </button>
            <p>打开后核对当前执行状态。查看历史快照不会运行当前草稿或重复执行。</p>
          </>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button disabled={disabled || loading || opening} onClick={() => void refresh()}>
          刷新运行记录
        </button>
      </div>
    </section>
  );
}
