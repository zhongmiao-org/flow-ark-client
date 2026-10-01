import { useEffect, useId, useRef, useState } from 'react';
import type { Bootstrap, FlowRecord } from '../shared/types';
import type { LocalCredentialState } from '../shared/local-credentials';
import './local-credentials.css';
const api = (method: string, args: unknown = {}) => window.flowark.request(method, args);
const failure = (reason: unknown) =>
  reason instanceof Error ? reason.message : '操作未完成，请刷新列表核对。';
type Editor = { kind: 'edit' | 'remove'; id: string; entry?: LocalCredentialState };

function CredentialDialog({
  editor,
  close,
  saved,
}: {
  editor: Editor;
  close: () => void;
  saved: (message: string) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(editor.entry?.name ?? '');
  const [value, setValue] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false),
    alive = useRef(true);
  const dirty = name !== (editor.entry?.name ?? '') || !!value;
  const removing = editor.kind === 'remove';
  const blocked = !!editor.entry?.inUse || (removing && !!editor.entry?.boundFlows.length);
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    alive.current = true;
    const node = dialog.current;
    node?.showModal();
    nameInput.current?.focus();
    return () => {
      alive.current = false;
      node?.close();
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (leaving) stayButton.current?.focus();
  }, [leaving]);
  useEffect(() => {
    if (error && !busy) errorMessage.current?.focus();
  }, [error, busy]);
  const exit = () => {
    setValue('');
    close();
  };
  const cancel = () => {
    if (locked.current) return;
    if (leaving) {
      setLeaving(false);
      requestAnimationFrame(() => nameInput.current?.focus());
      return;
    }
    if (!removing && dirty) setLeaving(true);
    else exit();
  };
  const persist = async () => {
    if (locked.current || blocked) return;
    if (!removing && (!name.trim() || (!editor.entry && !value))) {
      setError('请填写名称；首次保存还需填写凭据值。');
      setLeaving(false);
      return;
    }
    if (removing && !confirmed) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await api(removing ? 'credential.local.remove' : 'credential.local.save', {
        id: editor.id,
        revision: editor.entry?.revision ?? null,
        ...(removing ? { confirmed: true } : { name: name.trim(), ...(value ? { value } : {}) }),
      });
      if (alive.current) {
        setValue('');
        saved(
          removing
            ? '已移除本机凭据。外部服务的授权未改变。'
            : '凭据已保存。需要使用时，请在流程参数与资源中明确绑定。',
        );
      }
    } catch (reason) {
      if (alive.current) setError(failure(reason));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <dialog
      className="local-credential-dialog"
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void persist();
        }}
      >
        <header>
          <h2 id={`${id}-title`}>
            {leaving
              ? '保存凭据更改再离开？'
              : removing
                ? '移除本机凭据？'
                : editor.entry
                  ? '编辑受保护凭据'
                  : '新增本机凭据'}
          </h2>
          <p>
            {leaving
              ? '仅保存到本机，不发送给外部服务。放弃会清除本次输入。'
              : removing
                ? '只移除这里保存的值，不撤销外部服务授权或删除历史记录。'
                : '已保存值不回显；只有明确绑定的流程可以读取。'}
          </p>
        </header>
        {error && (
          <p className="field-error" role="alert" ref={errorMessage} tabIndex={-1}>
            {error}
          </p>
        )}
        {leaving ? (
          <div className="local-credential-actions">
            <button
              type="button"
              ref={stayButton}
              disabled={busy}
              onClick={() => {
                setLeaving(false);
                requestAnimationFrame(() => nameInput.current?.focus());
              }}
            >
              继续编辑
            </button>
            <button type="button" disabled={busy} onClick={exit}>
              不保存离开
            </button>
            <button className="primary" disabled={busy || blocked}>
              {busy ? '正在保存…' : '保存并离开'}
            </button>
          </div>
        ) : (
          <>
            {removing ? (
              <section className="local-credential-impact">
                <h3>{editor.entry?.name}</h3>
                <code>{editor.id}</code>
                {editor.entry?.boundFlows.length ? (
                  <>
                    <p>仍被以下流程引用，请先移除绑定：</p>
                    <ul>
                      {editor.entry.boundFlows.map((flow) => (
                        <li key={flow.id}>{flow.name}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>没有已保存流程引用此凭据。</p>
                )}
                {editor.entry?.inUse && <p role="status">活动或排队运行正在使用，当前不可移除。</p>}
                <label className="local-credential-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy || blocked}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  已核对影响，确认移除本机保存的值
                </label>
              </section>
            ) : (
              <fieldset disabled={busy || blocked}>
                <label htmlFor={`${id}-name`}>凭据名称</label>
                <input
                  ref={nameInput}
                  id={`${id}-name`}
                  value={name}
                  maxLength={100}
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：资料接口"
                />
                <label htmlFor={`${id}-value`}>{editor.entry ? '替换凭据值' : '凭据值'}</label>
                {editor.entry && <p className="local-credential-mask">已保存 · ••••••••</p>}
                <input
                  id={`${id}-value`}
                  type="password"
                  value={value}
                  maxLength={8192}
                  autoComplete="new-password"
                  spellCheck={false}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={editor.entry ? '留空保留已保存值' : '填写要保护的值'}
                />
                <p>系统保护不可用时会拒绝保存，不会改为明文存储。</p>
              </fieldset>
            )}
            {blocked && !removing && <p role="status">凭据正在被运行使用，请等待结束后再编辑。</p>}
            <footer className="local-credential-actions">
              <button type="button" disabled={busy} onClick={cancel}>
                取消
              </button>
              <button
                className={removing ? 'danger' : 'primary'}
                disabled={busy || blocked || (removing ? !confirmed : !dirty)}
              >
                {busy ? '正在处理…' : removing ? '确认移除' : '保存凭据'}
              </button>
            </footer>
          </>
        )}
      </form>
    </dialog>
  );
}

export default function LocalCredentialsPanel({
  compact = false,
  data,
  refresh,
  openAI,
  openTools,
  openFlow,
}: {
  compact?: boolean;
  data: Bootstrap;
  refresh: () => Promise<void>;
  openAI: () => void;
  openTools: () => void;
  openFlow: (flow: FlowRecord) => Promise<void>;
}) {
  const [entries, setEntries] = useState<LocalCredentialState[]>();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [opening, setOpening] = useState('');
  const createButton = useRef<HTMLButtonElement>(null);
  const restoreAfterRemove = useRef(false);
  const generation = useRef(0),
    alive = useRef(true),
    search = useRef<HTMLInputElement>(null);
  const read = async () => {
    const token = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result: LocalCredentialState[] = await api('credential.local.list');
      if (alive.current && token === generation.current) setEntries(result);
    } catch (reason) {
      if (alive.current && token === generation.current) setError(failure(reason));
    } finally {
      if (alive.current && token === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (restoreAfterRemove.current) {
      restoreAfterRemove.current = false;
      createButton.current?.focus({ preventScroll: true });
    }
  }, [entries]);
  const begin = (next: Editor) => {
    setNotice('');
    setError('');
    setEditor(next);
  };
  const shown = entries?.filter((entry) =>
    `${entry.name} ${entry.id} ${entry.boundFlows.map((flow) => flow.name).join(' ')}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const open = async (id: string) => {
    if (opening) return;
    const flow = data.flows.find((flow) => flow.id === id);
    if (!flow) {
      setError('来源流程已不在当前列表，请刷新设置后再打开。');
      return;
    }
    setOpening(id);
    setError('');
    try {
      await openFlow(flow);
    } catch (reason) {
      if (alive.current) setError(failure(reason));
    } finally {
      if (alive.current) setOpening('');
    }
  };
  return (
    <div className={`local-credentials-layout${compact ? ' is-compact' : ''}`}>
      <section className="local-settings-card" aria-label="通用本机凭据">
        <div className="local-settings-row">
          <h2>{compact ? '凭据' : '通用本机凭据'}</h2>
          <button
            ref={createButton}
            className="primary"
            onClick={() => begin({ kind: 'edit', id: 'local-' + crypto.randomUUID() })}
          >
            新增凭据
          </button>
        </div>
        <p>名称便于识别，保存值只供明确绑定的流程读取。</p>
        <details className="local-resource-search-controls" open={compact ? undefined : true}>
          <summary hidden={!compact}>查找与刷新凭据{entries ? ` · ${entries.length}` : ''}</summary>
          <label className="local-settings-search">
            搜索凭据
            <input
              ref={search}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名称、标识或引用流程"
            />
          </label>
          <div className="local-settings-row">
            <span>
              {entries ? `${shown?.length} / ${entries.length} 个凭据` : '尚未读取凭据清单'}
            </span>
            <button disabled={loading} onClick={() => void read()}>
              {loading ? '正在读取…' : '刷新列表'}
            </button>
          </div>
        </details>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {shown?.map((entry) => (
          <article className="local-credential-card" key={entry.id}>
            {compact ? (
              <>
                <label className="local-resource-field-label">
                  名称
                  <input readOnly value={entry.name} />
                </label>
                <div className="local-resource-field-label">
                  值 · {entry.inUse ? '运行正在使用' : '已保存'}
                </div>
              </>
            ) : (
              <div className="local-settings-row">
                <h3>{entry.name}</h3>
                <span>{entry.inUse ? '运行正在使用' : '已保存'}</span>
              </div>
            )}
            <p className="local-credential-mask">••••••••</p>
            {!compact && <code>{entry.id}</code>}
            <div className="local-credential-actions">
              <button onClick={() => begin({ kind: 'edit', id: entry.id, entry })}>编辑凭据</button>
              <button onClick={() => begin({ kind: 'remove', id: entry.id, entry })}>
                移除凭据
              </button>
            </div>
            <details>
              <summary>引用流程 · {entry.boundFlows.length}</summary>
              {compact && <code>{entry.id}</code>}
              {entry.boundFlows.length ? (
                <ul>
                  {entry.boundFlows.map((flow) => (
                    <li key={flow.id}>
                      <button disabled={!!opening} onClick={() => void open(flow.id)}>
                        {flow.name} · 打开绑定
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>没有已保存流程绑定；保存凭据不会自动授权。</p>
              )}
            </details>
          </article>
        ))}
        {entries && !shown?.length && (
          <div className="local-settings-empty">
            {query ? (
              <>
                <p>没有匹配的凭据。</p>
                <button
                  onClick={() => {
                    setQuery('');
                    search.current?.focus();
                  }}
                >
                  清除搜索
                </button>
              </>
            ) : (
              '尚无通用凭据。点击“新增凭据”保存本机资源。'
            )}
          </div>
        )}
        {compact && (
          <p className="local-credential-protection">系统保护不可用时拒绝保存，不降级为明文。</p>
        )}
      </section>
      <details
        className={compact ? 'local-credential-help' : 'local-settings-card'}
        open={compact ? undefined : true}
      >
        <summary>绑定与保护说明</summary>

        <p>
          在流程参数与资源中勾选要使用的凭据。替换不改变 ID，旧运行继续受固定快照和在用保护约束。
        </p>
        <p>活动或排队运行使用期间不能替换或移除。删除前需先解除已保存流程的绑定。</p>
        <p>已保存值不回显，不随流程 ZIP 导出。</p>
        <h3>AI 与工具认证</h3>
        <p>供应商密钥和工具认证在各自的设置中管理。</p>
        <div className="local-credential-actions">
          <button onClick={openAI}>管理 AI 密钥</button>
          <button onClick={openTools}>管理工具认证</button>
        </div>
      </details>
      {editor && (
        <CredentialDialog
          key={`${editor.kind}:${editor.id}`}
          editor={editor}
          close={() => setEditor(undefined)}
          saved={(message) => {
            if (editor.kind === 'remove') {
              restoreAfterRemove.current = true;
              setEntries((current) => current?.filter((entry) => entry.id !== editor.id));
            }
            setEditor(undefined);
            setNotice(message);
            void read();
            void refresh().catch(() => {
              if (alive.current) setError('凭据操作已完成，但设置摘要未刷新，请重新打开设置核对。');
            });
          }}
        />
      )}
    </div>
  );
}
