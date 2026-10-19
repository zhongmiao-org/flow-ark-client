import TechnicalDetails from './TechnicalDetails';
import { isTemplateAttentionOrigin } from '../../contracts/template-attention';
import SkillPanel from './SkillPanel';
import ConversationThreadPanel from './ConversationThreadPanel';
import {
  Alert,
  Badge,
  Card,
  Collapse,
  ConfigProvider,
  Descriptions,
  Empty,
  Select,
  Button,
  Checkbox,
  Input,
  Tabs,
  Tag,
} from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Attention, Bootstrap, Json } from '../shared/types';
import type { TemplateHumanReview } from '../shared/contracts.generated';
import { template_human_review_v1 } from '../shared/node-schema.generated';
import { runStateLabels } from '../shared/run-history';
import { schemaDefaults } from '../shared/template-config';
import { validateHumanInputSchema } from './human-input-schema';
import { Field, type ConfigurationFieldDraft } from './TemplateConfiguration';
import './attention-workspace.css';
import ConversationPanel, { type ConversationLeave } from './ConversationPanel';
import AttentionDetails from './AttentionDetails';
import { keepFocusedElementVisible } from './keepFocusedElementVisible';

export type AttentionNavigation = { title: string; back?: () => void; leave?: ConversationLeave };
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
const date = (value: string) => new Date(value).toLocaleString('zh-CN');
const human = (item: Attention) => item.kind === 'template-input';
const sourceId = (item: Attention) =>
  item.kind === 'template'
    ? isTemplateAttentionOrigin(item.origin)
      ? item.origin.runId
      : undefined
    : typeof item.detail?.runId === 'string'
      ? item.detail.runId
      : undefined;
const relatedRunIds = (item: Attention): string[] =>
  [
    ...new Set([
      sourceId(item),
      ...(item.kind !== 'template' && Array.isArray(item.detail?.runIds) ? item.detail.runIds : []),
    ]),
  ].filter((id): id is string => typeof id === 'string' && !!id.trim());
const ended = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
function requestState(item: Attention, data: Bootstrap, now: number) {
  if (item.detail?.answered) return 'answered';
  const run = data.runs.find((run) => run.id === sourceId(item));
  if (now - Date.parse(item.time) >= 10 * 60 * 1000 || (run && ended.has(run.state)))
    return 'expired';
  if (
    !data.fault &&
    !data.runtimeBlock &&
    run?.state === 'WAITING_INPUT' &&
    data.execution?.active?.runId === run.id &&
    data.execution.active.phase === 'executing'
  )
    return 'waiting';
  return 'unavailable';
}
function description(item: Attention) {
  for (const key of ['description', 'reason', 'message', 'error'])
    if (typeof item.detail?.[key] === 'string' && item.detail[key]) return item.detail[key];
  if (human(item)) return '请查看本次请求的内容与来源，再决定是否回应。';
  if (item.kind === 'unknown-result')
    return '操作结果尚未确认。请查看来源和证据，核对后再决定下一步。';
  if (item.kind === 'contact') return '已保存模板提供的联系信息，可查看来源并复制。';
  return '打开详情查看完整信息与处理入口。';
}
type AnswerDraft = { value: Json; text: string; fields: ConfigurationFieldDraft };
function AnswerForm({
  item,
  state,
  busy,
  submit,
  drafts,
  cancel,
  blocked,
}: {
  item: Attention;
  state: string;
  busy: boolean;
  drafts: Map<string, AnswerDraft>;
  cancel?: () => void;
  blocked?: boolean;
  submit: (value: unknown) => Promise<void>;
}) {
  const schema = item.detail?.schema ?? { type: 'boolean' };
  let supported = true;
  try {
    validateHumanInputSchema(schema);
  } catch {
    supported = false;
  }
  const simpleBoolean =
    supported &&
    schema.type === 'boolean' &&
    !Object.hasOwn(schema, 'const') &&
    !schema.enum &&
    !schema.oneOf &&
    !schema.readOnly;
  const cached = drafts.get(item.id);
  const fields = useRef<ConfigurationFieldDraft>(cached?.fields ?? {});
  const [value, setValue] = useState<Json>(() =>
    cached ? cached.value : supported ? schemaDefaults(schema) : null,
  );
  const [text, setText] = useState(() => drafts.get(item.id)?.text ?? '');
  useEffect(() => {
    drafts.set(item.id, { value, text, fields: fields.current });
  }, [drafts, item.id, value, text]);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const jsonInput = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();
  const invalidVisibility = useRef<(() => void) | undefined>(undefined);
  const enabled = state === 'waiting' && !busy && !blocked;
  useEffect(() => () => invalidVisibility.current?.(), []);
  useEffect(() => {
    if (error && enabled) return;
    invalidVisibility.current?.();
    invalidVisibility.current = undefined;
  }, [error, enabled]);
  const focusInvalid = (target: HTMLElement | null | undefined) => {
    invalidVisibility.current?.();
    invalidVisibility.current = undefined;
    if (!target) return;
    target.focus({ preventScroll: true });
    invalidVisibility.current = keepFocusedElementVisible(target);
  };
  const resetReview = () => {
    setReviewed(false);
    setError('');
  };
  useEffect(() => {
    setReviewed(false);
  }, [state]);
  return (
    <form
      ref={form}
      className="attention-answer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!enabled || !reviewed) return;
        const invalid = form.current?.querySelector<HTMLElement>('[data-value-invalid]');
        if (invalid) {
          const input = invalid.matches('input, select, textarea, button, fieldset')
            ? invalid
            : (invalid.querySelector<HTMLElement>('[aria-invalid="true"]') ??
              invalid.querySelector<HTMLElement>(
                'input:not(:disabled), textarea:not(:disabled), select:not(:disabled)',
              ));
          focusInvalid(input);
          setError('请先填写有效的输入内容');
          return;
        }
        let answer: unknown = simpleBoolean ? true : value;
        if (!supported) {
          try {
            answer = JSON.parse(text);
          } catch {
            setError('请输入有效 JSON，或联系模板提供者核对所需格式');
            focusInvalid(jsonInput.current);
            return;
          }
        }
        setError('');
        setReviewed(false);
        void submit(answer);
      }}
    >
      {!simpleBoolean && (
        <ConfigProvider componentDisabled={!enabled || undefined}>
          <fieldset
            disabled={!enabled}
            className="attention-fields"
            onChangeCapture={resetReview}
            onClickCapture={(event) => {
              if ((event.target as HTMLElement).closest('button')) resetReview();
            }}
          >
            <legend className="sr-only">补充本次请求需要的信息</legend>
            {supported && (Object.hasOwn(schema, 'const') || schema.readOnly) && (
              <pre>{JSON.stringify(value, null, 2)}</pre>
            )}
            {supported ? (
              <Field
                schema={schema}
                value={value}
                draft={fields.current}
                change={(next: Json) => {
                  resetReview();
                  setValue(next);
                }}
                label="处理结果"
              />
            ) : (
              <>
                <label>
                  此请求使用复杂数据格式
                  <Input.TextArea
                    status={!!error || undefined ? 'error' : undefined}
                    ref={(instance) => {
                      jsonInput.current = instance?.resizableTextArea?.textArea ?? null;
                    }}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    aria-label="处理结果 JSON"
                    aria-invalid={!!error || undefined}
                    aria-describedby={error ? errorId : undefined}
                    placeholder="填写请求要求的 JSON"
                    rows={7}
                  />
                </label>
                <Collapse
                  size="small"
                  items={[
                    {
                      key: 'schema',
                      label: '查看所需格式',
                      forceRender: true,
                      onKeyDown: activateCollapseWithSpace,
                      children: (
                        <pre tabIndex={0} aria-label="本次请求所需格式">
                          {JSON.stringify(schema, null, 2)}
                        </pre>
                      ),
                    },
                  ]}
                />
              </>
            )}
          </fieldset>
        </ConfigProvider>
      )}
      <Checkbox
        checked={reviewed}
        disabled={!enabled || undefined}
        onChange={(event) => setReviewed(event.target.checked)}
        className="attention-review-check"
      >
        已核对本次目标和内容
      </Checkbox>
      {error && (
        <Alert id={errorId} type="error" showIcon title={error} className="attention-feedback" />
      )}
      <div className="attention-actions">
        <Button type="primary" htmlType="submit" disabled={!enabled || !reviewed || undefined}>
          {busy ? '正在提交…' : simpleBoolean ? '确认本次动作' : '提交本次结果'}
        </Button>
        {cancel && (
          <Button
            htmlType="button"
            danger
            data-attention-cancel
            disabled={!enabled || undefined}
            onClick={cancel}
          >
            取消本次运行
          </Button>
        )}
        {simpleBoolean && (
          <Button
            htmlType="button"
            disabled={!enabled || undefined}
            onClick={() => {
              setReviewed(false);
              void submit(false);
            }}
          >
            拒绝本次请求
          </Button>
        )}
      </div>
    </form>
  );
}

export default function AttentionWorkspace({
  data,
  active,
  refresh,
  openRun,
  showBrowser,
  navigation,
  request,
  openFlow,
}: {
  request?: { id: string };
  openFlow?: (id: string) => void;
  data: Bootstrap;
  active: boolean;
  refresh: () => Promise<void>;
  openRun: (detail: any) => void;
  showBrowser: () => void;
  navigation: Dispatch<SetStateAction<AttentionNavigation | undefined>>;
}) {
  const conversationLeave = useRef<ConversationLeave | undefined>(undefined);
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [continuedThread, setContinuedThread] = useState('');
  useEffect(() => setContinuedThread(''), [selectedId]);
  const [busy, setBusy] = useState(false);
  const [openingRunId, setOpeningRunId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set());
  const errorPanel = useRef<HTMLDivElement>(null);
  const stopPanel = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  const [cancelRun, setCancelRun] = useState(false);
  const drafts = useRef(new Map<string, AnswerDraft>());
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const answerFocus = useRef<string | undefined>(undefined);
  const actionFocus = useRef<{ visit: number; trigger: HTMLButtonElement } | null>(null);
  const noticePanel = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const listFocus = useRef('');
  const runReturn = useRef<{ focus: HTMLElement; scroll: number } | null>(null);
  const visit = useRef(0);
  const handledRequest = useRef<typeof request>(undefined);
  useLayoutEffect(() => {
    if (!active || !request || handledRequest.current === request) return;
    handledRequest.current = request;
    runReturn.current = null;
    listFocus.current = request.id;
    setSelectedId(request.id);
    setError('');
    setNotice('');
    setCancelRun(false);
  }, [active, request]);
  useLayoutEffect(
    () => () => {
      visit.current++;
    },
    [active, selectedId, tab, query, kind],
  );
  const selected = data.attention.find((item) => item.id === selectedId);
  const savedReview = selected && human(selected) ? selected.detail?.review : undefined;
  const review =
    savedReview === undefined
      ? undefined
      : template_human_review_v1(savedReview)
        ? (savedReview as TemplateHumanReview)
        : null;
  const runIds = selected ? relatedRunIds(selected) : [];
  const runRecords = new Map(data.runs.map((run) => [run.id, run]));
  const currentState = (item: Attention) =>
    acknowledged.has(item.id) ? 'answered' : requestState(item, data, now);
  const state = selected && human(selected) ? currentState(selected) : undefined;
  const completed = (item: Attention) =>
    acknowledged.has(item.id) ||
    (human(item) && item.detail?.answered) ||
    (item.read && (!human(item) || requestState(item, data, now) === 'expired'));
  const pendingCount = data.attention.filter((item) => !completed(item)).length;
  const doneCount = data.attention.length - pendingCount;
  const visible = data.attention.filter(
    (item) =>
      (tab === 'done') === Boolean(completed(item)) &&
      (kind === 'all' ||
        (kind === 'human'
          ? human(item)
          : kind === 'unknown'
            ? item.kind === 'unknown-result'
            : !human(item) && item.kind !== 'unknown-result')) &&
      `${item.title} ${description(item)}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const title = selected
    ? human(selected)
      ? state === 'answered'
        ? '人工事项已处理'
        : state === 'expired'
          ? '人工请求已失效'
          : '确认本次请求'
      : '提醒详情'
    : '待办与提醒';
  const sourceRun = selected ? data.runs.find((run) => run.id === sourceId(selected)) : undefined;
  const directBack = () => {
    if (locked.current) return;
    setSelectedId('');
    setError('');
    setNotice('');
    setCancelRun(false);
  };
  const back = () =>
    conversationLeave.current ? conversationLeave.current(directBack, '待办列表') : directBack();
  useEffect(() => {
    if (!active) return;
    navigation({
      title,
      back: selected ? back : undefined,
      leave: (next, label) =>
        conversationLeave.current ? conversationLeave.current(next, label) : next(),
    });
    return () => navigation(undefined);
  }, [active, selected?.id, title, navigation]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const main = document.querySelector('main');
    const returning = runReturn.current;
    if (main) main.scrollTop = returning?.scroll ?? (selectedId ? 0 : listScroll.current);
    const target = returning?.focus.isConnected
      ? returning.focus
      : !selectedId && listFocus.current
        ? (document.querySelector<HTMLElement>(
            `[data-attention-open="${CSS.escape(listFocus.current)}"]`,
          ) ?? heading.current)
        : heading.current;
    target?.focus({ preventScroll: true });
    runReturn.current = null;
    if (!target) return;
    const ensureVisible = () => {
      if (!main || document.activeElement !== target) return;
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
    ensureVisible();
    const frame = requestAnimationFrame(ensureVisible);
    const observer = new ResizeObserver(ensureVisible);
    observer.observe(target);
    if (main) observer.observe(main);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [selectedId, active]);
  useEffect(() => {
    const target = errorPanel.current;
    if (!active || !error || !target) return;
    target.focus({ preventScroll: true });
    return keepFocusedElementVisible(target);
  }, [active, error]);
  useEffect(() => {
    const target = stopPanel.current;
    if (!active || !cancelRun || !target) return;
    target.focus({ preventScroll: true });
    return keepFocusedElementVisible(target);
  }, [active, cancelRun]);
  useEffect(() => {
    if (busy || !answerFocus.current) return;
    const answeredId = answerFocus.current;
    answerFocus.current = undefined;
    if (
      active &&
      selectedId === answeredId &&
      state === 'answered' &&
      !error &&
      document.activeElement === document.body
    ) {
      const target = heading.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      return keepFocusedElementVisible(target);
    }
  }, [active, busy, error, selectedId, state]);
  useEffect(() => {
    if (busy || !actionFocus.current) return;
    const origin = actionFocus.current;
    actionFocus.current = null;
    if (!active || error || origin.visit !== visit.current) return;
    const frame = requestAnimationFrame(() => {
      if (
        origin.visit !== visit.current ||
        (document.activeElement !== document.body &&
          !(document.activeElement === origin.trigger && origin.trigger.disabled))
      )
        return;
      const target =
        origin.trigger.isConnected && !origin.trigger.disabled
          ? origin.trigger
          : noticePanel.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [active, busy, error, notice, selectedId]);
  const act = async (operation: () => Promise<void>, message = '', acknowledgedMessage = '') => {
    if (locked.current) return;
    actionFocus.current =
      document.activeElement instanceof HTMLButtonElement
        ? { visit: visit.current, trigger: document.activeElement }
        : null;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let accepted = false;
    try {
      await operation();
      accepted = true;
      await refresh();
      setNotice(message);
    } catch (reason) {
      setError(
        (accepted && acknowledgedMessage ? acknowledgedMessage + '：' : '') +
          (reason instanceof Error ? reason.message : '操作未完成，请重试').replace(
            /^Error invoking remote method 'flowark:request': (?:Error: )?/,
            '',
          ),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const viewRun = (id: string, trigger: HTMLButtonElement) => {
    if (locked.current) return;
    locked.current = true;
    const origin = visit.current;
    setBusy(true);
    setOpeningRunId(id);
    setError('');
    setNotice('');
    runReturn.current = { focus: trigger, scroll: document.querySelector('main')?.scrollTop ?? 0 };
    void (async () => {
      try {
        const next = await api('run.detail', { id });
        if (visit.current !== origin) {
          runReturn.current = null;
          return;
        }
        if (!next?.run || next.run.id !== id)
          throw new Error('未取得对应的来源运行记录，请重新核对；未打开其他运行。');
        if (
          selected?.kind === 'template' &&
          isTemplateAttentionOrigin(selected.origin) &&
          selected.origin.version === 2
        ) {
          const source = selected.origin,
            owner = next.authorSdk?.owner;
          if (
            !owner ||
            owner.checkoutId !== source.checkoutId ||
            owner.draftId !== source.draftId ||
            owner.entryId !== source.entryId ||
            owner.baseRevision !== source.baseRevision ||
            next.run.flowId !== owner.flowId
          )
            throw Error('作者提醒与原Run固定副本来源不一致，未打开其他运行。');
        }
        openRun(next);
      } catch (reason) {
        if (visit.current === origin) {
          runReturn.current = null;
          setError(
            (reason instanceof Error ? reason.message : '来源运行暂不可用，请重试').replace(
              /^Error invoking remote method 'flowark:request': (?:Error: )?/,
              '',
            ),
          );
        }
      } finally {
        locked.current = false;
        setBusy(false);
        setOpeningRunId('');
      }
    })();
  };
  const open = (item: Attention) => {
    listFocus.current = item.id;
    listScroll.current = document.querySelector('main')?.scrollTop ?? 0;
    setSelectedId(item.id);
    setError('');
    setNotice('');
  };
  const tone = (item: Attention) => {
    if (human(item)) {
      const state = currentState(item);
      return state === 'answered' ? 'success' : state === 'expired' ? 'error' : 'warning';
    }
    return item.kind === 'unknown-result'
      ? 'warning'
      : /error|fail|limitation/.test(item.kind)
        ? 'error'
        : 'default';
  };
  const label = (item: Attention) => {
    if (human(item))
      return {
        waiting: '等待人工',
        answered: '已回应',
        expired: '请求已失效',
        unavailable: '当前不可确认',
      }[currentState(item)];
    return item.kind === 'unknown-result'
      ? '结果待核对'
      : item.read
        ? '已读提醒'
        : tone(item) === 'error'
          ? '需要处理'
          : '提醒';
  };
  const relatedRuns = runIds.length ? (
    <section className="attention-related-runs" aria-label="关联运行">
      <h3>关联运行 · {runIds.length}</h3>
      {selected?.kind === 'template' && (
        <p className="attention-muted">
          来源由 FlowArk 记录；同键重复提醒保留首次来源，原始说明保持。
        </p>
      )}
      <ul>
        {runIds.map((id, index) => {
          const run = runRecords.get(id);
          return (
            <li key={id}>
              <Card size="small" className="attention-related-run-card">
                <strong>{run?.name || `运行记录 ${index + 1}`}</strong>
                <p className="attention-muted">
                  {run
                    ? `保存状态：${runStateLabels[run.state]} · ${date(run.updatedAt)}`
                    : '当前摘要未包含此记录，可打开详情核对。'}
                </p>
                <TechnicalDetails items={[{ label: '关联运行 ID', value: id }]} />
                <Button
                  disabled={busy || undefined}
                  aria-label={`查看第 ${index + 1} 个关联运行：${run?.name || '运行记录'}`}
                  onClick={(event) => viewRun(id, event.currentTarget as HTMLButtonElement)}
                >
                  {openingRunId === id ? '正在读取运行…' : '查看运行详情'}
                </Button>
              </Card>
            </li>
          );
        })}
      </ul>
      <p className="attention-muted">查看记录和标为已读都不会重新执行任务。</p>
    </section>
  ) : (
    <p className="attention-muted">
      {selected?.kind === 'template'
        ? '这条模板提醒没有保存可信运行来源。原始说明保留，请到运行记录人工核对；不自动补链。'
        : '这条提醒未提供可直接打开的运行记录。'}
    </p>
  );
  const listContent = (
    <>
      {tab === 'done' && (
        <p className="attention-muted">
          这里保留已读和已回应的提醒。提醒已读不代表外部业务结果已核对。
        </p>
      )}
      <div className="attention-list" id="attention-list">
        {visible.map((item) => (
          <article
            className={`attention-card is-${tone(item)} ${item.kind === 'unknown-result' ? 'is-expanded' : 'is-compact'}`}
            key={item.id}
            aria-label={item.title}
          >
            <Card
              className="attention-card-surface"
              styles={{
                body: {
                  padding: item.kind === 'unknown-result' ? '24px 24px 16px' : '24px 24px 10px',
                },
              }}
            >
              <div className="attention-card-heading">
                <Tag
                  className="run-state-tag"
                  variant="filled"
                  color={tone(item)}
                  icon={<Badge status={tone(item)} />}
                >
                  {label(item)}
                </Tag>
                {item.kind !== 'unknown-result' && <h2>{item.title}</h2>}
                <time dateTime={item.time}>{date(item.time)}</time>
              </div>
              {item.kind === 'unknown-result' && <h2>{item.title}</h2>}
              <p>{description(item)}</p>
              {item.kind === 'unknown-result' && (
                <p className="attention-muted">
                  FlowArk 不会自动重复提交。请先核对证据，再决定是否另建运行。
                </p>
              )}
              <div className="attention-actions">
                <Button
                  type={item.kind === 'unknown-result' ? 'primary' : 'default'}
                  data-attention-open={item.id}
                  onClick={() => open(item)}
                >
                  {item.kind === 'unknown-result'
                    ? '查看证据并核对'
                    : human(item) && !completed(item)
                      ? '查看本次请求'
                      : '查看详情'}
                </Button>
                {sourceId(item) && (
                  <Button
                    disabled={busy || undefined}
                    onClick={(event) =>
                      viewRun(sourceId(item)!, event.currentTarget as HTMLButtonElement)
                    }
                  >
                    查看运行详情
                  </Button>
                )}
              </div>
            </Card>
          </article>
        ))}
        {!visible.length && (
          <Card className="attention-empty">
            <h2>
              {query || kind !== 'all'
                ? '没有匹配的提醒'
                : tab === 'pending'
                  ? '暂时没有需要处理的事项'
                  : '还没有已处理记录'}
            </h2>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                query || kind !== 'all'
                  ? '调整关键词或提醒类型，再试一次。'
                  : '需要你的确认或出现异常时，提醒会保存在这里。'
              }
            >
              {(query || kind !== 'all') && (
                <Button
                  onClick={() => {
                    setQuery('');
                    setKind('all');
                    searchInput.current?.focus({ preventScroll: true });
                  }}
                >
                  清除筛选
                </Button>
              )}
            </Empty>
          </Card>
        )}
      </div>
    </>
  );
  if (active && typeof selected?.detail?.skillProposalId === 'string')
    return (
      <SkillPanel
        key={selected.detail.skillProposalId}
        id={selected.detail.skillProposalId}
        refresh={refresh}
        registerLeave={(fn) => {
          conversationLeave.current = fn;
        }}
        back={directBack}
        openFlow={openFlow}
      />
    );
  if (active && (continuedThread || typeof selected?.detail?.conversationThreadId === 'string'))
    return (
      <ConversationThreadPanel
        key={continuedThread || String(selected?.detail?.conversationThreadId)}
        id={continuedThread || String(selected?.detail?.conversationThreadId)}
        refresh={refresh}
        registerLeave={(fn) => {
          conversationLeave.current = fn;
        }}
        back={directBack}
        openFlow={openFlow}
      />
    );
  if (active && typeof selected?.detail?.conversationId === 'string')
    return (
      <ConversationPanel
        key={selected.detail.conversationId}
        id={selected.detail.conversationId}
        refresh={refresh}
        registerLeave={(fn) => {
          conversationLeave.current = fn;
        }}
        back={directBack}
        openFlow={openFlow}
        continueConversation={setContinuedThread}
        openSkill={(id) => {
          const item = data.attention.find((a) => a.detail?.skillProposalId === id);
          if (item) open(item);
          else {
            directBack();
            setError('原草稿待办不可用，请核对当前记录；未打开其他草稿。');
          }
        }}
      />
    );
  return (
    <section className="page attention-page" hidden={!active} aria-label="待办与提醒">
      <header className="attention-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p>
            {selected
              ? `${sourceRun ? '来自 ' + sourceRun.name + ' · ' : ''}创建于 ${date(selected.time)}`
              : '把需要你的判断，放在清楚的位置。'}
          </p>
        </div>
      </header>
      {error && (
        <div ref={errorPanel} tabIndex={-1} className="attention-feedback" role="alert">
          <Alert
            type="error"
            role="presentation"
            showIcon
            title="请核对当前处理状态"
            description={error}
            action={
              <Button
                disabled={busy || undefined}
                onClick={() => void act(async () => {}, '已刷新当前处理状态')}
              >
                刷新状态
              </Button>
            }
          />
        </div>
      )}
      {notice && (
        <div ref={noticePanel} tabIndex={-1} className="attention-feedback" role="status">
          <Alert type="success" role="presentation" showIcon title={notice} />
        </div>
      )}
      {!selected ? (
        <>
          <Tabs
            id="attention"
            className="attention-tabs"
            aria-label="处理状态"
            activeKey={tab}
            animated={false}
            destroyOnHidden
            onChange={(key) => setTab(key as 'pending' | 'done')}
            tabBarExtraContent={
              <div className="attention-toolbar">
                <label className="attention-search">
                  <span className="sr-only">搜索待办</span>
                  <Input
                    ref={(instance) => {
                      searchInput.current = instance?.input ?? null;
                    }}
                    type="search"
                    placeholder="搜索标题或说明"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <label className="attention-filter">
                  <span className="sr-only">提醒类型</span>
                  <Select<string>
                    value={kind}
                    onChange={(value) => setKind(value)}
                    options={[
                      { value: 'all', label: '全部类型' },
                      { value: 'human', label: '人工请求' },
                      { value: 'unknown', label: '结果待核对' },
                      { value: 'other', label: '其他提醒' },
                    ]}
                  />
                </label>
              </div>
            }
            items={(
              [
                ['pending', '待处理', pendingCount],
                ['done', '已处理', doneCount],
              ] as const
            ).map(([key, name, count]) => ({
              key,
              label: `${name} · ${count}`,
              children: tab === key ? listContent : undefined,
            }))}
          />
        </>
      ) : (
        <div className="attention-detail-layout">
          <article
            className={`attention-detail-card${human(selected) ? ' attention-request-card' : ''}`}
          >
            <Card className="attention-detail-surface" styles={{ body: { padding: 28 } }}>
              <Tag
                className="run-state-tag"
                variant="filled"
                color={tone(selected)}
                icon={<Badge status={tone(selected)} />}
              >
                {label(selected)}
              </Tag>
              <h2>{selected.title}</h2>
              {state === 'answered' ? (
                <Alert
                  className="attention-feedback"
                  type="success"
                  role="status"
                  showIcon
                  title="本次请求已回应"
                  description="不会重复提交。是否继续及执行结果以来源运行为准。"
                />
              ) : state === 'expired' ? (
                <Alert
                  className="attention-feedback"
                  type="error"
                  showIcon
                  title="人工请求已失效"
                  description="请求已超时或来源运行已结束，旧确认不能继续执行。可查看来源运行和保留的证据。"
                />
              ) : state === 'unavailable' ? (
                <Alert
                  className="attention-feedback"
                  type="warning"
                  showIcon
                  title="当前无法确认请求状态"
                  description="请查看来源运行，或刷新状态后重新核对。旧按钮不会继续执行。"
                />
              ) : null}
              {human(selected) ? (
                review === null ? (
                  <Alert
                    className="attention-feedback"
                    type="error"
                    showIcon
                    title="本次核对内容格式无效"
                    description="无法完整展示目标和拟执行内容，不能回应此请求。请查看来源运行并联系模板提供者。"
                  />
                ) : review ? (
                  <>
                    <Descriptions
                      className="attention-review-content"
                      colon={false}
                      layout="vertical"
                      column={1}
                      items={[
                        {
                          key: 'target',
                          label: '目标',
                          children: <span className="attention-fact-value">{review.target}</span>,
                        },
                        {
                          key: 'content',
                          label: '拟执行内容',
                          children: (
                            <Card size="small" className="attention-review-preview">
                              {review.content === '' ? (
                                <span className="attention-muted">空内容</span>
                              ) : (
                                review.content
                              )}
                            </Card>
                          ),
                        },
                      ]}
                    />
                    {typeof selected.detail?.description === 'string' &&
                      selected.detail.description.trim() && (
                        <p className="attention-muted">{selected.detail.description}</p>
                      )}
                  </>
                ) : (
                  <div className="attention-request-content">
                    <span>本次请求内容</span>
                    <Card size="small" className="attention-request-content-card">
                      {description(selected)}
                    </Card>
                  </div>
                )
              ) : (
                <AttentionDetails item={selected} omitRunReferences={runIds.length > 0} />
              )}
              {human(selected) && state !== 'answered' && review !== null && (
                <AnswerForm
                  drafts={drafts.current}
                  key={selected.id}
                  item={selected}
                  state={state!}
                  busy={busy}
                  blocked={cancelRun}
                  cancel={
                    state === 'waiting' && sourceId(selected) ? () => setCancelRun(true) : undefined
                  }
                  submit={(value) => {
                    answerFocus.current = selected.id;
                    return act(
                      async () => {
                        await api('template.answer', { id: selected.id, value });
                        setAcknowledged((previous) => new Set(previous).add(selected.id));
                      },
                      '已回应本次请求，正在更新来源运行。',
                      '请求已回应，但列表更新失败；请刷新状态，不要重复提交',
                    );
                  }}
                />
              )}
              {!human(selected) && (
                <div className="attention-actions">
                  <Button
                    disabled={busy || selected.read || undefined}
                    type="primary"
                    onClick={() =>
                      void act(async () => {
                        await api('attention.read', { id: selected.id });
                      }, '已标为已读；不会更改运行或外部业务结果。')
                    }
                  >
                    {selected.read ? '已标为已读' : '标为已读'}
                  </Button>
                  <Button
                    disabled={busy || undefined}
                    onClick={() =>
                      void act(async () => {
                        await api('clipboard.copy', {
                          value:
                            selected.kind === 'contact' &&
                            typeof selected.detail?.value === 'string'
                              ? selected.detail.value
                              : JSON.stringify(selected.detail, null, 2),
                        });
                      }, '已复制提醒内容')
                    }
                  >
                    复制内容
                  </Button>
                </div>
              )}
              {human(selected) && state === 'expired' && !selected.read && (
                <Button
                  disabled={busy || undefined}
                  onClick={() =>
                    void act(async () => {
                      await api('attention.read', { id: selected.id });
                    }, '已归档失效提醒。')
                  }
                >
                  归档失效提醒
                </Button>
              )}
              {human(selected) && state === 'waiting' && sourceId(selected) && cancelRun && (
                <div
                  ref={stopPanel}
                  tabIndex={-1}
                  className="attention-feedback attention-stop-confirm"
                  aria-label="停止运行确认"
                >
                  <Alert
                    type="warning"
                    role="presentation"
                    showIcon
                    title="停止这个运行？"
                    description={
                      <div className="feedback-body">
                        <p>已产生的结果会保留；尚未执行的步骤不会继续。</p>
                        <div className="attention-actions">
                          <Button
                            danger
                            disabled={busy || undefined}
                            onClick={() =>
                              void act(async () => {
                                await api('run.control', {
                                  id: sourceId(selected),
                                  action: 'cancel',
                                });
                                setCancelRun(false);
                              }, '已请求停止，请查看运行最终状态。')
                            }
                          >
                            确认停止
                          </Button>
                          <Button
                            disabled={busy || undefined}
                            onClick={() => {
                              setCancelRun(false);
                              requestAnimationFrame(() =>
                                document
                                  .querySelector<HTMLElement>('[data-attention-cancel]')
                                  ?.focus(),
                              );
                            }}
                          >
                            继续查看
                          </Button>
                        </div>
                      </div>
                    }
                  />
                </div>
              )}
              {human(selected) && (
                <Collapse
                  className="attention-request-technical"
                  size="small"
                  items={[
                    {
                      key: 'technical',
                      label: '查看请求详情与格式',
                      forceRender: true,
                      onKeyDown: activateCollapseWithSpace,
                      children: <AttentionDetails item={selected} />,
                    },
                  ]}
                />
              )}
            </Card>
          </article>
          <aside
            className={`attention-detail-card attention-context${human(selected) ? ' attention-human-context' : ''}`}
          >
            <Card className="attention-detail-surface attention-context-card">
              <h2>{human(selected) ? '仅对本次请求生效' : '查看来源与证据'}</h2>
              <p>
                {human(selected)
                  ? '确认不修改实例的默认权限，也不授权其他动作。'
                  : '查看原运行记录和保存的证据，再决定下一步。'}
              </p>
              <p className="attention-muted">
                超时、取消或宿主退出后，人工请求失效。结果未知的操作不会自动重放。
              </p>
              {human(selected) ? (
                <Collapse
                  className="attention-context-links"
                  key={selected.id}
                  items={[
                    {
                      key: 'state',
                      label: '查看请求状态',
                      forceRender: true,
                      onKeyDown: activateCollapseWithSpace,
                      children: (
                        <div className="attention-context-body">
                          <h3>{label(selected)}</h3>
                          <p>
                            {state === 'waiting'
                              ? '来源运行正在等待本次回应。请核对左侧内容后再确认。'
                              : state === 'answered'
                                ? '本次请求已经回应，不会重复提交。后续结果请查看来源运行。'
                                : state === 'expired'
                                  ? '请求已超时或来源运行已结束，无法继续回应。'
                                  : '当前无法核实来源运行是否仍在等待，暂时不能回应。'}
                          </p>
                          <Descriptions
                            className="attention-source-facts"
                            colon={false}
                            size="small"
                            layout="vertical"
                            column={1}
                            items={[
                              { key: 'created', label: '创建时间', children: date(selected.time) },
                              {
                                key: 'state',
                                label: '来源运行保存状态',
                                children: sourceRun
                                  ? runStateLabels[sourceRun.state]
                                  : '当前摘要未包含来源运行',
                              },
                            ]}
                          />
                          <p className="attention-muted">
                            请求最长等待 10 分钟；取消或宿主退出会提前失效。
                          </p>
                          <Button
                            disabled={busy || undefined}
                            onClick={() => void act(async () => {}, '已刷新当前处理状态')}
                          >
                            {busy ? '正在处理…' : '刷新状态'}
                          </Button>
                        </div>
                      ),
                    },
                    {
                      key: 'source',
                      label: '查看动作来源和证据',
                      forceRender: true,
                      onKeyDown: activateCollapseWithSpace,
                      children: <div className="attention-context-body">{relatedRuns}</div>,
                    },
                  ]}
                />
              ) : (
                <>
                  {selected.kind === 'template' &&
                    isTemplateAttentionOrigin(selected.origin) &&
                    selected.origin.version === 2 && (
                      <section aria-label="作者调试提醒来源">
                        <Tag color="processing" variant="filled">
                          作者调试
                        </Tag>
                        <p>
                          固定入口 {selected.origin.entryId} · 制作修订{' '}
                          {selected.origin.baseRevision}
                        </p>
                        <p className="attention-muted">
                          编排副本 {selected.origin.checkoutId}
                          ；与正式实例和其他副本分开，同键保留首次来源与已读。
                        </p>
                      </section>
                    )}
                  {relatedRuns}
                  <Button disabled={busy || undefined} onClick={showBrowser}>
                    查看当前网页
                  </Button>
                  <p className="attention-muted">当前网页可能已切换，请先核对地址与目标。</p>
                </>
              )}
            </Card>
          </aside>
        </div>
      )}
    </section>
  );
}
