import TechnicalDetails from './TechnicalDetails';
import {
  Card,
  Divider,
  Empty,
  Alert,
  Badge,
  Collapse,
  ConfigProvider,
  Button,
  Checkbox,
  Input,
  Modal,
  Tag,
} from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import './antd-layout.css';
import { useEffect, useId, useRef, useState } from 'react';
import type { Bootstrap, FlowRecord } from '../shared/types';
import {
  localCredentialName,
  localCredentialValue,
  type LocalCredentialState,
} from '../shared/local-credentials';
import './local-credentials.css';
const api = (method: string, args: unknown = {}) => window.flowark.request(method, args);
const failure = (reason: unknown) =>
  (reason instanceof Error ? reason.message : '操作未完成，请刷新列表核对。').replace(
    /^Error invoking remote method 'flowark:request': (?:Error: )?/,
    '',
  );
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
  const nameInput = useRef<HTMLInputElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const lastField = useRef<{
    kind: 'name' | 'value';
    start: number | null;
    end: number | null;
    direction: 'forward' | 'backward' | 'none' | null;
  }>({ kind: 'name', start: null, end: null, direction: null });
  const errorMessage = useRef<HTMLDivElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(editor.entry?.name ?? '');
  const [value, setValue] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState<'name' | 'value'>();
  const locked = useRef(false),
    alive = useRef(true);
  const dirty = name !== (editor.entry?.name ?? '') || !!value;
  const removing = editor.kind === 'remove';
  const blocked = !!editor.entry?.inUse || (removing && !!editor.entry?.boundFlows.length);
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    alive.current = true;
    return () => {
      alive.current = false;
      if (origin?.isConnected) origin.focus();
    };
  }, []);
  useEffect(() => {
    if (leaving) stayButton.current?.focus();
  }, [leaving]);
  useEffect(() => {
    if (error && !busy)
      (invalid === 'name'
        ? nameInput.current
        : invalid === 'value'
          ? valueInput.current
          : errorMessage.current
      )?.focus();
  }, [error, busy, invalid]);
  const rememberField = (kind: 'name' | 'value', input: HTMLInputElement) => {
    lastField.current = {
      kind,
      start: input.selectionStart,
      end: input.selectionEnd,
      direction: input.selectionDirection,
    };
  };
  const continueEditing = () => {
    setLeaving(false);
    requestAnimationFrame(() => {
      const position = lastField.current;
      const input = position.kind === 'value' ? valueInput.current : nameInput.current;
      input?.focus();
      if (input && position.start !== null && position.end !== null)
        input.setSelectionRange(position.start, position.end, position.direction ?? undefined);
    });
  };
  const exit = () => {
    setValue('');
    close();
  };
  const cancel = () => {
    if (locked.current) return;
    if (leaving) {
      continueEditing();
      return;
    }
    if (!removing && dirty) setLeaving(true);
    else exit();
  };
  const persist = async () => {
    if (locked.current || blocked) return;
    const field = !localCredentialName.safeParse(name).success
      ? 'name'
      : (!editor.entry || value) && !localCredentialValue.safeParse(value).success
        ? 'value'
        : undefined;
    if (!removing && field) {
      setInvalid(field);
      setError(
        field === 'name'
          ? '请填写 1–100 字符的凭据名称。'
          : '请填写 1–8192 字符的凭据值，不能包含空字符。',
      );
      setLeaving(false);
      requestAnimationFrame(() =>
        (field === 'name' ? nameInput.current : valueInput.current)?.focus(),
      );
      return;
    }
    if (removing && !confirmed) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setInvalid(undefined);
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
    <Modal
      open
      width={640}
      centered
      closable={false}
      mask={{ closable: false }}
      keyboard={!busy}
      footer={null}
      className="flowark-content-modal local-credential-dialog"
      focusable={{ focusTriggerAfterClose: false }}
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      onCancel={cancel}
      afterOpenChange={(open) => {
        if (open) (leaving ? stayButton.current : nameInput.current)?.focus();
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
          <div className="local-resource-feedback" role="alert" ref={errorMessage} tabIndex={-1}>
            <Alert
              type="error"
              role="presentation"
              showIcon
              title={
                error.startsWith('系统安全存储不可用，已阻止保存；不会明文降级')
                  ? '凭据保护不可用'
                  : '凭据操作未完成'
              }
              description={
                <div className="feedback-body">
                  <Tag
                    className="run-state-tag"
                    variant="filled"
                    color="error"
                    icon={<Badge status="error" />}
                  >
                    {removing ? '移除未完成' : '保存未完成'}
                  </Tag>
                  <p>{error}</p>
                  {!removing && <p>本次输入仍保留，可继续修改；返回时可选择放弃输入。</p>}
                </div>
              }
            />
          </div>
        )}
        {leaving ? (
          <div className="local-credential-actions">
            <Button
              htmlType="button"
              ref={stayButton}
              disabled={busy || undefined}
              onClick={continueEditing}
            >
              继续编辑
            </Button>
            <Button
              htmlType="button"
              color="danger"
              variant="filled"
              disabled={busy || undefined}
              onClick={exit}
            >
              不保存离开
            </Button>
            <Button htmlType="submit" type="primary" disabled={busy || blocked || undefined}>
              {busy ? '正在保存…' : '保存并离开'}
            </Button>
          </div>
        ) : (
          <>
            {removing ? (
              <section className="local-credential-impact">
                <h3>{editor.entry?.name}</h3>
                <TechnicalDetails items={[{ label: '凭据引用 ID', value: editor.id }]} />
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
                <Checkbox
                  checked={confirmed}
                  disabled={busy || blocked || undefined}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="local-credential-confirm"
                >
                  已核对影响，确认移除本机保存的值
                </Checkbox>
              </section>
            ) : (
              <ConfigProvider componentDisabled={busy || blocked || undefined}>
                <fieldset disabled={busy || blocked}>
                  <label htmlFor={`${id}-name`}>凭据名称</label>
                  <Input
                    ref={(instance) => {
                      nameInput.current = instance?.input ?? null;
                    }}
                    id={`${id}-name`}
                    value={name}
                    status={invalid === 'name' ? 'error' : undefined}
                    aria-invalid={invalid === 'name'}
                    aria-describedby={invalid === 'name' ? `${id}-name-error` : undefined}
                    maxLength={100}
                    autoComplete="off"
                    onFocus={(event) => rememberField('name', event.target)}
                    onBlur={(event) => rememberField('name', event.target)}
                    onChange={(event) => {
                      setName(event.target.value);
                      if (invalid === 'name') {
                        setInvalid(undefined);
                        setError('');
                      }
                    }}
                    placeholder="例如：资料接口"
                  />
                  {invalid === 'name' && (
                    <span id={`${id}-name-error`} className="field-error" role="alert">
                      请填写 1–100 字符的凭据名称。
                    </span>
                  )}
                  <label htmlFor={`${id}-value`}>{editor.entry ? '替换凭据值' : '凭据值'}</label>
                  {editor.entry && <p className="local-credential-mask">已保存 · ••••••••</p>}
                  <Input
                    ref={(instance) => {
                      valueInput.current = instance?.input ?? null;
                    }}
                    id={`${id}-value`}
                    type="password"
                    value={value}
                    status={invalid === 'value' ? 'error' : undefined}
                    aria-invalid={invalid === 'value'}
                    aria-describedby={invalid === 'value' ? `${id}-value-error` : undefined}
                    maxLength={8192}
                    autoComplete="new-password"
                    spellCheck={false}
                    onFocus={(event) => rememberField('value', event.target)}
                    onBlur={(event) => rememberField('value', event.target)}
                    onChange={(event) => {
                      setValue(event.target.value);
                      if (invalid === 'value') {
                        setInvalid(undefined);
                        setError('');
                      }
                    }}
                    placeholder={editor.entry ? '留空保留已保存值' : '填写要保护的值'}
                  />
                  {invalid === 'value' && (
                    <span id={`${id}-value-error`} className="field-error" role="alert">
                      请填写 1–8192 字符的凭据值，不能包含空字符。
                    </span>
                  )}
                  <p>系统保护不可用时会拒绝保存，不会改为明文存储。</p>
                </fieldset>
              </ConfigProvider>
            )}
            {blocked && !removing && <p role="status">凭据正在被运行使用，请等待结束后再编辑。</p>}
            <footer className="local-credential-actions">
              <Button htmlType="button" disabled={busy || undefined} onClick={cancel}>
                {error ? '返回凭据设置' : '取消'}
              </Button>
              <Button
                danger={removing ? true : false}
                htmlType="submit"
                type={removing ? 'default' : 'primary'}
                disabled={busy || blocked || (removing ? !confirmed : !dirty) || undefined}
              >
                {busy ? '正在处理…' : removing ? '确认移除' : '保存凭据'}
              </Button>
            </footer>
          </>
        )}
      </form>
    </Modal>
  );
}

export default function LocalCredentialsPanel({
  active = true,
  compact = false,
  data,
  refresh,
  openAI,
  openTools,
  openFlow,
}: {
  active?: boolean;
  compact?: boolean;
  data: Bootstrap;
  refresh: () => Promise<void>;
  openAI: () => void;
  openTools: () => void;
  openFlow: (flow: FlowRecord) => Promise<void>;
}) {
  const [entries, setEntries] = useState<LocalCredentialState[]>();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const listIssue = useRef<HTMLDivElement>(null);
  const receipt = useRef<HTMLDivElement>(null);
  const awaitingReceipt = useRef(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [opening, setOpening] = useState('');
  const createButton = useRef<HTMLButtonElement>(null);
  const listRoot = useRef<HTMLElement>(null);
  const refreshedFocus = useRef<HTMLElement | null>(null);
  const restoreAfterRemove = useRef(false);
  const generation = useRef(0),
    alive = useRef(true),
    search = useRef<HTMLInputElement>(null);
  const read = async () => {
    const token = ++generation.current;
    if (listIssue.current?.contains(document.activeElement)) awaitingReceipt.current = true;
    setLoading(true);
    setListError('');
    try {
      const result: LocalCredentialState[] = await api('credential.local.list');
      if (alive.current && token === generation.current) {
        refreshedFocus.current =
          document.activeElement instanceof HTMLElement &&
          listRoot.current?.contains(document.activeElement)
            ? document.activeElement
            : null;
        setEntries(result);
      }
    } catch (reason) {
      if (alive.current && token === generation.current) setListError(failure(reason));
    } finally {
      if (alive.current && token === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = active;
    if (active) void read();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [active]);
  useEffect(() => {
    const previous = refreshedFocus.current;
    refreshedFocus.current = null;
    if (previous && !previous.isConnected) createButton.current?.focus({ preventScroll: true });
    if (restoreAfterRemove.current) {
      restoreAfterRemove.current = false;
      createButton.current?.focus({ preventScroll: true });
    }
  }, [entries]);
  useEffect(() => {
    if (loading) return;
    if (listError) listIssue.current?.focus();
    else if (awaitingReceipt.current) (receipt.current ?? createButton.current)?.focus();
    awaitingReceipt.current = false;
  }, [loading, listError]);
  const begin = (next: Editor) => {
    if (loading || listError) return;
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
      setOpening('');
    }
  };
  const searchControls = (
    <>
      <label className="local-settings-search">
        搜索凭据
        <Input
          ref={(instance) => {
            search.current = instance?.input ?? null;
          }}
          size={compact ? 'small' : undefined}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="名称、标识或引用流程"
        />
      </label>
      <div className="local-settings-row">
        <span>{entries ? `${shown?.length} / ${entries.length} 个凭据` : '尚未读取凭据清单'}</span>
        <Button disabled={loading || undefined} onClick={() => void read()}>
          {loading ? '正在读取…' : '刷新列表'}
        </Button>
      </div>
    </>
  );
  return (
    <div className={`local-credentials-layout${compact ? ' is-compact' : ''}`}>
      <section ref={listRoot} aria-label="通用本机凭据" aria-busy={loading}>
        <Card
          className="local-settings-card"
          variant={compact ? 'borderless' : 'outlined'}
          styles={compact ? { body: { padding: 0 } } : undefined}
        >
          <div className="local-settings-row">
            <h2>{compact ? '凭据' : '通用本机凭据'}</h2>
            <Button
              ref={createButton}
              type="primary"
              disabled={loading || !!listError || undefined}
              onClick={() => begin({ kind: 'edit', id: 'local-' + crypto.randomUUID() })}
            >
              新增凭据
            </Button>
          </div>
          <p>名称便于识别，保存值只供明确绑定的流程读取。</p>
          {compact ? (
            <Collapse
              className="local-resource-search-controls"
              size="small"
              activeKey={searchOpen ? ['search'] : []}
              onChange={(keys) => setSearchOpen(keys.includes('search'))}
              items={[
                {
                  key: 'search',
                  label: `查找与刷新凭据${entries ? ` · ${entries.length}` : ''}`,
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  children: searchControls,
                },
              ]}
            />
          ) : (
            searchControls
          )}
          {loading && <p role="status">正在读取凭据清单…</p>}
          {listError && (
            <div className="local-resource-feedback" role="alert" ref={listIssue} tabIndex={-1}>
              <Alert
                type="error"
                role="presentation"
                showIcon
                title={entries ? '凭据列表尚未更新' : '暂时无法读取凭据'}
                description={
                  <div className="feedback-body">
                    <Tag
                      className="run-state-tag"
                      variant="filled"
                      color="error"
                      icon={<Badge status="error" />}
                    >
                      读取未完成
                    </Tag>
                    <p>{listError}</p>
                    <p>
                      {entries
                        ? '下方保留上次读取的列表，请重新读取后再新增、编辑或移除。'
                        : '尚未取得凭据清单，不能据此判断是否已保存凭据。'}
                    </p>
                  </div>
                }
                action={
                  <Button disabled={loading || undefined} onClick={() => void read()}>
                    重新读取凭据
                  </Button>
                }
              />
            </div>
          )}
          {error && (
            <Alert
              type="error"
              showIcon
              title="操作未完成"
              description={error}
              className="local-resource-feedback"
            />
          )}
          {notice && (
            <div role="status" ref={receipt} tabIndex={-1} className="local-resource-feedback">
              <Alert type="success" role="presentation" showIcon title={notice} />
            </div>
          )}
          {shown?.map((entry) => (
            <article className="local-credential-entry" key={entry.id}>
              {compact && <Divider className="local-credential-divider" />}
              <Card
                className="local-credential-card"
                variant={compact ? 'borderless' : 'outlined'}
                styles={compact ? { body: { padding: 0 } } : undefined}
              >
                {compact ? (
                  <>
                    <label className="local-resource-field-label">
                      名称
                      <Input size="small" readOnly value={entry.name} />
                    </label>
                    <div className="local-resource-field-label">
                      值 · {entry.inUse ? '运行正在使用' : '已保存'}
                    </div>
                  </>
                ) : (
                  <div className="local-settings-row">
                    <h3>{entry.name}</h3>
                    <Tag
                      className="run-state-tag"
                      variant="filled"
                      color={entry.inUse ? 'processing' : 'success'}
                      icon={<Badge status={entry.inUse ? 'processing' : 'success'} />}
                    >
                      {entry.inUse ? '运行正在使用' : '已保存'}
                    </Tag>
                  </div>
                )}
                <p className="local-credential-mask">••••••••</p>
                {!compact && <code>{entry.id}</code>}
                <div className="local-credential-actions">
                  <Button
                    disabled={loading || !!listError || undefined}
                    onClick={() => begin({ kind: 'edit', id: entry.id, entry })}
                  >
                    编辑凭据
                  </Button>
                  <Button
                    disabled={loading || !!listError || undefined}
                    onClick={() => begin({ kind: 'remove', id: entry.id, entry })}
                  >
                    移除凭据
                  </Button>
                </div>
                <Collapse
                  className="local-credential-references"
                  size="small"
                  items={[
                    {
                      key: 'references',
                      label: `引用流程 · ${entry.boundFlows.length}`,
                      forceRender: true,
                      onKeyDown: activateCollapseWithSpace,
                      children: (
                        <>
                          {compact && <code>{entry.id}</code>}
                          {entry.boundFlows.length ? (
                            <ul>
                              {entry.boundFlows.map((flow) => (
                                <li key={flow.id}>
                                  <Button
                                    disabled={!!opening || undefined}
                                    onClick={() => void open(flow.id)}
                                  >
                                    {flow.name} · 打开绑定
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>没有已保存流程绑定；保存凭据不会自动授权。</p>
                          )}
                        </>
                      ),
                    },
                  ]}
                />
              </Card>
            </article>
          ))}
          {entries && !listError && !shown?.length && (
            <Empty
              className="local-settings-empty"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                query ? '没有匹配的凭据。' : '尚无通用凭据。点击“新增凭据”保存本机资源。'
              }
            >
              {query && (
                <Button
                  onClick={() => {
                    setQuery('');
                    setSearchOpen(true);
                    requestAnimationFrame(() => search.current?.focus());
                  }}
                >
                  清除搜索
                </Button>
              )}
            </Empty>
          )}
          {compact && (
            <p className="local-credential-protection">系统保护不可用时拒绝保存，不降级为明文。</p>
          )}
        </Card>
      </section>
      <section>
        <Card
          className="local-settings-card"
          variant={compact ? 'borderless' : 'outlined'}
          styles={compact ? { body: { padding: 0 } } : undefined}
        >
          <Collapse
            className="local-credential-help"
            key={compact ? 'compact' : 'full'}
            size="small"
            defaultActiveKey={compact ? [] : ['help']}
            items={[
              {
                key: 'help',
                label: '绑定与保护说明',
                forceRender: true,
                onKeyDown: activateCollapseWithSpace,
                children: (
                  <>
                    <p>
                      在流程参数与资源中勾选要使用的凭据。替换不改变
                      ID，旧运行继续受固定快照和在用保护约束。
                    </p>
                    <p>活动或排队运行使用期间不能替换或移除。删除前需先解除已保存流程的绑定。</p>
                    <p>已保存值不回显，不随流程 ZIP 导出。</p>
                    <h3>AI 与工具认证</h3>
                    <p>供应商密钥和工具认证在各自的设置中管理。</p>
                    <div className="local-credential-actions">
                      <Button onClick={openAI}>管理 AI 密钥</Button>
                      <Button onClick={openTools}>管理工具认证</Button>
                    </div>
                  </>
                ),
              },
            ]}
          />
        </Card>
      </section>
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
            awaitingReceipt.current = true;
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
