import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  connectionConfig,
  type ConnectionConfig,
  type ConnectionCandidate,
  type ToolConnection,
  type ToolDefinition,
} from '../shared/tool-connections';
import './tool-connections.css';

const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
const connectionError = (error: unknown) =>
  (error instanceof Error ? error.message : '连接操作未完成，请重新核对').replace(
    /^Error invoking remote method 'flowark:request': (?:Error: )?/,
    '',
  );
export type ToolNavigation = (next: () => void) => void;
type Form = {
  name: string;
  source: string;
  type: 'http' | 'stdio';
  url: string;
  auth: 'none' | 'bearer';
  command: string;
  args: string;
  protocol: ConnectionConfig['protocolVersion'];
};
const empty: Form = {
  name: '',
  source: '',
  type: 'http',
  url: '',
  auth: 'none',
  command: '',
  args: '[]',
  protocol: '2026-07-28',
};
const labels = {
  verified: '本次发现通过',
  unverified: '尚未重新测试',
  disconnected: '已断开',
  failed: '需要重新连接',
};
function ToolDialog({
  titleId,
  children,
  cancel,
}: {
  titleId: string;
  children: ReactNode;
  cancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="script-leave-dialog tool-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      {children}
    </dialog>
  );
}
const when = (value: string) => new Date(value).toLocaleString('zh-CN');
const address = (config: ConnectionConfig) =>
  config.transport.type === 'http'
    ? config.transport.url
    : `${config.transport.command} ${config.transport.args.map((arg) => JSON.stringify(arg)).join(' ')}`;
function formOf(config: ConnectionConfig): Form {
  return {
    ...empty,
    name: config.displayName,
    source: config.source,
    protocol: config.protocolVersion,
    ...(config.transport.type === 'http'
      ? { type: 'http', url: config.transport.url, auth: config.transport.auth }
      : {
          type: 'stdio',
          command: config.transport.command,
          args: JSON.stringify(config.transport.args, null, 2),
        }),
  };
}
function ToolCard({ tool }: { tool: ToolDefinition }) {
  return (
    <article className="tool-definition">
      <h3>工具：{tool.title || tool.name}</h3>
      {tool.title && <p>{tool.name}</p>}
      <p>{tool.description || '服务未提供说明，请先向提供者核对用途。'}</p>
      <p className="tool-disclaimer">
        {tool.annotations?.readOnlyHint === true ? '服务声明：只读' : '读写范围：未确认'} ·
        声明不等于本次任务授权
      </p>
      <details>
        <summary>查看参数与能力声明</summary>
        <pre>
          {JSON.stringify(
            {
              inputSchema: tool.inputSchema,
              outputSchema: tool.outputSchema,
              annotations: tool.annotations,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </article>
  );
}

export default function ToolConnectionsPage({
  active,
  navigation,
  leave,
  choose,
}: {
  active: boolean;
  navigation: MutableRefObject<ToolNavigation | undefined>;
  leave: () => void;
  choose: (kind: 'web' | 'file') => void;
}) {
  const [view, setView] = useState<'catalog' | 'config' | 'review' | 'saved' | 'unavailable'>(
    'catalog',
  );
  const [connections, setConnections] = useState<ToolConnection[]>([]);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const [form, setForm] = useState<Form>({ ...empty });
  const [secret, setSecret] = useState(''),
    [sourceReviewed, setSourceReviewed] = useState(false),
    [capabilitiesReviewed, setCapabilitiesReviewed] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [candidate, setCandidate] = useState<ConnectionCandidate>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'discover' | 'save' | 'manage' | null>(null);
  const [pendingLeave, setPendingLeave] = useState<{ next: () => void }>();
  const [confirm, setConfirm] = useState<'disconnect' | 'remove'>();
  const [clock, setClock] = useState(Date.now());
  const locked = useRef(false),
    epoch = useRef(0),
    request = useRef<string | undefined>(undefined);
  const selected = connections.find((connection) => connection.id === selectedId);
  const refresh = async () => {
    const records = await api('tool.connection.list');
    setConnections(records);
    setLoaded(true);
    return records as ToolConnection[];
  };
  useEffect(() => {
    if (!active) return;
    let live = true;
    void api('tool.connection.list')
      .then((records) => {
        if (live) {
          setConnections(records);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (live) setError(connectionError(e));
      });
    return () => {
      live = false;
    };
  }, [active]);
  useEffect(() => {
    if (!candidate) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [candidate]);
  useEffect(
    () => () => {
      epoch.current++;
      if (request.current)
        void api('tool.connection.cancel', { requestId: request.current }).catch(() => {});
    },
    [],
  );
  const cancel = async () => {
    epoch.current++;
    const requestId = request.current;
    if (requestId) await api('tool.connection.cancel', { requestId });
    request.current = undefined;
    locked.current = false;
    setBusy(null);
    setCandidate(undefined);
    setCapabilitiesReviewed(false);
    setSecret('');
  };
  const go = (next: () => void) => {
    if (busy === 'save' || busy === 'manage') {
      setError('请等待连接保存或管理操作完成');
      return;
    }
    if (dirty || candidate || busy) setPendingLeave({ next });
    else next();
  };
  navigation.current = go;
  const move = (next: typeof view) => {
    setView(next);
    setError('');
    setConfirm(undefined);
    document.querySelector('main')?.scrollTo({ top: 0 });
  };
  const catalog = () =>
    go(() => {
      setSelectedId(undefined);
      setDirty(false);
      move('catalog');
    });
  const edit = (connection?: ToolConnection) =>
    go(() => {
      setSelectedId(connection?.id);
      setForm(connection ? formOf(connection.config) : { ...empty });
      setSourceReviewed(false);
      setCapabilitiesReviewed(false);
      setSecret('');
      setDirty(false);
      move('config');
    });
  const change = (patch: Partial<Form>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    setDirty(true);
    setSourceReviewed(false);
  };
  const discover = async () => {
    if (locked.current) return;
    setError('');
    let config: ConnectionConfig;
    try {
      let args: unknown = [];
      if (form.type === 'stdio') {
        try {
          args = JSON.parse(form.args);
        } catch {
          throw new Error('程序参数请填写 JSON 字符串数组，例如 ["--mode", "read"]');
        }
      }
      const result = connectionConfig.safeParse({
        version: 1,
        displayName: form.name,
        source: form.source,
        protocolVersion: form.protocol,
        transport:
          form.type === 'http'
            ? { type: 'http', url: form.url.trim(), auth: form.auth }
            : { type: 'stdio', command: form.command, args },
      });
      if (!result.success)
        throw new Error(
          '请填写显示名称、来源说明和有效的连接配置；远程地址须为 HTTPS，本地程序须为绝对路径。',
        );
      if (!sourceReviewed) throw new Error('请先核对来源、地址或程序及其运行方式');
      config = result.data;
    } catch (e) {
      setError(connectionError(e));
      return;
    }
    locked.current = true;
    setBusy('discover');
    const ticket = ++epoch.current,
      requestId = crypto.randomUUID();
    request.current = requestId;
    const bearerToken = secret;
    setSecret('');
    try {
      const next: ConnectionCandidate = await api('tool.connection.discover', {
        requestId,
        config,
        reviewedSource: true,
        ...(selected ? { connectionId: selected.id, revision: selected.revision } : {}),
        ...(bearerToken ? { bearerToken } : {}),
      });
      if (ticket !== epoch.current) return;
      setCandidate(next);
      setCapabilitiesReviewed(false);
      setClock(Date.now());
      move('review');
    } catch (e) {
      if (ticket === epoch.current) {
        setError(connectionError(e));
        await refresh().catch(() => {});
      }
    } finally {
      if (ticket === epoch.current) {
        locked.current = false;
        setBusy(null);
      }
    }
  };
  const save = async () => {
    if (locked.current || !candidate || !capabilitiesReviewed) return;
    locked.current = true;
    setBusy('save');
    setError('');
    try {
      const saved: ToolConnection = await api('tool.connection.save', {
        token: candidate.token,
        reviewedCapabilities: true,
      });
      setConnections((list) => [...list.filter((c) => c.id !== saved.id), saved]);
      setSelectedId(saved.id);
      request.current = undefined;
      setCandidate(undefined);
      setDirty(false);
      setCapabilitiesReviewed(false);
      move('saved');
    } catch (e) {
      setError(connectionError(e));
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  const manage = async (operation: 'disconnect' | 'remove') => {
    if (locked.current || !selected) return;
    locked.current = true;
    setBusy('manage');
    setError('');
    try {
      await api(`tool.connection.${operation}`, {
        id: selected.id,
        revision: selected.revision,
        ...(operation === 'remove' ? { confirmed: true } : {}),
      });
      await refresh();
      setConfirm(undefined);
      if (operation === 'remove') {
        setSelectedId(undefined);
        move('catalog');
      }
    } catch (e) {
      setError(connectionError(e));
      setConfirm(undefined);
      await refresh().catch(() => {});
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  const content = view === 'review' ? candidate : view === 'saved' ? selected : undefined;
  const title =
    view === 'catalog'
      ? '应用与工具'
      : view === 'config'
        ? '自定义 MCP 连接'
        : view === 'review'
          ? '检查发现的能力'
          : view === 'saved'
            ? `${selected?.config.displayName || '连接'} · ${selected ? labels[selected.status] : '已变化'}`
            : '连接本机应用助手';
  const back =
    view === 'catalog'
      ? () => go(leave)
      : view === 'review'
        ? () => {
            if (busy === 'save') return;
            void cancel()
              .then(() => move('config'))
              .catch((e) => setError(connectionError(e)));
          }
        : catalog;
  return (
    <div className="tools-host" hidden={!active}>
      <header className="topbar">
        <button
          className="context-back"
          onClick={back}
          disabled={busy === 'save' || busy === 'manage'}
        >
          ← 返回
        </button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#tools-parent"
            onClick={(event) => {
              event.preventDefault();
              back();
            }}
          >
            {view === 'catalog' ? '开始任务' : view === 'review' ? '自定义 MCP' : '连接目录'}
          </a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{title}</span>
        </nav>
      </header>
      <section className="page ai-task-page tools-page" aria-label="应用与工具工作区">
        <div className="page-heading">
          <div>
            <h1>{title}</h1>
            <p>
              {view === 'catalog'
                ? '连接可用能力，再为具体任务选择对象与授权。'
                : view === 'config'
                  ? '高级设置 · 为熟悉来源和权限的用户提供'
                  : content
                    ? `${content.config.transport.type === 'http' ? '远程 / 本机 HTTP' : '本地程序'} · ${address(content.config)}`
                    : '来源、系统权限和能力必须逐项核对'}
            </p>
          </div>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {view === 'catalog' && (
          <>
            <div className="tool-presets">
              <section className="ai-task-card">
                <h2>内置浏览器</h2>
                <span className="tool-status success">随应用提供</span>
                <p>
                  读取网页、定位与填写
                  <br />
                  对象：FlowArk 受控网页
                </p>
                <button onClick={() => choose('web')}>查看并选择网页</button>
              </section>
              <section className="ai-task-card">
                <h2>本机文件</h2>
                <span className="tool-status success">按文件 / 目录授权</span>
                <p>
                  读取选定文件、新建输出
                  <br />
                  范围：每次任务明确选取
                </p>
                <button onClick={() => choose('file')}>查看并选择文件</button>
              </section>
              <section className="ai-task-card">
                <h2>本机应用助手</h2>
                <span className="tool-status warning">尚未接入</span>
                <p>
                  读取窗口、操作选中控件
                  <br />
                  范围：明确选择的应用窗口
                </p>
                <button onClick={() => move('unavailable')}>查看连接要求</button>
              </section>
            </div>
            <div className="tool-catalog-bottom">
              <section className="ai-task-card">
                <h2>已保存连接</h2>
                {!loaded ? (
                  <p>正在读取本机连接…</p>
                ) : !connections.length ? (
                  <p>尚未保存自定义连接。账号和工作区需在使用前核对。</p>
                ) : (
                  connections.map((connection) => (
                    <button
                      className="tool-connection-row"
                      key={connection.id}
                      onClick={() => {
                        setSelectedId(connection.id);
                        move('saved');
                      }}
                    >
                      <strong>{connection.config.displayName}</strong>
                      <span>
                        {labels[connection.status]} · {connection.tools.length} 项能力
                      </span>
                    </button>
                  ))
                )}
              </section>
              <section className="ai-task-card">
                <h2>高级设置</h2>
                <p>自定义 MCP 地址或本地程序，仅在了解来源时配置。</p>
                <button onClick={() => edit()}>自定义 MCP</button>
              </section>
            </div>
            <p className="ai-task-note">
              连接发现通过不等于获得任务执行授权。工具的实际能力、账号和范围会在使用前再次核对。
            </p>
          </>
        )}
        {view === 'config' && (
          <form
            className="tool-columns tool-config"
            onSubmit={(event) => {
              event.preventDefault();
              void discover();
            }}
          >
            <section className="ai-task-card">
              <label className="tool-field">
                显示名称
                <input
                  value={form.name}
                  maxLength={100}
                  placeholder="我的工具服务"
                  disabled={!!busy}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </label>
              <label className="tool-field">
                连接方式
                <select
                  aria-label="连接方式"
                  value={form.type}
                  disabled={!!busy}
                  onChange={(e) => {
                    change({ type: e.target.value as Form['type'] });
                    setSecret('');
                  }}
                >
                  <option value="http">远程 HTTPS / 本机 HTTP</option>
                  <option value="stdio">本地程序（stdio）</option>
                </select>
              </label>
              {form.type === 'http' ? (
                <>
                  <label className="tool-field">
                    服务地址
                    <input
                      value={form.url}
                      maxLength={2048}
                      placeholder="https://tools.example.com/mcp"
                      disabled={!!busy}
                      onChange={(e) => {
                        change({ url: e.target.value });
                        setSecret('');
                      }}
                    />
                  </label>
                  <label className="tool-field">
                    认证方式
                    <select
                      aria-label="认证方式"
                      value={form.auth}
                      disabled={!!busy}
                      onChange={(e) => {
                        change({ auth: e.target.value as Form['auth'] });
                        setSecret('');
                      }}
                    >
                      <option value="none">无需凭据</option>
                      <option value="bearer">Bearer Token</option>
                      <option disabled>OAuth · 尚未接入</option>
                    </select>
                  </label>
                  {form.auth === 'bearer' && (
                    <label className="tool-field">
                      Bearer Token
                      <input
                        type="password"
                        aria-label="Bearer Token"
                        autoComplete="off"
                        value={secret}
                        maxLength={8192}
                        disabled={!!busy}
                        placeholder={
                          selected?.hasCredential
                            ? '留空仅复用同一地址已保存的凭据'
                            : '仅发送到上方明确选择的服务'
                        }
                        onChange={(e) => {
                          setSecret(e.target.value);
                          setDirty(true);
                          setSourceReviewed(false);
                        }}
                      />
                      <small>不会回显已保存的凭据；发现后输入框清空。</small>
                    </label>
                  )}
                </>
              ) : (
                <>
                  <label className="tool-field">
                    本地程序绝对路径
                    <input
                      value={form.command}
                      maxLength={4096}
                      placeholder="/绝对路径/可执行程序"
                      disabled={!!busy}
                      onChange={(e) => change({ command: e.target.value })}
                    />
                  </label>
                  <label className="tool-field">
                    程序参数（JSON 字符串数组）
                    <textarea
                      value={form.args}
                      disabled={!!busy}
                      rows={3}
                      onChange={(e) => change({ args: e.target.value })}
                    />
                  </label>
                  <p className="ai-task-note">
                    只会启动你填写的程序，不自动安装、不使用
                    Shell。程序启动可能有自身副作用，请先核对可信来源。
                  </p>
                </>
              )}
              <label className="tool-field">
                协议版本
                <select
                  aria-label="协议版本"
                  value={form.protocol}
                  disabled={!!busy}
                  onChange={(e) => change({ protocol: e.target.value as Form['protocol'] })}
                >
                  <option value="2026-07-28">2026-07-28</option>
                  <option value="2025-11-25">2025-11-25</option>
                </select>
              </label>
              <p>先发现能力并测试，确认工具列表、身份和范围后再保存。</p>
              <div className="ai-task-actions">
                <button className="primary" type="submit" disabled={!!busy || !sourceReviewed}>
                  {busy === 'discover' ? '正在发现能力…' : '发现并检查能力'}
                </button>
                <button
                  type="button"
                  disabled={busy === 'save' || busy === 'manage'}
                  onClick={
                    busy === 'discover'
                      ? () => void cancel().catch((e) => setError(connectionError(e)))
                      : catalog
                  }
                >
                  {busy === 'discover' ? '取消检查' : '取消'}
                </button>
              </div>
            </section>
            <section className="ai-task-card">
              <h2>保存前要知道什么</h2>
              <p>
                来源与发布者
                <br />
                运行在本机还是远端
                <br />
                需要哪些数据和授权
                <br />
                可执行哪些读写操作
                <br />
                认证是否成功、何时测试
              </p>
              <label className="tool-field">
                来源说明
                <input
                  value={form.source}
                  maxLength={500}
                  disabled={!!busy}
                  placeholder="填写你核对过的发布者或获取渠道"
                  onChange={(e) => change({ source: e.target.value })}
                />
              </label>
              <label className="ai-task-checkbox">
                <input
                  type="checkbox"
                  checked={sourceReviewed}
                  disabled={!!busy}
                  onChange={(e) => setSourceReviewed(e.target.checked)}
                />
                我已核对来源、地址或程序及其运行方式
              </label>
              <p className="ai-task-note">
                发现仅请求服务身份和工具清单，不调用工具。服务说明、提示词和网页内容不能替代用户授权。
              </p>
              {selected && (
                <p>
                  已有连接：{selected.config.displayName}
                  <br />
                  检查失败或取消会保留已保存的配置。
                </p>
              )}
            </section>
          </form>
        )}
        {content && (
          <div className="tool-columns">
            <section className="ai-task-card">
              <span
                className={`tool-status ${view === 'review' || selected?.status === 'verified' ? 'success' : 'warning'}`}
              >
                {view === 'review'
                  ? '发现通过 · 尚未保存'
                  : selected
                    ? labels[selected.status]
                    : ''}
              </span>
              <article className="tool-definition">
                <h2>身份与范围</h2>
                <p>
                  连接：{content.config.displayName}
                  <br />
                  服务声明：
                  {content.server
                    ? `${content.server.name} / ${content.server.version}`
                    : '未提供身份'}
                  <br />
                  来源说明：{content.config.source}
                  <br />
                  账号 / 工作区：尚未核对
                  <br />
                  认证：
                  {content.config.transport.type === 'http' &&
                  content.config.transport.auth === 'bearer'
                    ? 'Bearer Token'
                    : '未使用认证凭据'}
                  <br />
                  最近发现：{when(content.testedAt)}
                </p>
              </article>
              {candidate?.changed && view === 'review' && (
                <p className="ai-task-note tool-warning">
                  服务身份或能力定义已变化，请重新核对以下完整清单。已有连接在保存前保持不变。
                </p>
              )}
              {!content.tools.length && (
                <p className="ai-task-note">该服务未返回任何工具，连接不能据此提供执行能力。</p>
              )}
              {content.tools.map((tool) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </section>
            <section className="ai-task-card">
              <h2>使用规则</h2>
              <p className="ai-task-note">
                服务说明只提供上下文。任务授权、目标选择和参数校验由 FlowArk 宿主执行。
              </p>
              <p>
                任务授权：尚未授权任何任务
                <br />
                系统权限：未通过连接发现核对
              </p>
              {view === 'review' && candidate ? (
                <>
                  <label className="ai-task-checkbox">
                    <input
                      type="checkbox"
                      checked={capabilitiesReviewed}
                      disabled={!!busy}
                      onChange={(e) => setCapabilitiesReviewed(e.target.checked)}
                    />
                    我已核对该连接的身份说明和完整工具清单
                  </label>
                  <p role="status">
                    {clock >= candidate.expiresAt
                      ? '检查已过期，请返回设置重新发现。'
                      : '检查结果保留五分钟；保存不会执行任何工具。'}
                  </p>
                  <button
                    className="primary"
                    disabled={!!busy || !capabilitiesReviewed || clock >= candidate.expiresAt}
                    onClick={() => void save()}
                  >
                    {busy === 'save' ? '正在保存…' : '保存这个连接'}
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void cancel()
                        .then(() => move('config'))
                        .catch((e) => setError(connectionError(e)))
                    }
                  >
                    取消，回到设置
                  </button>
                </>
              ) : (
                selected && (
                  <>
                    <p>
                      {selected.status === 'unverified'
                        ? '重开后仅保留历史记录。重新检查由你发起，不会自动连接。'
                        : selected.status === 'disconnected'
                          ? '配置与历史能力已保留，重新连接需要再次检查。'
                          : '能力发现已关闭测试连接；任务使用前仍须核对实时状态。'}
                    </p>
                    <button className="primary" disabled={!!busy} onClick={() => edit(selected)}>
                      重新检查连接
                    </button>
                    <button disabled={!!busy} onClick={() => edit(selected)}>
                      查看连接设置
                    </button>
                    <button
                      disabled={!!busy || selected.status === 'disconnected'}
                      onClick={() => setConfirm('disconnect')}
                    >
                      断开连接
                    </button>
                    <button disabled={!!busy} onClick={() => setConfirm('remove')}>
                      删除连接
                    </button>
                    <button disabled={!!busy} onClick={catalog}>
                      返回应用与工具
                    </button>
                  </>
                )
              )}
            </section>
          </div>
        )}
        {view === 'unavailable' && (
          <div className="tool-columns">
            <section className="ai-task-card">
              <h2>来源与运行方式</h2>
              <span className="tool-status warning">尚未接入</span>
              <p>本机应用助手需要明确的程序来源、窗口能力和系统授权。当前没有已核对的预设助手。</p>
              <p>自定义 MCP 连接可以检查已有工具服务，但不会因此获得操作任意应用窗口的权限。</p>
              <button onClick={() => edit()}>配置已有 MCP 服务</button>
            </section>
            <section className="ai-task-card">
              <h2>授权与测试</h2>
              <p className="ai-task-note">
                本机助手、系统辅助功能和任务窗口绑定仍待接入。这里不会安装程序或申请后台窗口权限。
              </p>
              <button onClick={catalog}>返回应用与工具</button>
            </section>
          </div>
        )}
      </section>
      {pendingLeave && (
        <ToolDialog titleId="tool-leave-title" cancel={() => setPendingLeave(undefined)}>
          <h2 id="tool-leave-title">离开尚未保存的连接？</h2>
          <p>将取消这次检查并丢弃未保存的配置和凭据输入；已保存连接保持不变。</p>
          <div className="ai-task-actions">
            <button autoFocus onClick={() => setPendingLeave(undefined)}>
              继续编辑
            </button>
            <button
              disabled={busy === 'save' || busy === 'manage'}
              onClick={() => {
                const next = pendingLeave.next;
                void cancel()
                  .then(() => {
                    setDirty(false);
                    setForm({ ...empty });
                    setSourceReviewed(false);
                    setPendingLeave(undefined);
                    setView('catalog');
                    next();
                  })
                  .catch((e) => setError(connectionError(e)));
              }}
            >
              放弃连接并离开
            </button>
          </div>
        </ToolDialog>
      )}
      {confirm && selected && (
        <ToolDialog
          titleId="tool-remove-title"
          cancel={() => {
            if (!busy) setConfirm(undefined);
          }}
        >
          <h2 id="tool-remove-title">
            {confirm === 'remove' ? '删除' : '断开'}“{selected.config.displayName}”？
          </h2>
          <p>
            {confirm === 'remove'
              ? '删除本机连接记录和其专属凭据。不会删除任务、运行历史或产物。'
              : '保留配置与历史能力，取消该连接未完成的检查。恢复需要你重新检查。'}
          </p>
          <p>该连接尚未绑定任务；本操作不会执行工具或重放任务。</p>
          <div className="ai-task-actions">
            <button autoFocus disabled={!!busy} onClick={() => setConfirm(undefined)}>
              取消
            </button>
            <button disabled={!!busy} onClick={() => void manage(confirm)}>
              确认{confirm === 'remove' ? '删除' : '断开'}
            </button>
          </div>
        </ToolDialog>
      )}
    </div>
  );
}
