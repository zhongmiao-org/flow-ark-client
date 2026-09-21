import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  aiErrorMessage,
  aiModel,
  aiKey,
  type AIConfigurationState,
  type AIProviderId,
} from '../shared/ai-settings';
import './ai-settings.css';

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
  source?: { title: string; taskId?: string };
};
export type AISettingsNavigation = (next: () => void) => void;
const providerName = (id: AIProviderId) => (id === 'deepseek' ? 'DeepSeek' : 'OpenAI');
const mask = (state: AIConfigurationState) => `••••••••${state.tail ? ' ' + state.tail : ''}`;

export default function AISettingsPage({
  active,
  entry,
  navigation,
  back,
  changed,
  onSaved,
}: {
  active: boolean;
  entry: AISettingsEntry;
  navigation: MutableRefObject<AISettingsNavigation | undefined>;
  back: () => void;
  changed: () => Promise<void>;
  onSaved: (state: AIConfigurationState) => void;
}) {
  const [storedState, setState] = useState<AIConfigurationState>();
  const [loadedEntry, setLoadedEntry] = useState<string>();
  const state = loadedEntry === entry.key ? storedState : undefined;
  const [model, setModel] = useState(entry.model),
    [key, setKey] = useState('');
  const [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | 'test' | null>(null);
  const [leaving, setLeaving] = useState<{ next: () => void }>(),
    [removing, setRemoving] = useState(false);
  const lock = useRef(false),
    epoch = useRef(0),
    request = useRef<string | undefined>(undefined);
  const title = useRef<HTMLHeadingElement>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const provider = entry.provider,
    name = providerName(provider),
    testing = busy === 'test' || state?.operation === 'testing';
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
    if (leaving || removing) dialog.current?.showModal();
  }, [leaving, removing]);
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
  const go = (next: () => void) => {
    if (busy === 'save' || busy === 'remove') {
      setError('请等待配置保存或移除完成');
      return;
    }
    if (dirty || testing) setLeaving({ next });
    else {
      setKey('');
      next();
    }
  };
  navigation.current = go;
  const returnToSource = () => go(back);
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          'input, textarea, select, [contenteditable="true"], dialog',
        )
      )
        return;
      if ((event.metaKey && event.key === '[') || (event.altKey && event.key === 'ArrowLeft')) {
        event.preventDefault();
        returnToSource();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
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
      setError('请填写有效的模型 ID');
      return false;
    }
    if ((!state.configured || key) && !aiKey.safeParse(key).success) {
      setError('请填写有效的 API Key，不能包含空白字符');
      return false;
    }
    lock.current = true;
    setBusy('save');
    setError('');
    try {
      const saved: AIConfigurationState = await api('save', {
        provider,
        revision: state.revision,
        model,
        ...(key ? { apiKey: key } : {}),
      });
      setState(saved);
      setModel(saved.model);
      setKey('');
      setDirty(false);
      setEditing(false);
      onSaved(saved);
      await changed().catch(() => setError('配置已保存，本地概览暂未刷新，请稍后重新打开设置。'));
      return true;
    } catch (error) {
      setError(message(error));
      return false;
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };
  const cancelEdit = () =>
    go(() => {
      setKey('');
      setModel(state?.model ?? entry.model);
      setDirty(false);
      setEditing(!state?.configured);
    });
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
      if (ticket === epoch.current) setState(next);
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
    const id = request.current;
    if (!id) return;
    epoch.current++;
    await api('cancel', { provider, requestId: id });
    const next = await reload();
    if (next.operation === 'testing') throw new Error('测试仍在收尾，请稍后再次取消');
    request.current = undefined;
    lock.current = false;
    setBusy(null);
  };
  const remove = async () => {
    if (!state || lock.current) return;
    lock.current = true;
    setBusy('remove');
    setError('');
    try {
      const next = await api('remove', { provider, revision: state.revision, confirmed: true });
      setState(next);
      setKey('');
      setModel(next.model);
      setEditing(true);
      setDirty(false);
      setRemoving(false);
      await changed().catch(() => setError('配置已移除，本地概览暂未刷新，请稍后重新打开设置。'));
    } catch (error) {
      setError(message(error));
      setRemoving(false);
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };
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
  return (
    <div className="ai-settings-host" hidden={!active}>
      <header className="topbar">
        <button
          className={`context-back${entry.source ? ' from-task' : ''}`}
          onClick={returnToSource}
        >
          ← 返回{entry.source ? '原任务' : '本地设置'}
        </button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#ai-source"
            onClick={(e) => {
              e.preventDefault();
              returnToSource();
            }}
          >
            {entry.source ? '开始任务' : '本地设置'}
          </a>
          <span aria-hidden="true">/</span>
          {entry.source && (
            <>
              <span className="ai-source-title">{entry.source.title}</span>
              <span aria-hidden="true">/</span>
            </>
          )}
          <span aria-current="page">AI 服务</span>
        </nav>
      </header>
      <section className="page ai-task-page ai-settings-page">
        <div className="page-heading">
          <div>
            <h1 ref={title} tabIndex={-1}>
              AI 服务
            </h1>
            <p>
              {entry.source
                ? `来自：开始任务 / ${entry.source.title} · 配置后继续原草稿`
                : '配置这台 Mac 的模型服务，供已授权的流程和模板使用。'}
            </p>
          </div>
        </div>
        {!entry.source && (
          <nav className="ai-settings-tabs" aria-label="设置分类">
            <button onClick={returnToSource}>浏览器</button>
            <span aria-current="page">AI 服务</span>
            <span aria-disabled="true">凭据与文件</span>
            <span aria-disabled="true">脚本</span>
          </nav>
        )}
        {error && (
          <div className="ai-task-error" role="alert">
            {error}
          </div>
        )}
        {!state ? (
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
          <div className="ai-settings-columns">
            <section className="ai-task-card ai-provider-card">
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
              {editing ? (
                <>
                  <label className="ai-settings-field">
                    模型 ID
                    <input
                      value={model}
                      disabled={!!busy || state.inUse}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setDirty(true);
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
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={key}
                      placeholder={
                        state.configured ? '输入新 Key，留空则保留原 Key' : `输入 ${name} API Key`
                      }
                      disabled={!!busy || state.inUse}
                      onChange={(e) => {
                        setKey(e.target.value);
                        setDirty(true);
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
                  <div className="ai-task-actions">
                    <button
                      className="primary"
                      disabled={!!busy || state.inUse || (!dirty && state.configured)}
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
                      disabled={!!busy || state.inUse}
                      onClick={() => {
                        setEditing(true);
                        setKey('');
                      }}
                    >
                      {state.model}
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
                      disabled={!!busy || state.inUse}
                      onClick={() => {
                        setEditing(true);
                        setKey('');
                      }}
                    >
                      替换 Key
                    </button>
                    {!entry.source && (
                      <button
                        className="ai-remove-button"
                        disabled={!!busy || state.inUse}
                        onClick={() => setRemoving(true)}
                      >
                        移除配置
                      </button>
                    )}
                  </div>
                  <p>重新打开设置仍显示脱敏标识；完整 Key 不提供回显或复制。</p>
                </>
              )}
              <small>模型按当前账号可用项填写。修改模型或替换 Key 后，需要重新测试连接。</small>
              {state.inUse && (
                <p className="ai-task-note">
                  该资源正在被运行或方案生成使用，结束后才能更改或移除配置。
                </p>
              )}
            </section>
            <section className="ai-task-card ai-connection-card">
              <h2>连接状态</h2>
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
                          ? '连接测试未通过'
                          : '配置已安全保存'}
              </h3>
              <p>
                {testing
                  ? '正在测试当前已保存的模型和 Key。'
                  : dirty
                    ? '密钥保存与连接测试是两个独立操作。'
                    : !state.configured
                      ? '仅需要 AI 的入口受影响，其他流程仍可使用。'
                      : state.test?.status === 'passed'
                        ? `最近测试：${new Date(state.test.at).toLocaleString('zh-CN')}\n模型：${state.test.model}\n此结果对应当前配置。`
                        : state.test?.status === 'failed' && state.test.code
                          ? aiErrorMessage[state.test.code]
                          : state.test?.status === 'cancelled' ||
                              state.test?.status === 'interrupted'
                            ? '配置仍然保留，尚未取得本次完整验证结果。没有自动重试。'
                            : '尚未发起连接测试。保存成功不代表密钥或模型可用。'}
              </p>
              {state.configured && !editing && (
                <>
                  <button
                    className="primary"
                    disabled={!!busy && !testing}
                    onClick={() =>
                      void (testing ? cancelTest() : test()).catch((e) => setError(message(e)))
                    }
                  >
                    {testing
                      ? '取消测试'
                      : state.test?.status === 'passed'
                        ? '重新测试'
                        : '测试连接'}
                  </button>
                  <small>
                    测试只发送固定测试文本，可能产生少量 API 费用。不会发送任务或模板业务数据。
                  </small>
                </>
              )}
              <button onClick={returnToSource}>
                {entry.source ? '继续原任务' : '返回本地设置'}
              </button>
              <small>本页配置仅用于已授权的任务。</small>
            </section>
          </div>
        )}
      </section>
      {(leaving || removing) && (
        <dialog
          ref={dialog}
          className="script-leave-dialog ai-settings-dialog"
          aria-labelledby="ai-settings-dialog-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!busy || testing) {
              setLeaving(undefined);
              setRemoving(false);
            }
          }}
        >
          <h2 id="ai-settings-dialog-title">
            {removing
              ? `移除 ${name} 配置？`
              : testing
                ? '取消测试并离开？'
                : '保存当前配置再离开？'}
          </h2>
          <p>
            {removing
              ? `将移除这台 Mac 保存的 Key${state?.tail ? `（尾四位 ${state.tail}）` : ''}。依赖此资源的入口下次运行前需要重新配置；不会撤销供应商平台上的 Key，也不会删除任务或运行历史。`
              : testing
                ? '测试尚未完成，离开将取消本次请求，已保存配置保持不变。'
                : '保存成功后继续前往刚才选择的位置；不保存只会放弃本次编辑，保留原 Key 和验证状态。'}
          </p>
          <div className="ai-task-actions">
            <button
              autoFocus
              disabled={busy === 'save' || busy === 'remove'}
              onClick={() => {
                setLeaving(undefined);
                setRemoving(false);
              }}
            >
              {removing ? '取消' : testing ? '继续等待' : '继续编辑'}
            </button>
            {removing ? (
              <button className="ai-remove-button" disabled={!!busy} onClick={() => void remove()}>
                确认移除
              </button>
            ) : (
              <>
                {!testing && (
                  <button
                    className="primary"
                    disabled={!!busy}
                    onClick={() => {
                      const next = leaving!.next;
                      void save().then((ok) => {
                        if (ok) {
                          setLeaving(undefined);
                          next();
                        }
                      });
                    }}
                  >
                    保存并离开
                  </button>
                )}
                <button
                  disabled={busy === 'save' || busy === 'remove'}
                  onClick={() => {
                    const next = leaving!.next;
                    void (testing ? cancelTest() : Promise.resolve())
                      .then(() => {
                        setKey('');
                        setDirty(false);
                        setLeaving(undefined);
                        next();
                      })
                      .catch((e) => setError(message(e)));
                  }}
                >
                  {testing ? '取消测试并离开' : '不保存离开'}
                </button>
              </>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
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
