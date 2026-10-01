import { useEffect, useRef, useState } from 'react';
import type { Bootstrap, BrowserBinding, FlowRecord } from '../shared/types';
import type { AIProviderId } from '../shared/ai-settings';
import { AISettingsSummary } from './AISettingsPage';
import './local-settings.css';
import LocalStoragePanel from './LocalStoragePanel';
import LocalCredentialsPanel from './LocalCredentialsPanel';

const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
const browserName = (product: BrowserBinding['product']) =>
  ({ embedded: '内置浏览器', chrome: 'Google Chrome', firefox: 'Firefox', safari: 'Safari' })[
    product
  ];
const tabs = [
  ['browser', '浏览器'],
  ['ai', 'AI 服务'],
  ['resources', '凭据与本机资源'],
  ['scripts', '脚本包'],
] as const;
type Tab = (typeof tabs)[number][0];
type Session = { started: boolean; visible: boolean; url: string; blocked?: string };
export type SettingsNavigation = { title: string; back?: () => void; busy?: boolean };

export default function LocalSettingsPage({
  data,
  active,
  refresh,
  openAI,
  openFlow,
  openTools,
  openRuns,
  showBrowser,
  navigation,
  browserRequest = 0,
}: {
  data: Bootstrap;
  active: boolean;
  refresh: () => Promise<void>;
  openAI: (provider: AIProviderId, model: string) => void;
  openFlow: (flow: FlowRecord) => Promise<void>;
  openTools: () => void;
  openRuns: () => void;
  showBrowser: () => void;
  navigation: (value: SettingsNavigation | undefined) => void;
  browserRequest?: number;
}) {
  const [tab, setTab] = useState<Tab>('browser');
  const [local, setLocal] = useState(false);
  const resourcesPage = tab === 'resources';
  const resourceEntry = useRef('settings-tab-resources');
  const returningResources = useRef(false);
  useEffect(() => {
    if (!browserRequest) return;
    setTab('browser');
    setLocal(false);
  }, [browserRequest]);
  const [candidates, setCandidates] = useState<BrowserBinding[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [path, setPath] = useState('');
  const [driver, setDriver] = useState('');
  const [picked, setPicked] = useState<BrowserBinding>();
  const [receipt, setReceipt] = useState<BrowserBinding>();
  const [savedBindings, setSavedBindings] = useState<BrowserBinding[]>([]);
  const [refreshError, setRefreshError] = useState('');
  const [busy, setBusy] = useState('');
  const [completion, setCompletion] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState<Session>();
  const [sessionError, setSessionError] = useState('');
  const [statusRevision, setStatusRevision] = useState(0);
  const [query, setQuery] = useState('');
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const bindingEntry = useRef<HTMLButtonElement>(null);
  const errorBanner = useRef<HTMLDivElement>(null);
  const receiptBanner = useRef<HTMLDivElement>(null);
  const refreshBanner = useRef<HTMLDivElement>(null);
  const restoreEntry = useRef(false);
  const focusAfter = useRef<HTMLElement | 'error' | 'receipt' | 'refresh' | undefined>(undefined);
  const visible = useRef(active);
  visible.current = active;

  const embedded = data.browsers.find((b) => b.product === 'embedded');
  // Keep acknowledged writes visible if the independent list refresh fails.
  const bound = [
    ...savedBindings,
    ...data.browsers.filter(
      (b) => b.product !== 'embedded' && !savedBindings.some((saved) => saved.id === b.id),
    ),
  ];
  const choices = [...bound, ...candidates.filter((c) => !bound.some((b) => b.id === c.id))];
  const fileFlows = data.flows.filter(
    (flow) =>
      Object.values(flow.bindings.files).some(Boolean) ||
      Object.values(flow.bindings.resources ?? {}).some((resource) => resource.path),
  );
  const packages = data.flows.flatMap((flow) =>
    Object.entries(flow.bindings.scriptPackages ?? {}).map(([name, binding]) => ({
      flow,
      name,
      ...binding,
    })),
  );
  const back = () => {
    if (locked.current) return;
    if (resourcesPage) {
      returningResources.current = true;
      setTab('browser');
    } else restoreEntry.current = true;
    setLocal(false);
    setError('');
    setNotice('');
  };
  useEffect(() => {
    if (!active) return;
    navigation({
      title: resourcesPage
        ? '凭据与本机资源'
        : local && tab === 'browser'
          ? '本机浏览器绑定'
          : '本地设置',
      back: resourcesPage || (local && tab === 'browser') ? back : undefined,
      busy: !!busy,
    });
    return () => navigation(undefined);
  }, [active, local, tab, navigation, busy]);
  useEffect(() => {
    if (!active || tab !== 'browser') return;
    let live = true,
      pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await api('browser.embedded.status');
        if (live) {
          setSession(next);
          setSessionError('');
        }
      } catch (reason) {
        if (live) {
          setSession(undefined);
          setSessionError('暂未取得网页会话状态，请重试');
        }
      } finally {
        pending = false;
      }
    };
    void read();
    const timer = setInterval(read, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, tab, statusRevision]);
  useEffect(() => {
    if (!active) return;
    if (returningResources.current && !resourcesPage) {
      returningResources.current = false;
      const origin = document.getElementById(resourceEntry.current);
      if (origin?.isConnected && !origin.closest('[hidden]')) origin.focus({ preventScroll: true });
      else document.getElementById('settings-tab-resources')?.focus();
    } else if (restoreEntry.current && !local) {
      restoreEntry.current = false;
      bindingEntry.current?.focus({ preventScroll: true });
    } else heading.current?.focus({ preventScroll: true });
  }, [active, local, resourcesPage]);
  useEffect(() => {
    if (busy || !focusAfter.current) return;
    const pending = focusAfter.current;
    focusAfter.current = undefined;
    const target =
      pending === 'error'
        ? errorBanner.current
        : pending === 'receipt'
          ? receiptBanner.current
          : pending === 'refresh'
            ? refreshBanner.current
            : pending;
    if (visible.current && target?.isConnected && !target.closest('[hidden]')) {
      target.focus({ preventScroll: false });
    }
  }, [busy, completion]);
  const act = async (key: string, operation: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    focusAfter.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (reason) {
      focusAfter.current = 'error';
      setError(
        (reason instanceof Error ? reason.message : '操作未完成，请重试').replace(
          /^Error invoking remote method 'flowark:request': (?:Error: )?/,
          '',
        ),
      );
    } finally {
      locked.current = false;
      setBusy('');
      setCompletion((value) => value + 1);
    }
  };
  const select = (b: BrowserBinding) => {
    setPicked(b);
    setPath(b.executable);
    setDriver(b.driver ?? '');
    setReceipt(undefined);
    setError('');
    setNotice('');
  };
  const choose = (kind: 'browser' | 'driver') =>
    act('choose', async () => {
      const value = await api('file.choose', { kind });
      if (!value) return;
      setReceipt(undefined);
      if (kind === 'driver') setDriver(value);
      else {
        setPath(value);
        setDriver('');
        setPicked(undefined);
      }
    });
  const save = () =>
    act('save', async () => {
      if (receipt) return;
      const next = (await api('browser.bind', {
        path,
        ...(driver ? { driver } : {}),
      })) as BrowserBinding;
      setReceipt(next);
      setSavedBindings((current) => [next, ...current.filter((b) => b.id !== next.id)]);
      setPicked(next);
      setPath(next.executable);
      setDriver(next.driver ?? '');
      await refreshBindings();
    });
  const refreshBindings = async () => {
    setRefreshError('');
    try {
      await refresh();
      setSavedBindings([]);
      focusAfter.current = local ? 'receipt' : (bindingEntry.current ?? undefined);
    } catch {
      setRefreshError(
        '已保存的绑定未撤销，但设置列表尚未刷新。可以重新读取列表，无需再次保存绑定。',
      );
      focusAfter.current = 'refresh';
    }
  };
  const changeTab = (next: Tab, focusTab = false) => {
    if (locked.current) return;
    if (next === 'resources')
      resourceEntry.current = document.activeElement?.id || 'settings-tab-resources';
    setTab(next);
    setError('');
    setNotice('');
    setQuery('');
    if (focusTab && next !== 'resources')
      requestAnimationFrame(() => document.getElementById(`settings-tab-${next}`)?.focus());
  };
  const flowLink = (flow: FlowRecord) => (
    <button disabled={!!busy} onClick={() => void act('flow', () => openFlow(flow))}>
      打开流程配置
    </button>
  );
  return (
    <section
      className={`page local-settings-page${local && tab === 'browser' ? ' local-browser-binding-page' : ''}${resourcesPage ? ' local-resources-page' : ''}`}
      hidden={!active}
      aria-label="本地设置"
    >
      <header className="local-settings-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {resourcesPage
              ? '凭据与本机资源'
              : local && tab === 'browser'
                ? '选择本机浏览器'
                : '本地设置'}
          </h1>
          <p>
            {resourcesPage
              ? '本地路径与密钥不随 ZIP 导出；资源只提供给明确绑定的流程。'
              : local && tab === 'browser'
                ? '实际使用你选择的安装；失效时阻止运行，不下载或自动切换。'
                : '管理运行环境、模型接口和这台 Mac 的资源。'}
          </p>
        </div>
      </header>
      <div
        className="local-settings-tabs"
        role="tablist"
        aria-label="设置分类"
        hidden={resourcesPage || (local && tab === 'browser')}
      >
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            role="tab"
            disabled={!!busy}
            id={`settings-tab-${id}`}
            aria-controls="settings-content"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => changeTab(id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : event.key === 'ArrowRight'
                      ? (index + 1) % tabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + tabs.length - 1) % tabs.length
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              changeTab(tabs[next][0]);
              (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="local-settings-banner error" role="alert" ref={errorBanner} tabIndex={-1}>
          {error}
        </div>
      )}
      {notice && (
        <div className="local-settings-banner success" role="status">
          {notice}
        </div>
      )}
      <div id="settings-content" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'browser' &&
          (!local ? (
            <div className="local-settings-layout local-browser-overview">
              <section className="local-settings-card local-browser-options">
                <h2>浏览器执行方式</h2>
                <button
                  className={`local-browser-mode${embedded ? ' is-ready' : ''}`}
                  aria-label={embedded ? '打开右侧网页面板' : '启用内置浏览器'}
                  disabled={!!busy}
                  onClick={() =>
                    embedded
                      ? showBrowser()
                      : void act('enable', async () => {
                          await api('browser.embedded.enable');
                          await refresh();
                          setStatusRevision((v) => v + 1);
                          setNotice('已启用内置浏览器，请在流程资源中选择。');
                        })
                  }
                >
                  <span className="local-browser-mode-title">
                    内置浏览器
                    <span>
                      {busy === 'enable' ? '正在启用…' : embedded ? '打开网页 →' : '启用 →'}
                    </span>
                  </span>
                  <span className="local-browser-mode-description">
                    在主窗口右侧操作网页，复用应用内核。
                  </span>
                </button>
                <button
                  className="local-browser-mode"
                  ref={bindingEntry}
                  disabled={!!busy}
                  aria-label="选择与管理本机浏览器"
                  onClick={() => {
                    setLocal(true);
                    setError('');
                    setNotice('');
                  }}
                >
                  <span className="local-browser-mode-title">
                    本机浏览器
                    <span>{bound.length ? `${bound.length} 个绑定 · 管理 →` : '选择与管理 →'}</span>
                  </span>
                  <span className="local-browser-mode-description">
                    使用你已安装并明确选择的浏览器。
                  </span>
                </button>
                <div className="local-settings-divider" />
                {refreshError && (
                  <div
                    className="local-settings-banner warning"
                    role="alert"
                    ref={refreshBanner}
                    tabIndex={-1}
                  >
                    <p>{refreshError}</p>
                    <button disabled={!!busy} onClick={() => void act('refresh', refreshBindings)}>
                      {busy === 'refresh' ? '正在读取列表…' : '重新读取设置列表'}
                    </button>
                  </div>
                )}
                <h2>网页展示</h2>
                <dl className="local-settings-facts">
                  <div>
                    <dt>页面布局</dt>
                    <dd>桌面宽度 · 1920 CSS px</dd>
                  </div>
                </dl>
                <p className="local-browser-display-note">
                  右侧面板等比缩放显示，展开与收起保留会话。
                </p>
                <p className="local-settings-muted">
                  执行方式在每个流程的资源中选择；启用或绑定不会改动已有流程。
                </p>
              </section>
              <aside className="local-settings-card local-environment">
                <h2>环境状态</h2>
                <div className="local-settings-health">
                  <div className="local-health-heading">
                    <h3>浏览器</h3>
                    <span
                      className={`badge ${sessionError || session?.blocked ? 'state-INTERRUPTED' : session && embedded ? 'state-SUCCEEDED' : ''}`}
                    >
                      {sessionError
                        ? '状态未取得'
                        : !session
                          ? '读取中'
                          : session.blocked
                            ? '待核对'
                            : embedded
                              ? '已启用'
                              : '未启用'}
                    </span>
                  </div>
                  <p role={sessionError ? 'alert' : undefined}>
                    {sessionError || !session
                      ? '会话状态尚未确认。'
                      : session.blocked
                        ? '原会话回收尚未确认。'
                        : session.started
                          ? session.visible
                            ? '网页面板已显示'
                            : '会话在后台运行'
                          : '尚未打开网页会话'}
                  </p>
                </div>
                <div className="local-settings-health">
                  <button
                    className="local-health-link"
                    onClick={() => changeTab('ai', true)}
                    aria-label="管理 AI 服务"
                  >
                    <span>AI 服务</span>
                    <span className="badge">
                      {data.credentials.some((id) => id === 'deepseek' || id === 'openai-codex')
                        ? '已配置 · 待核对'
                        : '未配置'}
                    </span>
                  </button>
                  <p>
                    {data.credentials.some((id) => id === 'deepseek' || id === 'openai-codex')
                      ? '连接验证状态在 AI 服务中查看。'
                      : '尚未配置服务密钥。'}
                  </p>
                </div>
                <div className="local-settings-health">
                  <button
                    className="local-health-link"
                    onClick={() => changeTab('resources', true)}
                    id="settings-file-resources"
                    aria-label="查看文件与存储"
                  >
                    <span>输出与文件</span>
                    <span className="badge">
                      {fileFlows.length ? `${fileFlows.length} 个流程有绑定` : '未绑定'}
                    </span>
                  </button>
                  <p>按流程保存本机文件或目录绑定。</p>
                </div>
                <div className="local-settings-health">
                  <button
                    className="local-health-link"
                    onClick={() => changeTab('resources', true)}
                    id="settings-credential-resources"
                    aria-label="管理本机凭据"
                  >
                    <span>凭据保护</span>
                    <span className="badge">保存时核验</span>
                  </button>
                  <p>系统保护不可用时拒绝保存。</p>
                </div>
                <p className="local-settings-muted">只有使用相应资源的流程才需要完成绑定。</p>
                <details className="local-session-details">
                  <summary>网页会话详情</summary>
                  <p className="local-settings-path">
                    {sessionError ||
                      session?.blocked ||
                      session?.url ||
                      '打开网页或执行网页步骤时才创建会话。'}
                  </p>
                  <button onClick={() => setStatusRevision((v) => v + 1)}>重新读取状态</button>
                  <p className="local-settings-muted">
                    收起面板不会停止运行；最小化不阻止电脑休眠，退出后停止执行与调度。
                  </p>
                </details>
              </aside>
            </div>
          ) : (
            <section className="local-settings-card local-browser-binding" aria-busy={!!busy}>
              <div className="local-browser-binding-fields">
                <div className="local-settings-field">
                  <label htmlFor="local-browser-mode">执行方式</label>
                  <input id="local-browser-mode" readOnly value="本机已安装浏览器" />
                </div>
                <div className="local-settings-field">
                  <label htmlFor="local-browser-choice">浏览器</label>
                  <div className="local-browser-discovery-row">
                    <select
                      id="local-browser-choice"
                      disabled={!!busy}
                      value={picked?.id ?? ''}
                      onChange={(event) => {
                        const next = choices.find((item) => item.id === event.target.value);
                        if (next) select(next);
                      }}
                    >
                      <option value="" disabled>
                        {path ? '手动选择的安装 · 保存时识别' : '选择已发现或已绑定的浏览器'}
                      </option>
                      {choices.map((b) => (
                        <option key={b.id} value={b.id}>
                          {browserName(b.product)} · {b.version} ·{' '}
                          {bound.some((item) => item.id === b.id) ? '已保存' : '尚未绑定'}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        void act('discover', async () => {
                          setCandidates(await api('browser.discover'));
                          setDiscovered(true);
                        })
                      }
                    >
                      {busy === 'discover' ? '正在发现…' : '发现已安装浏览器'}
                    </button>
                  </div>
                  {discovered && !choices.length && (
                    <p role="status">未发现支持的安装，请通过下方选择应用。</p>
                  )}
                </div>
                <div className="local-settings-field">
                  <label htmlFor="local-browser-path">安装位置</label>
                  <button
                    id="local-browser-path"
                    className="local-browser-file-choice"
                    disabled={!!busy}
                    aria-label="选择应用"
                    title={path || undefined}
                    onClick={() => void choose('browser')}
                  >
                    {path || '[从这台 Mac 选择应用]'}
                  </button>
                </div>
                <div className="local-settings-field local-browser-driver-field">
                  <label htmlFor="local-driver-path">驱动来源（Firefox 需要）</label>
                  <button
                    id="local-driver-path"
                    className="local-browser-file-choice"
                    disabled={!!busy || picked?.product === 'safari'}
                    aria-label="选择驱动"
                    title={driver || undefined}
                    onClick={() => void choose('driver')}
                  >
                    {picked?.product === 'safari'
                      ? '使用系统 safaridriver'
                      : driver || '手动选择已准备的驱动'}
                  </button>
                  {driver && picked?.product !== 'safari' && (
                    <button
                      className="local-browser-clear-driver"
                      disabled={!!busy}
                      onClick={() => {
                        setDriver('');
                        setReceipt(undefined);
                      }}
                    >
                      清除驱动选择
                    </button>
                  )}
                </div>
                <div
                  className="local-browser-binding-receipt"
                  role="status"
                  ref={receiptBanner}
                  tabIndex={-1}
                >
                  <span
                    className={`badge ${receipt ? (receipt.product === 'firefox' && !receipt.driver ? 'state-INTERRUPTED' : 'state-SUCCEEDED') : ''}`}
                  >
                    {receipt ? '绑定已保存' : path ? '尚未检测保存' : '尚未选择本机安装'}
                  </span>
                  {receipt && (
                    <>
                      <strong>
                        {browserName(receipt.product)} · {receipt.version}
                      </strong>
                      <p>
                        {receipt.product === 'firefox' && !receipt.driver
                          ? '尚未选择 geckodriver，Firefox 任务仍会被阻止。'
                          : '安装信息检测通过；网页操作与环境兼容性仍以实际运行为准。'}
                      </p>
                      {receipt.driverVersion && <p>{receipt.driverVersion}</p>}
                    </>
                  )}
                </div>
              </div>
              {refreshError && (
                <div
                  className="local-settings-banner warning"
                  role="alert"
                  ref={refreshBanner}
                  tabIndex={-1}
                >
                  <strong>设置列表刷新失败</strong>
                  <p>{refreshError}</p>
                  <button disabled={!!busy} onClick={() => void act('refresh', refreshBindings)}>
                    {busy === 'refresh' ? '正在读取列表…' : '重新读取设置列表'}
                  </button>
                </div>
              )}
              <div className="local-settings-actions">
                <button
                  className="primary"
                  disabled={!path || !!busy || !!receipt}
                  onClick={() => void save()}
                >
                  {busy === 'save' ? '正在检测并保存…' : receipt ? '绑定已保存' : '检测并保存'}
                </button>
                <button disabled={!!busy} onClick={back}>
                  返回浏览器设置
                </button>
              </div>
              <p className="local-settings-muted">
                请在流程资源中明确选择浏览器。返回不修改已有绑定，也不关闭用户原有窗口。
              </p>
              <details className="local-browser-binding-help">
                <summary>浏览器与驱动说明</summary>
                <p>发现只读取安装信息；检测并保存后才可在流程中选择。</p>
                <p>
                  不自动下载驱动或浏览器。Safari 使用系统驱动；Chrome 不需要驱动文件，Firefox
                  需显式选择 geckodriver。
                </p>
              </details>
            </section>
          ))}
        {tab === 'ai' && active && <AISettingsSummary open={openAI} />}
        {resourcesPage && active && (
          <div className="local-resources-layout">
            <LocalCredentialsPanel
              compact
              data={data}
              refresh={refresh}
              openAI={() => changeTab('ai', true)}
              openTools={openTools}
              openFlow={openFlow}
            />
            <LocalStoragePanel
              compact
              data={data}
              busy={!!busy}
              openFlow={(flow) => void act('flow', () => openFlow(flow))}
              openRuns={openRuns}
              showData={() =>
                void act('data', async () => {
                  await api('app.showData');
                  setNotice('已请求在文件管理器中打开数据目录。');
                })
              }
            />
          </div>
        )}
        {tab === 'scripts' && (
          <section className="local-settings-card">
            <h2>脚本包绑定</h2>
            <p>按流程保存本地包目录与精确版本。更改依赖需进入对应脚本步骤，不自动安装依赖。</p>
            <label className="local-settings-search">
              搜索脚本包
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="按包名或流程名称筛选"
              />
            </label>
            {packages
              .filter((p) =>
                `${p.name} ${p.flow.flow.name}`
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()),
              )
              .map((p) => (
                <article className="local-settings-resource" key={`${p.flow.id}:${p.name}`}>
                  <div className="local-settings-row">
                    <h3>
                      {p.name} · {p.version}
                    </h3>
                    {flowLink(p.flow)}
                  </div>
                  <p>{p.flow.flow.name}</p>
                  <p className="local-settings-path">{p.path}</p>
                </article>
              ))}
            {!packages.some((p) =>
              `${p.name} ${p.flow.flow.name}`
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase()),
            ) && (
              <div className="local-settings-empty">
                {query
                  ? '没有匹配的脚本包。'
                  : '尚未绑定本地脚本包，在脚本步骤中选择已安装的包目录。'}
              </div>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
