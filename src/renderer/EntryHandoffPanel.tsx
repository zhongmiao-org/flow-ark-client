import TechnicalDetails from './TechnicalDetails';
import { Alert, Button, Card, Checkbox, Input } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { HandoffPreview, HandoffReceipt, HandoffSelection } from '../shared/entry-handoff';
import { mergeHandoff } from '../shared/entry-handoff';
import { handoff_preview_v1, handoff_receipt_v1 } from '../shared/node-schema.generated';
import { runDisplayLabels } from '../shared/run-history';
const api = (method: string, args: unknown): Promise<any> => window.flowark.request(method, args);
const labels = {
  stopping: '正在停止本实例的运行',
  created: '原运行已停止，新入口已创建',
  failed: '停止或启动未确认，请核对原请求',
  interrupted: '上次请求已中断，请核对原运行',
};
/** Human controls only. Source revisions and exact stop scope remain host owned. */
export default function EntryHandoffPanel({
  active,
  open,
  onOpenChange,
  selection,
  entryName,
  instanceName,
  packageVersion,
  configurationRevision,
  disabled,
  onCreated,
  onOpen,
}: {
  active: boolean;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  selection: HandoffSelection;
  entryName: string;
  instanceName: string;
  packageVersion: string;
  configurationRevision: number;
  disabled: boolean;
  onCreated: (receipt: HandoffReceipt) => void;
  onOpen: (receipt: HandoffReceipt) => void;
}) {
  const [preview, setPreview] = useState<HandoffPreview>(),
    [receipt, setReceipt] = useState<HandoffReceipt>(),
    [requestId, setRequestId] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const selectionKey = JSON.stringify(selection),
    current = useRef(selectionKey),
    pending = useRef(false),
    tracked = useRef(''),
    readGeneration = useRef(0);
  current.current = selectionKey;
  const storageKey =
    'entry-handoff:' + selection.source.instanceId + ':' + selection.source.entryId;
  const notice = useRef<HTMLDivElement>(null);
  const accept = (next: unknown) => {
    if (!handoff_receipt_v1(next)) throw Error('入口切换回执无效，请核对原请求');
    const r = next as HandoffReceipt;
    if (
      r.selection.source.instanceId !== selection.source.instanceId ||
      r.selection.source.entryId !== selection.source.entryId
    )
      throw Error('回执不属于本入口');
    setReceipt((v) => mergeHandoff(v, r));
    return r;
  };
  useEffect(() => {
    readGeneration.current++;
    setPreview(undefined);
    setReviewed(false);
  }, [selectionKey]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const original = tracked.current,
      generation = readGeneration.current;
    void api('template.handoff.list', { instanceId: selection.source.instanceId })
      .then((rows: HandoffReceipt[]) => {
        if (!live || tracked.current !== original || generation !== readGeneration.current) return;
        const stored = sessionStorage.getItem(storageKey),
          next =
            rows.find((r) => r.requestId === stored) ||
            rows.find((r) => r.selection.source.entryId === selection.source.entryId);
        if (next) {
          tracked.current = next.requestId;
          setRequestId(next.requestId);
          accept(next);
        } else if (stored) {
          tracked.current = stored;
          setRequestId(stored);
        }
      })
      .catch(() => {
        if (live && generation === readGeneration.current)
          setError('本次请求记录读取失败，请重试；不会自动执行。');
      });
    return () => {
      live = false;
    };
  }, [active, storageKey]);
  useEffect(() => {
    if (open && (error || receipt)) notice.current?.focus();
  }, [open, error, receipt?.revision]);
  const read = async () => {
    if (!tracked.current) return;
    const id = tracked.current;
    try {
      const r = await api('template.handoff.get', { requestId: id });
      if (tracked.current !== id) return;
      if (!r) {
        setError('尚未找到该请求回执。保留请求编号并核对运行；不会再次提交。');
        return;
      }
      accept(r);
      setError('');
    } catch {
      setError('读取原请求失败，请保留请求编号后重试读取。');
    }
  };
  const inspect = async () => {
    if (disabled || pending.current) return;
    readGeneration.current++;
    pending.current = true;
    setLoading(true);
    setError('');
    setReviewed(false);
    const selected = current.current;
    try {
      const p = await api('template.handoff.preview', selection);
      if (selected !== current.current) throw Error('入口配置已变化，请重新核对');
      if (!handoff_preview_v1(p)) throw Error('入口停止范围预览无效');
      const value = p as HandoffPreview;
      if (JSON.stringify(value.selection) !== selected) throw Error('入口停止范围来源不一致');
      setPreview(value);
      setReceipt(undefined);
      tracked.current = '';
      setRequestId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '停止范围读取失败');
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };
  const confirm = async () => {
    if (!preview || !reviewed || disabled || pending.current) return;
    if (Date.parse(preview.expiresAt) < Date.now()) {
      setPreview(undefined);
      setReviewed(false);
      setError('核对已过期，请重新读取停止范围。');
      return;
    }
    readGeneration.current++;
    pending.current = true;
    setLoading(true);
    setError('');
    const id = crypto.randomUUID(),
      p = preview;
    tracked.current = id;
    setRequestId(id);
    sessionStorage.setItem(storageKey, id);
    setPreview(undefined);
    try {
      const r = await api('template.handoff.confirm', {
        version: 1,
        selection: p.selection,
        token: p.token,
        requestId: id,
        reviewed: true,
      });
      if (tracked.current === id) {
        const saved = accept(r);
        if (saved.status === 'created') onCreated(saved);
      }
    } catch {
      setError('请求响应未确认，请读取本次请求。不会自动重新提交或新建运行。');
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };
  const stopping = (loading && !preview && !!requestId) || receipt?.status === 'stopping';
  if (!open) return <Button onClick={() => onOpenChange(true)}>停止本实例后执行</Button>;
  return (
    <section className="entry-handoff entry-handoff-open" aria-label="停止本实例后执行入口">
      <h1>
        {stopping
          ? labels.stopping
          : receipt
            ? labels[receipt.status]
            : '先停止本实例，再执行所选入口'}
      </h1>
      <p>
        核对本实例当前和排队运行。确认停止并回收后，执行当前已保存的入口；不回滚已提交的外部操作。
      </p>
      <div className="entry-handoff-columns">
        <Card>
          <h2>本次选定入口</h2>
          <dl>
            <dt>模板实例</dt>
            <dd>
              <Input readOnly aria-label="模板实例" value={instanceName} />
            </dd>
            <dt>操作入口</dt>
            <dd>
              <Input readOnly aria-label="选定操作入口" value={entryName} />
            </dd>
            <dt>固定包版本</dt>
            <dd>
              <Input readOnly aria-label="固定包版本" value={packageVersion} />
            </dd>
            <dt>配置修订</dt>
            <dd>
              <Input
                readOnly
                aria-label="配置修订"
                value={`${configurationRevision} · 启动前再次核对`}
              />
            </dd>
          </dl>
          <div className="ai-task-actions">
            <Button disabled={disabled || loading || stopping} onClick={() => void inspect()}>
              {preview ? '重新读取停止范围' : '核对停止范围'}
            </Button>
            {preview && (
              <Button
                type="primary"
                disabled={!reviewed || disabled || loading}
                onClick={() => void confirm()}
              >
                确认停止并执行
              </Button>
            )}
            {receipt?.status === 'created' && (
              <Button type="primary" onClick={() => onOpen(receipt)}>
                查看已创建运行
              </Button>
            )}
          </div>
        </Card>
        <Card>
          <h2>{preview ? '将停止的运行' : '本次请求与回执'}</h2>
          {preview && (
            <>
              <ul>
                {preview.runs.map((r) => (
                  <li key={r.id}>
                    {r.name} ·{' '}
                    {runDisplayLabels[r.state as keyof typeof runDisplayLabels] ?? r.state}
                  </li>
                ))}
              </ul>
              <p>
                核对有效至 {new Date(preview.expiresAt).toLocaleTimeString()}
                ；范围变化后需要重新核对。
              </p>
              <Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)}>
                已核对本实例的停止范围及选定入口
              </Checkbox>
            </>
          )}
          <div ref={notice} tabIndex={-1} role="status">
            {stopping && (
              <Alert
                showIcon
                type="info"
                title="正在停止与回收；尚不表示新入口或业务控制状态已生效。"
              />
            )}
            {receipt && (
              <>
                <p>
                  {labels[receipt.status]} · 修订 {receipt.revision}
                </p>
                {receipt.error && <Alert showIcon type="warning" title={receipt.error} />}
                <p>停止范围：本次已核对的 {receipt.stoppedRunIds.length} 次运行</p>
                {receipt.runId && <p>新入口运行已创建 · 结果仍须独立核对</p>}
              </>
            )}
            {error && <Alert type="warning" showIcon title={error} />}
          </div>
          {requestId && (
            <>
              <TechnicalDetails
                items={[
                  { label: '请求 ID', value: requestId },
                  { label: '新运行 ID', value: receipt?.runId },
                  { label: '停止运行 ID', value: receipt?.stoppedRunIds.join('、') },
                ]}
              />
              <Button onClick={() => void read()}>读取本次请求</Button>
            </>
          )}
          {!preview && !requestId && !error && (
            <p>只读取停止范围不会取消或执行任务；其他实例不在停止范围内。</p>
          )}
        </Card>
      </div>
      <p>中断、响应缺失或重开后先核对原请求，不自动重放。新入口创建不等于执行成功或状态已提交。</p>
      <footer className="entry-handoff-footer">
        <Button onClick={() => onOpenChange(false)}>返回模板入口</Button>
        <span>停止不回滚已发生的外部操作；新入口结果仍须独立核对。</span>
      </footer>
    </section>
  );
}
