import ToolConnectionUsage, { type ConnectionTaskReference } from './ToolConnectionUsage';
import DesktopAssistantConnection, { type AssistantPhase } from './DesktopAssistantConnection';
import { usePageBack } from './use-page-back';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  connectionConfig,
  type ConnectionConfig,
  type ConnectionCandidate,
  type ToolConnection,
  type OAuthInspection,
} from '../shared/tool-connections';
import './tool-connections.css';
import ToolCapabilityReview from './ToolCapabilityReview';
import ToolOAuthInspection from './ToolOAuthInspection';

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
  auth: 'none' | 'bearer' | 'oauth';
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
    const trigger = document.activeElement as HTMLElement | null;
    const element = ref.current;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
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

export default function ToolConnectionsPage({
  active,
  navigation,
  leave,
  parentTitle = '开始任务',
  choose,
  openTask,
  openDetails,
  openAssistant,
}: {
  active: boolean;
  navigation: MutableRefObject<ToolNavigation | undefined>;
  leave: () => void;
  parentTitle?: string;
  choose: (kind: 'web' | 'file' | 'window') => void;
  openTask: (task: ConnectionTaskReference, connection: ToolConnection) => Promise<void>;
  openDetails: MutableRefObject<((id: string) => void) | undefined>;
  openAssistant?: MutableRefObject<(() => void) | undefined>;
}) {
  const [view, setView] = useState<'catalog' | 'config' | 'review' | 'saved' | 'assistant'>(
    'catalog',
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [protocolOpen, setProtocolOpen] = useState(false);
  const focusInvalid = useRef(false);
  useEffect(() => {
    if (!focusInvalid.current) return;
    focusInvalid.current = false;
    const first = (
      ['name', 'type', 'url', 'auth', 'command', 'args', 'protocol', 'source'] as const
    ).find((field) => fieldErrors[field]);
    if (first) document.getElementById(`tool-config-${first}`)?.focus();
  }, [fieldErrors]);
  const fieldProps = (field: keyof Form) => ({
    id: `tool-config-${field}`,
    'aria-label': {
      name: '显示名称',
      source: '来源说明',
      type: '连接方式',
      url: '服务地址',
      auth: '认证方式',
      command: '本地程序绝对路径',
      args: '程序参数（JSON 字符串数组）',
      protocol: '协议版本',
    }[field],
    'aria-invalid': fieldErrors[field] ? true : undefined,
    'aria-describedby': fieldErrors[field] ? `tool-config-${field}-error` : undefined,
  });
  const fieldError = (field: keyof Form) =>
    fieldErrors[field] && (
      <small className="tool-field-error" id={`tool-config-${field}-error`}>
        {fieldErrors[field]}
      </small>
    );
  const [assistantPhase, setAssistantPhase] = useState<AssistantPhase>('setup');
  const [connections, setConnections] = useState<ToolConnection[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const listRead = useRef(0);
  const savedList = useRef<HTMLUListElement>(null);
  const savedHeading = useRef<HTMLHeadingElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const catalogReturn = useRef<{ id: string; main: number; list: number } | undefined>(undefined);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const [form, setForm] = useState<Form>({ ...empty });
  const [secret, setSecret] = useState(''),
    [sourceReviewed, setSourceReviewed] = useState(false),
    [capabilitiesReviewed, setCapabilitiesReviewed] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [candidate, setCandidate] = useState<ConnectionCandidate>();
  const [oauthInspection, setOAuthInspection] = useState<OAuthInspection>();
  const [reviewBaseline, setReviewBaseline] = useState<ToolConnection>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<
    'discover' | 'authorize' | 'save' | 'manage' | 'inspect' | 'open-task' | null
  >(null);
  const [pendingLeave, setPendingLeave] = useState<{ next: () => void }>();
  const [confirm, setConfirm] = useState<'disconnect' | 'remove'>();
  const [clock, setClock] = useState(Date.now());
  const referenceReturn = useRef<{ focus: HTMLElement | null; scroll: number } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!active || !referenceReturn.current) return;
    const source = referenceReturn.current;
    referenceReturn.current = undefined;
    const frame = requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: source.scroll });
      if (source.focus?.isConnected) source.focus.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (active && (view === 'review' || view === 'saved') && !referenceReturn.current)
      pageHeading.current?.focus({ preventScroll: true });
  }, [active, view]);
  const locked = useRef(false),
    epoch = useRef(0),
    request = useRef<string | undefined>(undefined);
  const selected = connections.find((connection) => connection.id === selectedId);
  const reusableOAuth =
    form.type === 'http' &&
    form.auth === 'oauth' &&
    selected?.config.transport.type === 'http' &&
    selected.config.transport.auth === 'oauth' &&
    selected.config.transport.url === form.url.trim() &&
    selected.config.protocolVersion === form.protocol;
  const refresh = async () => {
    const ticket = ++listRead.current;
    setListLoading(true);
    setListError('');
    try {
      const records: ToolConnection[] = await api('tool.connection.list');
      if (ticket === listRead.current) {
        setConnections(records);
        setLoaded(true);
      }
      return records;
    } catch (error) {
      if (ticket === listRead.current) setListError(connectionError(error));
      throw error;
    } finally {
      if (ticket === listRead.current) setListLoading(false);
    }
  };
  useEffect(() => {
    if (!active) return;
    void refresh().catch(() => {});
    return () => {
      listRead.current++;
    };
  }, [active]);
  useLayoutEffect(() => {
    if (!active || view !== 'catalog' || !catalogReturn.current) return;
    const position = catalogReturn.current;
    catalogReturn.current = undefined;
    if (savedList.current) savedList.current.scrollTop = position.list;
    document.querySelector('main')?.scrollTo({ top: position.main });
    (rowButtons.current.get(position.id) ?? savedHeading.current)?.focus({ preventScroll: true });
  }, [active, view]);
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
    setOAuthInspection(undefined);
    setReviewBaseline(undefined);
    setCapabilitiesReviewed(false);
    setSecret('');
  };
  const go = (next: () => void) => {
    if (busy && busy !== 'discover' && busy !== 'authorize') {
      setError('请等待当前连接操作完成');
      return;
    }
    if (dirty || candidate || busy) setPendingLeave({ next });
    else next();
  };
  navigation.current = go;
  const move = (next: typeof view) => {
    listRead.current++;
    setListLoading(false);
    if (next === 'catalog') void refresh().catch(() => {});
    if (next === 'assistant') setAssistantPhase('setup');
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
  openDetails.current = (id) =>
    go(() => {
      setSelectedId(id);
      move('saved');
    });
  if (openAssistant) openAssistant.current = () => go(() => move('assistant'));
  const edit = (connection?: ToolConnection) =>
    go(() => {
      setSelectedId(connection?.id);
      setForm(connection ? formOf(connection.config) : { ...empty });
      setFieldErrors({});
      setProtocolOpen(false);
      setOAuthInspection(undefined);
      setSourceReviewed(false);
      setCapabilitiesReviewed(false);
      setSecret('');
      setDirty(false);
      move('config');
    });
  const change = (patch: Partial<Form>) => {
    setOAuthInspection(undefined);
    setForm((previous) => ({ ...previous, ...patch }));
    setError('');
    setFieldErrors((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([field]) => !(field in patch) && !('type' in patch)),
      ),
    );
    setDirty(true);
    setSourceReviewed(false);
  };
  const discover = async (reuseOAuth = false) => {
    if (locked.current) return;
    setError('');
    let config: ConnectionConfig;
    try {
      const errors: Partial<Record<keyof Form, string>> = {};
      let args: unknown = [];
      if (form.type === 'stdio') {
        try {
          args = JSON.parse(form.args);
        } catch {
          errors.args = '请填写 JSON 字符串数组，例如 ["--mode", "read"]';
        }
      }
      const result = connectionConfig.safeParse({
        version: 1,
        displayName: form.name,
        source: form.source,
        protocolVersion: form.protocol,
        transport:
          form.type === 'http'
            ? {
                type: 'http',
                url: form.url.trim(),
                auth: form.auth === 'oauth' ? (reuseOAuth ? 'oauth' : 'none') : form.auth,
                ...(reuseOAuth && selected?.config.transport.type === 'http'
                  ? { oauth: selected.config.transport.oauth }
                  : {}),
              }
            : { type: 'stdio', command: form.command, args },
      });
      if (!result.success) {
        for (const issue of result.error.issues) {
          const key = issue.path[0] === 'transport' ? issue.path[1] : issue.path[0];
          const fields: Record<string, keyof Form> = {
            displayName: 'name',
            source: 'source',
            protocolVersion: 'protocol',
            url: 'url',
            command: 'command',
            args: 'args',
            auth: 'auth',
            type: 'type',
          };
          const field = fields[String(key)];
          if (!field) continue;
          const messages: Partial<Record<keyof Form, string>> = {
            name: '请填写显示名称，不包含换行或控制字符。',
            source: '请填写已核对的发布者或获取渠道，不包含换行或控制字符。',
            url: '请使用 HTTPS 或本机回环 HTTP 地址，不包含账号密码、查询参数或片段。',
            command: '请填写以 / 开头的可执行程序绝对路径，不包含换行或控制字符。',
            args: '请使用 JSON 字符串数组，最多 40 项，每项不超过 4096 个字符且不包含空字符。',
            protocol: '请选择支持的协议版本。',
            auth: '请选择认证方式。',
            type: '请选择连接方式。',
          };
          errors[field] ??= messages[field];
        }
      }
      if (Object.keys(errors).length || !result.success) {
        if (errors.protocol) setProtocolOpen(true);
        focusInvalid.current = true;
        setFieldErrors(errors);
        setError('请修正标出的连接配置后重新检查；尚未连接服务或启动程序。');
        return;
      }
      setFieldErrors({});
      if (!sourceReviewed) throw new Error('请先核对来源、地址或程序及其运行方式');
      config = result.data;
    } catch (e) {
      setError(connectionError(e));
      return;
    }
    locked.current = true;
    setBusy('discover');
    setOAuthInspection(undefined);
    setReviewBaseline(selected ? structuredClone(selected) : undefined);
    const ticket = ++epoch.current,
      requestId = crypto.randomUUID();
    request.current = requestId;
    const bearerToken = secret;
    setSecret('');
    try {
      if (form.type === 'http' && form.auth === 'oauth' && !reuseOAuth) {
        const result: OAuthInspection = await api('tool.connection.oauth.inspect', {
          requestId,
          url: form.url.trim(),
          protocolVersion: form.protocol,
          reviewedSource: true,
        });
        if (ticket === epoch.current) {
          setOAuthInspection(result);
          request.current = undefined;
        }
        return;
      }
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
  const authorize = async (issuer: string, clientId: string, callbackPort: number) => {
    if (locked.current || !oauthInspection?.inspectionToken || !sourceReviewed) return;
    locked.current = true;
    setBusy('authorize');
    setError('');
    const ticket = ++epoch.current,
      requestId = crypto.randomUUID();
    request.current = requestId;
    setReviewBaseline(selected ? structuredClone(selected) : undefined);
    try {
      const next: ConnectionCandidate = await api('tool.connection.oauth.authorize', {
        requestId,
        inspectionToken: oauthInspection.inspectionToken,
        reviewedAuthorization: true,
        config: {
          version: 1,
          displayName: form.name,
          source: form.source,
          protocolVersion: form.protocol,
          transport: {
            type: 'http',
            url: form.url.trim(),
            auth: 'oauth',
            oauth: { issuer, clientId, callbackPort },
          },
        },
        ...(selected ? { connectionId: selected.id, revision: selected.revision } : {}),
      });
      if (ticket !== epoch.current) return;
      setCandidate(next);
      setCapabilitiesReviewed(false);
      setClock(Date.now());
      setOAuthInspection(undefined);
      move('review');
    } catch (error) {
      if (ticket === epoch.current) {
        setError(connectionError(error));
        setOAuthInspection(undefined);
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
      listRead.current++;
      setListLoading(false);
      setListError('');
      setLoaded(true);
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
  const inspect = async (operation?: 'disconnect' | 'remove') => {
    if (locked.current || !selected) return;
    locked.current = true;
    setBusy('inspect');
    setError('');
    try {
      const records = await refresh();
      if (!records.some((record) => record.id === selected.id))
        throw new Error('连接记录已不存在，请返回目录。');
      if (operation) setConfirm(operation);
    } catch (e) {
      setError(connectionError(e));
    } finally {
      locked.current = false;
      setBusy(null);
    }
  };
  const openReference = async (task: ConnectionTaskReference) => {
    if (locked.current || !selected) return;
    locked.current = true;
    setBusy('open-task');
    setError('');
    referenceReturn.current = {
      focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      scroll: document.querySelector('main')?.scrollTop ?? 0,
    };
    try {
      await openTask(task, selected);
    } catch (e) {
      referenceReturn.current = undefined;
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
            : assistantPhase === 'connected'
              ? '本机应用助手'
              : assistantPhase === 'recovery'
                ? '应用窗口需要重新检查'
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
  usePageBack(back, active);
  const backLabel =
    view === 'catalog' ? parentTitle : view === 'review' ? '连接设置' : '应用与工具';
  const pageError =
    error || (view !== 'catalog' && listError ? `读取连接记录未完成：${listError}` : '');
  return (
    <div className="tools-host" hidden={!active}>
      <header className="topbar">
        <button
          className="context-back"
          onClick={back}
          disabled={!!busy && busy !== 'discover' && busy !== 'authorize'}
        >
          ← 返回{backLabel}
        </button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#tools-parent"
            onClick={(event) => {
              event.preventDefault();
              back();
            }}
          >
            {view === 'catalog' ? parentTitle : view === 'review' ? '自定义 MCP' : '连接目录'}
          </a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{title}</span>
        </nav>
      </header>
      <section className="page ai-task-page tools-page" aria-label="应用与工具工作区">
        <div className="page-heading">
          <div>
            <h1 ref={pageHeading} tabIndex={-1}>
              {title}
            </h1>
            <p>
              {view === 'catalog'
                ? '连接可用能力，再为具体任务选择对象与授权。'
                : view === 'config'
                  ? '高级设置 · 为熟悉来源和权限的用户提供'
                  : view === 'assistant'
                    ? assistantPhase === 'setup'
                      ? '连接向导 · 1 核对来源 → 2 系统权限 → 3 只读检查'
                      : '本机桌面 · TextEdit（文本编辑） · 系统权限与任务授权分别核对'
                    : content
                      ? `${content.config.transport.type === 'http' ? '远程 / 本机 HTTP' : '本地程序'} · ${address(content.config)}`
                      : '来源、系统权限和能力必须逐项核对'}
            </p>
          </div>
        </div>
        {pageError && (
          <div className="alert error" role="alert">
            {pageError}
          </div>
        )}
        {view === 'saved' && loaded && !selected && (
          <div className="alert error" role="alert">
            原连接记录已不存在。任务与历史仍保留，请返回目录选择有效连接并重新核对。
            <button onClick={catalog}>返回连接目录</button>
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
                <span className="tool-status">macOS · 按任务选择窗口</span>
                <p>
                  发现窗口、核对选区与改动
                  <br />
                  执行前重新核对能力与授权
                </p>
                <button onClick={() => move('assistant')}>连接应用助手</button>
              </section>
            </div>
            <div className="tool-catalog-bottom">
              <section
                className="ai-task-card tool-saved-connections"
                aria-labelledby="saved-connections-title"
              >
                <div className="tool-saved-heading">
                  <h2 id="saved-connections-title" tabIndex={-1} ref={savedHeading}>
                    已保存连接{loaded ? ` · ${connections.length}` : ''}
                  </h2>
                  <button disabled={listLoading} onClick={() => void refresh().catch(() => {})}>
                    {listLoading ? '正在读取…' : listError ? '重新读取' : '刷新列表'}
                  </button>
                </div>
                {listError && (
                  <div role="alert" className="tool-list-error">
                    <p>读取连接记录未完成：{listError}</p>
                    {loaded && <p>下方保留上次读取的记录，当前状态需重新核对。</p>}
                  </div>
                )}
                {!loaded && !listError ? (
                  <p role="status">
                    {listLoading ? '正在读取本机连接…' : '尚未取得本机连接记录。'}
                  </p>
                ) : loaded && !connections.length && !listError ? (
                  <p>尚未保存自定义连接。账号和工作区需在使用前核对。</p>
                ) : null}
                {!!connections.length && (
                  <ul ref={savedList} className="tool-saved-list" aria-label="已保存的工具连接">
                    {connections.map((connection) => (
                      <li key={connection.id}>
                        <button
                          className="tool-connection-row"
                          ref={(button) => {
                            if (button) rowButtons.current.set(connection.id, button);
                            else rowButtons.current.delete(connection.id);
                          }}
                          onClick={() => {
                            catalogReturn.current = {
                              id: connection.id,
                              main: document.querySelector('main')?.scrollTop ?? 0,
                              list: savedList.current?.scrollTop ?? 0,
                            };
                            setSelectedId(connection.id);
                            move('saved');
                          }}
                        >
                          <strong>{connection.config.displayName}</strong>
                          <span
                            className={`tool-status ${connection.status === 'verified' ? 'success' : 'warning'}`}
                          >
                            {labels[connection.status]}
                          </span>
                          <span className="tool-connection-source">
                            {connection.config.source} ·{' '}
                            {connection.config.transport.type === 'http' ? 'HTTP' : '本地程序'} ·{' '}
                            {connection.tools.length} 项能力
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="tool-list-note">刷新只读取本机记录，不重新连接服务或授予任务权限。</p>
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
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void discover();
            }}
          >
            <section className="ai-task-card">
              <label className="tool-field">
                显示名称
                <input
                  {...fieldProps('name')}
                  value={form.name}
                  maxLength={100}
                  placeholder="我的工具服务"
                  disabled={!!busy}
                  onChange={(e) => change({ name: e.target.value })}
                />
                {fieldError('name')}
              </label>
              <label className="tool-field">
                连接方式
                <select
                  {...fieldProps('type')}
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
                {fieldError('type')}
              </label>
              {form.type === 'http' ? (
                <>
                  <label className="tool-field">
                    服务地址
                    <input
                      {...fieldProps('url')}
                      value={form.url}
                      maxLength={2048}
                      placeholder="https://tools.example.com/mcp"
                      disabled={!!busy}
                      onChange={(e) => {
                        change({ url: e.target.value });
                        setSecret('');
                      }}
                    />
                    {fieldError('url')}
                  </label>
                  <label className="tool-field">
                    认证方式
                    <select
                      {...fieldProps('auth')}
                      value={form.auth}
                      disabled={!!busy}
                      onChange={(e) => {
                        change({ auth: e.target.value as Form['auth'] });
                        setSecret('');
                      }}
                    >
                      <option value="none">无需凭据</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="oauth">OAuth · 浏览器登录</option>
                    </select>
                    {fieldError('auth')}
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
                      {...fieldProps('command')}
                      value={form.command}
                      maxLength={4096}
                      placeholder="/绝对路径/可执行程序"
                      disabled={!!busy}
                      onChange={(e) => change({ command: e.target.value })}
                    />
                    {fieldError('command')}
                  </label>
                  <label className="tool-field">
                    程序参数（JSON 字符串数组）
                    <textarea
                      {...fieldProps('args')}
                      value={form.args}
                      disabled={!!busy}
                      rows={3}
                      onChange={(e) => change({ args: e.target.value })}
                    />
                    {fieldError('args')}
                  </label>
                  <p className="ai-task-note">
                    只会启动你填写的程序，不自动安装、不使用
                    Shell。程序启动可能有自身副作用，请先核对可信来源。
                  </p>
                </>
              )}
              <details
                className="tool-protocol-settings"
                open={protocolOpen}
                onToggle={(event) => setProtocolOpen(event.currentTarget.open)}
              >
                <summary>协议设置 · {form.protocol}</summary>
                <label className="tool-field">
                  协议版本
                  <select
                    {...fieldProps('protocol')}
                    value={form.protocol}
                    disabled={!!busy}
                    onChange={(e) => change({ protocol: e.target.value as Form['protocol'] })}
                  >
                    <option value="2026-07-28">2026-07-28</option>
                    <option value="2025-11-25">2025-11-25</option>
                  </select>
                  {fieldError('protocol')}
                </label>
              </details>
              <p>
                {form.type === 'http' && form.auth === 'oauth'
                  ? '先读取认证站点与范围，再使用服务分配的公开客户端 ID 登录。能力核对后才保存连接。'
                  : '先发现能力并测试，确认工具列表、身份和范围后再保存。'}
              </p>
              <div className="ai-task-actions tool-config-actions">
                {reusableOAuth && (
                  <button
                    type="button"
                    disabled={!!busy || !sourceReviewed}
                    onClick={() => void discover(true)}
                  >
                    使用已保存登录检查能力
                  </button>
                )}
                <button className="primary" type="submit" disabled={!!busy || !sourceReviewed}>
                  {form.type === 'http' && form.auth === 'oauth'
                    ? busy === 'discover'
                      ? '正在检查认证配置…'
                      : '检查认证站点与范围'
                    : busy === 'discover'
                      ? '正在发现能力…'
                      : '发现并检查能力'}
                </button>
                <button
                  type="button"
                  disabled={!!busy && busy !== 'discover' && busy !== 'authorize'}
                  onClick={
                    busy === 'discover' || busy === 'authorize'
                      ? () => void cancel().catch((e) => setError(connectionError(e)))
                      : catalog
                  }
                >
                  {busy === 'authorize' ? '取消登录' : busy === 'discover' ? '取消检查' : '取消'}
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
                  {...fieldProps('source')}
                  value={form.source}
                  maxLength={500}
                  disabled={!!busy}
                  placeholder="填写你核对过的发布者或获取渠道"
                  onChange={(e) => change({ source: e.target.value })}
                />
                {fieldError('source')}
              </label>
              <label className="ai-task-checkbox">
                <input
                  type="checkbox"
                  checked={sourceReviewed}
                  disabled={!!busy}
                  onChange={(e) => setSourceReviewed(e.target.checked)}
                />
                {form.type === 'http' && form.auth === 'oauth'
                  ? reusableOAuth
                    ? '我已核对来源，同意检查认证配置或使用已保存登录读取能力'
                    : '我已核对来源，同意读取此服务及其声明的认证站点配置'
                  : '我已核对来源、地址或程序及其运行方式'}
              </label>
              <p className="ai-task-note">
                {form.type === 'http' && form.auth === 'oauth'
                  ? reusableOAuth
                    ? '认证配置检查不发送凭据；复用已保存登录会向此服务发送访问令牌，必要时向原认证站点刷新，不调用工具。'
                    : '检查只读取公开的认证配置，不发送凭据、不打开登录网页、不注册客户端或调用工具。'
                  : '发现仅请求服务身份和工具清单，不调用工具。服务说明、提示词和网页内容不能替代用户授权。'}
              </p>
              {oauthInspection && (
                <ToolOAuthInspection
                  cancel={() => void cancel().catch((e) => setError(connectionError(e)))}
                  result={oauthInspection}
                  busy={busy === 'authorize'}
                  disabled={!!busy || !sourceReviewed}
                  authorize={authorize}
                  previous={
                    selected?.config.transport.type === 'http'
                      ? selected.config.transport.oauth
                      : undefined
                  }
                />
              )}
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
          <div className="tool-columns tool-review-columns">
            <section className="ai-task-card">
              <span
                className={`tool-status ${view === 'review' || selected?.status === 'verified' ? 'success' : 'warning'}`}
              >
                {view === 'review'
                  ? '发现通过 · 尚未保存'
                  : selected
                    ? `已保存 · ${labels[selected.status]}`
                    : ''}
              </span>
              <article className="tool-definition">
                <h2>身份与范围</h2>
                <p>
                  账号 / 工作区：尚未核对
                  <br />
                  认证：
                  {content.config.transport.type === 'http' &&
                  content.config.transport.auth === 'bearer'
                    ? 'Bearer Token'
                    : content.config.transport.type === 'http' &&
                        content.config.transport.auth === 'oauth'
                      ? 'OAuth 浏览器登录'
                      : '未使用认证凭据'}
                </p>
                <details className="tool-identity-details">
                  <summary>查看连接来源与发现记录</summary>
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
                    最近发现：{when(content.testedAt)}
                  </p>
                </details>
                {content.oauth && (
                  <div className="tool-oauth-inspection">
                    <p>
                      认证站点：{content.oauth.issuer}
                      <br />
                      目标资源：{content.oauth.resource}
                      <br />
                      客户端 ID：{content.oauth.clientId}
                    </p>
                    <p>
                      授予范围：{content.oauth.scopes.join(' · ') || '服务未声明具体范围'}
                      <br />
                      令牌到期：
                      {content.oauth.expiresAt
                        ? when(new Date(content.oauth.expiresAt).toISOString())
                        : '服务未提供，以后续响应为准'}
                    </p>
                    <p>登录结果不证明服务内账号或工作区身份，使用前仍需核对。</p>
                  </div>
                )}
              </article>
              {candidate?.changed && view === 'review' && (
                <p className="ai-task-note tool-warning">
                  服务身份或能力定义已变化，请重新核对以下完整清单。已有连接在保存前保持不变。
                </p>
              )}
              <ToolCapabilityReview
                key={view === 'review' ? candidate?.token : `${selected?.id}:${selected?.revision}`}
                current={content}
                baseline={
                  view === 'review' &&
                  candidate?.connectionId === reviewBaseline?.id &&
                  candidate?.revision === reviewBaseline?.revision
                    ? reviewBaseline
                    : undefined
                }
              />
            </section>
            <section className="ai-task-card">
              <h2>使用规则</h2>
              <p className="ai-task-note">
                服务说明只提供上下文。任务授权、目标选择和参数校验由 FlowArk 宿主执行。
              </p>
              <p>
                任务执行授权：每次试运行前明确核对
                <br />
                系统权限：未通过连接发现核对
              </p>
              {view === 'saved' && selected && (
                <>
                  {selected.status !== 'verified' && (
                    <p className="ai-task-note tool-warning" role="status">
                      {selected.status === 'disconnected'
                        ? '连接已断开。'
                        : selected.status === 'failed'
                          ? '最近连接检查未通过。'
                          : '连接需要重新核对。'}
                      相关任务暂不能使用此连接；重新连接后仍需回到原任务核对工具选择，不会自动继续执行。
                    </p>
                  )}
                </>
              )}
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
                      : `检查结果有效至 ${when(new Date(candidate!.expiresAt).toISOString())}；保存不会执行任何工具。`}
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
                    <button
                      className={selected.status === 'verified' ? 'primary' : undefined}
                      disabled={!!busy}
                      onClick={catalog}
                    >
                      返回应用与工具
                    </button>
                    <button disabled={!!busy} onClick={() => edit(selected)}>
                      查看连接设置
                    </button>
                    {selected.status !== 'verified' && (
                      <button className="primary" disabled={!!busy} onClick={() => edit(selected)}>
                        重新检查连接
                      </button>
                    )}
                    <details className="tool-connection-maintenance">
                      <summary>连接维护与任务引用</summary>
                      {selected.status === 'verified' && (
                        <button disabled={!!busy} onClick={() => edit(selected)}>
                          重新检查连接
                        </button>
                      )}
                      <ToolConnectionUsage
                        connection={selected}
                        busy={!!busy}
                        openTask={(task) => void openReference(task)}
                      />
                      <button disabled={!!busy} onClick={() => void inspect()}>
                        {busy === 'inspect' ? '正在刷新引用…' : '刷新连接与任务引用'}
                      </button>
                      {busy === 'open-task' && (
                        <p role="status">正在保存原任务草稿并核对目标任务…</p>
                      )}
                      <button
                        disabled={!!busy || selected.status === 'disconnected'}
                        onClick={() => void inspect('disconnect')}
                      >
                        断开连接
                      </button>
                      <button disabled={!!busy} onClick={() => void inspect('remove')}>
                        删除连接
                      </button>
                    </details>
                  </>
                )
              )}
            </section>
          </div>
        )}
        {view === 'assistant' && (
          <DesktopAssistantConnection
            active={active}
            onPhase={setAssistantPhase}
            choose={() => choose('window')}
            back={catalog}
          />
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
              disabled={!!busy && busy !== 'discover' && busy !== 'authorize'}
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
          <ToolConnectionUsage connection={selected} />
          <p>以上为刚读取的引用。本操作不会新增运行或重放任务；已完成的外部操作不会回滚。</p>
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
