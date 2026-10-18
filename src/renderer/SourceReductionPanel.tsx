import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Tag } from 'antd';
import SourceReductionRunReview from './SourceReductionRunReview';
import type { Json } from '../shared/types';
import {
  assertReductionAttempt,
  verifyReductionOutput,
  type ReductionTarget,
  type SourceReductionAttempt as Attempt,
  type SourceReductionOutput as Output,
} from '../shared/source-reduction';
import {
  verifyArchiveRecord,
  type ConversationArchiveRecord,
} from '../shared/conversation-archive';
import { RecordView } from './ConversationArchivePanel';
import MarkdownBody from './MarkdownBody';
import './source-reduction.css';

type View = { output: Output; busy: boolean; error: string };
const states: Record<string, string> = {
  prepared: '已准备，尚未发出',
  dispatched: '请求已发出',
  response: '完整响应已保存，尚未采用',
  failed: '请求失败',
  unknown: '结果未知',
  committed: '完整响应已采用',
  abandoned: '原尝试已保留，不再采用',
};
/** Data supplied by the template, never interpreted as commands or HTML. */
function ReadableData({ value, label = '整理草稿' }: { value: Json; label?: string }) {
  if (value === null) return <p>{label}：空值</p>;
  if (typeof value === 'string')
    return (
      <section className="reduction-value">
        <strong>{label}</strong>
        {value ? <MarkdownBody text={value} /> : <p>空文本</p>}
      </section>
    );
  if (typeof value !== 'object')
    return (
      <p>
        {label}：{typeof value === 'boolean' ? (value ? '是' : '否') : String(value)}
      </p>
    );
  const fields = Array.isArray(value)
    ? value.map((item, i) => [String(i + 1), item] as const)
    : Object.entries(value);
  return (
    <section className="reduction-value">
      <h4>
        {label}
        {Array.isArray(value) ? ` · ${fields.length}项` : ''}
      </h4>
      {fields.length ? (
        fields.map(([key, item]) =>
          typeof item === 'object' && item !== null ? (
            <Collapse
              key={key}
              items={[{ key, label: key, children: <ReadableData label={key} value={item} /> }]}
            />
          ) : (
            <ReadableData key={key} label={key} value={item} />
          ),
        )
      ) : (
        <p>尚无内容</p>
      )}
    </section>
  );
}
export default function SourceReductionPanel({
  target,
  initial,
  rerun,
  openRun,
}: {
  target: ReductionTarget;
  initial?: Output;
  rerun?: () => void;
  openRun?: (detail: any) => void;
}) {
  const [view, setView] = useState<View>(),
    [error, setError] = useState(''),
    [acting, setActing] = useState(false),
    [attempt, setAttempt] = useState<Attempt>(),
    [page, setPage] = useState<any>(),
    [reviewOpen, setReviewOpen] = useState(false),
    [row, setRow] = useState<ConversationArchiveRecord>();
  const generation = useRef(0),
    current = useRef<View | undefined>(undefined),
    lock = useRef(false),
    readSerial = useRef(0);
  const key = JSON.stringify(target);
  async function accept(v: View | null, visit: number, serial?: number) {
    if (!v) return;
    await verifyReductionOutput(v.output);
    if (visit !== generation.current || (serial !== undefined && serial !== readSerial.current))
      return;
    const prior = current.current;
    if (
      prior &&
      (prior.output.job.jobId !== v.output.job.jobId || prior.output.revision > v.output.revision)
    )
      return;
    current.current = v;
    setView(v);
  }
  async function refresh(visit = generation.current) {
    const serial = ++readSerial.current;
    try {
      await accept(await window.flowark.request('reduction.forRun', target), visit, serial);
    } catch (e) {
      if (visit === generation.current && serial === readSerial.current)
        setError((e as Error).message);
    }
  }
  useEffect(() => {
    const visit = ++generation.current;
    readSerial.current++;
    current.current = undefined;
    setView(undefined);
    setError('');
    setAttempt(undefined);
    setPage(undefined);
    setReviewOpen(false);
    setRow(undefined);
    setActing(false);
    lock.current = false;
    void refresh(visit);
    const stop = window.flowark.onmessage((raw) => {
      if (!('job' in raw)) return;
      const prior = current.current;
      if (
        prior &&
        (raw.job.jobId !== prior.output.job.jobId || raw.revision <= prior.output.revision)
      )
        return;
      void refresh(visit);
    });
    return () => {
      generation.current++;
      readSerial.current++;
      stop();
    };
  }, [key]);
  async function action(fn: () => Promise<void>) {
    if (lock.current) return;
    const visit = generation.current;
    lock.current = true;
    setActing(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (visit === generation.current) setError((e as Error).message);
    } finally {
      if (visit === generation.current) {
        lock.current = false;
        setActing(false);
      }
    }
  }
  const output = view?.output ?? initial;
  if (!output)
    return (
      <section className="reduction-panel" aria-label="来源整理进度">
        <p>尚无本节点已登记的整理任务；启动后会在本机持续保存进度。</p>
        <Button onClick={() => void refresh()}>重新读取进度</Button>
        {error && <Alert type="error" title={error} />}
      </section>
    );
  const id = output.job.jobId,
    cp = output.checkpoint;
  const params = { ...target, jobId: id };
  const pending = attempt?.attemptId === output.pendingAttemptId ? attempt : undefined;
  const disabled = acting || !view || view.busy;
  async function requestRecord(sequence: number) {
    const visit = generation.current;
    const a = await window.flowark.request('reduction.attempt', { ...params, sequence });
    assertReductionAttempt(a);
    if (a.job.jobId !== id || a.sequence !== sequence) throw Error('请求记录不属于当前任务');
    if (visit === generation.current) setAttempt(a);
  }
  async function requests(before: number | null = null) {
    const visit = generation.current;
    const result = await window.flowark.request('reduction.attempts', { ...params, before });
    if (visit === generation.current) setPage(result);
  }
  const complete = output.phase === 'complete';
  if (reviewOpen)
    return (
      <SourceReductionRunReview
        selection={params}
        back={() => setReviewOpen(false)}
        openRun={openRun}
      />
    );
  return (
    <section className="reduction-panel" aria-label="来源整理进度">
      <header>
        <h3>
          {complete
            ? '完整来源已整理，草稿待核对'
            : view?.busy
              ? '正在分批整理来源'
              : output.phase === 'attention'
                ? '保留进度，等待核对'
                : '已保存整理进度'}
        </h3>
        <Tag>
          {complete
            ? '完整处理凭据已登记'
            : output.phase === 'attention'
              ? '不会自动重试'
              : '草稿持续保存'}
        </Tag>
      </header>
      <Descriptions
        layout="vertical"
        column={{ xs: 1, sm: 3 }}
        items={[
          { key: 'records', label: '已完整处理原记录', children: cp.records },
          { key: 'chunks', label: '已采用完整片段', children: cp.chunks },
          { key: 'requests', label: '实际发出请求', children: output.attempts },
          { key: 'tokens', label: '供应商累计报告Token', children: output.reportedTotalTokens },
          { key: 'unknown', label: '用量尚未知的请求', children: output.unknownUsageRequests },
          {
            key: 'next',
            label: '下一安全位置',
            children: cp.next ? `原记录 ${cp.next.recordOrdinal}` : '固定来源终点',
          },
        ]}
      />
      <p>
        草稿修订{cp.revision}
        ；完整记录与片段分别计数。累计用量包含失败、取消和重试；未知用量不补零。
      </p>
      {initial && initial.revision !== output.revision && (
        <p>
          此Run固定结果保持修订{initial.revision}；下方显示同任务当前修订{output.revision}。
        </p>
      )}
      {(error || view?.error) && <Alert type="warning" title={error || view?.error} />}
      <div className="reduction-actions">
        <Button disabled={acting} onClick={() => void action(() => refresh())}>
          重新读取进度
        </Button>
        <Button disabled={acting} onClick={() => void action(() => requests())}>
          查看请求记录
        </Button>
        <Button
          disabled={acting}
          onClick={() =>
            void action(async () => {
              const visit = generation.current;
              const ordinal = cp.next?.recordOrdinal ?? Math.max(1, cp.records);
              const r = await verifyArchiveRecord(
                await window.flowark.request('source.runRecord', {
                  runId: target.runId,
                  nodeId: target.nodeId,
                  ordinal,
                }),
                output.job.source.archiveId,
                ordinal,
              );
              if (visit === generation.current) setRow(r);
            })
          }
        >
          查看固定来源
        </Button>
      </div>
      {row && (
        <div className="reduction-scroll">
          <RecordView row={row} />
        </div>
      )}
      <div className="reduction-scroll">
        <ReadableData value={cp.accumulator} />
      </div>
      {page && (
        <section aria-label="整理请求记录">
          <h4>请求记录 · 每页最多20项</h4>
          <ol>
            {page.rows.map((a: any) => (
              <li key={a.sequence}>
                <p>
                  第{a.sequence}次 · {states[a.state]} · 原记录{a.recordOrdinal} · 第
                  {a.byteOffset + 1}–{a.byteEnd}字节
                </p>
                <p>
                  {a.provider} / {a.model} · Token{' '}
                  {typeof a.usage?.total_tokens === 'number'
                    ? a.usage.total_tokens
                    : a.dispatched
                      ? '未知'
                      : '未发出，不计费请求'}
                </p>
                <Button
                  disabled={acting}
                  onClick={() => void action(() => requestRecord(a.sequence))}
                >
                  查看第{a.sequence}次请求
                </Button>
              </li>
            ))}
          </ol>
          {page.next && (
            <Button disabled={acting} onClick={() => void action(() => requests(page.next))}>
              更早请求
            </Button>
          )}
        </section>
      )}
      {attempt && (
        <section aria-label="当前请求核对">
          <h4>
            第{attempt.sequence}次请求 · {states[attempt.state]}
          </h4>
          <p>
            {attempt.request.provider} / {attempt.request.model} ·{' '}
            {attempt.transport ? '实际正文已在发出前登记' : '尚无发出记录'}
          </p>
          {attempt.outcome?.status === 'success' && (
            <div className="reduction-scroll">
              <ReadableData value={attempt.outcome.result.output} label="已保存的完整响应" />
            </div>
          )}
          {attempt.outcome?.status === 'failed' && (
            <Alert type="warning" title={attempt.outcome.error.message} />
          )}
          <Collapse
            items={[
              {
                key: 'wire',
                label: '准确请求及响应（高级调试，可选）',
                children: <pre className="archive-text">{JSON.stringify(attempt, null, 2)}</pre>,
              },
            ]}
          />
        </section>
      )}
      <footer>
        {view?.busy ? (
          <p role="status">本批请求正在运行。取消请使用运行控制；流式部分不会推进草稿。</p>
        ) : output.phase === 'attention' ? (
          <>
            <p>
              重新打开只读本机记录，不重新请求模型。先核对已保存的请求；若有完整响应可直接采用。
            </p>
            <Button
              disabled={disabled}
              onClick={() =>
                void action(async () => {
                  await requests();
                  const result = await window.flowark.request('reduction.attempts', {
                    ...params,
                    before: null,
                  });
                  const a = result.rows.find((a: any) => a.attemptId === output.pendingAttemptId);
                  if (a) await requestRecord(a.sequence);
                  else throw Error('未提交请求不在最新目录，请重新读取进度');
                })
              }
            >
              核对未提交请求
            </Button>
            {pending?.state === 'response' && (
              <Button
                type="primary"
                disabled={disabled}
                onClick={() =>
                  void action(async () => {
                    const visit = generation.current;
                    const v = await window.flowark.request('reduction.recover', {
                      ...params,
                      revision: output.revision,
                      pendingAttemptId: output.pendingAttemptId,
                      requestId: crypto.randomUUID(),
                    });
                    await accept(v, visit);
                    setAttempt(undefined);
                  })
                }
              >
                采用已保存响应
              </Button>
            )}
            <p>采用完整响应不调用模型，不发布Skill；随后仍从原入口继续流程。</p>
            <Button disabled={disabled} onClick={() => setReviewOpen(true)}>
              核对一次新尝试
            </Button>
          </>
        ) : (
          <p>
            {complete
              ? '连续来源与实际收据已核对。请进入模板后续草稿编辑、试聊和本人确认；完整覆盖不代表事实无误或已发布。'
              : '当前草稿与下一位置已保存。继续将使用原任务处理后续片段，须核对原入口整体执行范围。'}
          </p>
        )}
        {!view?.busy && output.phase !== 'attention' && (
          <Button type="primary" disabled={disabled} onClick={() => setReviewOpen(true)}>
            {complete ? '进入后续流程核对' : '核对后继续下一批'}
          </Button>
        )}
        <p>新补充不自动替换此任务或已发布Skill。普通使用通过表单、按钮和内容预览完成。</p>
      </footer>
    </section>
  );
}
