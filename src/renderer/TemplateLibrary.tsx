import { Alert, Badge, Card, Divider, Empty, Select, Button, Checkbox, Input, Tag } from 'antd';
import type { InputRef } from 'antd';
import { FileSpreadsheet, Folder, Globe, MousePointer2, Workflow } from 'lucide-react';
import { usePageBack } from './use-page-back';
import type { TemplateEntryOrigin } from './template-entry-navigation';
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { Bootstrap } from '../shared/types';
import type { AISettingsEntry } from './AISettingsPage';
import type { TemplateDetail } from './template-draft';
import type { InstalledPackage } from '../templates/archive';
import TemplateInstancePage, {
  type TemplateAdoptionOrigin,
  type TemplateNavigation,
} from './TemplateInstancePage';
import TemplateManifestOverview, {
  capabilityLabel,
  type TemplateManifest,
} from './TemplateManifestOverview';
import './template-catalog.css';
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
type Preview = { token: string; manifest: TemplateManifest; consumed?: boolean };
type View = 'library' | 'inspect' | 'installed' | 'package' | 'instances' | 'remove';
export type TemplateOpenRequest = {
  key: string;
  detail: TemplateDetail;
  entryId: string;
  initialTab: 'resources' | 'entry';
  returnLabel: string;
  back: () => void;
};
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
  homeRequest,
  browserControl,
  instanceRequest,
  authorOpen,
}: {
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  showRun: (detail: any, origin: TemplateEntryOrigin, output?: boolean) => void;
  schedule: (origin: TemplateEntryOrigin) => void;
  exportTemplate: (pkg: InstalledPackage, returnLabel?: string) => void;
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  refresh: () => Promise<void>;
  initialPreview?: Preview;
  consumePreview?: () => void;
  active: boolean;
  settings: (entry: AISettingsEntry) => void;
  homeRequest?: string;
  browserControl?: ReactNode;
  instanceRequest?: TemplateOpenRequest;
  authorOpen: () => void;
}) {
  const [view, setView] = useState<View>('library');
  const [preview, setPreview] = useState<Preview>();
  const previewRef = useRef<Preview | undefined>(undefined);
  previewRef.current = preview;
  const [installed, setInstalled] = useState<InstalledPackage>();
  const [removed, setRemoved] = useState<InstalledPackage[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [detail, setDetail] = useState<TemplateDetail>();
  const [externalOrigin, setExternalOrigin] = useState<TemplateOpenRequest>();
  useLayoutEffect(() => {
    if (!instanceRequest) return;
    setDetail(instanceRequest.detail);
    setExternalOrigin(instanceRequest);
    setAdoption(undefined);
    setError('');
    setNotice('');
  }, [instanceRequest]);
  const [adoption, setAdoption] = useState<{
    instanceId: string;
    from: TemplateAdoptionOrigin;
  }>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [failedOperation, setFailedOperation] = useState('');
  const [notice, setNotice] = useState('');
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [query, setQuery] = useState('');
  const [capability, setCapability] = useState('');
  const [sort, setSort] = useState('recent');
  const [instanceQuery, setInstanceQuery] = useState('');
  const [instanceFilter, setInstanceFilter] = useState('');
  const [instancesOrigin, setInstancesOrigin] = useState<'library' | 'package' | 'remove'>(
    'library',
  );
  const [copyFrom, setCopyFrom] = useState('');
  const [resumeInstance, setResumeInstance] = useState<string>();
  const [removeReviewed, setRemoveReviewed] = useState(false);
  const locked = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const templateSearch = useRef<InputRef>(null);
  const instanceSearch = useRef<InputRef>(null);
  const errorHeading = useRef<HTMLElement>(null);
  const noticeHeading = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (active && !busy && error && !detail) errorHeading.current?.focus();
    else if (active && !busy && notice && !detail) noticeHeading.current?.focus();
  }, [active, busy, error, notice, detail, feedbackRevision]);
  useEffect(() => {
    if (!active || detail) return;
    const main = document.querySelector('main');
    if (!main) return;
    const observer = new ResizeObserver(() => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !main.contains(focused)) return;
      const bounds = focused.getBoundingClientRect();
      const visible = main.getBoundingClientRect();
      if (bounds.top < visible.top || bounds.bottom > visible.bottom)
        focused.scrollIntoView({ block: 'nearest' });
    });
    observer.observe(main);
    return () => observer.disconnect();
  }, [active, detail]);
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
  const templates = data.templates.filter((p) => !removed.some((item) => item.key === p.key));
  const pkg = templates.find((p) => p.key === selectedKey);
  const shown = view === 'installed' ? installed : pkg;
  const installedRefreshFailure =
    view === 'installed' &&
    !!installed &&
    ['install', 'refresh-installed'].includes(failedOperation);
  const removedRefreshFailure =
    view === 'library' &&
    removed.length > 0 &&
    ['remove', 'refresh-removed'].includes(failedOperation);
  const same =
    preview &&
    templates.find((p) => p.key === `${preview.manifest.id}@${preview.manifest.version}`);
  const conflict =
    same && preview && same.manifest.contentDigest !== preview.manifest.contentDigest;
  const instances = data.instances
    .filter((i) => !instanceFilter || i.packageKey === instanceFilter)
    .filter((i) =>
      `${i.name} ${i.packageKey}`
        .toLocaleLowerCase()
        .includes(instanceQuery.trim().toLocaleLowerCase()),
    );
  const matches = templates
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
    ...new Set(templates.flatMap((p) => p.manifest.entries.flatMap((e) => e.capabilities))),
  ].sort();
  const references = pkg ? data.instances.filter((i) => i.packageKey === pkg.key) : [];
  const flowRefs = pkg ? data.flows.filter((f) => f.bindings.template?.packageKey === pkg.key) : [];
  const referenced = references.length > 0 || flowRefs.length > 0;
  const backView =
    view === 'instances' ? instancesOrigin : view === 'remove' ? 'package' : 'library';
  const backLabel =
    backView === 'remove' ? '返回版本引用' : backView === 'package' ? '返回模板详情' : '返回模板库';
  const instancePackage = templates.find((item) => item.key === instanceFilter);
  const title = {
    library: '模板库',
    inspect: '检查并安装模板',
    installed: '模板已安装',
    package: pkg?.manifest.name ?? '模板版本不可用',
    instances: instancePackage ? `${instancePackage.manifest.name} · 实例` : '本地实例',
    remove: referenced ? '模板版本与引用' : '卸载模板版本',
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
      setFeedbackRevision((revision) => revision + 1);
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
  useEffect(() => {
    if (!homeRequest) return;
    setDetail(undefined);
    setExternalOrigin(undefined);
    home();
  }, [homeRequest]);
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
    else if (backView === 'library') home();
    else {
      setView(backView);
      setError('');
      setNotice('');
    }
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
  const openInstance = (id: string, adoptedFrom?: TemplateAdoptionOrigin) =>
    work('detail', async () => {
      const next = await api('template.detail', { id });
      setDetail(next);
      setExternalOrigin(undefined);
      setAdoption(adoptedFrom ? { instanceId: id, from: adoptedFrom } : undefined);
      setResumeInstance(undefined);
      return true;
    });
  const create = (p: InstalledPackage, copy?: string) =>
    work('create', async () => {
      remember();
      const original = data.instances.find((item) => item.id === copy);
      const originalPackage = templates.find((item) => item.key === original?.packageKey);
      const instance = await api('template.create', {
        key: p.key,
        ...(copy ? { copyFrom: copy } : {}),
      });
      setResumeInstance(instance.id);
      await refresh();
      const next = await api('template.detail', { id: instance.id });
      setDetail(next);
      setExternalOrigin(undefined);
      setAdoption(
        original && originalPackage
          ? {
              instanceId: instance.id,
              from: { id: original.id, version: originalPackage.manifest.version },
            }
          : undefined,
      );
      setResumeInstance(undefined);
    });
  useEffect(() => {
    if (!active || detail) return;
    if (view === 'inspect' && preview?.token) {
      document.querySelector('main')?.scrollTo(0, 0);
      heading.current?.focus({ preventScroll: true });
      return;
    }
    const saved = locations.current.get(view);
    document.querySelector('main')?.scrollTo(0, saved?.scroll ?? 0);
    const target = saved?.focus?.isConnected
      ? saved.focus
      : saved?.key
        ? document.querySelector<HTMLElement>(`[data-catalog-focus="${CSS.escape(saved.key)}"]`)
        : null;
    (target ?? heading.current)?.focus({ preventScroll: true });
  }, [view, detail, active, preview?.token]);
  usePageBack(
    () => {
      if (!locked.current) back();
    },
    active && !detail && view !== 'library',
  );
  if (detail)
    return (
      <TemplateInstancePage
        key={`${detail.instance.id}:${externalOrigin?.key ?? ''}`}
        initial={detail}
        initialEntryId={externalOrigin?.entryId}
        initialTab={externalOrigin?.initialTab}
        returnToSource={externalOrigin?.back}
        adoptedFrom={adoption?.instanceId === detail.instance.id ? adoption.from : undefined}
        active={active}
        data={data}
        action={action}
        navigation={navigation}
        showRun={showRun}
        schedule={schedule}
        settings={settings}
        returnLabel={externalOrigin?.returnLabel ?? title}
        exportTemplate={exportTemplate}
        browserControl={browserControl}
        home={() => {
          setDetail(undefined);
          setExternalOrigin(undefined);
          home();
        }}
        close={() => {
          setDetail(undefined);
          setExternalOrigin(undefined);
        }}
        choose={async (id, adoptedFrom) => (await openInstance(id, adoptedFrom)) === true}
      />
    );
  navigation.current = (next) => {
    if (!locked.current) next();
  };
  const showInstances = (key = '') => {
    remember();
    setInstancesOrigin(view === 'package' || view === 'remove' ? view : 'library');
    setInstanceFilter(key);
    setInstanceQuery('');
    setView('instances');
    setError('');
    setNotice('');
  };
  const createButton = (p: InstalledPackage, label = '创建独立实例') => (
    <Button
      type="primary"
      disabled={!!busy || !!resumeInstance || undefined}
      data-catalog-focus={`create-${p.key}`}
      onClick={() => void create(p)}
    >
      {busy === 'create' ? '正在创建…' : label}
    </Button>
  );
  return (
    <>
      <header className="topbar">
        {view !== 'library' && (
          <Button className="context-back" disabled={!!busy || undefined} onClick={back}>
            ← {backLabel}
          </Button>
        )}
        <nav className="breadcrumbs" aria-label="当前位置">
          {view !== 'library' && (
            <>
              <a
                href="#templates"
                onClick={(event) => {
                  event.preventDefault();
                  if (!busy) {
                    if (view === 'inspect') back();
                    else home();
                  }
                }}
              >
                模板库
              </a>
              <span aria-hidden="true">/</span>
            </>
          )}
          <span aria-current="page">{title}</span>
        </nav>
        {browserControl}
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
                    ? referenced
                      ? '此版本仍在使用，先查看关联实例；已有版本和运行保持不变。'
                      : '核对具体版本和引用后，再决定是否卸载。'
                    : view === 'instances'
                      ? '每个实例独立保存配置、资源、授权和业务状态。'
                      : '从已安装的模板定义开始，创建独立实例并配置本机资源。'}
            </p>
          </div>
          {view === 'instances' && instancePackage && createButton(instancePackage)}
          {view === 'library' && (
            <div className="author-actions">
              <Button disabled={!!busy} onClick={authorOpen}>
                制作模板
              </Button>
              <Button
                type="primary"
                disabled={!!busy || undefined}
                onClick={() => void selectZip()}
              >
                {busy === 'inspect' ? '正在检查 ZIP…' : '导入 ZIP 模板'}
              </Button>
            </div>
          )}
        </header>
        {error && (
          <Alert
            className="template-catalog-feedback"
            type={installedRefreshFailure || removedRefreshFailure ? 'warning' : 'error'}
            showIcon
            title={
              <strong ref={errorHeading} tabIndex={-1}>
                {removedRefreshFailure
                  ? '模板版本已卸载，列表刷新失败'
                  : installedRefreshFailure
                    ? '模板已安装，列表刷新失败'
                    : failedOperation === 'inspect'
                      ? '模板检查未完成'
                      : failedOperation === 'install'
                        ? '安装未完成'
                        : '操作未完成'}
              </strong>
            }
            description={
              removedRefreshFailure ? (
                <>
                  <p>
                    {removed.map((p) => `${p.manifest.name} · v${p.manifest.version}`).join('、')}
                  </p>
                  <p>{error}</p>
                </>
              ) : (
                error
              )
            }
            action={
              installedRefreshFailure || removedRefreshFailure ? (
                <Button
                  disabled={!!busy || undefined}
                  onClick={() =>
                    void work(
                      removedRefreshFailure ? 'refresh-removed' : 'refresh-installed',
                      async () => {
                        await refresh();
                        if (removedRefreshFailure) {
                          setRemoved([]);
                          setNotice(
                            `${removed.map((p) => `${p.manifest.name} · v${p.manifest.version}`).join('、')}已卸载，其他版本保持不变。`,
                          );
                        }
                        requestAnimationFrame(() => heading.current?.focus());
                      },
                    )
                  }
                >
                  重新读取模板列表
                </Button>
              ) : failedOperation === 'inspect' ? (
                <Button disabled={!!busy || undefined} onClick={() => void selectZip()}>
                  重新选择 ZIP
                </Button>
              ) : undefined
            }
          />
        )}
        {notice && (
          <Alert
            className="template-catalog-feedback"
            type="info"
            role="status"
            showIcon
            title={
              <span ref={noticeHeading} tabIndex={-1}>
                {notice}
              </span>
            }
          />
        )}
        {resumeInstance && (
          <Alert
            className="template-catalog-feedback"
            type="warning"
            role="status"
            showIcon
            title="实例已创建，详情尚未打开"
            description="可以重新打开这个实例，避免重复创建。"
            action={
              <div className="feedback-actions">
                <Button
                  disabled={!!busy || undefined}
                  onClick={() => void openInstance(resumeInstance)}
                >
                  打开已创建实例
                </Button>
                <Button disabled={!!busy || undefined} onClick={() => setResumeInstance(undefined)}>
                  稍后到实例列表查看
                </Button>
              </div>
            }
          />
        )}
        {view === 'library' && (
          <>
            {preview && (
              <Alert
                className="template-catalog-feedback"
                type="info"
                role="status"
                showIcon
                title={`${preview.manifest.name} · 安装检查未结束`}
                action={
                  <div className="feedback-actions">
                    <Button disabled={!!busy || undefined} onClick={() => setView('inspect')}>
                      继续查看检查
                    </Button>
                    <Button
                      disabled={!!busy || undefined}
                      onClick={() => void work('cancel', cancelPreview)}
                    >
                      取消这次检查
                    </Button>
                  </div>
                }
              />
            )}
            <Card className="template-catalog-intro">
              <h2>好流程，可以重复使用。</h2>
              <p>导入本地模板包，核对版本与能力要求，再绑定这台 Mac 的资源。</p>
              <small>模板更新不覆盖已有实例、计划或运行快照。</small>
            </Card>
            <div className="template-catalog-toolbar">
              <strong>已安装 {templates.length} 个版本</strong>
              <label>
                <span className="sr-only">搜索模板</span>
                <Input
                  ref={templateSearch}
                  type="search"
                  placeholder="名称、说明或作者"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">能力</span>
                <Select<string>
                  value={capability}
                  onChange={(value) => setCapability(value)}
                  options={[
                    { value: '', label: '全部能力' },
                    ...caps.map((c) => ({ value: c, label: capabilityLabel(c) })),
                  ]}
                />
              </label>
              <label>
                <span className="sr-only">排序</span>
                <Select<string>
                  value={sort}
                  onChange={(value) => setSort(value)}
                  options={[
                    { value: 'recent', label: '最近安装' },
                    { value: 'name', label: '名称' },
                  ]}
                />
              </label>
              <Button
                disabled={!!busy || undefined}
                data-catalog-focus="all-instances"
                onClick={() => showInstances()}
              >
                本地实例 {data.instances.length}
              </Button>
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
                  <article className="template-library-card" key={p.key}>
                    <Card className="template-catalog-card">
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
                        <Button
                          disabled={!!busy || undefined}
                          data-catalog-focus={`package-${p.key}`}
                          onClick={() => openPackage(p)}
                        >
                          查看模板与实例
                        </Button>
                      </div>
                    </Card>
                  </article>
                );
              })}
            </div>
            {!matches.length && (
              <Card className="template-catalog-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <>
                      <h2>{templates.length ? '没有匹配的模板' : '尚未安装模板'}</h2>
                      <p>
                        {templates.length
                          ? '调整关键词或能力筛选。'
                          : '选择标准 .flowark-template.zip 文件，先检查再安装。'}
                      </p>
                    </>
                  }
                >
                  {templates.length > 0 && (
                    <Button
                      onClick={() => {
                        setQuery('');
                        setCapability('');
                        templateSearch.current?.focus();
                      }}
                    >
                      清除筛选
                    </Button>
                  )}
                </Empty>
              </Card>
            )}
          </>
        )}
        {view === 'inspect' && preview && (
          <div className="template-catalog-layout">
            <TemplateManifestOverview key={preview.token} manifest={preview.manifest} checked />
            <aside className="template-catalog-side">
              <Card className="template-catalog-card">
                <h2>安装前确认</h2>
                {conflict && (
                  <Alert
                    className="template-install-feedback"
                    type="error"
                    showIcon
                    title="同版本内容不同"
                    description={
                      <div className="feedback-body">
                        <Tag
                          variant="filled"
                          color="error"
                          className="run-state-tag"
                          icon={<Badge status="error" />}
                        >
                          拒绝安装
                        </Tag>
                        <p>
                          同 ID / 版本的内容摘要与已安装包不同，不能覆盖。请核对来源或使用独立版本。
                        </p>
                      </div>
                    }
                  />
                )}
                {same && !conflict && (
                  <Alert
                    className="template-install-feedback"
                    type="success"
                    role="status"
                    showIcon
                    title="该版本已安装"
                    description={
                      <div className="feedback-body">
                        <Tag
                          variant="filled"
                          color="success"
                          className="run-state-tag"
                          icon={<Badge status="success" />}
                        >
                          无需重复安装
                        </Tag>
                        <p>相同 ID、版本与摘要已存在，保留当前包定义。</p>
                      </div>
                    }
                  />
                )}
                {!same && templates.some((item) => item.manifest.id === preview.manifest.id) && (
                  <Alert
                    className="template-install-feedback"
                    type="info"
                    role="status"
                    showIcon
                    title="发现新版本"
                    description={
                      <div className="feedback-body">
                        <Tag
                          variant="filled"
                          color="processing"
                          className="run-state-tag"
                          icon={<Badge status="processing" />}
                        >
                          可并存安装
                        </Tag>
                        <p>新版本不会覆盖原实例、计划或运行；采用新版需创建独立实例。</p>
                      </div>
                    }
                  />
                )}
                {preview.consumed && busy !== 'install' && (
                  <Alert
                    className="template-install-feedback"
                    type="warning"
                    showIcon
                    title="本次安装检查已使用。请重新选择 ZIP 后再安装。"
                  />
                )}
                <p>
                  {preview.manifest.scripts.length
                    ? `此包包含 ${preview.manifest.scripts.length} 个脚本。`
                    : '请核对包定义和来源。'}
                  安装不会执行模板代码。
                </p>
                {(!same || conflict) && (
                  <Checkbox
                    checked={reviewed}
                    disabled={!!busy || preview.consumed || !!conflict || undefined}
                    onChange={(e) => setReviewed(e.target.checked)}
                  >
                    我已核对模板来源
                  </Checkbox>
                )}
                <p>创建实例后再按入口配置资源；新实例动作权限默认为禁止。</p>
                {same && !conflict ? (
                  <Button
                    type="primary"
                    disabled={!!busy || undefined}
                    onClick={() =>
                      void work('open-installed', async () => {
                        await cancelPreview();
                        openPackage(same);
                      })
                    }
                  >
                    打开已安装模板
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    disabled={!!busy || !reviewed || preview.consumed || !!conflict || undefined}
                    onClick={() =>
                      void work('install', async () => {
                        const token = preview.token;
                        setPreview({ ...preview, consumed: true });
                        const result = await api('template.install', { token });
                        setRemoved((current) => current.filter((p) => p.key !== result.key));
                        setInstalled(result);
                        setSelectedKey(result.key);
                        setPreview(undefined);
                        setView('installed');
                        await refresh();
                      })
                    }
                  >
                    {busy === 'install' ? '正在安装…' : '确认安装'}
                  </Button>
                )}
                <Button disabled={!!busy || undefined} onClick={() => void selectZip()}>
                  重新选择 ZIP
                </Button>
                <Button disabled={!!busy || undefined} onClick={back}>
                  {same && !conflict ? '返回模板库' : '取消安装'}
                </Button>
              </Card>
            </aside>
          </div>
        )}
        {view === 'installed' && shown && (
          <section
            className="template-installed template-install-receipt"
            aria-label="模板安装结果"
          >
            <Card className="template-catalog-card">
              <Tag
                className="run-state-tag"
                variant="filled"
                color="success"
                icon={<Badge status="success" />}
              >
                安装成功
              </Tag>
              <h2>
                {shown.manifest.name} · v{shown.manifest.version}
              </h2>
              <p>{shown.manifest.entries.length} 个入口 · 普通配置和业务状态由每个实例独立保存。</p>
              <div className="template-catalog-actions">
                {createButton(shown, '创建实例')}
                <Button disabled={!!busy || undefined} onClick={home}>
                  返回模板库
                </Button>
              </div>
            </Card>
          </section>
        )}
        {view === 'package' && pkg && (
          <div className="template-catalog-layout">
            <TemplateManifestOverview key={pkg.key} manifest={pkg.manifest} />
            <aside className="template-catalog-side">
              <Card className="template-catalog-card">
                <h2>创建与管理</h2>
                <p>同一版本可以创建多个实例，配置、资源和业务状态互相独立。</p>
                {createButton(pkg)}
                <Button disabled={!!busy || undefined} onClick={() => showInstances(pkg.key)}>
                  查看此版本实例 · {references.length}
                </Button>
                <Button disabled={!!busy || undefined} onClick={() => exportTemplate(pkg)}>
                  导出原模板 ZIP
                </Button>
                <h3>采用此版本</h3>
                <label>
                  复制已有实例的普通配置
                  <Select<string>
                    value={copyFrom}
                    disabled={!!busy || !!resumeInstance || undefined}
                    onChange={(value) => setCopyFrom(value)}
                    options={[
                      { value: '', label: '选择其他版本的实例…' },
                      ...data.instances
                        .filter(
                          (i) =>
                            i.packageKey.startsWith(pkg.manifest.id + '@') &&
                            i.packageKey !== pkg.key,
                        )
                        .map((i) => ({
                          value: i.id,
                          label: (
                            <>
                              {i.name} · {i.packageKey}
                            </>
                          ),
                        })),
                    ]}
                  />
                </label>
                <p className="template-catalog-muted">
                  仅复制符合新 Schema 的配置，否则使用默认值；资源、授权和业务状态不复制。
                </p>
                <Button
                  disabled={!copyFrom || !!busy || !!resumeInstance || undefined}
                  onClick={() => void create(pkg, copyFrom)}
                >
                  创建此版本的新实例
                </Button>
                <Divider />
                <p className="template-catalog-muted">安装于 {date(pkg.installedAt)}</p>
                <Button
                  disabled={!!busy || undefined}
                  danger
                  data-catalog-focus="review-package-removal"
                  onClick={() => {
                    remember();
                    setRemoveReviewed(false);
                    setView('remove');
                  }}
                >
                  卸载此版本…
                </Button>
              </Card>
            </aside>
          </div>
        )}
        {view === 'instances' && (
          <>
            <div className="template-catalog-toolbar">
              <strong>{instances.length} 个实例</strong>
              <label>
                <span className="sr-only">搜索实例</span>
                <Input
                  ref={instanceSearch}
                  type="search"
                  value={instanceQuery}
                  onChange={(e) => setInstanceQuery(e.target.value)}
                  placeholder="实例名称或版本"
                />
              </label>
              <label>
                <span className="sr-only">模板版本</span>
                <Select<string>
                  value={instanceFilter}
                  onChange={(value) => setInstanceFilter(value)}
                  options={[
                    { value: '', label: '全部版本' },
                    ...[
                      ...new Set([
                        ...templates.map((item) => item.key),
                        ...data.instances.map((i) => i.packageKey),
                      ]),
                    ].map((key) => ({ value: key, label: key })),
                  ]}
                />
              </label>
            </div>
            <div className="template-instance-list">
              {instances.map((i) => {
                const source = templates.find((item) => item.key === i.packageKey);
                return (
                  <article className="template-instance-card" key={i.id}>
                    <Card className="template-catalog-card">
                      <h2 title={`创建于 ${date(i.createdAt)}`}>{i.name}</h2>
                      <p>
                        {source
                          ? `${instanceFilter ? '' : source.manifest.name + ' · '}v${source.manifest.version}`
                          : i.packageKey}
                        {' · '}
                        {Object.keys(i.entryFlows).length} 个入口
                        {' · '}已保存 {Object.keys(i.resources).length} 项资源，运行前复核
                      </p>
                      <Button
                        type="primary"
                        disabled={!!busy || undefined}
                        data-catalog-focus={`instance-${i.id}`}
                        onClick={() => {
                          remember();
                          void openInstance(i.id);
                        }}
                      >
                        打开实例
                      </Button>
                    </Card>
                  </article>
                );
              })}
            </div>
            {!instances.length && (
              <Card className="template-catalog-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <>
                      <h2>没有匹配的实例</h2>
                      <p>从模板详情创建独立实例，或调整搜索和版本筛选。</p>
                    </>
                  }
                >
                  <Button
                    onClick={() => {
                      setInstanceFilter('');
                      setInstanceQuery('');
                      instanceSearch.current?.focus();
                    }}
                  >
                    查看全部实例
                  </Button>
                  <Button onClick={home}>选择模板</Button>
                </Empty>
              </Card>
            )}
          </>
        )}
        {view === 'remove' && pkg && (
          <section className="template-installed">
            <Card className="template-catalog-card">
              <Tag
                className="run-state-tag"
                variant="filled"
                color={referenced ? 'warning' : 'default'}
                icon={<Badge status={referenced ? 'warning' : 'default'} />}
              >
                {referenced ? '不能卸载' : '核对后卸载'}
              </Tag>
              <h2>{referenced ? '该版本仍被引用' : '核对要卸载的版本'}</h2>
              <p>
                {pkg.manifest.name} · v{pkg.manifest.version}
              </p>
              <p>
                {referenced
                  ? '现有实例或流程仍在使用此版本，不能卸载。其他版本可以并存，不会覆盖这些引用。'
                  : '卸载会移除这台 Mac 上的此版本包定义。重新使用时需要再次导入原 ZIP。'}
              </p>
              <p>
                当前列表中有 {references.length} 个实例、{flowRefs.length}{' '}
                个流程引用此版本。历史版本、计划和 Run 的引用仍由宿主最终检查。
              </p>
              {references.length > 0 && (
                <Button
                  disabled={!!busy || undefined}
                  data-catalog-focus="view-package-references"
                  onClick={() => showInstances(pkg.key)}
                >
                  查看引用此版本的实例
                </Button>
              )}
              {!referenced && (
                <Checkbox
                  checked={removeReviewed}
                  disabled={!!busy || undefined}
                  onChange={(e) => setRemoveReviewed(e.target.checked)}
                >
                  确认只卸载这个模板版本
                </Checkbox>
              )}
              <div className="template-catalog-actions">
                {!referenced && (
                  <Button
                    danger
                    disabled={!!busy || !removeReviewed || undefined}
                    onClick={() =>
                      void work('remove', async () => {
                        await api('template.remove', { key: pkg.key });
                        setRemoved((current) => [...current, structuredClone(pkg)]);
                        home();
                        setNotice(
                          `${pkg.manifest.name} · v${pkg.manifest.version}已卸载，其他版本保持不变。`,
                        );
                        await refresh();
                        setRemoved([]);
                      })
                    }
                  >
                    {busy === 'remove' ? '正在卸载…' : '确认卸载'}
                  </Button>
                )}
                <Button disabled={!!busy || undefined} onClick={back}>
                  保留，返回模板详情
                </Button>
              </div>
            </Card>
          </section>
        )}
        {['package', 'remove'].includes(view) && !pkg && (
          <Card className="template-catalog-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <>
                  <h2>此版本已不在当前模板库</h2>
                  <p>请返回列表核对，或重新选择 ZIP 导入。</p>
                </>
              }
            >
              <Button onClick={home}>返回模板库</Button>
            </Empty>
          </Card>
        )}
      </section>
    </>
  );
}
