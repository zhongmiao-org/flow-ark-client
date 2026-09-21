import { useLayoutEffect, useRef, useState } from 'react';
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
  detail,
  saved,
  entryId,
  selectEntry,
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
  detail: TemplateDetail;
  saved: TemplateDetail;
  entryId: string;
  selectEntry: (entryId: string) => void;
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
  const inputFields = useRef<HTMLFieldSetElement>(null);
  const [invalidInput, setInvalidInput] = useState(false);
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
    if (active && !checking) document.querySelector('main')?.scrollTo({ top: scroll.current });
  }, [active, checking]);
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
    return declaration.kind === 'browser' ? !binding.browserId : !binding.path;
  });
  const denied = entry.actions.filter(
    (id) => !instance.grants[id] || instance.grants[id] === 'deny',
  );
  const saveInput = () => save('input', entryId);
  const saveConfiguration = () => save('instance');
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
  const blocked = busy || checking || sourceChecking || !!sourceError;
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
        <div className="template-entry-columns">
          <section className="ai-task-card template-entry-input">
            <h2>本次输入</h2>
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
                onClick={() => {
                  if (hasInvalidInput()) return;
                  void work(
                    () => api('flow.run', { id: instance.entryFlows[entryId] }),
                    '任务已创建',
                  );
                }}
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
      </div>
    </>
  );
}
