import { Select, Button, Checkbox, Input, Modal, Flex, Alert } from 'antd';
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
type ConfigField = keyof Form | 'secret';
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
  const confirmationCancel = useRef<HTMLButtonElement>(null);
  const confirmationOrigin = useRef<HTMLElement | null>(null);
  const [view, setView] = useState<'catalog' | 'config' | 'review' | 'saved' | 'assistant'>(
    'catalog',
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ConfigField, string>>>({});
  const [protocolOpen, setProtocolOpen] = useState(false);
  const focusInvalid = useRef(false);
  useEffect(() => {
    if (!focusInvalid.current) return;
    focusInvalid.current = false;
    const first = (
      ['name', 'type', 'url', 'auth', 'secret', 'command', 'args', 'protocol', 'source'] as const
    ).find((field) => fieldErrors[field]);
    if (first) document.getElementById(`tool-config-${first}`)?.focus();
  }, [fieldErrors]);
  const fieldProps = (field: ConfigField) => ({
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
      secret: 'Bearer Token',
    }[field],
    'aria-invalid': fieldErrors[field] ? true : undefined,
    'aria-describedby': fieldErrors[field] ? `tool-config-${field}-error` : undefined,
  });
  const fieldError = (field: ConfigField) =>
    fieldErrors[field] && (
      <small className="tool-field-error" id={`tool-config-${field}-error`}>
        {fieldErrors[field]}
      </small>
    );
  const [assistantPhase, setAssistantPhase] = useState<AssistantPhase>('setup');
  const [connections, setConnections] = useState<ToolConnection[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [connectionQuery, setConnectionQuery] = useState('');
  const connectionSearch = useRef<HTMLInputElement>(null);
  const listRead = useRef(0);
  const savedList = useRef<HTMLUListElement>(null);
  const savedHeading = useRef<HTMLHeadingElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const catalogReturn = useRef<
    { id: string; main: number; list: number; trigger?: Element | null } | undefined
  >(undefined);
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
  const discoveryOrigin = useRef<Element | null | undefined>(undefined);
  const operationError = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || view !== 'config') {
      discoveryOrigin.current = undefined;
      return;
    }
    if (busy || discoveryOrigin.current === undefined) return;
    const origin = discoveryOrigin.current;
    discoveryOrigin.current = undefined;
    if (error && (document.activeElement === origin || document.activeElement === document.body))
      operationError.current?.focus();
  }, [active, view, busy, error]);
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
    if (active && view !== 'catalog' && !referenceReturn.current)
      pageHeading.current?.focus({ preventScroll: true });
  }, [active, view]);
  const locked = useRef(false),
    epoch = useRef(0),
    request = useRef<string | undefined>(undefined);
  const selected = connections.find((connection) => connection.id === selectedId);
  const reusableBearer =
    form.type === 'http' &&
    form.auth === 'bearer' &&
    selected?.hasCredential &&
    selected.config.transport.type === 'http' &&
    selected.config.transport.auth === 'bearer' &&
    !selected.config.transport.oauth &&
    selected.config.transport.url === form.url.trim();
  const reusableOAuth =
    form.type === 'http' &&
    form.auth === 'oauth' &&
    selected?.config.transport.type === 'http' &&
    selected.config.transport.auth === 'oauth' &&
    selected.config.transport.url === form.url.trim() &&
    selected.config.protocolVersion === form.protocol;
  const query = connectionQuery.trim().toLocaleLowerCase();
  const matchingConnections = connections.filter((connection) =>
    `${connection.config.displayName} ${connection.config.source} ${address(connection.config)}`
      .toLocaleLowerCase()
      .includes(query),
  );
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
    if (!active || view !== 'catalog' || listLoading || !catalogReturn.current) return;
    const position = catalogReturn.current;
    catalogReturn.current = undefined;
    if (document.activeElement !== document.body && document.activeElement !== position.trigger)
      return;
    if (savedList.current) savedList.current.scrollTop = position.list;
    document.querySelector('main')?.scrollTo({ top: position.main });
    (rowButtons.current.get(position.id) ?? savedHeading.current)?.focus({ preventScroll: true });
  }, [active, view, listLoading, connections]);
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
    discoveryOrigin.current = undefined;
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
      if (catalogReturn.current) catalogReturn.current.trigger = document.activeElement;
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
        Object.entries(previous).filter(
          ([field]) =>
            !(field in patch) &&
            !('type' in patch) &&
            !(field === 'secret' && ('url' in patch || 'auth' in patch)),
        ),
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
      const errors: Partial<Record<ConfigField, string>> = {};
      if (form.type === 'http' && form.auth === 'bearer') {
        if (!secret && !reusableBearer)
          errors.secret = '请填写当前服务的 Bearer Token；此配置没有可复用的已保存凭据。';
        else if (secret && !/^[\x21-\x7e]{1,8192}$/.test(secret))
          errors.secret = '请填写 1–8192 个半角字母、数字或符号，不包含空格、换行或其他空白。';
      }
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
    discoveryOrigin.current = document.activeElement;
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
    discoveryOrigin.current = document.activeElement;
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
  const configActions = (className: string) => (
    <div className={`ai-task-actions tool-config-actions ${className}`}>
      {reusableOAuth && (
        <Button
          htmlType="button"
          disabled={!!busy || !sourceReviewed || undefined}
          onClick={() => void discover(true)}
        >
          使用已保存登录检查能力
        </Button>
      )}
      <Button type="primary" htmlType="submit" disabled={!!busy || !sourceReviewed || undefined}>
        {form.type === 'http' && form.auth === 'oauth'
          ? busy === 'discover'
            ? '正在检查认证配置…'
            : '检查认证站点与范围'
          : busy === 'discover'
            ? '正在发现能力…'
            : '发现并检查能力'}
      </Button>
      <Button
        htmlType="button"
        disabled={(!!busy && busy !== 'discover' && busy !== 'authorize') || undefined}
        onClick={
          busy === 'discover' || busy === 'authorize'
            ? () => void cancel().catch((e) => setError(connectionError(e)))
            : catalog
        }
      >
        {busy === 'authorize' ? '取消登录' : busy === 'discover' ? '取消检查' : '取消'}
      </Button>
    </div>
  );
  const stayWithConnection = () => {
    setPendingLeave(undefined);
    setConfirm(undefined);
    requestAnimationFrame(() => {
      if (confirmationOrigin.current?.isConnected)
        confirmationOrigin.current.focus({ preventScroll: true });
    });
  };
  useLayoutEffect(() => {
    if (pendingLeave || confirm)
      confirmationOrigin.current = document.activeElement as HTMLElement | null;
  }, [pendingLeave, confirm]);
  return (
    <div className="tools-host" hidden={!active}>
      <header className="topbar">
        <Button
          className="context-back"
          onClick={back}
          disabled={(!!busy && busy !== 'discover' && busy !== 'authorize') || undefined}
        >
          ← 返回{backLabel}
        </Button>
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
                      ? `${content.config.transport.type === 'http' ? (content.config.transport.url.startsWith('https:') ? 'HTTPS 服务' : '本机 HTTP') : '本地程序'} · ${address(content.config)} · ${content.config.source}`
                      : '来源、系统权限和能力必须逐项核对'}
            </p>
          </div>
        </div>
        {pageError && (
          <div className="alert error" role="alert" tabIndex={-1} ref={operationError}>
            {pageError}
          </div>
        )}
        {view === 'saved' && loaded && !selected && (
          <div className="alert error" role="alert">
            原连接记录已不存在。任务与历史仍保留，请返回目录选择有效连接并重新核对。
            <Button onClick={catalog}>返回连接目录</Button>
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
                <Button onClick={() => choose('web')}>查看并选择网页</Button>
              </section>
              <section className="ai-task-card">
                <h2>本机文件</h2>
                <span className="tool-status success">按文件 / 目录授权</span>
                <p>
                  读取选定文件、新建输出
                  <br />
                  范围：每次任务明确选取
                </p>
                <Button onClick={() => choose('file')}>查看并选择文件</Button>
              </section>
              <section className="ai-task-card">
                <h2>本机应用助手</h2>
                <span className="tool-status">macOS · 按任务选择窗口</span>
                <p>
                  发现窗口、核对选区与改动
                  <br />
                  执行前重新核对能力与授权
                </p>
                <Button onClick={() => move('assistant')}>连接应用助手</Button>
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
                  <Button
                    disabled={listLoading || undefined}
                    onClick={() => void refresh().catch(() => {})}
                  >
                    {listLoading ? '正在读取…' : listError ? '重新读取' : '刷新列表'}
                  </Button>
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
                {(connections.length > 6 || connectionQuery) && (
                  <div className="tool-saved-search">
                    <label className="tool-field">
                      查找连接
                      <Input
                        ref={(instance) => {
                          connectionSearch.current = instance?.input ?? null;
                        }}
                        type="search"
                        value={connectionQuery}
                        placeholder="搜索名称、来源、地址或程序"
                        onChange={(event) => {
                          setConnectionQuery(event.target.value);
                          if (savedList.current) savedList.current.scrollTop = 0;
                          if (!event.target.value && connections.length <= 6)
                            savedHeading.current?.focus({ preventScroll: true });
                        }}
                      />
                    </label>
                    <p role="status">
                      显示 {matchingConnections.length} / {connections.length} 个连接
                    </p>
                  </div>
                )}
                {!!connections.length && !matchingConnections.length && (
                  <div className="tool-saved-empty">
                    <p>没有找到匹配的连接。</p>
                    <Button
                      onClick={() => {
                        setConnectionQuery('');
                        (connections.length > 6
                          ? connectionSearch.current
                          : savedHeading.current
                        )?.focus({ preventScroll: true });
                      }}
                    >
                      清除搜索
                    </Button>
                  </div>
                )}
                {!!matchingConnections.length && (
                  <ul ref={savedList} className="tool-saved-list" aria-label="已保存的工具连接">
                    {matchingConnections.map((connection) => (
                      <li key={connection.id}>
                        <Button
                          className="tool-connection-row"
                          ref={(button) => {
                            if (button instanceof HTMLButtonElement)
                              rowButtons.current.set(connection.id, button);
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
                          <span
                            className="tool-connection-address"
                            title={address(connection.config)}
                          >
                            {connection.config.transport.type === 'http' ? '地址：' : '程序：'}
                            {address(connection.config)}
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="tool-list-note">刷新只读取本机记录，不重新连接服务或授予任务权限。</p>
              </section>
              <section className="ai-task-card">
                <h2>高级设置</h2>
                <p>自定义 MCP 地址或本地程序，仅在了解来源时配置。</p>
                <Button onClick={() => edit()}>自定义 MCP</Button>
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
                <Input
                  {...fieldProps('name')}
                  value={form.name}
                  maxLength={100}
                  placeholder="我的工具服务"
                  disabled={!!busy || undefined}
                  onChange={(e) => change({ name: e.target.value })}
                />
                {fieldError('name')}
              </label>
              <label className="tool-field">
                连接方式
                <Select<string>
                  {...fieldProps('type')}
                  value={form.type}
                  disabled={!!busy || undefined}
                  onChange={(value) => {
                    change({ type: value as Form['type'] });
                    setSecret('');
                  }}
                  options={[
                    { value: 'http', label: '远程 HTTPS / 本机 HTTP' },
                    { value: 'stdio', label: '本地程序（stdio）' },
                  ]}
                />
                {fieldError('type')}
              </label>
              {form.type === 'http' ? (
                <>
                  <label className="tool-field">
                    服务地址
                    <Input
                      {...fieldProps('url')}
                      value={form.url}
                      maxLength={2048}
                      placeholder="https://tools.example.com/mcp"
                      disabled={!!busy || undefined}
                      onChange={(e) => {
                        change({ url: e.target.value });
                        setSecret('');
                      }}
                    />
                    {fieldError('url')}
                  </label>
                  <label className="tool-field">
                    认证方式
                    <Select<string>
                      {...fieldProps('auth')}
                      value={form.auth}
                      disabled={!!busy || undefined}
                      onChange={(value) => {
                        change({ auth: value as Form['auth'] });
                        setSecret('');
                      }}
                      options={[
                        { value: 'none', label: '无需凭据' },
                        { value: 'bearer', label: 'Bearer Token' },
                        { value: 'oauth', label: 'OAuth · 浏览器登录' },
                      ]}
                    />
                    {fieldError('auth')}
                  </label>
                  {form.auth === 'bearer' && (
                    <label className="tool-field">
                      Bearer Token
                      <Input
                        {...fieldProps('secret')}
                        aria-describedby={
                          fieldErrors.secret
                            ? 'tool-config-secret-error tool-config-secret-help'
                            : 'tool-config-secret-help'
                        }
                        type="password"
                        autoComplete="off"
                        value={secret}
                        maxLength={8192}
                        disabled={!!busy || undefined}
                        placeholder={
                          reusableBearer ? '留空可复用此连接已保存的凭据' : '填写当前服务的凭据'
                        }
                        onChange={(e) => {
                          setSecret(e.target.value);
                          setError('');
                          setFieldErrors((previous) => ({ ...previous, secret: undefined }));
                          setDirty(true);
                          setSourceReviewed(false);
                        }}
                      />
                      {fieldError('secret')}
                      <small id="tool-config-secret-help">
                        {reusableBearer
                          ? '地址和认证方式与已保存连接一致；留空可复用，填写则使用本次输入。'
                          : selected?.hasCredential
                            ? '当前地址或认证与已保存连接不同，请填写当前服务的凭据。'
                            : '凭据仅发送到上方明确选择的服务。'}
                        不会回显已保存的凭据；发现后输入框清空。
                      </small>
                    </label>
                  )}
                </>
              ) : (
                <>
                  <label className="tool-field">
                    本地程序绝对路径
                    <Input
                      {...fieldProps('command')}
                      value={form.command}
                      maxLength={4096}
                      placeholder="/绝对路径/可执行程序"
                      disabled={!!busy || undefined}
                      onChange={(e) => change({ command: e.target.value })}
                    />
                    {fieldError('command')}
                  </label>
                  <label className="tool-field">
                    程序参数（JSON 字符串数组）
                    <Input.TextArea
                      {...fieldProps('args')}
                      value={form.args}
                      disabled={!!busy || undefined}
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
                  <Select<string>
                    {...fieldProps('protocol')}
                    value={form.protocol}
                    disabled={!!busy || undefined}
                    onChange={(value) => change({ protocol: value as Form['protocol'] })}
                    options={[
                      { value: '2026-07-28', label: '2026-07-28' },
                      { value: '2025-11-25', label: '2025-11-25' },
                    ]}
                  />
                  {fieldError('protocol')}
                </label>
              </details>
              <p>
                {form.type === 'http' && form.auth === 'oauth'
                  ? '先读取认证站点与范围，再使用服务分配的公开客户端 ID 登录。能力核对后才保存连接。'
                  : '先发现能力并测试，确认工具列表、身份和范围后再保存。'}
              </p>
              {configActions('tool-config-actions-wide')}
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
                <Input
                  {...fieldProps('source')}
                  value={form.source}
                  maxLength={500}
                  disabled={!!busy || undefined}
                  placeholder="填写你核对过的发布者或获取渠道"
                  onChange={(e) => change({ source: e.target.value })}
                />
                {fieldError('source')}
              </label>
              <Checkbox
                checked={sourceReviewed}
                disabled={!!busy || undefined}
                onChange={(e) => setSourceReviewed(e.target.checked)}
                className="ai-task-checkbox"
              >
                {form.type === 'http' && form.auth === 'oauth'
                  ? reusableOAuth
                    ? '我已核对来源，同意检查认证配置或使用已保存登录读取能力'
                    : '我已核对来源，同意读取此服务及其声明的认证站点配置'
                  : '我已核对来源、地址或程序及其运行方式'}
              </Checkbox>
              <p className="ai-task-note">
                {form.type === 'http' && form.auth === 'oauth'
                  ? reusableOAuth
                    ? '认证配置检查不发送凭据；复用已保存登录会向此服务发送访问令牌，必要时向原认证站点刷新，不调用工具。'
                    : '检查只读取公开的认证配置，不发送凭据、不打开登录网页、不注册客户端或调用工具。'
                  : '发现仅请求服务身份和工具清单，不调用工具。服务说明、提示词和网页内容不能替代用户授权。'}
              </p>
              {configActions('tool-config-actions-compact')}
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
                  <Checkbox
                    checked={capabilitiesReviewed}
                    disabled={!!busy || undefined}
                    onChange={(e) => setCapabilitiesReviewed(e.target.checked)}
                    className="ai-task-checkbox"
                  >
                    我已核对该连接的身份说明和完整工具清单
                  </Checkbox>
                  <p role="status">
                    {clock >= candidate.expiresAt
                      ? '检查已过期，请返回设置重新发现。'
                      : `检查结果有效至 ${when(new Date(candidate!.expiresAt).toISOString())}；保存不会执行任何工具。`}
                  </p>
                  <Button
                    type="primary"
                    disabled={
                      !!busy || !capabilitiesReviewed || clock >= candidate.expiresAt || undefined
                    }
                    onClick={() => void save()}
                  >
                    {busy === 'save' ? '正在保存…' : '保存这个连接'}
                  </Button>
                  <Button
                    disabled={!!busy || undefined}
                    onClick={() =>
                      void cancel()
                        .then(() => move('config'))
                        .catch((e) => setError(connectionError(e)))
                    }
                  >
                    取消，回到设置
                  </Button>
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
                    <Button
                      type={selected.status === 'verified' ? 'primary' : 'default'}
                      disabled={!!busy || undefined}
                      onClick={catalog}
                    >
                      返回应用与工具
                    </Button>
                    <Button disabled={!!busy || undefined} onClick={() => edit(selected)}>
                      查看连接设置
                    </Button>
                    {selected.status !== 'verified' && (
                      <Button
                        type="primary"
                        disabled={!!busy || undefined}
                        onClick={() => edit(selected)}
                      >
                        重新检查连接
                      </Button>
                    )}
                    <details className="tool-connection-maintenance">
                      <summary>连接维护与任务引用</summary>
                      {selected.status === 'verified' && (
                        <Button disabled={!!busy || undefined} onClick={() => edit(selected)}>
                          重新检查连接
                        </Button>
                      )}
                      <ToolConnectionUsage
                        connection={selected}
                        busy={!!busy}
                        openTask={(task) => void openReference(task)}
                      />
                      <Button disabled={!!busy || undefined} onClick={() => void inspect()}>
                        {busy === 'inspect' ? '正在刷新引用…' : '刷新连接与任务引用'}
                      </Button>
                      {busy === 'open-task' && (
                        <p role="status">正在保存原任务草稿并核对目标任务…</p>
                      )}
                      <Button
                        disabled={!!busy || selected.status === 'disconnected' || undefined}
                        onClick={() => void inspect('disconnect')}
                      >
                        断开连接
                      </Button>
                      <Button disabled={!!busy || undefined} onClick={() => void inspect('remove')}>
                        删除连接
                      </Button>
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
        <Modal
          open
          width={640}
          centered
          closable={false}
          mask={{ closable: false }}
          className="flowark-leave-modal"
          focusable={{ focusTriggerAfterClose: false }}
          keyboard={!busy || busy === 'discover' || busy === 'authorize'}
          onCancel={() => {
            if (!busy || busy === 'discover' || busy === 'authorize') stayWithConnection();
          }}
          afterOpenChange={(open) => {
            if (open) confirmationCancel.current?.focus();
          }}
          title="离开尚未保存的连接？"
          footer={
            <Flex gap={12} wrap className="flowark-leave-actions">
              <Button ref={confirmationCancel} onClick={stayWithConnection}>
                继续编辑
              </Button>
              <Button
                color="danger"
                variant="filled"
                disabled={(!!busy && busy !== 'discover' && busy !== 'authorize') || undefined}
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
              </Button>
            </Flex>
          }
        >
          <p>将取消这次检查并丢弃未保存的配置和凭据输入；已保存连接保持不变。</p>
          {error && <Alert type="error" title="操作未完成" description={error} role="alert" />}
        </Modal>
      )}
      {confirm && selected && (
        <Modal
          open
          width={640}
          centered
          closable={false}
          mask={{ closable: false }}
          keyboard={!busy}
          focusable={{ focusTriggerAfterClose: false }}
          onCancel={() => {
            if (!busy) stayWithConnection();
          }}
          afterOpenChange={(open) => {
            if (open) confirmationCancel.current?.focus();
          }}
          title={`${confirm === 'remove' ? '删除' : '断开'}“${selected.config.displayName}”？`}
          footer={
            <Flex gap={12} wrap justify="flex-end">
              <Button
                ref={confirmationCancel}
                disabled={!!busy || undefined}
                onClick={stayWithConnection}
              >
                取消
              </Button>
              <Button
                danger
                loading={!!busy}
                disabled={!!busy || undefined}
                onClick={() => void manage(confirm)}
              >
                确认{confirm === 'remove' ? '删除' : '断开'}
              </Button>
            </Flex>
          }
        >
          <p>
            {confirm === 'remove'
              ? '删除本机连接记录和其专属凭据。不会删除任务、运行历史或产物。'
              : '保留配置与历史能力，取消该连接未完成的检查。恢复需要你重新检查。'}
          </p>
          <ToolConnectionUsage connection={selected} />
          <p>以上为刚读取的引用。本操作不会新增运行或重放任务；已完成的外部操作不会回滚。</p>
          {error && <Alert type="error" title="操作未完成" description={error} role="alert" />}
        </Modal>
      )}
    </div>
  );
}
