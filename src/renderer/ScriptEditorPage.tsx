import { recordTime, runRecordLabel } from './readable-labels';
import { runInstancePresenter } from './run-instance-presentation';
import {
  Alert,
  Card,
  ConfigProvider,
  Collapse,
  Select,
  Button,
  Input,
  Modal,
  Flex,
  Tag,
  Badge,
} from 'antd';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { FlowRecord, Run } from '../shared/types';
import { runDisplayLabels } from '../shared/run-history';
import { changeSteps, flatten } from './flow-editing';
import { referenceChoices } from './value-references';
import ValueField from './ValueField';
import ScriptPackages from './ScriptPackages';
import { activateCollapseWithSpace } from './collapseKeyboard';
import ActionButton from './ActionButton';
import type { CodeLocation } from './CodeEditor';
import {
  editScriptPackage,
  scriptInputPreview,
  scriptOutputs,
  type ScriptNode,
} from './script-editor';
const CodeEditor = lazy(() => import('./CodeEditor'));
export type ScriptNavigation = (next?: () => void, destination?: string) => void;
type Diagnostic = { lineNumber: number; column: number; message: string };
const incompleteInputMessage = '请先修正未完成的输入配置';
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
  initialPreview = false,
  returnLabel = '流程编排',
}: {
  record: FlowRecord;
  nodeId: string;
  initialPreview?: boolean;
  returnLabel?: string;
  save: (record: FlowRecord) => Promise<void>;
  close: (next?: () => void) => void;
  navigation: MutableRefObject<ScriptNavigation | undefined>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(record));
  const node = flatten(draft.flow.steps).find((step) => step.id === nodeId) as ScriptNode;
  const [timeout, setTimeoutValue] = useState(String(node.timeoutMs ?? 60000));
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const [timeoutError, setTimeoutError] = useState('');
  const [location, setLocation] = useState<CodeLocation>();
  const [plainText, setPlainText] = useState(false);
  const plainEditor = useRef<HTMLTextAreaElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ selector: string }>();
  const [expandedSettings, setExpandedSettings] = useState<string[]>([]);
  const expandSetting = (key: string, open: boolean) =>
    setExpandedSettings((current) =>
      open
        ? [...current.filter((item) => item !== key), key]
        : current.filter((item) => item !== key),
    );
  const [syntax, setSyntax] = useState<{
    checking?: boolean;
    issues?: Diagnostic[];
    error?: string;
  }>({});
  const [preview, setPreview] = useState(initialPreview),
    [runs, setRuns] = useState<Run[]>([]);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [runId, setRunId] = useState(''),
    [detail, setDetail] = useState<any>();
  const [historyLoading, setHistoryLoading] = useState(false),
    [historyError, setHistoryError] = useState(''),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState('');
  const [inputIncomplete, setInputIncomplete] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{ next?: () => void; destination: string }>();
  const [leaveFailureRevision, setLeaveFailureRevision] = useState(0);
  const root = useRef<HTMLElement>(null),
    leaveOrigin = useRef<HTMLElement | null>(null),
    continueButton = useRef<HTMLButtonElement>(null),
    leaveHeading = useRef<HTMLHeadingElement>(null),
    resultFocus = useRef<HTMLElement | null>(null);
  const inputStateChanged = useCallback((_label: string, incomplete: boolean) => {
    setInputIncomplete(incomplete);
    if (!incomplete && !root.current?.querySelector('[data-value-invalid]'))
      setError((current) => (current === incompleteInputMessage ? '' : current));
  }, []);
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
    root.current
      ?.querySelector<HTMLElement>(initialPreview ? '[aria-label="输入与输出预览"]' : 'h1')
      ?.focus();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setSyntax({});
    setLocation(undefined);
  }, [node.code, node.language]);
  useEffect(() => {
    const editor = plainEditor.current;
    if (!plainText || !location || !editor || saving) return;
    const lines = node.code.split(/(?<=\n)/);
    const line = Math.max(0, Math.min(location.lineNumber - 1, lines.length - 1));
    const offset =
      lines.slice(0, line).join('').length +
      Math.min(Math.max(0, location.column - 1), lines[line].replace(/\r?\n$/, '').length);
    editor.focus();
    editor.setSelectionRange(offset, offset);
    editor.scrollTop = Math.max(0, (line - 3) * 22);
  }, [plainText, location, saving]);
  useLayoutEffect(() => {
    navigation.current = (next, destination = returnLabel) => {
      if (persisting.current || pendingLeave) return;
      if (changed || incomplete()) {
        setError('');
        setPendingLeave({ next, destination });
      } else close(next);
    };
    return () => {
      navigation.current = undefined;
    };
  });
  useLayoutEffect(() => {
    if (pendingLeave) leaveOrigin.current = document.activeElement as HTMLElement | null;
  }, [pendingLeave]);
  useEffect(() => {
    if (pendingLeave && error && !saving) leaveHeading.current?.focus();
  }, [pendingLeave, error, saving, leaveFailureRevision]);
  const stayInEditor = () => {
    if (persisting.current) return;
    setPendingLeave(undefined);
    requestAnimationFrame(() => {
      if (leaveOrigin.current?.isConnected) leaveOrigin.current.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    if (pendingLeave || saving || !focusRequest) return;
    const element = root.current?.querySelector<HTMLElement>(focusRequest.selector);
    if (!element) return;
    if (element.closest('.script-input-settings') && !expandedSettings.includes('input')) {
      expandSetting('input', true);
      return;
    }
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== root.current) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    const target = element.matches('input,textarea,select,button,[data-script-preview]')
      ? element
      : (element.querySelector<HTMLElement>('textarea') ??
        element.querySelector<HTMLElement>('input,select') ??
        element);
    const frame = requestAnimationFrame(() => {
      if (!target.isConnected) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest' });
      setFocusRequest(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingLeave, saving, focusRequest, expandedSettings]);
  const persist = async (next?: () => void) => {
    if (persisting.current) return;
    setError('');
    if (incomplete()) {
      setFocusRequest({ selector: '[data-value-invalid]' });
      setError(incompleteInputMessage);
      if (pendingLeave) setLeaveFailureRevision((revision) => revision + 1);
      return;
    }
    const milliseconds = Number(timeout);
    if (
      !/^\d+$/.test(timeout) ||
      !Number.isSafeInteger(milliseconds) ||
      milliseconds < 100 ||
      milliseconds > 3600000
    ) {
      setError('超时须为 100 至 3600000 毫秒的整数');
      setTimeoutError('超时须为 100 至 3600000 毫秒的整数');
      setFocusRequest({ selector: '#script-timeout' });
      if (pendingLeave) setLeaveFailureRevision((revision) => revision + 1);
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
        setError((e as Error).message);
        if (pendingLeave) setLeaveFailureRevision((revision) => revision + 1);
        else setFocusRequest({ selector: '[data-script-error]' });
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
    setHistoryLoading(true);
    setHistoryError('');
    window.flowark
      .request('run.list', { flowId: record.id, limit: 20 })
      .then((result) => {
        if (!live) return;
        setRuns(result.runs);
        setRunId((selected) =>
          result.runs.some((run: Run) => run.id === selected) ? selected : '',
        );
      })
      .catch((e) => {
        if (live) setHistoryError(e instanceof Error ? e.message : '运行列表暂时不可用');
      })
      .finally(() => {
        if (live) setHistoryLoading(false);
      });
    return () => {
      live = false;
    };
  }, [preview, record.id, previewRevision]);
  useEffect(() => {
    setDetail(undefined);
    setDetailError('');
    setDetailLoading(false);
    if (!preview || !runId) return;
    let live = true;
    setDetailLoading(true);
    window.flowark
      .request('run.detail', { id: runId })
      .then((result) => {
        if (!live) return;
        if (
          result.run?.id !== runId ||
          result.run?.flowId !== record.id ||
          result.snapshot?.id !== record.id
        )
          throw new Error('运行来源不匹配');
        setDetail(result);
      })
      .catch((e) => {
        if (live) setDetailError(e instanceof Error ? e.message : '运行结果暂时不可用');
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [preview, runId, record.id, previewRevision]);
  const input = scriptInputPreview(node.input, draft.flow.parameters, draft.flow.parameterSources);
  const currentDetail = detail?.run.id === runId ? detail : undefined;
  const outputs = currentDetail
    ? scriptOutputs(currentDetail.snapshot.steps, currentDetail.output, nodeId)
    : [];
  const snapshotNode =
    currentDetail && flatten(currentDetail.snapshot.steps).find((step) => step.id === nodeId);
  useEffect(() => {
    if (!runId) {
      resultFocus.current = null;
      return;
    }
    if (detailLoading || (!currentDetail && !detailError) || !resultFocus.current) return;
    const origin = resultFocus.current;
    resultFocus.current = null;
    const active = document.activeElement;
    if (
      saving ||
      document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]') ||
      (active !== origin &&
        active !== document.body &&
        active !== root.current?.querySelector('[data-script-preview]'))
    )
      return;
    const target = root.current?.querySelector<HTMLElement>(
      detailError ? '[data-script-detail-error]' : '[data-script-run]',
    );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }, [runId, detailLoading, currentDetail, detailError, saving]);
  const refreshPreview = () => {
    resultFocus.current = document.activeElement as HTMLElement;
    setDetail(undefined);
    setDetailError('');
    setPreview(true);
    setPreviewRevision((revision) => revision + 1);
    setFocusRequest({ selector: '[data-script-preview]' });
  };
  return (
    <section className="script-editor-page page" ref={root} aria-label="脚本编辑">
      <header className="script-editor-heading">
        <h1 tabIndex={-1}>脚本：编辑、检查、再试运行</h1>
        <p>可信 JS/TS · 独立进程执行 · 不是安全沙箱</p>
      </header>
      {error && !pendingLeave && (
        <div role="alert" tabIndex={-1} data-script-error>
          <Alert type="error" role="presentation" showIcon description={error} />
        </div>
      )}
      <ConfigProvider componentDisabled={saving}>
        <fieldset className="script-editor-columns" disabled={saving}>
          <section className="script-editor-code">
            <Card className="script-editor-card">
              <div className="script-editor-toolbar">
                <span className="badge">
                  {node.name || '未命名脚本'}.{node.language}
                </span>
                <ActionButton
                  hint={
                    saving
                      ? '正在保存，请等待完成'
                      : syntax.checking
                        ? '正在检查脚本语法，不会执行脚本'
                        : '仅检查语法，不安装依赖或执行脚本'
                  }
                  loading={!!syntax.checking}
                  disabled={syntax.checking || undefined}
                  onClick={check}
                >
                  检查语法
                </ActionButton>
                <ActionButton
                  hint={
                    saving
                      ? '正在保存，请等待完成'
                      : '查看当前输入与已保存运行的历史输出，不会执行脚本'
                  }
                  aria-expanded={preview}
                  onClick={refreshPreview}
                >
                  预览输入输出
                </ActionButton>
              </div>
              <div className="script-editor-mode" role="group" aria-label="脚本编辑方式">
                <Button
                  type={plainText ? 'default' : 'primary'}
                  aria-pressed={!plainText}
                  onClick={() => setPlainText(false)}
                >
                  代码编辑
                </Button>
                <Button
                  type={plainText ? 'primary' : 'default'}
                  aria-pressed={plainText}
                  onClick={() => {
                    setPlainText(true);
                    setFocusRequest({ selector: '[data-plain-script]' });
                  }}
                >
                  纯文本编辑
                </Button>
              </div>
              {plainText ? (
                <textarea
                  ref={plainEditor}
                  data-plain-script
                  className="script-editor-plain"
                  aria-label="脚本代码（纯文本）"
                  value={node.code}
                  readOnly={saving}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  wrap="off"
                  onChange={(event) => change({ ...node, code: event.target.value })}
                />
              ) : (
                <Suspense fallback={<p>加载代码编辑器…</p>}>
                  <CodeEditor
                    value={node.code}
                    language={node.language === 'ts' ? 'typescript' : 'javascript'}
                    label="脚本代码"
                    theme="vs-dark"
                    readOnly={saving}
                    height="390px"
                    location={location}
                    onChange={(code) => change({ ...node, code })}
                  />
                </Suspense>
              )}
              <p className="note">
                当前脚本 {node.code.length} 个字符 · 切换编辑方式保留同一份内容。
                纯文本支持标准选择、粘贴和辅助技术；检查、预览及保存保持一致。
              </p>
              <div className="script-syntax" role="status" aria-live="polite">
                {syntax.error && <p className="field-error">检查未完成：{syntax.error}</p>}
                {syntax.issues &&
                  (syntax.issues.length ? (
                    <>
                      <p className="field-error">
                        发现 {syntax.issues.length} 个语法问题，选择一项定位到代码。
                      </p>
                      <ul>
                        {syntax.issues.map((issue, index) => (
                          <li key={index}>
                            <Button
                              className="script-diagnostic"
                              onClick={() =>
                                setLocation((current) => ({
                                  lineNumber: issue.lineNumber,
                                  column: issue.column,
                                  request: (current?.request ?? 0) + 1,
                                }))
                              }
                            >
                              第 {issue.lineNumber} 行，{issue.column} 列：{issue.message}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>语法检查通过；依赖解析、入口函数和实际结果仍需运行前检查及试运行。</p>
                  ))}
              </div>
              <p className="note">入口为 default export 的函数，参数为 ctx；返回值成为步骤输出。</p>
              <section
                className="script-preview"
                aria-label="输入与输出预览"
                data-script-preview
                tabIndex={-1}
              >
                <h2>输入与输出预览</h2>
                {preview ? (
                  <>
                    <h3>当前草稿输入</h3>
                    {inputIncomplete ? (
                      <p role="status">输入尚未完成，修正后才能预览当前值。</p>
                    ) : (
                      <>
                        <p>
                          {input.available
                            ? '按当前参数解析；执行前仍会固定本次输入。'
                            : '此输入当前无法解析；以下显示来源配置。'}
                        </p>
                        <pre tabIndex={0} aria-label="当前草稿输入内容">
                          {json(input.available ? input.value : node.input)}
                        </pre>
                        {!input.available && <p className="note">{input.reason}</p>}
                      </>
                    )}
                    <h3>历史运行输出</h3>
                    <label htmlFor="script-history">最近 20 次运行</label>
                    <Select<string>
                      id="script-history"
                      value={runId}
                      disabled={historyLoading || !runs.length || undefined}
                      onChange={(value) => {
                        resultFocus.current = document.getElementById('script-history');
                        setDetail(undefined);
                        setDetailError('');
                        setRunId(value);
                      }}
                      options={[
                        { value: '', label: '选择运行…' },
                        ...runs.map((run) => ({
                          value: run.id,
                          label: (
                            <>
                              {new Date(run.createdAt).toLocaleString('zh-CN')} ·{' '}
                              {recordTime(run.createdAt)} · {runDisplayLabels[run.state]}
                            </>
                          ),
                        })),
                      ]}
                    />
                    <p role="status">
                      {historyLoading
                        ? '正在读取最近 20 次运行…'
                        : historyError
                          ? runs.length
                            ? '运行列表未更新，保留上次读取的选项。'
                            : '运行列表尚未取得，请重新读取。'
                          : !runs.length
                            ? '尚无运行记录；预览不会运行脚本'
                            : !runId
                              ? '选择历史运行查看实际输出'
                              : ''}
                    </p>
                    {historyError && (
                      <p className="field-error" role="alert">
                        运行列表读取失败：{historyError}
                      </p>
                    )}
                    {runId && detailLoading && <p role="status">正在读取所选运行结果…</p>}
                    {runId && detailError && (
                      <p
                        className="field-error"
                        role="alert"
                        data-script-detail-error
                        tabIndex={-1}
                      >
                        运行结果读取失败：{detailError}
                      </p>
                    )}
                    {(historyError || detailError) && (
                      <ActionButton
                        hint={
                          historyLoading || detailLoading
                            ? '正在读取所选运行，请等待完成'
                            : '重新读取当前脚本的历史运行结果，不会重跑脚本'
                        }
                        aria-label="重新读取历史结果"
                        disabled={historyLoading || detailLoading || undefined}
                        onClick={refreshPreview}
                      >
                        重读历史
                      </ActionButton>
                    )}
                    {currentDetail && (
                      <div
                        data-script-run={currentDetail.run.id}
                        tabIndex={-1}
                        aria-label="所选运行的历史输出"
                      >
                        <p>{runRecordLabel(currentDetail.run)} · 按启动时保存的方案执行</p>
                        <p>
                          {JSON.stringify(snapshotNode) === JSON.stringify(node)
                            ? '步骤配置与当前草稿相同；历史结果不保证下一次结果。'
                            : '历史步骤配置与当前草稿不同，以下不是本次编辑的结果。'}
                        </p>
                        {outputs.length ? (
                          outputs.map((output) => (
                            <div key={output.instance}>
                              <strong>
                                {runInstancePresenter(currentDetail.snapshot)(output.instance) ??
                                  '步骤位置待核对'}
                              </strong>
                              <pre tabIndex={0} aria-label="已保存的历史步骤输出">
                                {json(output.value)}
                              </pre>
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
            </Card>
          </section>
          <aside className="script-editor-settings">
            <Card className="script-editor-card">
              <h2>配置</h2>
              <label htmlFor="script-language">语言</label>
              <Select<string>
                id="script-language"
                value={node.language}
                onChange={(value) => change({ ...node, language: value as 'js' | 'ts' })}
                options={[
                  { value: 'ts', label: 'TypeScript' },
                  { value: 'js', label: 'JavaScript' },
                ]}
              />
              <Collapse
                className="script-input-settings"
                size="small"
                activeKey={expandedSettings.includes('input') ? ['input'] : []}
                onChange={(keys) => expandSetting('input', keys.includes('input'))}
                items={[
                  {
                    key: 'input',
                    label: '输入 · 配置来源',
                    forceRender: true,
                    onKeyDown: activateCollapseWithSpace,
                    children: (
                      <ValueField
                        label="脚本输入"
                        value={node.input}
                        choices={referenceChoices(draft.flow, nodeId)}
                        defaultValue={{}}
                        change={(input) => change({ ...node, input })}
                        onIncompleteChange={inputStateChanged}
                      />
                    ),
                  },
                ]}
              />
              <label htmlFor="script-timeout">超时（毫秒）</label>
              <Input
                status={!!timeoutError ? 'error' : undefined}
                id="script-timeout"
                inputMode="numeric"
                aria-invalid={!!timeoutError}
                aria-describedby={
                  timeoutError ? 'script-timeout-error script-timeout-help' : 'script-timeout-help'
                }
                value={timeout}
                onChange={(e) => {
                  setTimeoutValue(e.target.value);
                  setTimeoutError('');
                  setError('');
                }}
              />
              {timeoutError && (
                <p className="field-error" id="script-timeout-error">
                  {timeoutError}
                </p>
              )}
              <p className="note" id="script-timeout-help">
                100–3600000 毫秒；未配置时为 60000 毫秒，外层步骤可能先到期。
              </p>
              <Collapse
                className="script-dependency-settings"
                size="small"
                activeKey={expandedSettings.includes('dependencies') ? ['dependencies'] : []}
                onChange={(keys) => expandSetting('dependencies', keys.includes('dependencies'))}
                items={[
                  {
                    key: 'dependencies',
                    label: `依赖 · ${node.dependencies.length ? `${node.dependencies.length} 个本地包` : '仅内置 SDK'}`,
                    forceRender: true,
                    onKeyDown: activateCollapseWithSpace,
                    children: (
                      <ScriptPackages
                        flowId={record.id}
                        node={node}
                        bindings={draft.bindings}
                        bind={(info) => setDraft(editScriptPackage(draft, node, info.name, info))}
                        remove={(name) => setDraft(editScriptPackage(draft, node, name))}
                      />
                    ),
                  },
                ]}
              />
              <Collapse
                className="script-access"
                size="small"
                activeKey={expandedSettings.includes('access') ? ['access'] : []}
                onChange={(keys) => expandSetting('access', keys.includes('access'))}
                items={[
                  {
                    key: 'access',
                    label: `文件与凭据 · ${Object.keys(draft.bindings.files).length} 个目录 · ${draft.bindings.credentials.length} 个凭据引用`,
                    forceRender: true,
                    onKeyDown: activateCollapseWithSpace,
                    children: (
                      <p className="note">
                        可信脚本可使用 Node 能力；这些绑定不是文件或网络安全隔离。模板 SDK
                        另按当前入口授权检查。
                      </p>
                    ),
                  },
                ]}
              />
              <Alert
                type="info"
                role="note"
                showIcon
                description="保存会更新当前流程草稿。代码和依赖在运行前固定，不自动安装依赖；语法检查不代表业务结果通过。"
              />
              <ActionButton
                stretch
                hint={
                  saving
                    ? '正在保存，请等待完成'
                    : `保存当前流程草稿并返回${returnLabel}，不会执行脚本`
                }
                type="primary"
                loading={saving}
                onClick={() => persist()}
              >
                保存并返回
              </ActionButton>
              <ActionButton
                stretch
                hint={saving ? '正在保存，请等待完成' : '取消编辑；未保存修改会先进行离开核对'}
                onClick={() => navigation.current?.()}
              >
                取消
              </ActionButton>
            </Card>
          </aside>
        </fieldset>
      </ConfigProvider>
      {pendingLeave && (
        <Modal
          open
          width={640}
          centered
          closable={false}
          mask={{ closable: false }}
          keyboard={!saving}
          focusable={{ focusTriggerAfterClose: false }}
          className="flowark-leave-modal"
          aria-describedby="script-leave-description"
          aria-busy={saving}
          onCancel={stayInEditor}
          afterOpenChange={(open) => {
            if (open) (error ? leaveHeading.current : continueButton.current)?.focus();
          }}
          title={
            <Flex vertical gap={16} align="flex-start">
              <Tag
                color={error ? 'error' : 'warning'}
                variant="filled"
                className="flowark-leave-status"
                icon={<Badge status={error ? 'error' : 'warning'} />}
              >
                {error ? '保存未完成' : '存在未保存更改'}
              </Tag>
              <h2 ref={leaveHeading} tabIndex={-1}>
                保存脚本修改？
              </h2>
            </Flex>
          }
          footer={
            <Flex gap={12} wrap className="flowark-leave-actions">
              <Button ref={continueButton} disabled={saving || undefined} onClick={stayInEditor}>
                继续编辑
              </Button>
              <Button
                color="danger"
                variant="filled"
                disabled={saving || undefined}
                onClick={() => close(pendingLeave?.next)}
              >
                不保存离开
              </Button>
              <Button
                type="primary"
                loading={saving}
                disabled={saving || undefined}
                onClick={() => void persist(pendingLeave?.next)}
              >
                {saving ? '正在保存…' : error ? '重试保存并离开' : '保存并离开'}
              </Button>
            </Flex>
          }
        >
          <p id="script-leave-description">
            代码、输入、超时和依赖将一起保存。放弃只撤销本次脚本编辑。 保存成功后前往“
            {pendingLeave.destination}”。
          </p>
          {error && <Alert type="error" title="保存未完成" description={error} role="alert" />}
        </Modal>
      )}
    </section>
  );
}
