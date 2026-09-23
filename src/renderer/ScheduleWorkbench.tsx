import { usePageBack } from './use-page-back';
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Bootstrap, FlowRecord, Schedule } from '../shared/types';
import {
  scheduleCreateSchema,
  scheduleUpdateSchema,
  type ScheduleCursor,
  type ScheduleInspection,
} from '../shared/schedules';
import { runDisplayLabels } from '../shared/run-history';
import { Timing, inZone } from './schedule-fields';
import type { TemplateNavigation } from './TemplateInstancePage';
import './template-schedule.css';
import './schedule-workbench.css';

const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
type Draft = {
  mode: 'create' | 'edit';
  plan?: Schedule;
  flow?: FlowRecord;
  version?: ScheduleInspection['version'];
  minutes: string;
  timezone: string;
  adopt: boolean;
};
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const blank = (): Draft => ({ mode: 'create', minutes: '60', timezone: timezone(), adopt: false });
export default function ScheduleWorkbench({
  data,
  action,
  active,
  navigation,
  showRun,
}: {
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  active: boolean;
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  showRun: (detail: any, back: () => void) => void;
}) {
  const [draft, setDraft] = useState<Draft>();
  const [initial, setInitial] = useState<Draft>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<{ next: () => void }>();
  const [history, setHistory] = useState<{
    id: string;
    result?: ScheduleInspection;
    error?: string;
  }>();
  const [reading, setReading] = useState(false);
  const historyRef = useRef<HTMLDialogElement>(null),
    leaveRef = useRef<HTMLDialogElement>(null);
  const fields = useRef<HTMLFieldSetElement>(null),
    draftFocus = useRef<HTMLElement | null>(null);
  const historyFocus = useRef<HTMLElement | null>(null),
    focusAfter = useRef<HTMLElement | null>(null);
  const lock = useRef(false),
    destination = useRef(false),
    initialized = useRef(false),
    readToken = useRef(0);
  const scroll = useRef(0);
  const listFocus = useRef<HTMLElement | null>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const dirty = !!draft && !!initial && JSON.stringify(draft) !== JSON.stringify(initial);
  const currentPlan = draft?.plan && data.schedules.find((plan) => plan.id === draft.plan!.id);
  const currentFlow = draft?.flow && data.flows.find((flow) => flow.id === draft.flow!.id);
  const changed =
    !!draft &&
    (conflict ||
      (draft.mode === 'edit' &&
        (!currentPlan || (currentPlan.revision ?? null) !== (draft.plan?.revision ?? null))) ||
      ((draft.mode === 'create' || draft.adopt) &&
        !!draft.flow &&
        (!currentFlow || currentFlow.updatedAt !== draft.flow.updatedAt)));
  const assign = (value?: Draft) => {
    setDraft(value);
    setInitial(value);
    setError('');
    setConflict(false);
    setNotice('');
  };
  async function perform(fn: () => Promise<any>, message?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      return await action(async () => {
        try {
          return await fn();
        } catch (e) {
          const text = (e instanceof Error ? e.message : '操作未完成，请重试').replace(
            /^Error invoking remote method 'flowark:request': (?:Error: )?/,
            '',
          );
          setError(text);
          if (/计划已改变|流程已改变|实例已变化|计划不存在|流程不存在/.test(text))
            setConflict(true);
          throw e;
        }
      }, message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function open(plan: Schedule) {
    listFocus.current = document.activeElement as HTMLElement;
    const result: ScheduleInspection | undefined = await perform(() =>
      api('schedule.inspect', { id: plan.id }),
    );
    if (!result) return;
    const next: Draft = {
      mode: 'edit',
      plan: result.plan,
      version: result.version,
      flow: structuredClone(data.flows.find((flow) => flow.id === result.plan.flowId)),
      minutes: String(result.plan.intervalMinutes),
      timezone: result.plan.timezone,
      adopt: false,
    };
    assign(next);
  }
  useEffect(() => {
    if (!active || initialized.current) return;
    initialized.current = true;
    if (!data.schedules.length) assign(blank());
  }, [active]);
  useLayoutEffect(() => {
    if (!active) return;
    if (draft) {
      fields.current
        ?.querySelector<HTMLElement>(
          draft.mode === 'create' ? 'select' : 'input[aria-label="计划间隔分钟"]',
        )
        ?.focus();
    } else {
      const target = listFocus.current?.isConnected ? listFocus.current : pageHeading.current;
      target?.focus({ preventScroll: true });
    }
  }, [active, draft?.mode, draft?.plan?.id]);
  useLayoutEffect(() => {
    if (!active) {
      historyRef.current?.close();
      return;
    }
    if (history) historyRef.current?.showModal();
    if (focusAfter.current) {
      document.querySelector('main')?.scrollTo({ top: scroll.current });
      focusAfter.current.focus({ preventScroll: true });
      focusAfter.current = null;
    }
  }, [active, history]);
  const go: TemplateNavigation = (next) => {
    if (lock.current || destination.current) return;
    if (!dirty) {
      next();
      return;
    }
    destination.current = true;
    setError('');
    setLeaving({ next });
  };
  navigation.current = (next) => {
    if (lock.current || destination.current) return;
    historyRef.current?.close();
    setHistory(undefined);
    go(() => {
      assign();
      setHistory(undefined);
      next();
    });
  };
  const stay = () => {
    if (lock.current) return;
    leaveRef.current?.close();
    setLeaving(undefined);
    destination.current = false;
    requestAnimationFrame(() => draftFocus.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    if (leaving) leaveRef.current?.showModal();
  }, [leaving]);
  usePageBack(() => go(() => assign()), active && !!draft);
  async function save() {
    if (!draft || lock.current || changed) return false;
    if (draft.mode === 'create' && (!draft.flow || !draft.adopt)) {
      setError('请选择已保存的流程并确认固定当前已保存版本与入口。');
      return false;
    }
    const timing = { intervalMinutes: Number(draft.minutes), timezone: draft.timezone };
    const parsed =
      draft.mode === 'edit'
        ? scheduleUpdateSchema.safeParse({
            ...timing,
            id: draft.plan!.id,
            revision: draft.plan!.revision ?? null,
            adoptLatest: draft.adopt,
            ...(draft.adopt ? { flowUpdatedAt: draft.flow?.updatedAt } : {}),
          })
        : scheduleCreateSchema.safeParse({
            ...timing,
            flowId: draft.flow!.id,
            flowUpdatedAt: draft.flow!.updatedAt,
          });
    if (!parsed.success) {
      setError('请填写 1–525600 的整数分钟数和有效时区。');
      return false;
    }
    const result = await perform(() =>
      api(draft.mode === 'edit' ? 'schedule.update' : 'schedule.save', parsed.data),
    );
    if (!result) return false;
    assign();
    setNotice(
      draft.mode === 'edit'
        ? '计划已保存，保留原启停状态，仅影响未来触发。'
        : '计划已创建并启用，首次执行在所选间隔之后。',
    );
    return true;
  }
  async function readHistory(id: string, cursor?: ScheduleCursor) {
    const token = ++readToken.current;
    setReading(true);
    setHistory((old) => ({ id, ...(old?.id === id ? { result: old.result } : {}) }));
    try {
      const result: ScheduleInspection = await api('schedule.inspect', {
        id,
        ...(cursor ? { cursor } : {}),
      });
      if (readToken.current === token)
        setHistory((old) => ({
          id,
          result: {
            ...result,
            records: cursor ? [...(old?.result?.records ?? []), ...result.records] : result.records,
          },
        }));
    } catch (e) {
      if (readToken.current === token)
        setHistory((old) => ({
          ...old,
          id,
          error: e instanceof Error ? e.message : '计划记录读取失败',
        }));
    } finally {
      if (readToken.current === token) setReading(false);
    }
  }
  const closeHistory = () => {
    readToken.current++;
    setReading(false);
    historyRef.current?.close();
    setHistory(undefined);
    requestAnimationFrame(() => historyFocus.current?.focus({ preventScroll: true }));
  };
  async function inspectActive() {
    if (!history?.result?.activeRun) return;
    const from = history.id,
      id = history.result.activeRun.id;
    const focused = document.activeElement as HTMLElement;
    const result = await perform(async () => {
      const next = await api('run.detail', { id });
      if (next?.run?.scheduleId !== from) throw new Error('此计划运行已不存在，请刷新计划记录');
      return next;
    });
    if (!result) return;
    scroll.current = document.querySelector('main')?.scrollTop ?? 0;
    historyRef.current?.close();
    showRun(result, () => {
      focusAfter.current = focused;
    });
  }
  const historyTitle =
    history?.result?.version?.name ??
    data.flows.find((flow) => flow.id === history?.result?.plan.flowId)?.flow.name ??
    '本机计划';
  const endEditing = () => go(() => assign());
  const viewTitle = draft ? (draft.mode === 'edit' ? '编辑计划' : '创建计划') : '本机计划';
  return (
    <>
      <header className="topbar">
        {draft && (
          <button className="context-back" disabled={busy} onClick={endEditing}>
            ← 返回本机计划
          </button>
        )}
        <nav className="breadcrumbs" aria-label="当前位置">
          {draft && (
            <>
              <a
                href="#schedules"
                onClick={(event) => {
                  event.preventDefault();
                  endEditing();
                }}
              >
                本机计划
              </a>
              <span aria-hidden="true">/</span>
            </>
          )}
          <span aria-current="page">{viewTitle}</span>
        </nav>
      </header>
      <div
        className="page ai-task-page schedules-page"
        onFocusCapture={(event) => {
          const target = event.target as HTMLElement;
          if (target.matches('input,select') && !target.closest('dialog'))
            draftFocus.current = target;
        }}
      >
        <div className="page-heading ai-task-heading">
          <div>
            <h1 ref={pageHeading} tabIndex={-1}>
              本机计划
            </h1>
            <p>按分钟间隔执行固定内容，休眠或退出期间不补跑。</p>
          </div>
          <button
            className="primary"
            aria-label="新建本机计划"
            disabled={busy}
            onClick={(event) => {
              const trigger = event.currentTarget;
              go(() => {
                listFocus.current = trigger;
                assign(blank());
              });
            }}
          >
            创建计划
          </button>
        </div>
        {notice && (
          <div className="schedule-feedback" role="status">
            {notice}
          </div>
        )}
        <datalist id="schedule-timezones">
          {['Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/London'].map(
            (zone) => (
              <option key={zone} value={zone} />
            ),
          )}
        </datalist>
        <div className="template-schedule-columns schedule-workbench">
          <section className="ai-task-card schedule-plan-list" aria-label="本机计划列表">
            {!data.schedules.length && (
              <>
                <h2>还没有本机计划</h2>
                <p>选择一个已保存的流程或模板入口，再确认执行间隔。</p>
              </>
            )}
            {data.schedules.map((plan) => (
              <article
                key={plan.id}
                className={
                  'template-schedule-item' + (draft?.plan?.id === plan.id ? ' selected' : '')
                }
                aria-current={draft?.plan?.id === plan.id ? 'true' : undefined}
                data-schedule-id={plan.id}
                aria-label={
                  '计划 ' +
                  (data.flows.find((flow) => flow.id === plan.flowId)?.flow.name ?? '来源不可用')
                }
              >
                <h3>
                  {data.flows.find((flow) => flow.id === plan.flowId)?.flow.name ??
                    '来源流程不可用'}
                </h3>
                <span className={'ai-config-status ' + (plan.enabled ? 'success' : 'neutral')}>
                  {plan.enabled ? '已启用' : '已暂停'}
                </span>
                <p>
                  每 {plan.intervalMinutes} 分钟 · {plan.timezone}
                </p>
                <small>
                  {plan.enabled
                    ? '下次：' + inZone(plan.nextAt, plan.timezone)
                    : '已暂停 · 启用后重新计算下次时间'}
                </small>
                <div className="ai-task-actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      const toggle = () => {
                        void perform(async () => {
                          const result = await api('schedule.toggle', {
                            id: plan.id,
                            enabled: !plan.enabled,
                          });
                          if (draft?.plan?.id === plan.id) assign();
                          const name =
                            data.flows.find((flow) => flow.id === plan.flowId)?.flow.name ??
                            '此计划';
                          setNotice(
                            plan.enabled
                              ? `${name}已暂停，固定版本保持不变；已有运行不受影响。`
                              : `${name}已启用，下次执行按当前间隔重新计算；不会补跑错过的计划。`,
                          );
                          return result;
                        });
                      };
                      if (draft?.plan?.id === plan.id) go(toggle);
                      else toggle();
                    }}
                  >
                    {plan.enabled ? '暂停计划' : '启用计划'}
                  </button>
                  <button
                    aria-label="编辑计划"
                    disabled={busy}
                    onClick={() =>
                      go(() => {
                        void open(plan);
                      })
                    }
                  >
                    编辑
                  </button>
                  <button
                    disabled={busy}
                    onClick={(event) => {
                      historyFocus.current = event.currentTarget;
                      void readHistory(plan.id);
                    }}
                  >
                    计划记录
                  </button>
                </div>
              </article>
            ))}
          </section>
          {draft ? (
            <form
              key={draft.mode + (draft.plan?.id ?? '')}
              className={
                'ai-task-card template-schedule-form schedule-workbench-form ' +
                (draft.mode === 'edit' ? 'schedule-edit' : 'schedule-form')
              }
              aria-label={draft.mode === 'edit' ? '编辑本机计划' : '创建本机计划'}
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <h2>{draft.mode === 'edit' ? '编辑计划' : '创建计划'}</h2>
              <fieldset ref={fields} disabled={busy}>
                <label>
                  <span>绑定入口</span>
                  {draft.mode === 'edit' ? (
                    <input
                      aria-label="绑定入口"
                      readOnly
                      value={draft.flow?.flow.name ?? draft.version?.name ?? '来源流程不可用'}
                    />
                  ) : (
                    <select
                      required
                      aria-label="计划流程"
                      value={draft.flow?.id ?? ''}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          flow: structuredClone(
                            data.flows.find((flow) => flow.id === event.target.value),
                          ),
                          adopt: false,
                        })
                      }
                    >
                      <option value="">选择已保存的流程或入口</option>
                      {data.flows.map((flow) => (
                        <option key={flow.id} value={flow.id}>
                          {flow.flow.name} · {flow.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <Timing
                  minutes={draft.minutes}
                  timezone={draft.timezone}
                  editing={draft.mode === 'edit'}
                  onChange={(change) => setDraft({ ...draft, ...change })}
                />
                <div className="schedule-fixed-version">
                  <span>固定版本</span>
                  <p>
                    {draft.mode === 'edit'
                      ? draft.version
                        ? `${inZone(Date.parse(draft.version.savedAt), draft.timezone)} 保存的版本`
                        : '原固定版本不可用，请核对后处理'
                      : draft.flow
                        ? `${inZone(Date.parse(draft.flow.updatedAt), draft.timezone)} 保存的版本`
                        : '先选择已保存的流程或入口'}
                  </p>
                  {draft.plan && (
                    <small className="schedule-version-id">版本标识：{draft.plan.versionId}</small>
                  )}
                </div>
                <label className="schedule-adoption">
                  <input
                    type="checkbox"
                    checked={draft.adopt}
                    disabled={!draft.flow}
                    onChange={(event) => setDraft({ ...draft, adopt: event.target.checked })}
                  />
                  <span>
                    {draft.mode === 'edit'
                      ? '采用当前已保存的流程版本'
                      : '固定当前已保存版本与入口'}
                  </span>
                </label>
                {draft.mode === 'edit' && draft.adopt && draft.flow && (
                  <p>
                    将采用 {draft.flow.flow.name} · 保存于{' '}
                    {inZone(Date.parse(draft.flow.updatedAt), draft.timezone)}
                    。未保存的编辑不在其中。
                  </p>
                )}
                <p>
                  {draft.mode === 'edit'
                    ? '默认保留原快照；不采用未保存草稿。更新不改变已排队或活动运行。'
                    : '创建后启用，首次执行在所选间隔之后。不采用未保存草稿。'}
                </p>
                {changed && (
                  <div role="alert" className="ai-task-error">
                    计划或已保存流程已改变，输入已保留，请重新核对。
                    <button
                      type="button"
                      onClick={() =>
                        go(() => (draft.plan ? void open(draft.plan) : assign(blank())))
                      }
                    >
                      放弃更改并重新核对
                    </button>
                  </div>
                )}
                {error && !leaving && (
                  <p role="alert" className="ai-task-error">
                    {error}
                  </p>
                )}
                <div className="ai-task-actions">
                  <button className="primary" disabled={changed}>
                    {busy ? '正在保存…' : draft.mode === 'edit' ? '保存计划' : '创建计划'}
                  </button>
                  <button
                    type="button"
                    aria-label={draft.mode === 'edit' ? '取消编辑' : '取消创建'}
                    onClick={() => go(() => assign())}
                  >
                    取消
                  </button>
                </div>
                {draft.plan && (
                  <button
                    type="button"
                    className="schedule-history-trigger"
                    onClick={(event) => {
                      historyFocus.current = event.currentTarget;
                      void readHistory(draft.plan!.id);
                    }}
                  >
                    查看错过 / 占用跳过
                  </button>
                )}
              </fieldset>
            </form>
          ) : (
            <section className="ai-task-card schedule-idle">
              <h2>选择一个计划</h2>
              <p>选择左侧计划进行编辑，或创建一个新的本机计划。</p>
              {error && (
                <p role="alert" className="ai-task-error">
                  {error}
                </p>
              )}
            </section>
          )}
        </div>
        {leaving && (
          <dialog
            ref={leaveRef}
            className="script-leave-dialog ai-settings-dialog"
            aria-labelledby="plan-leave-title"
            onCancel={(event) => {
              event.preventDefault();
              stay();
            }}
          >
            <h2 id="plan-leave-title">保存计划更改再离开？</h2>
            <p>成功保存后前往刚才选择的位置；新计划会创建并启用。</p>
            <div className="ai-task-actions">
              <button autoFocus disabled={busy} onClick={stay}>
                继续编辑
              </button>
              <button
                className="primary"
                disabled={busy || changed}
                onClick={() => {
                  const next = leaving.next;
                  void save().then((ok) => {
                    if (ok) {
                      leaveRef.current?.close();
                      setLeaving(undefined);
                      destination.current = false;
                      next();
                    }
                  });
                }}
              >
                保存并离开
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  const next = leaving.next;
                  leaveRef.current?.close();
                  setLeaving(undefined);
                  destination.current = false;
                  assign();
                  next();
                }}
              >
                不保存离开
              </button>
            </div>
            {(error || changed) && (
              <p role="alert" className="ai-task-error">
                {error || '计划或来源已改变，请继续编辑后重新核对。'}
              </p>
            )}
          </dialog>
        )}
        {history && (
          <dialog
            ref={historyRef}
            className="script-leave-dialog schedule-history-dialog"
            aria-labelledby="plan-history-title"
            onCancel={(event) => {
              event.preventDefault();
              if (!busy) closeHistory();
            }}
          >
            <h2 id="plan-history-title">计划记录 · {historyTitle}</h2>
            {history.result && (
              <div className="schedule-history-summary">
                <span
                  className={
                    'ai-config-status ' + (history.result.plan.enabled ? 'success' : 'neutral')
                  }
                >
                  {history.result.plan.enabled ? '已启用' : '已暂停'}
                </span>
                <p>
                  每 {history.result.plan.intervalMinutes} 分钟 · {history.result.plan.timezone}
                </p>
                <p>
                  {history.result.plan.enabled
                    ? '下次：' + inZone(history.result.plan.nextAt, history.result.plan.timezone)
                    : '暂停期间不触发；已有运行不受影响。'}
                </p>
                <small>固定版本：{history.result.plan.versionId}</small>
              </div>
            )}
            <p>错过不补跑，占用时不重复创建运行。这里只显示已报告的记录。</p>
            <div className="ai-task-actions">
              <button disabled={busy} onClick={closeHistory}>
                返回计划
              </button>
              <button disabled={reading || busy} onClick={() => void readHistory(history.id)}>
                刷新记录
              </button>
            </div>
            {history.result?.activeRun && (
              <div className="ai-task-card">
                <span className="ai-config-status warning">
                  {runDisplayLabels[history.result.activeRun.state]}
                </span>
                <p>{history.result.activeRun.name}</p>
                <button disabled={busy} onClick={() => void inspectActive()}>
                  查看活动运行
                </button>
              </div>
            )}
            {history.error && (
              <p role="alert" className="ai-task-error">
                {history.error}
              </p>
            )}
            {error && (
              <p role="alert" className="ai-task-error">
                {error}
              </p>
            )}
            {!history.result?.records.length && !reading && !history.error && (
              <p>此计划还没有错过或跳过记录。</p>
            )}
            <div className="schedule-history-records">
              {history.result?.records.map((record) => (
                <article className="ai-task-card" key={record.position}>
                  <span
                    className={
                      'ai-config-status ' +
                      (record.kind === 'missed'
                        ? 'neutral'
                        : record.kind === 'occupied'
                          ? 'warning'
                          : 'error')
                    }
                  >
                    {record.kind === 'missed'
                      ? '不补跑'
                      : record.kind === 'occupied'
                        ? '资源被占用'
                        : '触发失败'}
                  </span>
                  <h3>
                    {record.kind === 'missed'
                      ? '错过的计划'
                      : record.kind === 'occupied'
                        ? '本次触发已跳过'
                        : '未创建运行'}
                  </h3>
                  <p>
                    {record.kind === 'missed'
                      ? '退出、休眠或时钟间隙后没有追赶历史触发。'
                      : record.kind === 'occupied'
                        ? '同计划仍有运行，未重复创建 Run。'
                        : record.reason}
                  </p>
                  <small>
                    {typeof (record.time ?? record.to) === 'number'
                      ? inZone((record.time ?? record.to)!, history.result!.plan.timezone)
                      : '时间未报告'}
                  </small>
                  {record.from !== undefined && record.to !== undefined && (
                    <small>
                      原定 {inZone(record.from, history.result!.plan.timezone)} · 恢复{' '}
                      {inZone(record.to, history.result!.plan.timezone)}
                    </small>
                  )}
                </article>
              ))}
            </div>
            {reading && <p role="status">正在读取计划记录…</p>}
            {history.result?.nextCursor && (
              <button
                disabled={reading || busy}
                onClick={() => void readHistory(history.id, history.result!.nextCursor!)}
              >
                读取更早记录
              </button>
            )}
          </dialog>
        )}
      </div>
    </>
  );
}
