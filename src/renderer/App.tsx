import { useState, useEffect, useCallback, useReducer, useRef, lazy, Suspense } from 'react';
import { version as appVersion } from '../../package.json';
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
} from 'lucide-react';
import type { Bootstrap, FlowRecord, Step, Run, Event, Template } from '../shared/types';
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
  credentials: [],
  dataPath: '',
};
const api = (method: string, args: any = {}) => window.flowark.request(method, args);
const status: Record<string, string> = runStateLabels;
const actions: Record<string, string> = {
  apply: '投递 / 发起沟通',
  resume: '发送指定简历',
  reply: 'AI 回复',
  requestWechat: '请求微信',
  acceptWechat: '接受微信',
  requestPhone: '请求手机号',
  acceptPhone: '接受手机号',
};
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
    [query, setQuery] = useState(''),
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
    inputGroup.current = undefined;
    dispatchDraft({ type: 'open', record: r });
    setSection('editor');
    setDetail(null);
  }
  async function create(templateId?: string) {
    if (!guardInvalidNodeJson()) return;
    const r = await action(() => api('flow.create', { templateId }));
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
  return (
    <div className={`app ${browserOpen ? 'with-browser' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            F<span>↗</span>
          </span>
          <div>
            FlowArk<small>序舟 · 本地自动化</small>
          </div>
        </div>
        <div className="workspace-label">
          个人工作空间 <span>LOCAL</span>
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
              onClick={() => {
                if (!guardInvalidNodeJson()) return;
                setSection(id);
                setDetail(null);
              }}
            >
              <Icon size={18} />
              {label}
              {id === 'inbox' && unread > 0 && <b>{unread}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-dot" />
          单机运行 <span>{appVersion}</span>
          <p>流程与历史保存在这台 Mac 上</p>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            工作空间 <ChevronRight size={14} />{' '}
            {section === 'editor' ? '流程编辑' : nav.find((n) => n[0] === section)?.[1]}
          </div>
          <button
            className="embedded-show"
            aria-pressed={browserOpen}
            onClick={() => setBrowserOpen(!browserOpen)}
          >
            <Globe size={15} /> {browserOpen ? '收起网页面板' : '打开网页面板'}
          </button>
          <span className="machine">
            <span className="local-dot" />
            {data.fault
              ? '存储异常'
              : data.runtimeBlock
                ? '执行已停止'
                : active
                  ? observedActive?.phase === 'closing'
                    ? '任务收尾中'
                    : '任务运行中'
                  : data.execution
                    ? '本机已就绪'
                    : '正在读取执行状态'}
          </span>
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
          <div className="page">
            <div className="page-heading">
              <div>
                <span className="eyebrow">AUTOMATE YOUR EVERYDAY</span>
                <h1>
                  让流程接手重复工作<span className="heading-dot">.</span>
                </h1>
                <p>创建、编排与执行，每一步都在你的掌控之中。</p>
              </div>
              <button className="primary" onClick={() => create()} disabled={busy}>
                <Plus size={17} />
                新建流程
              </button>
            </div>
            <div className="overview">
              <div>
                <span>本地流程</span>
                <strong>{data.flows.length.toString().padStart(2, '0')}</strong>
                <small>独立保存 · 随时编辑</small>
              </div>
              <div>
                <span>当前任务</span>
                <strong>{active ? '01' : data.execution ? '00' : '—'}</strong>
                <small>
                  {active
                    ? active.name + (observedActive?.phase === 'closing' ? ' · 正在收尾' : '')
                    : data.fault || data.runtimeBlock
                      ? '已停止接收新任务，请查看上方提示'
                      : data.execution
                        ? '运行槽空闲，可以开始新任务'
                        : '当前执行情况尚未确定'}
                  {data.runOverview.queued > 0 && ` · ${data.runOverview.queued} 个排队中`}
                </small>
              </div>
              <div>
                <span>待处理事项</span>
                <strong>{unread.toString().padStart(2, '0')}</strong>
                <small>查看结果、处理待办</small>
              </div>
              <div className="overview-art">
                <Workflow size={64} strokeWidth={1} />
                <span>
                  ONE FLOW.
                  <br />
                  LESS BUSYWORK.
                </span>
              </div>
            </div>
            <div className="section-row">
              <h2>
                我的流程 <span>{data.flows.length}</span>
              </h2>
              <div className="row">
                <div className="search">
                  <Search size={15} />
                  <input
                    placeholder="搜索流程"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <button onClick={() => action(() => api('flow.import'), '模板已导入为独立草稿')}>
                  <Upload size={15} />
                  导入
                </button>
              </div>
            </div>
            <div className="flow-grid">
              {data.flows
                .filter((f) => f.flow.name.includes(query))
                .map((r) => (
                  <FlowCard
                    key={r.id}
                    record={r}
                    run={data.runOverview.latest.find((x) => x.flowId === r.id)}
                    onEdit={() => openFlow(r)}
                    onRun={() => run(r)}
                  />
                ))}
              <button className="new-flow" onClick={() => create()}>
                <Plus />
                <b>从一个想法开始</b>
                <span>将日常步骤编排为自动化流程</span>
              </button>
            </div>
            <div className="intro-strip">
              <span className="icon-tile">
                <LayoutTemplate />
              </span>
              <div>
                <b>从招聘模板开始</b>
                <p>BOSS 直聘与智联招聘模板，可独立配置简历与动作权限。</p>
              </div>
              <button onClick={() => setSection('templates')}>
                浏览模板 <ArrowUpRight size={16} />
              </button>
            </div>
          </div>
        )}
        {section === 'templates' && (
          <div className="page">
            <Heading title="从模板出发" text="创建独立流程，自行绑定本机浏览器、简历与 AI。" />
            <div className="flow-grid">
              {data.templates.map((t) => (
                <TemplateCard key={t.manifest.id} t={t} create={() => create(t.manifest.id)} />
              ))}
            </div>
            <div className="note">
              模板创建后不会自动运行。两站真实网页适配和业务闭环仍待验证，外发默认需要确认。
            </div>
          </div>
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
              <button
                className="icon-button"
                onClick={() => {
                  if (guardInvalidNodeJson()) setSection('flows');
                }}
                aria-label="返回流程"
              >
                <ArrowLeft size={18} />
              </button>
              <input
                className="title-input"
                value={edit.flow.name}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    flow: { ...edit.flow, name: e.target.value },
                  })
                }
              />
              <span className="muted">本地草稿</span>
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
              <div className="spacer" />
              {edit.bindings.configuration && (
                <button
                  onClick={() => {
                    if (guardInvalidNodeJson()) setConfigOpen(true);
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
                <Download size={15} />
                导出
              </button>
              <button onClick={save} disabled={busy}>
                <Save size={15} />
                保存
              </button>
              <button className="primary" onClick={() => run(edit)} disabled={busy}>
                <Play size={15} />
                运行
              </button>
              <button onClick={() => run(edit, true)} disabled={busy}>
                <Pause size={15} />
                逐步调试
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
              editConfiguration={() => {
                if (guardInvalidNodeJson()) setConfigOpen(true);
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
                  setDetail((current: any) => (current?.run.id === detail.run.id ? next : current))
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
              <Empty text="目前没有待办。取得实际微信号后，会在这里提醒。" />
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
                  {a.detail?.actionState === 'PENDING_CONFIRMATION' && (
                    <button
                      className="primary"
                      onClick={() =>
                        action(
                          () =>
                            api('action.confirm', {
                              id: a.detail.actionId,
                              policyHash: a.detail.policyHash,
                            }),
                          '已确认具体内容，下一轮运行将重新核对账号和会话',
                        )
                      }
                    >
                      确认此动作
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
        {section === 'settings' && <SettingsView data={data} action={action} />}
      </main>
      {browserOpen && (
        <BrowserSidebar
          close={() => setBrowserOpen(false)}
          running={!!active && !['PAUSED', 'WAITING_INPUT'].includes(active.state)}
          obscured={section === 'editor' && configOpen}
        />
      )}
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
function FlowCard({
  record: r,
  run,
  onEdit,
  onRun,
}: {
  record: FlowRecord;
  run?: Run;
  onEdit: () => void;
  onRun: () => void;
}) {
  return (
    <article className="flow-card">
      <div className="card-top">
        <span className="icon-tile">
          <Workflow size={22} />
        </span>
        {run ? badge(run.state) : <span className="badge">未运行</span>}
        <button className="icon-button" onClick={onEdit} aria-label={'编辑 ' + r.flow.name}>
          <ArrowUpRight size={18} />
        </button>
      </div>
      <h3 onClick={onEdit}>{r.flow.name}</h3>
      <p>{r.flow.description || '你的下一个自动化流程'}</p>
      <div className="mini-flow">
        {r.flow.steps.slice(0, 5).map((s, i) => {
          const Icon = kinds[s.type]?.icon ?? Workflow;
          return (
            <span key={s.id}>
              <i>
                <Icon size={14} />
              </i>
              {i < Math.min(4, r.flow.steps.length - 1) && <em>—</em>}
            </span>
          );
        })}
      </div>
      <footer>
        <span>
          {flatten(r.flow.steps).length} 个节点 · {r.flow.sourceTemplate ? '来自模板' : '自建流程'}
        </span>
        <button onClick={onRun}>
          <Play size={13} />
          运行
        </button>
      </footer>
    </article>
  );
}
function TemplateCard({ t, create }: { t: Template; create: () => void }) {
  return (
    <article className="template-card">
      <span className="template-logo">
        <LayoutTemplate size={25} />
      </span>
      <span className="badge">本地模板 · v{t.manifest.version}</span>
      <h3>{t.flow.name}</h3>
      <p>{t.flow.description}</p>
      <div className="tags">
        <span>{t.manifest.requiredCapabilities.length} 项能力</span>
        <span>{t.manifest.source}</span>
      </div>
      <button className="primary" onClick={create}>
        <Plus size={15} />
        使用模板
      </button>
    </article>
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
}: any) {
  const [tab, setTab] = useState('node');
  const [destination, setDestination] = useState('main');
  const [moveTo, setMoveTo] = useState('');
  const [structureError, setStructureError] = useState('');
  const [raw, setRaw] = useState('');
  const [invalid, setInvalid] = useState('');
  const selectedNode = flatten(r.flow.steps).find((n: Step) => n.id === selected);
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
    document.querySelector<HTMLInputElement>('[aria-label="搜索动作"]')?.focus();
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
  return (
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
      <aside className="inspector">
        <div className="tabs">
          {[
            ['node', '节点'],
            ['params', '参数与绑定'],
          ].map(([k, t]) => (
            <button
              key={k}
              onClick={() => {
                if (guardInvalidNodeJson()) setTab(k);
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
                          throw new Error('其他节点声明了不同版本，请先统一依赖版本：' + info.name);
                        const next = {
                          ...selectedNode,
                          dependencies: [
                            ...selectedNode.dependencies.filter((d: any) => d.name !== info.name),
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
                              n.type === 'script' && n.dependencies.some((d) => d.name === name),
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
                open={selectedNode.type === 'recruiting'}
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
                  显式设置容器 timeoutMs 时，超时包含内部等待和暂停；人工节点未配置时不设节点超时。
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
                  <JsonInput key={revision} value={r.flow.parameters} onChange={updateParameters} />
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
            {fileBindingNames(r.flow.steps, r.bindings.files, r.flow.parameters).map((binding) => (
              <section key={binding} className="file-binding">
                <label>{binding} 文件目录</label>
                <p className="path-text">{r.bindings.files[binding] ?? '尚未选择'}</p>
                <button aria-label={`选择 ${binding} 目录`} onClick={() => choose(binding)}>
                  <FolderOpen size={15} /> 选择目录
                </button>
              </section>
            ))}
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
function AttentionContent({ detail: d }: { detail: any }) {
  const p = d.proposal ?? d;
  if (p.company || p.contact || p.content || p.value)
    return (
      <div className="attention-detail">
        <p>
          {p.platform === 'boss' ? 'BOSS 直聘' : p.platform === 'zhaopin' ? '智联招聘' : ''} ·{' '}
          {p.company} · {p.job}
        </p>
        {p.contact && <p>联系人：{p.contact}</p>}
        {p.account && <p>使用账号：{p.account}</p>}
        {p.target && <p>职位 / 会话：{p.target}</p>}
        {p.jobSnapshot && (
          <div className="job-evidence">
            <p>
              城市：{p.jobSnapshot.city ?? '未明确'} · 工作方式：
              {(
                { onsite: '现场办公', hybrid: '混合办公', remote: '远程办公' } as Record<
                  string,
                  string
                >
              )[p.jobSnapshot.workMode] ?? '未明确'}
            </p>
            <p>
              页面薪资：
              {p.jobSnapshot.salary
                ? `${p.jobSnapshot.salary.minimum}–${p.jobSnapshot.salary.maximum} ${p.jobSnapshot.salary.currency} / ${({ month: '月', year: '年', day: '天', hour: '小时' } as Record<string, string>)[p.jobSnapshot.salary.period]}`
                : '未明确'}
            </p>
            <p className="path-text">岗位来源：{p.jobSnapshot.source}</p>
            {p.jobSnapshot.observedAt && (
              <small>读取时间：{format(p.jobSnapshot.observedAt)}</small>
            )}
          </div>
        )}
        {p.content && (
          <>
            <b>{actions[p.kind] ?? '拟发送内容'}</b>
            <pre>{p.content}</pre>
          </>
        )}
        {p.sharedValue && <p>将分享：{p.sharedValue}</p>}
        {p.value && (
          <p>
            {p.kind === 'wechat' ? '微信号' : '手机号'}：<strong>{p.value}</strong>
          </p>
        )}
        {p.source && <small>来源：{p.source}</small>}
        {d.reason && <p>{d.reason}</p>}
        {d.actionState === 'READY' && <p>已确认，等待下一轮核对并执行</p>}
        {d.actionState === 'UNKNOWN' && <p>结果未知，请先在原页面人工核对</p>}
      </div>
    );
  return <pre>{d.reason ?? d.reasons?.join('；') ?? JSON.stringify(d, null, 2)}</pre>;
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
