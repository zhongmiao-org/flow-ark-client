import type { TemplateEntryOrigin } from './template-entry-navigation';
import type { Bootstrap, Run } from '../shared/types';
import { runDisplayLabels } from '../shared/run-history';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TemplateDetail, TemplateSaveScope } from './template-draft';
import type { AIConfigurationState, AIProviderId } from '../shared/ai-settings';
import type { AISettingsEntry } from './AISettingsPage';
import { Field } from './TemplateConfiguration';
import './template-entry.css';

export type { TemplateDetail } from './template-draft';
const api = (method: string, args: unknown): Promise<any> => window.flowark.request(method, args);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const providerName = (provider: AIProviderId) => (provider === 'deepseek' ? 'DeepSeek' : 'OpenAI');
const defaultModel = (provider: AIProviderId) =>
  provider === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex';

export default function TemplateEntry({
  active,
  inspection,
  openDetail,
  closeDetail,
  detail,
  saved,
  browsers,
  entryId,
  selectEntry,
  showRun,
  schedule,
  savedAt,
  change,
  sourceError,
  sourceChecking,
  save,
  work,
  busy,
  configure,
  settings,
}: {
  active: boolean;
  inspection: boolean;
  openDetail: (entryId: string) => void;
  closeDetail: () => void;
  detail: TemplateDetail;
  saved: TemplateDetail;
  browsers: Bootstrap['browsers'];
  entryId: string;
  selectEntry: (entryId: string) => void;
  showRun: (detail: any, origin: TemplateEntryOrigin, output?: boolean) => void;
  schedule: (origin: TemplateEntryOrigin) => void;
  savedAt: string;
  change: (detail: TemplateDetail) => void;
  sourceError: string;
  sourceChecking: boolean;
  save: (scope: TemplateSaveScope, entryId?: string) => Promise<boolean>;
  work: (fn: () => Promise<any>, message?: string) => Promise<any>;
  busy: boolean;
  configure: () => void;
  settings: (entry: AISettingsEntry) => void;
}) {
  const entry = detail.entries.find((e) => e.id === entryId)!;
  const instance = detail.instance;
  const [configurations, setConfigurations] = useState<
    Partial<Record<AIProviderId, AIConfigurationState>>
  >({});
  const [checking, setChecking] = useState(true);
  const [readError, setReadError] = useState(''),
    [reload, setReload] = useState(0);
  const [choices, setChoices] = useState<Record<string, AIProviderId>>({});
  const scroll = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null),
    loadingResources = useRef(false);
  const inputFields = useRef<HTMLFieldSetElement>(null);
  const [invalidInput, setInvalidInput] = useState(false);
  const [inputSaved, setInputSaved] = useState(0);
  const [createdRun, setCreatedRun] = useState<{ id: string; origin: TemplateEntryOrigin }>();
  const createdRunNotice = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (active && createdRun && !busy) createdRunNotice.current?.focus();
  }, [active, createdRun, busy]);
  const hasInvalidInput = () => !!inputFields.current?.querySelector('[data-value-invalid]');
  useLayoutEffect(() => {
    const fields = inputFields.current;
    if (!fields) return;
    const update = () => setInvalidInput(hasInvalidInput());
    const observer = new MutationObserver(update);
    observer.observe(fields, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-value-invalid'],
    });
    update();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!inputSaved || !active) return;
    const card = inputFields.current?.parentElement;
    const target =
      card?.querySelector<HTMLElement>('.template-entry-run:not(:disabled)') ??
      card?.querySelector<HTMLElement>('select[aria-label="操作入口"]');
    target?.focus({ preventScroll: true });
  }, [inputSaved]);
  const aiResources = detail.manifest.resources.filter(
    (r) => r.kind === 'ai' && entry.resources.includes(r.id),
  );
  const selectedProvider = (id: string): AIProviderId =>
    choices[id] ??
    (instance.resources[id]?.provider === 'openai-codex' ? 'openai-codex' : 'deepseek');
  const providers = [...new Set(aiResources.map((r) => selectedProvider(r.id)))].sort().join(',');
  // Keep the local draft intact. Only current source identity and public AI state
  // are reread after navigation; returning never saves configuration or input.
  useLayoutEffect(() => {
    if (!active) return;
    let live = true;
    loadingResources.current = true;
    setChecking(true);
    setReadError('');
    setConfigurations({});
    const resources = Promise.all(
      providers
        ? providers.split(',').map(async (provider) => {
            const state: AIConfigurationState = await api('ai.configuration.get', { provider });
            return [provider, state] as const;
          })
        : [],
    )
      .then((states) => {
        if (live) setConfigurations(Object.fromEntries(states));
      })
      .catch(() => {
        if (live) setReadError('AI 配置状态读取失败，请重试；未将读取失败当作未配置。');
      });
    void Promise.all([resources]).finally(() => {
      if (live) {
        loadingResources.current = false;
        setChecking(false);
      }
    });
    return () => {
      live = false;
    };
  }, [active, instance.id, entryId, providers, reload]);
  // Restore only after React has committed the loaded resource card height.
  // Scrolling in the promise callback can clamp to the shorter loading page.
  useLayoutEffect(() => {
    if (!active || checking || sourceChecking || loadingResources.current) return;
    document.querySelector('main')?.scrollTo({ top: scroll.current });
    if (returnFocus.current) {
      const target = returnFocus.current.matches(':disabled')
        ? inputFields.current?.parentElement?.querySelector<HTMLElement>(
            'select[aria-label="操作入口"]',
          )
        : returnFocus.current;
      target?.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [active, checking, sourceChecking]);
  const dirtyInput =
    invalidInput || !equal(entry.values, saved.entries.find((e) => e.id === entryId)?.values);
  const dirtyConfiguration = !equal(instance, saved.instance);
  const missing = entry.resources.filter((id) => {
    const declaration = detail.manifest.resources.find((r) => r.id === id)!;
    const binding = instance.resources[id];
    if (!binding) return declaration.required;
    if (declaration.kind === 'ai')
      return (
        !binding.provider ||
        !binding.model ||
        !configurations[binding.provider as AIProviderId]?.configured
      );
    return declaration.kind === 'browser'
      ? !browsers.some((browser) => browser.id === binding.browserId)
      : !binding.path;
  });
  const denied = entry.actions.filter(
    (id) => !instance.grants[id] || instance.grants[id] === 'deny',
  );
  const saveInput = async () => {
    if (await save('input', entryId)) setInputSaved((value) => value + 1);
  };
  const saveConfiguration = () => save('instance');
  const openSettings = (resourceId: string, trigger: HTMLButtonElement) => {
    scroll.current = document.querySelector('main')?.scrollTop ?? 0;
    returnFocus.current = trigger;
    const provider = selectedProvider(resourceId);
    settings({
      key: crypto.randomUUID(),
      provider,
      model:
        (instance.resources[resourceId]?.provider === provider &&
          instance.resources[resourceId]?.model) ||
        configurations[provider]?.model ||
        defaultModel(provider),
      source: {
        kind: 'template',
        title: `${detail.manifest.name} / ${instance.name} · ${instance.id.slice(0, 8)} / ${entry.name}`,
        instanceId: instance.id,
        entryId,
        packageKey: instance.packageKey,
        entryFlowId: instance.entryFlows[entryId],
      },
    });
  };
  const [latest, setLatest] = useState<Run>();
  const [latestError, setLatestError] = useState(''),
    [latestLoading, setLatestLoading] = useState(false);
  const [latestReload, reloadLatest] = useState(0);
  const flowId = instance.entryFlows[entryId];
  useEffect(() => {
    if (!active) return;
    if (!flowId) {
      setLatest(undefined);
      setLatestError('原入口流程不存在，请返回模板库重新读取。');
      setLatestLoading(false);
      return;
    }
    let live = true,
      pending = false;
    setLatest(undefined);
    setLatestLoading(true);
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api('run.list', { flowId, limit: 1 });
        if (live) {
          setLatest(result.runs[0]);
          setLatestError('');
        }
      } catch {
        if (live) setLatestError('最近运行读取失败，请重试。');
      } finally {
        pending = false;
        if (live) setLatestLoading(false);
      }
    };
    void read();
    const timer = setInterval(read, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, flowId, latestReload]);
  const origin = (): TemplateEntryOrigin => {
    scroll.current = document.querySelector('main')?.scrollTop ?? 0;
    const focused = document.activeElement as HTMLElement;
    return {
      source: { instanceId: instance.id, entryId, revision: saved.revision },
      flowId,
      title: `${instance.name} · ${instance.id.slice(0, 8)} / ${entry.name}`,
      savedAt,
      back: () => {
        returnFocus.current = focused;
      },
    };
  };
  const inspectRun = async (id: string, from: TemplateEntryOrigin, output = false) => {
    const next = await work(async () => {
      const detail = await api('run.detail', { id });
      if (!detail?.run || detail.run.flowId !== flowId)
        throw new Error('这条入口运行已不存在，请重新读取。');
      return detail;
    });
    if (next) {
      setCreatedRun((current) => (current?.id === id ? undefined : current));
      showRun(next, from, output);
    }
  };
  const start = async (debug: boolean) => {
    if (createdRun || hasInvalidInput()) return;
    const from = origin();
    const run = await work(async () => {
      const run = await api('flow.run', { id: flowId, debug, templateSource: from.source });
      // Keep the creation receipt even if the outer bootstrap refresh fails.
      setCreatedRun({ id: run.id, origin: from });
      return run;
    }, '已创建入口运行');
    if (run) await inspectRun(run.id, from);
  };
  const blocked = busy || checking || sourceChecking || !!sourceError;
  const cannotStart =
    blocked ||
    !!createdRun ||
    !flowId ||
    !!readError ||
    dirtyInput ||
    dirtyConfiguration ||
    !!missing.length ||
    !!denied.length ||
    !!entry.unavailable.length;
  const requirements = [
    ...(!flowId ? ['原入口流程不存在，请返回模板库重新读取。'] : []),
    ...(dirtyInput ? [invalidInput ? '请修正本次输入中未完成的字段。' : '本次输入尚未保存。'] : []),
    ...(dirtyConfiguration ? ['实例配置尚未保存。'] : []),
    ...(missing.length
      ? [
          '待配置资源：' +
            missing
              .map((id) => detail.manifest.resources.find((resource) => resource.id === id)!.name)
              .join('、'),
        ]
      : []),
    ...(denied.length
      ? [
          '动作仍为禁止：' +
            denied
              .map((id) => detail.manifest.actions.find((action) => action.id === id)!.name)
              .join('、'),
        ]
      : []),
    ...(entry.unavailable.length ? ['缺少能力：' + entry.unavailable.join('、')] : []),
  ];
  const reading = checking || sourceChecking;
  const readiness =
    sourceError || readError
      ? '入口状态待核对'
      : reading
        ? '正在核对入口资源'
        : requirements.length
          ? '当前入口尚未就绪'
          : '当前入口已填写 · 运行前复核';

  const entrySelector = (
    <label className="ai-settings-field">
      <span>操作入口</span>
      <select
        aria-label="操作入口"
        disabled={busy}
        value={entryId}
        onChange={(event) => selectEntry(event.target.value)}
      >
        {detail.entries.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
  const ResourceContainer = inspection ? 'details' : 'section';
  return (
    <>
      <div className="template-entry-pane">
        {readError && (
          <div className="ai-task-error" role="alert">
            <p>{readError}</p>
            <button disabled={checking} onClick={() => setReload((v) => v + 1)}>
              重新读取 AI 状态
            </button>
          </div>
        )}
        <div
          className={
            'template-entry-columns' +
            (aiResources.length ? '' : ' no-ai') +
            (inspection ? ' template-entry-inspection' : '')
          }
        >
          <section className="ai-task-card template-entry-input">
            {!inspection && <h2>{aiResources.length ? '本次输入' : '选择操作入口'}</h2>}
            {!inspection && !aiResources.length && entrySelector}
            {inspection && (
              <div
                className="template-entry-saved-configuration"
                role="group"
                aria-label="已保存共享配置"
              >
                {Object.entries((detail.configurationSchema as any).properties ?? {}).map(
                  ([key, schema]: [string, any]) => {
                    const value = (saved.instance.configuration as any)?.[key];
                    if (value === undefined) return null;
                    return (
                      <label className="template-field" key={key}>
                        <span>{schema.title ?? key}</span>
                        <input
                          readOnly
                          value={typeof value === 'string' ? value : JSON.stringify(value)}
                        />
                      </label>
                    );
                  },
                )}
                {dirtyConfiguration && (
                  <p>实例中仍有未保存更改；此处显示已保存内容，运行前须先保存。</p>
                )}
              </div>
            )}
            <fieldset
              ref={inputFields}
              disabled={busy || !!sourceError}
              className="template-entry-fields"
            >
              <Field
                schema={entry.input}
                value={entry.values}
                change={(values: any) =>
                  change({
                    ...detail,
                    entries: detail.entries.map((e) => (e.id === entryId ? { ...e, values } : e)),
                  })
                }
              />
            </fieldset>
            {!inspection && !!aiResources.length && entrySelector}
            {!!aiResources.length && (
              <p className="ai-task-note">进入设置不会运行此入口；返回后保留本页输入与所选入口。</p>
            )}
            <div className="template-entry-readiness" aria-label="入口准备情况" role="status">
              <span
                className={
                  'ai-config-status ' +
                  (sourceError || readError || (!reading && requirements.length)
                    ? 'warning'
                    : 'neutral')
                }
              >
                {readiness}
              </span>
              {!reading && requirements.length > 0 && (
                <ul>
                  {requirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              )}
              {(sourceError || readError) && <p>请先处理上方的读取问题，再核对并启动。</p>}
              {!inspection && !reading && !sourceError && !readError && !requirements.length && (
                <p>启动时仍会检查资源与权限；保存或返回本页不会自动运行。</p>
              )}
            </div>
            {inspection && (
              <p className="template-entry-inspection-note">
                显示当前已保存的共享配置；启动时仍会检查资源与权限。
              </p>
            )}
            {createdRun && (
              <div
                className="template-entry-created"
                role="status"
                tabIndex={-1}
                ref={createdRunNotice}
              >
                <strong>入口运行已创建 · {createdRun.id.slice(0, 8)}</strong>
                <p>详情尚未打开。继续查看会读取同一条运行，不会再次执行入口。</p>
              </div>
            )}
            <div className="ai-task-actions">
              {dirtyInput && (
                <button disabled={blocked} onClick={() => void saveInput()}>
                  保存入口参数
                </button>
              )}
              <button
                className="primary template-entry-run"
                disabled={createdRun ? busy : cannotStart}
                onClick={() =>
                  void (createdRun ? inspectRun(createdRun.id, createdRun.origin) : start(false))
                }
              >
                {createdRun ? '查看已创建运行' : '运行此入口'}
              </button>
              <button
                className="template-entry-debug"
                hidden={inspection}
                disabled={cannotStart}
                onClick={() => void start(true)}
              >
                逐步调试
              </button>
              <button
                className="template-entry-schedule"
                hidden={inspection}
                disabled={cannotStart || !entry.schedulable}
                title={!entry.schedulable ? '此入口不支持本机计划' : undefined}
                onClick={() => {
                  if (!hasInvalidInput()) schedule(origin());
                }}
              >
                创建本机计划
              </button>
              {inspection && (
                <button className="template-entry-return" disabled={busy} onClick={closeDetail}>
                  返回实例
                </button>
              )}
            </div>
          </section>
          <ResourceContainer className="ai-task-card template-entry-resources">
            {inspection ? (
              <summary>资源、动作与最近运行</summary>
            ) : (
              <h2>{aiResources.length ? 'AI 资源' : '本次执行'}</h2>
            )}
            <div className="template-execution-summary">
              <div>
                <span>资源</span>
                <p>
                  {entry.resources
                    .map((id) => detail.manifest.resources.find((r) => r.id === id)?.name ?? id)
                    .join('、') || '无需本机资源'}
                </p>
              </div>
              <div>
                <span>动作</span>
                <p>
                  {entry.actions
                    .map(
                      (id) =>
                        `${detail.manifest.actions.find((a) => a.id === id)?.name ?? id} · ${{ deny: '禁止', confirm: '每次确认', auto: '配置范围内自动' }[instance.grants[id] ?? 'deny']}`,
                    )
                    .join('、') || '未声明写入动作'}
                </p>
              </div>
              <p>本次输入、共享配置、绑定和包版本在启动时固定。</p>
              {!entry.schedulable && <small>此入口不支持本机计划。</small>}
            </div>
            {!aiResources.length && (
              <>
                <span className="ai-config-status neutral">此入口不需要 AI</span>
                <details className="template-entry-resource-help">
                  <summary>资源检查范围</summary>
                  <p>只核对当前入口声明的资源，其他入口的 AI 配置不会阻止本次操作。</p>
                </details>
              </>
            )}
            {aiResources.map((resource) => {
              const provider = selectedProvider(resource.id),
                state = configurations[provider];
              const binding = instance.resources[resource.id];
              const bound = binding?.provider === provider && !!binding.model;
              const test = state?.model === binding?.model ? state?.test : undefined;
              const tested = test?.status === 'passed';
              return (
                <div className="template-entry-ai-resource" key={resource.id}>
                  {aiResources.length > 1 && <h3>{resource.name}</h3>}
                  <span
                    className={`ai-config-status ${!state?.configured ? 'neutral' : tested ? 'success' : 'warning'}`}
                  >
                    {checking
                      ? '正在读取'
                      : readError
                        ? '状态未知'
                        : !state?.configured
                          ? '未配置'
                          : !bound
                            ? '已配置 · 尚未绑定'
                            : tested
                              ? '已配置 · 已验证'
                              : test?.status === 'failed'
                                ? '已配置 · 验证失败'
                                : test?.status === 'cancelled'
                                  ? '已配置 · 测试已取消'
                                  : test?.status === 'interrupted'
                                    ? '已配置 · 上次测试中断'
                                    : '已配置 · 待验证'}
                  </span>
                  <label className="ai-settings-field">
                    <span>供应商</span>
                    <select
                      aria-label={`${resource.name}供应商`}
                      disabled={busy || checking}
                      value={provider}
                      onChange={(e) =>
                        setChoices({ ...choices, [resource.id]: e.target.value as AIProviderId })
                      }
                    >
                      <option value="deepseek">DeepSeek</option>
                      <option value="openai-codex">OpenAI</option>
                    </select>
                  </label>
                  {state?.configured && (
                    <div className="ai-settings-field">
                      <span>Key 状态</span>
                      <p>已配置 · ••••••••{state.tail ? ` ${state.tail}` : ''}</p>
                    </div>
                  )}
                  {bound && (
                    <div className="ai-settings-field">
                      <span>入口模型</span>
                      <p>{binding.model}</p>
                    </div>
                  )}
                  <p>
                    {state?.configured
                      ? '配置已保存在本机。绑定模型并保存实例配置后，仍由你明确启动入口。'
                      : '当前入口声明需要 AI。到本地设置完成配置后，再回到这里。'}
                  </p>
                  <button
                    className="primary"
                    disabled={busy || checking || !!readError}
                    onClick={(event) => openSettings(resource.id, event.currentTarget)}
                  >
                    {state?.configured ? '管理 AI 配置' : `去配置 ${providerName(provider)}`}
                  </button>
                  {state?.configured && (!bound || binding.model !== state.model) && (
                    <button
                      disabled={blocked}
                      onClick={() =>
                        change({
                          ...detail,
                          instance: {
                            ...instance,
                            resources: {
                              ...instance.resources,
                              [resource.id]: { provider, model: state.model },
                            },
                          },
                        })
                      }
                    >
                      使用 {providerName(provider)} · {state.model}
                    </button>
                  )}
                </div>
              );
            })}
            {!!dirtyConfiguration && (
              <button disabled={blocked} onClick={() => void saveConfiguration()}>
                保存实例配置
              </button>
            )}
            {(missing.some((id) => !aiResources.some((r) => r.id === id)) || denied.length > 0) && (
              <button onClick={configure}>配置资源与动作授权</button>
            )}
            {!inspection && (
              <div className="template-entry-detail-links">
                <button
                  className="template-entry-open"
                  disabled={busy}
                  onClick={() => openDetail(entryId)}
                >
                  查看入口详情
                </button>
                {detail.entries
                  .filter((other) => other.id !== entryId)
                  .map((other) => (
                    <button key={other.id} disabled={busy} onClick={() => openDetail(other.id)}>
                      查看 {other.name}
                    </button>
                  ))}
              </div>
            )}
            <div className="template-recent-run" aria-label="最近入口运行">
              {latestLoading ? (
                <small>正在读取最近运行…</small>
              ) : latestError ? (
                <>
                  <p role="alert">{latestError}</p>
                  <button onClick={() => reloadLatest((v) => v + 1)}>重试最近运行</button>
                </>
              ) : latest ? (
                <>
                  <small>
                    {latest.id.slice(0, 8)} · {runDisplayLabels[latest.state]} ·{' '}
                    {new Date(latest.createdAt).toLocaleString('zh-CN')}
                  </small>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void inspectRun(
                        latest.id,
                        origin(),
                        ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(latest.state),
                      )
                    }
                  >
                    {['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(latest.state)
                      ? '查看上次入口结果'
                      : '查看最近入口运行'}
                  </button>
                </>
              ) : (
                <small>此入口还没有运行记录。</small>
              )}
            </div>
          </ResourceContainer>
        </div>
      </div>
    </>
  );
}
