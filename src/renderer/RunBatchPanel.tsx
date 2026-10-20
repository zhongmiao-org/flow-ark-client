import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Tag } from 'antd';
import type { Run } from '../shared/types';
import type {
  BatchHistoryPage,
  BatchSessionView,
  BatchStopReceipt,
  BatchStopRequest,
} from '../shared/entry-batches';
import TechnicalDetails from './TechnicalDetails';
import { runDisplayLabels } from '../shared/run-history';
import './entry-batches.css';

const phases: Record<BatchSessionView['phase'], string> = {
  running: '本批处理中',
  waiting: '等待下一批',
  stopping: '本批结束后停止',
  stopped: '已停止后续批次',
  completed: '目标已完成',
  interrupted: '连续运行已中断',
};
const cancellation: Record<BatchStopReceipt['currentCancellation'], string> = {
  'not-requested': '当前批次按原边界继续结束',
  requested: '已请求取消当前运行；实际结果请查看原批次',
  'already-terminal': '原运行已经结束',
  'not-running': '当前没有活动批次',
  'needs-check': '当前运行的取消请求尚未核对；查询不会再次取消',
};
type StopAttempt = {
  request: BatchStopRequest;
  pending: boolean;
  receipt?: BatchStopReceipt;
  error?: string;
};
// Navigation retains the original request ID, including an unknown response. Never a new execution permit.
const stopAttempts = new Map<string, StopAttempt>();
const api = (method: string, args: unknown) => window.flowark.request(method, args);
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : '读取尚未完成，请重新核对');
export default function RunBatchPanel({ run, open }: { run: Run; open: (detail: any) => void }) {
  const reference = run.batch!;
  const [view, setView] = useState<BatchSessionView>();
  const [history, setHistory] = useState<BatchHistoryPage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(stopAttempts.get(reference.sessionId));
  const cursor = useRef<BatchHistoryPage['nextCursor']>(null);
  const revision = useRef(0),
    epoch = useRef(0),
    pageEpoch = useRef(0),
    reading = useRef(false);
  const latest = useRef({ reference, run, open });
  latest.current = { reference, run, open };
  const refresh = async () => {
    if (reading.current) return;
    reading.current = true;
    const current = epoch.current,
      page = pageEpoch.current;
    try {
      const ref = latest.current.reference;
      const state: BatchSessionView | null = await api('run.batch.get', {
        sessionId: ref.sessionId,
      });
      if (current !== epoch.current) return;
      if (
        !state ||
        state.sessionId !== ref.sessionId ||
        state.scopeSha256 !== ref.scopeSha256 ||
        state.flowId !== latest.current.run.flowId
      )
        throw Error('会话来源不可核验；原运行记录保持');
      if (state.revision >= revision.current) {
        revision.current = state.revision;
        setView(state);
        setError('');
      }
      const result: BatchHistoryPage = await api('run.batch.history', {
        sessionId: ref.sessionId,
        ...(cursor.current ? { cursor: cursor.current } : {}),
      });
      if (current !== epoch.current || page !== pageEpoch.current) return;
      if (result.sessionId !== ref.sessionId || result.scopeSha256 !== ref.scopeSha256)
        throw Error('批次历史与当前会话不一致');
      setHistory(result);
    } catch (e) {
      if (current === epoch.current) setError(errorMessage(e));
    } finally {
      reading.current = false;
    }
  };
  useEffect(() => {
    epoch.current++;
    revision.current = 0;
    cursor.current = null;
    pageEpoch.current++;
    setView(undefined);
    setHistory(undefined);
    setError('');
    setBusy(false);
    setAttempt(stopAttempts.get(reference.sessionId));
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      epoch.current++;
      clearInterval(timer);
    };
  }, [reference.sessionId]);
  const stop = async (mode: BatchStopRequest['mode']) => {
    let prior = stopAttempts.get(reference.sessionId);
    if (prior?.pending) return;
    if (!prior || prior.receipt)
      prior = {
        request: { requestId: crypto.randomUUID(), sessionId: reference.sessionId, mode },
        pending: false,
      };
    const pending = { ...prior, pending: true, error: undefined };
    stopAttempts.set(reference.sessionId, pending);
    setAttempt(pending);
    setBusy(true);
    const current = epoch.current;
    try {
      const receipt: BatchStopReceipt = await api('run.batch.stop', pending.request);
      if (
        receipt.requestId !== pending.request.requestId ||
        receipt.sessionId !== reference.sessionId ||
        receipt.mode !== pending.request.mode ||
        receipt.nextBatchesStopped !== true
      )
        throw Error('尚未取得原停止请求的准确回执');
      const next = { request: pending.request, pending: false, receipt };
      stopAttempts.set(reference.sessionId, next);
      if (current === epoch.current) {
        setAttempt(next);
        await refresh();
      }
    } catch (e) {
      const next = { ...pending, pending: false, error: errorMessage(e) };
      stopAttempts.set(reference.sessionId, next);
      if (current === epoch.current) setAttempt(next);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };
  const openRun = async (id: string, ordinal: number) => {
    const current = epoch.current;
    setBusy(true);
    try {
      const detail = await api('run.detail', { id });
      if (
        detail?.run?.id !== id ||
        detail.run.batch?.sessionId !== reference.sessionId ||
        detail.run.batch?.ordinal !== ordinal ||
        detail.run.batch?.scopeSha256 !== reference.scopeSha256
      )
        throw Error('原批次详情与会话链接不一致');
      if (current === epoch.current) latest.current.open(detail);
    } catch (e) {
      if (current === epoch.current) setError(errorMessage(e));
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };
  const terminal = view && ['stopped', 'completed', 'interrupted'].includes(view.phase);
  const live = !!view?.live && !error;
  return (
    <Card className="batch-session" title="本次连续运行" aria-label="连续运行状态">
      {!view ? (
        <p role="status">正在读取本机会话及准确批次记录…</p>
      ) : (
        <>
          <Tag>
            {!live && !terminal ? '最后保存状态 · ' : ''}
            {phases[view.phase]}
          </Tag>
          <h2>{view.name}</h2>
          <p>
            {view.ownerName} · {view.entryName} · 来源固定
          </p>
          <p>
            已登记 {view.startedBatches} 批，已结束 {view.finishedBatches} 批，最多{' '}
            {view.limits.maxBatches} 批。
          </p>
          {view.current && (
            <p>
              第 {view.current.ordinal} 批{live ? '正在处理' : '请查看原运行核对'}
              ；当前网页及业务结果仍由本批流程核对。
            </p>
          )}
          {view.nextAt && (
            <p>
              {live ? '下一批最早开始于' : '最后保存的下一批时间'}{' '}
              {new Date(view.nextAt).toLocaleTimeString('zh-CN')}
              。等待期间不占运行槽，其他任务按原队列处理。
            </p>
          )}
          {view.checkingNext && <p>正在重新核对下一批来源、资源与网页；尚未创建新的运行。</p>}
          {view.stopReason && (
            <Alert
              type={view.phase === 'completed' ? 'success' : 'info'}
              showIcon
              title={phases[view.phase]}
              description={view.stopReason.message}
            />
          )}
          <p>
            新批次调度时限：{new Date(view.dispatchDeadline).toLocaleString('zh-CN')}
            。到时停止新批，当前批仍按原预算结束。
          </p>
          <div className="batch-actions">
            {!terminal && (
              <Button
                disabled={!live || busy || !!attempt?.error}
                onClick={() => void stop('after-batch')}
              >
                本批结束后停止
              </Button>
            )}
            {!terminal && view.current && (
              <Button
                danger
                disabled={!live || busy || !!attempt?.error}
                onClick={() => void stop('cancel-current')}
              >
                立即取消当前运行
              </Button>
            )}
            {view.current && view.current.runId !== run.id && (
              <Button
                disabled={busy}
                onClick={() => void openRun(view.current!.runId, view.current!.ordinal)}
              >
                查看当前批次
              </Button>
            )}
            <Button disabled={busy} onClick={() => void refresh()}>
              重新读取会话
            </Button>
          </div>
          <p>
            已提交结果不会因停止撤销。关闭此页面不停止会话；失败、未知、配置或权限变化会阻止后续批次，重开不会自动恢复。
          </p>
          <TechnicalDetails
            items={[
              { label: '连续会话', value: view.sessionId },
              { label: '固定范围摘要', value: view.scopeSha256 },
            ]}
          />
        </>
      )}
      {attempt?.pending && <p role="status">正在保存停止请求；离开页面不会撤销已提交的停止。</p>}
      {attempt?.receipt && (
        <Alert
          type="info"
          showIcon
          title="后续批次已停止"
          description={cancellation[attempt.receipt.currentCancellation]}
        />
      )}
      {attempt?.error && (
        <Alert
          type="warning"
          showIcon
          title="停止结果尚未核对"
          description={
            <>
              <p>{attempt.error}</p>
              <Button disabled={busy} onClick={() => void stop(attempt.request.mode)}>
                查询原停止请求
              </Button>
            </>
          }
        />
      )}
      {error && <Alert type="warning" showIcon title="会话读取需要核对" description={error} />}
      <h3>连续运行历史</h3>
      <p>每批原记录和完整结果各自保留。查看历史不会重放流程。</p>
      <ul className="batch-history">
        {history?.items.map(({ row }) => (
          <li key={row.runId}>
            <span>
              第 {row.ordinal} 批 · {row.runName} · {runDisplayLabels[row.runState]}
            </span>
            <Button disabled={busy} onClick={() => void openRun(row.runId, row.ordinal)}>
              查看这批记录
            </Button>
          </li>
        ))}
      </ul>
      {history && !history.items.length && (
        <p>
          {history.nextCursor
            ? '此扫描页未匹配批次，仍可读取较早记录。'
            : '此页没有批次记录，请保留会话来源核对。'}
        </p>
      )}
      <div className="batch-actions">
        {history?.nextCursor && (
          <Button
            disabled={busy}
            onClick={() => {
              cursor.current = history.nextCursor;
              pageEpoch.current++;
              void refresh();
            }}
          >
            查看较早批次
          </Button>
        )}
        {cursor.current && (
          <Button
            disabled={busy}
            onClick={() => {
              cursor.current = null;
              pageEpoch.current++;
              void refresh();
            }}
          >
            查看最新批次
          </Button>
        )}
      </div>
    </Card>
  );
}
