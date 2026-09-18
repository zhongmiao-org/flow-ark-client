import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { version as appVersion } from '../../package.json';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import { buildDiagram } from './flow-diagram';
import { flowNodeTypes, flowEdgeTypes, FitDiagram } from './FlowNode';
import { kinds } from './node-kinds';
import '@xyflow/react/dist/style.css';
import {
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
import { fileBindingNames } from './file-bindings';
import BrowserNodeConfiguration from './BrowserNodeConfiguration';
const CodeEditor = lazy(() => import('./CodeEditor'));
const initial: Bootstrap = {
  flows: [],
  runs: [],
  browsers: [],
  schedules: [],
  attention: [],
  templates: [],
  credentials: [],
  dataPath: '',
};
const api = (method: string, args: any = {}) => window.flowark.request(method, args);
const status: Record<string, string> = {
  QUEUED: '排队中',
  RUNNING: '正在运行',
  PAUSED: '已暂停',
  WAITING_INPUT: '等待人工',
  CANCELLING: '正在取消',
  CANCELLED: '已取消',
  INTERRUPTED: '已中断',
  SUCCEEDED: '执行完成',
  FAILED: '执行失败',
};
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
function newStep(type: string): Step {
  const defaults: Record<string, object> = {
    value: { value: '你好，序舟' },
    assert: { actual: true, operator: 'equals', expected: true },
    http: {
      url: 'https://example.com',
      method: 'GET',
      headers: {},
      body: null,
    },
    script: {
      language: 'ts',
      code: 'export default async ({ input, logger, progress }) => {\n  logger.info("开始处理");\n  progress(1, 1);\n  return input;\n};',
      input: {},
      dependencies: [],
    },
    file: {
      operation: 'write',
      binding: 'workspace',
      name: 'result.txt',
      content: '示例',
    },
    excel: {
      operation: 'write',
      binding: 'workspace',
      name: 'result.xlsx',
      rows: [
        ['名称', '数量'],
        ['示例', 1],
      ],
    },
    browser: {
      version: 2,
      framePath: [],
      operation: 'navigate',
      selector: '',
      value: 'https://example.com',
    },
    human: { message: '请完成当前操作后点击继续' },
    condition: {
      actual: true,
      operator: 'equals',
      expected: true,
      then: [],
      else: [],
    },
    loop: { items: [1, 2, 3], body: [] },
    recruiting: { platform: 'boss', batchLimit: 5 },
  };
  if (!defaults[type]) throw new Error('未知节点类型');
  return {
    id: 'n_' + uid().slice(0, 8),
    type,
    version: 1,
    ...structuredClone(defaults[type]),
  } as Step;
}

function flatten(steps: Step[]): Step[] {
  return steps.flatMap((n) => [
    n,
    ...(n.type === 'condition'
      ? [...flatten(n.then), ...flatten(n.else)]
      : n.type === 'loop'
        ? flatten(n.body)
        : []),
  ]);
}
function changeSteps(steps: Step[], id: string, fn: (n: Step) => Step | null): Step[] {
  return steps.flatMap((n) => {
    if (n.id === id) {
      const changed = fn(n);
      return changed ? [changed] : [];
    }
    return [
      n.type === 'condition'
        ? {
            ...n,
            then: changeSteps(n.then, id, fn),
            else: changeSteps(n.else, id, fn),
          }
        : n.type === 'loop'
          ? { ...n, body: changeSteps(n.body, id, fn) }
          : n,
    ];
  });
}
function moveStep(steps: Step[], id: string, direction: number): Step[] {
  const index = steps.findIndex((step) => step.id === id);
  if (index >= 0) {
    const next = index + direction;
    if (next < 0 || next >= steps.length) return steps;
    const result = [...steps];
    [result[index], result[next]] = [result[next], result[index]];
    return result;
  }
  return steps.map((step) =>
    step.type === 'condition'
      ? {
          ...step,
          then: moveStep(step.then, id, direction),
          else: moveStep(step.else, id, direction),
        }
      : step.type === 'loop'
        ? { ...step, body: moveStep(step.body, id, direction) }
        : step,
  );
}
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
    [edit, setEdit] = useState<FlowRecord | null>(null),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [configOpen, setConfigOpen] = useState(false);
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
    const timer = setInterval(
      async () => setDetail(await api('run.detail', { id: detail.run.id })),
      1500,
    );
    return () => clearInterval(timer);
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
    setConfigOpen(false);
    setEdit(structuredClone(r));
    setSelected('');
    setSection('editor');
    setDetail(null);
  }
  async function create(templateId?: string) {
    const r = await action(() => api('flow.create', { templateId }));
    if (r) void openFlow(r);
  }
  async function save() {
    if (edit)
      return action(
        () => api('flow.save', { flow: edit.flow, bindings: edit.bindings }),
        '已保存本地草稿',
      );
  }
  async function run(r: FlowRecord, debug = false) {
    await action(async () => {
      await api('flow.save', { flow: r.flow, bindings: r.bindings });
      const run = await api('flow.run', { id: r.id, debug });
      setDetail(await api('run.detail', { id: run.id }));
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
  const active = data.runs.find((r) =>
    ['RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(r.state),
  );
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
              className={
                section === id || (section === 'editor' && id === 'flows') ? 'selected' : ''
              }
              onClick={() => {
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
            {data.fault ? '存储异常' : active ? '任务运行中' : '本机已就绪'}
          </span>
        </header>
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
                <span>正在执行</span>
                <strong>{active ? '01' : '00'}</strong>
                <small>{active ? active.name : '运行槽空闲，可以开始新任务'}</small>
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
                    run={data.runs.find((x) => x.flowId === r.id)}
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
          <div className="editor-page">
            <div className="editor-toolbar">
              <button
                className="icon-button"
                onClick={() => setSection('flows')}
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
              <div className="spacer" />
              {edit.bindings.configuration && (
                <button onClick={() => setConfigOpen(true)}>
                  <Settings size={15} />
                  实例配置
                </button>
              )}
              <button
                onClick={() => action(() => api('flow.export', { id: edit.id, reviewed: true }))}
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
                configuration={edit.bindings.configuration}
                name={edit.flow.name}
                close={() => setConfigOpen(false)}
                apply={async (values) => {
                  const next = {
                    ...edit,
                    bindings: {
                      ...edit.bindings,
                      configuration: { ...edit.bindings.configuration!, values },
                    },
                  };
                  const saved = await action(
                    () => api('flow.save', { flow: next.flow, bindings: next.bindings }),
                    '已保存实例配置',
                  );
                  if (saved) setEdit(saved);
                  return Boolean(saved);
                }}
              />
            )}
            <Editor
              record={edit}
              setRecord={setEdit}
              selected={selected}
              setSelected={setSelected}
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
            {detail ? (
              <RunDetail
                detail={detail}
                back={() => setDetail(null)}
                control={(id, a) => action(() => api('run.control', { id, action: a }))}
                reveal={(id) => action(() => api('artifact.reveal', { id }))}
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>流程</th>
                      <th>状态</th>
                      <th>触发方式</th>
                      <th>开始时间</th>
                      <th>版本快照</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <b>{r.name}</b>
                          <small>{r.id.slice(0, 8)}</small>
                        </td>
                        <td>{badge(r.state)}</td>
                        <td>{r.source === 'manual' ? '手动' : '本机计划'}</td>
                        <td>{format(r.createdAt)}</td>
                        <td>
                          <code>{r.versionId.slice(0, 10)}</code>
                        </td>
                        <td>
                          <button
                            onClick={() =>
                              action(async () => setDetail(await api('run.detail', { id: r.id })))
                            }
                          >
                            查看 <ChevronRight size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.runs.length && <Empty text="还没有运行记录。试着运行「第一个流程」。" />}
              </div>
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
function Editor({ record: r, setRecord, selected, setSelected, browsers, choose }: any) {
  const [tab, setTab] = useState('node');
  const [type, setType] = useState('value');
  const [raw, setRaw] = useState('');
  const [invalid, setInvalid] = useState('');
  const selectedNode = flatten(r.flow.steps).find((n: Step) => n.id === selected);
  useEffect(() => {
    setRaw(selectedNode ? JSON.stringify(selectedNode, null, 2) : '');
    setInvalid('');
  }, [selected]);
  const patch = (fn: (n: Step) => Step | null) =>
    setRecord({
      ...r,
      flow: { ...r.flow, steps: changeSteps(r.flow.steps, selected, fn) },
    });
  const append = (branch?: string) => {
    const n = newStep(type);
    if (branch && selectedNode) {
      patch((old) => ({ ...old, [branch]: [...(old as any)[branch], n] }));
    } else setRecord({ ...r, flow: { ...r.flow, steps: [...r.flow.steps, n] } });
    setSelected(n.id);
  };
  const { nodes, edges, stepCount } = buildDiagram(r.flow.steps, selected);
  const layoutKey = nodes.map((n) => `${n.id}:${n.position.x}:${n.position.y}`).join('|');
  return (
    <div className="editor-layout">
      <aside className="node-library">
        <span className="eyebrow">节点库</span>
        {Object.entries(kinds)
          .filter(([key]) => key !== 'recruiting')
          .map(([key, { label, icon: Icon }]) => (
            <button
              className={type === key ? 'selected' : ''}
              key={key}
              onClick={() => setType(key)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        <button className="primary" onClick={() => append()}>
          <Plus size={15} />
          添加到主流程
        </button>
        {selectedNode?.type === 'condition' && (
          <>
            <button onClick={() => append('then')}>添加到成立分支</button>
            <button onClick={() => append('else')}>添加到否则分支</button>
          </>
        )}
        {selectedNode?.type === 'loop' && (
          <button onClick={() => append('body')}>添加到循环体</button>
        )}
        <p>显式分支和串行循环，按步骤顺序执行。</p>
      </aside>
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
          edgeTypes={flowEdgeTypes}
          deleteKeyCode={null}
          onNodeClick={(_e, n) => {
            if (!n.data.step) return;
            setSelected(n.id);
            setTab('node');
          }}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          nodesConnectable={false}
          minZoom={0.15}
          elementsSelectable
        >
          <Background gap={22} color="#d7e0de" />
          <Controls showInteractive={false} />
          <FitDiagram layoutKey={layoutKey} />
        </ReactFlow>
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
            <button key={k} onClick={() => setTab(k)} className={tab === k ? 'selected' : ''}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'node' &&
          (selectedNode ? (
            <>
              <div className="inspector-heading">
                <h3>{kinds[selectedNode.type].label}</h3>
                <button
                  className="icon-button"
                  aria-label="节点上移"
                  onClick={() =>
                    setRecord({
                      ...r,
                      flow: { ...r.flow, steps: moveStep(r.flow.steps, selected, -1) },
                    })
                  }
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="节点下移"
                  onClick={() =>
                    setRecord({
                      ...r,
                      flow: { ...r.flow, steps: moveStep(r.flow.steps, selected, 1) },
                    })
                  }
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="删除节点"
                  onClick={() => {
                    patch(() => null);
                    setSelected('');
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <p className="muted">{selectedNode.id} · 修改后保存，下一次运行生效</p>
              {selectedNode.type === 'browser' && (
                <BrowserNodeConfiguration
                  key={selectedNode.id}
                  node={selectedNode}
                  change={(next) => {
                    patch(() => next);
                    setRaw(JSON.stringify(next, null, 2));
                    setInvalid('');
                  }}
                />
              )}
              {(selectedNode.type === 'file' || selectedNode.type === 'excel') && (
                <>
                  <label htmlFor="file-operation">操作</label>
                  <select
                    id="file-operation"
                    value={selectedNode.operation}
                    onChange={(e) => {
                      const operation = e.target.value;
                      const isExcel = selectedNode.type === 'excel';
                      const extra = isExcel
                        ? operation === 'fill'
                          ? {
                              version: 2,
                              name: 'filled.xlsx',
                              templateName: 'template.xlsx',
                              sheet: '',
                              cells: { A1: '示例' },
                            }
                          : { version: 1, name: 'result.xlsx', rows: [] }
                        : operation === 'archive'
                          ? { version: 2, name: 'archive.zip', files: ['result.txt'] }
                          : {
                              version: 1,
                              name: 'result.txt',
                              content: operation === 'copy' ? 'source.txt' : '',
                            };
                      const next = {
                        id: selectedNode.id,
                        type: selectedNode.type,
                        binding: selectedNode.binding,
                        ...(selectedNode.timeoutMs ? { timeoutMs: selectedNode.timeoutMs } : {}),
                        operation,
                        ...extra,
                      } as Step;
                      patch(() => next);
                      setRaw(JSON.stringify(next, null, 2));
                      setInvalid('');
                    }}
                  >
                    <option value="read">读取</option>
                    <option value="write">写入</option>
                    {selectedNode.type === 'excel' ? (
                      <option value="fill">填充工作簿模板</option>
                    ) : (
                      <>
                        <option value="copy">复制文件</option>
                        <option value="archive">归档为 ZIP</option>
                      </>
                    )}
                  </select>
                </>
              )}
              {selectedNode.type === 'script' && (
                <>
                  <label>可信脚本 · 独立进程执行</label>
                  <Suspense fallback={<p>加载编辑器…</p>}>
                    <CodeEditor
                      value={selectedNode.code}
                      language={selectedNode.language === 'ts' ? 'typescript' : 'javascript'}
                      onChange={(code) => {
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
                        flow: { ...r.flow, steps: changeSteps(r.flow.steps, selected, () => next) },
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
                      const next = {
                        ...selectedNode,
                        dependencies: selectedNode.dependencies.filter((d: any) => d.name !== name),
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
              <label>节点配置 JSON</label>
              <textarea
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
              <p className="note">
                引用示例：<code>{'{"$ref":"steps.greeting.message"}'}</code>
                。循环体可引用 item 和 index。
              </p>
            </>
          ) : (
            <Empty text="选择画布节点，编辑参数或脚本。" />
          ))}
        {tab === 'params' && (
          <>
            <h3>运行参数</h3>
            <JsonInput
              value={r.flow.parameters}
              onChange={(parameters) => setRecord({ ...r, flow: { ...r.flow, parameters } })}
            />
            <label>本机浏览器</label>
            <select
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
            {fileBindingNames(r.flow.steps, r.bindings.files).map((binding) => (
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
  return (
    <>
      <textarea
        className="code-input small"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setErr('');
          } catch {
            setErr('JSON 格式尚未完成');
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
  back,
  control,
  reveal,
}: {
  detail: any;
  back: () => void;
  control: (id: string, a: string) => void;
  reveal: (id: string) => void;
}) {
  const r: Run = d.run;
  const pause = [...d.events].reverse().find((e: Event) => e.type === 'debug-pause');
  const results = d.events.filter((e: Event) => typeof e.data?.outputPreview === 'string');
  return (
    <>
      <div className="section-row">
        <div className="row">
          <button onClick={back}>
            <ArrowLeft size={15} />
            全部记录
          </button>
          <h2>{r.name}</h2>
          {badge(r.state)}
        </div>
        <div className="row">
          {r.state === 'RUNNING' && (
            <button onClick={() => control(r.id, 'pause')}>
              <Pause size={14} />
              步骤后暂停
            </button>
          )}
          {['PAUSED', 'WAITING_INPUT'].includes(r.state) && (
            <button onClick={() => control(r.id, 'resume')}>
              <Play size={14} />
              继续
            </button>
          )}
          {r.state === 'PAUSED' && (
            <button onClick={() => control(r.id, 'step')}>执行下一步</button>
          )}
          {!['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(r.state) && (
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
      <p className="note">{r.business}</p>
      {r.debug && (
        <p className="note">逐步调试 · 每次执行下一步会实际操作页面；继续将连续运行剩余流程。</p>
      )}
      {r.state === 'PAUSED' && pause && (
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
            <div key={a.artifactId} className="row">
              <p className="path-text">
                {a.name} · {a.size} 字节 · {a.path}
                {!a.available && <span className="field-error"> · 文件已移动、删除或不可访问</span>}
              </p>
              <button disabled={!a.available} onClick={() => reveal(a.artifactId)}>
                在文件夹中显示
              </button>
            </div>
          ))}
        </>
      )}
    </>
  );
}
function Schedules({ data, action }: any) {
  const [flowId, setFlow] = useState(''),
    [minutes, setMinutes] = useState(30);
  return (
    <div className="page">
      <Heading title="让流程按时开始" text="仅在应用驻留时生效。退出或休眠期间不补跑。" />
      <div className="panel">
        <div className="row">
          <select value={flowId} onChange={(e) => setFlow(e.target.value)}>
            <option value="">选择流程</option>
            {data.flows.map((r: FlowRecord) => (
              <option key={r.id} value={r.id}>
                {r.flow.name}
              </option>
            ))}
          </select>
          <span>每</span>
          <input
            type="number"
            min={1}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            style={{ width: 90 }}
          />
          <span>分钟</span>
          <button
            className="primary"
            disabled={!flowId}
            onClick={() =>
              action(
                () =>
                  api('schedule.save', {
                    flowId,
                    intervalMinutes: minutes,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  }),
                '计划已创建，固定引用当前版本',
              )
            }
          >
            <Plus size={15} />
            创建计划
          </button>
        </div>
      </div>
      {data.schedules.map((s: any) => (
        <div className="schedule" key={s.id}>
          <Clock />
          <div>
            <b>{data.flows.find((f: FlowRecord) => f.id === s.flowId)?.flow.name}</b>
            <p>
              每 {s.intervalMinutes} 分钟 · {s.timezone} · 固定版本 {s.versionId.slice(0, 8)}
            </p>
            <small>下次：{format(new Date(s.nextAt).toISOString())}</small>
          </div>
          <button
            onClick={() => action(() => api('schedule.toggle', { id: s.id, enabled: !s.enabled }))}
          >
            {s.enabled ? '暂停计划' : '启用计划'}
          </button>
        </div>
      ))}
    </div>
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
