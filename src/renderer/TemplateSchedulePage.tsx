import { Alert, Badge, Tag, ConfigProvider, Button, Checkbox, Input, Card, Empty } from 'antd';
import { usePageBack } from './use-page-back';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { Bootstrap, Schedule } from '../shared/types';
import { scheduleCreateSchema } from '../shared/schedules';
import type { TemplateEntryOrigin } from './template-entry-navigation';
import type { TemplateNavigation } from './TemplateInstancePage';
import { Timing, inZone, timingValidationMessage } from './schedule-fields';
import ScheduleLeaveDialog from './ScheduleLeaveDialog';
import './template-schedule.css';
import './schedule-workbench.css';
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
export default function TemplateSchedulePage({
  origin,
  data,
  action,
  navigation,
  back,
  manage,
  browserControl,
}: {
  origin: TemplateEntryOrigin;
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  back: () => void;
  manage: (planId?: string) => void;
  browserControl?: ReactNode;
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
    [operation, setOperation] = useState<'create' | 'enable' | 'pause'>(),
    [created, setCreated] = useState<Schedule>();
  const busy = operation !== undefined;
  const [notice, setNotice] = useState<{ title: string; detail: string }>();
  const pageError = useRef<HTMLDivElement>(null);
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const toggleFocus = useRef<HTMLButtonElement | null>(null);
  const [leaving, setLeaving] = useState<{ next: () => void; destination: string }>();
  const lock = useRef(false),
    pending = useRef(false);
  const form = useRef<HTMLFormElement>(null),
    focus = useRef<HTMLElement | null>(null);
  const dirty =
    !created &&
    (confirmed || timing.minutes !== initial.minutes || timing.timezone !== initial.timezone);
  useEffect(() => {
    let live = true;
    setChecking(true);
    setSourceError('');
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
  useLayoutEffect(() => {
    if (busy || checking || leaving) return;
    if (sourceError || error) {
      const invalid =
        !sourceError && error === timingValidationMessage
          ? form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
          : undefined;
      (invalid ?? pageError.current)?.focus();
    } else if (notice) feedbackHeading.current?.focus();
  }, [busy, checking, leaving, sourceError, error, notice]);
  useLayoutEffect(() => {
    if (created && !leaving) resultHeading.current?.focus();
  }, [created]);
  const perform = async (fn: () => Promise<any>, kind: NonNullable<typeof operation>) => {
    if (lock.current) return;
    lock.current = true;
    setOperation(kind);
    setError('');
    setNotice(undefined);
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
      setOperation(undefined);
    }
  };
  const create = async () => {
    if (created) return true;
    if (lock.current || checking || sourceError) return false;
    setNotice(undefined);
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
      setError(timingValidationMessage);
      if (!leaving)
        requestAnimationFrame(() =>
          form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        );
      return false;
    }
    const result = await perform(() => api('schedule.save', parsed.data), 'create');
    if (!result) return false;
    setCreated(result);
    return true;
  };
  const go: TemplateNavigation = (next, destination = '模板入口') => {
    if (lock.current || pending.current) return;
    if (!dirty) {
      next();
      return;
    }
    pending.current = true;
    setError('');
    setLeaving({ next, destination });
  };
  navigation.current = go;
  const stay = () => {
    if (lock.current) return;
    pending.current = false;
    setLeaving(undefined);
    requestAnimationFrame(() => focus.current?.focus({ preventScroll: true }));
  };
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
        <Button className="context-back" disabled={busy || undefined} onClick={() => go(back)}>
          ← 返回模板入口
        </Button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#schedules"
            onClick={(event) => {
              event.preventDefault();
              go(() => manage(), '本机计划');
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
        {browserControl}
      </header>
      <section className="page ai-task-page template-schedule-page">
        <div className="page-heading">
          <div>
            <h1>本机计划</h1>
            <p>按分钟间隔执行固定内容，休眠或退出期间不补跑。</p>
          </div>
        </div>
        {(checking || operation) && !leaving && (
          <Alert
            className="schedule-operation"
            type="info"
            role="status"
            showIcon
            title={
              operation
                ? { create: '正在创建计划…', enable: '正在启用计划…', pause: '正在暂停计划…' }[
                    operation
                  ]
                : '正在核对来源实例与入口…'
            }
          />
        )}
        {(sourceError || error) && !leaving && (
          <div ref={pageError} tabIndex={-1} role="alert" className="template-operation-feedback">
            <Alert
              type="error"
              role="presentation"
              showIcon
              title="操作未完成"
              description={sourceError || error}
            />
          </div>
        )}
        {notice && !leaving && (
          <div className="schedule-feedback" role="status">
            <Alert
              type="success"
              role="presentation"
              showIcon
              title={
                <h2 ref={feedbackHeading} tabIndex={-1}>
                  {notice.title}
                </h2>
              }
              description={
                <div className="feedback-body">
                  <Tag
                    className="run-state-tag"
                    variant="filled"
                    color="success"
                    icon={<Badge status="success" />}
                  >
                    固定版本保持不变
                  </Tag>
                  <p>{notice.detail}</p>
                  <Button
                    htmlType="button"
                    onClick={() => {
                      setNotice(undefined);
                      requestAnimationFrame(() => toggleFocus.current?.focus());
                    }}
                  >
                    返回计划
                  </Button>
                </div>
              }
            />
          </div>
        )}
        <div className="template-schedule-columns">
          <section>
            <Card className="schedule-surface template-schedule-list">
              <h2>此入口的计划</h2>
              {plans.length ? (
                plans.map((plan) => (
                  <article key={plan.id} data-schedule-id={plan.id}>
                    <Card size="small" className="template-schedule-item">
                      <h3>
                        {data.flows.find((flow) => flow.id === plan.flowId)?.flow.name ??
                          origin.title}
                      </h3>
                      <Tag
                        className="run-state-tag"
                        variant="filled"
                        color={plan.enabled ? 'success' : 'default'}
                        icon={<Badge status={plan.enabled ? 'success' : 'default'} />}
                      >
                        {plan.enabled ? '已启用' : '已暂停'}
                      </Tag>
                      <p>
                        每 {plan.intervalMinutes} 分钟 · {plan.timezone}
                      </p>
                      <p>
                        {plan.enabled
                          ? '下次 ' + inZone(plan.nextAt, plan.timezone)
                          : '暂无下次执行'}
                      </p>
                      <small>按保存计划时的固定方案执行</small>
                      <div className="ai-task-actions">
                        <Button
                          disabled={busy || undefined}
                          onClick={(event) => {
                            toggleFocus.current = event.currentTarget as HTMLButtonElement;
                            void perform(
                              () => api('schedule.toggle', { id: plan.id, enabled: !plan.enabled }),
                              plan.enabled ? 'pause' : 'enable',
                            ).then((result) => {
                              if (!result) return;
                              setNotice({
                                title: !plan.enabled ? '计划已启用' : '计划已暂停',
                                detail: !plan.enabled
                                  ? '下次执行按当前间隔重新计算；不会补跑错过的计划。'
                                  : '暂停后不再触发新运行；已排队和正在执行的运行保持原样。',
                              });
                            });
                          }}
                        >
                          {plan.enabled ? '暂停计划' : '启用计划'}
                        </Button>
                        <Button
                          disabled={busy || undefined}
                          aria-label="编辑计划"
                          onClick={() => go(() => manage(plan.id), '编辑此入口计划')}
                        >
                          编辑
                        </Button>
                      </div>
                    </Card>
                  </article>
                ))
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此入口还没有本机计划。" />
              )}
              <Button disabled={busy || undefined} onClick={() => go(() => manage(), '本机计划')}>
                管理本机计划
              </Button>
            </Card>
          </section>
          <form
            noValidate
            ref={form}
            className="template-schedule-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Card className="schedule-surface">
              <h2 ref={resultHeading} tabIndex={-1}>
                {created ? '计划已创建' : '创建计划'}
              </h2>
              <ConfigProvider componentDisabled={busy || !!created || undefined}>
                <fieldset disabled={busy || !!created}>
                  <label className="ai-settings-field">
                    <span>绑定入口</span>
                    <Input readOnly value={origin.title} aria-label="绑定入口" />
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
                  <Checkbox
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="schedule-adoption"
                  >
                    <span>固定当前已保存版本与入口</span>
                  </Checkbox>
                  <p>
                    不采用未保存草稿。创建后暂停，启用后首次运行在所选间隔之后；已排队或活动运行保持原样。
                  </p>
                </fieldset>
              </ConfigProvider>
              {created ? (
                <>
                  <Alert
                    type="success"
                    role="status"
                    showIcon
                    title="计划已创建 · 执行方案已固定"
                    description="已暂停，启用后才会执行。"
                  />
                  <Button htmlType="button" onClick={back}>
                    返回模板入口
                  </Button>
                </>
              ) : (
                <div className="ai-task-actions">
                  <Button
                    htmlType="submit"
                    type="primary"
                    disabled={busy || checking || !!sourceError || !confirmed || undefined}
                  >
                    {operation === 'create' ? '正在创建…' : '创建计划'}
                  </Button>
                  <Button htmlType="button" disabled={busy || undefined} onClick={() => go(back)}>
                    取消
                  </Button>
                </div>
              )}
            </Card>
          </form>
        </div>
      </section>
      {leaving && (
        <ScheduleLeaveDialog
          destination={leaving.destination}
          creating
          busy={busy}
          blocked={checking || !!sourceError}
          unconfirmed={!confirmed}
          error={error || sourceError}
          stay={stay}
          discard={() => {
            const next = leaving.next;
            pending.current = false;
            setLeaving(undefined);
            next();
          }}
          save={() => {
            const next = leaving.next;
            void create().then((ok) => {
              if (ok) {
                pending.current = false;
                setLeaving(undefined);
                next();
              }
            });
          }}
        />
      )}
    </div>
  );
}
