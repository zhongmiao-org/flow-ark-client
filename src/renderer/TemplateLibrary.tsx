import { FileSpreadsheet, Folder, Globe, MousePointer2, Workflow } from 'lucide-react';
import { usePageBack } from './use-page-back';
import type { TemplateEntryOrigin } from './template-entry-navigation';
import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import type { Bootstrap } from '../shared/types';
import type { AISettingsEntry } from './AISettingsPage';
import type { TemplateDetail } from './template-draft';
import type { InstalledPackage } from '../templates/archive';
import TemplateInstancePage, { type TemplateNavigation } from './TemplateInstancePage';
import TemplateManifestOverview, {
  capabilityLabel,
  type TemplateManifest,
} from './TemplateManifestOverview';
import './template-catalog.css';
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
type Preview = { token: string; manifest: TemplateManifest; consumed?: boolean };
type View = 'library' | 'inspect' | 'installed' | 'package' | 'instances' | 'remove';
const date = (value: string) => (value ? new Date(value).toLocaleString('zh-CN') : '时间未记录');
export default function TemplateLibrary({
  data,
  action,
  refresh,
  initialPreview,
  consumePreview,
  active,
  settings,
  navigation,
  showRun,
  schedule,
  exportTemplate,
}: {
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  showRun: (detail: any, origin: TemplateEntryOrigin, output?: boolean) => void;
  schedule: (origin: TemplateEntryOrigin) => void;
  exportTemplate: (pkg: InstalledPackage) => void;
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  refresh: () => Promise<void>;
  initialPreview?: Preview;
  consumePreview?: () => void;
  active: boolean;
  settings: (entry: AISettingsEntry) => void;
}) {
  const [view, setView] = useState<View>('library');
  const [preview, setPreview] = useState<Preview>();
  const previewRef = useRef<Preview | undefined>(undefined);
  previewRef.current = preview;
  const [installed, setInstalled] = useState<InstalledPackage>();
  const [selectedKey, setSelectedKey] = useState('');
  const [detail, setDetail] = useState<TemplateDetail>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [failedOperation, setFailedOperation] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [query, setQuery] = useState('');
  const [capability, setCapability] = useState('');
  const [sort, setSort] = useState('recent');
  const [instanceQuery, setInstanceQuery] = useState('');
  const [instanceFilter, setInstanceFilter] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [resumeInstance, setResumeInstance] = useState<string>();
  const [removeReviewed, setRemoveReviewed] = useState(false);
  const locked = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const errorHeading = useRef<HTMLElement>(null);
  useEffect(() => {
    if (active && error && !detail) errorHeading.current?.focus();
  }, [active, error, detail]);
  const locations = useRef(
    new Map<View, { scroll: number; focus: HTMLElement | null; key?: string }>(),
  );
  useEffect(() => {
    if (!initialPreview) return;
    const old = previewRef.current;
    if (old && old.token !== initialPreview.token)
      void api('template.cancelImport', { token: old.token }).catch(() =>
        setNotice('上一次检查的临时资源清理失败；当前检查可继续。'),
      );
    setPreview(initialPreview);
    setReviewed(false);
    setView('inspect');
    setDetail(undefined);
    setError('');
    consumePreview?.();
  }, [initialPreview, consumePreview]);
  const pkg = data.templates.find((p) => p.key === selectedKey);
  const shown = view === 'installed' ? installed : pkg;
  const same =
    preview &&
    data.templates.find((p) => p.key === `${preview.manifest.id}@${preview.manifest.version}`);
  const conflict =
    same && preview && same.manifest.contentDigest !== preview.manifest.contentDigest;
  const instances = data.instances
    .filter((i) => !instanceFilter || i.packageKey === instanceFilter)
    .filter((i) =>
      `${i.name} ${i.packageKey}`
        .toLocaleLowerCase()
        .includes(instanceQuery.trim().toLocaleLowerCase()),
    );
  const matches = data.templates
    .filter(
      (p) =>
        `${p.manifest.name} ${p.manifest.description} ${p.manifest.author}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()) &&
        (!capability || p.manifest.entries.some((e) => e.capabilities.includes(capability))),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.manifest.name.localeCompare(b.manifest.name, 'zh-CN')
        : (Date.parse(b.installedAt) || 0) - (Date.parse(a.installedAt) || 0) ||
          a.key.localeCompare(b.key),
    );
  const caps = [
    ...new Set(data.templates.flatMap((p) => p.manifest.entries.flatMap((e) => e.capabilities))),
  ].sort();
  const references = pkg ? data.instances.filter((i) => i.packageKey === pkg.key) : [];
  const flowRefs = pkg ? data.flows.filter((f) => f.bindings.template?.packageKey === pkg.key) : [];
  const instancePackage = data.templates.find((item) => item.key === instanceFilter);
  const title = {
    library: '模板库',
    inspect: '检查并安装模板',
    installed: '模板已安装',
    package: pkg?.manifest.name ?? '模板版本不可用',
    instances: instancePackage ? `${instancePackage.manifest.name} · 实例` : '本地实例',
    remove: '卸载模板版本',
  }[view];
  const message = (reason: unknown) =>
    (reason instanceof Error ? reason.message : '操作未完成，请重试').replace(
      /^Error invoking remote method 'flowark:request': (?:Error: )?/,
      '',
    );
  const work = async <T,>(name: string, operation: () => Promise<T>): Promise<T | undefined> => {
    if (locked.current) return;
    locked.current = true;
    setBusy(name);
    setError('');
    setFailedOperation('');
    setNotice('');
    try {
      return await operation();
    } catch (reason) {
      setFailedOperation(name);
      setError(message(reason));
    } finally {
      locked.current = false;
      setBusy('');
    }
  };
  const remember = () => {
    locations.current.set(view, {
      scroll: document.querySelector('main')?.scrollTop ?? 0,
      focus: document.activeElement as HTMLElement,
      key: (document.activeElement as HTMLElement)?.dataset.catalogFocus,
    });
  };
  const home = () => {
    setView('library');
    setError('');
    setNotice('');
    setRemoveReviewed(false);
  };
  const openPackage = (p: InstalledPackage) => {
    remember();
    setSelectedKey(p.key);
    setCopyFrom('');
    setView('package');
    setError('');
    setNotice('');
  };
  const cancelPreview = async () => {
    const current = previewRef.current;
    if (current) await api('template.cancelImport', { token: current.token });
    setPreview(undefined);
  };
  const back = () => {
    if (view === 'inspect')
      void work('cancel', async () => {
        await cancelPreview();
        home();
      });
    else home();
  };
  const selectZip = () =>
    work('inspect', async () => {
      const old = previewRef.current;
      setReviewed(false);
      try {
        const next: Preview | null = await api('template.inspect');
        if (!next) {
          if (old)
            setNotice(
              `已取消选择。仍保留此前检查的“${old.manifest.name} · v${old.manifest.version}”，安装前请重新核对来源。`,
            );
          return;
        }
        if (old) {
          try {
            await api('template.cancelImport', { token: old.token });
          } catch (reason) {
            await api('template.cancelImport', { token: next.token }).catch(() => {});
            throw reason;
          }
        }
        remember();
        setPreview(next);
        setView('inspect');
      } catch (reason) {
        if (old)
          setNotice(
            `未切换到新的检查结果。当前仍是此前检查的“${old.manifest.name} · v${old.manifest.version}”，安装前请重新核对来源。`,
          );
        throw reason;
      }
    });
  const openInstance = (id: string) =>
    work('detail', async () => {
      const next = await api('template.detail', { id });
      setDetail(next);
      setResumeInstance(undefined);
    });
  const create = (p: InstalledPackage, copy?: string) =>
    work('create', async () => {
      remember();
      const instance = await api('template.create', {
        key: p.key,
        ...(copy ? { copyFrom: copy } : {}),
      });
      setResumeInstance(instance.id);
      await refresh();
      const next = await api('template.detail', { id: instance.id });
      setDetail(next);
      setResumeInstance(undefined);
    });
  useEffect(() => {
    if (!active || detail) return;
    const saved = locations.current.get(view);
    document.querySelector('main')?.scrollTo(0, saved?.scroll ?? 0);
    const target = saved?.focus?.isConnected
      ? saved.focus
      : saved?.key
        ? document.querySelector<HTMLElement>(`[data-catalog-focus="${CSS.escape(saved.key)}"]`)
        : null;
    (target ?? heading.current)?.focus({ preventScroll: true });
  }, [view, detail, active]);
  usePageBack(
    () => {
      if (!locked.current) back();
    },
    active && !detail && view !== 'library',
  );
  if (detail)
    return (
      <TemplateInstancePage
        key={detail.instance.id}
        initial={detail}
        active={active}
        data={data}
        action={action}
        navigation={navigation}
        showRun={showRun}
        schedule={schedule}
        settings={settings}
        returnLabel={title}
        home={() => {
          setDetail(undefined);
          home();
        }}
        close={() => setDetail(undefined)}
        choose={(id) => void openInstance(id)}
      />
    );
  navigation.current = (next) => {
    if (!locked.current) next();
  };
  const showInstances = (key = '') => {
    remember();
    setInstanceFilter(key);
    setInstanceQuery('');
    setView('instances');
    setError('');
    setNotice('');
  };
  const createButton = (p: InstalledPackage) => (
    <button
      className="primary"
      disabled={!!busy || !!resumeInstance}
      data-catalog-focus={`create-${p.key}`}
      onClick={() => void create(p)}
    >
      {busy === 'create' ? '正在创建…' : '创建独立实例'}
    </button>
  );
  return (
    <>
      <header className="topbar">
        {view !== 'library' && (
          <button className="context-back" disabled={!!busy} onClick={back}>
            ← 返回模板库
          </button>
        )}
        <nav className="breadcrumbs" aria-label="当前位置">
          {view !== 'library' && (
            <>
              <a
                href="#templates"
                onClick={(event) => {
                  event.preventDefault();
                  if (!busy) back();
                }}
              >
                模板库
              </a>
              <span aria-hidden="true">/</span>
            </>
          )}
          <span aria-current="page">{title}</span>
        </nav>
      </header>
      <section className="page template-catalog-page" aria-label="模板工作区">
        <header className="template-catalog-heading">
          <div>
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
            <p>
              {view === 'inspect'
                ? '安装只保存包定义；不会创建运行、授予权限或执行脚本。'
                : view === 'installed'
                  ? '包定义已保存到本机，尚未创建运行。'
                  : view === 'remove'
                    ? '核对具体版本和引用后，再决定是否卸载。'
                    : view === 'instances'
                      ? '每个实例独立保存配置、资源、授权和业务状态。'
                      : '从已安装的模板定义开始，创建独立实例并配置本机资源。'}
            </p>
          </div>
          {view === 'instances' && instancePackage && createButton(instancePackage)}
          {view === 'library' && (
            <button className="primary" disabled={!!busy} onClick={() => void selectZip()}>
              {busy === 'inspect' ? '正在检查 ZIP…' : '导入 ZIP 模板'}
            </button>
          )}
        </header>
        {error && (
          <div className="template-catalog-banner error" role="alert">
            <strong ref={errorHeading} tabIndex={-1}>
              {failedOperation === 'inspect'
                ? '模板检查未完成'
                : failedOperation === 'install'
                  ? '安装未完成'
                  : '操作未完成'}
            </strong>
            <p>{error}</p>
            {failedOperation === 'inspect' && (
              <button disabled={!!busy} onClick={() => void selectZip()}>
                重新选择 ZIP
              </button>
            )}
          </div>
        )}
        {notice && (
          <div className="template-catalog-banner" role="status">
            {notice}
          </div>
        )}
        {resumeInstance && (
          <div className="template-catalog-banner warning">
            <strong>实例已创建，详情尚未打开</strong>
            <p>可以重新打开这个实例，避免重复创建。</p>
            <button disabled={!!busy} onClick={() => void openInstance(resumeInstance)}>
              打开已创建实例
            </button>
            <button disabled={!!busy} onClick={() => setResumeInstance(undefined)}>
              稍后到实例列表查看
            </button>
          </div>
        )}
        {view === 'library' && (
          <>
            {preview && (
              <div className="template-catalog-banner">
                <strong>{preview.manifest.name} · 安装检查未结束</strong>
                <button disabled={!!busy} onClick={() => setView('inspect')}>
                  继续查看检查
                </button>
                <button disabled={!!busy} onClick={() => void work('cancel', cancelPreview)}>
                  取消这次检查
                </button>
              </div>
            )}
            <div className="template-catalog-intro">
              <h2>好流程，可以重复使用。</h2>
              <p>导入本地模板包，核对版本与能力要求，再绑定这台 Mac 的资源。</p>
              <small>模板更新不覆盖已有实例、计划或运行快照。</small>
            </div>
            <div className="template-catalog-toolbar">
              <strong>已安装 {data.templates.length} 个版本</strong>
              <label>
                <span className="sr-only">搜索模板</span>
                <input
                  type="search"
                  placeholder="名称、说明或作者"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">能力</span>
                <select value={capability} onChange={(e) => setCapability(e.target.value)}>
                  <option value="">全部能力</option>
                  {caps.map((c) => (
                    <option key={c} value={c}>
                      {capabilityLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">排序</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="recent">最近安装</option>
                  <option value="name">名称</option>
                </select>
              </label>
              <button
                disabled={!!busy}
                data-catalog-focus="all-instances"
                onClick={() => showInstances()}
              >
                本地实例 {data.instances.length}
              </button>
            </div>
            <div className="template-catalog-grid">
              {matches.map((p) => {
                const capabilities = [
                  ...new Set(p.manifest.entries.flatMap((entry) => entry.capabilities)),
                ];
                const Icon = capabilities.includes('browser-forms-v1')
                  ? MousePointer2
                  : capabilities.includes('browser')
                    ? Globe
                    : capabilities.includes('excel') || capabilities.includes('excel-mapping-v1')
                      ? FileSpreadsheet
                      : capabilities.includes('file')
                        ? Folder
                        : Workflow;
                return (
                  <article className="template-catalog-card template-library-card" key={p.key}>
                    <div className="template-library-category">
                      <Icon size={28} strokeWidth={1.6} aria-hidden="true" />
                      <span>
                        {capabilities.slice(0, 4).map(capabilityLabel).join(' · ') || '通用流程'}
                      </span>
                    </div>
                    <h2>{p.manifest.name}</h2>
                    <p>{p.manifest.description}</p>
                    <div className="template-library-footer">
                      <span className="template-catalog-muted">
                        v{p.manifest.version} · {p.manifest.entries.length} 个入口
                      </span>
                      <button
                        disabled={!!busy}
                        data-catalog-focus={`package-${p.key}`}
                        onClick={() => openPackage(p)}
                      >
                        查看模板与实例
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {!matches.length && (
              <div className="template-catalog-empty">
                <h2>{data.templates.length ? '没有匹配的模板' : '尚未安装模板'}</h2>
                <p>
                  {data.templates.length
                    ? '调整关键词或能力筛选。'
                    : '选择标准 .flowark-template.zip 文件，先检查再安装。'}
                </p>
                {data.templates.length > 0 && (
                  <button
                    onClick={() => {
                      setQuery('');
                      setCapability('');
                    }}
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {view === 'inspect' && preview && (
          <div className="template-catalog-layout">
            <TemplateManifestOverview key={preview.token} manifest={preview.manifest} checked />
            <aside className="template-catalog-card template-catalog-side">
              <h2>安装前确认</h2>
              {conflict && (
                <div className="template-catalog-banner error template-install-state" role="alert">
                  <span className="template-catalog-status error">拒绝安装</span>
                  <h3>同版本内容不同</h3>
                  <p>同 ID / 版本的内容摘要与已安装包不同，不能覆盖。请核对来源或使用独立版本。</p>
                </div>
              )}
              {same && !conflict && (
                <div className="template-catalog-banner template-install-state" role="status">
                  <span className="template-catalog-status success">无需重复安装</span>
                  <h3>该版本已安装</h3>
                  <p>相同 ID、版本与摘要已存在，保留当前包定义。</p>
                </div>
              )}
              {!same && data.templates.some((item) => item.manifest.id === preview.manifest.id) && (
                <div className="template-catalog-banner template-install-state" role="status">
                  <span className="template-catalog-status">可并存安装</span>
                  <h3>发现新版本</h3>
                  <p>新版本不会覆盖原实例、计划或运行；采用新版需创建独立实例。</p>
                </div>
              )}
              {preview.consumed && busy !== 'install' && (
                <div className="template-catalog-banner warning">
                  本次安装检查已使用。请重新选择 ZIP 后再安装。
                </div>
              )}
              <p>
                {preview.manifest.scripts.length
                  ? `此包包含 ${preview.manifest.scripts.length} 个脚本。`
                  : '请核对包定义和来源。'}
                安装不会执行模板代码。
              </p>
              {(!same || conflict) && (
                <label className="template-catalog-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    disabled={!!busy || preview.consumed || !!conflict}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  我已核对模板来源
                </label>
              )}
              <p>创建实例后再按入口配置资源；新实例动作权限默认为禁止。</p>
              {same && !conflict ? (
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() =>
                    void work('open-installed', async () => {
                      await cancelPreview();
                      openPackage(same);
                    })
                  }
                >
                  打开已安装模板
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!!busy || !reviewed || preview.consumed || !!conflict}
                  onClick={() =>
                    void work('install', async () => {
                      const token = preview.token;
                      setPreview({ ...preview, consumed: true });
                      const result = await api('template.install', { token });
                      setInstalled(result);
                      setSelectedKey(result.key);
                      setPreview(undefined);
                      setView('installed');
                      await refresh();
                    })
                  }
                >
                  {busy === 'install' ? '正在安装…' : '确认安装'}
                </button>
              )}
              <button disabled={!!busy} onClick={() => void selectZip()}>
                重新选择 ZIP
              </button>
              <button disabled={!!busy} onClick={back}>
                {same && !conflict ? '返回模板库' : '取消安装'}
              </button>
            </aside>
          </div>
        )}
        {view === 'installed' && shown && (
          <section className="template-catalog-card template-installed">
            <span className="template-catalog-status success">安装已确认</span>
            <h2>
              {shown.manifest.name} · v{shown.manifest.version}
            </h2>
            <p>{shown.manifest.entries.length} 个入口 · 普通配置和业务状态由每个实例独立保存。</p>
            <div className="template-catalog-actions">
              {createButton(shown)}
              <button
                disabled={!!busy}
                onClick={() => {
                  setSelectedKey(shown.key);
                  setView('package');
                }}
              >
                查看模板定义
              </button>
              <button disabled={!!busy} onClick={home}>
                返回模板库
              </button>
            </div>
          </section>
        )}
        {view === 'package' && pkg && (
          <div className="template-catalog-layout">
            <TemplateManifestOverview key={pkg.key} manifest={pkg.manifest} />
            <aside className="template-catalog-card template-catalog-side">
              <h2>创建与管理</h2>
              <p>同一版本可以创建多个实例，配置、资源和业务状态互相独立。</p>
              {createButton(pkg)}
              <button disabled={!!busy} onClick={() => showInstances(pkg.key)}>
                查看此版本实例 · {references.length}
              </button>
              <button disabled={!!busy} onClick={() => exportTemplate(pkg)}>
                导出原模板 ZIP
              </button>
              <h3>采用此版本</h3>
              <label>
                复制已有实例的普通配置
                <select
                  value={copyFrom}
                  disabled={!!busy || !!resumeInstance}
                  onChange={(e) => setCopyFrom(e.target.value)}
                >
                  <option value="">选择其他版本的实例…</option>
                  {data.instances
                    .filter(
                      (i) =>
                        i.packageKey.startsWith(pkg.manifest.id + '@') && i.packageKey !== pkg.key,
                    )
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} · {i.packageKey}
                      </option>
                    ))}
                </select>
              </label>
              <p className="template-catalog-muted">
                仅复制符合新 Schema 的配置，否则使用默认值；资源、授权和业务状态不复制。
              </p>
              <button
                disabled={!copyFrom || !!busy || !!resumeInstance}
                onClick={() => void create(pkg, copyFrom)}
              >
                创建此版本的新实例
              </button>
              <div className="template-catalog-divider" />
              <p className="template-catalog-muted">安装于 {date(pkg.installedAt)}</p>
              <button
                disabled={!!busy}
                className="danger"
                onClick={() => {
                  setRemoveReviewed(false);
                  setView('remove');
                }}
              >
                卸载此版本…
              </button>
            </aside>
          </div>
        )}
        {view === 'instances' && (
          <>
            <div className="template-catalog-toolbar">
              <strong>{instances.length} 个实例</strong>
              <label>
                <span className="sr-only">搜索实例</span>
                <input
                  type="search"
                  value={instanceQuery}
                  onChange={(e) => setInstanceQuery(e.target.value)}
                  placeholder="实例名称或版本"
                />
              </label>
              <label>
                <span className="sr-only">模板版本</span>
                <select value={instanceFilter} onChange={(e) => setInstanceFilter(e.target.value)}>
                  <option value="">全部版本</option>
                  {[
                    ...new Set([
                      ...data.templates.map((item) => item.key),
                      ...data.instances.map((i) => i.packageKey),
                    ]),
                  ].map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="template-instance-list">
              {instances.map((i) => {
                const source = data.templates.find((item) => item.key === i.packageKey);
                return (
                  <article className="template-catalog-card template-instance-card" key={i.id}>
                    <h2 title={`${i.id} · 创建于 ${date(i.createdAt)}`}>{i.name}</h2>
                    <p>
                      {source
                        ? `${instanceFilter ? '' : source.manifest.name + ' · '}v${source.manifest.version}`
                        : i.packageKey}
                      {' · '}
                      {Object.keys(i.entryFlows).length} 个入口
                      {' · '}已保存 {Object.keys(i.resources).length} 项资源，运行前复核
                    </p>
                    <button
                      className="primary"
                      disabled={!!busy}
                      data-catalog-focus={`instance-${i.id}`}
                      onClick={() => {
                        remember();
                        void openInstance(i.id);
                      }}
                    >
                      打开实例
                    </button>
                  </article>
                );
              })}
            </div>
            {!instances.length && (
              <div className="template-catalog-empty">
                <h2>没有匹配的实例</h2>
                <p>从模板详情创建独立实例，或调整搜索和版本筛选。</p>
                <button
                  onClick={() => {
                    setInstanceFilter('');
                    setInstanceQuery('');
                  }}
                >
                  查看全部实例
                </button>
                <button onClick={home}>选择模板</button>
              </div>
            )}
          </>
        )}
        {view === 'remove' && pkg && (
          <section className="template-catalog-card template-installed">
            <span
              className={`template-catalog-status${references.length || flowRefs.length ? ' warning' : ''}`}
            >
              {references.length || flowRefs.length ? '仍被引用' : '核对后卸载'}
            </span>
            <h2>
              {pkg.manifest.name} · v{pkg.manifest.version}
            </h2>
            <p>卸载会移除这台 Mac 上的此版本包定义。重新使用时需要再次导入原 ZIP。</p>
            <p>
              当前列表中有 {references.length} 个实例、{flowRefs.length}{' '}
              个流程引用此版本。历史版本、计划和 Run 的引用仍由宿主最终检查。
            </p>
            {references.length > 0 && (
              <button disabled={!!busy} onClick={() => showInstances(pkg.key)}>
                查看引用此版本的实例
              </button>
            )}
            <label className="template-catalog-check">
              <input
                type="checkbox"
                checked={removeReviewed}
                disabled={!!busy || !!references.length || !!flowRefs.length}
                onChange={(e) => setRemoveReviewed(e.target.checked)}
              />
              确认只卸载这个模板版本
            </label>
            <div className="template-catalog-actions">
              <button
                className="danger"
                disabled={!!busy || !removeReviewed || !!references.length || !!flowRefs.length}
                onClick={() =>
                  void work('remove', async () => {
                    await api('template.remove', { key: pkg.key });
                    await refresh();
                    home();
                    setNotice('此版本已卸载，其他版本保持不变。');
                  })
                }
              >
                {busy === 'remove' ? '正在卸载…' : '确认卸载'}
              </button>
              <button disabled={!!busy} onClick={() => setView('package')}>
                保留，返回模板详情
              </button>
            </div>
          </section>
        )}
        {['package', 'remove'].includes(view) && !pkg && (
          <div className="template-catalog-empty">
            <h2>此版本已不在当前模板库</h2>
            <p>请返回列表核对，或重新选择 ZIP 导入。</p>
            <button onClick={home}>返回模板库</button>
          </div>
        )}
      </section>
    </>
  );
}
