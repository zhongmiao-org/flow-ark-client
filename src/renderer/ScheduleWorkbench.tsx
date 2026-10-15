import {
  Alert,
  Badge,
  Tag,
  ConfigProvider,
  Select,
  Button,
  Checkbox,
  Input,
  Modal,
  Card,
  Empty,
  theme,
} from 'antd';
import './antd-layout.css';
import { usePageBack } from './use-page-back';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { Bootstrap, FlowRecord, Schedule } from '../shared/types';
import {
  scheduleCreateSchema,
  scheduleUpdateSchema,
  type ScheduleCursor,
  type ScheduleInspection,
} from '../shared/schedules';
import { runDisplayLabels } from '../shared/run-history';
import { Timing, inZone, timingValidationMessage } from './schedule-fields';
import type { TemplateNavigation } from './TemplateInstancePage';
import ScheduleLeaveDialog from './ScheduleLeaveDialog';
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
  editRequest,
  editRequestHandled,
  browserControl,
  navigation,
  showRun,
}: {
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  active: boolean;
  editRequest?: { id: string };
  editRequestHandled?: () => void;
  browserControl?: ReactNode;
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  showRun: (detail: any, back: () => void) => void;
}) {
  const { token } = theme.useToken();
  const [draft, setDraft] = useState<Draft>();
  const [initial, setInitial] = useState<Draft>();
  const [notice, setNotice] = useState<{ title: string; detail: string; badge: string }>();
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [operation, setOperation] = useState<'read' | 'save' | 'enable' | 'pause'>();
  const busy = operation !== undefined;
  const operationLabel =
    operation &&
    {
      read: '正在读取计划…',
      save: '正在保存计划…',
      enable: '正在启用计划…',
      pause: '正在暂停计划…',
    }[operation];
  const [leaving, setLeaving] = useState<{ next: () => void; destination: string }>();
  const [history, setHistory] = useState<{
    id: string;
    result?: ScheduleInspection;
    error?: string;
  }>();
  const [reading, setReading] = useState(false);
  const [openingRun, setOpeningRun] = useState(false);
  const [runError, setRunError] = useState('');
  const runToken = useRef(0);
  const historyError = useRef<HTMLDivElement>(null);
  const focusHistoryError = useRef(false);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const fields = useRef<HTMLFieldSetElement>(null),
    draftFocus = useRef<HTMLElement | null>(null);
  const historyFocus = useRef<HTMLElement | null>(null),
    focusAfter = useRef<HTMLElement | null>(null);
  const visibleReturn = useRef<HTMLElement | null>(null);
  const lock = useRef(false),
    destination = useRef(false),
    initialized = useRef(false),
    readToken = useRef(0);
  const scroll = useRef(0);
  const listFocus = useRef<HTMLElement | null>(null);
  const handledEditRequest = useRef<typeof editRequest>(undefined);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const feedbackHeading = useRef<HTMLHeadingElement>(null);
  const pageError = useRef<HTMLDivElement>(null);
  const cancelHistoryReads = () => {
    readToken.current++;
    runToken.current++;
    setReading(false);
    setOpeningRun(false);
    focusHistoryError.current = false;
  };
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
    setNotice(undefined);
  };
  async function perform(
    fn: () => Promise<any>,
    kind: NonNullable<typeof operation> = 'save',
    message?: string,
  ) {
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
          if (/计划已改变|流程已改变|实例已变化|计划不存在|流程不存在/.test(text))
            setConflict(true);
          throw e;
        }
      }, message);
    } finally {
      lock.current = false;
      setOperation(undefined);
    }
  }
  async function open(plan: Schedule) {
    listFocus.current = document.activeElement as HTMLElement;
    const result: ScheduleInspection | undefined = await perform(async () => {
      const value: ScheduleInspection = await api('schedule.inspect', { id: plan.id });
      if (
        value?.plan?.id !== plan.id ||
        value.plan.flowId !== plan.flowId ||
        (value.version && value.version.id !== value.plan.versionId)
      )
        throw new Error('读取的计划或固定版本与所选记录不一致，请重新读取。');
      return value;
    }, 'read');
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
          draft.mode === 'create'
            ? '[role="combobox"][aria-label="计划流程"]'
            : 'input[aria-label="计划间隔分钟"]',
        )
        ?.focus();
    } else {
      const target = listFocus.current?.isConnected ? listFocus.current : pageHeading.current;
      target?.focus({ preventScroll: true });
    }
  }, [active, draft?.mode, draft?.plan?.id]);
  useLayoutEffect(() => {
    if (!active || busy || leaving) return;
    if (error) {
      const invalid =
        error === timingValidationMessage
          ? fields.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
          : undefined;
      visibleReturn.current = invalid ?? pageError.current;
      (invalid ?? pageError.current)?.focus();
    } else if (notice) feedbackHeading.current?.focus();
  }, [active, busy, leaving, error, notice]);
  useLayoutEffect(() => {
    if (!active) {
      cancelHistoryReads();
      return;
    }
  }, [active, history]);
  useLayoutEffect(() => {
    if (reading || openingRun || !focusHistoryError.current) return;
    focusHistoryError.current = false;
    if (active && history) historyError.current?.focus();
  }, [active, history, reading, openingRun, runError]);
  useLayoutEffect(() => {
    const previous = visibleReturn.current;
    const label = previous?.getAttribute('aria-label');
    const target = previous?.isConnected
      ? previous
      : label
        ? [...(fields.current?.querySelectorAll<HTMLElement>('[aria-label]') ?? [])].find(
            (field) => field.getAttribute('aria-label') === label,
          )
        : previous?.matches('input[type="checkbox"]')
          ? fields.current?.querySelector<HTMLInputElement>('.schedule-adoption input')
          : undefined;
    if (!active || busy || history || leaving || !target?.isConnected) return;
    visibleReturn.current = null;
    const main = target.closest('main');
    const ensureVisible = () => {
      if (document.activeElement !== target || !main) return;
      const bounds = target.getBoundingClientRect();
      const visible = main.getBoundingClientRect();
      if (
        bounds.top < visible.top ||
        bounds.bottom > visible.bottom ||
        bounds.left < visible.left ||
        bounds.right > visible.right
      )
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const frame = requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
      ensureVisible();
    });
    const observer = new ResizeObserver(ensureVisible);
    observer.observe(target);
    if (main) observer.observe(main);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active, busy, history, leaving, error]);
  const go: TemplateNavigation = (next, target = '本机计划') => {
    if (lock.current || destination.current) return;
    if (!dirty) {
      next();
      return;
    }
    destination.current = true;
    setError('');
    setLeaving({ next, destination: target });
  };
  useEffect(() => {
    if (!active || !editRequest || busy || leaving || handledEditRequest.current === editRequest)
      return;
    handledEditRequest.current = editRequest;
    editRequestHandled?.();
    const plan = data.schedules.find((item) => item.id === editRequest.id);
    if (!plan) {
      setError('所选计划已不在本机列表中，请刷新后重新选择。');
      return;
    }
    go(() => {
      void open(plan);
    }, '编辑此入口计划');
  }, [active, editRequest, busy, leaving, data.schedules]);
  navigation.current = (next, target) => {
    if (lock.current || destination.current) return;
    cancelHistoryReads();
    setHistory(undefined);
    go(() => {
      assign();
      setHistory(undefined);
      next();
    }, target);
  };
  const stay = () => {
    if (lock.current) return;
    visibleReturn.current = draftFocus.current;
    setLeaving(undefined);
    destination.current = false;
  };
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
      setError(timingValidationMessage);
      if (!leaving)
        requestAnimationFrame(() =>
          fields.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        );
      return false;
    }
    const result = await perform(() =>
      api(draft.mode === 'edit' ? 'schedule.update' : 'schedule.save', parsed.data),
    );
    if (!result) return false;
    assign();
    setNotice({
      title: draft.mode === 'edit' ? '计划已保存' : '计划已创建',
      badge: '固定版本',
      detail:
        draft.mode === 'edit'
          ? `按每 ${draft.minutes} 分钟执行；保留原启停状态，仅影响未来触发。`
          : `间隔 ${draft.minutes} 分钟；已暂停，启用后才会执行。`,
    });
    return true;
  }
  async function readHistory(id: string, cursor?: ScheduleCursor) {
    const token = ++readToken.current;
    setRunError('');
    setReading(true);
    setHistory((old) => ({ id, ...(old?.id === id ? { result: old.result } : {}) }));
    try {
      const result: ScheduleInspection = await api('schedule.inspect', {
        id,
        ...(cursor ? { cursor } : {}),
      });
      if (result.plan.id !== id || (result.nextCursor && result.nextCursor.scheduleId !== id))
        throw new Error('计划记录来源不一致，请重新读取。');
      if (readToken.current === token)
        setHistory((old) => ({
          id,
          result: {
            ...result,
            records: cursor ? [...(old?.result?.records ?? []), ...result.records] : result.records,
          },
        }));
    } catch (e) {
      if (readToken.current === token) {
        focusHistoryError.current = true;
        setHistory((old) => ({
          ...old,
          id,
          error: e instanceof Error ? e.message : '计划记录读取失败',
        }));
      }
    } finally {
      if (readToken.current === token) setReading(false);
    }
  }
  const closeHistory = () => {
    cancelHistoryReads();
    visibleReturn.current = historyFocus.current;
    setHistory(undefined);
  };
  async function inspectActive() {
    if (!history?.result?.activeRun || reading || openingRun || history.error) return;
    const from = history.id,
      id = history.result.activeRun.id,
      token = ++runToken.current;
    const focused = document.activeElement as HTMLElement;
    setOpeningRun(true);
    setRunError('');
    try {
      const result = await api('run.detail', { id });
      if (token !== runToken.current) return;
      if (result?.run?.id !== id || result.run.scheduleId !== from)
        throw new Error('运行与当前计划记录不一致，请刷新记录后重新查看。');
      scroll.current = document.querySelector('main')?.scrollTop ?? 0;
      showRun(result, () => {
        focusAfter.current = focused;
      });
    } catch (e) {
      if (token === runToken.current) {
        focusHistoryError.current = true;
        setRunError(
          (e instanceof Error ? e.message : '活动运行读取失败，请重试。').replace(
            /^Error invoking remote method 'flowark:request': (?:Error: )?/,
            '',
          ),
        );
      }
    } finally {
      if (token === runToken.current) setOpeningRun(false);
    }
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
          <Button className="context-back" disabled={busy || undefined} onClick={endEditing}>
            ← 返回本机计划
          </Button>
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
        {browserControl}
      </header>
      <div
        className="page ai-task-page schedules-page"
        onFocusCapture={(event) => {
          const target = event.target as HTMLElement;
          if (target.matches('input,select') && !target.closest('dialog, .ant-modal'))
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
          <Button
            type="primary"
            aria-label="新建本机计划"
            disabled={busy || undefined}
            onClick={(event) => {
              const trigger = event.currentTarget as HTMLButtonElement;
              go(() => {
                listFocus.current = trigger;
                assign(blank());
              }, '创建计划');
            }}
          >
            创建计划
          </Button>
        </div>
        {notice && (
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
                    {notice.badge}
                  </Tag>
                  <p>{notice.detail}</p>
                  <Button
                    htmlType="button"
                    type="primary"
                    onClick={() => {
                      setNotice(undefined);
                      requestAnimationFrame(() => {
                        const target = listFocus.current?.isConnected
                          ? listFocus.current
                          : pageHeading.current;
                        target?.focus();
                      });
                    }}
                  >
                    返回计划
                  </Button>
                </div>
              }
            />
          </div>
        )}
        {operationLabel && (
          <Alert
            type="info"
            role="status"
            showIcon
            className="schedule-operation"
            title={operationLabel}
          />
        )}
        <datalist id="schedule-timezones">
          {['Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/London'].map(
            (zone) => (
              <option key={zone} value={zone} />
            ),
          )}
        </datalist>
        <div className="template-schedule-columns schedule-workbench">
          <section aria-label="本机计划列表">
            <Card className="schedule-surface schedule-plan-list">
              {!data.schedules.length && (
                <>
                  <h2>还没有本机计划</h2>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="选择一个已保存的流程或模板入口，再确认执行间隔。"
                  />
                </>
              )}
              {data.schedules.map((plan) => (
                <article
                  key={plan.id}
                  aria-current={draft?.plan?.id === plan.id ? 'true' : undefined}
                  data-schedule-id={plan.id}
                  aria-label={
                    '计划 ' +
                    (data.flows.find((flow) => flow.id === plan.flowId)?.flow.name ?? '来源不可用')
                  }
                >
                  <Card
                    size="small"
                    styles={{ body: { padding: '20px 20px 12px' } }}
                    className={
                      'template-schedule-item' + (draft?.plan?.id === plan.id ? ' selected' : '')
                    }
                  >
                    <h3>
                      {data.flows.find((flow) => flow.id === plan.flowId)?.flow.name ??
                        '来源流程不可用'}
                    </h3>
                    <Tag
                      className="run-state-tag"
                      variant="filled"
                      color={plan.enabled ? 'success' : 'default'}
                      icon={<Badge status={plan.enabled ? 'success' : 'default'} />}
                    >
                      {plan.enabled ? '已启用' : '已暂停'}
                    </Tag>
                    <p className="schedule-plan-timing">
                      每 {plan.intervalMinutes} 分钟 · {plan.timezone} ·{' '}
                      {plan.enabled ? '下次 ' + inZone(plan.nextAt, plan.timezone) : '暂无下次执行'}
                    </p>
                    <div className="ai-task-actions">
                      <Button
                        disabled={busy || undefined}
                        onClick={(event) => {
                          listFocus.current = event.currentTarget as HTMLButtonElement;
                          const toggle = () => {
                            void perform(
                              async () => {
                                const result = await api('schedule.toggle', {
                                  id: plan.id,
                                  enabled: !plan.enabled,
                                });
                                if (draft?.plan?.id === plan.id) assign();
                                const name =
                                  data.flows.find((flow) => flow.id === plan.flowId)?.flow.name ??
                                  '此计划';
                                setNotice({
                                  title: plan.enabled ? '计划已暂停' : '计划已启用',
                                  badge: '固定版本保持不变',
                                  detail: plan.enabled
                                    ? `${name}已暂停；已有运行不受影响。`
                                    : `${name}已启用，下次执行按当前间隔重新计算；不会补跑错过的计划。`,
                                });
                                return result;
                              },
                              plan.enabled ? 'pause' : 'enable',
                            );
                          };
                          if (draft?.plan?.id === plan.id)
                            go(toggle, plan.enabled ? '暂停计划' : '启用计划');
                          else toggle();
                        }}
                      >
                        {plan.enabled ? '暂停' : '启用'}
                      </Button>
                      <Button
                        aria-label="编辑计划"
                        disabled={busy || undefined}
                        onClick={() =>
                          go(
                            () => {
                              void open(plan);
                            },
                            `编辑计划 · ${data.flows.find((flow) => flow.id === plan.flowId)?.flow.name ?? plan.id}`,
                          )
                        }
                      >
                        编辑
                      </Button>
                      <Button
                        disabled={busy || undefined}
                        onClick={(event) => {
                          historyFocus.current = event.currentTarget as HTMLButtonElement;
                          void readHistory(plan.id);
                        }}
                      >
                        计划记录
                      </Button>
                    </div>
                  </Card>
                </article>
              ))}
            </Card>
          </section>
          {draft ? (
            <form
              noValidate
              key={draft.mode + (draft.plan?.id ?? '')}
              className={
                'template-schedule-form schedule-workbench-form ' +
                (draft.mode === 'edit' ? 'schedule-edit' : 'schedule-form')
              }
              aria-label={draft.mode === 'edit' ? '编辑本机计划' : '创建本机计划'}
              aria-busy={busy}
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <Card className="schedule-surface">
                <h2>{draft.mode === 'edit' ? '编辑计划' : '创建计划'}</h2>
                <ConfigProvider
                  componentDisabled={busy}
                  variant="filled"
                  theme={{
                    token: { colorFillTertiary: token.colorBgLayout },
                    components: {
                      Input: { activeBg: token.colorBgLayout, fontSize: 13, borderRadius: 6 },
                      Select: {
                        algorithm: true,
                        colorFillTertiary: token.colorBgLayout,
                        controlHeight: 32,
                        fontSize: 13,
                        lineHeight: 20 / 13,
                        borderRadius: 6,
                        paddingSM: 7,
                      },
                    },
                  }}
                >
                  <fieldset ref={fields} disabled={busy}>
                    <label>
                      <span>绑定入口</span>
                      {draft.mode === 'edit' ? (
                        <Input
                          aria-label="绑定入口"
                          readOnly
                          value={draft.flow?.flow.name ?? draft.version?.name ?? '来源流程不可用'}
                        />
                      ) : (
                        <Select<string>
                          aria-required
                          aria-label="计划流程"
                          value={draft.flow?.id ?? ''}
                          onChange={(value) =>
                            setDraft({
                              ...draft,
                              flow: structuredClone(data.flows.find((flow) => flow.id === value)),
                              adopt: false,
                            })
                          }
                          options={[
                            { value: '', label: '选择已保存的流程或入口' },
                            ...data.flows.map((flow) => ({
                              value: flow.id,
                              label: (
                                <>
                                  {flow.flow.name} · {flow.id.slice(0, 8)}
                                </>
                              ),
                            })),
                          ]}
                        />
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
                        <small className="schedule-version-id">
                          版本标识：{draft.plan.versionId}
                        </small>
                      )}
                    </div>
                    <Checkbox
                      checked={draft.adopt}
                      disabled={!draft.flow || undefined}
                      onChange={(event) => setDraft({ ...draft, adopt: event.target.checked })}
                      className="schedule-adoption"
                    >
                      <span>
                        {draft.mode === 'edit'
                          ? '采用当前已保存的流程版本'
                          : '固定当前已保存版本与入口'}
                      </span>
                    </Checkbox>
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
                        : '创建后暂停，启用后首次执行在所选间隔之后。不采用未保存草稿。'}
                    </p>
                    {changed && (
                      <div role="alert" className="schedule-conflict">
                        <Alert
                          type="error"
                          role="presentation"
                          showIcon
                          title={
                            <h3>
                              {draft.mode === 'edit' && !currentPlan
                                ? '计划已不可用'
                                : '计划或来源已更新'}
                            </h3>
                          }
                          description={
                            <div className="feedback-body">
                              <Tag
                                className="run-state-tag"
                                variant="filled"
                                color="error"
                                icon={<Badge status="error" />}
                              >
                                保存被拒绝
                              </Tag>
                              <p>
                                编辑期间计划或所选流程发生变化。当前输入已保留，重新编辑前请核对最新内容。
                              </p>
                              <Button
                                type="primary"
                                htmlType="button"
                                onClick={() =>
                                  go(() => {
                                    if (draft.mode === 'edit' && !currentPlan) assign();
                                    else if (draft.plan) void open(draft.plan);
                                    else assign(blank());
                                  })
                                }
                              >
                                {draft.mode === 'edit' && !currentPlan ? '返回计划' : '重新编辑'}
                              </Button>
                            </div>
                          }
                        />
                      </div>
                    )}
                    {error && !leaving && (
                      <div
                        role="alert"
                        className="template-operation-feedback"
                        ref={pageError}
                        tabIndex={-1}
                      >
                        <Alert
                          type="error"
                          role="presentation"
                          showIcon
                          title="操作未完成"
                          description={error}
                        />
                      </div>
                    )}
                    <div className="ai-task-actions">
                      <Button
                        htmlType="submit"
                        type="primary"
                        disabled={
                          changed ||
                          (draft.mode === 'create' && (!draft.flow || !draft.adopt)) ||
                          undefined
                        }
                      >
                        {operation === 'save'
                          ? '正在保存…'
                          : draft.mode === 'edit'
                            ? '保存计划'
                            : '创建计划'}
                      </Button>
                      <Button
                        htmlType="button"
                        aria-label={draft.mode === 'edit' ? '取消编辑' : '取消创建'}
                        onClick={() => go(() => assign())}
                      >
                        取消
                      </Button>
                    </div>
                    {draft.plan && (
                      <Button
                        htmlType="button"
                        className="schedule-history-trigger"
                        onClick={(event) => {
                          historyFocus.current = event.currentTarget as HTMLButtonElement;
                          void readHistory(draft.plan!.id);
                        }}
                      >
                        查看错过 / 占用跳过
                      </Button>
                    )}
                  </fieldset>
                </ConfigProvider>
              </Card>
            </form>
          ) : (
            <section>
              <Card className="schedule-surface schedule-idle">
                <h2>选择一个计划</h2>
                <p>选择左侧计划进行编辑，或创建一个新的本机计划。</p>
                {error && (
                  <div
                    role="alert"
                    className="template-operation-feedback"
                    ref={pageError}
                    tabIndex={-1}
                  >
                    <Alert
                      type="error"
                      role="presentation"
                      showIcon
                      title="操作未完成"
                      description={error}
                    />
                  </div>
                )}
              </Card>
            </section>
          )}
        </div>
        {leaving && (
          <ScheduleLeaveDialog
            destination={leaving.destination}
            creating={draft?.mode === 'create'}
            busy={busy}
            blocked={changed}
            unconfirmed={draft?.mode === 'create' && (!draft.flow || !draft.adopt)}
            error={error || (changed ? '计划或来源已改变，请继续编辑后重新核对。' : '')}
            stay={stay}
            discard={() => {
              const next = leaving.next;
              setLeaving(undefined);
              destination.current = false;
              assign();
              next();
            }}
            save={() => {
              const next = leaving.next;
              void save().then((ok) => {
                if (ok) {
                  setLeaving(undefined);
                  destination.current = false;
                  next();
                }
              });
            }}
          />
        )}
        {history && (
          <Modal
            open={active}
            width={1040}
            centered
            closable={false}
            mask={{ closable: false }}
            keyboard={!busy}
            footer={null}
            className="flowark-content-modal schedule-history-dialog"
            aria-labelledby="plan-history-title"
            aria-busy={reading || openingRun}
            focusable={{ focusTriggerAfterClose: false }}
            onCancel={() => {
              if (!busy) closeHistory();
            }}
            afterOpenChange={(open) => {
              if (!open) return;
              if (focusAfter.current?.isConnected) {
                document.querySelector('main')?.scrollTo({ top: scroll.current });
                focusAfter.current.focus({ preventScroll: true });
                focusAfter.current = null;
              } else if (history.error || runError) historyError.current?.focus();
              else historyHeading.current?.focus();
            }}
          >
            <h2 id="plan-history-title" ref={historyHeading} tabIndex={-1}>
              计划记录 · {historyTitle}
            </h2>
            {history.result && (
              <Card size="small" className="schedule-history-summary">
                <Tag
                  className="run-state-tag"
                  variant="filled"
                  color={history.result.plan.enabled ? 'success' : 'default'}
                  icon={<Badge status={history.result.plan.enabled ? 'success' : 'default'} />}
                >
                  {history.result.plan.enabled ? '已启用' : '已暂停'}
                </Tag>
                <p>
                  每 {history.result.plan.intervalMinutes} 分钟 · {history.result.plan.timezone}
                </p>
                <p>
                  {history.result.plan.enabled
                    ? '下次：' + inZone(history.result.plan.nextAt, history.result.plan.timezone)
                    : '暂停期间不触发；已有运行不受影响。'}
                </p>
                <small>固定版本：{history.result.plan.versionId}</small>
              </Card>
            )}
            <p>错过不补跑，占用时不重复创建运行。这里只显示已报告的记录。</p>
            <div className="ai-task-actions">
              <Button disabled={busy || undefined} onClick={closeHistory}>
                返回计划
              </Button>
              <Button
                disabled={reading || busy || openingRun || undefined}
                onClick={() => void readHistory(history.id)}
              >
                刷新记录
              </Button>
            </div>
            {history.result?.activeRun && (
              <Card className="schedule-history-active">
                <Tag
                  className="run-state-tag"
                  variant="filled"
                  color="warning"
                  icon={<Badge status="warning" />}
                >
                  {runDisplayLabels[history.result.activeRun.state]}
                </Tag>
                <p>{history.result.activeRun.name}</p>
                <Button
                  disabled={busy || reading || openingRun || !!history.error || undefined}
                  onClick={() => void inspectActive()}
                >
                  {openingRun ? '正在读取活动运行…' : '查看活动运行'}
                </Button>
              </Card>
            )}
            {(history.error || runError) && (
              <div
                role="alert"
                className="template-operation-feedback"
                ref={historyError}
                tabIndex={-1}
              >
                <Alert
                  type="error"
                  role="presentation"
                  showIcon
                  title="操作未完成"
                  description={history.error || runError}
                />
              </div>
            )}
            {history.error && history.result && (
              <p>上次读取的记录仍保留。请重新读取后再查看活动运行。</p>
            )}
            {!history.result?.records.length && !reading && !history.error && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="此计划还没有错过或跳过记录。"
              />
            )}
            <div className="schedule-history-records">
              {history.result?.records.map((record) => (
                <article key={record.position}>
                  <Card className="schedule-history-record">
                    <Tag
                      className="run-state-tag"
                      variant="filled"
                      color={
                        record.kind === 'missed'
                          ? 'default'
                          : record.kind === 'occupied'
                            ? 'warning'
                            : 'error'
                      }
                      icon={
                        <Badge
                          status={
                            record.kind === 'missed'
                              ? 'default'
                              : record.kind === 'occupied'
                                ? 'warning'
                                : 'error'
                          }
                        />
                      }
                    >
                      {record.kind === 'missed'
                        ? '不补跑'
                        : record.kind === 'occupied'
                          ? '资源被占用'
                          : '触发失败'}
                    </Tag>
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
                  </Card>
                </article>
              ))}
            </div>
            {reading && <p role="status">正在读取计划记录…</p>}
            {history.result?.nextCursor && (
              <Button
                disabled={reading || busy || openingRun || undefined}
                onClick={() => void readHistory(history.id, history.result!.nextCursor!)}
              >
                读取更早记录
              </Button>
            )}
          </Modal>
        )}
      </div>
    </>
  );
}
