import TechnicalDetails from './TechnicalDetails';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Collapse, Descriptions, Tag } from 'antd';
import {
  verifyReductionRunReview,
  verifyReductionOutput,
  type SourceReductionRunPlan,
  type SourceReductionRunConfirmation,
  type SourceReductionConfirmationOutcome,
} from '../shared/source-reduction';
import type { ReductionSelection } from '../host/source-reduction-reviews';
import type { ConversationArchiveRecord } from '../shared/conversation-archive';
import { verifyArchiveRecord } from '../shared/conversation-archive';
import type { Run } from '../shared/types';
import { RecordView } from './ConversationArchivePanel';
import { activateCollapseWithSpace } from './collapseKeyboard';

const errorText = (e: unknown) => (e instanceof Error ? e.message : '核对暂时不可用');
export default function SourceReductionRunReview({
  selection,
  back,
  openRun,
}: {
  selection: ReductionSelection;
  back: () => void;
  openRun?: (detail: any) => void;
}) {
  const [plan, setPlan] = useState<SourceReductionRunPlan>();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Run>();
  const [record, setRecord] = useState<ConversationArchiveRecord>();
  const [clock, setClock] = useState(Date.now());
  const live = useRef(false),
    serial = useRef(0),
    sending = useRef(false);
  const attempt = useRef<SourceReductionRunConfirmation | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const key = JSON.stringify(selection);
  async function readPlan() {
    if (sending.current || attempt.current) return;
    const visit = ++serial.current;
    setBusy(true);
    setChecked(false);
    setStale(false);
    setError('');
    setPlan(undefined);
    setRecord(undefined);
    try {
      const result: SourceReductionRunPlan = await window.flowark.request(
        'reduction.runPlan',
        selection,
      );
      const source = await verifyReductionRunReview(result.source);
      if (
        source.target.runId !== selection.runId ||
        source.target.nodeId !== selection.nodeId ||
        source.target.nodeInstance !== selection.nodeInstance ||
        source.job.jobId !== selection.jobId ||
        result.run.mode !== 'snapshot' ||
        result.run.source.id !== selection.runId ||
        !Array.isArray(result.run.warnings) ||
        result.run.warnings.some((w) => typeof w !== 'string') ||
        !Array.isArray(result.run.flow?.scriptBundles) ||
        typeof result.run.flow?.name !== 'string' ||
        !Number.isSafeInteger(result.run.flow?.stepCount)
      )
        throw Error('核对返回的来源与所选运行不一致');
      if (live.current && visit === serial.current) {
        setPlan(result);
        setClock(Date.now());
      }
    } catch (e) {
      if (live.current && visit === serial.current) setError(errorText(e));
    } finally {
      if (live.current && visit === serial.current) setBusy(false);
    }
  }
  useEffect(() => {
    live.current = true;
    sending.current = false;
    attempt.current = undefined;
    setCreated(undefined);
    setPending(false);
    void readPlan();
    heading.current?.focus();
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      live.current = false;
      serial.current++;
      clearInterval(timer);
    };
  }, [key]);
  useEffect(() => {
    if (!plan) return;
    const reviewId = plan.source.reviewId;
    const visit = serial.current;
    return window.flowark.onmessage((event) => {
      if (
        !event ||
        typeof event !== 'object' ||
        !('job' in event) ||
        event.job?.jobId !== plan.source.job.jobId ||
        attempt.current
      )
        return;
      void verifyReductionOutput(event)
        .then(() => {
          if (
            live.current &&
            serial.current === visit &&
            !attempt.current &&
            plan.source.reviewId === reviewId &&
            event.revision > plan.source.jobRevision
          ) {
            setChecked(false);
            setStale(true);
            setError('整理任务已变化，请重新核对当前范围。');
          }
        })
        .catch(() => {});
    });
  }, [plan?.source.reviewId]);
  const expired = !!plan && clock >= Date.parse(plan.source.expiresAt);
  useEffect(() => {
    if (expired) setChecked(false);
  }, [expired]);
  async function inspect(run: Run) {
    if (!openRun) return;
    const visit = serial.current;
    try {
      const detail = await window.flowark.request('run.detail', { id: run.id });
      if (detail?.run?.id !== run.id) throw Error('新运行详情不匹配');
      if (live.current && serial.current === visit) openRun(detail);
    } catch (e) {
      if (live.current) setError('运行已创建，详情暂时无法打开：' + errorText(e));
    }
  }
  async function confirm() {
    if (sending.current || !plan || (!attempt.current && (!checked || stale || expired))) return;
    const input =
      attempt.current ??
      (attempt.current = {
        version: 1,
        reviewId: plan.source.reviewId,
        reviewSha256: plan.source.sha256,
        requestId: crypto.randomUUID(),
        reviewed: true,
      });
    sending.current = true;
    const visit = serial.current;
    setBusy(true);
    setPending(true);
    setError('');
    try {
      const result: SourceReductionConfirmationOutcome = await window.flowark.request(
        'reduction.runConfirm',
        input,
      );
      if (!live.current || serial.current !== visit) return;
      if (result.status === 'created') {
        attempt.current = undefined;
        setPending(false);
        setChecked(false);
        setCreated(result.run);
        await inspect(result.run);
      } else if (result.status === 'blocked') {
        attempt.current = undefined;
        setPending(false);
        setChecked(false);
        setStale(true);
        setError(result.error);
      } else if (result.status === 'unknown') setError(result.error);
      else throw Error('确认结果格式无效，请用同一次确认核对结果');
    } catch (e) {
      if (live.current && serial.current === visit)
        setError('确认结果未收到，请重试此次确认：' + errorText(e));
    } finally {
      if (live.current && serial.current === visit) {
        sending.current = false;
        setBusy(false);
      }
    }
  }
  async function readSource() {
    if (!plan || sending.current) return;
    const visit = serial.current;
    setBusy(true);
    setError('');
    try {
      const ordinal =
        plan.source.fragment?.recordOrdinal ?? Math.max(1, plan.source.checkpoint.records);
      const row = await verifyArchiveRecord(
        await window.flowark.request('source.runRecord', {
          runId: selection.runId,
          nodeId: selection.nodeId,
          ordinal,
        }),
        plan.source.job.source.archiveId,
        ordinal,
      );
      if (live.current && serial.current === visit) setRecord(row);
    } catch (e) {
      if (live.current && serial.current === visit) setError(errorText(e));
    } finally {
      if (live.current && serial.current === visit) setBusy(false);
    }
  }
  const r = plan?.source;
  return (
    <section className="reduction-panel source-run-review" aria-label="来源整理执行范围核对">
      <header>
        <h3 ref={heading} tabIndex={-1}>
          {created
            ? '本次运行已创建'
            : pending
              ? '确认状态需要核对'
              : stale || expired
                ? '本次范围需要重新核对'
                : r?.phase === 'attention'
                  ? '重试前核对来源整理范围'
                  : r?.phase === 'complete'
                    ? '核对已完成来源及后续流程'
                    : '继续前核对来源整理范围'}
        </h3>
        <p>核对原任务、准确片段和调用上限；阅读不会调用模型。</p>
      </header>
      {error && <Alert type="warning" title={error} />}
      {created && (
        <>
          <p>已创建关联运行。相同确认不再创建第二个运行。</p>
          {openRun ? (
            <Button disabled={busy} onClick={() => void inspect(created)}>
              查看新运行
            </Button>
          ) : (
            <p>可在运行记录中查看这条关联运行。</p>
          )}
        </>
      )}
      {r && (
        <>
          <Tag>
            {r.phase === 'complete'
              ? '本来源节点模型调用为0'
              : `本来源节点最多${r.requestLimit}次请求`}
          </Tag>
          <Button disabled={busy} onClick={() => void readSource()}>
            查看固定来源
          </Button>
          <div className="source-run-review-scroll">
            <div className="reduction-value">
              <p>
                原执行快照 · {r.provider} / {r.model}
              </p>
              <p>
                任务修订{r.jobRevision} · 草稿修订{r.checkpoint.revision} · 已采用
                {r.checkpoint.chunks}片段 / 完整{r.checkpoint.records}原记录
              </p>
              <p>
                {r.fragment
                  ? `下一片段：原记录${r.fragment.recordOrdinal}，第${r.fragment.byteOffset + 1}–${r.fragment.byteEnd}字节`
                  : '没有下一片段；读取已完整登记的结果，不再请求模型。'}
              </p>
              <p>
                已报告 Token {r.reportedTotalTokens.toLocaleString()} · {r.unknownUsageRequests}
                次用量未知（不补零）
              </p>
              <p>本次仅限这个来源节点实例；整个入口仍从第一步执行，其他节点单独核对。</p>
              <TechnicalDetails
                items={[
                  { label: '来源运行 ID', value: r.target.runId },
                  { label: '步骤实例路径', value: r.target.nodeInstance },
                  { label: '整理任务 ID', value: r.job.jobId },
                  { label: '来源记录 ID', value: r.job.source.archiveId },
                ]}
              />
              {r.pending?.hasSavedResponse && (
                <p>已保存完整响应。可以返回请求记录先零调用采用；确认另发请求仍可能再次计费。</p>
              )}
              {plan.run.warnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
              <p>
                整体流程：{plan.run.flow.name} · {plan.run.flow.stepCount}个步骤 · 固定脚本包
                {plan.run.flow.scriptBundles.length}项
              </p>
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: 'source', label: '固定范围', children: '本次选定的来源与整理步骤' },
                  {
                    key: 'config',
                    label: 'Key配置修订',
                    children: r.configurationRevision ?? '本来源节点无需Key',
                  },
                  {
                    key: 'expiry',
                    label: '核对有效至',
                    children: new Date(r.expiresAt).toLocaleString('zh-CN'),
                  },
                ]}
              />
              <Collapse
                items={[
                  {
                    key: 'identity',
                    label: '来源、规则与快照摘要（高级，可选）',
                    onKeyDown: activateCollapseWithSpace,
                    children: (
                      <Descriptions
                        column={1}
                        size="small"
                        items={[
                          { key: 'source', label: '来源摘要', children: r.job.source.sha256 },
                          { key: 'recipe', label: '规则摘要', children: r.job.recipeHash },
                          { key: 'snapshot', label: '快照摘要', children: r.snapshotSha256 },
                          { key: 'review', label: '范围摘要', children: r.sha256 },
                        ]}
                      />
                    ),
                  },
                ]}
              />
              <Checkbox
                checked={checked}
                disabled={busy || pending || stale || expired || !!created}
                onChange={(e) => setChecked(e.target.checked)}
              >
                {r.phase === 'complete'
                  ? '我已核对已完成来源及后续整体执行范围'
                  : '我已核对本次调用上限、可能产生的费用及原入口整体执行范围'}
              </Checkbox>
            </div>
            {record && <RecordView row={record} />}
          </div>
        </>
      )}
      <footer>
        <p>
          {pending
            ? '确认内容和请求身份已固定；重试此次确认只核对原结果，不另建第二个运行。'
            : expired || stale
              ? '原范围不可继续使用。重新核对后默认未勾选，不自动启动。'
              : '来源、动态输入、配置、任务变化或期限经过时阻止执行；完整覆盖不代表Skill已确认。'}
        </p>
        <div className="reduction-actions">
          <Button disabled={busy || pending} onClick={back}>
            返回请求记录
          </Button>
          {!created && (
            <Button disabled={busy || pending} onClick={() => void readPlan()}>
              重新核对当前范围
            </Button>
          )}
          {!created && (
            <Button
              type="primary"
              loading={busy && pending}
              disabled={busy || (!pending && (!r || !checked || stale || expired))}
              onClick={() => void confirm()}
            >
              {pending ? '重试此次确认' : '确认本次执行'}
            </Button>
          )}
        </div>
      </footer>
    </section>
  );
}
