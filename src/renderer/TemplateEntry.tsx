import { useLayoutEffect, useRef, useState } from 'react';
import type { Templates } from '../templates/service';
import type { AIConfigurationState, AIProviderId } from '../shared/ai-settings';
import type { AISettingsEntry } from './AISettingsPage';
import { Field } from './TemplateConfiguration';
import './template-entry.css';

export type TemplateDetail = Awaited<ReturnType<Templates['detail']>>;
const api = (method: string, args: unknown): Promise<any> => window.flowark.request(method, args);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const providerName = (provider: AIProviderId) => (provider === 'deepseek' ? 'DeepSeek' : 'OpenAI');
const defaultModel = (provider: AIProviderId) =>
  provider === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex';

export default function TemplateEntry({
  active,
  detail,
  saved,
  entryId,
  change,
  savedChange,
  work,
  busy,
  back,
  configure,
  settings,
}: {
  active: boolean;
  detail: TemplateDetail;
  saved: TemplateDetail;
  entryId: string;
  change: (detail: TemplateDetail) => void;
  savedChange: (detail: TemplateDetail) => void;
  work: (fn: () => Promise<any>, message?: string) => Promise<any>;
  busy: boolean;
  back: () => void;
  configure: () => void;
  settings: (entry: AISettingsEntry) => void;
}) {
  const entry = detail.entries.find((e) => e.id === entryId)!;
  const instance = detail.instance;
  const [configurations, setConfigurations] = useState<
    Partial<Record<AIProviderId, AIConfigurationState>>
  >({});
  const [checking, setChecking] = useState(true),
    [sourceError, setSourceError] = useState('');
  const [readError, setReadError] = useState(''),
    [reload, setReload] = useState(0);
  const [choices, setChoices] = useState<Record<string, AIProviderId>>({});
  const scroll = useRef(0);
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
    setChecking(true);
    setSourceError('');
    setReadError('');
    setConfigurations({});
    const source = api('template.detail', { id: instance.id })
      .then((fresh: TemplateDetail) => {
        if (!live) return;
        if (
          fresh.instance.packageKey !== instance.packageKey ||
          fresh.instance.entryFlows[entryId] !== instance.entryFlows[entryId] ||
          !fresh.entries.some((e) => e.id === entryId)
        ) {
          setSourceError('原实例或入口已变化。当前输入仍保留，不会自动打开另一个入口。');
        } else if (
          !equal(fresh.instance, saved.instance) ||
          !equal(
            fresh.entries.map((e) => [e.id, e.values]),
            saved.entries.map((e) => [e.id, e.values]),
          )
        ) {
          setSourceError('原实例的已保存内容已变化。当前输入仍保留，请核对后重新读取。');
        }
      })
      .catch(() => {
        if (live) setSourceError('暂时无法读取原实例或入口。当前输入仍保留，请重试或返回模板库。');
      });
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
    void Promise.all([source, resources]).finally(() => {
      if (live) {
        setChecking(false);
        document.querySelector('main')?.scrollTo({ top: scroll.current });
      }
    });
    return () => {
      live = false;
    };
  }, [active, instance.id, entryId, providers, reload]);
  const dirtyInput = !equal(entry.values, saved.entries.find((e) => e.id === entryId)?.values);
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
    return declaration.kind === 'browser' ? !binding.browserId : !binding.path;
  });
  const denied = entry.actions.filter(
    (id) => !instance.grants[id] || instance.grants[id] === 'deny',
  );
  const saveInput = async () => {
    const values = structuredClone(entry.values);
    if (
      await work(
        () => api('template.input', { id: instance.id, entryId, value: values }),
        '入口参数已保存',
      )
    )
      savedChange({
        ...saved,
        entries: saved.entries.map((e) => (e.id === entryId ? { ...e, values } : e)),
      });
  };
  const saveConfiguration = async () => {
    const next = await work(
      () =>
        api('template.configure', {
          id: instance.id,
          configuration: instance.configuration,
          resources: instance.resources,
          grants: instance.grants,
        }),
      '实例配置已保存',
    );
    if (next) savedChange({ ...saved, instance: structuredClone(next) });
  };
  const openSettings = (resourceId: string) => {
    scroll.current = document.querySelector('main')?.scrollTop ?? 0;
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
      },
    });
  };
  const blocked = busy || checking || !!sourceError;
  return (
    <>
      <header className="topbar">
        <button className="context-back" onClick={back}>
          ← 返回模板库
        </button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#templates"
            onClick={(e) => {
              e.preventDefault();
              back();
            }}
          >
            模板库
          </a>
          <span aria-hidden="true">/</span>
          <span
            className="ai-source-title"
            title={`${instance.name} · ${instance.id} · ${entry.name}`}
            aria-current="page"
          >
            {instance.name} · {instance.id.slice(0, 8)} · {entry.name}
          </span>
        </nav>
      </header>
      <section className="page ai-task-page template-entry-page">
        <div className="page-heading">
          <div>
            <h1>
              {instance.name} · {instance.id.slice(0, 8)}
            </h1>
            <p>
              {entry.name}入口 · {detail.manifest.description}
            </p>
          </div>
        </div>
        <nav className="ai-settings-tabs" aria-label="实例分类">
          <button onClick={configure}>共享配置</button>
          <button onClick={configure}>资源与动作授权</button>
          <span aria-current="page">操作入口</span>
        </nav>
        {(sourceError || readError) && (
          <div className="ai-task-error" role="alert">
            <p>{sourceError || readError}</p>
            <button disabled={checking} onClick={() => setReload((v) => v + 1)}>
              重新读取状态
            </button>
            {sourceError && (
              <button
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    const fresh = await api('template.detail', { id: instance.id });
                    change(fresh);
                    savedChange(structuredClone(fresh));
                    configure();
                  })
                }
              >
                放弃未保存内容并重新读取实例
              </button>
            )}
            <button onClick={back}>返回模板库</button>
            {aiResources.length > 0 && (
              <button onClick={() => openSettings(aiResources[0].id)}>留在 AI 设置</button>
            )}
          </div>
        )}
        <div className="template-entry-columns">
          <section className="ai-task-card template-entry-input">
            <h2>本次输入</h2>
            <fieldset disabled={busy || !!sourceError} className="template-entry-fields">
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
            <div className="ai-settings-field">
              <span>操作入口</span>
              <p>{entry.name}</p>
            </div>
            <p className="ai-task-note">进入设置不会运行此入口；返回后保留本页输入与所选入口。</p>
            <div className="ai-task-actions">
              <button disabled={blocked || !dirtyInput} onClick={() => void saveInput()}>
                保存入口参数
              </button>
              <button
                className="primary"
                disabled={
                  blocked ||
                  !!readError ||
                  dirtyInput ||
                  dirtyConfiguration ||
                  !!missing.length ||
                  !!denied.length ||
                  !!entry.unavailable.length
                }
                onClick={() =>
                  void work(
                    () => api('flow.run', { id: instance.entryFlows[entryId] }),
                    '任务已创建',
                  )
                }
              >
                运行此入口
              </button>
            </div>
            <small>
              {checking
                ? '正在核对原实例与资源…'
                : dirtyInput || dirtyConfiguration
                  ? '请先保存本次输入和实例配置；运行使用已保存内容。'
                  : missing.length
                    ? '请先完成当前入口所需的资源配置。'
                    : denied.length
                      ? '当前入口的动作尚未授权。'
                      : entry.unavailable.length
                        ? `缺少能力：${entry.unavailable.join('、')}`
                        : '由你明确启动。保存配置或返回本页不会自动运行。'}
            </small>
          </section>
          <section className="ai-task-card template-entry-resources">
            <h2>{aiResources.length ? 'AI 资源' : '入口资源'}</h2>
            {!aiResources.length && (
              <>
                <span className="ai-config-status neutral">此入口不需要 AI</span>
                <p>只核对当前入口声明的资源，其他入口的 AI 配置不会阻止本次操作。</p>
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
                    onClick={() => openSettings(resource.id)}
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
          </section>
        </div>
      </section>
    </>
  );
}
