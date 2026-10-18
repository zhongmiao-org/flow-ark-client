import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Collapse, Tag } from 'antd';
import type {
  SkillProposalSnapshot,
  SkillUpdateInfo,
  SkillUpdateReview,
  SkillUpdateApply,
  SkillUpdateApplication,
  SkillUpdateReceipt,
  SkillUpdateState,
} from '../shared/contracts.generated';
import {
  skill_update_info_v1,
  skill_update_review_v1,
  skill_update_receipt_v1,
} from '../shared/node-schema.generated';
import ReadonlyValue from './ReadonlyValue';
const api = (method: string, args: unknown) => window.flowark.request(method, args);
const isInfo = (v: unknown): v is SkillUpdateInfo => !!skill_update_info_v1(v);
const isReview = (v: unknown): v is SkillUpdateReview => !!skill_update_review_v1(v);
const isReceipt = (v: unknown): v is SkillUpdateReceipt => !!skill_update_receipt_v1(v);
const statuses = {
  candidate: '可选择建议',
  conflict: '手工内容冲突',
  'manual-only': '保留手工内容',
  'already-applied': '当前已与建议一致',
};
function StateView({ state }: { state: SkillUpdateState }) {
  if (!state.present) return <p>字段不存在</p>;
  return typeof state.value === 'string' ? (
    <pre tabIndex={0}>{state.value || '空文本'}</pre>
  ) : (
    <>
      <ReadonlyValue value={state.value} />
      <Collapse
        items={[
          {
            key: 'raw',
            label: '高级：完整数据原文',
            children: <pre tabIndex={0}>{JSON.stringify(state.value, null, 2)}</pre>,
          },
        ]}
      />
    </>
  );
}
export default function SkillUpdateReviewPanel({
  snapshot,
  application,
  dirty,
  disabled,
  refresh,
  pendingChange,
}: {
  snapshot: SkillProposalSnapshot;
  application: SkillUpdateApplication | null;
  dirty: boolean;
  disabled: boolean;
  refresh: () => Promise<void>;
  pendingChange: (value: boolean) => void;
}) {
  const [info, setInfo] = useState<SkillUpdateInfo | null>(),
    [review, setReview] = useState<SkillUpdateReview>(),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState<SkillUpdateApply>(),
    [clock, setClock] = useState(Date.now());
  const active = useRef({ id: snapshot.id, revision: snapshot.revision, dirty, disabled });
  active.current = { id: snapshot.id, revision: snapshot.revision, dirty, disabled };
  const generation = useRef(0),
    alive = useRef(true),
    locked = useRef(false),
    pendingRef = useRef<SkillUpdateApply | undefined>(undefined),
    pendingCallback = useRef(pendingChange),
    known = useRef<string | undefined>(undefined);
  pendingCallback.current = pendingChange;
  const keepPending = (value: SkillUpdateApply | undefined) => {
    pendingRef.current = value;
    setPending(value);
    pendingCallback.current(!!value);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const seq = ++generation.current,
      id = snapshot.id,
      revision = snapshot.revision;
    setReview(undefined);
    setSelected([]);
    setInfo(undefined);
    void api('skill.update.info', { proposalId: id, revision })
      .then((value) => {
        if (
          !alive.current ||
          generation.current !== seq ||
          active.current.id !== id ||
          active.current.revision !== revision
        )
          return;
        if (
          value !== null &&
          (!isInfo(value) || value.proposalId !== id || value.revision !== revision)
        )
          throw Error('更新建议身份已变化，请重新读取');
        setInfo(value);
      })
      .catch((e) => {
        if (alive.current && generation.current === seq) setError(e.message ?? '建议元数据未取得');
      });
  }, [snapshot.id, snapshot.revision, dirty]);
  useEffect(() => {
    if (!application) return;
    const request = application.input;
    if (request.proposalId !== snapshot.id) return;
    if (application.status === 'pending' && known.current !== request.requestId)
      keepPending(request);
    else if (pendingRef.current?.requestId === request.requestId) {
      keepPending(undefined);
      known.current = request.requestId;
      setNotice(
        application.status === 'applied'
          ? '已核对原应用回执；这只修改草稿，最终保存仍需本人确认。'
          : '原请求已核对为未提交；请重新核对当前建议。',
      );
    }
  }, [application, snapshot.id]);
  useEffect(() => {
    if (!review) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [review]);
  const load = async () => {
    if (locked.current || pendingRef.current || active.current.dirty || active.current.disabled)
      return;
    const seq = ++generation.current,
      visit = { ...active.current };
    locked.current = true;
    setBusy(true);
    setError('');
    setSelected([]);
    setReview(undefined);
    try {
      const value = await api('skill.update.review', {
        proposalId: visit.id,
        revision: visit.revision,
      });
      if (
        !alive.current ||
        generation.current !== seq ||
        active.current.id !== visit.id ||
        active.current.revision !== visit.revision ||
        active.current.dirty
      )
        return;
      if (!isReview(value) || value.proposalId !== visit.id || value.revision !== visit.revision)
        throw Error('核对内容与当前提案不一致');
      setReview(value);
      setClock(Date.now());
    } catch (e) {
      if (alive.current && active.current.id === visit.id)
        setError(e instanceof Error ? e.message : '建议未读取');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const send = async (input: SkillUpdateApply) => {
    if (locked.current) return;
    const id = snapshot.id;
    locked.current = true;
    setBusy(true);
    setError('');
    keepPending(input);
    try {
      const receipt = (await api('skill.update.apply', input)) as SkillUpdateReceipt;
      if (!alive.current || active.current.id !== id) return;
      if (
        !isReceipt(receipt) ||
        receipt.proposalId !== id ||
        receipt.requestId !== input.requestId ||
        receipt.reviewSha256 !== input.reviewSha256
      )
        throw Error('应用回执身份不一致，请核对原请求');
      known.current = input.requestId;
      keepPending(undefined);
      setReview(undefined);
      setSelected([]);
      setNotice(
        receipt.changed
          ? '选中建议已应用到草稿；请核对、试聊并单独确认保存新版本。'
          : '本次没有改变草稿，不创建新版本。',
      );
      await refresh();
    } catch (e) {
      if (alive.current && active.current.id === id) {
        setError(e instanceof Error ? e.message : '回执尚未取得，原请求保留');
        try {
          await refresh();
        } catch {
          /* Keep exact identity when a status read also fails. */
        }
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (info === null && !pending && !application) return null;
  const expired =
    !!review && (clock < Date.parse(review.createdAt) || clock >= Date.parse(review.expiresAt));
  const unavailable = busy || disabled || dirty || !!pending || expired;
  return (
    <Card
      title="更新建议 · 逐项核对"
      className="skill-update-review"
      aria-label="Skill更新逐项核对"
    >
      <p>原始建议单独保留，未选内容保持；这里不调用模型或发布 Skill。</p>
      {error && <Alert type="error" showIcon title={error} />}
      {notice && <Alert type="info" showIcon title={notice} />}
      {pending && (
        <Alert
          type="warning"
          showIcon
          title="原应用回执待核对"
          description={`原请求及 ${pending.choices.length} 项选择已保留。重开不自动重放，也不更换请求身份。`}
          action={
            <Button disabled={busy} onClick={() => void send(pending)}>
              核对原应用请求
            </Button>
          }
        />
      )}
      {application?.status === 'applied' && application.receipt && (
        <Tag>上次应用已登记 · 修订 {application.receipt.revisionAfter}</Tag>
      )}
      {dirty && <p>先保存当前手工编辑，再核对更新建议；不会丢弃输入。</p>}
      <div className="skill-actions">
        <Button
          disabled={busy || disabled || dirty || !!pending || !info}
          onClick={() => void load()}
        >
          {review ? '重新核对，清除选择' : '查看更新建议'}
        </Button>
      </div>
      {review && (
        <>
          <p>
            原建议基线：{review.base.versionId} · 发布父版本：{review.publishBase.versionId}
          </p>
          {expired && (
            <Alert type="warning" title="本次核对已过期，请重新核对后选择；没有自动应用。" />
          )}
          {!review.fields.some((f) => f.status === 'candidate' || f.status === 'conflict') && (
            <Alert type="info" title="没有需要应用的新建议，当前内容保留。" />
          )}
          {review.fields.map((field) => (
            <section
              key={field.id}
              className="skill-update-field"
              aria-label={
                '核对字段 ' +
                (field.target.area === 'data' ? field.target.path.join(' › ') : field.target.area)
              }
            >
              <h3>
                {field.target.area === 'data'
                  ? field.target.path.map((k) => k || '（空字段名）').join(' › ')
                  : field.target.area === 'title'
                    ? '版本标题'
                    : 'SKILL.md'}{' '}
                <Tag>{statuses[field.status]}</Tag>
              </h3>
              <div className="skill-update-columns">
                {(['baseline', 'current', 'suggested'] as const).map((key, i) => (
                  <section key={key}>
                    <h4>{['原基线', '当前手工内容', '模型建议'][i]}</h4>
                    <StateView state={field[key]} />
                  </section>
                ))}
              </div>
              {['candidate', 'conflict'].includes(field.status) && (
                <div className="skill-actions">
                  <Button
                    disabled={unavailable}
                    aria-pressed={!selected.includes(field.id)}
                    onClick={() => setSelected((s) => s.filter((id) => id !== field.id))}
                  >
                    保留当前内容
                  </Button>
                  <Button
                    disabled={unavailable}
                    type={selected.includes(field.id) ? 'primary' : 'default'}
                    aria-pressed={selected.includes(field.id)}
                    onClick={() =>
                      setSelected((s) => (s.includes(field.id) ? s : [...s, field.id]))
                    }
                  >
                    {field.status === 'conflict' ? '明确替换此项' : '采用此项建议'}
                  </Button>
                </div>
              )}
            </section>
          ))}
          <p>
            已选 {selected.length} 项。文字、数组和类型变化按整项采用；未选内容及额外手工字段保留。
          </p>
          <Button
            type="primary"
            disabled={unavailable || !selected.length}
            onClick={() => {
              if (!review || active.current.dirty || active.current.disabled || pendingRef.current)
                return;
              const choices = review.fields
                .filter((f) => selected.includes(f.id))
                .map((f) => ({ fieldId: f.id, replaceManual: f.status === 'conflict' }));
              void send({
                version: 1,
                proposalId: snapshot.id,
                revision: review.revision,
                reviewId: review.reviewId,
                reviewSha256: review.sha256,
                requestId: crypto.randomUUID(),
                choices,
                reviewed: true,
              });
            }}
          >
            应用选中项到草稿
          </Button>
        </>
      )}
    </Card>
  );
}
