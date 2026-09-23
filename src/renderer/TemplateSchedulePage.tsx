import { usePageBack } from './use-page-back';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Bootstrap, Schedule } from '../shared/types';
import { scheduleCreateSchema } from '../shared/schedules';
import type { TemplateEntryOrigin } from './template-entry-navigation';
import type { TemplateNavigation } from './TemplateInstancePage';
import { Timing, inZone } from './Schedules';
import './template-schedule.css';
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
export default function TemplateSchedulePage({
  origin,
  data,
  action,
  navigation,
  back,
  manage,
}: {
  origin: TemplateEntryOrigin;
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  back: () => void;
  manage: () => void;
}) {
  const [initial] = useState(() => ({
    minutes: '60',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  const [timing, setTiming] = useState(initial),
    [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState(true),
    [sourceError, setSourceError] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState<Schedule>();
  const [leaving, setLeaving] = useState<{ next: () => void }>();
  const lock = useRef(false),
    pending = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null),
    focus = useRef<HTMLElement | null>(null);
  const dirty =
    !created &&
    (confirmed || timing.minutes !== initial.minutes || timing.timezone !== initial.timezone);
  useEffect(() => {
    let live = true;
    void api('template.detail', { id: origin.source.instanceId })
      .then((detail) => {
        if (!live) return;
        if (
          detail.revision !== origin.source.revision ||
          detail.instance.entryFlows[origin.source.entryId] !== origin.flowId
        )
          setSourceError('来源实例或入口已变化，请返回原入口重新核对。');
        else if (
          !detail.entries.find((entry: any) => entry.id === origin.source.entryId)?.schedulable
        )
          setSourceError('此入口不支持本机计划。');
      })
      .catch(() => {
        if (live) setSourceError('无法读取来源实例，请返回原入口重新核对。');
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [origin]);
  const perform = async (fn: () => Promise<any>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
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
          if (/实例已变化|实例不存在|原入口流程/.test(text))
            setSourceError('来源实例或入口已变化，请返回原入口重新核对。');
          throw e;
        }
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const create = async () => {
    if (created) return true;
    if (lock.current || checking || sourceError) return false;
    if (!confirmed) {
      setError('请确认固定当前已保存版本与入口。');
      return false;
    }
    const parsed = scheduleCreateSchema.safeParse({
      flowId: origin.flowId,
      templateSource: origin.source,
      intervalMinutes: Number(timing.minutes),
      timezone: timing.timezone,
    });
    if (!parsed.success) {
      setError('请填写 1–525600 的整数分钟数和有效时区。');
      return false;
    }
    const result = await perform(() => api('schedule.save', parsed.data));
    if (!result) return false;
    setCreated(result);
    return true;
  };
  const go: TemplateNavigation = (next) => {
    if (lock.current || pending.current) return;
    if (!dirty) {
      next();
      return;
    }
    pending.current = true;
    setError('');
    setLeaving({ next });
  };
  navigation.current = go;
  const stay = () => {
    if (lock.current) return;
    dialog.current?.close();
    pending.current = false;
    setLeaving(undefined);
    requestAnimationFrame(() => focus.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    if (leaving) dialog.current?.showModal();
  }, [leaving]);
  usePageBack(() => go(back));
  const plans = data.schedules.filter((plan) => plan.flowId === origin.flowId);
  return (
    <div
      className="template-schedule-host"
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.matches('input,select,textarea') && !target.closest('dialog'))
          focus.current = target;
      }}
    >
      <header className="topbar">
        <button className="context-back" disabled={busy} onClick={() => go(back)}>
          ← 返回模板入口
        </button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#schedules"
            onClick={(event) => {
              event.preventDefault();
              go(manage);
            }}
          >
            本机计划
          </a>
          <span aria-hidden="true">/</span>
          <span className="ai-source-title" title={origin.title}>
            {origin.title}
          </span>
          <span aria-hidden="true">/</span>
          <span aria-current="page">创建计划</span>
        </nav>
      </header>
      <section className="page ai-task-page template-schedule-page">
        <div className="page-heading">
          <div>
            <h1>本机计划</h1>
            <p>按分钟间隔执行固定内容，休眠或退出期间不补跑。</p>
          </div>
        </div>
        <div className="template-schedule-columns">
          <section className="ai-task-card template-schedule-list">
            <h2>此入口的计划</h2>
            {plans.length ? (
              plans.map((plan) => (
                <article
                  key={plan.id}
                  className="template-schedule-item"
                  data-schedule-id={plan.id}
                >
                  <h3>
                    {data.flows.find((flow) => flow.id === plan.flowId)?.flow.name ?? origin.title}
                  </h3>
                  <span className={'ai-config-status ' + (plan.enabled ? 'success' : 'neutral')}>
                    {plan.enabled ? '已启用' : '已暂停'}
                  </span>
                  <p>
                    每 {plan.intervalMinutes} 分钟 · {plan.timezone}
                  </p>
                  <p>
                    {plan.enabled ? '下次 ' + inZone(plan.nextAt, plan.timezone) : '暂无下次执行'}
                  </p>
                  <small>固定版本 {plan.versionId.slice(0, 8)}</small>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(() =>
                        api('schedule.toggle', { id: plan.id, enabled: !plan.enabled }),
                      )
                    }
                  >
                    {plan.enabled ? '暂停计划' : '启用计划'}
                  </button>
                </article>
              ))
            ) : (
              <p>此入口还没有本机计划。</p>
            )}
            <button disabled={busy} onClick={() => go(manage)}>
              管理本机计划
            </button>
          </section>
          <form
            ref={form}
            className="ai-task-card template-schedule-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <h2>{created ? '计划已创建' : '创建计划'}</h2>
            <fieldset disabled={busy || !!created}>
              <label className="ai-settings-field">
                <span>绑定入口</span>
                <input readOnly value={origin.title} aria-label="绑定入口" />
              </label>
              <Timing
                {...timing}
                onChange={(change) => setTiming((old) => ({ ...old, ...change }))}
              />
              <div className="ai-settings-field">
                <span>固定内容</span>
                <p>
                  {origin.savedAt
                    ? inZone(Date.parse(origin.savedAt), timing.timezone) + ' 保存的版本'
                    : '来源入口的已保存内容'}
                </p>
              </div>
              <label className="schedule-adoption">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>固定当前已保存版本与入口</span>
              </label>
              <p>
                不采用未保存草稿。创建后启用，首次运行在所选间隔之后；已排队或活动运行保持原样。
              </p>
            </fieldset>
            {sourceError && (
              <p role="alert" className="ai-task-error">
                {sourceError}
              </p>
            )}
            {error && !leaving && (
              <p role="alert" className="ai-task-error">
                {error}
              </p>
            )}
            {created ? (
              <>
                <p role="status">
                  计划已创建 · 固定版本 {created.versionId.slice(0, 8)}，尚未因本次创建立即运行。
                </p>
                <button type="button" onClick={back}>
                  返回模板入口
                </button>
              </>
            ) : (
              <div className="ai-task-actions">
                <button className="primary" disabled={busy || checking || !!sourceError}>
                  创建计划
                </button>
                <button type="button" disabled={busy} onClick={() => go(back)}>
                  取消
                </button>
              </div>
            )}
          </form>
        </div>
      </section>
      {leaving && (
        <dialog
          ref={dialog}
          className="script-leave-dialog ai-settings-dialog"
          aria-labelledby="schedule-leave-title"
          onCancel={(event) => {
            event.preventDefault();
            stay();
          }}
        >
          <h2 id="schedule-leave-title">保存计划再离开？</h2>
          <p>保存会创建并启用一个固定版本的计划，成功后前往刚才选择的位置。</p>
          <div className="ai-task-actions">
            <button autoFocus disabled={busy} onClick={stay}>
              继续编辑
            </button>
            <button
              className="primary"
              disabled={busy || checking || !!sourceError}
              onClick={() => {
                const next = leaving.next;
                void create().then((ok) => {
                  if (ok) {
                    dialog.current?.close();
                    pending.current = false;
                    setLeaving(undefined);
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
                dialog.current?.close();
                pending.current = false;
                setLeaving(undefined);
                next();
              }}
            >
              不保存离开
            </button>
          </div>
          {(error || sourceError) && <p role="alert">{error || sourceError}</p>}
        </dialog>
      )}
    </div>
  );
}
