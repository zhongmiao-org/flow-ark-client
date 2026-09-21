import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { FlowRecord, Run } from '../shared/types';
import { changeSteps, flatten } from './flow-editing';
import { referenceChoices } from './value-references';
import ValueField from './ValueField';
import ScriptPackages from './ScriptPackages';
import {
  editScriptPackage,
  scriptInputPreview,
  scriptOutputs,
  type ScriptNode,
} from './script-editor';
const CodeEditor = lazy(() => import('./CodeEditor'));
export type ScriptNavigation = (next?: () => void) => void;
type Diagnostic = { lineNumber: number; column: number; message: string };
const json = (value: unknown) => {
  const text = JSON.stringify(value, null, 2) ?? '没有输出';
  return text.length > 65536 ? text.slice(0, 65536) + '\n…仅显示前 65536 个字符' : text;
};

export default function ScriptEditorPage({
  record,
  nodeId,
  save,
  close,
  navigation,
}: {
  record: FlowRecord;
  nodeId: string;
  save: (record: FlowRecord) => Promise<void>;
  close: (next?: () => void) => void;
  navigation: MutableRefObject<ScriptNavigation | undefined>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(record));
  const node = flatten(draft.flow.steps).find((step) => step.id === nodeId) as ScriptNode;
  const [timeout, setTimeoutValue] = useState(String(node.timeoutMs ?? 60000));
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const [syntax, setSyntax] = useState<{
    checking?: boolean;
    issues?: Diagnostic[];
    error?: string;
  }>({});
  const [preview, setPreview] = useState(false),
    [runs, setRuns] = useState<Run[]>([]);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [runId, setRunId] = useState(''),
    [detail, setDetail] = useState<any>();
  const [historyState, setHistoryState] = useState('');
  const [pendingLeave, setPendingLeave] = useState<{ next?: () => void }>();
  const root = useRef<HTMLElement>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0),
    alive = useRef(true);
  const persisting = useRef(false);
  const changed =
    JSON.stringify(draft) !== JSON.stringify(record) ||
    timeout !==
      String(
        (flatten(record.flow.steps).find((step) => step.id === nodeId) as ScriptNode).timeoutMs ??
          60000,
      );
  const incomplete = () => !!root.current?.querySelector('[data-value-invalid]');
  const change = (next: ScriptNode) =>
    setDraft((current) => ({
      ...current,
      flow: { ...current.flow, steps: changeSteps(current.flow.steps, nodeId, () => next) },
    }));
  useEffect(() => {
    alive.current = true;
    root.current?.querySelector<HTMLElement>('h1')?.focus();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setSyntax({});
  }, [node.code, node.language]);
  useLayoutEffect(() => {
    navigation.current = (next) => {
      if (persisting.current) return;
      if (changed || incomplete()) setPendingLeave({ next });
      else close(next);
    };
    return () => {
      navigation.current = undefined;
    };
  });
  useEffect(() => {
    if (pendingLeave) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pendingLeave]);
  const persist = async (next?: () => void) => {
    if (persisting.current) return;
    setError('');
    if (incomplete()) {
      setPendingLeave(undefined);
      const invalid = root.current?.querySelector<HTMLElement>('[data-value-invalid]');
      const details = invalid?.closest('details');
      if (details) details.open = true;
      invalid?.querySelector<HTMLElement>('textarea,input')?.focus();
      setError('请先修正未完成的输入配置');
      return;
    }
    const milliseconds = Number(timeout);
    if (
      !/^\d+$/.test(timeout) ||
      !Number.isSafeInteger(milliseconds) ||
      milliseconds < 100 ||
      milliseconds > 3600000
    ) {
      setPendingLeave(undefined);
      setError('超时须为 100 至 3600000 毫秒的整数');
      root.current?.querySelector<HTMLElement>('#script-timeout')?.focus();
      return;
    }
    persisting.current = true;
    setSaving(true);
    try {
      const nextNode = { ...node, timeoutMs: milliseconds };
      const updated = {
        ...draft,
        flow: { ...draft.flow, steps: changeSteps(draft.flow.steps, nodeId, () => nextNode) },
      };
      await save(updated);
      if (alive.current) close(next);
    } catch (e) {
      if (alive.current) {
        setPendingLeave(undefined);
        setError((e as Error).message);
      }
    } finally {
      persisting.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const check = async () => {
    const request = ++generation.current;
    setSyntax({ checking: true });
    try {
      const { checkScriptSyntax } = await import('./CodeEditor');
      const issues = await checkScriptSyntax(node.code, node.language);
      if (alive.current && request === generation.current) setSyntax({ issues });
    } catch (e) {
      if (alive.current && request === generation.current)
        setSyntax({ error: (e as Error).message });
    }
  };
  useEffect(() => {
    if (!preview) return;
    let live = true;
    setHistoryState('正在读取最近 20 次运行…');
    window.flowark
      .request('run.list', { flowId: record.id, limit: 20 })
      .then((result) => {
        if (!live) return;
        setRuns(result.runs);
        setHistoryState(
          result.runs.length ? '选择历史运行查看实际输出' : '尚无运行记录；预览不会运行脚本',
        );
      })
      .catch((e) => {
        if (live) setHistoryState('读取失败：' + e.message);
      });
    return () => {
      live = false;
    };
  }, [preview, record.id, previewRevision]);
  useEffect(() => {
    setDetail(undefined);
    if (!runId) return;
    let live = true;
    setHistoryState('正在读取运行结果…');
    window.flowark
      .request('run.detail', { id: runId })
      .then((result) => {
        if (!live) return;
        if (result.run?.id !== runId || result.run?.flowId !== record.id)
          throw new Error('运行来源不匹配');
        setDetail(result);
        setHistoryState('');
      })
      .catch((e) => {
        if (live) setHistoryState('读取失败：' + e.message);
      });
    return () => {
      live = false;
    };
  }, [runId, record.id, previewRevision]);
  const input = scriptInputPreview(node.input, draft.flow.parameters);
  const outputs = detail ? scriptOutputs(detail.snapshot?.steps ?? [], detail.output, nodeId) : [];
  const snapshotNode =
    detail && flatten(detail.snapshot?.steps ?? []).find((step) => step.id === nodeId);
  return (
    <section className="script-editor-page page" ref={root} aria-label="脚本编辑">
      <header className="script-editor-heading">
        <h1 tabIndex={-1}>脚本：编辑、检查、再试运行</h1>
        <p>可信 JS/TS · 独立进程执行 · 不是安全沙箱</p>
      </header>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <fieldset className="script-editor-columns" disabled={saving}>
        <section className="script-editor-code ai-task-card">
          <div className="script-editor-toolbar">
            <span className="badge" title={node.id}>
              {node.name || node.id}.{node.language}
            </span>
            <button disabled={syntax.checking} onClick={check}>
              {syntax.checking ? '正在检查…' : '检查语法'}
            </button>
            <button
              aria-expanded={preview}
              onClick={() => {
                setPreview(true);
                setPreviewRevision((revision) => revision + 1);
              }}
            >
              预览输入输出
            </button>
          </div>
          <Suspense fallback={<p>加载代码编辑器…</p>}>
            <CodeEditor
              value={node.code}
              language={node.language === 'ts' ? 'typescript' : 'javascript'}
              label="脚本代码"
              theme="vs-dark"
              readOnly={saving}
              height="390px"
              onChange={(code) => change({ ...node, code })}
            />
          </Suspense>
          <div className="script-syntax" role="status" aria-live="polite">
            {syntax.error && <p className="field-error">检查未完成：{syntax.error}</p>}
            {syntax.issues &&
              (syntax.issues.length ? (
                <ul>
                  {syntax.issues.map((issue, index) => (
                    <li key={index}>
                      第 {issue.lineNumber} 行，{issue.column} 列：{issue.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>语法检查通过；依赖解析、入口函数和实际结果仍需运行前检查及试运行。</p>
              ))}
          </div>
          <p className="note">入口为 default export 的函数，参数为 ctx；返回值成为步骤输出。</p>
          <section className="script-preview" aria-label="输入与输出预览">
            <h2>输入与输出预览</h2>
            {preview ? (
              <>
                <h3>当前草稿输入</h3>
                <p>
                  {input.available
                    ? '按当前参数解析；执行前仍会固定本次输入。'
                    : '包含运行时引用；此处显示来源配置，实际值由运行产生。'}
                </p>
                <pre>{json(input.available ? input.value : node.input)}</pre>
                {!input.available && <p className="note">{input.reason}</p>}
                <h3>历史运行输出</h3>
                <label htmlFor="script-history">最近 20 次运行</label>
                <select
                  id="script-history"
                  value={runId}
                  onChange={(e) => {
                    setDetail(undefined);
                    setRunId(e.target.value);
                  }}
                >
                  <option value="">选择运行…</option>
                  {runs.map((run) => (
                    <option value={run.id} key={run.id}>
                      {new Date(run.createdAt).toLocaleString('zh-CN')} · {run.id.slice(0, 8)} ·{' '}
                      {run.state}
                    </option>
                  ))}
                </select>
                <p role="status">{historyState}</p>
                {detail && (
                  <div data-script-run={detail.run.id}>
                    <p>
                      固定版本 {detail.run.versionId} · 运行 {detail.run.id}
                    </p>
                    <p>
                      {JSON.stringify(snapshotNode) === JSON.stringify(node)
                        ? '步骤配置与当前草稿相同；历史结果不保证下一次结果。'
                        : '历史步骤配置与当前草稿不同，以下不是本次编辑的结果。'}
                    </p>
                    {outputs.length ? (
                      outputs.map((output) => (
                        <div key={output.instance}>
                          <strong>{output.instance}</strong>
                          <pre>{json(output.value)}</pre>
                        </div>
                      ))
                    ) : (
                      <p>此运行没有该步骤的已保存输出；不能据此判定成功，也不会自动重跑。</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p>点击“预览输入输出”查看当前输入来源与已有运行结果，不执行脚本。</p>
            )}
          </section>
        </section>
        <aside className="script-editor-settings ai-task-card">
          <h2>配置</h2>
          <label htmlFor="script-language">语言</label>
          <select
            id="script-language"
            value={node.language}
            onChange={(e) => change({ ...node, language: e.target.value as 'js' | 'ts' })}
          >
            <option value="ts">TypeScript</option>
            <option value="js">JavaScript</option>
          </select>
          <details className="script-input-settings">
            <summary>输入 · 配置来源</summary>
            <ValueField
              label="脚本输入"
              value={node.input}
              choices={referenceChoices(draft.flow, nodeId)}
              defaultValue={{}}
              change={(input) => change({ ...node, input })}
            />
          </details>
          <label htmlFor="script-timeout">超时（毫秒）</label>
          <input
            id="script-timeout"
            inputMode="numeric"
            value={timeout}
            onChange={(e) => setTimeoutValue(e.target.value)}
          />
          <p className="note">100–3600000 毫秒；未配置时为 60000 毫秒，外层步骤可能先到期。</p>
          <ScriptPackages
            flowId={record.id}
            node={node}
            bindings={draft.bindings}
            bind={(info) => setDraft(editScriptPackage(draft, node, info.name, info))}
            remove={(name) => setDraft(editScriptPackage(draft, node, name))}
          />
          <details className="script-access">
            <summary>
              文件与凭据 · {Object.keys(draft.bindings.files).length} 个目录 ·{' '}
              {draft.bindings.credentials.length} 个凭据引用
            </summary>
            <p className="note">
              可信脚本可使用 Node 能力；这些绑定不是文件或网络安全隔离。模板 SDK
              另按当前入口授权检查。
            </p>
          </details>
          <p className="script-editor-note">
            保存会更新当前流程草稿。代码和依赖在运行前固定，不自动安装依赖；语法检查不代表业务结果通过。
          </p>
          <button className="primary" onClick={() => persist()}>
            {saving ? '正在保存…' : '保存并返回'}
          </button>
          <button onClick={() => navigation.current?.()}>取消</button>
        </aside>
      </fieldset>
      <dialog
        ref={dialog}
        className="script-leave-dialog"
        aria-labelledby="script-leave-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!saving) setPendingLeave(undefined);
        }}
      >
        <h2 id="script-leave-title">保存脚本修改？</h2>
        <p>代码、输入、超时和依赖将一起保存。放弃只撤销本次脚本编辑。</p>
        <div>
          <button className="primary" disabled={saving} onClick={() => persist(pendingLeave?.next)}>
            保存并离开
          </button>
          <button disabled={saving} onClick={() => close(pendingLeave?.next)}>
            放弃修改
          </button>
          <button disabled={saving} onClick={() => setPendingLeave(undefined)}>
            继续编辑
          </button>
        </div>
      </dialog>
    </section>
  );
}
