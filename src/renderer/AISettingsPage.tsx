import { usePageBack } from './use-page-back';
import type { SettingsDestination } from './LocalSettingsPage';
import type { TemplateDetail } from './template-draft';
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  aiErrorMessage,
  aiModel,
  aiKey,
  type AIConfigurationState,
  type AIErrorCode,
  type AIProviderId,
} from '../shared/ai-settings';
import './ai-settings.css';
import './editor-leave.css';

const api = (method: string, args: unknown): Promise<any> =>
  window.flowark.request('ai.configuration.' + method, args);
const message = (error: unknown) =>
  (error instanceof Error ? error.message : '操作未完成，请重新核对').replace(
    /^Error invoking remote method 'flowark:request': (?:Error: )?/,
    '',
  );
export type AISettingsEntry = {
  key: string;
  provider: AIProviderId;
  model: string;
  source?:
    | { kind?: 'task'; title: string; taskId?: string }
    | {
        kind: 'template';
        title: string;
        instanceId: string;
        entryId: string;
        packageKey: string;
        entryFlowId?: string;
        view?: 'resources' | 'entry';
      };
};
export type AISettingsNavigation = (next: () => void, destination?: string) => void;
const providerName = (id: AIProviderId) => (id === 'deepseek' ? 'DeepSeek' : 'OpenAI');
const mask = (state: AIConfigurationState) => `••••••••${state.tail ? ' ' + state.tail : ''}`;

const connectionFailures: Record<AIErrorCode, { title: string; next: string }> = {
  authentication: {
    title: '密钥验证未通过',
    next: '核对当前服务的 Key 与账号权限后替换 Key，再主动测试。',
  },
  quota: {
    title: '配额不足或请求受限',
    next: '在当前服务商处核对余额、额度及请求限制，处理后再主动测试。',
  },
  request: {
    title: '模型或请求不可用',
    next: '核对当前账号可用的模型 ID，修改并保存后再测试。',
  },
  network: {
    title: '暂时无法连接服务',
    next: '核对本机网络与服务地址是否可达，恢复后再主动测试。',
  },
  timeout: {
    title: '连接测试超时',
    next: '尚未取得完整验证结果。可稍后主动重新测试，不会自动重试。',
  },
  output: {
    title: '测试输出格式不符合要求',
    next: '本次固定测试没有通过格式校验。核对模型后再测试；任务输出需在对应任务中单独核对。',
  },
  storage: {
    title: '本机配置状态不可用',
    next: '恢复系统凭据保护或本地存储后再测试，不会降级为明文保存。',
  },
};

export default function AISettingsPage({
  active,
  entry,
  navigation,
  back,
  changed,
  onSaved,
  home,
  selectProvider,
  templateLibrary,
}: {
  active: boolean;
  entry: AISettingsEntry;
  navigation: MutableRefObject<AISettingsNavigation | undefined>;
  back: () => void;
  changed: () => Promise<void>;
  onSaved: (state: AIConfigurationState) => void;
  home: (tab?: SettingsDestination) => void;
  selectProvider: (provider: AIProviderId) => void;
  templateLibrary: () => void;
}) {
  const [storedState, setState] = useState<AIConfigurationState>();
  const [loadedEntry, setLoadedEntry] = useState<string>();
  const state = loadedEntry === entry.key ? storedState : undefined;
  const [model, setModel] = useState(entry.model),
    [key, setKey] = useState('');
  const [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState('');
  const [invalid, setInvalid] = useState<'model' | 'key'>();
  const [checkingSource, setCheckingSource] = useState(false);
  const [sourceFailure, setSourceFailure] = useState<'changed' | 'unavailable'>();
  const sourceCheck = useRef(0),
    sourcePending = useRef(false),
    sourceHeading = useRef<HTMLHeadingElement>(null),
    sourceReturn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    sourceCheck.current++;
    sourcePending.current = false;
    setCheckingSource(false);
    setSourceFailure(undefined);
    return () => {
      sourceCheck.current++;
    };
  }, [active, entry.key]);
  useLayoutEffect(() => {
    if (active && sourceFailure) {
      document.querySelector('main')?.scrollTo({ top: 0 });
      sourceHeading.current?.focus({ preventScroll: true });
    }
  }, [active, sourceFailure]);
  const modelInput = useRef<HTMLInputElement>(null),
    keyInput = useRef<HTMLInputElement>(null),
    resultHeading = useRef<HTMLHeadingElement>(null),
    formError = useRef<HTMLParagraphElement>(null);
  const focusField = useRef<'model' | 'key' | undefined>(undefined),
    focusResult = useRef(false),
    focusSaveError = useRef(false);
  const [busy, setBusy] = useState<'save' | 'remove' | 'test' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancellationPending = useRef(false);
  const [leaving, setLeaving] = useState<{ next: () => void; destination: string }>(),
    [removing, setRemoving] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null),
    removeHeading = useRef<HTMLHeadingElement>(null),
    cancelRemove = useRef<HTMLButtonElement>(null);
  const lock = useRef(false),
    epoch = useRef(0),
    request = useRef<string | undefined>(undefined);
  const title = useRef<HTMLHeadingElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    dialogHeading = useRef<HTMLHeadingElement>(null),
    continueButton = useRef<HTMLButtonElement>(null),
    lastInput = useRef<HTMLElement | null>(null);
  const provider = entry.provider,
    fromTemplate = entry.source?.kind === 'template',
    templateLabel =
      fromTemplate && entry.source?.kind === 'template' && entry.source.view === 'resources'
        ? '实例授权'
        : '模板入口',
    name = providerName(provider),
    testing = busy === 'test' || state?.operation === 'testing';
  const sourceLabel = fromTemplate
    ? `${templateLabel} · ${entry.source!.title}`
    : entry.source?.title || '本地设置';
  useLayoutEffect(() => {
    if (!active) return;
    if (editing && !busy && focusField.current) {
      (focusField.current === 'model' ? modelInput : keyInput).current?.focus();
      focusField.current = undefined;
    }
    if (editing && !busy && focusSaveError.current) {
      formError.current?.focus();
      focusSaveError.current = false;
    }
    if (!editing && !busy && focusResult.current) {
      resultHeading.current?.focus({ preventScroll: true });
      focusResult.current = false;
    }
  });
  const reload = async () => {
    const next: AIConfigurationState = await api('get', { provider });
    setState(next);
    setLoadedEntry(entry.key);
    return next;
  };
  useEffect(() => {
    if (!active) return;
    let live = true;
    setState(undefined);
    setKey('');
    setDirty(false);
    setError('');
    setInvalid(undefined);
    focusField.current = undefined;
    focusResult.current = false;
    focusSaveError.current = false;
    lastInput.current = null;
    setEditing(false);
    setLeaving(undefined);
    setRemoving(false);
    void api('get', { provider })
      .then((next: AIConfigurationState) => {
        if (!live) return;
        setState(next);
        setLoadedEntry(entry.key);
        setModel(next.configured ? next.model : entry.model);
        setEditing(!next.configured);
        title.current?.focus();
      })
      .catch((error) => {
        if (live) setError(message(error));
      });
    return () => {
      live = false;
    };
  }, [active, entry.key]);
  useEffect(() => {
    if (leaving) {
      if (!lastInput.current?.isConnected)
        lastInput.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
      continueButton.current?.focus();
    }
  }, [leaving]);
  useEffect(() => {
    if (removing) cancelRemove.current?.focus();
  }, [removing]);
  useEffect(() => {
    if (leaving && error) dialogHeading.current?.focus();
    else if (removing && error) removeHeading.current?.focus();
  }, [leaving, removing, error]);
  useEffect(() => {
    if (!active || !state || busy) return;
    let live = true,
      pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void api('get', { provider })
        .then((next: AIConfigurationState) => {
          if (live)
            setState((current) =>
              current?.revision === next.revision ? { ...current, inUse: next.inUse } : current,
            );
        })
        .catch((error) => {
          if (live) setError(message(error));
        })
        .finally(() => {
          pending = false;
        });
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, entry.key, state?.revision, busy]);
  const go: AISettingsNavigation = (next, destination = sourceLabel) => {
    if (cancellationPending.current) return;
    if (busy === 'save' || busy === 'remove') {
      setError('请等待配置保存或移除完成');
      return;
    }
    if (dirty || testing) setLeaving({ next, destination });
    else {
      setKey('');
      lastInput.current = null;
      next();
    }
  };
  navigation.current = go;
  const checkSource = async () => {
    if (sourcePending.current) return;
    if (entry.source?.kind !== 'template') {
      back();
      return;
    }
    const source = entry.source;
    const check = ++sourceCheck.current;
    sourcePending.current = true;
    setCheckingSource(true);
    try {
      const fresh: TemplateDetail = await window.flowark.request('template.detail', {
        id: source.instanceId,
      });
      if (check !== sourceCheck.current) return;
      if (
        fresh?.instance.id !== source.instanceId ||
        fresh.instance.packageKey !== source.packageKey ||
        (source.entryFlowId !== undefined &&
          fresh.instance.entryFlows[source.entryId] !== source.entryFlowId) ||
        !fresh.entries.some((item) => item.id === source.entryId)
      )
        setSourceFailure('changed');
      else {
        setSourceFailure(undefined);
        back();
      }
    } catch {
      if (check === sourceCheck.current) setSourceFailure('unavailable');
    } finally {
      if (check === sourceCheck.current) {
        sourcePending.current = false;
        setCheckingSource(false);
      }
    }
  };
  const returnToSource = () => go(() => void checkSource());
  const stayInSettings = () => {
    sourceCheck.current++;
    sourcePending.current = false;
    setCheckingSource(false);
    setSourceFailure(undefined);
    requestAnimationFrame(() => sourceReturn.current?.focus({ preventScroll: true }));
  };
  const stay = () => {
    if (busy === 'save' || busy === 'remove' || cancellationPending.current) return;
    setLeaving(undefined);
    setRemoving(false);
    requestAnimationFrame(() => {
      if (removing) removeButton.current?.focus({ preventScroll: true });
      else if (!dirty && !testing) {
        resultHeading.current?.scrollIntoView({ block: 'nearest' });
        resultHeading.current?.focus({ preventScroll: true });
      } else if (lastInput.current?.isConnected) lastInput.current.focus({ preventScroll: true });
    });
  };
  usePageBack(
    () => (sourceFailure ? stayInSettings() : removing ? stay() : returnToSource()),
    active,
  );
  useEffect(
    () => () => {
      epoch.current++;
      if (request.current)
        void api('cancel', { provider, requestId: request.current }).catch(() => {});
    },
    [provider],
  );
  const save = async () => {
    if (!state || lock.current) return false;
    if (!aiModel.safeParse(model).success) {
      setInvalid('model');
      modelInput.current?.focus();
      setError('请填写有效的模型 ID');
      return false;
    }
    if ((!state.configured || key) && !aiKey.safeParse(key).success) {
      setInvalid('key');
      keyInput.current?.focus();
      setError('请填写有效的 API Key，不能包含空白字符');
      return false;
    }
    lock.current = true;
    setBusy('save');
    setInvalid(undefined);
    setError('');
    try {
      const saved: AIConfigurationState = await api('save', {
        provider,
        revision: state.revision,
        model,
        ...(key ? { apiKey: key } : {}),
      });
      focusResult.current = true;
      setState(saved);
      setModel(saved.model);
      setKey('');
      setDirty(false);
      setEditing(false);
      onSaved(saved);
      await changed().catch(() => setError('配置已保存，本地概览暂未刷新，请稍后重新打开设置。'));
      return true;
    } catch (error) {
      focusSaveError.current = true;
      setError(message(error));
      return false;
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };
  const beginEdit = (field: 'model' | 'key') => {
    if (!state || busy || testing || state.inUse) return;
    focusField.current = field;
    focusSaveError.current = false;
    setEditing(true);
    setModel(state.model);
    setKey('');
    setDirty(false);
    setInvalid(undefined);
    setError('');
  };
  const cancelEdit = () =>
    go(() => {
      setKey('');
      setModel(state?.model ?? entry.model);
      focusResult.current = !!state?.configured;
      setInvalid(undefined);
      setError('');
      setDirty(false);
      setEditing(!state?.configured);
    }, '当前 AI 配置');
  const test = async () => {
    if (!state?.configured || !state.revision || lock.current) return;
    const requestId = crypto.randomUUID(),
      ticket = ++epoch.current;
    request.current = requestId;
    lock.current = true;
    setBusy('test');
    setError('');
    try {
      const next = await api('test', {
        provider,
        revision: state.revision,
        requestId,
        reviewedCost: true,
      });
      if (ticket === epoch.current) {
        focusResult.current = true;
        setState(next);
        setError('');
      }
    } catch (error) {
      if (ticket === epoch.current) setError(message(error));
    } finally {
      if (ticket === epoch.current) {
        lock.current = false;
        request.current = undefined;
        setBusy(null);
      }
    }
  };
  const cancelTest = async () => {
    if (cancellationPending.current) return false;
    const id = request.current;
    if (!id) throw new Error('未取得当前测试的取消标识，请等待测试状态更新');
    cancellationPending.current = true;
    setCancelling(true);
    try {
      await api('cancel', { provider, requestId: id });
      epoch.current++;
      const next = await reload();
      if (next.operation === 'testing') throw new Error('测试仍在收尾，请稍后再次取消');
      request.current = undefined;
      lock.current = false;
      setBusy(null);
      return true;
    } finally {
      cancellationPending.current = false;
      setCancelling(false);
    }
  };
  const remove = async () => {
    if (!state || state.inUse || lock.current) return;
    lock.current = true;
    setBusy('remove');
    setError('');
    try {
      const next = await api('remove', { provider, revision: state.revision, confirmed: true });
      setState(next);
      setKey('');
      setModel(next.model);
      focusField.current = 'model';
      setEditing(true);
      setDirty(false);
      setRemoving(false);
      await changed().catch(() => setError('配置已移除，本地概览暂未刷新，请稍后重新打开设置。'));
    } catch (error) {
      setError(message(error));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };
  const failedCode = state?.test?.status === 'failed' ? state.test.code : undefined;
  const repairField =
    failedCode === 'authentication' ? 'key' : failedCode === 'request' ? 'model' : undefined;
  const failure = failedCode ? connectionFailures[failedCode] : undefined;
  const summary = !state
    ? '正在读取配置'
    : testing
      ? '正在测试'
      : dirty
        ? '有未保存更改'
        : !state.configured
          ? '未配置'
          : state.test?.status === 'passed'
            ? '连接已验证'
            : state.test?.status === 'failed'
              ? '连接失败'
              : state.test?.status === 'cancelled'
                ? '测试已取消'
                : state.test?.status === 'interrupted'
                  ? '上次测试已中断'
                  : '已保存 · 待验证';
  const tone = testing
    ? 'running'
    : !state?.configured || dirty
      ? 'neutral'
      : state.test?.status === 'passed'
        ? 'success'
        : state.test?.status === 'failed'
          ? 'error'
          : 'warning';
  if (sourceFailure)
    return (
      <div className="ai-settings-host" hidden={!active}>
        <header className="topbar">
          <button className="context-back" onClick={stayInSettings}>
            ← 返回 AI 设置
          </button>
          <nav className="breadcrumbs" aria-label="当前位置">
            <a
              href="#ai-settings"
              onClick={(event) => {
                event.preventDefault();
                stayInSettings();
              }}
            >
              AI 服务
            </a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">无法返回原来源</span>
          </nav>
        </header>
        <section className="page ai-task-page ai-settings-page ai-source-unavailable">
          <div className="page-heading">
            <div>
              <h1 ref={sourceHeading} tabIndex={-1}>
                {sourceFailure === 'changed' ? '原页面已不可用' : '暂时无法返回原页面'}
              </h1>
              <p>
                {sourceFailure === 'changed'
                  ? '原实例或入口已变化。请选择明确的去向，再选择要继续操作的实例。'
                  : '暂时无法核对原实例或入口。可以重新读取，当前模板输入仍保留。'}
              </p>
            </div>
          </div>
          <article className="ai-task-card ai-source-unavailable-card">
            <span className="ai-config-status warning">无法返回原来源</span>
            <h2>{name} 设置仍保留</h2>
            <p>此次返回未修改已保存的 AI 配置，也不会自动打开另一个实例。</p>
            <p className="ai-source-unavailable-origin">原来源：{entry.source?.title}</p>
            <div className="ai-task-actions">
              <button className="primary" onClick={templateLibrary}>
                返回模板库
              </button>
              <button onClick={stayInSettings}>留在 AI 设置</button>
              {sourceFailure === 'unavailable' && (
                <button disabled={checkingSource} onClick={() => void checkSource()}>
                  {checkingSource ? '正在核对来源…' : '重新核对来源'}
                </button>
              )}
            </div>
          </article>
        </section>
      </div>
    );
  return (
    <div
      className="ai-settings-host"
      hidden={!active}
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.matches('input,textarea,select') && !target.closest('dialog'))
          lastInput.current = target;
      }}
    >
      <header className="topbar">
        <button
          ref={sourceReturn}
          disabled={checkingSource}
          className={`context-back${entry.source ? ' from-task' : ''}`}
          onClick={() => (removing ? stay() : returnToSource())}
        >
          {checkingSource ? '正在核对来源…' : '← 返回'}
          {!checkingSource &&
            (removing
              ? 'AI 服务'
              : fromTemplate
                ? templateLabel
                : entry.source
                  ? '原任务'
                  : '本地设置')}
        </button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#ai-source"
            onClick={(e) => {
              e.preventDefault();
              if (fromTemplate) go(home, '本地设置');
              else returnToSource();
            }}
          >
            {fromTemplate ? '本地设置' : entry.source ? '开始任务' : '本地设置'}
          </a>
          <span aria-hidden="true">/</span>
          {entry.source && (
            <>
              <span className="ai-source-title" title={entry.source.title}>
                {entry.source.title}
              </span>
              <span aria-hidden="true">/</span>
            </>
          )}
          <span aria-current="page">AI 服务</span>
        </nav>
      </header>
      <section
        className="page ai-task-page ai-settings-page"
        inert={checkingSource}
        aria-busy={checkingSource}
      >
        <div className="page-heading">
          <div>
            <h1 ref={title} tabIndex={-1}>
              AI 服务
            </h1>
            <p>
              {entry.source
                ? fromTemplate
                  ? `来自：${entry.source.title} · 返回后保留本次输入`
                  : `来源：${entry.source.title} · 配置后继续原草稿`
                : '配置这台 Mac 的模型服务，供已授权的流程和模板使用。'}
            </p>
          </div>
        </div>
        {(!entry.source || fromTemplate) && (
          <nav className="ai-settings-tabs" aria-label="设置分类">
            <button onClick={() => go(() => home('browser'), '浏览器设置')}>浏览器</button>
            <span aria-current="page">AI 服务</span>
            <button onClick={() => go(() => home('resources'), '凭据与本机资源')}>
              凭据与文件
            </button>
            <button onClick={() => go(() => home('scripts'), '脚本包配置')}>脚本</button>
          </nav>
        )}
        {error && !removing && !editing && (
          <div className="ai-task-error" role="alert" id="ai-settings-error">
            {error}
          </div>
        )}
        {removing ? (
          <section
            className="ai-task-card ai-remove-confirmation"
            aria-labelledby="ai-remove-title"
            aria-busy={busy === 'remove'}
          >
            <span className="ai-config-status warning">移除本机配置</span>
            <h2 id="ai-remove-title" ref={removeHeading} tabIndex={-1}>
              移除 {name} 配置？
            </h2>
            <p>
              将移除这台 Mac 保存的 Key{state?.tail ? `（尾四位 ${state.tail}）` : ''}。
              依赖此资源的入口下次运行前需要重新配置。
            </p>
            <p>
              不会撤销 {name} 平台上的 Key，也不会删除任务或运行历史。
              正在使用该资源时需等待运行结束。
            </p>
            {state?.inUse && <p className="ai-task-note">资源正在使用，暂时不能移除配置。</p>}
            {error && (
              <p className="ai-task-error" role="alert">
                {error}
              </p>
            )}
            <div className="ai-task-actions">
              <button ref={cancelRemove} disabled={busy === 'remove'} onClick={stay}>
                取消
              </button>
              <button
                className="ai-remove-button"
                disabled={!!busy || !state || state.inUse}
                onClick={() => void remove()}
              >
                {busy === 'remove' ? '正在移除…' : error ? '重试移除' : '确认移除'}
              </button>
            </div>
          </section>
        ) : !state ? (
          <section className="ai-task-card">
            <p>{error ? '配置读取未完成，未将错误当作未配置。' : '正在读取本机配置…'}</p>
            <button
              onClick={() =>
                void reload()
                  .then((next) => {
                    setModel(next.model);
                    setEditing(!next.configured);
                    setError('');
                  })
                  .catch((e) => setError(message(e)))
              }
            >
              重新读取
            </button>
          </section>
        ) : (
          <div className={`ai-settings-columns${!entry.source ? ' is-general-settings' : ''}`}>
            <section
              className={`ai-task-card ai-provider-card${editing ? ' is-editing' : ''}${!entry.source ? ' is-general-provider' : ''}`}
            >
              {!entry.source ? (
                <label className="ai-settings-field ai-provider-selection">
                  服务商
                  <select
                    value={provider}
                    disabled={!!busy || testing}
                    onChange={(event) => {
                      const next = event.target.value as AIProviderId;
                      if (next !== provider)
                        go(() => selectProvider(next), `${providerName(next)} 配置`);
                    }}
                  >
                    <option value="openai-codex">Codex / OpenAI API</option>
                    <option value="deepseek">DeepSeek</option>
                  </select>
                </label>
              ) : (
                <>
                  <div className="ai-provider-heading">
                    <h2>{name}</h2>
                    <span className="ai-config-status neutral">
                      {provider === 'deepseek' ? '首版接入' : 'Responses API'}
                    </span>
                  </div>
                  <div className="ai-settings-field">
                    <span>服务地址</span>
                    <p>
                      {provider === 'deepseek'
                        ? 'https://api.deepseek.com'
                        : 'https://api.openai.com/v1/responses'}
                    </p>
                  </div>
                </>
              )}
              {editing ? (
                <>
                  <label className="ai-settings-field">
                    模型 ID
                    <input
                      ref={modelInput}
                      aria-invalid={invalid === 'model'}
                      aria-describedby={invalid === 'model' ? 'ai-settings-error' : undefined}
                      value={model}
                      placeholder="填写账号可用的模型 ID"
                      disabled={!!busy || testing || state.inUse}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setDirty(true);
                        if (invalid === 'model') {
                          setInvalid(undefined);
                          setError('');
                        }
                      }}
                    />
                  </label>
                  {state.configured && (
                    <div className="ai-settings-field">
                      <span>当前已保存的 Key</span>
                      <p>{mask(state)} · 已配置</p>
                    </div>
                  )}
                  <label className="ai-settings-field">
                    {state.configured ? '新的 API Key（可选）' : 'API Key'}
                    <input
                      ref={keyInput}
                      aria-invalid={invalid === 'key'}
                      aria-describedby={invalid === 'key' ? 'ai-settings-error' : undefined}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={key}
                      placeholder={
                        state.configured ? '输入新 Key，留空则保留原 Key' : `输入 ${name} API Key`
                      }
                      disabled={!!busy || testing || state.inUse}
                      onChange={(e) => {
                        setKey(e.target.value);
                        setDirty(true);
                        if (invalid === 'key') {
                          setInvalid(undefined);
                          setError('');
                        }
                      }}
                    />
                  </label>
                  <p>
                    {state.configured
                      ? '保存成功前继续保留原 Key；留空不覆盖原配置。'
                      : key
                        ? '已输入，尚未保存。粘贴内容不会在其他页面回显。'
                        : '尚未保存密钥。配置完成后，这里会显示掩码和尾四位。'}
                  </p>
                  {error && (
                    <p
                      className="ai-config-form-error"
                      id="ai-settings-error"
                      role="alert"
                      ref={formError}
                      tabIndex={-1}
                    >
                      {error}
                    </p>
                  )}
                  <div className="ai-task-actions">
                    <button
                      className="primary"
                      disabled={!!busy || testing || state.inUse || (!dirty && state.configured)}
                      onClick={() => void save()}
                    >
                      {busy === 'save' ? '正在保存…' : '保存配置'}
                    </button>
                    <button disabled={!!busy} onClick={cancelEdit}>
                      取消
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="ai-settings-field">
                    <span>模型 ID</span>
                    <button
                      className="ai-model-value"
                      disabled={!!busy || testing || state.inUse}
                      aria-label="修改模型 ID"
                      onClick={() => beginEdit('model')}
                    >
                      <span className="ai-model-name">{state.model}</span>
                      <span>修改</span>
                    </button>
                  </div>
                  <div className="ai-saved-key">
                    <div>
                      API Key <span className="ai-config-status success">已配置</span>
                    </div>
                    <strong>{mask(state)}</strong>
                    <small>{state.tail ? '仅显示尾四位' : '已有受保护 Key · 无尾号元数据'}</small>
                  </div>
                  <div className="ai-task-actions">
                    <button
                      disabled={!!busy || testing || state.inUse}
                      onClick={() => beginEdit('key')}
                    >
                      替换 Key
                    </button>
                    {!entry.source && (
                      <button
                        ref={removeButton}
                        className="ai-remove-button"
                        disabled={!!busy || testing || state.inUse}
                        onClick={() => {
                          setError('');
                          setRemoving(true);
                        }}
                      >
                        移除配置
                      </button>
                    )}
                  </div>
                  <p>重新打开设置仍显示脱敏标识；完整 Key 不提供回显或复制。</p>
                </>
              )}
              {!entry.source ? (
                <>
                  <p className="ai-task-note ai-provider-scope">
                    这里配置通用接口。业务提示词和输出规则由模板提供。
                  </p>
                  <details className="ai-provider-description">
                    <summary>服务地址与模型说明</summary>
                    <p>
                      {provider === 'deepseek'
                        ? 'https://api.deepseek.com'
                        : 'https://api.openai.com/v1/responses'}
                    </p>
                    <p>
                      两家服务分别保存模型与受保护的
                      Key，不会自动替换。模型按当前账号可用项填写，修改模型或替换 Key
                      后需要重新测试连接。
                    </p>
                  </details>
                </>
              ) : (
                <small>模型按当前账号可用项填写。修改模型或替换 Key 后，需要重新测试连接。</small>
              )}
              {state.inUse && (
                <p className="ai-task-note">
                  该资源正在被运行或方案生成使用，结束后才能更改或移除配置。
                </p>
              )}
            </section>
            <section className="ai-task-card ai-connection-card">
              <h2 ref={resultHeading} tabIndex={-1}>
                连接状态
              </h2>
              <span role="status" className={`ai-config-status ${tone}`}>
                {summary}
              </span>
              <h3>
                {testing
                  ? `正在请求 ${name}`
                  : dirty
                    ? '保存后再测试'
                    : !state.configured
                      ? '先保存模型与 Key'
                      : state.test?.status === 'passed'
                        ? `${name} 可正常响应`
                        : state.test?.status === 'failed'
                          ? (failure?.title ?? '连接测试未通过')
                          : state.test?.status === 'cancelled'
                            ? '测试已取消'
                            : state.test?.status === 'interrupted'
                              ? '上次测试未完成'
                              : '配置已安全保存'}
              </h3>
              <p>
                {!testing && !dirty && state.configured && state.test?.status === 'passed' && (
                  <>
                    最近测试：
                    {Number.isFinite(Date.parse(state.test.at)) ? (
                      <time dateTime={state.test.at}>
                        {new Date(state.test.at).toLocaleString('zh-CN')}
                      </time>
                    ) : (
                      '未取得有效时间'
                    )}
                    <br />
                    模型：{state.test.model ?? '未记录'}
                    <br />
                  </>
                )}
                {testing
                  ? '正在测试当前已保存的模型和 Key。'
                  : dirty
                    ? '密钥保存与连接测试是两个独立操作。'
                    : !state.configured
                      ? '仅需要 AI 的入口受影响，其他流程仍可使用。'
                      : state.test?.status === 'passed'
                        ? '此结果对应当前已保存配置；任务输出仍需按其要求单独核对。'
                        : state.test?.status === 'failed' && state.test.code
                          ? aiErrorMessage[state.test.code]
                          : state.test?.status === 'cancelled' ||
                              state.test?.status === 'interrupted'
                            ? '配置仍然保留，尚未取得本次完整验证结果。没有自动重试。'
                            : '尚未发起连接测试。保存成功不代表密钥或模型可用。'}
              </p>
              {!testing && !dirty && state.configured && failure && (
                <p className="ai-connection-next">{failure.next}</p>
              )}
              {state.test && !testing && (
                <details className="ai-provider-description ai-test-details">
                  <summary>查看本次连接详情</summary>
                  {dirty && <p>以下记录对应已保存配置，不包含尚未保存的输入。</p>}
                  <dl>
                    <div>
                      <dt>服务</dt>
                      <dd>{name}</dd>
                    </div>
                    <div>
                      <dt>测试模型</dt>
                      <dd>{state.test.model ?? '未记录'}</dd>
                    </div>
                    <div>
                      <dt>更新时间</dt>
                      <dd>
                        {Number.isFinite(Date.parse(state.test.at))
                          ? new Date(state.test.at).toLocaleString('zh-CN')
                          : '未取得有效时间'}
                      </dd>
                    </div>
                    <div>
                      <dt>本地请求标识</dt>
                      <dd>{state.test.requestId}</dd>
                    </div>
                  </dl>
                  <p>标识仅用于区分本地测试记录，不是服务商的请求回执。</p>
                </details>
              )}
              {state.configured && !editing && (
                <>
                  <button
                    className="primary"
                    disabled={cancelling || (!!busy && !testing)}
                    onClick={() =>
                      void (testing ? cancelTest() : test()).catch((e) => setError(message(e)))
                    }
                  >
                    {testing
                      ? cancelling
                        ? '正在取消测试…'
                        : '取消测试'
                      : state.test?.status === 'passed'
                        ? '重新测试'
                        : '测试连接'}
                  </button>
                  {!testing && repairField && (
                    <button disabled={!!busy || state.inUse} onClick={() => beginEdit(repairField)}>
                      {repairField === 'key' ? '替换 Key' : '修改模型 ID'}
                    </button>
                  )}
                  <small>
                    测试只发送固定测试文本，可能产生少量 API 费用。不会发送任务或模板业务数据。
                  </small>
                </>
              )}
              <button disabled={checkingSource} onClick={returnToSource}>
                {checkingSource
                  ? '正在核对来源…'
                  : fromTemplate
                    ? '返回' + templateLabel
                    : entry.source
                      ? '继续原任务'
                      : '返回本地设置'}
              </button>
              <small>本页配置仅用于已授权的任务。</small>
            </section>
          </div>
        )}
      </section>
      {leaving && (
        <dialog
          ref={dialog}
          className="editor-leave-dialog ai-settings-leave"
          aria-labelledby="ai-settings-dialog-title"
          aria-describedby="ai-settings-dialog-description"
          aria-busy={cancelling || busy === 'save'}
          onCancel={(e) => {
            e.preventDefault();
            stay();
          }}
        >
          <span className={`editor-leave-status${error ? ' is-error' : ''}`}>
            {cancelling
              ? '正在取消连接测试'
              : testing
                ? '连接测试尚未结束'
                : !dirty
                  ? '连接测试已结束'
                  : error
                    ? '未保存 · 留在当前页'
                    : '存在未保存更改'}
          </span>
          <h2 id="ai-settings-dialog-title" ref={dialogHeading} tabIndex={-1}>
            {cancelling
              ? '正在取消测试，请稍候'
              : testing
                ? '取消测试并离开？'
                : dirty
                  ? '离开前保存更改？'
                  : '测试已结束，继续离开？'}
          </h2>
          <p id="ai-settings-dialog-description">
            {testing
              ? `测试尚未完成。取消后前往“${leaving?.destination}”，已保存配置保持不变。`
              : dirty
                ? `当前配置尚未保存。保存成功后前往“${leaving?.destination}”；${state?.configured ? '不保存只放弃本次编辑，原 Key 和验证状态保持不变。' : '不保存将放弃本次输入，不会保存 Key。'}`
                : `连接测试已结束，配置与测试记录已保留。继续前往“${leaving.destination}”，或留在当前页查看结果。`}
          </p>
          {error && (
            <p className="editor-leave-error" role="alert">
              {error}
            </p>
          )}
          <div className="editor-leave-actions">
            <button
              autoFocus
              ref={continueButton}
              disabled={cancelling || busy === 'save' || busy === 'remove'}
              onClick={stay}
            >
              {testing ? '继续等待' : dirty ? '继续编辑' : '查看测试结果'}
            </button>
            <button
              className={testing || dirty ? 'editor-leave-discard' : 'primary'}
              disabled={cancelling || busy === 'save' || busy === 'remove'}
              onClick={() => {
                const next = leaving!.next;
                void (testing ? cancelTest() : Promise.resolve(true))
                  .then((cancelled) => {
                    if (!cancelled) return;
                    setKey('');
                    setDirty(false);
                    setLeaving(undefined);
                    lastInput.current = null;
                    next();
                  })
                  .catch((e) => setError(message(e)));
              }}
            >
              {cancelling
                ? '正在取消…'
                : testing
                  ? '取消测试并离开'
                  : dirty
                    ? '不保存离开'
                    : '继续离开'}
            </button>
            {!testing && dirty && (
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => {
                  const next = leaving!.next;
                  void save().then((ok) => {
                    if (ok) {
                      setLeaving(undefined);
                      lastInput.current = null;
                      next();
                    }
                  });
                }}
              >
                {busy === 'save' ? '正在保存…' : error ? '重试保存并离开' : '保存并离开'}
              </button>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}

export function AISettingsSummary({
  open,
}: {
  open: (provider: AIProviderId, model: string) => void;
}) {
  const [states, setStates] = useState<Partial<Record<AIProviderId, AIConfigurationState>>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void Promise.all(
      (['deepseek', 'openai-codex'] as const).map(async (provider) => {
        try {
          const state = await api('get', { provider });
          if (live) setStates((old) => ({ ...old, [provider]: state }));
        } catch (error) {
          if (live) setError(message(error));
        }
      }),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="panel">
      <h2>AI 服务</h2>
      <p>配置自己的 API Key。保存与连接验证分别显示，完整 Key 不回显。</p>
      {error && <p role="alert">{error}</p>}
      <div className="ai-summary-grid">
        {(['deepseek', 'openai-codex'] as const).map((provider) => (
          <div key={provider}>
            <h3>{providerName(provider)}</h3>
            <p>
              {states[provider]
                ? states[provider]!.configured
                  ? `已配置 · ${states[provider]!.operation === 'testing' ? '正在测试' : states[provider]!.test ? ({ passed: '连接已验证', failed: '连接失败', cancelled: '测试已取消', interrupted: '上次测试已中断', testing: '正在测试' } as const)[states[provider]!.test!.status] : '待验证'}`
                  : '未配置'
                : '配置状态尚未取得'}
            </p>
            <button
              onClick={() =>
                open(
                  provider,
                  states[provider]?.model ??
                    (provider === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex'),
                )
              }
            >
              管理 {providerName(provider)}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
