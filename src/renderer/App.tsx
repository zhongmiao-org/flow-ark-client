import { useState, useEffect, useCallback, useReducer, useRef, lazy, Suspense } from 'react';
import FlowLibrary from './FlowLibrary';
import { buildDiagram } from './flow-diagram';
import DiagramCanvas from './DiagramCanvas';
import { kinds } from './node-kinds';
import ActionLibrary, { destinationChoices } from './ActionLibrary';
import {
  flatten,
  changeSteps,
  locationOf,
  insertStep,
  duplicateStep,
  moveStep,
  moveSibling,
  checkStructure,
  type Destination,
} from './flow-editing';
import { draftHistory, emptyHistory } from './draft-history';
import '@xyflow/react/dist/style.css';
import {
  Undo2,
  Redo2,
  Workflow,
  Play,
  Plus,
  LayoutTemplate,
  History,
  Clock,
  Bell,
  Settings,
  ArrowUpRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Check,
  ChevronRight,
  Globe,
  Code,
  FileSpreadsheet,
  GitBranch,
  Repeat,
  Hand,
  Upload,
  Download,
  Save,
  Pause,
  Square,
  Copy,
  FolderOpen,
  Trash2,
  Activity,
  Search,
  ShieldCheck,
  CircleHelp,
} from 'lucide-react';
import type { Bootstrap, FlowRecord, Step, Run, Event } from '../shared/types';
import TemplateLibrary from './TemplateLibrary';
import TemplateConfiguration from './TemplateConfiguration';
import ScriptPackages from './ScriptPackages';
import EmbeddedBrowserPanel from './EmbeddedBrowserPanel';
import BrowserSidebar from './BrowserSidebar';
import ArtifactCleanupPanel from './ArtifactCleanupPanel';
import RunRerunPanel from './RunRerunPanel';
import Schedules from './Schedules';
import { fileBindingNames } from './file-bindings';
import BrowserNodeConfiguration from './BrowserNodeConfiguration';
import LogicNodeConfiguration from './LogicNodeConfiguration';
import ResourceNodeConfiguration from './ResourceNodeConfiguration';
import ParameterConfiguration from './ParameterConfiguration';
import TemplateParameters from './TemplateParameters';
import RunHistory from './RunHistory';
import { RunObservation, RunOutput } from './RunObservation';
import { presentRun } from '../shared/run-presentation';
import { runStateLabels } from '../shared/run-history';
import { referenceChoices } from './value-references';
import { referenceIssues } from '../shared/flow-references';
const CodeEditor = lazy(() => import('./CodeEditor'));
const initial: Bootstrap = {
  flows: [],
  runs: [],
  runOverview: { total: 0, queued: 0, active: null, latest: [] },
  browsers: [],
  schedules: [],
  attention: [],
  templates: [],
  instances: [],
  credentials: [],
  dataPath: '',
};
const api = (method: string, args: any = {}) => window.flowark.request(method, args);
const status: Record<string, string> = runStateLabels;
const uid = () => crypto.randomUUID();

function badge(s: string) {
  return <span className={'badge state-' + s}>{status[s] ?? s}</span>;
}
function format(t: string) {
  return new Date(t).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
export default function App() {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [editorPanel, setEditorPanel] = useState('canvas');
  const [compactEditor, setCompactEditor] = useState(() => window.innerWidth < 1440);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1439px)');
    const change = () => setCompactEditor(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [importPreview, setImportPreview] = useState<any>();
  useEffect(() => {
    const open = () => setBrowserOpen(true);
    window.addEventListener('flowark:open-browser', open);
    return () => window.removeEventListener('flowark:open-browser', open);
  }, []);
  const [data, setData] = useState(initial),
    [section, setSection] = useState('flows'),
    [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [configOpen, setConfigOpen] = useState(false);
  const [history, dispatchDraft] = useReducer(draftHistory, emptyHistory);
  const edit = history.present?.record ?? null,
    selected = history.present?.selected ?? '';
  const inputGroup = useRef<string | undefined>(undefined);
  const inputTarget = useRef<Element | null>(null);
  const setEdit = (record: FlowRecord) =>
    dispatchDraft({ type: 'change', record, group: inputGroup.current });
  const setSelected = (selected: string) => {
    if (guardInvalidNodeJson()) dispatchDraft({ type: 'select', selected });
  };
  const undo = () => {
    if (!guardInvalidNodeJson()) return;
    inputGroup.current = undefined;
    dispatchDraft({ type: 'undo' });
  };
  const redo = () => {
    if (!guardInvalidNodeJson()) return;
    inputGroup.current = undefined;
    dispatchDraft({ type: 'redo' });
  };
  const refresh = useCallback(async () => {
    try {
      setData(await api('bootstrap'));
      setLoaded(true);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!detail) return;
    const id = detail.run.id;
    let live = true,
      pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await api('run.detail', { id });
        if (live) setDetail((current: any) => (current?.run.id === id ? next : current));
      } catch (e: any) {
        if (live) setError(e.message);
      } finally {
        pending = false;
      }
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [detail?.run?.id]);
  async function action(fn: () => Promise<any>, message?: string) {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      if (message) setNotice(message);
      await refresh();
      return r;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function openFlow(r: FlowRecord) {
    if (!guardInvalidNodeJson()) return;
    setConfigOpen(false);
    setEditorPanel('canvas');
    inputGroup.current = undefined;
    dispatchDraft({ type: 'open', record: r });
    setSection('editor');
    setDetail(null);
  }
  async function create() {
    if (!guardInvalidNodeJson()) return;
    const r = await action(() => api('flow.create', {}));
    if (r) void openFlow(r);
  }
  function focusInvalidInput(invalid: HTMLElement) {
    const details = invalid.closest('details');
    if (details) details.open = true;
    const input = invalid.matches('textarea,input')
      ? invalid
      : invalid.querySelector<HTMLElement>('textarea,input');
    input?.focus();
  }
  function guardInvalidNodeJson() {
    const invalid = document.querySelector<HTMLElement>(
      '.editor-page .node-advanced[data-value-invalid]',
    );
    if (!invalid) return true;
    focusInvalidInput(invalid);
    setError('请先修正高级节点 JSON，或点击“恢复节点配置”放弃这段未完成输入');
    return false;
  }
  function checkEditorInput(operation = '保存或运行') {
    if (section !== 'editor') return;
    const invalid = document.querySelector<HTMLElement>('.editor-page [data-value-invalid]');
    if (invalid) {
      focusInvalidInput(invalid);
      throw new Error('请先修正未完成的值配置，再' + operation);
    }
  }
  async function save() {
    if (edit)
      return action(() => {
        checkEditorInput();
        return api('flow.save', { flow: edit.flow, bindings: edit.bindings });
      }, '已保存本地草稿');
  }
  async function exportDraft() {
    if (edit)
      return action(() => {
        checkEditorInput('导出');
        const configuration = edit.bindings.configuration;
        const snapshot = structuredClone({
          flow: edit.flow,
          ...(configuration
            ? { configuration: { adapter: configuration.adapter, schema: configuration.schema } }
            : {}),
          reviewed: true as const,
        });
        return api('flow.export', snapshot);
      });
  }
  async function run(r: FlowRecord, debug = false) {
    await action(async () => {
      checkEditorInput();
      await api('flow.save', { flow: r.flow, bindings: r.bindings });
      const run = await api('flow.run', { id: r.id, debug });
      const next = await api('run.detail', { id: run.id });
      if (!guardInvalidNodeJson()) return;
      setDetail(next);
      setSection('runs');
    }, '已生成快照并加入队列');
  }
  const unread = data.attention.filter((a) => !a.read).length;
  const nav = [
    ['flows', '我的流程', Workflow],
    ['templates', '模板库', LayoutTemplate],
    ['runs', '运行记录', History],
    ['schedules', '本机计划', Clock],
    ['inbox', '待办与提醒', Bell],
    ['settings', '本地设置', Settings],
  ] as const;
  const observedActive = data.execution?.active;
  const active = observedActive
    ? ([data.runOverview.active, ...data.runs].find((run) => run?.id === observedActive.runId) ??
      null)
    : null;
  const savedEdit = edit && data.flows.find((record) => record.id === edit.id);
  const draftSaved =
    !!savedEdit &&
    JSON.stringify(edit.flow) === JSON.stringify(savedEdit.flow) &&
    JSON.stringify(edit.bindings) === JSON.stringify(savedEdit.bindings);
  const welcomePage =
    section === 'flows' && loaded && !data.fault && !data.flows.length && !welcomeDismissed;
  const returnHome = () => {
    if (!guardInvalidNodeJson()) return;
    setWelcomeDismissed(true);
    setSection('flows');
    setDetail(null);
  };
  return (
    <div className="application-shell">
      <div className="window-titlebar">FlowArk · 个人工作空间</div>
      <div
        className={`app ${browserOpen ? 'with-browser' : ''} ${section === 'editor' ? 'editing-workspace' : ''}`}
      >
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">
              <Workflow size={20} strokeWidth={1.6} />
            </span>
            <span className="brand-name">FlowArk</span>
          </div>
          <div className="workspace-label">
            <span>个人工作空间</span>
            <small>LOCAL WORKSPACE</small>
          </div>
          <nav>
            {nav.map(([id, label, Icon]) => (
              <button
                key={id}
                title={label}
                aria-label={label}
                className={
                  section === id || (section === 'editor' && id === 'flows') ? 'selected' : ''
                }
                aria-current={
                  section === id || (section === 'editor' && id === 'flows') ? 'page' : undefined
                }
                onClick={() => {
                  if (!guardInvalidNodeJson()) return;
                  setSection(id);
                  setDetail(null);
                }}
              >
                <Icon size={20} strokeWidth={1.6} />
                <span className="nav-label">{label}</span>
                {id === 'inbox' && unread > 0 && <b>{unread}</b>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <p>仅在这台 Mac 上运行</p>
            <button
              className="sidebar-guide"
              onClick={() =>
                action(async () => {
                  await api('browser.embedded.navigate', {
                    url: 'https://github.com/zhongmiao-org/flow-ark-client#使用',
                  });
                  setBrowserOpen(true);
                })
              }
            >
              <CircleHelp size={18} strokeWidth={1.6} aria-hidden="true" />
              使用指南
            </button>
          </div>
        </aside>
        <main>
          <header className="topbar">
            {(section === 'editor' || welcomePage) && (
              <button className="context-back" onClick={returnHome}>
                ← 返回我的流程
              </button>
            )}
            <nav className="breadcrumbs" aria-label="当前位置">
              {(section === 'editor' || welcomePage) && (
                <>
                  <a
                    href="#flows"
                    onClick={(event) => {
                      event.preventDefault();
                      returnHome();
                    }}
                  >
                    我的流程
                  </a>
                  <span aria-hidden="true">/</span>
                </>
              )}
              <span aria-current="page">
                {section === 'editor'
                  ? edit?.flow.name || '流程编排'
                  : welcomePage
                    ? '首次使用'
                    : nav.find((n) => n[0] === section)?.[1]}
              </span>
            </nav>
            <button
              className="embedded-show"
              aria-label={browserOpen ? '收起网页面板' : '打开网页面板'}
              aria-pressed={browserOpen}
              onClick={() => setBrowserOpen(!browserOpen)}
            >
              {browserOpen ? '收起网页' : '显示网页'}
            </button>
          </header>
          {data.fault && (
            <div className="alert error storage-fault" role="alert">
              <b>运行状态未能完整保存</b>
              <span>
                {data.fault}
                。以下状态为最后成功保存的记录，当前执行和最终结果请核对；重开不会自动重放。
              </span>
            </div>
          )}
          {data.runtimeBlock && (
            <div className="alert error" role="alert">
              <b>资源回收未确认</b>
              <span>{data.runtimeBlock}</span>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              <b>操作未完成</b>
              <span>{error}</span>
              <button onClick={() => setError('')}>关闭</button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button onClick={() => setNotice('')}>×</button>
            </div>
          )}
          {section === 'flows' && (
            <FlowLibrary
              data={data}
              loaded={loaded}
              busy={busy}
              active={active}
              create={create}
              open={openFlow}
              importTemplate={() =>
                action(async () => {
                  const preview = await api('template.inspect');
                  if (preview) {
                    setImportPreview(preview);
                    setSection('templates');
                  }
                })
              }
              showAttention={() => setSection('inbox')}
            />
          )}
          {section === 'templates' && (
            <TemplateLibrary
              data={data}
              action={action}
              initialPreview={importPreview}
              consumePreview={() => setImportPreview(undefined)}
            />
          )}
          {section === 'editor' && edit && (
            <div
              className="editor-page"
              onFocusCapture={(event) => {
                const control = (event.target as HTMLElement).closest(
                  'input,textarea,select,[contenteditable="true"],.monaco-editor',
                );
                inputTarget.current = control;
                inputGroup.current = control ? crypto.randomUUID() : undefined;
              }}
              onChangeCapture={(event) => {
                const control = (event.target as HTMLElement).closest(
                  'input,textarea,select,[contenteditable="true"],.monaco-editor',
                );
                if (control && (control !== inputTarget.current || !inputGroup.current)) {
                  inputTarget.current = control;
                  inputGroup.current = crypto.randomUUID();
                }
              }}
              onClickCapture={(event) => {
                if ((event.target as HTMLElement).closest('button')) {
                  inputTarget.current = null;
                  inputGroup.current = undefined;
                }
              }}
              onKeyDown={(event) => {
                if (
                  !(event.metaKey || event.ctrlKey) ||
                  event.altKey ||
                  event.key.toLowerCase() !== 'z'
                )
                  return;
                if (
                  (event.target as HTMLElement).closest(
                    'input,textarea,select,[contenteditable="true"],.monaco-editor',
                  )
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                if (event.shiftKey) redo();
                else undo();
              }}
            >
              <div className="editor-toolbar">
                <div className="editor-flow-name">
                  <input
                    className="title-input"
                    aria-label="流程名称"
                    value={edit.flow.name}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        flow: { ...edit.flow, name: e.target.value },
                      })
                    }
                  />
                  <span className="muted">
                    {draftSaved ? '草稿已保存' : '有未保存修改'} · {flatten(edit.flow.steps).length}{' '}
                    个步骤 · {edit.flow.sourceTemplate ? '模板流程' : '本地流程'}
                  </span>
                </div>
                <button onClick={save} disabled={busy}>
                  保存
                </button>
                <div className="draft-history" aria-label="草稿编辑历史">
                  <button
                    className="icon-button"
                    aria-label="撤销编辑"
                    title="撤销编辑 · ⌘/Ctrl Z"
                    disabled={!history.past.length || busy}
                    onClick={undo}
                  >
                    <Undo2 size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="重做编辑"
                    title="重做编辑 · ⌘/Ctrl Shift Z"
                    disabled={!history.future.length || busy}
                    onClick={redo}
                  >
                    <Redo2 size={16} />
                  </button>
                </div>
                {edit.bindings.configuration && (
                  <button
                    onClick={() => {
                      if (guardInvalidNodeJson()) {
                        if (edit.bindings.template) setSection('templates');
                        else setConfigOpen(true);
                      }
                    }}
                  >
                    <Settings size={15} />
                    实例配置
                  </button>
                )}
                <button
                  onClick={exportDraft}
                  disabled={busy}
                  title="导出前请确认流程字面量和脚本中没有个人数据；本地绑定和参数值不导出"
                >
                  导出 ZIP
                </button>
                <button
                  onClick={() => {
                    if (guardInvalidNodeJson()) setEditorPanel('params');
                  }}
                >
                  参数与绑定
                </button>
                <button onClick={() => run(edit, true)} disabled={busy}>
                  逐步调试
                </button>
                <button onClick={() => setBrowserOpen(!browserOpen)}>
                  {browserOpen ? '收起网页' : '显示网页'}
                </button>
                <button className="primary" onClick={() => run(edit)} disabled={busy}>
                  运行
                </button>
              </div>
              {configOpen && edit.bindings.configuration && (
                <TemplateConfiguration
                  key={`configuration:${edit.id}`}
                  configuration={edit.bindings.configuration}
                  name={edit.flow.name}
                  close={() => setConfigOpen(false)}
                  apply={async (values) => {
                    checkEditorInput('保存实例配置');
                    setBusy(true);
                    setError('');
                    try {
                      const saved = await api('flow.save', {
                        flow: edit.flow,
                        bindings: {
                          ...edit.bindings,
                          configuration: { ...edit.bindings.configuration!, values },
                        },
                      });
                      inputGroup.current = undefined;
                      inputTarget.current = null;
                      setEdit(saved);
                      setNotice('已保存实例配置');
                      await refresh();
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
              <Editor
                key={edit.id}
                revision={history.revision}
                record={edit}
                setRecord={setEdit}
                selected={selected}
                setSelected={setSelected}
                guardInvalidNodeJson={guardInvalidNodeJson}
                compact={compactEditor}
                panel={editorPanel}
                setPanel={setEditorPanel}
                browserOpen={browserOpen}
                browserPanel={
                  browserOpen ? (
                    <BrowserSidebar
                      close={() => setBrowserOpen(false)}
                      running={!!active && !['PAUSED', 'WAITING_INPUT'].includes(active.state)}
                      obscured={configOpen}
                    />
                  ) : null
                }
                editConfiguration={() => {
                  if (guardInvalidNodeJson()) {
                    if (edit.bindings.template) setSection('templates');
                    else setConfigOpen(true);
                  }
                }}
                browsers={data.browsers}
                choose={async (binding: string) => {
                  const path = await action(() => api('file.choose', { kind: 'directory' }));
                  if (path)
                    setEdit({
                      ...edit,
                      bindings: {
                        ...edit.bindings,
                        files: { ...edit.bindings.files, [binding]: path },
                      },
                    });
                }}
              />
            </div>
          )}
          {section === 'runs' && (
            <div className="page">
              <Heading
                title="每一次运行，都有迹可循"
                text="执行快照、步骤事件与外部业务结果分别记录。"
              />
              <RunHistory visible={!detail} open={setDetail} />
              {detail && (
                <RunDetail
                  key={detail.run.id}
                  detail={detail}
                  fault={data.fault}
                  open={(next) =>
                    setDetail((current: any) =>
                      current?.run.id === detail.run.id ? next : current,
                    )
                  }
                  reload={async () => {
                    const id = detail.run.id;
                    const next = await api('run.detail', { id });
                    setDetail((current: any) => (current?.run.id === id ? next : current));
                  }}
                  back={() => setDetail(null)}
                  control={(id, a) => action(() => api('run.control', { id, action: a }))}
                  reveal={(id) => action(() => api('artifact.reveal', { id }))}
                />
              )}
            </div>
          )}
          {section === 'schedules' && <Schedules data={data} action={action} />}
          {section === 'inbox' && (
            <div className="page">
              <Heading title="需要你看一眼" text="联系方式、待确认动作和异常结果会保存在这里。" />
              {!data.attention.length ? (
                <Empty text="目前没有待办。流程需要人工处理时，会在这里提醒。" />
              ) : (
                data.attention.map((a) => (
                  <div className={'attention ' + (a.read ? 'read' : '')} key={a.id}>
                    <Bell size={20} />
                    <div>
                      <b>{a.title}</b>
                      <small>{format(a.time)}</small>
                      <AttentionContent detail={a.detail} />
                    </div>
                    <button
                      onClick={() =>
                        action(
                          () =>
                            api('clipboard.copy', {
                              value:
                                a.kind === 'contact' && a.detail.value
                                  ? a.detail.value
                                  : JSON.stringify(a.detail, null, 2),
                            }),
                          '已复制',
                        )
                      }
                    >
                      <Copy size={14} />
                      复制
                    </button>
                    <button onClick={() => action(() => api('attention.read', { id: a.id }))}>
                      {a.read ? '已读' : '标为已读'}
                    </button>
                    {a.kind === 'template-input' && !a.detail?.answered && (
                      <TemplateAnswer item={a} action={action} />
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          {section === 'settings' && <SettingsView data={data} action={action} />}
        </main>
        {browserOpen && section !== 'editor' && (
          <BrowserSidebar
            close={() => setBrowserOpen(false)}
            running={!!active && !['PAUSED', 'WAITING_INPUT'].includes(active.state)}
            obscured={section === 'editor' && configOpen}
          />
        )}
      </div>
    </div>
  );
}
function Heading({ title, text }: { title: string; text: string }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">FLOWARK WORKSPACE</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Workflow size={34} strokeWidth={1} />
      <p>{text}</p>
    </div>
  );
}
function Editor({
  record: r,
  setRecord,
  selected,
  setSelected,
  browsers,
  choose,
  revision,
  guardInvalidNodeJson,
  editConfiguration,
  compact,
  panel,
  setPanel,
  browserOpen,
  browserPanel,
}: any) {
  const [tab, setTab] = useState('node');
  const [destination, setDestination] = useState('main');
  const [moveTo, setMoveTo] = useState('');
  const [structureError, setStructureError] = useState('');
  const [raw, setRaw] = useState('');
  const [invalid, setInvalid] = useState('');
  const selectedNode = flatten(r.flow.steps).find((n: Step) => n.id === selected);
  useEffect(() => {
    if (panel === 'params' || panel === 'node') setTab(panel);
  }, [panel]);
  useEffect(() => {
    setRaw(selectedNode ? JSON.stringify(selectedNode, null, 2) : '');
    setInvalid('');
    setMoveTo('');
    setStructureError('');
  }, [selected, revision]);
  const patch = (fn: (n: Step) => Step | null) =>
    setRecord({
      ...r,
      flow: { ...r.flow, steps: changeSteps(r.flow.steps, selected, fn) },
    });
  const structure = (build: () => Step[], nextSelected = selected) => {
    if (!guardInvalidNodeJson()) return false;
    try {
      const steps = build();
      checkStructure(r.flow.steps, steps, r.flow.parameters);
      setRecord({ ...r, flow: { ...r.flow, steps } });
      setSelected(nextSelected);
      setTab('node');
      if (compact) setPanel('node');
      setStructureError('');
      return true;
    } catch (error: any) {
      setStructureError(error.message);
      return false;
    }
  };
  const append = (node: Step, target: Destination) => {
    if (structure(() => insertStep(r.flow.steps, node, target), node.id) && target.side === 'after')
      setDestination(node.id + ':after');
  };
  const duplicate = () => {
    try {
      const result = duplicateStep(r.flow.steps, selected);
      structure(() => result.steps, result.id);
    } catch (error: any) {
      setStructureError(error.message);
    }
  };
  const insertAt = (side: 'before' | 'after') => {
    setDestination(selected + ':' + side);
    setPanel('actions');
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>('[aria-label="搜索动作"]')?.focus(),
    );
  };
  const location = locationOf(r.flow.steps, selected);
  const targets = destinationChoices(r.flow.steps);
  const choices = referenceChoices(r.flow, selected);
  const updateNode = (next: Step) => {
    if (!guardInvalidNodeJson()) return;
    patch(() => next);
    setRaw(JSON.stringify(next, null, 2));
    setInvalid('');
  };
  const updateParameters = (parameters: any) => {
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))
      throw new Error('运行参数必须为对象');
    const before = new Set(
      referenceIssues(r.flow.steps, r.flow.parameters).map((issue) => JSON.stringify(issue)),
    );
    const added = referenceIssues(r.flow.steps, parameters).find(
      (issue) => !before.has(JSON.stringify(issue)),
    );
    if (added) throw new Error(`${added.nodeId} 仍引用 ${added.reference}，请先调整引用`);
    setRecord({ ...r, flow: { ...r.flow, parameters } });
  };
  const { nodes, edges, stepCount } = buildDiagram(r.flow.steps, selected);
  const changePanel = (value: string) => {
    if (guardInvalidNodeJson()) setPanel(value);
  };
  return (
    <div
      className={`editor-region ${compact ? 'is-compact' : ''} ${browserOpen ? 'has-browser' : ''}`}
      data-panel={panel}
      data-selected={!!selectedNode}
    >
      <div className="editor-views" role="group" aria-label="编排视图">
        <button
          aria-pressed={panel === 'graph' || panel === 'canvas'}
          onClick={() => changePanel('graph')}
        >
          全图
        </button>
        <button aria-pressed={panel === 'actions'} onClick={() => changePanel('actions')}>
          动作与结构
        </button>
        <button aria-pressed={panel === 'node'} onClick={() => changePanel('node')}>
          当前步骤配置
        </button>
        <button aria-pressed={panel === 'params'} onClick={() => changePanel('params')}>
          参数
        </button>
        {compact && ['actions', 'node', 'params'].includes(panel) && (
          <button onClick={() => changePanel('canvas')}>应用并关闭</button>
        )}
      </div>
      <div className="editor-workspace">
        <div className="editor-layout">
          <ActionLibrary
            key={r.id}
            steps={r.flow.steps}
            add={append}
            destination={destination}
            setDestination={setDestination}
          />
          <div className="canvas">
            <DiagramCanvas
              key={r.id}
              nodes={nodes}
              edges={edges}
              selected={selected}
              select={(id) => {
                if (!guardInvalidNodeJson()) return;
                setSelected(id);
                setTab('node');
                if (compact) setPanel('node');
              }}
            />
            <div className="canvas-legend" aria-label="流程图图例">
              <span className="legend-decision" />
              条件
              <span className="legend-data" />
              数据
              <span className="legend-manual" />
              人工
            </div>
            <span className="canvas-label">执行流程 · {stepCount} 个步骤</span>
          </div>
          <section className="selected-step-summary" aria-label="当前步骤">
            <h2>
              {selectedNode
                ? (typeof selectedNode.name === 'string' && selectedNode.name) ||
                  kinds[selectedNode.type]?.label
                : '选择一个步骤'}
            </h2>
            <p>
              {selectedNode?.type === 'browser'
                ? typeof selectedNode.selector === 'string'
                  ? selectedNode.selector || '尚未选择网页目标'
                  : '使用变量定位网页目标'
                : '在流程图中选择需要编辑的步骤。'}
            </p>
            <button
              className="primary"
              disabled={!selectedNode}
              onClick={() => changePanel('node')}
            >
              编辑当前步骤
            </button>
            <p>当前步骤保持可见；动作库与配置使用互斥抽屉。</p>
          </section>
          <aside className="inspector">
            <div className="tabs" role="tablist" aria-label="检查器内容">
              {[
                ['node', '节点'],
                ['params', '参数'],
              ].map(([k, t]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => {
                    if (guardInvalidNodeJson()) {
                      setTab(k);
                      if (compact) setPanel(k);
                    }
                  }}
                  className={tab === k ? 'selected' : ''}
                >
                  {t}
                </button>
              ))}
            </div>
            {tab === 'node' &&
              (selectedNode ? (
                <>
                  <fieldset
                    disabled={!!invalid}
                    style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                  >
                    <div className="inspector-heading">
                      <h3>{kinds[selectedNode.type].label}</h3>
                      <button
                        className="icon-button"
                        aria-label="节点上移"
                        title="在当前分支上移"
                        disabled={!location || location.index === 0}
                        onClick={() => structure(() => moveSibling(r.flow.steps, selected, -1))}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="节点下移"
                        title="在当前分支下移"
                        disabled={!location || location.index === location.siblings.length - 1}
                        onClick={() => structure(() => moveSibling(r.flow.steps, selected, 1))}
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="复制节点"
                        title="复制到后面（包含子步骤）"
                        onClick={duplicate}
                      >
                        <Copy size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="删除节点"
                        title="删除步骤（包含子步骤）"
                        onClick={() =>
                          structure(() => changeSteps(r.flow.steps, selected, () => null), '')
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="node-insert-actions" aria-label="步骤插入位置">
                      <button onClick={() => insertAt('before')}>在前面插入</button>
                      <button onClick={() => insertAt('after')}>在后面插入</button>
                    </div>
                    <div className="node-move-actions">
                      <select
                        aria-label="步骤移动位置"
                        value={moveTo}
                        onChange={(event) => setMoveTo(event.target.value)}
                      >
                        <option value="">移动到…</option>
                        {targets.map((target) => (
                          <option key={target.value} value={target.value}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={!moveTo}
                        onClick={() => {
                          const target = targets.find((target) => target.value === moveTo);
                          if (target) structure(() => moveStep(r.flow.steps, selected, target));
                        }}
                      >
                        移动
                      </button>
                    </div>
                    {structureError && (
                      <p className="field-error" role="alert">
                        {structureError}
                      </p>
                    )}
                    <p className="muted">{selectedNode.id} · 修改后保存，下一次运行生效</p>
                    {!['file', 'excel'].includes(selectedNode.type) && (
                      <>
                        <label htmlFor="step-name">步骤名称</label>
                        <input
                          id="step-name"
                          value={typeof selectedNode.name === 'string' ? selectedNode.name : ''}
                          placeholder="便于识别的名称（可选）"
                          onChange={(e) => updateNode({ ...selectedNode, name: e.target.value })}
                        />
                      </>
                    )}
                    <LogicNodeConfiguration
                      key={selectedNode.id + ':logic:' + revision}
                      node={selectedNode}
                      choices={choices}
                      change={updateNode}
                    />
                    {selectedNode.type === 'browser' && (
                      <BrowserNodeConfiguration
                        key={selectedNode.id + ':' + revision}
                        node={selectedNode}
                        choices={choices}
                        change={(next) => {
                          if (!guardInvalidNodeJson()) return;
                          patch(() => next);
                          setRaw(JSON.stringify(next, null, 2));
                          setInvalid('');
                        }}
                      />
                    )}
                    <ResourceNodeConfiguration
                      key={selectedNode.id + ':resource:' + revision}
                      node={selectedNode}
                      choices={choices}
                      change={updateNode}
                      bindings={r.bindings}
                      choose={choose}
                    />
                    {selectedNode.type === 'script' && (
                      <>
                        <label>可信脚本 · 独立进程执行</label>
                        <Suspense fallback={<p>加载编辑器…</p>}>
                          <CodeEditor
                            value={selectedNode.code}
                            language={selectedNode.language === 'ts' ? 'typescript' : 'javascript'}
                            onChange={(code) => {
                              if (!guardInvalidNodeJson()) return;
                              patch((n) => ({ ...n, code }) as Step);
                              setRaw(JSON.stringify({ ...selectedNode, code }, null, 2));
                            }}
                            height="280px"
                          />
                        </Suspense>
                        <ScriptPackages
                          flowId={r.id}
                          node={selectedNode}
                          bindings={r.bindings}
                          bind={(info) => {
                            if (!guardInvalidNodeJson()) return;
                            const conflict = flatten(r.flow.steps).some(
                              (n: Step) =>
                                n.id !== selectedNode.id &&
                                n.type === 'script' &&
                                n.dependencies.some(
                                  (d) => d.name === info.name && d.version !== info.version,
                                ),
                            );
                            if (conflict)
                              throw new Error(
                                '其他节点声明了不同版本，请先统一依赖版本：' + info.name,
                              );
                            const next = {
                              ...selectedNode,
                              dependencies: [
                                ...selectedNode.dependencies.filter(
                                  (d: any) => d.name !== info.name,
                                ),
                                { name: info.name, version: info.version },
                              ],
                            };
                            setRecord({
                              ...r,
                              flow: {
                                ...r.flow,
                                steps: changeSteps(r.flow.steps, selected, () => next),
                              },
                              bindings: {
                                ...r.bindings,
                                scriptPackages: {
                                  ...r.bindings.scriptPackages,
                                  [info.name]: { path: info.path, version: info.version },
                                },
                              },
                            });
                            setRaw(JSON.stringify(next, null, 2));
                            setInvalid('');
                          }}
                          remove={(name) => {
                            if (!guardInvalidNodeJson()) return;
                            const next = {
                              ...selectedNode,
                              dependencies: selectedNode.dependencies.filter(
                                (d: any) => d.name !== name,
                              ),
                            };
                            const steps = changeSteps(r.flow.steps, selected, () => next);
                            const packages = { ...r.bindings.scriptPackages };
                            if (
                              !flatten(steps).some(
                                (n: Step) =>
                                  n.type === 'script' &&
                                  n.dependencies.some((d) => d.name === name),
                              )
                            )
                              delete packages[name];
                            setRecord({
                              ...r,
                              flow: { ...r.flow, steps },
                              bindings: { ...r.bindings, scriptPackages: packages },
                            });
                            setRaw(JSON.stringify(next, null, 2));
                          }}
                        />
                      </>
                    )}
                  </fieldset>
                  <details
                    className="node-advanced"
                    data-value-invalid={invalid || undefined}
                    key={selectedNode.id}
                  >
                    <summary>高级配置 JSON</summary>
                    <label>节点配置 JSON</label>
                    <textarea
                      aria-label="节点配置 JSON"
                      aria-invalid={!!invalid}
                      className="code-input"
                      value={raw}
                      onChange={(e) => {
                        setRaw(e.target.value);
                        try {
                          const value = JSON.parse(e.target.value);
                          if (value.id !== selectedNode.id || value.type !== selectedNode.type)
                            throw new Error('ID 和类型不可在此修改');
                          patch(() => value);
                          setInvalid('');
                        } catch (e: any) {
                          setInvalid(e.message);
                        }
                      }}
                    />
                    {invalid && <p className="field-error">{invalid}</p>}
                    {invalid && (
                      <button
                        type="button"
                        onClick={() => {
                          setRaw(JSON.stringify(selectedNode, null, 2));
                          setInvalid('');
                        }}
                      >
                        恢复节点配置
                      </button>
                    )}
                    <p className="note">
                      显式设置容器 timeoutMs
                      时，超时包含内部等待和暂停；人工节点未配置时不设节点超时。
                    </p>
                    <p className="note">
                      引用示例：<code>{'{"$ref":"steps.greeting.message"}'}</code>
                      。循环体可引用 item 和 index。
                    </p>
                  </details>
                </>
              ) : (
                <Empty text="选择画布节点，编辑参数或脚本。" />
              ))}
            {tab === 'params' && (
              <>
                <h3>运行参数</h3>
                {r.bindings.configuration?.adapter === 'flow-parameters-v1' ? (
                  <TemplateParameters
                    value={r.bindings.configuration.values}
                    edit={editConfiguration}
                  />
                ) : (
                  <>
                    <ParameterConfiguration
                      key={revision}
                      value={r.flow.parameters}
                      change={updateParameters}
                    />
                    <details className="parameters-advanced">
                      <summary>参数 JSON · 高级</summary>
                      <JsonInput
                        key={revision}
                        value={r.flow.parameters}
                        onChange={updateParameters}
                      />
                    </details>
                  </>
                )}
                <label htmlFor="flow-browser-binding">本机浏览器</label>
                <select
                  id="flow-browser-binding"
                  value={r.bindings.browserId ?? ''}
                  onChange={(e) =>
                    setRecord({
                      ...r,
                      bindings: {
                        ...r.bindings,
                        browserId: e.target.value || undefined,
                      },
                    })
                  }
                >
                  <option value="">尚未绑定</option>
                  {browsers.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.product === 'embedded' ? 'FlowArk 内置浏览器' : b.product} {b.version}
                    </option>
                  ))}
                </select>
                {fileBindingNames(r.flow.steps, r.bindings.files, r.flow.parameters).map(
                  (binding) => (
                    <section key={binding} className="file-binding">
                      <label>{binding} 文件目录</label>
                      <p className="path-text">{r.bindings.files[binding] ?? '尚未选择'}</p>
                      <button aria-label={`选择 ${binding} 目录`} onClick={() => choose(binding)}>
                        <FolderOpen size={15} /> 选择目录
                      </button>
                    </section>
                  ),
                )}
                <label>允许脚本读取的凭据</label>
                {['openai-codex', 'deepseek'].map((id) => (
                  <label className="check-label" key={id}>
                    <input
                      type="checkbox"
                      checked={r.bindings.credentials.includes(id)}
                      onChange={(e) =>
                        setRecord({
                          ...r,
                          bindings: {
                            ...r.bindings,
                            credentials: e.target.checked
                              ? [...r.bindings.credentials, id]
                              : r.bindings.credentials.filter((x: string) => x !== id),
                          },
                        })
                      }
                    />
                    {id}
                  </label>
                ))}
                <p className="note">本地绑定不随流程导出。计划使用创建时的固定版本。</p>
              </>
            )}
          </aside>
        </div>
        {browserPanel}
      </div>
    </div>
  );
}
function JsonInput({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [err, setErr] = useState('');
  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(text)) === JSON.stringify(value)) return;
    } catch {}
    setText(JSON.stringify(value, null, 2));
    setErr('');
  }, [JSON.stringify(value)]);
  return (
    <>
      <textarea
        className="code-input small"
        data-value-invalid={err || undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setErr('');
          } catch (error: any) {
            setErr(error.message || 'JSON 格式尚未完成');
          }
        }}
      />
      {err && <small className="field-error">{err}</small>}
    </>
  );
}
function AttentionContent({ detail }: { detail: any }) {
  return (
    <div className="attention-detail">
      <pre>{JSON.stringify(detail, null, 2)}</pre>
    </div>
  );
}
function TemplateAnswer({ item, action }: any) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const send = (value: any) => action(() => api('template.answer', { id: item.id, value }));
  if (item.detail.schema?.type === 'boolean')
    return (
      <>
        <button onClick={() => send(true)}>确认</button>
        <button onClick={() => send(false)}>拒绝</button>
      </>
    );
  return (
    <div>
      <textarea
        aria-label="处理结果 JSON"
        placeholder="输入符合 Schema 的 JSON"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        onClick={() => {
          try {
            const parsed = JSON.parse(value);
            setError('');
            send(parsed);
          } catch {
            setError('请输入有效 JSON');
          }
        }}
      >
        提交结果
      </button>
      <small>{error}</small>
    </div>
  );
}

function RunDetail({
  detail: d,
  fault,
  back,
  control,
  reveal,
  reload,
  open,
}: {
  detail: any;
  fault?: string;
  open: (detail: any) => void;
  reload: () => Promise<void>;
  back: () => void;
  control: (id: string, a: string) => void;
  reveal: (id: string) => void;
}) {
  const r: Run = d.run;
  const observed = { ...d, fault: d.fault ?? fault };
  const presentation = presentRun({ ...observed, output: undefined }, Date.now());
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(r.state);
  const controllable = presentation.activity === 'active' && !presentation.closing;
  const lastSaved =
    !terminal &&
    (Boolean(observed.fault) || (r.state !== 'QUEUED' && presentation.activity !== 'active'));
  const pause = [...d.events].reverse().find((e: Event) => e.type === 'debug-pause');
  const results = d.events.filter((e: Event) => typeof e.data?.outputPreview === 'string');
  return (
    <>
      <div className="section-row run-detail-heading">
        <div className="row">
          <button onClick={back}>
            <ArrowLeft size={15} />
            全部记录
          </button>
          <h2>{r.name}</h2>
          {lastSaved ? (
            <span className="badge state-INTERRUPTED">最后保存：{status[r.state]}</span>
          ) : (
            badge(r.state)
          )}
        </div>
        <div className="row">
          {controllable && !observed.fault && r.state === 'RUNNING' && (
            <button onClick={() => control(r.id, 'pause')}>
              <Pause size={14} />
              步骤后暂停
            </button>
          )}
          {controllable && !observed.fault && ['PAUSED', 'WAITING_INPUT'].includes(r.state) && (
            <button onClick={() => control(r.id, 'resume')}>
              <Play size={14} />
              继续
            </button>
          )}
          {controllable && !observed.fault && r.state === 'PAUSED' && (
            <button onClick={() => control(r.id, 'step')}>执行下一步</button>
          )}
          {!terminal && (controllable || (r.state === 'QUEUED' && !observed.fault)) && (
            <button onClick={() => control(r.id, 'cancel')}>
              <Square size={14} />
              取消
            </button>
          )}
        </div>
      </div>
      <div className="run-meta">
        <span>
          运行 <code>{r.id.slice(0, 8)}</code>
        </span>
        <span>
          不可变版本 <code>{r.versionId.slice(0, 12)}</code>
        </span>
        <span>{format(r.createdAt)}</span>
      </div>
      <RunObservation detail={observed} />
      <RunOutput detail={observed} />
      <p className="note">{r.business}</p>
      <RunRerunPanel run={r} related={d.rerun} open={open} />
      <ArtifactCleanupPanel run={r} cleanup={d.artifactCleanup} changed={reload} />
      {r.debug && (
        <p className="note">逐步调试 · 每次执行下一步会实际操作页面；继续将连续运行剩余流程。</p>
      )}
      {controllable && r.state === 'PAUSED' && pause && (
        <div className="panel" aria-label="调试位置">
          <b>下一步：{pause.data.nodeName}</b>
          <p>
            <code>{pause.nodeInstance}</code>
          </p>
        </div>
      )}
      {r.error && <div className="alert error">{r.error}</div>}
      {results.length > 0 && (
        <section className="panel" aria-label="步骤输出">
          <h3>步骤输出</h3>
          <p className="note">
            显示脱敏后的输出预览，长内容截断；已执行步骤不会因暂停或失败自动重放。
          </p>
          {results.map((e: Event) => (
            <details key={e.sequence} open={e === results.at(-1)}>
              <summary>{e.nodeInstance}</summary>
              <pre>{e.data.outputPreview}</pre>
            </details>
          ))}
        </section>
      )}
      {d.scriptBundles?.length > 0 && (
        <details className="script-bundles">
          <summary>已固定的脚本与依赖 · {d.scriptBundles.length} 个节点</summary>
          {d.scriptBundles.map((bundle: any) => (
            <div key={bundle.nodeId}>
              <p>
                <b>{bundle.nodeId}</b> ·{' '}
                {bundle.dependencies.length
                  ? bundle.dependencies.map((dep: any) => dep.name + '@' + dep.version).join('，')
                  : '仅使用脚本及 Node 内置能力'}
              </p>
              <code className="path-text">SHA-256 {bundle.sha256}</code>
            </div>
          ))}
        </details>
      )}
      <div className="event-list">
        {d.events.map((e: Event) => (
          <div key={e.sequence}>
            <span className="event-index">{String(e.sequence).padStart(2, '0')}</span>
            <span className="event-dot" />
            <time>{format(e.time)}</time>
            <b>{e.type}</b>
            <code>{e.nodeInstance}</code>
            <pre>{JSON.stringify(e.data)}</pre>
          </div>
        ))}
      </div>
      {d.artifacts.length > 0 && (
        <>
          <h3>运行产物</h3>
          {d.artifacts.map((a: any) => (
            <div key={a.artifactId} className="row artifact-row" data-artifact-id={a.artifactId}>
              <div className="artifact-description">
                <p>
                  {a.name} · {a.size} 字节
                </p>
                <span className={!a.available ? 'field-error' : undefined}>
                  {a.integrity === 'cleared'
                    ? '已清理'
                    : a.integrity === 'verified'
                      ? '已保存副本'
                      : a.integrity === 'changed'
                        ? '副本内容已改动'
                        : a.integrity === 'unverified'
                          ? '旧记录，未保存副本'
                          : '文件已移动、删除或不可访问'}
                </span>
                <p className="path-text">{a.path}</p>
              </div>
              <button disabled={!a.available} onClick={() => reveal(a.artifactId)}>
                {a.storage === 'snapshot-v1' ? '定位副本' : '定位当前文件'}
              </button>
            </div>
          ))}
        </>
      )}
    </>
  );
}
function SettingsView({ data, action }: any) {
  const [candidates, setCandidates] = useState<any[]>([]),
    [provider, setProvider] = useState('openai-codex'),
    [key, setKey] = useState(''),
    [model, setModel] = useState('gpt-5.3-codex');
  return (
    <div className="page settings-page">
      <Heading title="连接你的本机能力" text="选择内置或本机浏览器，配置自己的 AI 接口。" />
      <EmbeddedBrowserPanel
        enabled={data.browsers.some((b: any) => b.product === 'embedded')}
        action={action}
      />
      <section className="panel">
        <div className="section-row">
          <div className="row">
            <Globe size={22} />
            <h2>本机浏览器</h2>
          </div>
          <div className="row">
            <button
              onClick={() => action(async () => setCandidates(await api('browser.discover')))}
            >
              发现已安装浏览器
            </button>
            <button
              onClick={() =>
                action(async () => {
                  const path = await api('file.choose', { kind: 'browser' });
                  if (path) await api('browser.bind', { path });
                })
              }
            >
              手动选择
            </button>
          </div>
        </div>
        <p>使用专用自动化会话。Chrome 为首个验证目标，Firefox / Safari 的兼容结果单独记录。</p>
        {[
          ...data.browsers.filter((b: any) => b.product !== 'embedded'),
          ...candidates.filter((c) => !data.browsers.some((b: any) => b.id === c.id)),
        ].map((b) => (
          <div className="browser-row" key={b.id}>
            <span className="icon-tile">
              <Globe size={19} />
            </span>
            <div>
              <b>
                {b.product} <span className="muted">{b.version}</span>
              </b>
              <small>{b.executable}</small>
            </div>
            {data.browsers.some((x: any) => x.id === b.id) ? (
              <span className="badge">已绑定</span>
            ) : (
              <button
                onClick={() =>
                  action(() => api('browser.bind', { path: b.executable }), '浏览器已绑定')
                }
              >
                绑定此浏览器
              </button>
            )}
            {b.product === 'firefox' && (
              <button
                onClick={() =>
                  action(async () => {
                    const driver = await api('file.choose', { kind: 'driver' });
                    if (driver) await api('browser.bind', { path: b.executable, driver });
                  })
                }
              >
                选择驱动
              </button>
            )}
          </div>
        ))}
        {!data.browsers.length && !candidates.length && (
          <div className="note">尚未绑定浏览器。纯数据流程可以直接运行。</div>
        )}
      </section>
      <section className="panel">
        <div className="row">
          <ShieldCheck size={22} />
          <h2>AI 与安全存储</h2>
        </div>
        <p>密钥由 macOS 安全存储保护，只显示配置状态。API 调用需要你的独立 API Key。</p>
        <div className="form-grid">
          <label>
            Provider
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel(e.target.value === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex');
                setKey('');
              }}
            >
              <option value="openai-codex">Codex · OpenAI Responses</option>
              <option value="deepseek">DeepSeek · Chat Completions</option>
            </select>
          </label>
          <label>
            模型 ID
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label>
            API Key{' '}
            <span className="muted">
              {data.credentials.includes(provider) ? '已安全保存' : '未配置'}
            </span>
            <input
              type="password"
              autoComplete="off"
              value={key}
              placeholder="输入或替换 API Key"
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <div className="row">
            <button
              className="primary"
              disabled={!key}
              onClick={() =>
                action(async () => {
                  await api('credentials.set', { id: provider, value: key });
                  setKey('');
                }, '密钥已安全保存')
              }
            >
              保存密钥
            </button>
            <button
              disabled={!data.credentials.includes(provider)}
              onClick={() =>
                action(() => api('ai.test', { provider, model }), 'AI 连通及草稿格式测试通过')
              }
            >
              验证接口
            </button>
          </div>
        </div>
        <p className="note">验证接口使用虚构事实，会发起一次真实 API 请求。不自动切换供应商。</p>
      </section>
      <section className="panel">
        <h2>本地数据</h2>
        <p className="path-text">{data.dataPath || '正在初始化安全存储…'}</p>
        <button onClick={() => action(() => api('app.showData'))}>
          <FolderOpen size={15} />
          打开数据目录
        </button>
        <p>关闭窗口后保留托盘和本机计划；选择「退出 FlowArk」后停止执行与调度。</p>
      </section>
    </div>
  );
}
