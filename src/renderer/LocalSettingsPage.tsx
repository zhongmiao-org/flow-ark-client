import { useEffect, useRef, useState } from 'react';
import type { Bootstrap, BrowserBinding, FlowRecord } from '../shared/types';
import type { AIProviderId } from '../shared/ai-settings';
import { AISettingsSummary } from './AISettingsPage';
import './local-settings.css';
import LocalStoragePanel from './LocalStoragePanel';

const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
const browserName = (product: BrowserBinding['product']) =>
  ({ embedded: '内置浏览器', chrome: 'Google Chrome', firefox: 'Firefox', safari: 'Safari' })[
    product
  ];
const tabs = [
  ['browser', '浏览器'],
  ['ai', 'AI 服务'],
  ['credentials', '凭据'],
  ['storage', '文件与存储'],
  ['scripts', '脚本包'],
] as const;
type Tab = (typeof tabs)[number][0];
type Session = { started: boolean; visible: boolean; url: string; blocked?: string };
export type SettingsNavigation = { title: string; back?: () => void };

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
}) {
  const [tab, setTab] = useState<Tab>('browser');
  const [local, setLocal] = useState(false);
  const [candidates, setCandidates] = useState<BrowserBinding[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [path, setPath] = useState('');
  const [driver, setDriver] = useState('');
  const [picked, setPicked] = useState<BrowserBinding>();
  const [receipt, setReceipt] = useState<BrowserBinding>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState<Session>();
  const [sessionError, setSessionError] = useState('');
  const [statusRevision, setStatusRevision] = useState(0);
  const [query, setQuery] = useState('');
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const embedded = data.browsers.find((b) => b.product === 'embedded');
  const bound = data.browsers.filter((b) => b.product !== 'embedded');
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
    setLocal(false);
    setError('');
    setNotice('');
  };
  useEffect(() => {
    if (!active) return;
    navigation({
      title: local && tab === 'browser' ? '本机浏览器绑定' : '本地设置',
      back: local && tab === 'browser' ? back : undefined,
    });
    return () => navigation(undefined);
  }, [active, local, tab, navigation]);
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
    if (active) heading.current?.focus({ preventScroll: true });
  }, [active, local]);
  const act = async (key: string, operation: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (reason) {
      setError(
        (reason instanceof Error ? reason.message : '操作未完成，请重试').replace(
          /^Error invoking remote method 'flowark:request': (?:Error: )?/,
          '',
        ),
      );
    } finally {
      locked.current = false;
      setBusy('');
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
      const next = (await api('browser.bind', {
        path,
        ...(driver ? { driver } : {}),
      })) as BrowserBinding;
      setReceipt(next);
      setPicked(next);
      setPath(next.executable);
      setDriver(next.driver ?? '');
      await refresh();
      setNotice('已检测安装信息并保存绑定。请在需要它的流程中明确选择此浏览器。');
    });
  const changeTab = (next: Tab) => {
    setTab(next);
    setError('');
    setNotice('');
    setQuery('');
  };
  const flowLink = (flow: FlowRecord) => (
    <button disabled={!!busy} onClick={() => void act('flow', () => openFlow(flow))}>
      打开流程配置
    </button>
  );
  return (
    <section className="page local-settings-page" hidden={!active} aria-label="本地设置">
      <header className="local-settings-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {local && tab === 'browser' ? '选择本机浏览器' : '本地设置'}
          </h1>
          <p>
            {local && tab === 'browser'
              ? '实际使用你选择的安装；失效时阻止运行，不下载或自动切换。'
              : '管理运行环境、模型接口和这台 Mac 的资源。'}
          </p>
        </div>
        {local && tab === 'browser' && (
          <button onClick={back} disabled={!!busy}>
            返回浏览器设置
          </button>
        )}
      </header>
      <div className="local-settings-tabs" role="tablist" aria-label="设置分类">
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
        <div className="local-settings-banner error" role="alert">
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
            <div className="local-settings-layout">
              <section className="local-settings-card">
                <h2>浏览器执行方式</h2>
                <p>先准备本机资源，再在每个流程中明确选择执行方式。</p>
                <div className={`local-browser-mode${embedded ? ' is-ready' : ''}`}>
                  <div className="local-settings-row">
                    <h3>内置浏览器</h3>
                    <span className="local-settings-status">
                      {embedded ? '已启用' : '尚未启用'}
                    </span>
                  </div>
                  <p>在主窗口右侧操作网页，复用应用内核。</p>
                  {embedded ? (
                    <button onClick={showBrowser}>打开右侧网页面板</button>
                  ) : (
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() =>
                        void act('enable', async () => {
                          await api('browser.embedded.enable');
                          await refresh();
                          setStatusRevision((v) => v + 1);
                          setNotice('已启用内置浏览器，请在流程资源中选择。');
                        })
                      }
                    >
                      {busy === 'enable' ? '正在启用…' : '启用内置浏览器'}
                    </button>
                  )}
                </div>
                <div className="local-browser-mode">
                  <div className="local-settings-row">
                    <h3>本机浏览器</h3>
                    <span className="local-settings-status">
                      {bound.length ? `已保存 ${bound.length} 个绑定` : '尚未绑定'}
                    </span>
                  </div>
                  <p>使用你已安装并明确选择的浏览器。</p>
                  <button
                    onClick={() => {
                      setLocal(true);
                      setError('');
                      setNotice('');
                    }}
                  >
                    选择与管理本机浏览器
                  </button>
                </div>
                <div className="local-settings-divider" />
                <h3>网页展示</h3>
                <dl className="local-settings-facts">
                  <div>
                    <dt>页面布局</dt>
                    <dd>桌面宽度 · 1920 CSS px</dd>
                  </div>
                  <div>
                    <dt>展示位置</dt>
                    <dd>主窗口右侧面板，等比缩放</dd>
                  </div>
                </dl>
                <p>展开与收起保留会话；收起面板不会停止运行。</p>
              </section>
              <aside className="local-settings-card">
                <h2>环境状态</h2>
                <div className="local-settings-health">
                  <h3>内置网页</h3>
                  {sessionError ? (
                    <>
                      <p role="alert">{sessionError}</p>
                      <button onClick={() => setStatusRevision((v) => v + 1)}>重新读取状态</button>
                    </>
                  ) : (
                    <>
                      <strong>
                        {!session
                          ? '正在读取状态…'
                          : session.blocked
                            ? '资源回收待确认'
                            : session.started
                              ? session.visible
                                ? '网页面板已显示'
                                : '会话在后台运行'
                              : '尚未打开会话'}
                      </strong>
                      <p className="local-settings-path">
                        {session?.blocked ||
                          session?.url ||
                          '只有打开网页或执行网页步骤时才创建会话。'}
                      </p>
                    </>
                  )}
                </div>
                <div className="local-settings-health">
                  <h3>AI 服务</h3>
                  <p>
                    {data.credentials.some((id) => id === 'deepseek' || id === 'openai-codex')
                      ? '已有服务配置，连接状态在 AI 服务中查看。'
                      : '尚未配置服务密钥。'}
                  </p>
                  <button onClick={() => changeTab('ai')}>管理 AI 服务</button>
                </div>
                <div className="local-settings-health">
                  <h3>输出与文件</h3>
                  <p>{fileFlows.length} 个流程保存了本机文件或目录绑定。</p>
                  <button onClick={() => changeTab('storage')}>查看文件与存储</button>
                </div>
                <p className="local-settings-muted">
                  只有使用相应资源的流程才需要完成绑定。最小化不会阻止电脑休眠；应用退出后停止执行与调度。
                </p>
              </aside>
            </div>
          ) : (
            <section className="local-settings-card local-browser-binding">
              <div className="local-settings-row">
                <h2>本机浏览器绑定</h2>
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
              <p>发现结果只读取安装信息；检测并保存后，才可在流程中选择。</p>
              <div className="local-browser-choices" role="group" aria-label="本机浏览器">
                {choices.map((b) => (
                  <button
                    key={b.id}
                    disabled={!!busy}
                    aria-pressed={picked?.id === b.id}
                    onClick={() => select(b)}
                  >
                    <strong>{browserName(b.product)}</strong>
                    <span>{b.version}</span>
                    <small>
                      {bound.some((x) => x.id === b.id) ? '已保存绑定' : '已发现 · 尚未绑定'}
                    </small>
                    <span className="local-settings-path">{b.executable}</span>
                  </button>
                ))}
              </div>
              {!choices.length && (
                <div className="local-settings-empty">
                  {discovered
                    ? '未发现支持的安装，请手动选择这台 Mac 上的浏览器应用。'
                    : '可以发现已安装浏览器，也可以直接选择安装位置。'}
                </div>
              )}
              <div className="local-settings-field">
                <label htmlFor="local-browser-path">安装位置</label>
                <div>
                  <input
                    id="local-browser-path"
                    readOnly
                    value={path}
                    placeholder="从这台 Mac 选择浏览器应用"
                  />
                  <button disabled={!!busy} onClick={() => void choose('browser')}>
                    选择应用
                  </button>
                </div>
              </div>
              <div className="local-settings-field">
                <label htmlFor="local-driver-path">驱动来源（Firefox 需要）</label>
                <div>
                  <input
                    id="local-driver-path"
                    readOnly
                    value={driver}
                    placeholder={
                      picked?.product === 'safari'
                        ? '使用系统 safaridriver'
                        : '手动选择已准备的驱动'
                    }
                  />
                  <button
                    disabled={!!busy || picked?.product === 'safari'}
                    onClick={() => void choose('driver')}
                  >
                    选择驱动
                  </button>
                  {driver && picked?.product !== 'safari' && (
                    <button
                      disabled={!!busy}
                      onClick={() => {
                        setDriver('');
                        setReceipt(undefined);
                      }}
                    >
                      清除选择
                    </button>
                  )}
                </div>
                <p>不自动下载驱动或浏览器。Safari 使用系统驱动；Chrome 不需要此字段。</p>
              </div>
              <div
                className={`local-settings-banner ${receipt ? (receipt.product === 'firefox' && !receipt.driver ? 'warning' : 'success') : ''}`}
                role="status"
              >
                {receipt ? (
                  <>
                    <strong>
                      {browserName(receipt.product)} · {receipt.version} · 绑定已保存
                    </strong>
                    <p>
                      {receipt.product === 'firefox' && !receipt.driver
                        ? '尚未选择 geckodriver，Firefox 任务仍会被阻止。'
                        : '安装信息检测通过；网页操作与环境兼容性仍以实际运行为准。'}
                    </p>
                    {receipt.driverVersion && <p>{receipt.driverVersion}</p>}
                  </>
                ) : path ? (
                  '安装位置已选择，尚未检测保存。'
                ) : (
                  '尚未选择本机安装。'
                )}
              </div>
              <div className="local-settings-actions">
                <button className="primary" disabled={!path || !!busy} onClick={() => void save()}>
                  {busy === 'save' ? '正在检测并保存…' : '检测并保存'}
                </button>
                <button disabled={!!busy} onClick={back}>
                  返回内置模式
                </button>
              </div>
              <p className="local-settings-muted">
                返回只切换设置页面，不修改任何流程的浏览器绑定，也不关闭用户原有窗口。
              </p>
            </section>
          ))}
        {tab === 'ai' && active && <AISettingsSummary open={openAI} />}
        {tab === 'credentials' && (
          <section className="local-settings-card">
            <h2>受保护的凭据</h2>
            <p>只展示当前凭据标识，不读取或回显密钥。AI 密钥与工具认证分别在对应配置中管理。</p>
            {data.credentials.length ? (
              <ul className="local-settings-inventory">
                {data.credentials.map((id) => (
                  <li key={id}>
                    <strong>
                      {id === 'deepseek'
                        ? 'DeepSeek'
                        : id === 'openai-codex'
                          ? 'Codex / OpenAI'
                          : id}
                    </strong>
                    <span>已配置</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="local-settings-empty">尚未保存凭据。</div>
            )}
            <div className="local-settings-actions">
              <button onClick={() => changeTab('ai')}>管理 AI 密钥</button>
              <button onClick={openTools}>管理工具认证</button>
            </div>
            <p className="local-settings-muted">
              通用凭据的新增与移除入口尚未接入。密钥不随流程 ZIP 导出。
            </p>
          </section>
        )}
        {tab === 'storage' && (
          <LocalStoragePanel
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
