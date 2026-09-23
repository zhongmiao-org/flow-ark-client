import { usePageBack } from './use-page-back';
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { BrowserBinding, FlowRecord, Json } from '../shared/types';
import { referenceIssues } from '../shared/flow-references';
import { fileBindingNames } from './file-bindings';
import ParameterConfiguration from './ParameterConfiguration';
import TemplateParameters from './TemplateParameters';
import type { ScriptNavigation } from './ScriptEditorPage';
import './flow-parameters.css';

export default function FlowParametersPage({
  record,
  browsers,
  credentials,
  navigation,
  close,
  save,
  configuration,
  returnLabel = '流程编排',
}: {
  record: FlowRecord;
  browsers: BrowserBinding[];
  credentials: string[];
  navigation: MutableRefObject<ScriptNavigation | undefined>;
  close: (next?: () => void) => void;
  save: (record: FlowRecord) => Promise<void>;
  configuration: () => void;
  returnLabel?: string;
}) {
  const [credentialNames, setCredentialNames] = useState<Record<string, string>>({});
  const [credentialError, setCredentialError] = useState('');
  useEffect(() => {
    let live = true;
    window.flowark
      .request('credential.local.list')
      .then((entries: { id: string; name: string }[]) => {
        if (live)
          setCredentialNames(Object.fromEntries(entries.map((entry) => [entry.id, entry.name])));
      })
      .catch(() => {
        if (live) setCredentialError('凭据名称暂未读取，以下保留实际引用标识。');
      });
    return () => {
      live = false;
    };
  }, []);
  const [draft, setDraft] = useState(() => structuredClone(record));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ next?: () => void }>();
  const root = useRef<HTMLElement>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false),
    alive = useRef(true),
    lastFocus = useRef<HTMLElement | null>(null);
  const dirty = JSON.stringify(record) !== JSON.stringify(draft);
  const incomplete = () => !!root.current?.querySelector('[data-value-invalid]');
  const leave: ScriptNavigation = (next) => {
    if (locked.current || pending) return;
    if (dirty || incomplete()) {
      if (!lastFocus.current?.isConnected)
        lastFocus.current = document.activeElement as HTMLElement;
      setPending({ next });
    } else close(next);
  };
  useLayoutEffect(() => {
    navigation.current = leave;
    return () => {
      navigation.current = undefined;
    };
  });
  useEffect(() => {
    alive.current = true;
    root.current?.querySelector<HTMLElement>('h1')?.focus();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);
  usePageBack(leave);
  const stay = () => {
    if (locked.current) return;
    setPending(undefined);
    requestAnimationFrame(
      () => lastFocus.current?.isConnected && lastFocus.current.focus({ preventScroll: true }),
    );
  };
  const parameters = (next: Record<string, Json>) => {
    const before = new Set(
      referenceIssues(draft.flow.steps, draft.flow.parameters).map((issue) =>
        JSON.stringify(issue),
      ),
    );
    const added = referenceIssues(draft.flow.steps, next).find(
      (issue) => !before.has(JSON.stringify(issue)),
    );
    if (added) throw new Error(`${added.nodeId} 仍引用 ${added.reference}，请先调整引用`);
    setDraft({ ...draft, flow: { ...draft.flow, parameters: next } });
    setError('');
  };
  const persist = async (next?: () => void) => {
    if (locked.current) return;
    if (incomplete()) {
      setError('请先修正未完成的参数值，再保存。');
      setPending(undefined);
      requestAnimationFrame(() => {
        const invalid = root.current?.querySelector<HTMLElement>('[data-value-invalid]');
        (invalid?.matches('input,textarea')
          ? invalid
          : invalid?.querySelector<HTMLElement>('input,textarea')
        )?.focus();
      });
      return;
    }
    locked.current = true;
    setBusy('save');
    setError('');
    try {
      await save(draft);
      if (alive.current) close(next);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '保存未完成，请重试');
    } finally {
      locked.current = false;
      if (alive.current) setBusy('');
    }
  };
  const choose = async (binding: string) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(binding);
    setError('');
    try {
      const path = await window.flowark.request('file.choose', { kind: 'directory' });
      if (alive.current && typeof path === 'string' && path)
        setDraft((current) => ({
          ...current,
          bindings: { ...current.bindings, files: { ...current.bindings.files, [binding]: path } },
        }));
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '目录未选择，请重试');
    } finally {
      locked.current = false;
      if (alive.current) setBusy('');
    }
  };
  const managed = draft.bindings.configuration?.adapter === 'flow-parameters-v1';
  const values = draft.bindings.configuration?.values;
  const managedValues =
    values && typeof values === 'object' && !Array.isArray(values) ? values : undefined;
  const ids = [...new Set([...credentials, ...draft.bindings.credentials])];
  return (
    <section
      className="page flow-parameters-page"
      ref={root}
      aria-label="流程参数与资源"
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.matches('input,textarea,select') && !target.closest('dialog'))
          lastFocus.current = target;
      }}
    >
      <header className="flow-parameters-heading">
        <div>
          <h1 tabIndex={-1}>流程参数与资源</h1>
          <p>{draft.flow.name} · 保存会包含当前流程草稿，不改变已开始的运行或固定计划。</p>
        </div>
        <span className="flow-parameters-dirty">{dirty ? '有未保存的更改' : '与打开时一致'}</span>
      </header>
      {error && !pending && (
        <div className="flow-parameters-error" role="alert">
          {error}
        </div>
      )}
      <fieldset disabled={!!busy} className="flow-parameters-columns">
        <section className="flow-parameters-card" aria-label="运行参数">
          <h2>运行参数</h2>
          <p>普通流程自由编辑参数；删除被引用的参数会被阻止，并标出引用步骤。</p>
          {managed ? (
            managedValues ? (
              <TemplateParameters value={managedValues} edit={() => leave(configuration)} />
            ) : (
              <>
                <p role="alert">实例参数格式不可用，请打开实例配置核对。</p>
                <button type="button" onClick={() => leave(configuration)}>
                  编辑实例配置
                </button>
              </>
            )
          ) : (
            <>
              {!Object.keys(draft.flow.parameters).length && (
                <p className="flow-parameters-empty">
                  还没有运行参数。添加后可在步骤中选择变量引用。
                </p>
              )}
              <ParameterConfiguration value={draft.flow.parameters} change={parameters} />
            </>
          )}
        </section>
        <section className="flow-parameters-card" aria-label="本机资源">
          <h2>本机资源</h2>
          <p>绑定只在本机保存，不随流程导出。</p>
          <label htmlFor="parameters-browser">浏览器</label>
          <select
            id="parameters-browser"
            value={draft.bindings.browserId ?? ''}
            onChange={(event) =>
              setDraft({
                ...draft,
                bindings: { ...draft.bindings, browserId: event.target.value || undefined },
              })
            }
          >
            <option value="">尚未绑定</option>
            {draft.bindings.browserId &&
              !browsers.some((browser) => browser.id === draft.bindings.browserId) && (
                <option value={draft.bindings.browserId}>
                  原浏览器绑定不可用 · {draft.bindings.browserId}
                </option>
              )}
            {browsers.map((browser) => (
              <option key={browser.id} value={browser.id}>
                {browser.product === 'embedded' ? 'FlowArk 内置浏览器' : browser.product}{' '}
                {browser.version}
              </option>
            ))}
          </select>
          {!browsers.length && <p>尚未发现可用绑定，请先在本地设置中配置浏览器。</p>}
          {fileBindingNames(draft.flow.steps, draft.bindings.files, draft.flow.parameters).map(
            (binding) => (
              <div className="flow-parameters-resource" key={binding}>
                <strong>{binding} 目录</strong>
                <p>{draft.bindings.files[binding] ?? '尚未选择'}</p>
                <button
                  type="button"
                  onClick={() => void choose(binding)}
                  aria-label={'选择 ' + binding + ' 目录'}
                >
                  {busy === binding ? '正在选择…' : '选择目录'}
                </button>
              </div>
            ),
          )}
          <h3>允许脚本读取的凭据</h3>
          {!ids.length && <p>未使用凭据。可在本地设置的凭据、AI 服务或应用与工具中管理。</p>}
          {credentialError && <p role="status">{credentialError}</p>}
          {ids.map((id) => (
            <label className="flow-parameters-credential" key={id}>
              <input
                type="checkbox"
                checked={draft.bindings.credentials.includes(id)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    bindings: {
                      ...draft.bindings,
                      credentials: event.target.checked
                        ? [...draft.bindings.credentials, id]
                        : draft.bindings.credentials.filter((key) => key !== id),
                    },
                  })
                }
              />
              <span>
                {credentialNames[id] ? `${credentialNames[id]} · ${id}` : id}
                {!credentials.includes(id) ? ' · 凭据不可用' : ''}
              </span>
            </label>
          ))}
          <p>这里只显示凭据引用，不显示密钥。资源可用性在运行前重新核对。</p>
        </section>
      </fieldset>
      <footer className="flow-parameters-actions">
        <button className="primary" disabled={!!busy} onClick={() => void persist()}>
          {busy === 'save' ? '正在保存…' : `保存并返回${returnLabel}`}
        </button>
        <button disabled={!!busy} onClick={() => leave()}>
          返回{returnLabel}
        </button>
      </footer>
      {pending && (
        <dialog
          className="script-leave-dialog ai-settings-dialog"
          ref={dialog}
          aria-labelledby="parameter-leave-title"
          onCancel={(event) => {
            event.preventDefault();
            stay();
          }}
        >
          <h2 id="parameter-leave-title">保存参数与资源更改再离开？</h2>
          <p>
            成功保存后前往刚才选择的位置。放弃仅撤销本页未保存的更改，打开前的流程草稿保持原状。
          </p>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="flow-parameters-actions">
            <button autoFocus disabled={!!busy} onClick={stay}>
              继续编辑
            </button>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void persist(pending.next)}
            >
              保存并离开
            </button>
            <button disabled={!!busy} onClick={() => close(pending.next)}>
              不保存离开
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
