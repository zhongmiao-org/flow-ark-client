import { recordTime } from './readable-labels';
import TechnicalDetails from './TechnicalDetails';
import { saveTemplateResultDraft } from './result-save-recovery';
import {
  Card,
  ConfigProvider,
  Descriptions,
  Select,
  Button,
  Input,
  Modal,
  Flex,
  Tag,
  Badge,
  Alert,
  Tabs,
} from 'antd';
import { usePageBack } from './use-page-back';
import type { TemplateEntryOrigin } from './template-entry-navigation';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { Bootstrap } from '../shared/types';
import type { InstalledPackage } from '../templates/archive';
import type { AISettingsEntry } from './AISettingsPage';
import { Field } from './TemplateConfiguration';
import ActionButton from './ActionButton';
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
export type TemplateNavigation = (next: () => void, destination?: string) => void;
export type TemplateAdoptionOrigin = { id: string; version: string };
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
  returnLabel,
  exportTemplate,
  home,
  close,
  choose,
  adoptedFrom,
  browserControl,
  initialEntryId,
  initialTab,
  returnToSource,
}: {
  initial: TemplateDetail;
  active: boolean;
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  showRun: (detail: any, origin: TemplateEntryOrigin, output?: boolean) => void;
  schedule: (origin: TemplateEntryOrigin) => void;
  settings: (entry: AISettingsEntry) => void;
  returnLabel: string;
  exportTemplate: (pkg: InstalledPackage, returnLabel?: string) => void;
  home: () => void;
  close: () => void;
  choose: (id: string, adoptedFrom?: TemplateAdoptionOrigin) => Promise<boolean>;
  adoptedFrom?: TemplateAdoptionOrigin;
  browserControl?: ReactNode;
  initialEntryId?: string;
  initialTab?: 'resources' | 'entry';
  returnToSource?: () => void;
}) {
  const [draft, setDraft] = useState(initial),
    [saved, setSaved] = useState(structuredClone(initial));
  const [tab, setTab] = useState<Tab>(initialTab ?? (initialEntryId ? 'entry' : 'configuration'));
  const [entryId, setEntryId] = useState(initialEntryId ?? initial.entries[0]?.id ?? '');
  const [entryDetail, setEntryDetail] = useState(false);
  const entryHeading = useRef<HTMLHeadingElement>(null);
  const adoptionHeading = useRef<HTMLHeadingElement>(null);
  const entered = useRef(false);
  useLayoutEffect(() => {
    if (!active || entered.current) return;
    entered.current = true;
    document.querySelector('main')?.scrollTo({ top: 0 });
    (adoptedFrom ? adoptionHeading.current : entryHeading.current)?.focus({ preventScroll: true });
  }, [active, adoptedFrom]);
  useLayoutEffect(() => {
    if (entryDetail) {
      document.querySelector('main')?.scrollTo({ top: 0 });
      entryHeading.current?.focus({ preventScroll: true });
    }
  }, [entryDetail, entryId]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [checking, setChecking] = useState(true),
    [sourceError, setSourceError] = useState('');
  const [reload, setReload] = useState(0),
    [generation, setGeneration] = useState(0);
  const [configurationGeneration, setConfigurationGeneration] = useState(0);
  const configurationError = useRef<HTMLDivElement>(null);
  const focusConfigurationError = useRef(false);
  const resourceError = useRef<HTMLDivElement>(null);
  const focusResourceError = useRef(false);
  const [savedControl, setSavedControl] = useState<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (!savedControl) return;
    if (!active) {
      setSavedControl(null);
      return;
    }
    if (busy || checking) return;
    // Saving starts a source refresh in a later layout effect. Defer focus until
    // that commit settles; cleanup cancels this frame while controls are disabled.
    const frame = requestAnimationFrame(() => {
      if (
        savedControl.isConnected &&
        !savedControl.matches(':disabled') &&
        !savedControl.closest('[hidden]') &&
        document.activeElement === document.body
      ) {
        savedControl.focus({ preventScroll: true });
        savedControl.scrollIntoView({ block: 'nearest' });
      }
      setSavedControl(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, busy, checking, savedControl]);
  const [others, setOthers] = useState(false),
    [version, setVersion] = useState('');
  const [createdVersion, setCreatedVersion] = useState<{ id: string; version: string }>();
  const [adopting, setAdopting] = useState(false);
  const [leaving, setLeaving] = useState<{ next: () => void; destination: string }>();
  const lock = useRef(false),
    pending = useRef(false),
    root = useRef<HTMLDivElement>(null);
  const dialogHeading = useRef<HTMLHeadingElement>(null),
    continueButton = useRef<HTMLButtonElement>(null);
  const focus = useRef<HTMLElement | null>(null);
  const invalidField = useRef<HTMLElement | null>(null);
  const scrolls = useRef(new Map<string, number>());
  const contentDestination = useRef<Tab | null>(null);
  useLayoutEffect(() => {
    if (!active || entryDetail || contentDestination.current !== tab) return;
    const frame = requestAnimationFrame(() => {
      const panel = root.current?.querySelector<HTMLElement>(`[data-instance-tab="${tab}"]`);
      const heading = panel
        ? [...panel.querySelectorAll<HTMLElement>('[data-navigation-heading]')].find(
            (element) => !element.closest('[hidden]'),
          )
        : undefined;
      if (!heading) return;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start' });
      contentDestination.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [active, entryDetail, entryId, tab]);
  const aiReturn = useRef<{ trigger: HTMLButtonElement; scroll: number } | null>(null);
  const loadingSource = useRef(false);
  const instance = draft.instance;
  const nameError = !instance.name.trim()
    ? '请填写实例名称。'
    : instance.name.length > 100
      ? '实例名称最多 100 个字符。'
      : '';
  useLayoutEffect(() => {
    if (!busy && error && !leaving && tab === 'configuration' && focusConfigurationError.current) {
      configurationError.current?.focus();
      focusConfigurationError.current = false;
    }
  }, [busy, error, leaving, tab]);
  useLayoutEffect(() => {
    if (busy || !focusResourceError.current) return;
    focusResourceError.current = false;
    if (active && error && !leaving && tab !== 'configuration') resourceError.current?.focus();
  }, [active, busy, error, leaving, tab]);
  useLayoutEffect(() => {
    if (!active || busy || !error || leaving || tab !== 'configuration') return;
    const target = configurationError.current;
    const main = document.querySelector('main');
    if (!target || !main || !root.current) return;
    const ensureVisible = () => {
      if (document.activeElement !== target) return;
      const bounds = target.getBoundingClientRect();
      const visible = main.getBoundingClientRect();
      if (bounds.top < visible.top || bounds.bottom > visible.bottom)
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
    };
    ensureVisible();
    const observer = new ResizeObserver(ensureVisible);
    observer.observe(main);
    observer.observe(root.current);
    observer.observe(target);
    return () => observer.disconnect();
  }, [active, busy, error, leaving, tab]);
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
              : '[data-instance-tab="configuration"], [data-instance-tab="resources"], [data-entry-id]';
    const inputs = scope === 'all' ? templateSaveRequest(draft, saved, scope).inputs : {};
    return [...(root.current?.querySelectorAll(containers) ?? [])]
      .filter(
        (element) =>
          scope !== 'all' ||
          !element.hasAttribute('data-entry-id') ||
          Object.hasOwn(inputs, element.getAttribute('data-entry-id')!) ||
          element.querySelector('[data-value-incomplete]'),
      )
      .map((element) => element.querySelector<HTMLElement>('[data-value-invalid]'))
      .find((element) => element);
  };
  useLayoutEffect(() => {
    if (!active) return;
    let live = true;
    loadingSource.current = true;
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
        if (live) {
          loadingSource.current = false;
          setChecking(false);
        }
      });
    return () => {
      live = false;
    };
  }, [active, saved.instance.id, saved.revision, reload]);
  useLayoutEffect(() => {
    if (!active || checking || loadingSource.current || !aiReturn.current) return;
    const { trigger, scroll } = aiReturn.current;
    document.querySelector('main')?.scrollTo({ top: scroll });
    if (trigger.isConnected && !trigger.matches(':disabled'))
      trigger.focus({ preventScroll: true });
    aiReturn.current = null;
  }, [active, checking]);
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
          focusConfigurationError.current = tab === 'configuration';
          focusResourceError.current = tab !== 'configuration';
          setError(message(error));
          if (/实例已变化|实例不存在|原入口流程|结果绑定保存未取得/.test(message(error)))
            setSourceError('原实例的已保存内容已变化。当前输入仍保留，请核对后重新读取。');
          throw error;
        }
      }, notice);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const save = async (
    scope: TemplateSaveScope,
    inputId?: string,
    saveControl: HTMLButtonElement | null = null,
  ) => {
    if (lock.current || checking || sourceError) return false;
    const invalid = rawInvalid(scope, inputId);
    invalidField.current = invalid ?? null;
    if (invalid) {
      const invalidEntry = invalid.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
      const invalidTab = invalid.closest<HTMLElement>('[data-instance-tab]')?.dataset.instanceTab;
      const location = invalidEntry
        ? draft.entries.find((entry) => entry.id === invalidEntry)?.name
        : tabs.find(([id]) => id === invalidTab)?.[1];
      setError(`请先修正${location ? `“${location}”中` : ''}未完成的字段值，其他草稿仍保留。`);
      if (!leaving && !invalid.closest('[hidden]')) {
        const control = invalid.matches('input, select, textarea, button')
          ? invalid
          : invalid.querySelector<HTMLElement>('input, select, textarea, button');
        control?.focus();
      }
      return false;
    }
    const submitted = structuredClone(draft),
      request = templateSaveRequest(submitted, saved, scope, inputId);
    focusConfigurationError.current = scope === 'configuration';
    const next: TemplateDetail | undefined = await work(
      () =>
        saveTemplateResultDraft(request, saved).catch((error) => {
          if (/实例已变化|实例不存在|原入口流程|结果绑定保存未取得/.test(message(error)))
            setSourceError('原实例的已保存内容已变化。当前输入仍保留，请核对后重新读取。');
          throw error;
        }),
      scope === 'input'
        ? `已保存“${submitted.entries.find((entry) => entry.id === inputId)?.name ?? '当前入口'}”的参数`
        : '实例配置已保存',
    );
    if (!next) return false;
    focusConfigurationError.current = false;
    setSaved(structuredClone(next));
    setDraft((current) => acceptTemplateSave(current, submitted, next, request, scope));
    setSavedControl(saveControl);
    return true;
  };
  const go: TemplateNavigation = (next, destination = returnLabel) => {
    if (lock.current || pending.current) return;
    if (templateDirty(draft, saved) || root.current?.querySelector('[data-value-incomplete]')) {
      if (!focus.current?.offsetParent) focus.current = document.activeElement as HTMLElement;
      pending.current = true;
      invalidField.current = null;
      setError('');
      setLeaving({ next, destination });
    } else next();
  };
  navigation.current = (next, destination) =>
    go(() => {
      close();
      next();
    }, destination);
  const stay = () => {
    if (lock.current) return;
    const invalid = invalidField.current;
    invalidField.current = null;
    const repair = invalid?.isConnected && invalid.hasAttribute('data-value-invalid');
    if (repair) {
      const invalidTab = invalid.closest<HTMLElement>('[data-instance-tab]')?.dataset.instanceTab;
      const invalidEntry = invalid.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
      if (tabs.some(([id]) => id === invalidTab)) setTab(invalidTab as Tab);
      if (invalidEntry) setEntryId(invalidEntry);
      setEntryDetail(false);
    }
    pending.current = false;
    setLeaving(undefined);
    requestAnimationFrame(() => {
      if (repair) {
        const control = invalid.matches('input, select, textarea, button')
          ? invalid
          : invalid.querySelector<HTMLElement>('input, select, textarea, button');
        control?.focus();
      } else focus.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (leaving && (error || sourceError)) dialogHeading.current?.focus();
  }, [leaving, error, sourceError]);
  const back = () => {
    if (lock.current) return;
    if (entryDetail) {
      setEntryDetail(false);
      requestAnimationFrame(() => {
        root.current
          ?.querySelector<HTMLElement>(
            `[data-entry-id="${CSS.escape(entryId)}"] .template-entry-open`,
          )
          ?.focus();
      });
    } else go(returnToSource ?? close);
  };
  usePageBack(back, active);
  const switchTab = (next: Tab, focusContent = false) => {
    if (lock.current) return;
    contentDestination.current = focusContent ? next : null;
    setEntryDetail(false);
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
      return {
        ...current,
        instance,
        directoryDraft: templateFields(scope).includes('resources')
          ? undefined
          : current.directoryDraft,
      };
    });
    if (scope === 'configuration') setConfigurationGeneration((v) => v + 1);
    setError('');
  };
  const openAI = (resourceId: string, trigger: HTMLButtonElement) => {
    aiReturn.current = { trigger, scroll: document.querySelector('main')?.scrollTop ?? 0 };
    const resource = instance.resources[resourceId];
    const provider = resource?.provider === 'openai-codex' ? 'openai-codex' : 'deepseek';
    settings({
      key: crypto.randomUUID(),
      provider,
      model: resource?.model || (provider === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex'),
      source: {
        kind: 'template',
        returnLabel: `${instance.name} · 资源与动作授权`,
        instanceId: instance.id,
        entryId,
        packageKey: instance.packageKey,
        entryFlowId: instance.entryFlows[entryId],
        view: 'resources',
        title: `${instance.name} / 资源与动作授权`,
      },
    });
  };
  const blocked = busy || checking || !!sourceError;
  const originalPackage = data.templates.find((pkg) => pkg.key === instance.packageKey);
  const alternatives = data.templates.filter(
    (p) => p.manifest.id === draft.manifest.id && p.key !== instance.packageKey,
  );
  const selectedVersion = alternatives.find((pkg) => pkg.key === version);
  const adoptVersion = () => {
    if (blocked || (!createdVersion && !selectedVersion)) return;
    const target = selectedVersion;
    go(
      () => {
        setAdopting(true);
        void work(async () => {
          let created = createdVersion;
          if (!created && target) {
            const next = await api('template.create', { key: target.key, copyFrom: instance.id });
            created = { id: next.id, version: target.manifest.version };
            setCreatedVersion(created);
          }
          if (
            created &&
            !(await choose(created.id, { id: instance.id, version: draft.manifest.version }))
          )
            throw new Error('实例已创建，但暂时无法打开。请重试打开已创建实例，无需再次创建。');
        }).finally(() => setAdopting(false));
      },
      createdVersion
        ? `已创建实例 · v${createdVersion.version}`
        : `新版实例 · v${target?.manifest.version}`,
    );
  };
  const instancePanels: Record<Tab, ReactNode> = {
    configuration: (
      <div data-instance-tab="configuration" hidden={tab !== 'configuration'}>
        <div className="template-instance-columns">
          <section aria-busy={busy}>
            <Card
              className="template-instance-form template-shared-configuration"
              styles={{ body: { padding: 28 } }}
            >
              <h2>共享配置</h2>
              <ConfigProvider
                componentDisabled={busy}
                key={'config-' + generation + ':' + configurationGeneration}
              >
                <fieldset disabled={busy} className="template-entry-fields">
                  <label className="template-field">
                    <span>实例名称</span>
                    <Input
                      status={!!nameError ? 'error' : undefined}
                      value={instance.name}
                      maxLength={100}
                      aria-label="实例名称"
                      aria-required="true"
                      aria-invalid={!!nameError}
                      aria-describedby={nameError ? 'template-instance-name-error' : undefined}
                      data-value-invalid={!!nameError || undefined}
                      onChange={(event) =>
                        setDraft({ ...draft, instance: { ...instance, name: event.target.value } })
                      }
                    />
                    {nameError && (
                      <small className="template-field-error" id="template-instance-name-error">
                        {nameError}
                      </small>
                    )}
                  </label>
                  <Field
                    schema={draft.configurationSchema}
                    required
                    value={instance.configuration}
                    change={(configuration: unknown) =>
                      setDraft({ ...draft, instance: { ...instance, configuration } })
                    }
                  />
                </fieldset>
              </ConfigProvider>
              <p className="ai-task-note">字段由模板提供；打开表单不会执行模板代码。</p>
              {error && !leaving && (
                <div
                  className="template-configuration-error"
                  role="alert"
                  tabIndex={-1}
                  ref={configurationError}
                >
                  <Alert
                    type="error"
                    role="presentation"
                    showIcon
                    title="配置保存未完成"
                    description={
                      <div className="feedback-body">
                        <p>{error}</p>
                        <p>当前输入仍保留，请核对后重试；不会自动开始或重放运行。</p>
                      </div>
                    }
                  />
                </div>
              )}
              <div className="ai-task-actions flowark-actions template-configuration-actions">
                <ActionButton
                  hint={
                    busy
                      ? '正在保存，请等待完成'
                      : checking
                        ? '正在核对原实例来源，请等待完成'
                        : sourceError
                          ? '请先处理实例来源读取问题，当前输入仍保留'
                          : '只保存当前实例的共享配置，不会运行入口'
                  }
                  loading={busy}
                  type="primary"
                  disabled={blocked || undefined}
                  onClick={(event) =>
                    void save('configuration', undefined, event.currentTarget as HTMLButtonElement)
                  }
                >
                  {error ? '重试保存配置' : '保存配置'}
                </ActionButton>
                <ActionButton
                  hint={
                    busy
                      ? '正在保存，请等待完成'
                      : '恢复当前实例已保存的共享配置，其他范围的草稿保持'
                  }
                  disabled={busy || undefined}
                  onClick={() => reset('configuration')}
                >
                  取消更改
                </ActionButton>
              </div>
            </Card>
          </section>
          <aside>
            <Card className="template-instance-guide">
              <h2>实例与入口</h2>
              <p>共享配置适用于本实例所有入口；每次运行仍有独立的入口输入。</p>
              <p>另一个实例保留自己的配置、状态、资源和授权。</p>
              <ActionButton
                stretch
                hint={busy ? '正在保存，请等待完成' : '查看独立实例；切换前仍核对未保存修改'}
                aria-expanded={others}
                disabled={busy || undefined}
                onClick={() => setOthers((value) => !value)}
              >
                查看其他实例
              </ActionButton>
              {others && (
                <div className="template-other-instances">
                  {data.instances
                    .filter((other) => other.id !== instance.id)
                    .map((other) => (
                      <ActionButton
                        stretch
                        hint={
                          busy ? '正在保存，请等待完成' : `${other.name}；切换前核对当前未保存修改`
                        }
                        key={other.id}
                        disabled={busy || undefined}
                        onClick={() => go(() => choose(other.id), `实例 · ${other.name}`)}
                      >
                        {other.name} · {recordTime(other.createdAt)}
                      </ActionButton>
                    ))}
                  {data.instances.every((other) => other.id === instance.id) && (
                    <p>尚无其他实例。</p>
                  )}
                </div>
              )}
            </Card>
          </aside>
        </div>
      </div>
    ),
    resources: (
      <div data-instance-tab="resources" hidden={tab !== 'resources'}>
        <TemplateResources
          detail={draft}
          saved={saved.instance}
          data={data}
          busy={busy}
          blocked={blocked}
          change={setDraft}
          work={work}
          openAI={openAI}
          save={(control) => void save('resources', undefined, control)}
          cancel={() => reset('resources')}
          openEntry={(id) => {
            setEntryId(id);
            switchTab('entry', true);
          }}
        />
      </div>
    ),
    entry: (
      <div data-instance-tab="entry" hidden={tab !== 'entry'}>
        {draft.entries.map((entry) => (
          <div
            key={entry.id + ':' + generation}
            data-entry-id={entry.id}
            hidden={entryId !== entry.id}
          >
            <TemplateEntry
              inspection={entryDetail}
              openDetail={(id) => {
                setError('');
                setEntryId(id);
                setEntryDetail(true);
              }}
              closeDetail={back}
              active={active && tab === 'entry' && entryId === entry.id}
              detail={draft}
              saved={saved}
              browsers={data.browsers}
              entryId={entry.id}
              selectEntry={(id) => {
                setError('');
                setEntryId(id);
              }}
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
              configure={() => {
                switchTab('resources', true);
              }}
              settings={settings}
            />
          </div>
        ))}
      </div>
    ),
    source: (
      <div data-instance-tab="source" hidden={tab !== 'source'}>
        <div className="template-instance-columns">
          <section>
            <Card className="template-instance-form">
              <h2>来源与版本</h2>
              <Descriptions
                className="template-source-details"
                column={1}
                size="small"
                items={[
                  { key: 'template', label: '模板', children: draft.manifest.name },
                  { key: 'version', label: '固定版本', children: draft.manifest.version },
                  { key: 'source', label: '来源声明', children: draft.manifest.source },
                  { key: 'author', label: '作者声明', children: draft.manifest.author },
                  { key: 'instance', label: '实例', children: instance.name },
                ]}
              />
              <TechnicalDetails
                items={[
                  { label: '实例 ID', value: instance.id },
                  { label: '包内容摘要', value: draft.manifest.contentDigest },
                ]}
              />
              <div className="template-version-adoption">
                <Tag
                  className="run-state-tag"
                  variant="filled"
                  color="default"
                  icon={<Badge status="default" />}
                >
                  创建新实例
                </Tag>
                <h3>采用模板新版</h3>
                <p>
                  创建独立实例，复制符合新模板字段规则的已保存普通配置，资源和权限重新核对，不迁移业务状态。
                </p>
                {alternatives.length ? (
                  <label className="ai-settings-field">
                    已安装的其他版本
                    <Select<string>
                      aria-label="采用模板版本"
                      disabled={blocked || !!createdVersion || undefined}
                      value={version}
                      onChange={(value) => setVersion(value)}
                      options={[
                        { value: '', label: '选择版本' },
                        ...alternatives.map((item) => ({
                          value: item.key,
                          label: <>v{item.manifest.version}</>,
                        })),
                      ]}
                    />
                  </label>
                ) : (
                  <p>本机尚未安装其他版本。</p>
                )}
                {selectedVersion && !createdVersion && (
                  <Alert
                    className="template-version-summary"
                    type="info"
                    role="status"
                    showIcon
                    title={<>将创建 v{selectedVersion.manifest.version} 的独立实例</>}
                    description={
                      <div className="feedback-body">
                        <p>
                          当前实例继续使用 v{draft.manifest.version}
                          。只复制已保存且符合目标字段规则的普通配置。
                        </p>
                        <p>新实例的资源绑定、动作权限和业务状态均需重新配置。</p>
                      </div>
                    }
                  />
                )}
                {createdVersion && (
                  <Alert
                    className="template-version-summary"
                    type="success"
                    role="status"
                    showIcon
                    title={<>v{createdVersion.version} 的新实例已创建</>}
                    description="暂时无法打开时，可以继续打开这个实例；原实例仍保留。"
                  />
                )}
                <Button
                  type="primary"
                  disabled={blocked || (!createdVersion && !selectedVersion) || undefined}
                  onClick={adoptVersion}
                >
                  {adopting
                    ? createdVersion
                      ? '正在打开…'
                      : '正在创建…'
                    : createdVersion
                      ? '打开已创建实例'
                      : '创建新版实例'}
                </Button>
              </div>
            </Card>
          </section>
          <aside>
            <Card className="template-instance-guide">
              <h2>导出原模板定义</h2>
              <p>保留原版本与身份；不包含配置值、密钥、本机路径或历史。</p>
              <Button
                type="primary"
                disabled={blocked || !originalPackage || undefined}
                onClick={() => {
                  if (!blocked && originalPackage) exportTemplate(originalPackage, '来源与版本');
                }}
              >
                导出 ZIP
              </Button>
              {!originalPackage && <p role="status">原模板包不可用，请先恢复此版本后再导出。</p>}
              <h3>原实例保持原样</h3>
              <p>新旧版本并存。模板更新不会覆盖本实例、计划或正在运行的快照。</p>
              <Tag
                className="run-state-tag"
                variant="filled"
                color="warning"
                icon={<Badge status="warning" />}
              >
                该版本仍被引用
              </Tag>
              <p>当前实例正在引用此包，不能卸载。</p>
            </Card>
          </aside>
        </div>
      </div>
    ),
  };
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
        <Button
          className="context-back"
          title={`返回${entryDetail ? '实例' : returnLabel}`}
          disabled={busy || undefined}
          onClick={back}
        >
          <span>← 返回{entryDetail ? '实例' : returnLabel}</span>
        </Button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#templates"
            onClick={(event) => {
              event.preventDefault();
              go(home, '模板库');
            }}
          >
            模板库
          </a>
          <span aria-hidden="true">/</span>
          <span className="ai-source-title" title={instance.name}>
            {instance.name}
          </span>
          <span aria-hidden="true">/</span>
          <span aria-current="page">
            {entryDetail
              ? draft.entries.find((entry) => entry.id === entryId)?.name
              : tabs.find(([id]) => id === tab)![1]}
          </span>
        </nav>
        {browserControl}
      </header>
      <section className="page ai-task-page template-instance-page template-entry-page">
        <div className="page-heading">
          <div>
            <h1 ref={entryHeading} tabIndex={-1}>
              {entryDetail
                ? draft.entries.find((entry) => entry.id === entryId)?.name
                : draft.manifest.name.trim() === instance.name.trim()
                  ? instance.name
                  : `${draft.manifest.name} · ${instance.name}`}
            </h1>
            <p>当前实例 · 固定包 v{draft.manifest.version} · 共享配置修改不影响已开始的运行</p>
          </div>
        </div>
        {adoptedFrom && !entryDetail && (
          <section className="template-adoption-result" aria-labelledby="template-adoption-title">
            <Alert
              type="success"
              role="status"
              showIcon
              title={
                <h2 id="template-adoption-title" ref={adoptionHeading} tabIndex={-1}>
                  v{draft.manifest.version} 的新实例已创建
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
                    新旧版本并存
                  </Tag>
                  <p>
                    原实例继续使用 v{adoptedFrom.version}
                    ，原有计划与运行快照保持不变。
                  </p>
                  <p>
                    请核对按此版本字段规则准备的普通配置。资源绑定、动作权限和业务状态不会从原实例复制。
                  </p>
                  <div className="ai-task-actions">
                    {tab !== 'resources' && (
                      <Button
                        type="primary"
                        disabled={busy || undefined}
                        onClick={() => switchTab('resources', true)}
                      >
                        核对资源与动作授权
                      </Button>
                    )}
                    <Button
                      disabled={busy || undefined}
                      onClick={() =>
                        go(
                          () =>
                            void work(async () => {
                              if (!(await choose(adoptedFrom.id)))
                                throw new Error(
                                  '暂时无法打开原实例；新实例和当前输入仍保留，请重试。',
                                );
                            }),
                          '原实例',
                        )
                      }
                    >
                      打开原实例 · v{adoptedFrom.version}
                    </Button>
                  </div>
                </div>
              }
            />
          </section>
        )}
        <Tabs
          id={`template-instance-${instance.id}`}
          className="template-instance-tabs"
          aria-label="实例分类"
          activeKey={tab}
          animated={false}
          destroyOnHidden={false}
          styles={{
            header: entryDetail ? { display: 'none' } : undefined,
            item: { paddingBlock: 5 },
          }}
          onChange={(key) => switchTab(key as Tab)}
          renderTabBar={(props, DefaultTabBar) => (
            <>
              <DefaultTabBar {...props} />
              {sourceError && (
                <div className="template-source-error" role="alert">
                  <Alert
                    type="error"
                    role="presentation"
                    showIcon
                    title="来源核对未完成"
                    description={
                      <div className="feedback-body">
                        <p>{sourceError}</p>
                        <div className="ai-task-actions">
                          <Button
                            disabled={busy || checking || undefined}
                            onClick={() => setReload((v) => v + 1)}
                          >
                            重新读取状态
                          </Button>
                          <Button
                            disabled={busy || undefined}
                            onClick={() =>
                              void work(async () => {
                                const fresh: TemplateDetail = await api('template.detail', {
                                  id: instance.id,
                                });
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
                          </Button>
                          <Button onClick={() => go(home, '模板库')}>返回模板库</Button>
                        </div>
                      </div>
                    }
                  />
                </div>
              )}
              {error && !leaving && tab !== 'configuration' && (
                <div
                  className="template-operation-feedback"
                  role="alert"
                  ref={resourceError}
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
            </>
          )}
          items={tabs.map(([key, label]) => ({
            key,
            label,
            disabled: busy,
            forceRender: true,
            children: instancePanels[key],
          }))}
        />
      </section>
      {leaving && (
        <Modal
          open
          width={640}
          centered
          closable={false}
          mask={{ closable: false }}
          keyboard={!busy}
          focusable={{ focusTriggerAfterClose: false }}
          className="flowark-leave-modal"
          aria-describedby="template-leave-description"
          aria-busy={busy}
          onCancel={stay}
          afterOpenChange={(open) => {
            if (open)
              (error || sourceError ? dialogHeading.current : continueButton.current)?.focus();
          }}
          title={
            <Flex vertical gap={16} align="flex-start">
              <Tag
                color={error || sourceError ? 'error' : 'warning'}
                variant="filled"
                className="flowark-leave-status"
                icon={<Badge status={error || sourceError ? 'error' : 'warning'} />}
              >
                {error || sourceError ? '更改仍保留' : '存在未保存更改'}
              </Tag>
              <h2 ref={dialogHeading} tabIndex={-1}>
                {error || sourceError ? '保存未完成，尚未离开' : '保存实例更改再离开？'}
              </h2>
            </Flex>
          }
          footer={
            <Flex gap={12} wrap className="flowark-leave-actions">
              <Button ref={continueButton} disabled={busy || undefined} onClick={stay}>
                {error && invalidField.current ? '返回修正' : '继续编辑'}
              </Button>
              <Button
                color="danger"
                variant="filled"
                disabled={busy || undefined}
                onClick={() => {
                  const next = leaving.next;
                  setDraft(structuredClone(saved));
                  setGeneration((v) => v + 1);
                  pending.current = false;
                  setLeaving(undefined);
                  next();
                }}
              >
                不保存离开
              </Button>
              <Button
                type="primary"
                loading={busy}
                disabled={blocked || undefined}
                onClick={() => {
                  const next = leaving.next;
                  void save('all').then((ok) => {
                    if (ok) {
                      pending.current = false;
                      setLeaving(undefined);
                      next();
                    }
                  });
                }}
              >
                {busy ? '正在保存…' : error ? '重试保存并离开' : '保存并离开'}
              </Button>
            </Flex>
          }
        >
          <p id="template-leave-description">
            共享配置、资源授权和各入口输入将在一次保存成功后一起保留，再前往“{leaving.destination}
            ”。不保存只放弃本实例的未保存更改。
          </p>
          <p className="flowark-leave-note">已保存的 AI 配置和已开始的运行保持原状。</p>
          {(error || sourceError) && (
            <Alert
              type="error"
              title="保存未完成"
              description={error || sourceError}
              role="alert"
            />
          )}
        </Modal>
      )}
    </div>
  );
}
