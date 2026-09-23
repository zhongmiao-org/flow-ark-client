import { usePageBack } from './use-page-back';
import type { TemplateEntryOrigin } from './template-entry-navigation';
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Bootstrap } from '../shared/types';
import type { AISettingsEntry } from './AISettingsPage';
import { Field } from './TemplateConfiguration';
import TemplateEntry from './TemplateEntry';
import TemplateResources from './TemplateResources';
import {
  acceptTemplateSave,
  equal,
  templateDirty,
  templateFields,
  templateSaveRequest,
  type TemplateDetail,
  type TemplateSaveScope,
} from './template-draft';
import './template-instance.css';
export type TemplateNavigation = (next: () => void) => void;
type Tab = 'configuration' | 'resources' | 'entry' | 'source';
const tabs: [Tab, string][] = [
  ['configuration', '共享配置'],
  ['resources', '资源与动作授权'],
  ['entry', '操作入口'],
  ['source', '来源与版本'],
];
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
const message = (error: unknown) =>
  (error instanceof Error ? error.message : '操作未完成，请重试').replace(
    /^Error invoking remote method 'flowark:request': (?:Error: )?/,
    '',
  );
export default function TemplateInstancePage({
  initial,
  active,
  data,
  action,
  navigation,
  showRun,
  schedule,
  settings,
  close,
  choose,
}: {
  initial: TemplateDetail;
  active: boolean;
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  showRun: (detail: any, origin: TemplateEntryOrigin, output?: boolean) => void;
  schedule: (origin: TemplateEntryOrigin) => void;
  settings: (entry: AISettingsEntry) => void;
  close: () => void;
  choose: (id: string) => void;
}) {
  const [draft, setDraft] = useState(initial),
    [saved, setSaved] = useState(structuredClone(initial));
  const [tab, setTab] = useState<Tab>('configuration');
  const [entryId, setEntryId] = useState(initial.entries[0]?.id ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [checking, setChecking] = useState(true),
    [sourceError, setSourceError] = useState('');
  const [reload, setReload] = useState(0),
    [generation, setGeneration] = useState(0);
  const [configurationGeneration, setConfigurationGeneration] = useState(0);
  const [others, setOthers] = useState(false),
    [version, setVersion] = useState('');
  const [leaving, setLeaving] = useState<{ next: () => void }>();
  const lock = useRef(false),
    pending = useRef(false),
    root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    focus = useRef<HTMLElement | null>(null);
  const scrolls = useRef(new Map<string, number>());
  const instance = draft.instance;
  const rawInvalid = (scope: TemplateSaveScope = 'all', inputId?: string) => {
    const containers =
      scope === 'input'
        ? `[data-entry-id="${CSS.escape(inputId ?? '')}"]`
        : scope === 'configuration'
          ? '[data-instance-tab="configuration"]'
          : scope === 'resources'
            ? '[data-instance-tab="resources"]'
            : scope === 'instance'
              ? '[data-instance-tab="configuration"], [data-instance-tab="resources"]'
              : '[data-instance-tab]';
    return [...(root.current?.querySelectorAll(containers) ?? [])].some((element) =>
      element.querySelector('[data-value-invalid]'),
    );
  };
  useLayoutEffect(() => {
    if (!active) return;
    let live = true;
    setChecking(true);
    void api('template.detail', { id: saved.instance.id })
      .then((fresh: TemplateDetail) => {
        if (!live) return;
        if (
          fresh.instance.packageKey !== saved.instance.packageKey ||
          !equal(fresh.instance.entryFlows, saved.instance.entryFlows)
        )
          setSourceError('原实例或入口已变化。当前输入仍保留，不会自动打开另一个入口。');
        else if (fresh.revision !== saved.revision)
          setSourceError('原实例的已保存内容已变化。当前输入仍保留，请核对后重新读取。');
        else setSourceError('');
      })
      .catch(() => {
        if (live) setSourceError('暂时无法读取原实例或入口。当前输入仍保留，请重试或返回模板库。');
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [active, saved.instance.id, saved.revision, reload]);
  const work = async (fn: () => Promise<any>, notice?: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      return await action(async () => {
        try {
          return await fn();
        } catch (error) {
          setError(message(error));
          if (/实例已变化|实例不存在|原入口流程/.test(message(error)))
            setSourceError('原实例的已保存内容已变化。当前输入仍保留，请核对后重新读取。');
          throw error;
        }
      }, notice);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const save = async (scope: TemplateSaveScope, inputId?: string) => {
    if (lock.current || checking || sourceError) return false;
    if (rawInvalid(scope, inputId)) {
      setError('请先修正未完成的字段值，其他草稿仍保留。');
      return false;
    }
    const submitted = structuredClone(draft),
      request = templateSaveRequest(submitted, saved, scope, inputId);
    const next: TemplateDetail | undefined = await work(
      () =>
        api('template.save', request).catch((error) => {
          if (/实例已变化|实例不存在|原入口流程/.test(message(error)))
            setSourceError('原实例的已保存内容已变化。当前输入仍保留，请核对后重新读取。');
          throw error;
        }),
      scope === 'input' ? '入口参数已保存' : '实例配置已保存',
    );
    if (!next) return false;
    setSaved(structuredClone(next));
    setDraft((current) => acceptTemplateSave(current, submitted, next, request, scope));
    return true;
  };
  const go: TemplateNavigation = (next) => {
    if (lock.current || pending.current) return;
    if (templateDirty(draft, saved) || rawInvalid()) {
      if (!focus.current?.offsetParent) focus.current = document.activeElement as HTMLElement;
      pending.current = true;
      setError('');
      setLeaving({ next });
    } else next();
  };
  navigation.current = (next) =>
    go(() => {
      close();
      next();
    });
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
  usePageBack(() => go(close), active);
  const switchTab = (next: Tab) => {
    if (lock.current) return;
    scrolls.current.set(tab, document.querySelector('main')?.scrollTop ?? 0);
    setTab(next);
    setError('');
    requestAnimationFrame(() =>
      document.querySelector('main')?.scrollTo({ top: scrolls.current.get(next) ?? 0 }),
    );
  };
  const reset = (scope: TemplateSaveScope) => {
    if (lock.current) return;
    setDraft((current) => {
      const instance = { ...current.instance };
      for (const field of templateFields(scope))
        (instance as any)[field] = structuredClone(saved.instance[field]);
      return { ...current, instance };
    });
    if (scope === 'configuration') setConfigurationGeneration((v) => v + 1);
    setError('');
  };
  const openAI = (resourceId: string) => {
    const resource = instance.resources[resourceId];
    const provider = resource?.provider === 'openai-codex' ? 'openai-codex' : 'deepseek';
    settings({
      key: crypto.randomUUID(),
      provider,
      model: resource?.model || (provider === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex'),
      source: {
        kind: 'template',
        instanceId: instance.id,
        entryId,
        packageKey: instance.packageKey,
        view: 'resources',
        title: `${instance.name} · ${instance.id.slice(0, 8)} / 资源与动作授权`,
      },
    });
  };
  const blocked = busy || checking || !!sourceError;
  const alternatives = data.templates.filter(
    (p) => p.manifest.id === draft.manifest.id && p.key !== instance.packageKey,
  );
  return (
    <div
      ref={root}
      className="template-instance-host"
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest('input, textarea, select, [contenteditable="true"]') &&
          !target.closest('dialog')
        )
          focus.current = target;
      }}
    >
      <header className="topbar">
        <button className="context-back" disabled={busy} onClick={() => go(close)}>
          ← 返回模板库
        </button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#templates"
            onClick={(event) => {
              event.preventDefault();
              go(close);
            }}
          >
            模板库
          </a>
          <span aria-hidden="true">/</span>
          <span className="ai-source-title" title={`${instance.name} · ${instance.id}`}>
            {instance.name} · {instance.id.slice(0, 8)}
          </span>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{tabs.find(([id]) => id === tab)![1]}</span>
        </nav>
      </header>
      <section className="page ai-task-page template-instance-page template-entry-page">
        <div className="page-heading">
          <div>
            <h1>{instance.name}</h1>
            <p>
              实例 {instance.id.slice(0, 8)} · 固定包 v{draft.manifest.version} ·
              共享配置修改不影响已开始的运行
            </p>
          </div>
        </div>
        <nav className="ai-settings-tabs" aria-label="实例分类">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              disabled={busy}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => switchTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {sourceError && (
          <div className="ai-task-error template-source-error" role="alert">
            <p>{sourceError}</p>
            <div className="ai-task-actions">
              <button disabled={busy || checking} onClick={() => setReload((v) => v + 1)}>
                重新读取状态
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    const fresh: TemplateDetail = await api('template.detail', { id: instance.id });
                    setSaved(structuredClone(fresh));
                    setDraft(fresh);
                    setSourceError('');
                    setGeneration((v) => v + 1);
                    if (!fresh.entries.some((entry) => entry.id === entryId))
                      setEntryId(fresh.entries[0]?.id ?? '');
                    return true;
                  })
                }
              >
                放弃未保存内容并重新读取实例
              </button>
              <button onClick={() => go(close)}>返回模板库</button>
            </div>
          </div>
        )}
        {error && !leaving && (
          <p className="ai-task-error" role="alert">
            {error}
          </p>
        )}
        <div data-instance-tab="configuration" hidden={tab !== 'configuration'}>
          <div className="template-instance-columns">
            <section className="ai-task-card template-instance-form">
              <h2>共享配置</h2>
              <fieldset
                disabled={busy}
                className="template-entry-fields"
                key={'config-' + generation + ':' + configurationGeneration}
              >
                <label className="template-field">
                  <span>实例名称</span>
                  <input
                    value={instance.name}
                    maxLength={100}
                    onChange={(event) =>
                      setDraft({ ...draft, instance: { ...instance, name: event.target.value } })
                    }
                  />
                </label>
                <Field
                  schema={draft.configurationSchema}
                  value={instance.configuration}
                  change={(configuration: unknown) =>
                    setDraft({ ...draft, instance: { ...instance, configuration } })
                  }
                />
              </fieldset>
              <p className="ai-task-note">字段由模板提供；打开表单不会执行模板代码。</p>
              <div className="ai-task-actions">
                <button
                  className="primary"
                  disabled={blocked}
                  onClick={() => void save('configuration')}
                >
                  保存配置
                </button>
                <button disabled={busy} onClick={() => reset('configuration')}>
                  取消更改
                </button>
              </div>
            </section>
            <aside className="ai-task-card template-instance-guide">
              <h2>实例与入口</h2>
              <p>共享配置适用于本实例所有入口；每次运行仍有独立的入口输入。</p>
              <p>另一个实例保留自己的配置、状态、资源和授权。</p>
              <button disabled={busy} onClick={() => setOthers((value) => !value)}>
                查看其他实例
              </button>
              {others && (
                <div className="template-other-instances">
                  {data.instances
                    .filter((other) => other.id !== instance.id)
                    .map((other) => (
                      <button
                        key={other.id}
                        disabled={busy}
                        onClick={() => go(() => choose(other.id))}
                      >
                        {other.name} · {other.id.slice(0, 8)}
                      </button>
                    ))}
                  {data.instances.every((other) => other.id === instance.id) && (
                    <p>尚无其他实例。</p>
                  )}
                </div>
              )}
            </aside>
          </div>
        </div>
        <div data-instance-tab="resources" hidden={tab !== 'resources'}>
          <TemplateResources
            detail={draft}
            data={data}
            busy={busy}
            blocked={blocked}
            change={setDraft}
            work={work}
            openAI={openAI}
            save={() => void save('resources')}
            cancel={() => reset('resources')}
            openEntry={(id) => {
              setEntryId(id);
              switchTab('entry');
            }}
          />
        </div>
        <div data-instance-tab="entry" hidden={tab !== 'entry'}>
          {draft.entries.map((entry) => (
            <div
              key={entry.id + ':' + generation}
              data-entry-id={entry.id}
              hidden={entryId !== entry.id}
            >
              <TemplateEntry
                active={active && tab === 'entry' && entryId === entry.id}
                detail={draft}
                saved={saved}
                entryId={entry.id}
                selectEntry={setEntryId}
                showRun={showRun}
                schedule={schedule}
                savedAt={
                  data.flows.find((flow) => flow.id === instance.entryFlows[entry.id])?.updatedAt ??
                  ''
                }
                change={setDraft}
                save={save}
                work={work}
                busy={busy}
                sourceError={sourceError}
                sourceChecking={checking}
                configure={() => switchTab('resources')}
                settings={settings}
              />
            </div>
          ))}
        </div>
        <div data-instance-tab="source" hidden={tab !== 'source'}>
          <div className="template-instance-columns">
            <section className="ai-task-card template-instance-form">
              <h2>来源与版本</h2>
              <dl className="template-source-details">
                <dt>模板</dt>
                <dd>{draft.manifest.name}</dd>
                <dt>固定版本</dt>
                <dd>{draft.manifest.version}</dd>
                <dt>来源声明</dt>
                <dd>{draft.manifest.source}</dd>
                <dt>作者声明</dt>
                <dd>{draft.manifest.author}</dd>
                <dt>实例</dt>
                <dd>{instance.id}</dd>
                <dt>内容摘要</dt>
                <dd>{draft.manifest.contentDigest}</dd>
              </dl>
              <h3>采用模板新版</h3>
              <p>创建独立实例，复制符合新模板字段规则的已保存普通配置，资源和权限重新核对。</p>
              {alternatives.length ? (
                <label className="ai-settings-field">
                  已安装的其他版本
                  <select
                    aria-label="采用模板版本"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                  >
                    <option value="">选择版本</option>
                    {alternatives.map((item) => (
                      <option key={item.key} value={item.key}>
                        v{item.manifest.version}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p>本机尚未安装其他版本。</p>
              )}
              <button
                className="primary"
                disabled={blocked || !version}
                onClick={() =>
                  go(
                    () =>
                      void work(async () => {
                        const created = await api('template.create', {
                          key: version,
                          copyFrom: instance.id,
                        });
                        choose(created.id);
                        return created;
                      }),
                  )
                }
              >
                创建新版实例
              </button>
            </section>
            <aside className="ai-task-card template-instance-guide">
              <h2>导出原模板定义</h2>
              <p>保留原版本与身份；不包含配置值、密钥、本机路径或历史。</p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void work(() => api('template.export', { key: instance.packageKey }))
                }
              >
                导出 ZIP
              </button>
              <h3>原实例保持原样</h3>
              <p>新旧版本并存。模板更新不会覆盖本实例、计划或正在运行的快照。</p>
              <span className="ai-config-status warning">该版本仍被引用</span>
              <p>当前实例正在引用此包，不能卸载。</p>
            </aside>
          </div>
        </div>
      </section>
      {leaving && (
        <dialog
          ref={dialog}
          className="script-leave-dialog ai-settings-dialog"
          aria-labelledby="template-leave-title"
          onCancel={(event) => {
            event.preventDefault();
            stay();
          }}
        >
          <h2 id="template-leave-title">保存实例更改再离开？</h2>
          <p>共享配置、资源授权和各入口输入将在一次保存成功后一起保留，再前往刚才选择的位置。</p>
          <div className="ai-task-actions">
            <button autoFocus disabled={busy} onClick={stay}>
              继续编辑
            </button>
            <button
              className="primary"
              disabled={blocked}
              onClick={() => {
                const next = leaving.next;
                void save('all').then((ok) => {
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
                setDraft(structuredClone(saved));
                setGeneration((v) => v + 1);
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
