import { VariableNavigationContext } from './variable-navigation';
import { usePageBack } from './use-page-back';
import DesktopStepDetails from './DesktopStepDetails';
import StepPositionPage from './StepPositionPage';
import ControlWorkspace from './ControlWorkspace';
import BrowserActionWorkspace from './BrowserActionWorkspace';
import ResourceWorkspace from './ResourceWorkspace';
import LogicConfigurationWorkspace from './LogicConfigurationWorkspace';
import ScriptConfigurationWorkspace from './ScriptConfigurationWorkspace';
import { editScriptPackage, type ScriptNode } from './script-editor';
import { stepTitle } from './flow-outline';
import EditorLeaveDialog from './EditorLeaveDialog';
import './editor-feedback.css';
import { parseNodeDraft } from './node-json';
import EditorMorePage from './EditorMorePage';
import NavigationIcon from './NavigationIcon';
import ExportReviewDialog, { captureDraftExport, type ExportSource } from './ExportReviewDialog';
import LocalSettingsPage, {
  type SettingsTabRequest,
  type SettingsNavigation,
} from './LocalSettingsPage';
import AttentionWorkspace, { type AttentionNavigation } from './AttentionWorkspace';
import TemplateSchedulePage from './TemplateSchedulePage';
import type { TemplateEntryOrigin } from './template-entry-navigation';
import { useState, useEffect, useCallback, useReducer, useRef, lazy, Suspense } from 'react';
import FlowLibrary from './FlowLibrary';
import AITaskWorkspace, { type TaskOpener } from './AITaskWorkspace';
import ToolConnectionsPage, { type ToolNavigation } from './ToolConnectionsPage';
import AISettingsPage, { type AISettingsEntry, type AISettingsNavigation } from './AISettingsPage';
import { defaultAIModel, type AIProviderId } from '../shared/ai-settings';
import { buildTaskDiagram } from './task-diagram';
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
  ArrowUpRight,
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
  Copy,
  Trash2,
  Activity,
  Search,
} from 'lucide-react';
import type { Bootstrap, FlowRecord, Step } from '../shared/types';
import TemplateLibrary from './TemplateLibrary';
import type { TemplateNavigation } from './TemplateInstancePage';
import TemplateConfiguration from './TemplateConfiguration';
import ScriptPackages from './ScriptPackages';
import ScriptEditorPage, { type ScriptNavigation } from './ScriptEditorPage';
import ExcelMappingPage from './ExcelMappingPage';
import FlowOutlineWorkspace, { type OutlineLocation } from './FlowOutlineWorkspace';
import BrowserSidebar from './BrowserSidebar';
import StorageFaultNotice from './StorageFaultNotice';
import Schedules from './Schedules';
import BrowserNodeConfiguration from './BrowserNodeConfiguration';
import ReadStepInspector from './ReadStepInspector';
import type { ElementPickerControls } from './ElementPicker';
import { browserActions } from './browser-actions';
import LogicNodeConfiguration from './LogicNodeConfiguration';
import ResourceNodeConfiguration from './ResourceNodeConfiguration';
import McpNodeConfiguration from './McpNodeConfiguration';
import FlowParametersPage from './FlowParametersPage';
import NodeTiming from './NodeTiming';
import RunHistory from './RunHistory';
import RunDetail, { type RunTab } from './RunDetail';
import TaskRunPage, { type TaskRunReturnContext } from './TaskRunPage';
import { taskRunPresentation, type TaskRunIntent, type TaskRunView } from './task-run-presentation';
import { runStateLabels } from '../shared/run-history';
import { referenceChoices } from './value-references';
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
  const [exportSource, setExportSource] = useState<ExportSource>();
  const [settingsFlowId, setSettingsFlowId] = useState<string>();
  const [toolsOrigin, setToolsOrigin] = useState<'tasks' | 'settings' | 'runs'>('tasks');
  const desktopAssistantOpener = useRef<(() => void) | undefined>(undefined);
  const [settingsNavigation, setSettingsNavigation] = useState<SettingsNavigation>();
  const [attentionNavigation, setAttentionNavigation] = useState<AttentionNavigation>();
  const templateNavigation = useRef<TemplateNavigation | undefined>(undefined);
  const [templateHomeRequest, setTemplateHomeRequest] = useState<string>();
  const toolNavigation = useRef<ToolNavigation | undefined>(undefined);
  const toolDetails = useRef<((id: string) => void) | undefined>(undefined);
  const aiSettingsNavigation = useRef<AISettingsNavigation | undefined>(undefined);
  const [configuredAI, setConfiguredAI] = useState<{
    key: string;
    provider: AIProviderId;
    model: string;
  }>();
  const [toolSelection, setToolSelection] = useState<{
    key: string;
    kind: 'web' | 'file' | 'window';
  }>();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserObservationRequest, setBrowserObservationRequest] = useState<string>();
  const browserObservationOrigin = useRef<
    | {
        trigger: HTMLElement | null;
        browserOpen: boolean;
        scroll: number;
      }
    | undefined
  >(undefined);
  const inspectTaskBrowser = () => {
    browserObservationOrigin.current = {
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      browserOpen,
      scroll: document.querySelector('main')?.scrollTop ?? 0,
    };
    setBrowserObservationRequest(crypto.randomUUID());
    setBrowserOpen(true);
  };
  const returnFromBrowserObservation = () => {
    const origin = browserObservationOrigin.current;
    setBrowserObservationRequest(undefined);
    setBrowserOpen(origin?.browserOpen ?? false);
    requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: origin?.scroll ?? 0 });
      if (origin?.trigger?.isConnected) origin.trigger.focus({ preventScroll: true });
    });
    browserObservationOrigin.current = undefined;
  };

  const [outlineOpen, setOutlineOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreOrigin = useRef({ browserOpen: false, scroll: 0, outline: false, task: false });
  const outlineBrowser = useRef(false);
  const outlineMemory = useRef(new Map<string, OutlineLocation>());
  const [nodeSession, setNodeSession] = useState<{
    kind: 'script' | 'excel' | 'parameters';
    preview?: boolean;
    fromSettings?: boolean;
    panel?: string;
    trigger?: HTMLElement;
    record: FlowRecord;
    nodeId: string;
    browserOpen: boolean;
    scroll: number;
  }>();
  const nodeNavigation = useRef<ScriptNavigation | undefined>(undefined);
  const [parametersDirty, setParametersDirty] = useState(false);
  const [settingsTabRequest, setSettingsTabRequest] = useState<SettingsTabRequest>();
  const [editorPanel, setEditorPanel] = useState('canvas');
  const [advancedInputPending, setAdvancedInputPending] = useState(false);
  const [runPage, setRunPage] = useState(1);
  const [runFilter, setRunFilter] = useState(false);
  const [runTab, setRunTab] = useState<RunTab>('current');
  const runRerunReturn = useRef<
    | {
        tab: Exclude<RunTab, 'rerun'>;
        scroll: number;
        focus: HTMLElement | null;
      }
    | undefined
  >(undefined);
  const [runRerunBusy, setRunRerunBusy] = useState(false);
  function changeRunTab(next: RunTab) {
    if (next === 'rerun' && runTab !== 'rerun') {
      runRerunReturn.current = {
        tab: runTab,
        scroll: document.querySelector('main')?.scrollTop ?? 0,
        focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      };
    }
    setRunTab(next);
  }
  function returnRunSubview() {
    if (runRerunBusy) return;
    const source = runTab === 'rerun' ? runRerunReturn.current : undefined;
    setRunTab(source?.tab ?? 'current');
    if (source)
      requestAnimationFrame(() => {
        source.focus?.isConnected && source.focus.focus({ preventScroll: true });
        document.querySelector('main')?.scrollTo({ top: source.scroll });
      });
  }
  const [runOrigin, setRunOrigin] = useState<
    'history' | 'editor' | 'task' | 'template' | 'schedule' | 'inbox'
  >('history');
  const [templateOrigin, setTemplateOrigin] = useState<TemplateEntryOrigin>();
  const scheduleNavigation = useRef<TemplateNavigation | undefined>(undefined);
  const plansNavigation = useRef<TemplateNavigation | undefined>(undefined);
  const scheduleRunBack = useRef<(() => void) | undefined>(undefined);
  const taskRunBack = useRef<((intent?: TaskRunIntent) => void) | undefined>(undefined);
  const [taskRunView, setTaskRunView] = useState<TaskRunView>('overview');
  const [taskRunTrail, setTaskRunTrail] = useState<
    { targetId: string; context: TaskRunReturnContext }[]
  >([]);
  const [taskRunRestored, setTaskRunRestored] = useState<TaskRunReturnContext>();
  const taskRunTrailRef = useRef(taskRunTrail);
  taskRunTrailRef.current = taskRunTrail;
  const [taskRunReturning, setTaskRunReturning] = useState(false);
  const taskRunReturnLock = useRef(false);
  const [compactEditor, setCompactEditor] = useState(() => window.innerWidth < 1440);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1439px)');
    const change = () => setCompactEditor(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [guideEntry, setGuideEntry] = useState(0);
  const [taskNavigation, setTaskNavigation] = useState<{
    title: string;
    back?: () => void;
    backLabel?: string;
  }>({
    title: '开始任务',
  });
  const taskTitle = taskNavigation.title;
  const updateTaskNavigation = useCallback(
    (title: string, back?: () => void, backLabel?: string) => {
      setTaskNavigation((previous) =>
        previous.title === title && previous.back === back && previous.backLabel === backLabel
          ? previous
          : { title, back, backLabel },
      );
    },
    [],
  );
  const [taskReturn, setTaskReturn] = useState(false);
  const taskEditorReturn = useRef<
    { flowId: string; back: () => void; browserOpen: boolean } | undefined
  >(undefined);
  const taskOpener = useRef<TaskOpener | undefined>(undefined);
  const [taskEntry, setTaskEntry] = useState<{ key: string; record: FlowRecord; nodeId: string }>();
  const [taskSource, setTaskSource] = useState<{
    record: FlowRecord;
    nodeId: string;
    scroll: number;
    browserOpen: boolean;
  }>();
  const [taskAISettings, setTaskAISettings] = useState<AISettingsEntry>({
    key: 'initial',
    provider: 'deepseek',
    model: 'deepseek-flash',
  });
  const [importPreview, setImportPreview] = useState<any>();
  useEffect(() => {
    const open = () => setBrowserOpen(true);
    window.addEventListener('flowark:open-browser', open);
    return () => window.removeEventListener('flowark:open-browser', open);
  }, []);
  const [data, setData] = useState(initial),
    [section, setSection] = useState('tasks'),
    [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [configOpen, setConfigOpen] = useState(false);
  const [history, dispatchDraft] = useReducer(draftHistory, emptyHistory);
  const [editorLeave, setEditorLeave] = useState<{
    next: () => void;
    destination: string;
    resume?: () => void;
  }>();
  const editorLeaveLocked = useRef(false);
  const editorFocus = useRef<HTMLElement | null>(null);
  const editorLeaveRequest = useRef<
    (next: () => void, destination: string, resume?: () => void) => void
  >(() => {});
  const runLocation = useRef({ section, id: detail?.run.id });
  runLocation.current = { section, id: detail?.run.id };
  const linkedRunSource =
    runOrigin === 'task' && taskRunTrail.at(-1)?.targetId === detail?.run.id
      ? taskRunTrail.at(-1)
      : undefined;
  useEffect(() => {
    if ((section !== 'runs' && section !== 'tools') || runOrigin !== 'task') {
      setTaskRunTrail([]);
      setTaskRunRestored(undefined);
    }
  }, [section, runOrigin]);
  async function returnLinkedRun() {
    if (!linkedRunSource || taskRunReturnLock.current) return;
    const source = linkedRunSource;
    taskRunReturnLock.current = true;
    setTaskRunReturning(true);
    setError('');
    try {
      const next = await api('run.detail', { id: source.context.runId });
      if (
        runLocation.current.section !== 'runs' ||
        runLocation.current.id !== source.targetId ||
        taskRunTrailRef.current.at(-1) !== source
      )
        return;
      if (next?.run?.id !== source.context.runId)
        throw new Error('返回的记录与来源运行不一致，请重新读取');
      setTaskRunTrail((trail) => trail.slice(0, -1));
      setTaskRunRestored(source.context);
      setTaskRunView(source.context.page);
      setDetail(next);
    } catch (reason) {
      if (
        runLocation.current.section === 'runs' &&
        runLocation.current.id === source.targetId &&
        taskRunTrailRef.current.at(-1) === source
      )
        setError(reason instanceof Error ? reason.message : '无法返回来源运行，请稍后重试');
    } finally {
      taskRunReturnLock.current = false;
      setTaskRunReturning(false);
    }
  }
  useEffect(() => {
    if (
      section === 'runs' &&
      (detail || runFilter) &&
      !(runOrigin === 'task' && taskRunRestored?.runId === detail?.run.id)
    )
      document.querySelector('main')?.scrollTo({ top: 0 });
  }, [section, detail?.run.id, runFilter, runTab]);
  const edit = history.present?.record ?? null,
    selected = history.present?.selected ?? '';
  useEffect(() => {
    if (!browserOpen || section !== 'tasks') setBrowserObservationRequest(undefined);
  }, [browserOpen, section]);
  const editorBrowser = section === 'editor' && browserOpen;
  const draftHasTools =
    !!edit && flatten(edit.flow.steps).some((step) => ['mcp', 'desktop'].includes(step.type));
  const compactDrawer =
    editorBrowser && compactEditor && ['actions', 'node', 'params'].includes(editorPanel);
  const inputGroup = useRef<string | undefined>(undefined);
  const inputTarget = useRef<Element | null>(null);
  const setEdit = (record: FlowRecord) =>
    dispatchDraft({ type: 'change', record, group: inputGroup.current });
  const setSelected = (selected: string) => {
    if (guardNodeInput()) dispatchDraft({ type: 'select', selected });
  };
  const undo = () => {
    if (!guardNodeInput()) return;
    inputGroup.current = undefined;
    dispatchDraft({ type: 'undo' });
  };
  const redo = () => {
    if (!guardNodeInput()) return;
    inputGroup.current = undefined;
    dispatchDraft({ type: 'redo' });
  };
  const dataRefreshError = useRef('');
  const reloadSettingsData = useCallback(async () => {
    setData(await api('bootstrap'));
    setLoaded(true);
    if (dataRefreshError.current) {
      const previousError = dataRefreshError.current;
      dataRefreshError.current = '';
      setError((current) => (current === previousError ? '' : current));
    }
  }, []);
  const refresh = useCallback(async () => {
    try {
      await reloadSettingsData();
    } catch (e: any) {
      dataRefreshError.current = e.message;
      setError(e.message);
    }
  }, [reloadSettingsData]);
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
  function returnSchedule() {
    setDetail(null);
    setSection('schedules');
    scheduleRunBack.current?.();
  }
  function leaveScheduleContext(next: () => void, destination: string) {
    setDetail(null);
    setSection('schedules');
    requestAnimationFrame(() =>
      plansNavigation.current ? plansNavigation.current(next, destination) : next(),
    );
  }
  function returnTemplate() {
    setDetail(null);
    setSection('templates');
    templateOrigin?.back();
  }
  const returnRun = () => {
    if (detail && runOrigin === 'task' && taskRunView !== 'overview') setTaskRunView('overview');
    else if (linkedRunSource) void returnLinkedRun();
    else if (detail && runTab !== 'current') returnRunSubview();
    else if (detail) {
      setDetail(null);
      if (runOrigin === 'inbox') setSection('inbox');
      else if (runOrigin === 'schedule') returnSchedule();
      else if (runOrigin === 'template') returnTemplate();
      else if (runOrigin === 'editor' && edit) setSection('editor');
      else if (runOrigin === 'task') {
        setSection('tasks');
        taskRunBack.current?.();
      }
    } else setRunFilter(false);
  };
  usePageBack(returnRun, section === 'runs' && !!(detail || runFilter));

  function leaveTemplateContext(next: () => void, destination: string) {
    setDetail(null);
    setSection('templates');
    requestAnimationFrame(() =>
      templateNavigation.current ? templateNavigation.current(next, destination) : next(),
    );
  }
  function leaveAIContext(next: () => void, destination: string) {
    if (taskAISettings.source?.kind !== 'template') {
      next();
      return;
    }
    leaveTemplateContext(next, destination);
  }
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
  async function openFlow(r: FlowRecord, fromSettings = false) {
    if (!guardNodeInput()) return false;
    setMoreOpen(false);
    setSettingsFlowId(fromSettings ? r.id : undefined);
    if (fromSettings) setTaskReturn(false);
    setConfigOpen(false);
    setEditorPanel('canvas');
    setOutlineOpen(false);
    inputGroup.current = undefined;
    dispatchDraft({ type: 'open', record: r });
    setSection('editor');
    setDetail(null);
    return true;
  }
  async function create() {
    if (!guardNodeInput()) return;
    const r = await action(() => api('flow.create', {}));
    if (r) void openFlow(r);
  }
  function focusInvalidInput(invalid: HTMLElement) {
    const details = invalid.closest('details');
    if (details) details.open = true;
    const input = invalid.matches('textarea,input,select')
      ? invalid
      : (invalid.querySelector<HTMLElement>('[aria-invalid="true"]') ??
        invalid.querySelector<HTMLElement>('textarea,input,select'));
    if (compactEditor && invalid.closest('.inspector')) {
      setEditorPanel('node');
      requestAnimationFrame(() => input?.isConnected && input.focus());
    } else input?.focus();
  }
  function guardNodeInput(includeValues = true) {
    // Field edits may complete their own pending value. Navigation and structure
    // changes must protect every unfinished field before replacing its component.
    const invalid = document.querySelector<HTMLElement>(
      includeValues
        ? '.editor-page [data-value-invalid], .control-workspace-dialog [data-value-invalid], .browser-action-workspace [data-value-invalid], .resource-workspace [data-value-invalid]'
        : '.editor-page .node-advanced[data-value-invalid], .editor-page .node-timing[data-value-invalid], .logic-configuration-workspace .node-advanced[data-value-invalid], .logic-configuration-workspace .node-timing[data-value-invalid]',
    );
    if (!invalid) return true;
    focusInvalidInput(invalid);
    setError(
      invalid.classList.contains('node-timing')
        ? '请先修正节点期限，或关闭自定义期限恢复默认规则'
        : invalid.classList.contains('node-advanced')
          ? '请先修正高级节点 JSON，或点击“恢复节点配置”放弃这段未完成输入'
          : '请先修正当前值配置，再切换步骤、关闭配置或调整结构',
    );
    return false;
  }
  function checkEditorInput(operation = '保存或运行') {
    if (section !== 'editor') return;
    const invalid = document.querySelector<HTMLElement>(
      '.editor-page [data-value-invalid], .control-workspace-dialog [data-value-invalid], .browser-action-workspace [data-value-invalid], .resource-workspace [data-value-invalid]',
    );
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
  function exportDraft() {
    if (!edit) return;
    try {
      checkEditorInput('导出');
      setExportSource(captureDraftExport(edit, draftSaved));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法准备导出内容');
    }
  }
  async function run(r: FlowRecord, debug = false) {
    await action(async () => {
      checkEditorInput();
      await api('flow.save', { flow: r.flow, bindings: r.bindings });
      const run = await api('flow.run', { id: r.id, debug });
      const next = await api('run.detail', { id: run.id });
      if (!guardNodeInput()) return;
      setDetail(next);
      setRunOrigin('editor');
      setRunTab('current');
      setRunFilter(false);
      setSection('runs');
    }, '已生成快照并加入队列');
  }
  const unread = data.attention.filter((a) => !a.read).length;
  const nav = [
    ['tasks', '开始任务'],
    ['flows', '我的流程'],
    ['tools', '应用与工具'],
    ['templates', '模板库'],
    ['runs', '运行记录'],
    ['schedules', '本机计划'],
    ['inbox', '需要我处理'],
    ['settings', '本地设置'],
  ] as const;
  const selectedNavigation =
    section === 'runs' && detail && runOrigin === 'task'
      ? 'tasks'
      : section === 'editor'
        ? 'flows'
        : section === 'ai-settings'
          ? 'settings'
          : section === 'template-schedule'
            ? 'schedules'
            : section;
  const observedActive = data.execution?.active;
  const active = observedActive
    ? ([data.runOverview.active, ...data.runs].find((run) => run?.id === observedActive.runId) ??
      null)
    : null;
  const savedEdit = edit && data.flows.find((record) => record.id === edit.id);
  const draftSaved =
    !advancedInputPending &&
    !!savedEdit &&
    JSON.stringify(edit.flow) === JSON.stringify(savedEdit.flow) &&
    JSON.stringify(edit.bindings) === JSON.stringify(savedEdit.bindings);
  const welcomePage =
    section === 'flows' && loaded && !data.fault && !data.flows.length && !welcomeDismissed;
  const requestEditorLeave = (next: () => void, destination: string, resume?: () => void) => {
    if (busy || editorLeaveLocked.current) return;
    if (
      section === 'editor' &&
      edit &&
      (!draftSaved ||
        document.querySelector(
          '.editor-page [data-value-invalid], .control-workspace-dialog [data-value-invalid], .browser-action-workspace [data-value-invalid], .resource-workspace [data-value-invalid]',
        ))
    ) {
      editorLeaveLocked.current = true;
      if (moreOpen || !editorFocus.current?.isConnected)
        editorFocus.current = document.activeElement as HTMLElement;
      setEditorLeave({ next, destination, resume });
    } else next();
  };
  editorLeaveRequest.current = requestEditorLeave;
  const finishEditorLeave = () => {
    const next = editorLeave?.next;
    setEditorLeave(undefined);
    editorLeaveLocked.current = false;
    setError('');
    setConfigOpen(false);
    next?.();
  };
  const stayInEditor = () => {
    const resume = editorLeave?.resume;
    setEditorLeave(undefined);
    editorLeaveLocked.current = false;
    if (resume) {
      resume();
      return;
    }
    requestAnimationFrame(() => {
      const invalid = document.querySelector<HTMLElement>(
        '.editor-page [data-value-invalid], .control-workspace-dialog [data-value-invalid], .browser-action-workspace [data-value-invalid], .resource-workspace [data-value-invalid]',
      );
      if (invalid) focusInvalidInput(invalid);
      else if (editorFocus.current?.isConnected) editorFocus.current.focus({ preventScroll: true });
    });
  };
  const requestWorkspaceLeave = (navigate: () => void, label: string, id: string) => {
    if (nodeSession) {
      leaveNodeEditor(navigate, label);
      return;
    }
    if (section === 'editor') requestEditorLeave(navigate, label);
    else if (section === 'tools') toolNavigation.current?.(navigate);
    else if (section === 'ai-settings')
      aiSettingsNavigation.current?.(() => leaveAIContext(navigate, label), label);
    else if (section === 'templates') templateNavigation.current?.(navigate, label);
    else if (section === 'schedules') plansNavigation.current?.(navigate, label);
    else if (section === 'template-schedule')
      scheduleNavigation.current?.(
        () => (id === 'templates' ? navigate() : leaveTemplateContext(navigate, label)),
        label,
      );
    else if (section === 'runs' && runOrigin === 'schedule' && detail) {
      if (id === 'schedules') returnSchedule();
      else leaveScheduleContext(navigate, label);
    } else if (section === 'runs' && runOrigin === 'template' && detail) {
      if (id === 'templates') returnTemplate();
      else leaveTemplateContext(navigate, label);
    } else navigate();
  };
  const returnHome = () =>
    requestEditorLeave(() => {
      setWelcomeDismissed(true);
      setTaskReturn(false);
      setSection('flows');
      setDetail(null);
    }, '我的流程');
  const returnToTaskEditor = () =>
    requestEditorLeave(() => {
      const origin =
        section === 'editor' && taskEditorReturn.current?.flowId === edit?.id
          ? taskEditorReturn.current
          : undefined;
      setMoreOpen(false);
      setSection('tasks');
      setTaskReturn(false);
      if (origin) setBrowserOpen(origin.browserOpen);
      taskEditorReturn.current = undefined;
      if (origin) requestAnimationFrame(origin.back);
    }, 'AI 任务');
  const returnEditor = () => {
    if (moreOpen) {
      closeMore();
      return;
    }
    if (outlineOpen) {
      closeOutline();
      return;
    }
    if (editorBrowser) {
      if (!guardNodeInput()) return;
      if (compactDrawer) setEditorPanel('canvas');
      else setBrowserOpen(false);
    } else if (taskReturn) returnToTaskEditor();
    else if (settingsFlowId === edit?.id && settingsFlowId)
      requestEditorLeave(() => {
        setSection('settings');
        setSettingsFlowId(undefined);
      }, '本地设置');
    else returnHome();
  };
  usePageBack(returnEditor, section === 'editor' && !nodeSession);
  usePageBack(
    () => nodeNavigation.current?.(),
    section === 'editor' && !!nodeSession && nodeSession.kind !== 'parameters',
  );
  usePageBack(taskNavigation.back, section === 'tasks');
  usePageBack(attentionNavigation?.back, section === 'inbox');
  usePageBack(
    settingsNavigation?.back ?? (taskReturn ? returnToTaskEditor : undefined),
    section === 'settings',
  );

  const leaveNodeEditor = (next: () => void, destination: string) => {
    const source = nodeSession;
    nodeNavigation.current?.(
      () =>
        requestAnimationFrame(() =>
          editorLeaveRequest.current(next, destination, () => {
            setNodeSession(source);
            setBrowserOpen(false);
          }),
        ),
      destination,
    );
  };
  const closeNodeEditor = (next?: () => void) => {
    const source = nodeSession;
    setNodeSession(undefined);
    if (next) next();
    else if (source?.fromSettings) {
      setSection('settings');
      setSettingsFlowId(undefined);
      setBrowserOpen(false);
    } else {
      setBrowserOpen(source?.browserOpen ?? false);
      setEditorPanel(source?.kind === 'parameters' ? (source.panel ?? 'canvas') : 'node');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          document.querySelector('main')?.scrollTo({ top: source?.scroll ?? 0 });
          if (source?.kind === 'parameters') {
            const trigger =
              source.trigger?.isConnected && source.trigger.getClientRects().length
                ? source.trigger
                : Array.from(
                    document.querySelectorAll<HTMLElement>('[aria-label="打开流程参数与资源"]'),
                  ).find((element) => element.getClientRects().length);
            trigger?.focus({ preventScroll: true });
            return;
          }
          document
            .querySelector<HTMLElement>(
              moreOpen
                ? '.editor-more-page h1'
                : source?.kind === 'excel'
                  ? '[aria-label="打开 Excel 映射编辑器"]'
                  : '[aria-label="打开完整脚本编辑器"]',
            )
            ?.focus({ preventScroll: true });
        }),
      );
    }
  };
  const openParameters = () => {
    if (!edit) return;
    try {
      checkEditorInput('打开流程参数与资源');
    } catch (reason) {
      setError((reason as Error).message);
      return;
    }
    setNodeSession({
      kind: 'parameters',
      record: structuredClone(edit),
      nodeId: selected,
      browserOpen,
      panel: editorPanel,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
      scroll: document.querySelector('main')?.scrollTop ?? 0,
    });
    setBrowserOpen(false);
    document.querySelector('main')?.scrollTo(0, 0);
  };
  const openMore = () => {
    if (busy) return;
    try {
      checkEditorInput('打开更多操作');
    } catch (reason) {
      setError((reason as Error).message);
      return;
    }
    moreOrigin.current = {
      browserOpen,
      scroll: document.querySelector('main')?.scrollTop ?? 0,
      outline: outlineOpen,
      task: false,
    };
    setOutlineOpen(false);
    setBrowserOpen(false);
    setMoreOpen(true);
    document.querySelector('main')?.scrollTo(0, 0);
  };
  const closeMore = () => {
    if (busy) return;
    if (moreOrigin.current.task) {
      returnToTaskEditor();
      return;
    }
    setMoreOpen(false);
    setOutlineOpen(moreOrigin.current.outline);
    setBrowserOpen(moreOrigin.current.browserOpen);
    requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: moreOrigin.current.scroll });
      document
        .querySelector<HTMLElement>(
          moreOrigin.current.outline
            ? '[aria-label="从大纲打开更多操作"]'
            : '[aria-label="打开更多操作"]',
        )
        ?.focus({ preventScroll: true });
    });
  };
  const openScript = (nodeId: string, preview = false) => {
    if (!edit) return;
    try {
      checkEditorInput('打开脚本编辑器');
    } catch (reason) {
      setError((reason as Error).message);
      return;
    }
    setNodeSession({
      kind: 'script',
      preview,
      record: structuredClone(edit),
      nodeId,
      browserOpen,
      scroll: document.querySelector('main')?.scrollTop ?? 0,
    });
    setBrowserOpen(false);
    document.querySelector('main')?.scrollTo(0, 0);
  };
  const openOutline = () => {
    try {
      checkEditorInput('打开长流程大纲');
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!moreOpen || !moreOrigin.current.outline)
      outlineBrowser.current = moreOpen ? moreOrigin.current.browserOpen : browserOpen;
    setMoreOpen(false);
    setBrowserOpen(false);
    setOutlineOpen(true);
  };
  const closeOutline = (panel = 'canvas') => {
    setOutlineOpen(false);
    setEditorPanel(panel);
    setBrowserOpen(outlineBrowser.current);
  };
  return (
    <div className="application-shell">
      {editorLeave && edit && (
        <EditorLeaveDialog
          name={edit.flow.name}
          destination={editorLeave.destination}
          stay={stayInEditor}
          discard={() => {
            if (savedEdit) dispatchDraft({ type: 'open', record: savedEdit });
            else dispatchDraft({ type: 'clear' });
            inputGroup.current = undefined;
            inputTarget.current = null;
            editorFocus.current = null;
            finishEditorLeave();
          }}
          save={async () => {
            checkEditorInput('保存并离开');
            const saved = (await api('flow.save', {
              flow: edit.flow,
              bindings: edit.bindings,
            })) as FlowRecord;
            setEdit(saved);
            setData((current) => ({
              ...current,
              flows: [...current.flows.filter((record) => record.id !== saved.id), saved],
            }));
            setNotice('已保存本地草稿');
            finishEditorLeave();
          }}
        />
      )}
      {exportSource && (
        <ExportReviewDialog
          source={exportSource}
          close={() => setExportSource(undefined)}
          importZip={async () => {
            const preview = await api('template.inspect');
            if (!preview) return false;
            setImportPreview(preview);
            setSection('templates');
            return true;
          }}
        />
      )}
      <div className="window-titlebar">FlowArk · 个人工作空间</div>
      <div
        className={`app ${browserOpen ? 'with-browser' : ''} ${section === 'editor' && !nodeSession && !outlineOpen && !moreOpen ? 'editing-workspace' : ''}`}
      >
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">
              <NavigationIcon item="tasks" active />
            </span>
            <span className="brand-name">FlowArk</span>
          </div>
          <div className="workspace-label">
            <span>个人工作空间</span>
          </div>
          <nav aria-label="工作区导航">
            {nav.map(([id, label]) => (
              <button
                key={id}
                title={label}
                aria-label={label}
                className={selectedNavigation === id ? 'selected' : ''}
                aria-current={selectedNavigation === id ? 'page' : undefined}
                onClick={(event) => {
                  const destination = event.currentTarget;
                  const navigate = () => {
                    if (
                      id === 'templates' &&
                      section === 'ai-settings' &&
                      taskAISettings.source?.kind === 'template'
                    )
                      setTemplateHomeRequest(crypto.randomUUID());
                    if (id === 'tools')
                      setToolsOrigin(section === 'settings' ? 'settings' : 'tasks');
                    setTaskReturn(false);
                    setSection(id);
                    setDetail(null);
                    setRunFilter(false);
                    requestAnimationFrame(() => {
                      if (destination.isConnected) destination.focus({ preventScroll: true });
                    });
                  };
                  requestWorkspaceLeave(navigate, label, id);
                }}
              >
                <NavigationIcon item={id} active={selectedNavigation === id} />
                <span className="nav-label">{label}</span>
                {id === 'inbox' && unread > 0 && <b>{unread}</b>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <p>只在本机执行</p>
            <button
              className="sidebar-guide"
              title="重新学习 · 2 分钟"
              disabled={!!nodeSession || (section === 'editor' && outlineOpen)}
              onClick={() => {
                const navigate = () => {
                  setTaskReturn(false);
                  setSection('tasks');
                  setGuideEntry((n) => n + 1);
                  setBrowserOpen(false);
                };
                if (section === 'editor') requestEditorLeave(navigate, '首次教学');
                else if (section === 'tools') toolNavigation.current?.(navigate);
                else if (section === 'ai-settings')
                  aiSettingsNavigation.current?.(
                    () => leaveAIContext(navigate, '首次教学'),
                    '首次教学',
                  );
                else if (section === 'templates')
                  templateNavigation.current?.(navigate, '首次教学');
                else if (section === 'schedules') plansNavigation.current?.(navigate, '首次教学');
                else if (section === 'runs' && runOrigin === 'schedule' && detail)
                  leaveScheduleContext(navigate, '首次教学');
                else if (section === 'template-schedule')
                  scheduleNavigation.current?.(
                    () => leaveTemplateContext(navigate, '首次教学'),
                    '首次教学',
                  );
                else if (section === 'runs' && runOrigin === 'template' && detail)
                  leaveTemplateContext(navigate, '首次教学');
                else navigate();
              }}
            >
              <span>重新学习 · 2 分钟</span>
            </button>
          </div>
        </aside>
        <main>
          {nodeSession && (
            <header className="topbar">
              <button className="context-back" onClick={() => nodeNavigation.current?.()}>
                {nodeSession.fromSettings
                  ? '← 返回凭据与本机资源'
                  : moreOpen
                    ? '← 返回更多操作'
                    : '← 返回流程编排'}
              </button>
              <nav className="breadcrumbs" aria-label="当前位置">
                <a
                  href="#flows"
                  onClick={(event) => {
                    event.preventDefault();
                    leaveNodeEditor(() => {
                      setSection('flows');
                      setTaskReturn(false);
                    }, '我的流程');
                  }}
                >
                  我的流程
                </a>
                <span aria-hidden="true">/</span>
                <a
                  href="#editor"
                  onClick={(event) => {
                    event.preventDefault();
                    nodeNavigation.current?.(
                      nodeSession.fromSettings
                        ? () => {
                            setEditorPanel('canvas');
                            requestAnimationFrame(() =>
                              document
                                .querySelector<HTMLElement>('[aria-label="流程名称"]')
                                ?.focus(),
                            );
                          }
                        : undefined,
                      nodeSession.fromSettings ? '流程编排' : undefined,
                    );
                  }}
                >
                  {nodeSession.record.flow.name}
                </a>
                <span aria-hidden="true">/</span>
                <span aria-current="page">
                  {nodeSession.kind === 'parameters'
                    ? `参数与资源${parametersDirty ? ' · 未保存' : ''}`
                    : nodeSession.kind === 'excel'
                      ? 'Excel 字段映射'
                      : '脚本配置'}
                </span>
              </nav>
            </header>
          )}
          {section === 'editor' && outlineOpen && !nodeSession && (
            <header className="topbar">
              <button className="context-back" onClick={() => closeOutline()}>
                ← 返回流程编排
              </button>
              <nav className="breadcrumbs" aria-label="当前位置">
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
                <a
                  href="#editor"
                  onClick={(event) => {
                    event.preventDefault();
                    closeOutline();
                  }}
                >
                  {edit?.flow.name}
                </a>
                <span aria-hidden="true">/</span>
                <span aria-current="page">长流程大纲</span>
              </nav>
            </header>
          )}
          <header
            className="topbar"
            style={
              nodeSession ||
              section === 'tools' ||
              section === 'templates' ||
              section === 'template-schedule' ||
              section === 'schedules' ||
              section === 'ai-settings' ||
              (section === 'editor' && outlineOpen)
                ? { display: 'none' }
                : undefined
            }
          >
            {section === 'tasks' && taskNavigation.back && (
              <button
                className={`context-back${taskNavigation.backLabel ? ' task-target-back' : ''}`}
                onClick={taskNavigation.back}
              >
                {taskNavigation.backLabel ? '← 返回' : '← 返回确认方案'}
              </button>
            )}
            {taskReturn &&
              !(section === 'editor' && moreOpen) &&
              ['settings', 'editor'].includes(section) && (
                <button className="context-back" onClick={returnToTaskEditor}>
                  ← 返回 AI 任务
                </button>
              )}
            {section === 'runs' && (detail || runFilter) && (
              <button
                disabled={
                  taskRunReturning || (runOrigin !== 'task' && runTab === 'rerun' && runRerunBusy)
                }
                className="context-back"
                onClick={returnRun}
              >
                {detail
                  ? runOrigin === 'task' && taskRunView !== 'overview'
                    ? '← 返回结果摘要'
                    : linkedRunSource
                      ? taskRunReturning
                        ? '正在读取来源…'
                        : '← 返回来源结果'
                      : runTab === 'rerun'
                        ? `← 返回${runRerunReturn.current?.tab === 'output' ? '输出与产物' : runRerunReturn.current?.tab === 'logs' ? '运行日志' : '运行详情'}`
                        : runTab !== 'current'
                          ? '← 返回运行详情'
                          : runOrigin === 'inbox'
                            ? '← 返回待办与提醒'
                            : runOrigin === 'schedule'
                              ? '← 返回本机计划'
                              : runOrigin === 'template'
                                ? '← 返回模板入口'
                                : runOrigin === 'task'
                                  ? '← 返回 AI 任务'
                                  : runOrigin === 'editor' && edit
                                    ? moreOpen
                                      ? '← 返回更多操作'
                                      : outlineOpen
                                        ? '← 返回长流程大纲'
                                        : '← 返回流程编排'
                                    : `← 返回记录第 ${runPage} 页`
                  : '← 返回运行记录'}
              </button>
            )}
            {((section === 'editor' && (!taskReturn || moreOpen)) || welcomePage) && (
              <button className="context-back" onClick={returnEditor}>
                {moreOpen
                  ? moreOrigin.current.task
                    ? '← 返回确认方案'
                    : moreOrigin.current.outline
                      ? '← 返回长流程大纲'
                      : '← 返回流程编排'
                  : compactDrawer
                    ? '← 返回紧凑窗口与网页'
                    : editorBrowser
                      ? '← 返回流程编排'
                      : section === 'editor' && !!settingsFlowId && settingsFlowId === edit?.id
                        ? '← 返回本地设置'
                        : '← 返回我的流程'}
              </button>
            )}
            {section === 'settings' && settingsNavigation?.back && (
              <button
                className="context-back"
                onClick={settingsNavigation.back}
                disabled={settingsNavigation.busy}
              >
                ← 返回本地设置
              </button>
            )}
            {section === 'inbox' && attentionNavigation?.back && (
              <button className="context-back" onClick={attentionNavigation.back}>
                ← 返回待办列表
              </button>
            )}
            <nav className="breadcrumbs" aria-label="当前位置">
              {section === 'settings' && settingsNavigation?.back && (
                <>
                  <a
                    href="#settings"
                    aria-disabled={settingsNavigation.busy}
                    onClick={(event) => {
                      event.preventDefault();
                      settingsNavigation.back?.();
                    }}
                  >
                    本地设置
                  </a>
                  <span aria-hidden="true">/</span>
                </>
              )}
              {section === 'tasks' && taskNavigation.back && (
                <>
                  <a
                    href="#task-plan"
                    onClick={(event) => {
                      event.preventDefault();
                      taskNavigation.back?.();
                    }}
                  >
                    {taskNavigation.backLabel ?? '确认任务方案'}
                  </a>
                  <span aria-hidden="true">/</span>
                </>
              )}
              {section === 'runs' && detail && runOrigin === 'task' && (
                <>
                  <a
                    href="#task-plan"
                    onClick={(event) => {
                      event.preventDefault();
                      setDetail(null);
                      setSection('tasks');
                      taskRunBack.current?.('plan');
                    }}
                  >
                    确认任务方案
                  </a>
                  <span aria-hidden="true">/</span>
                  {linkedRunSource && (
                    <>
                      <a
                        href="#source-result"
                        aria-disabled={taskRunReturning}
                        onClick={(event) => {
                          event.preventDefault();
                          void returnLinkedRun();
                        }}
                      >
                        来源结果
                      </a>
                      <span aria-hidden="true">/</span>
                    </>
                  )}
                  {taskRunView !== 'overview' && (
                    <>
                      <a
                        href="#task-result"
                        onClick={(event) => {
                          event.preventDefault();
                          setTaskRunView('overview');
                        }}
                      >
                        本次运行
                      </a>
                      <span aria-hidden="true">/</span>
                    </>
                  )}
                </>
              )}
              {((section === 'runs' && detail && runOrigin === 'inbox') ||
                (section === 'inbox' && attentionNavigation?.back)) && (
                <>
                  <a
                    href="#inbox"
                    onClick={(event) => {
                      event.preventDefault();
                      if (section === 'inbox') attentionNavigation?.back?.();
                      else {
                        setDetail(null);
                        setSection('inbox');
                      }
                    }}
                  >
                    待办与提醒
                  </a>
                  <span aria-hidden="true">/</span>
                </>
              )}
              {section === 'runs' && detail && runOrigin === 'schedule' && (
                <>
                  <a
                    href="#schedules"
                    onClick={(event) => {
                      event.preventDefault();
                      returnSchedule();
                    }}
                  >
                    本机计划
                  </a>
                  <span aria-hidden="true">/</span>
                </>
              )}
              {section === 'runs' && detail && runOrigin === 'template' && templateOrigin && (
                <>
                  <a
                    href="#template-entry"
                    className="ai-source-title"
                    title={templateOrigin.title}
                    onClick={(event) => {
                      event.preventDefault();
                      returnTemplate();
                    }}
                  >
                    {templateOrigin.title}
                  </a>
                  <span aria-hidden="true">/</span>
                </>
              )}
              {section === 'runs' && (detail || runFilter) && (!detail || runOrigin !== 'task') && (
                <>
                  <a
                    href="#runs"
                    onClick={(event) => {
                      event.preventDefault();
                      const next = () => {
                        setDetail(null);
                        setRunFilter(false);
                        setSection('runs');
                        setRunOrigin('history');
                      };
                      if (runOrigin === 'schedule' && detail)
                        leaveScheduleContext(next, '运行记录');
                      else if (runOrigin === 'template' && detail)
                        leaveTemplateContext(next, '运行记录');
                      else next();
                    }}
                  >
                    运行记录
                  </a>
                  <span aria-hidden="true">/</span>
                  {detail && (
                    <>
                      {runOrigin === 'history' && (
                        <>
                          <a
                            href="#run-page"
                            onClick={(event) => {
                              event.preventDefault();
                              setDetail(null);
                              setRunFilter(false);
                            }}
                          >
                            第 {runPage} 页
                          </a>
                          <span aria-hidden="true">/</span>
                        </>
                      )}
                      {runTab !== 'current' && (
                        <>
                          <a
                            href="#run-detail"
                            title={detail.run.id}
                            onClick={(event) => {
                              event.preventDefault();
                              setRunTab('current');
                            }}
                          >
                            {detail.run.id.slice(0, 8)}
                          </a>
                          <span aria-hidden="true">/</span>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
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
              {editorBrowser && (
                <>
                  <a
                    href="#editor"
                    onClick={(event) => {
                      event.preventDefault();
                      if (guardNodeInput()) setBrowserOpen(false);
                    }}
                  >
                    {edit?.flow.name || '流程编排'}
                  </a>
                  <span aria-hidden="true">/</span>
                </>
              )}
              <span aria-current="page">
                {section === 'runs' && (detail || runFilter)
                  ? detail
                    ? runOrigin === 'task'
                      ? taskRunView === 'details'
                        ? '结果详细信息'
                        : taskRunView === 'repair'
                          ? '修复任务'
                          : taskRunView === 'rerun'
                            ? '重新运行前检查'
                            : taskRunPresentation({ ...detail, fault: detail.fault ?? data.fault })
                                .title
                      : runTab === 'rerun'
                        ? '重新运行前核对'
                        : runTab === 'output'
                          ? '输出与产物'
                          : runTab === 'logs'
                            ? '运行日志'
                            : detail.run.id.slice(0, 8)
                    : '筛选运行记录'
                  : editorBrowser
                    ? compactDrawer
                      ? editorPanel === 'actions'
                        ? '动作与结构'
                        : editorPanel === 'params'
                          ? '参数与绑定'
                          : '当前步骤 · 配置'
                      : compactEditor
                        ? '紧凑窗口与网页'
                        : '网页操作与拾取'
                    : section === 'editor'
                      ? moreOpen
                        ? '更多操作'
                        : edit?.flow.name || '流程编排'
                      : welcomePage
                        ? '首次使用'
                        : section === 'tasks'
                          ? taskTitle
                          : section === 'inbox'
                            ? (attentionNavigation?.title ?? '待办与提醒')
                            : section === 'settings'
                              ? (settingsNavigation?.title ?? '本地设置')
                              : nav.find((n) => n[0] === section)?.[1]}
              </span>
            </nav>
            {section !== 'editor' && (
              <button
                className="embedded-show"
                aria-label={browserOpen ? '收起网页面板' : '打开网页面板'}
                aria-pressed={browserOpen}
                onClick={() => setBrowserOpen(!browserOpen)}
              >
                {browserOpen ? '收起网页' : '显示网页'}
              </button>
            )}
          </header>
          {data.fault && (
            <StorageFaultNotice
              context={`${section}:${detail?.run?.id ?? ''}`}
              data={data}
              refresh={reloadSettingsData}
              openHistory={() =>
                requestWorkspaceLeave(
                  () => {
                    setTaskReturn(false);
                    setDetail(null);
                    setRunOrigin('history');
                    setRunFilter(false);
                    setSection('runs');
                  },
                  '运行记录',
                  'runs',
                )
              }
              openRun={(next) =>
                requestWorkspaceLeave(
                  () => {
                    setTaskReturn(false);
                    setRunOrigin('history');
                    setRunTab('current');
                    setRunFilter(false);
                    setDetail(next);
                    setSection('runs');
                    requestAnimationFrame(() =>
                      document.querySelector<HTMLElement>('.run-detail-heading h1')?.focus(),
                    );
                  },
                  '运行详情',
                  'runs',
                )
              }
            />
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
          {loaded && (
            <AITaskWorkspace
              openTask={taskOpener}
              openAttention={() => {
                setSection('inbox');
                setBrowserOpen(false);
              }}
              returnConnection={(id) => {
                toolDetails.current?.(id);
                setSection('tools');
                setBrowserOpen(false);
              }}
              showBrowser={setBrowserOpen}
              inspectBrowser={inspectTaskBrowser}
              entry={taskEntry}
              entryHandled={() => setTaskEntry(undefined)}
              sourceFlowId={taskSource?.record.id}
              returnToSource={async (record) => {
                if (!taskSource || JSON.stringify(edit) !== JSON.stringify(taskSource.record))
                  throw new Error('来源编辑器已变化，请先保存其中的修改，未覆盖当前编辑');
                inputGroup.current = undefined;
                setEdit(record);
                dispatchDraft({ type: 'select', selected: taskSource.nodeId });
                setTaskSource({ ...taskSource, record });
                setSection('editor');
                setBrowserOpen(taskSource.browserOpen);
                await refresh();
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    document.querySelector('main')?.scrollTo({ top: taskSource.scroll });
                    document
                      .querySelector<HTMLButtonElement>('[data-ai-edit-step]')
                      ?.focus({ preventScroll: true });
                  }),
                );
              }}
              guideEntry={guideEntry}
              configuredAI={configuredAI}
              configuredAIHandled={() => setConfiguredAI(undefined)}
              toolSelection={toolSelection}
              toolSelectionHandled={() => setToolSelection(undefined)}
              openTools={() => {
                setToolsOrigin('tasks');
                setSection('tools');
                setBrowserOpen(false);
              }}
              active={section === 'tasks'}
              data={data}
              onNavigation={updateTaskNavigation}
              openRun={(next, back) => {
                taskRunBack.current = back;
                setTaskRunTrail([]);
                setTaskRunRestored(undefined);
                setTaskRunView('overview');
                setDetail(next);
                setRunOrigin('task');
                setRunTab('current');
                setRunFilter(false);
                setTaskReturn(false);
                setSection('runs');
              }}
              settings={(provider, model, source) => {
                setTaskAISettings({
                  provider,
                  model,
                  source: source ?? { title: '开始任务' },
                  key: crypto.randomUUID(),
                });
                setTaskReturn(true);
                setSection('ai-settings');
                setBrowserOpen(false);
              }}
              flows={() => {
                setTaskReturn(false);
                setSection('flows');
              }}
              createFlow={async () => {
                if (!guardNodeInput()) throw new Error('请先处理当前编排中的未完成输入');
                const record: FlowRecord = await api('flow.create', {});
                await refresh();
                return record;
              }}
              openFlow={(record, returnToTask = true, back) => {
                taskEditorReturn.current =
                  returnToTask && back ? { flowId: record.id, back, browserOpen } : undefined;
                setTaskReturn(returnToTask);
                void openFlow(record).then((opened) => {
                  if (opened)
                    requestAnimationFrame(() =>
                      document.querySelector<HTMLElement>('[aria-label="流程名称"]')?.focus(),
                    );
                });
              }}
              openMore={async (record, back) => {
                if (!(await openFlow(record))) throw new Error('请先处理当前编排中的未完成输入');
                taskEditorReturn.current = { flowId: record.id, back, browserOpen };
                moreOrigin.current = { browserOpen: false, scroll: 0, outline: false, task: true };
                setTaskReturn(true);
                setBrowserOpen(false);
                setMoreOpen(true);
                document.querySelector('main')?.scrollTo(0, 0);
              }}
              changed={refresh}
            />
          )}
          <ToolConnectionsPage
            active={section === 'tools'}
            navigation={toolNavigation}
            openDetails={toolDetails}
            openAssistant={desktopAssistantOpener}
            parentTitle={
              toolsOrigin === 'runs'
                ? '应用任务'
                : toolsOrigin === 'settings'
                  ? '本地设置'
                  : '开始任务'
            }
            openTask={async (task, connection) => {
              if (!taskOpener.current) throw new Error('任务工作区尚未就绪，请稍后重试。');
              await taskOpener.current({
                ...task,
                connectionId: connection.id,
                connectionName: connection.config.displayName,
              });
              setTaskReturn(false);
              setTaskEntry(undefined);
              setToolSelection(undefined);
              setTaskSource(undefined);
              setSection('tasks');
              setBrowserOpen(false);
              requestAnimationFrame(() => {
                document.querySelector('main')?.scrollTo({ top: 0 });
                document
                  .querySelector<HTMLElement>('.ai-task-page:not([hidden]) h1')
                  ?.focus({ preventScroll: true });
              });
            }}
            leave={() => setSection(toolsOrigin)}
            choose={(kind) => {
              setToolSelection({ key: crypto.randomUUID(), kind });
              setSection('tasks');
              setBrowserOpen(false);
            }}
          />
          <FlowLibrary
            visible={section === 'flows'}
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
          <div hidden={section !== 'templates'}>
            <TemplateLibrary
              homeRequest={templateHomeRequest}
              refresh={refresh}
              navigation={templateNavigation}
              exportTemplate={(pkg, returnLabel) =>
                setExportSource(
                  structuredClone({
                    kind: 'template',
                    returnLabel,
                    key: pkg.key,
                    name: pkg.manifest.name,
                    version: pkg.manifest.version,
                    entries: pkg.manifest.entries.map((entry) => entry.name),
                  }),
                )
              }
              showRun={(next, origin, output) => {
                setTemplateOrigin(origin);
                setRunOrigin('template');
                setRunTab(output ? 'output' : 'current');
                setRunFilter(false);
                setDetail(next);
                setSection('runs');
              }}
              schedule={(origin) => {
                setTemplateOrigin(origin);
                setSection('template-schedule');
                setBrowserOpen(false);
              }}
              active={section === 'templates'}
              data={data}
              action={action}
              initialPreview={importPreview}
              consumePreview={() => setImportPreview(undefined)}
              settings={(entry) => {
                setTaskAISettings(entry);
                setTaskReturn(false);
                setSection('ai-settings');
                setBrowserOpen(false);
              }}
            />
          </div>
          {section === 'editor' && edit && (
            <div
              className={'editor-page' + (outlineOpen ? ' is-outline' : '')}
              style={nodeSession || moreOpen ? { display: 'none' } : undefined}
              onFocusCapture={(event) => {
                const control = (event.target as HTMLElement).closest(
                  'input,textarea,select,[contenteditable="true"],.monaco-editor',
                );
                if (control instanceof HTMLElement) editorFocus.current = control;
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
              {!outlineOpen &&
                (compactEditor && browserOpen ? (
                  <div className="editor-compact-toolbar" aria-label="编排操作">
                    <button
                      aria-expanded={['actions', 'node', 'params'].includes(editorPanel)}
                      onClick={() => {
                        if (guardNodeInput())
                          setEditorPanel(editorPanel === 'actions' ? 'node' : 'actions');
                      }}
                    >
                      动作 / 配置抽屉
                    </button>
                    <button
                      onClick={() => {
                        if (guardNodeInput()) setEditorPanel('graph');
                      }}
                    >
                      全图
                    </button>
                    <button
                      className="primary"
                      onClick={() => run(edit, true)}
                      disabled={busy || draftHasTools}
                    >
                      逐步调试
                    </button>
                    <button onClick={() => setBrowserOpen(false)}>收起网页</button>
                    <button onClick={openMore} aria-label="打开更多操作" disabled={busy}>
                      更多 ···
                    </button>
                  </div>
                ) : (
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
                        {advancedInputPending
                          ? '有未完成输入'
                          : draftSaved
                            ? '草稿已保存'
                            : '有未保存修改'}{' '}
                        · {flatten(edit.flow.steps).length} 个步骤 ·{' '}
                        {edit.flow.sourceTemplate ? '模板流程' : '本地流程'}
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
                        <span className="editor-history-label">撤销</span>
                      </button>
                      <button
                        className="icon-button"
                        aria-label="重做编辑"
                        title="重做编辑 · ⌘/Ctrl Shift Z"
                        disabled={!history.future.length || busy}
                        onClick={redo}
                      >
                        <Redo2 size={16} />
                        <span className="editor-history-label">重做</span>
                      </button>
                    </div>
                    {!compactEditor && (
                      <>
                        <button onClick={exportDraft} disabled={busy}>
                          导出 ZIP
                        </button>
                        <button
                          onClick={openParameters}
                          aria-label="打开流程参数与资源"
                          disabled={busy}
                        >
                          参数与绑定
                        </button>
                      </>
                    )}
                    <button onClick={() => run(edit, true)} disabled={busy || draftHasTools}>
                      逐步调试
                    </button>
                    <button data-browser-toggle onClick={() => setBrowserOpen(!browserOpen)}>
                      {browserOpen ? '收起网页' : '显示网页'}
                    </button>
                    <button
                      className="primary"
                      onClick={() => run(edit)}
                      disabled={busy || draftHasTools}
                    >
                      运行
                    </button>
                    <button
                      className="editor-more-trigger"
                      onClick={openMore}
                      aria-label="打开更多操作"
                      title="更多操作"
                      disabled={busy}
                    >
                      <span className="editor-more-label">更多 </span>···
                    </button>
                  </div>
                ))}
              {draftHasTools && (
                <p className="note" role="status">
                  应用选区与工具方案须从原任务核对对象及影响，并明确确认本次试运行。
                </p>
              )}
              <Editor
                key={edit.id}
                active={!nodeSession && !moreOpen}
                openLibrary={returnHome}
                outlineOpen={outlineOpen}
                outlineMemory={outlineMemory}
                closeOutline={closeOutline}
                openMore={openMore}
                activeRunId={active?.flowId === edit.id ? active.id : undefined}
                blockingRunId={observedActive?.runId}
                draftSaved={draftSaved}
                onInvalidAdvancedInput={setAdvancedInputPending}
                save={save}
                saveBusy={busy}
                saveError={error}
                clearError={() => setError('')}
                undo={undo}
                redo={redo}
                canUndo={!!history.past.length}
                canRedo={!!history.future.length}
                openStepAI={(nodeId: string) => {
                  if (!guardNodeInput()) return;
                  if (!draftSaved) {
                    setError('请先保存当前流程草稿，再让 AI 修改所选步骤');
                    return;
                  }
                  setSelected(nodeId);
                  setTaskSource({
                    record: structuredClone(edit),
                    nodeId,
                    browserOpen,
                    scroll: document.querySelector('main')?.scrollTop ?? 0,
                  });
                  setTaskEntry({ key: uid(), record: structuredClone(edit), nodeId });
                  setTaskReturn(false);
                  setSection('tasks');
                  setBrowserOpen(false);
                  document.querySelector('main')?.scrollTo(0, 0);
                }}
                showRun={(next: any, trigger?: HTMLElement) => {
                  if (trigger) editorFocus.current = trigger;
                  requestEditorLeave(() => {
                    setDetail(next);
                    setRunOrigin('editor');
                    setRunTab('current');
                    setRunFilter(false);
                    setSection('runs');
                  }, '运行详情');
                }}
                revision={history.revision}
                record={edit}
                setRecord={setEdit}
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
                openParameters={openParameters}
                openScript={openScript}
                openExcel={(nodeId: string) => {
                  try {
                    checkEditorInput('打开 Excel 映射编辑器');
                  } catch (e) {
                    setError((e as Error).message);
                    return;
                  }
                  setNodeSession({
                    kind: 'excel',
                    record: structuredClone(edit),
                    nodeId,
                    browserOpen,
                    scroll: document.querySelector('main')?.scrollTop ?? 0,
                  });
                  setBrowserOpen(false);
                  document.querySelector('main')?.scrollTo(0, 0);
                }}
                selected={selected}
                setSelected={setSelected}
                guardNodeInput={guardNodeInput}
                compact={compactEditor}
                panel={editorPanel}
                setPanel={setEditorPanel}
                showBrowser={() => setBrowserOpen(true)}
                browserOpen={browserOpen}
                browserPanel={(picker: { pick?: () => void; focus?: () => void }) =>
                  browserOpen ? (
                    <BrowserSidebar
                      editing
                      onPick={picker.pick}
                      onLocate={picker.focus}
                      close={() => setBrowserOpen(false)}
                      running={!!active && !['PAUSED', 'WAITING_INPUT'].includes(active.state)}
                      obscured={configOpen || !!exportSource}
                    />
                  ) : null
                }
              />
            </div>
          )}
          {section === 'editor' && configOpen && edit?.bindings.configuration && (
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
          {edit && moreOpen && (
            <EditorMorePage
              key={edit.id}
              active={section === 'editor' && !nodeSession}
              record={edit}
              saved={draftSaved}
              busy={busy}
              back={closeMore}
              exportZip={exportDraft}
              outline={openOutline}
              script={openScript}
              openRun={(next) =>
                requestEditorLeave(() => {
                  setDetail(next);
                  setRunOrigin('editor');
                  setRunTab('current');
                  setRunFilter(false);
                  setSection('runs');
                }, '运行详情')
              }
              copy={async (name, id) => {
                setBusy(true);
                try {
                  const { sourceTemplate: _source, ...definition } = structuredClone(edit.flow);
                  const copied = await api('flow.save', {
                    flow: { ...definition, id, name },
                    bindings: {
                      files: {},
                      credentials: [],
                      ...(edit.bindings.configuration
                        ? { configuration: structuredClone(edit.bindings.configuration) }
                        : {}),
                    },
                  });
                  await refresh();
                  return copied as FlowRecord;
                } finally {
                  setBusy(false);
                }
              }}
              openCopy={(copied) =>
                requestEditorLeave(() => {
                  setTaskReturn(false);
                  openFlow(copied);
                }, '新流程')
              }
            />
          )}
          {section === 'editor' && nodeSession?.kind === 'parameters' && (
            <FlowParametersPage
              returnLabel={
                nodeSession.fromSettings ? '凭据与本机资源' : moreOpen ? '更多操作' : '流程编排'
              }
              key={nodeSession.record.id}
              record={nodeSession.record}
              browsers={data.browsers}
              credentials={data.credentials}
              onDirtyChange={setParametersDirty}
              navigation={nodeNavigation}
              close={closeNodeEditor}
              configuration={() => {
                if (nodeSession.record.bindings.template)
                  requestAnimationFrame(() =>
                    editorLeaveRequest.current(() => setSection('templates'), '模板实例'),
                  );
                else setConfigOpen(true);
              }}
              save={async (record) => {
                if (JSON.stringify(edit) !== JSON.stringify(nodeSession.record))
                  throw new Error(
                    '来源流程草稿已经变化，请保留输入并返回重新打开，避免覆盖其他修改',
                  );
                const saved = await api('flow.save', {
                  flow: record.flow,
                  bindings: record.bindings,
                });
                inputGroup.current = undefined;
                setEdit(saved);
                setNotice('已保存参数、资源绑定及流程草稿');
                await refresh().catch((reason) => {
                  setError(
                    '参数已保存，但列表刷新失败：' +
                      (reason instanceof Error ? reason.message : '请稍后刷新'),
                  );
                });
              }}
            />
          )}
          {section === 'editor' && nodeSession?.kind === 'script' && (
            <ScriptEditorPage
              key={nodeSession.record.id + ':' + nodeSession.nodeId}
              record={nodeSession.record}
              nodeId={nodeSession.nodeId}
              initialPreview={nodeSession.preview}
              navigation={nodeNavigation}
              close={closeNodeEditor}
              save={async (record) => {
                if (JSON.stringify(edit) !== JSON.stringify(nodeSession.record))
                  throw new Error(
                    '来源流程草稿已经变化，请保留脚本内容并返回重新打开，避免覆盖其他修改',
                  );
                const saved = await api('flow.save', {
                  flow: record.flow,
                  bindings: record.bindings,
                });
                inputGroup.current = undefined;
                setEdit(saved);
                setNotice('已保存脚本及流程草稿');
                await refresh();
              }}
            />
          )}
          {section === 'editor' && nodeSession?.kind === 'excel' && (
            <ExcelMappingPage
              key={nodeSession.record.id + ':' + nodeSession.nodeId}
              record={nodeSession.record}
              nodeId={nodeSession.nodeId}
              navigation={nodeNavigation}
              close={closeNodeEditor}
              save={async (record) => {
                if (JSON.stringify(edit) !== JSON.stringify(nodeSession.record))
                  throw new Error(
                    '来源流程草稿已经变化，请保留映射并返回重新打开，避免覆盖其他修改',
                  );
                const saved = await api('flow.save', {
                  flow: record.flow,
                  bindings: record.bindings,
                });
                inputGroup.current = undefined;
                setEdit(saved);
                setNotice('已保存 Excel 映射及流程草稿');
                await refresh();
              }}
            />
          )}
          {section === 'runs' && (
            <div className="page runs-page">
              <RunHistory
                visible={!detail}
                flows={data.flows}
                filterOpen={runFilter}
                setFilterOpen={setRunFilter}
                setPage={setRunPage}
                open={(next) => {
                  setRunOrigin('history');
                  setRunTab('current');
                  setDetail(next);
                }}
              />
              {detail && runOrigin === 'task' && (
                <TaskRunPage
                  key={detail.run.id}
                  detail={detail}
                  fault={data.fault}
                  page={taskRunView}
                  restored={taskRunRestored}
                  setPage={setTaskRunView}
                  navigate={(intent) => {
                    setDetail(null);
                    setSection('tasks');
                    taskRunBack.current?.(intent);
                  }}
                  history={() => {
                    setDetail(null);
                    setRunOrigin('history');
                    setRunFilter(false);
                  }}
                  connections={() => {
                    setToolsOrigin('runs');
                    setSection('tools');
                    setBrowserOpen(false);
                    desktopAssistantOpener.current?.();
                  }}
                  control={(id, action) => api('run.control', { id, action })}
                  reveal={(id) => api('artifact.reveal', { id })}
                  showBrowser={() => setBrowserOpen(true)}
                  hideBrowser={() => setBrowserOpen(false)}
                  open={(next, context) => {
                    if (next.run.id === detail.run.id) return;
                    setTaskRunTrail((trail) =>
                      context ? [...trail, { targetId: next.run.id, context }] : [],
                    );
                    setTaskRunRestored(undefined);
                    setTaskRunView('overview');
                    setDetail((current: any) =>
                      current?.run.id === detail.run.id ? next : current,
                    );
                  }}
                />
              )}
              {detail && runOrigin !== 'task' && (
                <RunDetail
                  key={detail.run.id}
                  detail={detail}
                  fault={data.fault}
                  open={(next) => {
                    setRunTab('current');
                    setDetail((current: any) =>
                      current?.run.id === detail.run.id ? next : current,
                    );
                  }}
                  reload={async () => {
                    const id = detail.run.id;
                    const next = await api('run.detail', { id });
                    setDetail((current: any) => (current?.run.id === id ? next : current));
                  }}
                  tab={runTab}
                  setTab={changeRunTab}
                  cancelRerun={returnRunSubview}
                  rerunBusy={setRunRerunBusy}
                  showBrowser={() => setBrowserOpen(true)}
                  control={(id, a) => api('run.control', { id, action: a })}
                  reveal={(id) => api('artifact.reveal', { id })}
                />
              )}
            </div>
          )}
          {section === 'template-schedule' && templateOrigin && (
            <TemplateSchedulePage
              origin={templateOrigin}
              data={data}
              action={action}
              navigation={scheduleNavigation}
              back={returnTemplate}
              manage={() => leaveTemplateContext(() => setSection('schedules'), '本机计划')}
            />
          )}
          <div hidden={section !== 'schedules'}>
            <Schedules
              data={data}
              action={action}
              active={section === 'schedules'}
              browserControl={
                <button
                  className="embedded-show"
                  aria-label={browserOpen ? '收起网页面板' : '打开网页面板'}
                  aria-pressed={browserOpen}
                  onClick={() => setBrowserOpen(!browserOpen)}
                >
                  {browserOpen ? '收起网页' : '显示网页'}
                </button>
              }
              navigation={plansNavigation}
              showRun={(next, back) => {
                scheduleRunBack.current = back;
                setRunOrigin('schedule');
                setRunTab('current');
                setRunFilter(false);
                setDetail(next);
                setSection('runs');
              }}
            />
          </div>
          <AttentionWorkspace
            data={data}
            active={section === 'inbox'}
            refresh={reloadSettingsData}
            navigation={setAttentionNavigation}
            showBrowser={() => setBrowserOpen(true)}
            openRun={(next) => {
              setRunOrigin('inbox');
              setRunTab('current');
              setRunFilter(false);
              setDetail(next);
              setSection('runs');
            }}
          />
          <LocalSettingsPage
            tabRequest={settingsTabRequest}
            data={data}
            active={section === 'settings'}
            refresh={reloadSettingsData}
            navigation={setSettingsNavigation}
            showBrowser={() => setBrowserOpen(true)}
            openRuns={() => {
              setDetail(null);
              setRunOrigin('history');
              setRunTab('current');
              setSection('runs');
              setBrowserOpen(false);
            }}
            openTools={() => {
              setToolsOrigin('settings');
              setSection('tools');
              setBrowserOpen(false);
            }}
            openFlow={async (record, resources) => {
              if (!(await openFlow(record, true)) || !resources) return;
              setNodeSession({
                kind: 'parameters',
                fromSettings: true,
                record: structuredClone(record),
                nodeId: '',
                browserOpen: false,
                panel: 'canvas',
                scroll: 0,
              });
              setBrowserOpen(false);
              document.querySelector('main')?.scrollTo(0, 0);
            }}
            openAI={(provider, model) => {
              setTaskAISettings({ key: crypto.randomUUID(), provider, model });
              setTaskReturn(false);
              setSection('ai-settings');
              setBrowserOpen(false);
            }}
          />
          <AISettingsPage
            templateLibrary={() =>
              leaveAIContext(() => {
                setTemplateHomeRequest(crypto.randomUUID());
                setSection('templates');
                setTaskReturn(false);
              }, '模板库')
            }
            active={section === 'ai-settings'}
            entry={taskAISettings}
            selectProvider={(provider) => {
              if (taskAISettings.source) return;
              setTaskAISettings({
                key: crypto.randomUUID(),
                provider,
                model: defaultAIModel(provider),
              });
            }}
            home={(tab) =>
              leaveAIContext(
                () => {
                  if (tab) setSettingsTabRequest({ key: crypto.randomUUID(), tab });
                  setSection('settings');
                },
                tab === 'browser'
                  ? '浏览器设置'
                  : tab === 'resources'
                    ? '凭据与本机资源'
                    : tab === 'scripts'
                      ? '脚本包配置'
                      : '本地设置',
              )
            }
            navigation={aiSettingsNavigation}
            changed={refresh}
            onSaved={(configuration) => {
              if (
                taskAISettings.source &&
                taskAISettings.source.kind !== 'template' &&
                configuration.configured
              )
                setConfiguredAI({
                  key: crypto.randomUUID(),
                  provider: configuration.provider,
                  model: configuration.model,
                });
            }}
            back={() => {
              setSection(
                taskAISettings.source?.kind === 'template'
                  ? 'templates'
                  : taskAISettings.source
                    ? 'tasks'
                    : 'settings',
              );
              setTaskReturn(false);
            }}
          />
        </main>
        {browserOpen && section !== 'editor' && (
          <BrowserSidebar
            observationRequest={browserObservationRequest}
            returnFromObservation={returnFromBrowserObservation}
            close={() => setBrowserOpen(false)}
            running={!!active && !['PAUSED', 'WAITING_INPUT'].includes(active.state)}
            obscured={!!exportSource || (section === 'editor' && configOpen)}
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
  active,
  openLibrary,
  record: r,
  setRecord,
  selected,
  setSelected,
  revision,
  guardNodeInput,
  compact,
  panel,
  setPanel,
  browserOpen,
  showBrowser,
  browserPanel,
  choose,
  openParameters,
  openScript,
  openExcel,
  openStepAI,
  outlineOpen,
  outlineMemory,
  closeOutline,
  openMore,
  activeRunId,
  blockingRunId,
  draftSaved,
  onInvalidAdvancedInput,
  save,
  showRun,
  saveBusy,
  saveError,
  clearError,
  undo,
  redo,
  canUndo,
  canRedo,
}: any) {
  const pickerControls = useRef<ElementPickerControls>(null);
  const [positionOpen, setPositionOpen] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);
  const [browserActionOpen, setBrowserActionOpen] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [logicConfigurationOpen, setLogicConfigurationOpen] = useState(false);
  const [scriptConfigurationOpen, setScriptConfigurationOpen] = useState(false);
  const [viewRequest, setViewRequest] = useState<{ key: number; mode: 'all' | 'selected' }>();
  const [tab, setTab] = useState('node');
  const [destination, setDestination] = useState('main');
  const [moveTo, setMoveTo] = useState('');
  const [structureError, setStructureError] = useState('');
  const [raw, setRaw] = useState('');
  const [invalid, setInvalid] = useState('');
  const [copiedStep, setCopiedStep] = useState<{ id: string; flowId: string; count: number }>();
  const advancedField = useRef<HTMLTextAreaElement>(null);
  const copyFeedback = useRef<HTMLElement>(null);
  useEffect(() => {
    onInvalidAdvancedInput(!!invalid);
    return () => onInvalidAdvancedInput(false);
  }, [invalid, onInvalidAdvancedInput]);
  useEffect(() => {
    if (copiedStep && active && !positionOpen) copyFeedback.current?.focus();
  }, [copiedStep, active, positionOpen]);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const canvasElement = useRef<HTMLDivElement>(null);
  const summaryEditButton = useRef<HTMLButtonElement>(null);
  const keyboardStep = useRef<string | null>(null);
  const pendingStepFocus = useRef<'inspector' | 'canvas' | null>(null);
  const selectedNode = flatten(r.flow.steps).find((n: Step) => n.id === selected);
  const compactBrowser = compact && browserOpen && selectedNode?.type === 'browser';
  const readInspector = selectedNode?.type === 'browser' && selectedNode.operation === 'read';
  useEffect(() => {
    if (!active || !compact || outlineOpen || !pendingStepFocus.current) return;
    if (pendingStepFocus.current === 'inspector' && panel === 'node') {
      inspectorHeading.current?.focus({ preventScroll: true });
      pendingStepFocus.current = null;
    } else if (pendingStepFocus.current === 'canvas' && ['canvas', 'graph'].includes(panel)) {
      if (browserOpen && panel === 'canvas' && selectedNode) {
        summaryEditButton.current?.focus({ preventScroll: true });
      } else {
        canvasElement.current
          ?.querySelector<HTMLElement>(`[data-id="${CSS.escape(keyboardStep.current ?? '')}"]`)
          ?.focus({ preventScroll: true });
      }
      pendingStepFocus.current = null;
      keyboardStep.current = null;
    }
  }, [active, compact, outlineOpen, panel, selected, browserOpen]);
  useEffect(() => {
    if (panel === 'params' || panel === 'node') setTab(panel);
  }, [panel]);
  useEffect(() => {
    setRaw(selectedNode ? JSON.stringify(selectedNode, null, 2) : '');
    setInvalid('');
    setMoveTo('');
    setStructureError('');
  }, [selected, revision]);
  useEffect(() => {
    if (draftSaved || (copiedStep && (copiedStep.id !== selected || copiedStep.flowId !== r.id)))
      setCopiedStep(undefined);
  }, [draftSaved, selected, copiedStep, r.id]);
  const patch = (fn: (n: Step) => Step | null) => {
    setCopiedStep(undefined);
    const steps = changeSteps(r.flow.steps, selected, fn);
    const mapped = flatten(steps).some((node) => node.type === 'excel' && node.operation === 'map');
    const createsText = flatten(steps).some(
      (node) => node.type === 'file' && node.operation === 'create' && node.version === 3,
    );
    const numbersText = flatten(steps).some(
      (node) => node.type === 'file' && node.operation === 'create' && node.version === 4,
    );
    setRecord({
      ...r,
      flow: {
        ...r.flow,
        steps,
        requiredCapabilities: [
          ...new Set([
            ...r.flow.requiredCapabilities,
            ...(mapped ? ['excel-mapping-v1'] : []),
            ...(flatten(steps).some((node) => node.type === 'mcp') ? ['mcp-tool-v1'] : []),
            ...(flatten(steps).some((node) => node.type === 'desktop')
              ? ['desktop-selection-v1']
              : []),
            ...(createsText ? ['file-create-v1'] : []),
            ...(numbersText ? ['file-create-numbered-v1'] : []),
          ]),
        ],
      },
    });
  };
  const structure = (build: () => Step[], nextSelected = selected) => {
    if (!guardNodeInput()) return false;
    try {
      const steps = build();
      checkStructure(r.flow.steps, steps, r.flow.parameters);
      setRecord({ ...r, flow: { ...r.flow, steps } });
      setSelected(nextSelected);
      setTab('node');
      if (compact) setPanel('node');
      setStructureError('');
      setCopiedStep(undefined);
      return true;
    } catch (error: any) {
      setStructureError(error.message);
      return false;
    }
  };
  const append = (node: Step, target: Destination) => {
    const added = structure(() => insertStep(r.flow.steps, node, target), node.id);
    if (added && compact && panel === 'actions') {
      keyboardStep.current = node.id;
      pendingStepFocus.current = 'inspector';
    }
    if (added && target.side === 'after') setDestination(node.id + ':after');
    return added;
  };
  const duplicate = () => {
    try {
      const result = duplicateStep(r.flow.steps, selected);
      if (structure(() => result.steps, result.id)) {
        setCopiedStep({
          id: result.id,
          flowId: r.id,
          count: selectedNode ? flatten([selectedNode]).length : 1,
        });
      }
    } catch (error: any) {
      setStructureError(error.message);
    }
  };
  const insertAt = (side: 'before' | 'after') => {
    if (!guardNodeInput()) return;
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
    if (!guardNodeInput(false)) return;
    patch(() => next);
    setRaw(JSON.stringify(next, null, 2));
    setInvalid('');
  };
  const { nodes, edges, stepCount } = buildTaskDiagram(r.flow, selected, {
    bindings: r.bindings,
  });
  const changePanel = (value: string) => {
    if (value === 'params') {
      openParameters();
      return;
    }
    if (guardNodeInput()) {
      if (compact && browserOpen && value === 'canvas' && selected) {
        keyboardStep.current = selected;
        pendingStepFocus.current = 'canvas';
      } else if (['canvas', 'graph'].includes(value) && keyboardStep.current)
        pendingStepFocus.current = 'canvas';
      setPanel(value);
    }
  };
  const updateScriptPackage = (
    name: string,
    info?: { name: string; version: string; path: string },
  ) => {
    if (!guardNodeInput() || selectedNode?.type !== 'script') return false;
    const next = editScriptPackage(r, selectedNode, name, info);
    setRecord(next);
    setRaw(
      JSON.stringify(
        flatten(next.flow.steps).find((node) => node.id === selected),
        null,
        2,
      ),
    );
    setInvalid('');
    return true;
  };
  const advancedInput = selectedNode ? (
    <details
      className="node-advanced"
      data-value-invalid={invalid || undefined}
      key={selectedNode.id + ':advanced'}
    >
      <summary>高级配置 JSON</summary>
      <label>节点配置 JSON</label>
      <textarea
        ref={advancedField}
        aria-label="节点配置 JSON"
        aria-invalid={!!invalid}
        aria-describedby={invalid ? 'node-json-feedback' : undefined}
        className="code-input"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          try {
            const value = parseNodeDraft(e.target.value, selectedNode, r.flow);
            patch(() => value);
            setInvalid('');
          } catch (e: any) {
            setInvalid(e.message);
          }
        }}
      />
      {invalid && (
        <section className="editor-feedback is-error" id="node-json-feedback" role="alert">
          <span className="editor-feedback-badge">无法提交</span>
          <h3>高级输入尚未完成</h3>
          <p>这段 JSON 尚未应用。请修正输入，或恢复上次有效的节点配置后继续。</p>
          <pre tabIndex={0} aria-label="节点配置错误详情">
            {invalid}
          </pre>
          <div className="editor-feedback-actions">
            <button
              type="button"
              className="primary"
              onClick={() => advancedField.current?.focus()}
            >
              修正输入
            </button>
            <button
              type="button"
              onClick={() => {
                setRaw(JSON.stringify(selectedNode, null, 2));
                setInvalid('');
                advancedField.current?.focus();
              }}
            >
              恢复节点配置
            </button>
          </div>
        </section>
      )}
      <p className="note">
        显式设置容器 timeoutMs 时，超时包含内部等待和暂停；人工节点未配置时不设节点超时。
      </p>
      <p className="note">
        引用示例：<code>{'{"$ref":"steps.greeting.message"}'}</code>
        。循环体可引用 item 和 index。
      </p>
    </details>
  ) : null;
  const browserConfiguration =
    selectedNode?.type === 'browser' ? (
      <BrowserNodeConfiguration
        pickerControls={pickerControls}
        compact={compactBrowser}
        key={selectedNode.id + ':' + revision}
        active={
          active &&
          (!compact || panel === 'node') &&
          !outlineOpen &&
          !browserActionOpen &&
          !controlOpen &&
          !resourceOpen &&
          !logicConfigurationOpen &&
          !scriptConfigurationOpen &&
          !positionOpen
        }
        blockingRunId={blockingRunId}
        onViewRun={showRun}
        node={selectedNode}
        choices={choices}
        change={(next) => {
          if (!guardNodeInput(false)) return;
          patch(() => next);
          setRaw(JSON.stringify(next, null, 2));
          setInvalid('');
        }}
      />
    ) : null;
  const returnToFlow = () => {
    if (!guardNodeInput()) return false;
    setScriptConfigurationOpen(false);
    setLogicConfigurationOpen(false);
    setResourceOpen(false);
    setBrowserActionOpen(false);
    setControlOpen(false);
    setPanel('node');
    requestAnimationFrame(() => inspectorHeading.current?.focus({ preventScroll: true }));
    return true;
  };
  return (
    <VariableNavigationContext.Provider
      value={{
        flowName: r.flow.name,
        source: scriptConfigurationOpen
          ? '脚本配置'
          : logicConfigurationOpen
            ? '数据与逻辑配置'
            : resourceOpen
              ? '文件与表格配置'
              : browserActionOpen
                ? '网页动作配置'
                : controlOpen
                  ? '条件与串行循环'
                  : compact && browserOpen
                    ? '紧凑配置抽屉'
                    : browserOpen
                      ? '网页操作与拾取'
                      : '步骤配置',
        openFlow: returnToFlow,
        showBrowser: () => {
          if (returnToFlow()) showBrowser();
        },
        openLibrary: () => {
          if (returnToFlow()) requestAnimationFrame(openLibrary);
        },
      }}
    >
      {scriptConfigurationOpen && active && selectedNode?.type === 'script' && (
        <ScriptConfigurationWorkspace
          record={r}
          node={selectedNode as ScriptNode}
          change={updateNode}
          guard={guardNodeInput}
          bind={(info) => updateScriptPackage(info.name, info)}
          remove={(name) => updateScriptPackage(name)}
          close={() => setScriptConfigurationOpen(false)}
          openEditor={(preview) => {
            openScript(selectedNode.id, preview);
          }}
          openParameters={() => {
            openParameters();
          }}
          showBrowser={() => {
            setScriptConfigurationOpen(false);
            setPanel('node');
            showBrowser();
          }}
          error={saveError}
          clearError={clearError}
        />
      )}
      {logicConfigurationOpen && (
        <LogicConfigurationWorkspace
          record={r}
          selected={selected}
          select={setSelected}
          change={updateNode}
          changeTiming={(next) => {
            if (invalid) {
              guardNodeInput();
              return;
            }
            patch(() => next);
            setRaw(JSON.stringify(next, null, 2));
          }}
          add={(node) => append(node, {})}
          guard={guardNodeInput}
          close={() => setLogicConfigurationOpen(false)}
          showBrowser={() => {
            setLogicConfigurationOpen(false);
            setPanel('node');
            showBrowser();
          }}
          openControl={() => {
            setLogicConfigurationOpen(false);
            setControlOpen(true);
          }}
          advanced={advancedInput}
          advancedInvalid={!!invalid}
          error={saveError || structureError}
          clearError={() => {
            clearError();
            setStructureError('');
          }}
        />
      )}
      {resourceOpen && (
        <ResourceWorkspace
          record={r}
          selected={selected}
          select={setSelected}
          change={updateNode}
          choose={choose}
          add={(node) => append(node, {})}
          guard={guardNodeInput}
          close={() => setResourceOpen(false)}
          showBrowser={() => {
            setResourceOpen(false);
            setPanel('node');
            showBrowser();
          }}
          openExcel={(id) => {
            setResourceOpen(false);
            openExcel(id);
          }}
          error={saveError || structureError}
          clearError={() => {
            clearError();
            setStructureError('');
          }}
        />
      )}
      {browserActionOpen && selectedNode?.type === 'browser' && (
        <BrowserActionWorkspace
          record={r}
          node={selectedNode}
          change={updateNode}
          guard={guardNodeInput}
          close={() => setBrowserActionOpen(false)}
          showBrowser={() => {
            setBrowserActionOpen(false);
            setPanel('node');
            showBrowser();
          }}
          error={saveError}
          clearError={clearError}
        />
      )}
      {controlOpen && (
        <ControlWorkspace
          record={r}
          selected={selected}
          select={(id) => {
            if (guardNodeInput()) setSelected(id);
          }}
          change={updateNode}
          destination={destination}
          setDestination={setDestination}
          targets={targets}
          add={() => {
            if (!guardNodeInput()) return;
            setControlOpen(false);
            setPanel('actions');
            requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>('[aria-label="搜索动作"]')?.focus(),
            );
          }}
          edit={() => {
            if (guardNodeInput()) {
              setControlOpen(false);
              setPanel('node');
              requestAnimationFrame(() =>
                document.querySelector<HTMLInputElement>('#step-name')?.focus(),
              );
            }
          }}
          close={() => {
            if (guardNodeInput()) setControlOpen(false);
          }}
          save={save}
          busy={saveBusy}
          saved={draftSaved}
          error={saveError}
          clearError={clearError}
        />
      )}
      {positionOpen && (
        <StepPositionPage
          title={
            selectedNode
              ? `${flatten(r.flow.steps).findIndex((node) => node.id === selected) + 1} ${stepTitle(selectedNode)}`
              : undefined
          }
          targets={targets}
          destination={
            targets.some((target) => target.value === destination) ? destination : 'main'
          }
          setDestination={setDestination}
          moveTo={moveTo}
          setMoveTo={setMoveTo}
          add={() => {
            setPositionOpen(false);
            setPanel('actions');
            requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>('[aria-label="搜索动作"]')?.focus(),
            );
          }}
          insert={(side) => {
            setPositionOpen(false);
            insertAt(side);
          }}
          duplicate={duplicate}
          move={() => {
            const target = targets.find((target) => target.value === moveTo);
            if (target) structure(() => moveStep(r.flow.steps, selected, target));
          }}
          remove={() => {
            if (structure(() => changeSteps(r.flow.steps, selected, () => null), ''))
              setDestination('main');
          }}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          saved={draftSaved}
          save={save}
          busy={saveBusy}
          structureError={structureError}
          saveError={saveError}
          close={() => setPositionOpen(false)}
          view={(mode) => {
            setPositionOpen(false);
            setPanel('graph');
            setViewRequest((previous) => ({ key: (previous?.key ?? 0) + 1, mode }));
            requestAnimationFrame(() =>
              canvasElement.current
                ?.querySelector<HTMLButtonElement>(
                  mode === 'all' ? '[aria-label="显示完整流程"]' : '[aria-label="聚焦所选步骤"]',
                )
                ?.focus({ preventScroll: true }),
            );
          }}
        />
      )}
      {(outlineOpen || outlineMemory.current.has(r.id)) && (
        <FlowOutlineWorkspace
          visible={outlineOpen && active}
          record={r}
          selected={selected}
          select={setSelected}
          edit={(id) => {
            if (!guardNodeInput()) return;
            setSelected(id);
            setTab('node');
            closeOutline('node');
          }}
          editAI={openStepAI}
          activeRunId={activeRunId}
          saved={draftSaved}
          save={save}
          showRun={showRun}
          memory={outlineMemory}
          more={openMore}
        />
      )}
      <div
        className={`editor-region ${compact ? 'is-compact' : ''} ${browserOpen ? 'has-browser' : ''}`}
        data-panel={panel}
        data-selected={!!selectedNode}
        style={outlineOpen ? { display: 'none' } : undefined}
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
          <button
            aria-label="打开流程参数与资源"
            aria-pressed={panel === 'params'}
            onClick={() => changePanel('params')}
          >
            参数
          </button>
          {compact && !browserOpen && ['actions', 'node', 'params'].includes(panel) && (
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
            <div className="canvas" ref={canvasElement}>
              <DiagramCanvas
                key={r.id}
                taskPresentation
                active={
                  active &&
                  !outlineOpen &&
                  !positionOpen &&
                  !controlOpen &&
                  !browserActionOpen &&
                  !resourceOpen &&
                  !logicConfigurationOpen &&
                  !scriptConfigurationOpen
                }
                viewRequest={viewRequest}
                nodes={nodes}
                edges={edges}
                selected={selected}
                select={(id, source) => {
                  if (!guardNodeInput()) return;
                  keyboardStep.current = compact && source === 'keyboard' ? id : null;
                  pendingStepFocus.current = keyboardStep.current ? 'inspector' : null;
                  setSelected(id);
                  setTab('node');
                  if (compact) setPanel('node');
                }}
              />
              <span className="canvas-label">执行流程 · {stepCount} 个步骤</span>
            </div>
            <section className="selected-step-summary" aria-label="当前步骤">
              <h2>
                {selectedNode
                  ? (typeof selectedNode.name === 'string' && selectedNode.name) ||
                    kinds[selectedNode.type]?.label
                  : '选择一个步骤'}
              </h2>
              <div className="selected-step-target">
                <span>目标</span>
                <p>
                  {selectedNode?.type === 'browser'
                    ? typeof selectedNode.selector === 'string'
                      ? selectedNode.selector || '尚未选择网页目标'
                      : '使用变量定位网页目标'
                    : '在流程图中选择需要编辑的步骤。'}
                </p>
              </div>
              <button
                ref={summaryEditButton}
                className="primary"
                disabled={!selectedNode}
                onClick={() => changePanel('node')}
              >
                编辑当前步骤
              </button>
              <p>当前步骤保持可见；动作库与配置使用互斥抽屉。</p>
            </section>
            <aside
              className={`inspector${compactBrowser ? ' compact-browser-inspector' : ''}${readInspector ? ' has-read-inspector' : ''}`}
              onFocusCapture={(event) => {
                if ((event.target as HTMLElement).closest('.value-source-button')) setPanel('node');
              }}
            >
              <div className="inspector-content">
                <div className="tabs" role="group" aria-label="检查器内容">
                  {[
                    ['node', '节点'],
                    ['params', '参数'],
                  ].map(([k, t]) => (
                    <button
                      key={k}
                      aria-pressed={tab === k}
                      onClick={() => {
                        if (k === 'params') {
                          openParameters();
                          return;
                        }
                        if (guardNodeInput()) {
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
                {copiedStep && copiedStep.id === selected && !draftSaved && (
                  <section
                    className="editor-feedback"
                    role="status"
                    ref={copyFeedback}
                    tabIndex={-1}
                    aria-label="复制完成"
                  >
                    <span className="editor-feedback-badge">草稿已更改</span>
                    <h3>复制完成</h3>
                    <p>已复制 {copiedStep.count} 个步骤并重建内部引用；尚未保存，没有启动运行。</p>
                    <button
                      className="primary"
                      onClick={() => {
                        setCopiedStep(undefined);
                        setTab('node');
                        setPanel('node');
                        requestAnimationFrame(() => inspectorHeading.current?.focus());
                      }}
                    >
                      查看草稿
                    </button>
                  </section>
                )}
                {tab === 'node' &&
                  (readInspector && selectedNode?.type === 'browser' ? (
                    <>
                      <fieldset
                        disabled={!!invalid}
                        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                      >
                        <ReadStepInspector
                          key={selectedNode.id + ':' + revision}
                          pickerControls={pickerControls}
                          record={r}
                          node={selectedNode}
                          heading={inspectorHeading}
                          active={
                            active &&
                            (!compact || panel === 'node') &&
                            !positionOpen &&
                            !browserActionOpen &&
                            !outlineOpen
                          }
                          blockingRunId={blockingRunId}
                          onViewRun={showRun}
                          change={updateNode}
                          changeTiming={(next) => {
                            if (invalid) {
                              guardNodeInput();
                              return;
                            }
                            patch(() => next);
                            setRaw(JSON.stringify(next, null, 2));
                          }}
                          guard={() => {
                            if (!guardNodeInput()) return false;
                            clearError();
                            return true;
                          }}
                          position={() => {
                            if (!guardNodeInput()) return;
                            setStructureError('');
                            setPanel('node');
                            setPositionOpen(true);
                          }}
                          view={(mode) => {
                            if (!guardNodeInput()) return;
                            setViewRequest((previous) => ({ key: (previous?.key ?? 0) + 1, mode }));
                            if (compact) {
                              keyboardStep.current = selected;
                              pendingStepFocus.current = 'canvas';
                              setPanel('graph');
                            }
                          }}
                          select={(id) => {
                            if (!guardNodeInput()) return;
                            setSelected(id);
                            setPanel('node');
                            requestAnimationFrame(() => inspectorHeading.current?.focus());
                          }}
                        />
                      </fieldset>
                      {structureError && (
                        <p className="field-error" role="alert">
                          {structureError}
                        </p>
                      )}
                      <details className="read-step-more">
                        <summary>更多步骤设置</summary>
                        <button
                          onClick={() => {
                            if (!guardNodeInput()) return;
                            setPanel('node');
                            setBrowserActionOpen(true);
                          }}
                        >
                          网页动作配置
                        </button>
                        <button
                          data-ai-edit-step
                          disabled={!draftSaved}
                          onClick={() => openStepAI(selectedNode.id)}
                        >
                          用 AI 修改此步
                        </button>
                        {advancedInput}
                      </details>
                    </>
                  ) : selectedNode ? (
                    <>
                      <fieldset
                        disabled={!!invalid}
                        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                      >
                        {selectedNode.type === 'browser' && (
                          <>
                            <h3
                              className="compact-config-heading"
                              ref={inspectorHeading}
                              tabIndex={-1}
                            >
                              配置 · {browserActions[selectedNode.operation].label}
                            </h3>
                            {browserConfiguration}
                            <NodeTiming
                              key={selectedNode.id + ':timing:' + revision}
                              compact={compactBrowser}
                              node={selectedNode}
                              change={(next) => {
                                patch(() => next);
                                setRaw(JSON.stringify(next, null, 2));
                              }}
                            />
                          </>
                        )}
                        <details
                          key={selectedNode.id + ':' + compactBrowser}
                          className={
                            compactBrowser ? 'compact-step-settings' : 'step-settings-expanded'
                          }
                          open={compactBrowser ? undefined : true}
                        >
                          <summary hidden={!compactBrowser}>步骤与更多设置</summary>
                          <div className="inspector-heading">
                            <h3
                              ref={selectedNode.type === 'browser' ? undefined : inspectorHeading}
                              tabIndex={-1}
                            >
                              {kinds[selectedNode.type].label}
                            </h3>
                            <button
                              className="icon-button"
                              aria-label="节点上移"
                              title="在当前分支上移"
                              disabled={!location || location.index === 0}
                              onClick={() =>
                                structure(() => moveSibling(r.flow.steps, selected, -1))
                              }
                            >
                              <ArrowUp size={16} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label="节点下移"
                              title="在当前分支下移"
                              disabled={
                                !location || location.index === location.siblings.length - 1
                              }
                              onClick={() =>
                                structure(() => moveSibling(r.flow.steps, selected, 1))
                              }
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
                          <button
                            onClick={() => {
                              if (!guardNodeInput()) return;
                              setStructureError('');
                              setPanel('node');
                              setPositionOpen(true);
                            }}
                          >
                            步骤编辑与位置
                          </button>
                          {structureError && (
                            <p className="field-error" role="alert">
                              {structureError}
                            </p>
                          )}
                          <p className="muted">{selectedNode.id} · 修改后保存，下一次运行生效</p>
                          <button
                            data-ai-edit-step
                            disabled={!draftSaved}
                            onClick={() => openStepAI(selectedNode.id)}
                          >
                            用 AI 修改此步
                          </button>
                          {!draftSaved && <p className="muted">保存草稿后可使用 AI 单步修改。</p>}
                          {!['file', 'excel'].includes(selectedNode.type) && (
                            <>
                              <label htmlFor="step-name">步骤名称</label>
                              <input
                                id="step-name"
                                value={
                                  typeof selectedNode.name === 'string' ? selectedNode.name : ''
                                }
                                placeholder="便于识别的名称（可选）"
                                onChange={(e) =>
                                  updateNode({ ...selectedNode, name: e.target.value })
                                }
                              />
                            </>
                          )}
                          {['value', 'condition', 'assert', 'loop', 'human'].includes(
                            selectedNode.type,
                          ) && (
                            <button
                              onClick={() => {
                                if (!guardNodeInput()) return;
                                setPanel('node');
                                setLogicConfigurationOpen(true);
                              }}
                            >
                              流程控制配置
                            </button>
                          )}
                          {['http', 'file', 'excel'].includes(selectedNode.type) && (
                            <button
                              onClick={() => {
                                if (!guardNodeInput()) return;
                                setPanel('node');
                                setResourceOpen(true);
                              }}
                            >
                              HTTP文件与表格配置
                            </button>
                          )}
                          {selectedNode.type === 'browser' && (
                            <button
                              onClick={() => {
                                if (!guardNodeInput()) return;
                                setPanel('node');
                                setBrowserActionOpen(true);
                              }}
                            >
                              网页动作配置
                            </button>
                          )}
                          {['loop', 'condition'].includes(selectedNode.type) && (
                            <button
                              onClick={() => {
                                if (!guardNodeInput()) return;
                                setPanel('node');
                                setControlOpen(true);
                              }}
                            >
                              条件与串行循环
                            </button>
                          )}
                          {selectedNode.type !== 'browser' &&
                            !logicConfigurationOpen &&
                            !scriptConfigurationOpen && (
                              <>
                                <NodeTiming
                                  key={selectedNode.id + ':timing:' + revision}
                                  node={selectedNode}
                                  change={(next) => {
                                    patch(() => next);
                                    setRaw(JSON.stringify(next, null, 2));
                                  }}
                                />
                                <LogicNodeConfiguration
                                  key={selectedNode.id + ':logic:' + revision}
                                  node={selectedNode}
                                  choices={choices}
                                  change={updateNode}
                                />
                              </>
                            )}
                          {selectedNode.type === 'excel' && selectedNode.operation === 'map' && (
                            <button
                              className="primary"
                              aria-label="打开 Excel 映射编辑器"
                              onClick={() => openExcel(selectedNode.id)}
                            >
                              打开 Excel 映射编辑器
                            </button>
                          )}
                          {selectedNode.type === 'mcp' && (
                            <McpNodeConfiguration
                              key={selectedNode.id + ':' + revision}
                              node={selectedNode}
                              targets={r.toolTargets}
                              choices={choices}
                              change={updateNode}
                            />
                          )}
                          {selectedNode.type === 'desktop' && (
                            <DesktopStepDetails node={selectedNode} />
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
                            <button
                              onClick={() => {
                                if (guardNodeInput()) {
                                  setPanel('node');
                                  setScriptConfigurationOpen(true);
                                }
                              }}
                            >
                              脚本与依赖配置
                            </button>
                          )}
                          {selectedNode.type === 'script' &&
                            active &&
                            !outlineOpen &&
                            !scriptConfigurationOpen && (
                              <>
                                <button
                                  className="primary"
                                  aria-label="打开完整脚本编辑器"
                                  onClick={() => openScript(selectedNode.id)}
                                >
                                  打开脚本编辑器
                                </button>
                                <label>可信脚本 · 独立进程执行</label>
                                <Suspense fallback={<p>加载编辑器…</p>}>
                                  <CodeEditor
                                    value={selectedNode.code}
                                    language={
                                      selectedNode.language === 'ts' ? 'typescript' : 'javascript'
                                    }
                                    onChange={(code) => {
                                      if (!guardNodeInput(false)) return;
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
                                    if (!guardNodeInput(false)) return false;
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
                                    if (!guardNodeInput(false)) return false;
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
                        </details>
                      </fieldset>
                      {!logicConfigurationOpen && advancedInput}
                    </>
                  ) : (
                    <Empty text="选择画布节点，编辑参数或脚本。" />
                  ))}
              </div>
              {compact && browserOpen && ['node', 'params'].includes(panel) && (
                <div className="drawer-footer">
                  <button className="primary" onClick={() => changePanel('canvas')}>
                    应用并关闭
                  </button>
                </div>
              )}
            </aside>
          </div>
          {browserPanel({
            ...(selectedNode?.type === 'browser' &&
            !['navigate', 'screenshot'].includes(selectedNode.operation)
              ? {
                  pick: () => {
                    if (!guardNodeInput()) return;
                    setTab('node');
                    setPanel('node');
                    requestAnimationFrame(() => pickerControls.current?.pick());
                  },
                  focus: () => {
                    if (!guardNodeInput()) return;
                    setTab('node');
                    setPanel('node');
                    requestAnimationFrame(() => pickerControls.current?.focus());
                  },
                }
              : {}),
          })}
        </div>
      </div>
    </VariableNavigationContext.Provider>
  );
}
