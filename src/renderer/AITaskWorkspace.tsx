import { ConfigProvider, Select, Button, Checkbox, Input } from 'antd';
import TaskMissingAI from './TaskMissingAI';
import TaskStepList, { type TaskStepListHandle } from './TaskStepList';
import TaskStepInspector from './TaskStepInspector';
import TaskPlanConversation from './TaskPlanConversation';
import { taskAdoptionSummary } from './task-adoption-summary';
import { taskProposalSummary } from './task-proposal-summary';
import TaskPlanIdentity from './TaskPlanIdentity';
import TaskProposalReview from './TaskProposalReview';
import TaskPlanScope from './TaskPlanScope';
import TaskLatestRun from './TaskLatestRun';
import TaskModificationPage from './TaskModificationPage';
import TaskGenerationPage from './TaskGenerationPage';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { Bootstrap, FlowRecord, Step } from '../shared/types';
import type { PlanningChange, PlanningContext, PlanningTask, TaskDetail } from '../shared/planning';
import { buildDiagram } from './flow-diagram';
import { buildTaskDiagram } from './task-diagram';
import DiagramCanvas from './DiagramCanvas';
import { kinds } from './node-kinds';
import { flatten } from './flow-editing';
import RunReviewPage from './RunReviewPage';
import type { TaskRunIntent } from './task-run-presentation';
import { scopedDescription, type PlanningScope } from '../shared/planning-scope';
import { stepTitle } from './flow-outline';
import TaskWebTargetPage from './TaskWebTargetPage';
import FirstTaskGuide from './FirstTaskGuide';
import TaskUnderstandingPage, {
  type OutputOptions,
  type OutputFeedback,
} from './TaskUnderstandingPage';
import PlanningQuestions from './PlanningQuestions';
import { toolsExecutionNotice, toolContexts } from '../shared/task-mcp-targets';
import PlanningChanges from './PlanningChanges';
import { outputContext, taskOutputNameSchema } from '../shared/task-output';
import { learningSteps, type LearningStatus } from '../shared/learning';
import { webContext } from '../shared/task-web-target';
import TaskBriefPage from './TaskBriefPage';
import TaskAttachmentFeedback, { type AttachmentFeedback } from './TaskAttachmentFeedback';
import type { AttachmentPreview } from '../shared/task-attachments';

const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
const status: Record<PlanningTask['status'], string> = {
  draft: '草稿',
  generating: '正在理解',
  plan: '方案待确认',
  clarify: '需要补充',
  unsupported: '能力不足',
  failed: '生成失败',
  cancelled: '已取消生成',
};
type Draft = {
  description: string;
  context: PlanningContext[];
  answers: Record<string, string>;
  scope?: PlanningScope;
};
const draftOf = (detail: TaskDetail): Draft => ({
  description: detail.task.description,
  context: detail.task.context,
  answers: detail.task.answers,
  ...(detail.task.scope ? { scope: detail.task.scope } : {}),
});
const text = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '无');
export type ConnectionTaskSource = {
  taskId: string;
  flowId: string;
  connectionId: string;
  connectionName: string;
};
export type TaskOpener = (source: ConnectionTaskSource) => Promise<void>;
type Props = {
  openTask: MutableRefObject<TaskOpener | undefined>;
  returnConnection: (id: string) => void;
  configuredAI?: { key: string; provider: 'deepseek' | 'openai-codex'; model: string };
  configuredAIHandled: () => void;
  toolSelection?: { key: string; kind: 'web' | 'file' | 'window' };
  toolSelectionHandled: () => void;
  openTools: () => void;
  openAttention: () => void;
  guideEntry?: number;
  showBrowser: (visible: boolean) => void;
  inspectBrowser: () => void;
  entry?: { key: string; record: FlowRecord; nodeId: string };
  entryHandled: () => void;
  sourceFlowId?: string;
  returnToSource: (record: FlowRecord) => Promise<void>;
  active: boolean;
  data: Bootstrap;
  onNavigation: (title: string, back?: () => void, backLabel?: string) => void;
  openRun: (detail: any, back: (intent?: TaskRunIntent) => void) => void;
  settings: (
    provider: 'deepseek' | 'openai-codex',
    model: string,
    source?: { title: string; taskId?: string },
  ) => void;
  flows: () => void;
  createFlow: () => Promise<FlowRecord>;
  openFlow: (flow: FlowRecord, returnToTask?: boolean, back?: () => void) => void;
  openMore: (flow: FlowRecord, back: () => void) => Promise<void>;
  changed: () => Promise<void>;
};

export default function AITaskWorkspace(props: Props) {
  const [connectionOrigin, setConnectionOrigin] = useState<ConnectionTaskSource>();
  const [tasks, setTasks] = useState<PlanningTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [tasksRefresh, setTasksRefresh] = useState(0);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [draft, setDraft] = useState<Draft>({ description: '', context: [], answers: {} });
  const [saved, setSaved] = useState('');
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreview>();
  const [attachmentFeedback, setAttachmentFeedback] = useState<AttachmentFeedback>();
  const attachmentVisit = useRef(0);
  const attachmentHeading = useRef<HTMLHeadingElement>(null);
  const attachmentOpener = useRef<HTMLElement | null>(null);
  const attachmentRequest = useRef(0);
  useEffect(() => {
    if (!attachmentPreview) return;
    attachmentHeading.current?.focus({ preventScroll: true });
    attachmentHeading.current?.scrollIntoView({ block: 'start' });
  }, [attachmentPreview]);
  function closeAttachmentPreview() {
    attachmentRequest.current++;
    setAttachmentPreview(undefined);
    setAttachmentFeedback((current) => (current?.action === 'preview' ? undefined : current));
    if (attachmentOpener.current?.isConnected) attachmentOpener.current.focus();
  }
  const [outputOptions, setOutputOptions] = useState<OutputOptions>({
    name: '结果.txt',
    onConflict: 'number',
  });
  const [savedOutput, setSavedOutput] = useState('');
  const [revision, setRevision] = useState(0);
  const [homeText, setHomeText] = useState('');
  const [initialAttachment, setInitialAttachment] = useState<{
    taskId: string;
    kind: 'file' | 'image';
  }>();
  const homeInput = useRef<HTMLTextAreaElement>(null);
  const [learning, setLearning] = useState<LearningStatus>();
  const [learningError, setLearningError] = useState('');
  const [learningAction, setLearningAction] = useState<
    'continue' | 'restart' | 'skip' | 'refresh'
  >();
  const handledGuide = useRef(0);
  const [page, setPage] = useState<
    | 'home'
    | 'guide'
    | 'brief'
    | 'target'
    | 'understand'
    | 'review'
    | 'check'
    | 'missing-ai'
    | 'generation'
    | 'modify'
  >('home');
  useLayoutEffect(() => {
    attachmentVisit.current++;
    setAttachmentFeedback(undefined);
  }, [page, detail?.task.id, props.active]);
  useLayoutEffect(() => {
    const input = homeInput.current;
    if (!props.active || page !== 'home' || !input) return;
    const resize = () => {
      input.style.height = '36px';
      input.style.height = `${Math.min(226, Math.max(36, input.scrollHeight + 2))}px`;
    };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [homeText, page, props.active]);
  const [proposalView, setProposalView] = useState<{ id: string; mode: 'changes' | 'flow' }>();
  const missingOrigin = useRef<'brief' | 'understand' | 'review' | 'generation' | 'modify'>(
    'brief',
  );
  const settingsReturnScroll = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!props.active || settingsReturnScroll.current === undefined || page === 'missing-ai')
      return;
    const scroll = settingsReturnScroll.current;
    settingsReturnScroll.current = undefined;
    requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: scroll });
    });
  }, [props.active]);
  const backToBrief = useCallback(() => setPage('brief'), []);
  useEffect(() => {
    attachmentRequest.current++;
    setAttachmentPreview(undefined);
  }, [page, detail?.task.id, detail?.task.revision, props.active]);
  const location = useRef({ active: props.active, page });
  location.current = { active: props.active, page };
  const learningVisit = useRef(0);
  useLayoutEffect(() => {
    return () => {
      learningVisit.current++;
    };
  }, [props.active, page]);
  const previousPage = useRef(page);
  useEffect(() => {
    if (props.active && previousPage.current === 'generation' && page !== 'generation') {
      document.querySelector('main')?.scrollTo(0, 0);
      document
        .querySelector<HTMLHeadingElement>('.ai-task-page:not([hidden]) .ai-task-heading h1')
        ?.focus({ preventScroll: true });
    }
    previousPage.current = page;
  }, [page, props.active]);
  const planScroll = useRef(0);
  const returnToTask = useRef<(id: string, intent: TaskRunIntent) => void>(() => {});
  const trialButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const backToPlan = useCallback(() => {
    setPage('review');
    requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: planScroll.current });
      trialButton.current?.focus({ preventScroll: true });
    });
  }, []);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const epoch = useRef(0);
  const selectedTask = useRef<string | null>(null);
  const handledTool = useRef<string | undefined>(undefined);
  const handledConfiguration = useRef<string | undefined>(undefined);
  const [targetFromRun, setTargetFromRun] = useState(false);
  const [desktopPhase, setDesktopPhase] = useState<'window' | 'window-ready' | 'plan' | 'changes'>(
    'window',
  );
  const [provider, setProvider] = useState<'deepseek' | 'openai-codex'>('deepseek');
  const [model, setModel] = useState('deepseek-flash');
  useLayoutEffect(() => {
    const configuration = props.configuredAI;
    if (!props.active || !configuration || handledConfiguration.current === configuration.key)
      return;
    handledConfiguration.current = configuration.key;
    setProvider(configuration.provider);
    setModel(configuration.model);
    setReviewed(false);
    props.configuredAIHandled();
  }, [props.active, props.configuredAI?.key]);
  const [reviewed, setReviewed] = useState(false);
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [graphFocus, setGraphFocus] = useState<number>();
  const [selected, setSelected] = useState('');
  const planStepList = useRef<TaskStepListHandle>(null);
  const [hiddenListStep, setHiddenListStep] = useState('');
  const [outputFeedback, setOutputFeedback] = useState<OutputFeedback & { taskId: string }>();
  const [editingProposal, setEditingProposal] = useState(false);
  const [modification, setModification] = useState<{
    taskId: string;
    baseHash: string;
    description: string;
    instruction: string;
  }>();
  const modificationConflict =
    !!modification &&
    (modification.taskId !== detail?.task.id ||
      modification.baseHash !== detail?.flowHash ||
      modification.description !== draft.description ||
      !!detail?.proposal ||
      !!draft.scope);
  const modificationDescription = modification?.instruction.trim() ?? '';
  const modificationError =
    modificationDescription.length > 10000 ? '修改要求超过 10000 字，请缩短后继续。' : undefined;
  const sendingDraft =
    page === 'modify' ? { ...draft, description: modificationDescription } : draft;
  const contentDirty = !!detail && JSON.stringify(draft) !== saved;
  const outputNameCheck = taskOutputNameSchema.safeParse(outputOptions.name);
  const outputNameError = outputNameCheck.success
    ? undefined
    : outputNameCheck.error.issues[0].message;
  const outputDirty = !!detail?.task.outputTarget && JSON.stringify(outputOptions) !== savedOutput;
  const dirty = contentDirty || outputDirty;
  const generating = detail?.task.status === 'generating';
  const stale = !!detail && detail.task.revision !== revision;
  const rejectionNotice =
    detail?.proposalRejected && !dirty && !stale
      ? '本次提案未采纳，当前保留已有草稿。你可以继续描述修改，生成新的提议后再决定是否采纳。'
      : undefined;
  const result = detail?.proposal?.result;
  const previousAnswerIds = Object.keys(draft.answers).filter(
    (id) => result?.kind !== 'clarify' || !result.questions.some((question) => question.id === id),
  );
  const hasPlanProposal = result?.kind === 'plan';
  const viewingPreserved = page === 'review' && !!detail?.flow && !!result && !hasPlanProposal;
  const flow = result?.kind === 'plan' ? result.flow : detail?.flow?.flow;
  const selectedStep = flow && flatten(flow.steps).find((step) => step.id === selected);
  const scope = draft.scope;
  const scopedSteps = flatten(detail?.flow?.flow.steps ?? []);
  const scopeIndex = scopedSteps.findIndex((step) => step.id === scope?.nodeId);
  const scopedStep = scopedSteps[scopeIndex];
  const scopeConflict = !!scope && scope.baseFlowHash !== detail?.flowHash;
  const scopedProposal = result?.kind === 'plan' && !!detail?.proposal?.scope;
  const scopeDiffView = scopedProposal && !editingProposal;
  const fullModification =
    result?.kind === 'plan' && !!detail?.proposal?.baseFlow && !scopedProposal;
  const changesView =
    fullModification &&
    (proposalView?.id !== detail?.proposal?.id || proposalView?.mode === 'changes');
  const standaloneGraph =
    page === 'review' && !!flow && !scope && !editingProposal && !changesView && view === 'graph';
  const planListView =
    page === 'review' && !!flow && !scope && !editingProposal && !changesView && view === 'list';
  const diagram = useMemo(
    () =>
      standaloneGraph && flow
        ? buildTaskDiagram(flow, selected, {
            bindings: detail?.flow?.bindings,
            webTarget: detail?.proposal ? detail.task.webTarget : detail?.flow?.webTarget,
            outputTarget: detail?.proposal ? detail.task.outputTarget : detail?.flow?.outputTarget,
            toolTargets: detail?.proposal ? detail.task.toolTargets : detail?.flow?.toolTargets,
          })
        : buildDiagram(flow?.steps ?? [], selected),
    [flow, selected, standaloneGraph, detail],
  );
  const returnToConversation = useCallback(() => {
    setView('list');
    requestAnimationFrame(() => {
      if (!location.current.active || location.current.page !== 'review') return;
      const conversation = document.querySelector<HTMLElement>('[data-task-conversation]');
      conversation?.scrollIntoView({ block: 'nearest' });
      conversation?.focus({ preventScroll: true });
    });
  }, []);
  const moreUnavailable = moreOperationReason();
  function moreOperationReason() {
    if (busy || generating) return '请等当前操作结束后再打开更多操作。';
    if (detail?.proposal)
      return hasPlanProposal
        ? '请先核对并采纳当前方案，再导出、复制或编辑这份流程。'
        : '本次回复没有可采纳的方案。请先调整任务要求并重新生成，再继续修改。';
    if (dirty) return '请先保存或放弃未保存的任务修改，再打开更多操作。';
    if (stale) return '任务已变化，请重新读取后再打开更多操作。';
    if (scope) return '请先结束当前步骤的修改，再打开整个任务的更多操作。';
    if (!detail?.flow) return '当前还没有已保存的流程方案。';
    return '';
  }
  async function openPlanMore() {
    if (!detail?.flow || moreUnavailable) return;
    const source = detail;
    const scroll = document.querySelector('main')?.scrollTop ?? 0;
    await run(async () => {
      const next: TaskDetail = await api('task.detail', { id: source.task.id });
      if (
        !location.current.active ||
        location.current.page !== 'review' ||
        selectedTask.current !== source.task.id
      )
        return;
      if (
        next.task.id !== source.task.id ||
        next.task.revision !== source.task.revision ||
        next.proposal ||
        next.task.status === 'generating' ||
        !next.flow ||
        next.flowHash !== source.flowHash ||
        JSON.stringify(next.flow) !== JSON.stringify(source.flow)
      ) {
        setDetail(next);
        throw new Error('任务或流程已变化，请核对更新后的方案再打开更多操作。');
      }
      await props.openMore(next.flow, () => {
        if (selectedTask.current !== source.task.id) return;
        setPage('review');
        setReviewed(false);
        void run(async () => {
          const refreshed: TaskDetail = await api('task.detail', { id: source.task.id });
          if (
            selectedTask.current === source.task.id &&
            location.current.active &&
            location.current.page === 'review'
          )
            setDetail(refreshed);
        }).finally(() =>
          requestAnimationFrame(() => {
            if (
              selectedTask.current !== source.task.id ||
              !location.current.active ||
              location.current.page !== 'review'
            )
              return;
            document.querySelector('main')?.scrollTo({ top: scroll });
            const target = moreButton.current?.disabled
              ? document.querySelector<HTMLElement>('[data-plan-preview-heading]')
              : moreButton.current;
            target?.focus({ preventScroll: true });
          }),
        );
      });
    });
  }
  const title = viewingPreserved
    ? '查看保留的草稿'
    : standaloneGraph
      ? '同一个任务，两种视图'
      : page === 'modify'
        ? '接着修改当前任务'
        : page === 'generation'
          ? generating
            ? '正在准备任务步骤'
            : detail?.task.status === 'unsupported'
              ? '当前工具还不能完成这项操作'
              : '方案没有生成完成'
          : page === 'understand'
            ? '我理解你要……'
            : page === 'guide'
              ? '第一次，让我们一起完成'
              : page === 'target'
                ? desktopPhase === 'plan'
                  ? '整理所选段落的方案'
                  : desktopPhase === 'changes'
                    ? '核对这次应用改动'
                    : desktopPhase === 'window-ready'
                      ? '选择应用、窗口与能力'
                      : '这次要操作哪里？'
                : page === 'missing-ai'
                  ? '先连接 AI，需求会为你保留'
                  : page === 'check'
                    ? detail?.flow?.desktopTarget
                      ? '确认这次应用修改'
                      : '试运行前，最后确认一次'
                    : page === 'home'
                      ? '开始任务'
                      : page === 'brief'
                        ? '描述需求，带上必要资料'
                        : result?.kind === 'clarify'
                          ? '我理解你要……'
                          : result?.kind === 'unsupported'
                            ? '这项任务还需要支持'
                            : changesView
                              ? '检查 AI 提议的修改'
                              : '先看看任务步骤';

  useEffect(() => {
    if (props.active)
      props.onNavigation(
        title,
        standaloneGraph
          ? returnToConversation
          : page === 'modify'
            ? returnFromModification
            : page === 'generation'
              ? () => (generating ? void cancelGeneration() : recoverDescription())
              : page === 'missing-ai'
                ? () => setPage(missingOrigin.current)
                : page === 'check'
                  ? backToPlan
                  : page === 'understand'
                    ? () => void openTarget()
                    : page === 'target'
                      ? targetFromRun
                        ? backToPlan
                        : backToBrief
                      : page === 'guide' || page === 'brief'
                        ? () => {
                            void back();
                          }
                        : page === 'review'
                          ? () => void returnFromReview()
                          : undefined,
        standaloneGraph
          ? hasPlanProposal
            ? '待采纳方案'
            : '采纳后的方案'
          : page === 'modify'
            ? '当前方案'
            : page === 'generation'
              ? generating
                ? '取消并返回'
                : '任务草稿'
              : page === 'missing-ai'
                ? '任务草稿'
                : page === 'check'
                  ? '确认任务方案'
                  : page === 'understand'
                    ? '选择操作对象'
                    : page === 'target'
                      ? targetFromRun
                        ? '任务方案'
                        : '描述与附件'
                      : page === 'guide' || page === 'brief'
                        ? '开始任务'
                        : page === 'review'
                          ? changesView
                            ? '确认任务方案'
                            : flow && !scope
                              ? '理解与补问'
                              : '开始任务'
                          : undefined,
      );
  }, [
    props.active,
    standaloneGraph,
    changesView,
    detail?.proposal?.id,
    scope,
    flow,
    returnToConversation,
    title,
    page,
    backToPlan,
    backToBrief,
    targetFromRun,
    props.onNavigation,
    draft,
    outputOptions,
    revision,
    busy,
  ]);
  useEffect(() => {
    if (!props.active) return;
    let live = true;
    setTasksLoading(true);
    setTasksError('');
    void api('task.list')
      .then((next) => {
        if (live) {
          setTasks(next);
          setTasksLoaded(true);
        }
      })
      .catch((e) => {
        if (live)
          setTasksError(e instanceof Error && e.message ? e.message : '暂时无法读取任务列表');
      })
      .finally(() => {
        if (live) setTasksLoading(false);
      });
    return () => {
      live = false;
    };
  }, [props.active, page, tasksRefresh]);
  useEffect(() => {
    if (!props.active || !detail) return;
    const id = detail.task.id;
    let live = true,
      pending = false;
    const timer = setInterval(async () => {
      if (pending || lock.current) return;
      pending = true;
      const currentEpoch = epoch.current;
      try {
        const next: TaskDetail = await api('task.detail', { id });
        if (live && currentEpoch === epoch.current && selectedTask.current === id) {
          setDetail(next);
          if (
            detail.task.status === 'generating' &&
            next.task.status !== 'generating' &&
            location.current.page === 'generation'
          ) {
            setPage(generationDestination(next));
            if (next.task.status === 'cancelled')
              setMessage('已取消生成，需求、附件、补问及已保存草稿均保留。');
          }
        }
      } catch (e: any) {
        if (live) setError(e.message);
      } finally {
        pending = false;
      }
    }, 900);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [props.active, detail?.task.id, detail?.task.status]);

  useEffect(() => {
    if (!props.active) return;
    let live = true,
      pending = false;
    const refresh = async () => {
      if (pending || lock.current) return;
      pending = true;
      const ticket = epoch.current;
      try {
        const next = await api('learning.status');
        if (live && ticket === epoch.current) {
          setLearning(next);
          setLearningError('');
        }
      } catch (e) {
        if (live && ticket === epoch.current) setLearningError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [props.active, page]);
  useEffect(() => {
    if (
      !props.active ||
      !props.guideEntry ||
      handledGuide.current === props.guideEntry ||
      lock.current
    )
      return;
    handledGuide.current = props.guideEntry;
    void showGuide();
  }, [props.active, props.guideEntry, busy]);

  useEffect(() => {
    setReviewed(false);
  }, [detail?.flowHash]);

  useEffect(() => {
    if (!props.active || !props.entry || lock.current) return;
    const entry = props.entry;
    void run(async () => {
      if (detail && dirty) await save();
      const list: PlanningTask[] = await api('task.list');
      const existing = list.find((task) => task.flowId === entry.record.id);
      const next: TaskDetail = existing
        ? await api('task.detail', { id: existing.id })
        : await api('task.create', { flowId: entry.record.id });
      accept(next);
      setPage('review');
      setSelected(entry.nodeId);
      setProvider(next.task.provider ?? 'deepseek');
      setModel(next.task.model ?? 'deepseek-flash');
      setReviewed(false);
      if (
        JSON.stringify(next.flow?.flow) !== JSON.stringify(entry.record.flow) ||
        JSON.stringify(next.flow?.bindings) !== JSON.stringify(entry.record.bindings)
      )
        throw new Error('来源流程已变化，请返回重新读取，未发送任何请求');
      await chooseScope(next, entry.nodeId);
    }).finally(props.entryHandled);
  }, [props.active, props.entry?.key, busy]);

  function accept(next: TaskDetail, preserveOutput = false) {
    if (selectedTask.current !== next.task.id) setHiddenListStep('');
    selectedTask.current = next.task.id;
    setDetail(next);
    const nextDraft = draftOf(next);
    setDraft(nextDraft);
    setSaved(JSON.stringify(nextDraft));
    setRevision(next.task.revision);
    const options: OutputOptions = {
      name:
        next.task.outputTarget?.name ??
        (learning?.taskId === next.task.id ? '页面标题.txt' : '结果.txt'),
      onConflict: next.task.outputTarget?.onConflict ?? 'number',
    };
    setSavedOutput(JSON.stringify(options));
    if (!preserveOutput) setOutputOptions(options);
  }
  function edit(next: Draft) {
    setDraft(next);
    setReviewed(false);
    setMessage('');
  }
  function clearAnswer(id: string) {
    const answers = { ...draft.answers };
    delete answers[id];
    edit({ ...draft, answers });
  }
  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    epoch.current++;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (e: any) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const manualFlows = useRef(new Map<string, string>());
  async function openManual(returnToTask: boolean) {
    const origin = {
      ...location.current,
      taskId: selectedTask.current,
      scroll: document.querySelector('main')?.scrollTop ?? 0,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    await run(async () => {
      const previousId =
        returnToTask && origin.taskId ? manualFlows.current.get(origin.taskId) : undefined;
      let record = returnToTask ? detail?.flow : undefined;
      if (!record && previousId) {
        record = props.data.flows.find((flow) => flow.id === previousId);
        if (!record) throw new Error('先前手动创建的流程已不在当前列表，请到“我的流程”核对。');
      }
      if (!record) {
        record = await props.createFlow();
        if (returnToTask && origin.taskId) manualFlows.current.set(origin.taskId, record.id);
      }
      if (
        location.current.active &&
        location.current.page === origin.page &&
        selectedTask.current === origin.taskId
      )
        props.openFlow(record, returnToTask, () => {
          document.querySelector('main')?.scrollTo({ top: origin.scroll });
          if (origin.trigger?.isConnected) origin.trigger.focus({ preventScroll: true });
        });
      else setMessage('手动流程已准备好，可从“我的流程”打开。任务草稿已保留。');
    });
  }
  async function save(content: Draft = draft): Promise<TaskDetail> {
    if (!detail) throw new Error('请先创建任务');
    if (stale) throw new Error('任务已在其他位置修改，请重新读取后继续');
    if (detail.task.outputTarget && outputNameError) throw new Error(outputNameError);
    let next = detail;
    if (JSON.stringify(content) !== saved) {
      next = await api('task.save', { id: detail.task.id, revision, ...content });
      accept(next, true);
    }
    if (outputDirty) {
      next = await api('task.output.configure', {
        id: next.task.id,
        revision: next.task.revision,
        ...outputOptions,
      });
      accept(next);
    }
    return next;
  }
  const showTask = (next: TaskDetail) => {
    accept(next);
    setEditingProposal(false);
    setReviewed(false);
    setSelected('');
    setProvider(next.task.provider ?? 'deepseek');
    setModel(next.task.model ?? 'deepseek-flash');
    setPage(
      ['generating', 'failed', 'unsupported'].includes(next.task.status)
        ? 'generation'
        : next.proposal?.result.kind === 'clarify' && !next.task.scope
          ? 'understand'
          : next.proposal || next.flow
            ? 'review'
            : next.task.webTarget || next.task.outputTarget || next.task.toolTargets?.length
              ? 'understand'
              : 'brief',
    );
  };
  async function open(id: string) {
    await run(async () => {
      if (detail && dirty) await save();
      const next: TaskDetail = await api('task.detail', { id });
      setConnectionOrigin(undefined);
      showTask(next);
    });
  }
  useLayoutEffect(() => {
    const openConnectionTask: TaskOpener = async (source) => {
      if (lock.current) throw new Error('原任务仍在处理，请稍后再打开相关任务。');
      lock.current = true;
      epoch.current++;
      setBusy(true);
      try {
        if (detail && dirty) await save();
        const next: TaskDetail = await api('task.detail', { id: source.taskId });
        if (
          next.task.id !== source.taskId ||
          next.task.flowId !== source.flowId ||
          !next.task.toolTargets?.some((target) => target.connectionId === source.connectionId)
        )
          throw new Error('任务或连接引用已变化，请刷新引用后重新选择；原任务仍保留。');
        showTask(next);
        setConnectionOrigin(source);
        setError('');
        setMessage('');
      } finally {
        lock.current = false;
        setBusy(false);
      }
    };
    props.openTask.current = openConnectionTask;
    return () => {
      if (props.openTask.current === openConnectionTask) props.openTask.current = undefined;
    };
  });
  const [targetEntry, setTargetEntry] = useState<{ key: string; tab: 'web' | 'window' }>();
  useEffect(() => {
    if (!initialAttachment) return;
    if (!props.active || page !== 'brief' || detail?.task.id !== initialAttachment.taskId) {
      setInitialAttachment(undefined);
      return;
    }
    if (busy || lock.current) return;
    setInitialAttachment(undefined);
    void chooseAttachment(initialAttachment.kind);
  }, [initialAttachment, props.active, page, detail?.task.id, busy]);
  useEffect(() => {
    if (page !== 'target') {
      setTargetEntry(undefined);
      setTargetFromRun(false);
    }
  }, [page]);
  async function create(description: string, entry?: 'file' | 'image' | 'web' | 'window') {
    await run(async () => {
      if (detail && dirty) await save();
      const next: TaskDetail = await api('task.create');
      accept(next);
      setDraft({ description, context: [], answers: {} });
      setConnectionOrigin(undefined);
      setEditingProposal(false);
      setReviewed(false);
      setPage('brief');
      setSelected('');
      setHomeText('');
      if (entry === 'file' || entry === 'image') {
        setInitialAttachment({ taskId: next.task.id, kind: entry });
        return;
      }
      const stored: TaskDetail = await api('task.save', {
        id: next.task.id,
        revision: next.task.revision,
        description,
        context: [],
        answers: {},
      });
      accept(stored);
      if (entry === 'web' || entry === 'window') {
        props.showBrowser(false);
        setTargetEntry({ key: crypto.randomUUID(), tab: entry });
        setPage('target');
      }
    });
  }
  useEffect(() => {
    const selection = props.toolSelection;
    if (!props.active || !selection || busy || handledTool.current === selection.key) return;
    handledTool.current = selection.key;
    void run(async () => {
      if (scope) throw new Error('当前是单步修改任务，请先返回完整任务再选择对象');
      if (detail) {
        if (dirty) await save();
      } else accept(await api('task.create'));
      setReviewed(false);
      if (selection.kind !== 'file') setTargetEntry({ key: selection.key, tab: selection.kind });
      setPage(selection.kind === 'file' ? 'brief' : 'target');
    }).finally(props.toolSelectionHandled);
  }, [props.active, props.toolSelection?.key, busy]);
  function generationDestination(next: TaskDetail): 'generation' | 'review' | 'understand' {
    if (['generating', 'failed', 'unsupported'].includes(next.task.status)) return 'generation';
    if (next.proposal?.result.kind === 'plan') return 'review';
    return next.task.scope ? 'review' : 'understand';
  }
  function recoverDescription() {
    if (lock.current) return;
    setReviewed(false);
    const resumeModification = !scope && !!detail?.flow && !detail.proposal;
    if (resumeModification && detail) {
      setModification((previous) =>
        previous?.taskId === detail.task.id && previous.description === draft.description
          ? previous
          : {
              taskId: detail.task.id,
              baseHash: detail.flowHash,
              description: draft.description,
              instruction: draft.description,
            },
      );
      setPage('modify');
    } else {
      setPage(scope ? 'review' : 'brief');
    }
    requestAnimationFrame(() => {
      if (!location.current.active) return;
      document.querySelector('main')?.scrollTo(0, 0);
      document
        .querySelector<HTMLTextAreaElement>(
          resumeModification ? '#task-modification-instruction' : '#task-description',
        )
        ?.focus({ preventScroll: true });
    });
  }
  async function cancelGeneration() {
    if (!detail) return;
    await run(async () => {
      const next = await api('task.cancel', { id: detail.task.id });
      accept(next);
      setReviewed(false);
      setPage(generationDestination(next));
      if (next.task.status === 'cancelled')
        setMessage('已取消生成，需求、附件、补问及已保存草稿均保留。');
    });
  }
  async function generationSettings() {
    await run(async () => {
      await save();
      setReviewed(false);
      settingsReturnScroll.current = document.querySelector('main')?.scrollTop ?? 0;
      props.settings(provider, model, {
        title: draft.description.slice(0, 40) || '当前任务',
        taskId: detail?.task.id,
      });
    });
  }
  async function generate() {
    await run(async () => {
      if (!reviewed) throw new Error('请先核对本次发送的内容');
      if (
        page === 'modify' &&
        (!modification?.instruction.trim() || modificationConflict || modificationError)
      )
        throw new Error(modificationError || '请先填写修改要求并重新核对当前草稿');
      const next = await save(sendingDraft);
      setEditingProposal(false);
      // The saved request is now canonical, including when starting generation fails.
      if (page === 'modify') {
        setModification(undefined);
        setReviewed(false);
        setPage('understand');
      }
      const generated: TaskDetail = await api('task.generate', {
        id: next.task.id,
        revision: next.task.revision,
        provider,
        model,
        reviewed: true,
      });
      accept(generated);
      setPage(generationDestination(generated));
      document.querySelector('main')?.scrollTo(0, 0);
      setReviewed(false);
    });
  }
  function beginModification() {
    if (!detail?.flow || detail.proposal || scope || dirty || stale || busy || generating) return;
    enterModification(detail);
  }
  function enterModification(current: TaskDetail) {
    setModification((previous) =>
      previous?.taskId === current.task.id
        ? previous
        : {
            taskId: current.task.id,
            baseHash: current.flowHash,
            description: current.task.description,
            instruction: '',
          },
    );
    setReviewed(false);
    setError('');
    setMessage('');
    planScroll.current = document.querySelector('main')?.scrollTop ?? 0;
    setPage('modify');
  }
  function returnFromModification() {
    if (lock.current) return;
    setReviewed(false);
    setPage('review');
    requestAnimationFrame(() => {
      document.querySelector('main')?.scrollTo({ top: planScroll.current });
      document
        .querySelector<HTMLButtonElement>('[data-task-modify]')
        ?.focus({ preventScroll: true });
    });
  }
  async function chooseScope(next: TaskDetail, nodeId: string) {
    if (next.task.status === 'generating' || next.proposal)
      throw new Error('请先取消生成，或采纳/不采纳当前提案，再选择单步修改');
    if (!next.flow || !flatten(next.flow.flow.steps).some((step) => step.id === nodeId))
      throw new Error('所选步骤已不存在，请重新选择');
    const current = next.task.scope;
    if (current && current.nodeId !== nodeId)
      throw new Error('先完成当前单步修改，或明确改为完整任务修改，再选择另一步');
    accept(
      await api('task.save', {
        id: next.task.id,
        revision: next.task.revision,
        ...draftOf(next),
        answers: current ? next.task.answers : {},
        scope: { nodeId, baseFlowHash: next.flowHash, instruction: current?.instruction ?? '' },
      }),
    );
    setSelected(nodeId);
    setEditingProposal(false);
    setReviewed(false);
    setPage('review');
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('#task-description')?.focus(),
    );
  }
  async function proposalAction(method: 'adopt' | 'reject' | 'undo') {
    await run(async () => {
      if (!detail || dirty || stale) throw new Error('请先保存修改并重新生成方案');
      const next = await api(`task.${method}`, {
        id: detail.task.id,
        revision,
        ...(method !== 'undo' ? { proposalId: detail.proposal?.id } : {}),
      });
      accept(next);
      setEditingProposal(false);
      setReviewed(false);
      setMessage(
        method === 'adopt'
          ? '已采纳到流程草稿，尚未执行。'
          : method === 'reject'
            ? '已保留原流程。'
            : '已撤销最近一次 AI 采纳。',
      );
      setPage(next.flow ? 'review' : 'brief');
      await props.changed();
      requestAnimationFrame(() => {
        if (
          !location.current.active ||
          selectedTask.current !== next.task.id ||
          location.current.page !== (next.flow ? 'review' : 'brief')
        )
          return;
        document.querySelector('main')?.scrollTo({ top: 0 });
        document
          .querySelector<HTMLHeadingElement>('.ai-task-page:not([hidden]) .ai-task-heading h1')
          ?.focus({ preventScroll: true });
      });
    });
  }
  async function back() {
    await run(async () => {
      if (detail && dirty) await save();
      setPage('home');
    });
  }
  async function returnFromReview() {
    if (lock.current) return;
    if (changesView && detail?.proposal) {
      setProposalView({ id: detail.proposal.id, mode: 'flow' });
      setView('list');
      focusTaskHeading();
    } else if (flow && !scope) {
      await understand();
    } else {
      await back();
    }
  }
  function focusTaskHeading() {
    requestAnimationFrame(() => {
      if (!location.current.active) return;
      document.querySelector('main')?.scrollTo({ top: 0 });
      document
        .querySelector<HTMLHeadingElement>('.ai-task-page:not([hidden]) .ai-task-heading h1')
        ?.focus({ preventScroll: true });
    });
  }
  function returnToExistingPlan() {
    if (lock.current || dirty || stale) return;
    setEditingProposal(false);
    setPage('review');
    focusTaskHeading();
  }
  async function openTarget() {
    await run(async () => {
      await save();
      setReviewed(false);
      props.showBrowser(false);
      setPage('target');
    });
  }
  async function understand() {
    await run(async () => {
      await save();
      props.showBrowser(false);
      setPage('understand');
      setReviewed(false);
      focusTaskHeading();
    });
  }
  async function changeOutput(action: 'choose' | 'clear') {
    if (!detail) return;
    const taskId = detail.task.id;
    const feedback = (kind: OutputFeedback['kind'], message: string) =>
      setOutputFeedback({ taskId, kind, message });
    await run(async () => {
      feedback(
        action === 'choose' ? 'choosing' : 'clearing',
        action === 'choose'
          ? '正在准备目录选择，请在系统窗口中选择或取消。'
          : '正在移除当前任务的输出目录…',
      );
      try {
        if (stale) throw new Error('请重新读取任务后再修改输出目录');
        if (action === 'clear') {
          const next: TaskDetail = await api('task.output.clear', { id: taskId, revision });
          // Keep unsaved answers while adopting the new output revision.
          const currentDraft = draft;
          accept(next);
          setDraft(currentDraft);
          setReviewed(false);
          feedback('cleared', '已移除当前任务的输出目录；已保存流程、运行和文件不会随之更改。');
          return;
        }
        if (outputNameError) throw new Error(outputNameError);
        let next = detail;
        if (contentDirty) {
          next = await api('task.save', { id: taskId, revision, ...draft });
          accept(next, true);
        }
        props.showBrowser(false);
        const chosen: TaskDetail = await api('task.output.choose', {
          id: next.task.id,
          revision: next.task.revision,
          ...outputOptions,
        });
        if (chosen.task.outputTarget?.selectionId !== next.task.outputTarget?.selectionId) {
          accept(chosen);
          setReviewed(false);
          feedback('chosen', '输出目录、文件名和同名规则已保存。目录路径留在本机。');
        } else {
          feedback(
            'cancelled',
            next.task.outputTarget
              ? '已取消目录选择，原输出位置保持不变。'
              : '已取消目录选择，尚未设置输出目录。',
          );
        }
      } catch (error) {
        feedback(
          'error',
          (error instanceof Error && error.message) || '输出目录操作未完成，请重新核对后再试。',
        );
      }
    });
  }
  async function attachmentAction(
    action: AttachmentFeedback['action'],
    attachmentId: string | undefined,
    operation: (current: () => boolean) => Promise<{
      status: 'success' | 'cancelled';
      message: string;
    }>,
  ) {
    const visit = attachmentVisit.current;
    const taskId = detail?.task.id;
    const origin = document.activeElement;
    const current = () =>
      visit === attachmentVisit.current &&
      location.current.active &&
      selectedTask.current === taskId;
    await run(async () => {
      const name = detail?.task.attachments?.find((item) => item.id === attachmentId)?.name;
      setAttachmentFeedback({
        action,
        attachmentId,
        status: 'pending',
        message:
          action === 'preview'
            ? `正在读取「${name || '附件'}」的任务副本…`
            : action === 'remove'
              ? `正在移除任务中的「${name || '附件'}」…`
              : `正在准备${action === 'image' ? '图片' : '文件'}选择，请在系统窗口中选择或取消。`,
      });
      try {
        const result = await operation(current);
        if (current())
          setAttachmentFeedback({
            action,
            attachmentId,
            ...result,
            focus:
              action !== 'preview' &&
              (document.activeElement === origin || document.activeElement === document.body),
          });
      } catch (error) {
        if (current())
          setAttachmentFeedback({
            action,
            attachmentId,
            status: 'error',
            message: error instanceof Error ? error.message : '附件操作未完成，请重新核对。',
            focus: document.activeElement === origin || document.activeElement === document.body,
          });
      }
    });
  }
  function retryAttachment() {
    if (!attachmentFeedback) return;
    const { action, attachmentId } = attachmentFeedback;
    if (action === 'preview' && attachmentId) void previewAttachment(attachmentId);
    else if (action === 'remove' && attachmentId) void removeAttachment(attachmentId);
    else if (action === 'file' || action === 'image') void chooseAttachment(action);
  }
  async function chooseAttachment(kind: 'file' | 'image') {
    await attachmentAction(kind, undefined, async (current) => {
      const task = await save();
      if (!current()) return { status: 'cancelled', message: '' };
      props.showBrowser(false);
      const next: TaskDetail = await api('task.attachment.choose', {
        id: task.task.id,
        revision: task.task.revision,
        kind,
      });
      if (!current()) return { status: 'cancelled', message: '' };
      if (next.task.revision !== task.task.revision) {
        accept(next);
        setReviewed(false);
        const added = next.task.attachments?.find(
          (item) => !task.task.attachments?.some((previous) => previous.id === item.id),
        );
        return {
          status: 'success',
          message: added ? `已加入「${added.name}」。可预览本次选入的副本。` : '任务资料已更新。',
        };
      }
      return { status: 'cancelled', message: '已取消选择，没有加入新附件，原资料保留。' };
    });
  }
  async function removeAttachment(attachmentId: string) {
    await attachmentAction('remove', attachmentId, async (current) => {
      if (!detail || stale) throw new Error('请重新读取任务后操作');
      const name = detail.task.attachments?.find((item) => item.id === attachmentId)?.name;
      // Removal must remain possible when a damaged attachment prevents saving the draft.
      const currentDraft = draft;
      const next = await api('task.attachment.remove', {
        id: detail.task.id,
        revision,
        attachmentId,
      });
      if (current()) {
        accept(next, true);
        setDraft(currentDraft);
        setReviewed(false);
      }
      return { status: 'success', message: `已从任务移除「${name || '附件'}」，原文件未修改。` };
    });
  }
  async function previewAttachment(attachmentId: string) {
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const opener = activeElement?.closest('.task-attachment-feedback')
      ? attachmentOpener.current
      : activeElement;
    attachmentOpener.current = opener;
    await attachmentAction('preview', attachmentId, async (current) => {
      if (!detail || stale) throw new Error('请重新读取任务后预览');
      const previewTicket = ++attachmentRequest.current;
      const next = await api('task.attachment.preview', {
        id: detail.task.id,
        revision,
        attachmentId,
      });
      if (current() && previewTicket === attachmentRequest.current) {
        attachmentOpener.current = opener;
        setAttachmentPreview(next);
      }
      return { status: 'success', message: '附件副本已读取，可在上方预览。' };
    });
  }
  async function showGuide() {
    const visit = learningVisit.current;
    await run(async () => {
      if (detail && dirty) await save();
      if (!location.current.active || learningVisit.current !== visit) return;
      props.showBrowser(false);
      setPage('guide');
      await refreshLearning();
    });
  }
  async function refreshLearning() {
    setLearningAction('refresh');
    try {
      setLearning(await api('learning.status'));
      setLearningError('');
    } catch (reason) {
      setLearningError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLearningAction(undefined);
    }
  }
  async function startLearning(mode: 'continue' | 'restart') {
    const visit = learningVisit.current;
    const stillHere = () => location.current.active && learningVisit.current === visit;
    await run(async () => {
      if (!learning || learningError) return;
      setLearningAction(mode);
      try {
        if (detail && dirty) await save();
        if (!stillHere()) return;
        const next = await api('learning.start', { revision: learning.revision, mode });
        if (!stillHere()) return;
        setLearning(next.learning);
        let result;
        if (next.learning.latestRunId) {
          try {
            result = await api('run.detail', { id: next.learning.latestRunId });
            if (
              !result?.run ||
              result.run.id !== next.learning.latestRunId ||
              (result.run.task && result.run.task.id !== next.detail.task.id)
            )
              throw new Error(
                '教学任务已恢复，但上次运行记录与当前教学不一致。请从当前任务核对运行记录。',
              );
          } catch (reason) {
            if (!stillHere()) return;
            showTask(next.detail);
            throw reason;
          }
        }
        if (!stillHere()) return;
        showTask(next.detail);
        if (result)
          props.openRun(result, (intent = 'plan') =>
            returnToTask.current(next.detail.task.id, intent),
          );
      } catch (reason) {
        if (stillHere()) throw reason;
      } finally {
        setLearningAction(undefined);
      }
    });
  }
  async function skipLearning() {
    const visit = learningVisit.current;
    await run(async () => {
      if (!learning || learningError) return;
      setLearningAction('skip');
      try {
        const next = await api('learning.skip', { revision: learning.revision });
        if (location.current.active && learningVisit.current === visit) {
          setLearning(next);
          setPage('home');
        }
      } catch (reason) {
        if (location.current.active && learningVisit.current === visit) throw reason;
      } finally {
        setLearningAction(undefined);
      }
    });
  }
  const providerName = provider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
  const inputDisabled = busy || generating;

  returnToTask.current = (taskId, intent) => {
    const arrive = (current: TaskDetail | null) => {
      if (intent === 'plan') backToPlan();
      else if (intent === 'desktop-target') {
        setTargetFromRun(true);
        setDesktopPhase('window');
        setTargetEntry({ key: crypto.randomUUID(), tab: 'window' });
        setPage('target');
      } else if (
        intent === 'modify' &&
        current?.flow &&
        !current.proposal &&
        !current.task.scope &&
        current.task.status !== 'generating'
      )
        enterModification(current);
      else {
        setPage(intent === 'home' ? 'home' : 'brief');
        requestAnimationFrame(() => {
          document.querySelector('main')?.scrollTo(0, 0);
          document.querySelector<HTMLTextAreaElement>('#task-description')?.focus();
        });
      }
    };
    if (selectedTask.current === taskId) arrive(detail);
    else
      void run(async () => {
        if (dirty) await save();
        const original = await api('task.detail', { id: taskId });
        if (!location.current.active) return;
        accept(original);
        setReviewed(false);
        arrive(original);
      });
  };

  const planningControls = detail && (
    <>
      {page === 'understand' || page === 'brief' || page === 'generation' || page === 'modify' ? (
        <details className="task-understanding-provider">
          <summary>
            AI 服务 · {providerName} · {model}
          </summary>{' '}
          <ConfigProvider componentDisabled={inputDisabled || undefined}>
            <fieldset className="ai-task-provider" disabled={inputDisabled}>
              <label>
                AI 服务
                <Select<string>
                  value={provider}
                  onChange={(value) => {
                    const p = value as typeof provider;
                    setProvider(p);
                    setModel(p === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex');
                    setReviewed(false);
                  }}
                  options={[
                    { value: 'deepseek', label: 'DeepSeek' },
                    { value: 'openai-codex', label: 'OpenAI · Codex' },
                  ]}
                />
              </label>
              <label>
                模型 ID
                <Input
                  value={model}
                  maxLength={100}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setReviewed(false);
                  }}
                />
              </label>
            </fieldset>
          </ConfigProvider>
        </details>
      ) : (
        <ConfigProvider componentDisabled={inputDisabled || undefined}>
          <fieldset className="ai-task-provider" disabled={inputDisabled}>
            <label>
              AI 服务
              <Select<string>
                value={provider}
                onChange={(value) => {
                  const p = value as typeof provider;
                  setProvider(p);
                  setModel(p === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex');
                  setReviewed(false);
                }}
                options={[
                  { value: 'deepseek', label: 'DeepSeek' },
                  { value: 'openai-codex', label: 'OpenAI · Codex' },
                ]}
              />
            </label>
            <label>
              模型 ID
              <Input
                value={model}
                maxLength={100}
                onChange={(e) => {
                  setModel(e.target.value);
                  setReviewed(false);
                }}
              />
            </label>
          </fieldset>
        </ConfigProvider>
      )}
      {!props.data.credentials.includes(provider) && (
        <div className="ai-task-note">
          <p>{providerName} 尚未配置，先保存草稿，再配置服务。</p>
          <Button
            disabled={busy || undefined}
            onClick={() =>
              void run(async () => {
                await save();
                settingsReturnScroll.current = document.querySelector('main')?.scrollTop ?? 0;
                missingOrigin.current =
                  page === 'understand' ||
                  page === 'review' ||
                  page === 'generation' ||
                  page === 'modify'
                    ? page
                    : 'brief';
                setPage('missing-ai');
              })
            }
          >
            配置 AI 服务
          </Button>
        </div>
      )}
      {detail.task.toolsRequirePlan && !detail.task.toolTargets?.length && (
        <p className="ai-task-note">工具选择已移除，请重新生成并采纳完整方案后运行。</p>
      )}
      {!!detail.task.toolTargets?.length && (
        <div className="ai-task-note" role="status">
          <h3>已选工具对象</h3>
          {detail.task.toolTargets.map((target) => (
            <p key={target.selectionId}>
              {target.displayName} · {target.tools.length} 项 ·{' '}
              {detail.toolTargetStates?.find((state) => state.selectionId === target.selectionId)
                ?.current
                ? '已保存选择'
                : '需要重新核对连接'}
            </p>
          ))}
          <p>{toolsExecutionNotice}</p>
          {detail.task.webTarget && (
            <p className="field-error">
              当前不能混合只读网页与工具方案，请移除其中一种目标后继续。
            </p>
          )}
          <Button disabled={inputDisabled || undefined} onClick={() => void openTarget()}>
            查看或移除工具选择
          </Button>
        </div>
      )}
      <details className="ai-task-disclosure">
        <summary>查看本次发送给 {providerName} 的内容</summary>
        <p>
          {page === 'modify'
            ? '本次新的修改要求、所选资料、补问答案和当前已采纳流程。不会将历史提案作为当前方案发送。'
            : scope
              ? '所选步骤的修改要求与范围、已选资料、补问答案、当前完整流程及支持的能力说明。原任务描述和本机绑定不会额外加入。'
              : '描述、所选资料与网页元数据、补问答案、当前已采纳流程及支持的能力说明。'}
        </p>
        <h3>{page === 'modify' ? '本次修改要求' : '描述'}</h3>
        <pre>{scope ? scopedDescription(scope) : sendingDraft.description}</pre>
        {draft.context.map((entry) => (
          <div key={entry.id}>
            <h3>{entry.label}</h3>
            <pre>{entry.text}</pre>
          </div>
        ))}
        {detail.task.attachments?.map((a) => (
          <div key={a.id}>
            <h3>
              {a.name} · {a.kind === 'image' ? '完整图片' : '完整文本副本'}
            </h3>
            <p>
              {a.mimeType} · {Math.ceil(a.size / 1024)} KiB
              {a.kind === 'image' ? ` · ${a.width} × ${a.height}` : ''}
            </p>
            <Button
              disabled={inputDisabled || stale || undefined}
              onClick={() => void previewAttachment(a.id)}
            >
              查看发送附件：{a.name}
            </Button>
            {(page !== 'brief' || scope) &&
              attachmentFeedback?.attachmentId === a.id &&
              attachmentFeedback.status !== 'success' && (
                <TaskAttachmentFeedback
                  feedback={attachmentFeedback}
                  busy={inputDisabled || stale}
                  retry={retryAttachment}
                />
              )}
          </div>
        ))}
        {detail.task.webTarget && (
          <div>
            <h3>{webContext(detail.task.webTarget).label}</h3>
            <pre>
              {
                webContext(
                  detail.task.webTarget,
                  detail.task.outputTarget
                    ? { ...detail.task.outputTarget, ...outputOptions }
                    : undefined,
                ).text
              }
            </pre>
          </div>
        )}
        {toolContexts(detail.task.toolTargets).map((entry) => (
          <div key={entry.id}>
            <h3>已选工具 · {entry.label}</h3>
            <p>仅发送以下所选定义；连接地址、程序路径与凭据留在本机。</p>
            <pre>{entry.text}</pre>
          </div>
        ))}
        {detail.task.outputTarget && (
          <div>
            <h3>已选输出 · 路径留在本机</h3>
            <pre>{outputContext({ ...detail.task.outputTarget, ...outputOptions }).text}</pre>
          </div>
        )}
        {(Object.keys(draft.answers).length > 0 ||
          (result?.kind === 'clarify' && result.questions.length > 0)) && (
          <>
            <h3>补问答案</h3>
            {[
              ...new Set([
                ...(result?.kind === 'clarify'
                  ? result.questions.map((question) => question.id)
                  : []),
                ...Object.keys(draft.answers),
              ]),
            ].map((id) => (
              <div className="task-answer-review" key={id}>
                <h4>
                  {(result?.kind === 'clarify' &&
                    result.questions.find((question) => question.id === id)?.prompt) ||
                    `先前补充 ${previousAnswerIds.indexOf(id) + 1}`}
                </h4>
                <p>{draft.answers[id]?.trim() ? draft.answers[id] : '尚未补充'}</p>
              </div>
            ))}
          </>
        )}
        {detail.flow && (
          <>
            <h3>当前流程 · {detail.flow.flow.name}</h3>
            <pre>{text(detail.flow.flow)}</pre>
          </>
        )}
      </details>
      {detail.task.outputTarget && outputNameError && page !== 'understand' && (
        <div className="ai-task-note" role="alert">
          <p>{outputNameError}</p>
          <Button disabled={inputDisabled || undefined} onClick={() => setPage('understand')}>
            修改输出文件名
          </Button>
        </div>
      )}
      <Checkbox
        checked={reviewed}
        disabled={inputDisabled || undefined}
        onChange={(e) => setReviewed(e.target.checked)}
        className="ai-task-checkbox"
      >
        我已核对本次内容，将发送给 {providerName}
      </Checkbox>
      <div className="ai-task-actions">
        {page === 'understand' && flow && (
          <Button
            disabled={busy || stale || dirty || undefined}
            title={dirty ? '请先保存任务草稿，再核对仍可用的方案' : undefined}
            onClick={returnToExistingPlan}
          >
            {detail.proposal?.result.kind === 'plan' ? '返回待采纳方案' : '返回当前方案'}
          </Button>
        )}
        {generating ? (
          <Button
            disabled={busy || undefined}
            onClick={() =>
              void run(async () => {
                accept(await api('task.cancel', { id: detail.task.id }));
                setReviewed(false);
              })
            }
          >
            取消生成
          </Button>
        ) : (
          <Button
            type="primary"
            disabled={
              busy ||
              stale ||
              (page === 'modify' &&
                (!modification?.instruction.trim() ||
                  modificationConflict ||
                  !!modificationError)) ||
              (!!detail.task.toolTargets?.length &&
                (!!detail.task.webTarget ||
                  detail.toolTargetStates?.some((state) => !state.current))) ||
              !(scope?.instruction ?? draft.description).trim() ||
              scopeConflict ||
              !model.trim() ||
              !reviewed ||
              !props.data.credentials.includes(provider) ||
              (page === 'understand' &&
                learning?.taskId === detail.task.id &&
                !detail.task.outputTarget) ||
              (!!detail.task.outputTarget && !!outputNameError) ||
              undefined
            }
            onClick={() => void generate()}
          >
            {page === 'modify'
              ? '确认并发送修改要求'
              : page === 'generation'
                ? '确认并重试生成'
                : page === 'understand' || result?.kind === 'clarify'
                  ? '确认并生成方案'
                  : result || detail.flow
                    ? scope
                      ? '生成这一步的修改'
                      : '生成修改方案'
                    : '理解我的任务'}
          </Button>
        )}
        {page !== 'modify' && (
          <Button
            disabled={
              inputDisabled ||
              !dirty ||
              stale ||
              (!!detail.task.outputTarget && !!outputNameError) ||
              undefined
            }
            onClick={() =>
              void run(async () => {
                await save();
                setMessage('任务草稿已保存。');
              })
            }
          >
            保存任务草稿
          </Button>
        )}
      </div>
    </>
  );

  const trialAction =
    detail?.flow && !detail.proposal && flow ? (
      <Button
        type="primary"
        disabled={busy || dirty || stale || generating || !!scope || undefined}
        ref={trialButton}
        data-run-review-start
        onClick={() => {
          planScroll.current = document.querySelector('main')?.scrollTop ?? 0;
          setMessage('');
          setError('');
          setPage('check');
        }}
      >
        {detail.task.toolTargets?.length ||
        detail.task.toolsRequirePlan ||
        flatten(flow.steps).some((step) => ['mcp', 'desktop'].includes(step.type))
          ? '查看试运行前检查'
          : standaloneGraph
            ? '试运行'
            : '确认方案，去试运行'}
      </Button>
    ) : null;

  const proposalControls =
    detail?.proposal && hasPlanProposal ? (
      <>
        {detail.conflict && (
          <p className="ai-task-note ai-task-failure" role="alert">
            原流程或绑定已变化，请重新生成方案后再采纳。
          </p>
        )}
        <div className={`ai-task-actions${planListView ? ' task-plan-confirm' : ''}`}>
          <Button
            type="primary"
            disabled={busy || dirty || stale || detail.conflict || undefined}
            onClick={() => void proposalAction('adopt')}
          >
            {fullModification ? '采纳修改' : '采纳方案'}
          </Button>
          <Button
            disabled={busy || dirty || stale || undefined}
            onClick={() => void proposalAction('reject')}
          >
            不采纳
          </Button>
        </div>
      </>
    ) : null;

  const proposalNavigation =
    fullModification && detail.proposal ? (
      <div className="ai-task-actions task-proposal-tabs" aria-label="提案核对视图">
        <Button
          aria-pressed={changesView}
          onClick={() => setProposalView({ id: detail.proposal!.id, mode: 'changes' })}
        >
          修改差异
        </Button>
        <Button
          aria-pressed={!changesView}
          onClick={() => setProposalView({ id: detail.proposal!.id, mode: 'flow' })}
        >
          完整新方案
        </Button>
      </div>
    ) : null;

  const workspace = (
    <div
      className={`page ai-task-page${page === 'target' ? ' ai-task-web-target' : ''}${scope ? ' ai-task-scoped' : ''}${scopeDiffView ? ' ai-task-scoped-diff' : ''}`}
      hidden={!props.active || page === 'check'}
    >
      <div className="page-heading ai-task-heading">
        <div>
          <h1 tabIndex={-1}>{page === 'home' ? '你想完成什么？' : title}</h1>
          <p>
            {page === 'modify'
              ? `${detail?.flow?.flow.name ?? '当前任务'} · 当前草稿修订 ${revision} · 目标与输出位置保留`
              : page === 'generation'
                ? generating
                  ? `${providerName} · 仅规划，尚未执行本次任务`
                  : detail?.task.status === 'unsupported'
                    ? '能力不足时停止规划，不生成可执行提案'
                    : '原需求和已保存草稿均保留；本次没有开始执行'
                : page === 'missing-ai'
                  ? '任务描述与已选附件仍在草稿中'
                  : page === 'guide'
                    ? '大约 2 分钟 · 使用无账号的示例网页和你选择的输出目录'
                    : page === 'home'
                      ? '用一句话开始。FlowArk 先给你看步骤，由你决定何时执行。'
                      : page === 'understand'
                        ? '第 3 步 / 确认理解 · 缺少的信息用简单选择补齐'
                        : page === 'brief' && !scope
                          ? '第 1 步 / 描述 · 对话和附件作为本次任务草稿保留'
                          : page === 'target'
                            ? desktopPhase === 'window'
                              ? '第 2 步 / 选目标 · 只有你明确选择的对象会进入任务上下文'
                              : desktopPhase === 'window-ready'
                                ? '仅操作明确绑定的窗口；连接状态与操作权限分别显示'
                                : '应用任务 · 改动预览 · 尚未修改文档'
                            : generating
                              ? '正在理解本次任务，你可以取消生成。'
                              : scope
                                ? `仅修改第 ${scopeIndex + 1} 步 · ${scopedStep ? stepTitle(scopedStep) : scope.nodeId} · 尚未执行`
                                : fullModification
                                  ? `完整流程修改 · 任务基线修订 ${detail?.proposal?.baseRevision} · 尚未采纳`
                                  : standaloneGraph
                                    ? `${flow?.name} · 修订 ${revision} · ${stale ? '草稿已变化，请重新读取' : dirty ? '有未保存修改' : hasPlanProposal ? '待采纳方案' : '清单和流程图使用同一份流程草稿'}`
                                    : viewingPreserved
                                      ? '本次回复没有替换草稿；这里显示此前保存的步骤，尚未开始新的运行。'
                                      : planListView
                                        ? '第 4 步 / 确认方案 · 确认后进入试运行前检查'
                                        : '描述、补问与方案保存在本机；采纳方案后再检查执行。'}
          </p>
        </div>
        {page !== 'home' &&
          page !== 'missing-ai' &&
          page !== 'target' &&
          page !== 'guide' &&
          page !== 'understand' &&
          page !== 'brief' &&
          page !== 'generation' &&
          page !== 'modify' && (
            <div className="ai-task-actions">
              {detail?.flow && detail.flow.id === props.sourceFlowId && (
                <Button
                  disabled={busy || undefined}
                  onClick={() =>
                    void run(async () => {
                      const next = scopeConflict ? detail : await save();
                      if (next.flow) await props.returnToSource(next.flow);
                    })
                  }
                >
                  返回来源步骤
                </Button>
              )}
              <Button disabled={busy || undefined} onClick={() => void back()}>
                返回开始任务
              </Button>
            </div>
          )}
      </div>
      {connectionOrigin && detail?.task.id === connectionOrigin.taskId && page !== 'home' && (
        <aside className="ai-task-note task-connection-origin" aria-label="任务来源">
          <span>来自应用与工具 · {connectionOrigin.connectionName}</span>
          <Button
            disabled={busy || undefined}
            onClick={() => props.returnConnection(connectionOrigin.connectionId)}
          >
            返回连接详情
          </Button>
        </aside>
      )}
      {error && (
        <div className="alert error" role="alert">
          <b>操作未完成</b>
          <span>{error}</span>
          <Button onClick={() => setError('')}>关闭</Button>
        </div>
      )}
      {message && (
        <p className="ai-task-note" role="status">
          {message}
        </p>
      )}
      {attachmentPreview && (
        <section
          className="ai-task-card task-attachment-preview"
          aria-label="附件预览"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              closeAttachmentPreview();
            }
          }}
        >
          <div className="ai-task-actions">
            <h2 ref={attachmentHeading} tabIndex={-1}>
              {attachmentPreview.name}
            </h2>
            <Button onClick={closeAttachmentPreview}>关闭附件预览</Button>
          </div>
          {attachmentPreview.kind === 'image' ? (
            <img src={attachmentPreview.dataUrl} alt={attachmentPreview.name} />
          ) : (
            <pre tabIndex={0} aria-label="附件完整文本">
              {attachmentPreview.text}
            </pre>
          )}
          <p>这是选入任务的完整副本；预览不会发送给 AI，也不会修改原文件。</p>
        </section>
      )}
      {stale && detail && (
        <div className="alert error" role="alert">
          <span>任务已在其他位置修改；重新读取会替换当前未保存输入。</span>
          <Button
            disabled={busy || undefined}
            onClick={() =>
              void run(async () => {
                const next: TaskDetail = await api('task.detail', { id: detail.task.id });
                accept(next);
                if (page === 'generation') setPage(generationDestination(next));
                setReviewed(false);
              })
            }
          >
            重新读取任务
          </Button>
        </div>
      )}
      {page === 'guide' ? (
        <FirstTaskGuide
          progress={learning}
          readError={learningError}
          action={learningAction}
          refresh={() => void run(refreshLearning)}
          busy={busy}
          start={(mode) => void startLearning(mode)}
          skip={() => void skipLearning()}
        />
      ) : page === 'missing-ai' ? (
        <TaskMissingAI
          providerName={providerName}
          configured={props.data.credentials.includes(provider)}
          description={draft.description}
          context={draft.context}
          busy={busy}
          configure={() => {
            setPage(missingOrigin.current);
            props.settings(provider, model, {
              title: draft.description.slice(0, 40) || '当前任务',
              taskId: detail?.task.id,
            });
          }}
          manual={() => void openManual(true)}
        />
      ) : page === 'home' ? (
        <>
          <section className="ai-task-composer">
            <label className="sr-only" htmlFor="new-task-description">
              你想完成的任务
            </label>
            <Input.TextArea
              id="new-task-description"
              ref={(instance) => {
                homeInput.current = instance?.resizableTextArea?.textArea ?? null;
              }}
              rows={1}
              value={homeText}
              disabled={busy || undefined}
              maxLength={20000}
              onChange={(e) => setHomeText(e.target.value)}
              placeholder="把指定网页的标题保存到文件，标题为空就提醒我。"
            />
            <p>也可以附加文件、网页链接或目标截图，帮助说明需求。</p>
            <div className="ai-task-actions task-home-attachments" aria-label="添加任务资料">
              <Button disabled={busy || undefined} onClick={() => void create(homeText, 'file')}>
                ＋ 文件
              </Button>
              <Button disabled={busy || undefined} onClick={() => void create(homeText, 'web')}>
                ＋ 网页
              </Button>
              <Button disabled={busy || undefined} onClick={() => void create(homeText, 'image')}>
                ＋ 截图
              </Button>
            </div>
            <div className="ai-task-actions">
              <Button
                type="primary"
                disabled={busy || !homeText.trim() || undefined}
                onClick={() => void create(homeText)}
              >
                开始规划
              </Button>
              <Button disabled={busy || undefined} onClick={() => props.settings(provider, model)}>
                AI 服务 · {providerName} ·{' '}
                {props.data.credentials.includes(provider) ? '已配置' : '未配置'}
              </Button>
            </div>
          </section>
          <div className="ai-task-examples">
            {[
              [
                '跟着示例做一次',
                '读网页标题 → 检查 → 保存文件',
                '读取我指定网页的标题，非空时新建文本文件保存；为空时提醒我。请先问清网页和输出位置。',
              ],
              [
                '整理表格字段',
                '说明字段和规则，先检查处理步骤。',
                '整理工作簿中的字段，保留原文件，先确认工作表、字段映射、空值策略和输出位置。',
              ],
              [
                '检查应用窗口',
                '选择窗口，核对可操作的内容。',
                '整理我明确选择的文本编辑窗口中的选中段落，先核对原文和改动方案，再由我确认修改。',
              ],
            ].map(([heading, description, prompt]) => (
              <Button
                key={heading}
                disabled={busy || undefined}
                onClick={() =>
                  void (heading === '跟着示例做一次'
                    ? showGuide()
                    : create(prompt, heading === '检查应用窗口' ? 'window' : undefined))
                }
              >
                <h2>{heading}</h2>
                <p>{description}</p>
              </Button>
            ))}
          </div>
          <div className="task-home-status">
            {learning?.taskId && (
              <section className="ai-task-card learning-home" aria-label="教学进度">
                <h2>{learning.status === 'completed' ? '已完成第一次学习' : '继续上次学习'}</h2>
                <p>
                  {learning.status === 'skipped' ? '已跳过 · ' : ''}已完成{' '}
                  {Object.keys(learning.achieved).length} / 4 项学习。
                </p>
                {learningError && <p role="alert">学习记录暂时未取得，请打开学习说明重新读取。</p>}
                {!learningError && !learning.taskExists && (
                  <p role="status">原教学任务已不存在，可以重新学习。已记录的学习进度仍保留。</p>
                )}
                <div className="ai-task-actions">
                  <Button
                    disabled={busy || !!learningError || !learning.taskExists || undefined}
                    onClick={() => void startLearning('continue')}
                  >
                    {learning.status === 'completed' ? '查看教学结果' : '继续教学'}
                  </Button>
                  <Button disabled={busy || undefined} onClick={() => void showGuide()}>
                    {learningError ? '查看学习说明' : '重新学习'}
                  </Button>
                </div>
              </section>
            )}
            <section className="ai-task-card" aria-label="待处理入口">
              <h2>
                需要我处理 · {props.data.attention.filter((item) => !item.read).length} 条未读
              </h2>
              <p>
                {props.data.attention.find((item) => !item.read)?.title ||
                  '当前没有未读提醒。仍可查看待办、人工请求和历史提醒。'}
              </p>
              <div className="ai-task-actions">
                <Button disabled={busy || undefined} onClick={props.openAttention}>
                  查看待办与提醒
                </Button>
              </div>
            </section>
          </div>
          <div className="ai-task-actions task-home-navigation">
            <Button disabled={busy || undefined} onClick={props.flows}>
              使用已有流程
            </Button>
            <Button disabled={busy || undefined} onClick={() => void openManual(false)}>
              手动创建流程
            </Button>
            <Button disabled={busy || undefined} onClick={props.openTools}>
              应用与工具
            </Button>
          </div>
          <section className="ai-task-card" aria-labelledby="task-home-recents-title">
            <div className="task-home-recents-heading">
              <h2 id="task-home-recents-title">继续你的任务</h2>
              <Button
                disabled={busy || undefined}
                aria-disabled={tasksLoading || undefined}
                onClick={() => {
                  if (!tasksLoading) setTasksRefresh((current) => current + 1);
                }}
              >
                {tasksLoading ? '正在读取…' : tasksError ? '重新读取' : '刷新列表'}
              </Button>
            </div>
            <div
              role="status"
              aria-atomic="true"
              className={!tasksLoading && !tasksError ? 'sr-only' : undefined}
            >
              {tasksLoading ? (
                <p>
                  {tasksLoaded ? '正在更新任务列表，已显示的任务仍保留。' : '正在读取任务列表…'}
                </p>
              ) : tasksError ? (
                <p className="task-home-recents-error">
                  任务列表暂时无法读取：{tasksError}。
                  {tasks.length
                    ? '下方保留上次读取的列表，可以重新读取。'
                    : '请重新读取，当前无法确认是否有任务草稿。'}
                </p>
              ) : (
                <span>任务列表已更新，共 {tasks.length} 个任务。</span>
              )}
            </div>
            {tasksLoaded && !tasksLoading && !tasksError && !tasks.length && (
              <p>还没有任务草稿。从上面描述一个目标开始。</p>
            )}
            {tasks.length > 0 && (
              <div className="ai-task-recents">
                {tasks.map((task) => (
                  <Button
                    key={task.id}
                    disabled={busy || undefined}
                    onClick={() => void open(task.id)}
                  >
                    <span>{task.description || '尚未描述的任务'}</span>
                    <small>
                      {status[task.status]} · {new Date(task.updatedAt).toLocaleString('zh-CN')}
                    </small>
                  </Button>
                ))}
              </div>
            )}
          </section>
        </>
      ) : page === 'modify' && detail?.flow && modification ? (
        <TaskModificationPage
          taskId={detail.task.id}
          baseHash={modification.baseHash}
          name={detail.flow.flow.name}
          revision={revision}
          instruction={modification.instruction}
          busy={inputDisabled || stale}
          conflict={modificationConflict}
          invalid={modificationError}
          change={(instruction) => {
            setModification({ ...modification, instruction });
            setReviewed(false);
          }}
          resetReview={() => setReviewed(false)}
          rebase={() => {
            if (detail.proposal || scope) {
              setError('请先返回方案，处理当前提案或退出单步范围。修改要求仍在本页保留。');
              return;
            }
            setModification({
              ...modification,
              baseHash: detail.flowHash,
              description: draft.description,
            });
            setReviewed(false);
          }}
          back={returnFromModification}
          controls={planningControls}
          flow={detail.flow.flow}
          context={detail.flow}
          selected={selected}
          select={setSelected}
        />
      ) : page === 'generation' && detail ? (
        <TaskGenerationPage
          key={detail.task.id}
          task={detail.task}
          result={result}
          resetReview={() => setReviewed(false)}
          busy={busy}
          savedFlow={detail.flow?.flow.name}
          controls={planningControls}
          cancel={() => void cancelGeneration()}
          edit={recoverDescription}
          settings={() => void generationSettings()}
          tools={props.openTools}
          showSaved={() => {
            setPage('review');
            setReviewed(false);
          }}
        />
      ) : page === 'target' && detail ? (
        <TaskWebTargetPage
          adoptionUnavailable={
            detail.flow ||
            detail.proposal ||
            detail.task.webTarget ||
            detail.task.outputTarget ||
            detail.task.toolTargets?.length
              ? '此任务已有流程、提案或其他操作对象。请新建应用任务后保存，当前流程不会被替换。'
              : undefined
          }
          adopted={(next) => {
            epoch.current++;
            accept(next);
            setReviewed(false);
            setView('list');
            setPage('review');
            props.showBrowser(false);
            void props.changed();
          }}
          phaseChanged={setDesktopPhase}
          key={targetEntry?.key}
          initialTab={targetEntry?.tab}
          active={props.active}
          openTools={props.openTools}
          task={detail.task}
          initialUrl={learning?.taskId === detail.task.id ? 'https://example.com' : undefined}
          back={targetFromRun ? backToPlan : backToBrief}
          backLabel={targetFromRun ? '返回任务方案' : undefined}
          changed={props.changed}
          showBrowser={() => props.showBrowser(true)}
          inspectBrowser={props.inspectBrowser}
          selected={(next) => {
            epoch.current++;
            accept(next);
            setReviewed(false);
            setPage('understand');
            props.showBrowser(false);
          }}
        />
      ) : (
        detail && (
          <>
            {page !== 'understand' && page !== 'brief' && learning?.taskId === detail.task.id && (
              <div className="learning-progress" aria-label="教学进度">
                {learningSteps.map((label, i) => (
                  <span
                    key={label}
                    data-done={
                      !!learning.achieved[(['target', 'plan', 'trial', 'result'] as const)[i]]
                    }
                  >
                    {learning.achieved[(['target', 'plan', 'trial', 'result'] as const)[i]]
                      ? '✓'
                      : i + 1}{' '}
                    {label}
                  </span>
                ))}
                <small>学习记录与运行进度分开保存</small>
              </div>
            )}
            {!scopeDiffView &&
              !(changesView && !editingProposal && !dirty && !stale) &&
              !planListView &&
              !standaloneGraph &&
              page !== 'understand' &&
              page !== 'brief' && (
                <div className="ai-task-state" role="status">
                  <span>
                    {detail.task.status === 'plan' && !detail.proposal && detail.flow
                      ? '方案已保存'
                      : status[detail.task.status]}
                  </span>
                  <span>
                    {dirty ? '有未保存修改' : '草稿已保存'} · 修订 {revision}
                  </span>
                </div>
              )}
            {detail.task.error && (
              <p className="ai-task-note ai-task-failure" role="alert">
                {detail.task.error}
              </p>
            )}
            {scopeConflict && (
              <p className="ai-task-note ai-task-failure" role="alert">
                单步修改的基线已变化。请返回来源核对，或明确改为完整任务修改；当前要求已保留。
              </p>
            )}
            {page === 'brief' && !scope ? (
              <TaskBriefPage
                key={detail.task.id}
                task={detail.task}
                description={draft.description}
                context={draft.context}
                busy={inputDisabled || stale}
                dirty={dirty}
                changeDescription={(description) => edit({ ...draft, description })}
                changeContext={(context) => edit({ ...draft, context })}
                choose={(kind) => void chooseAttachment(kind)}
                remove={(id) => void removeAttachment(id)}
                preview={(id) => void previewAttachment(id)}
                attachmentFeedback={attachmentFeedback}
                retryAttachment={retryAttachment}
                target={() => void openTarget()}
                understand={() => void understand()}
                controls={planningControls}
              />
            ) : page === 'understand' ? (
              <TaskUnderstandingPage
                key={detail.task.id}
                task={detail.task}
                outputFeedback={
                  outputFeedback?.taskId === detail.task.id ? outputFeedback : undefined
                }
                description={draft.description}
                context={draft.context}
                outputDirty={outputDirty}
                outputNameError={outputNameError}
                result={result}
                answers={draft.answers}
                options={outputOptions}
                busy={inputDisabled || stale}
                requiredOutput={learning?.taskId === detail.task.id}
                changed={(options) => {
                  setOutputOptions(options);
                  setOutputFeedback(undefined);
                  setReviewed(false);
                  setMessage('');
                }}
                answer={(id, value) =>
                  edit({ ...draft, answers: { ...draft.answers, [id]: value } })
                }
                clearAnswer={clearAnswer}
                choose={() => void changeOutput('choose')}
                clear={() => void changeOutput('clear')}
                describe={() =>
                  void run(async () => {
                    await save();
                    setPage('brief');
                    setReviewed(false);
                  })
                }
                target={() => void openTarget()}
                controls={planningControls}
              />
            ) : (
              <div
                className={`ai-task-columns ${page === 'review' ? 'ai-task-review' : ''}${page === 'review' && !scope && flow ? ' ai-task-plan-review' : ''}${fullModification ? ' ai-task-proposal-columns' : ''}${standaloneGraph ? ' ai-task-full-graph' : ''}${planListView ? ' ai-task-readable-plan' : ''}`}
              >
                <section
                  className="ai-task-card ai-task-input"
                  data-task-conversation
                  tabIndex={-1}
                  aria-label="任务方案对话"
                  style={standaloneGraph ? { display: 'none' } : undefined}
                >
                  {page === 'review' &&
                  !scope &&
                  flow &&
                  !editingProposal &&
                  (!detail.proposal || result?.kind === 'plan') ? (
                    <TaskPlanConversation
                      notice={
                        fullModification ? (
                          <p className="ai-task-note">
                            采纳只更新草稿，当前运行和已建立计划仍使用原快照。
                          </p>
                        ) : undefined
                      }
                      request={detail.task.description || flow.name}
                      answers={detail.task.answers}
                      reply={
                        detail.proposal
                          ? taskProposalSummary(detail) ||
                            `已生成 ${flatten(flow.steps).length} 个步骤，请先检查方案。`
                          : rejectionNotice ||
                            (!dirty && !stale && taskAdoptionSummary(detail)) ||
                            `当前流程草稿包含 ${flatten(flow.steps).length} 个步骤（含分支和循环内步骤）。你可以继续修改要求，或查看同一方案的流程图。`
                      }
                      explanation={detail.proposal ? result?.summary : undefined}
                      pending={hasPlanProposal}
                      dirty={dirty}
                      busy={inputDisabled}
                      stale={stale}
                      graph={!changesView && view === 'graph'}
                      edit={() => {
                        if (!detail.proposal && !dirty) {
                          beginModification();
                          return;
                        }
                        setEditingProposal(true);
                        setReviewed(false);
                        requestAnimationFrame(() =>
                          document.querySelector<HTMLTextAreaElement>('#task-description')?.focus(),
                        );
                      }}
                      toggleView={() => {
                        if (fullModification && detail.proposal)
                          setProposalView({ id: detail.proposal.id, mode: 'flow' });
                        setView(changesView || view !== 'graph' ? 'graph' : 'list');
                        requestAnimationFrame(() => {
                          const heading = document.querySelector<HTMLHeadingElement>(
                            '[data-plan-preview-heading]',
                          );
                          heading?.scrollIntoView({ block: 'nearest' });
                          heading?.focus({ preventScroll: true });
                        });
                      }}
                      discard={() => {
                        accept(detail);
                        setReviewed(false);
                        setEditingProposal(false);
                      }}
                      stepAction={
                        !detail.proposal && selectedStep ? (
                          <Button
                            disabled={inputDisabled || dirty || stale || undefined}
                            onClick={() => void run(() => chooseScope(detail, selectedStep.id))}
                          >
                            修改第{' '}
                            {flatten(flow.steps).findIndex((step) => step.id === selected) + 1} 步
                          </Button>
                        ) : undefined
                      }
                      undoAction={
                        !detail.proposal && detail.canUndo ? (
                          <Button
                            disabled={inputDisabled || dirty || stale || undefined}
                            onClick={() => void proposalAction('undo')}
                          >
                            撤销最近采纳
                          </Button>
                        ) : undefined
                      }
                    >
                      {fullModification && detail.proposal && (
                        <Button
                          disabled={busy || undefined}
                          onClick={() => {
                            setProposalView({ id: detail.proposal!.id, mode: 'changes' });
                            requestAnimationFrame(() => {
                              const heading = document.querySelector<HTMLHeadingElement>(
                                '[data-proposal-diff-heading]',
                              );
                              heading?.scrollIntoView({ block: 'start' });
                              heading?.focus({ preventScroll: true });
                            });
                          }}
                        >
                          检查修改差异
                        </Button>
                      )}
                      {!detail.proposal && (
                        <Button
                          disabled={inputDisabled || undefined}
                          onClick={() => setPage('brief')}
                        >
                          编辑描述与资料
                        </Button>
                      )}
                      {!detail.proposal && (
                        <TaskLatestRun
                          key={detail.task.id}
                          taskId={detail.task.id}
                          revision={detail.task.revision}
                          active={props.active && page === 'review' && !standaloneGraph}
                          disabled={inputDisabled}
                          open={(next) => {
                            const taskId = detail.task.id;
                            props.openRun(next, (intent = 'plan') =>
                              returnToTask.current(taskId, intent),
                            );
                          }}
                        />
                      )}
                    </TaskPlanConversation>
                  ) : scopeDiffView ? (
                    <>
                      <div className="ai-step-user">
                        <b>你</b>
                        <p>{scope?.instruction}</p>
                      </div>
                      <div className="ai-task-note ai-step-reply">
                        <b>FlowArk</b>
                        <p>{taskProposalSummary(detail)}</p>
                        <details className="ai-task-disclosure">
                          <summary>查看 AI 的方案说明</summary>
                          <p>{result?.summary}</p>
                        </details>
                        <p>已核对：只调整所选步骤，其他步骤、结构、静态资源与现有授权保持不变。</p>
                      </div>
                      <p className="ai-task-note">
                        采纳只更新草稿，当前运行和已建立计划仍使用原快照。
                      </p>
                      <details className="ai-task-disclosure">
                        <summary>本次提案来源</summary>
                        <p>
                          任务修订 {revision} · 步骤 {detail.proposal!.scope!.nodeId} · 基线{' '}
                          {detail.proposal!.baseFlowHash.slice(0, 12)}
                        </p>
                        <p>
                          {detail.task.provider} · {detail.task.model}
                        </p>
                      </details>
                    </>
                  ) : (
                    <>
                      {!scope && page === 'review' && editingProposal && (
                        <>
                          <h2>调整任务要求</h2>
                          <p className="ai-task-note">
                            修改要求不会直接改写当前提案。重新生成后，仍需检查并明确采纳。
                          </p>
                          <Button
                            disabled={inputDisabled || undefined}
                            onClick={() => {
                              setEditingProposal(false);
                              setReviewed(false);
                              requestAnimationFrame(() =>
                                document
                                  .querySelector<HTMLButtonElement>('[data-task-modify]')
                                  ?.focus(),
                              );
                            }}
                          >
                            返回方案说明
                          </Button>
                        </>
                      )}
                      {scope && (
                        <div className="ai-task-scope-source">
                          {rejectionNotice && <p className="ai-task-note">{rejectionNotice}</p>}
                          <b>
                            仅修改第 {scopeIndex + 1} 步 ·{' '}
                            {scopedStep ? stepTitle(scopedStep) : scope.nodeId}
                          </b>
                          <small>
                            步骤 {scope.nodeId} · 基线 {scope.baseFlowHash.slice(0, 12)}
                          </small>
                          <p>其他步骤、子步骤和静态资源保持不变。采纳只更新草稿。</p>
                        </div>
                      )}
                      <label htmlFor="task-description">
                        {scope ? '这一步怎么改' : '你的需求'}
                      </label>
                      <Input.TextArea
                        id="task-description"
                        disabled={inputDisabled || undefined}
                        value={scope ? scope.instruction : draft.description}
                        maxLength={scope ? 10000 : 20000}
                        onChange={(e) =>
                          edit(
                            scope
                              ? { ...draft, scope: { ...scope, instruction: e.target.value } }
                              : { ...draft, description: e.target.value },
                          )
                        }
                      />
                      {scope && (
                        <details className="ai-task-disclosure">
                          <summary>原任务描述</summary>
                          <p>{draft.description || '此任务从已保存流程开始。'}</p>
                        </details>
                      )}
                      {result && (
                        <div className="ai-task-note">
                          <b>FlowArk</b>
                          <p>{result.summary}</p>
                        </div>
                      )}
                      {page === 'brief' && (
                        <>
                          <div className="ai-task-actions">
                            <Button
                              disabled={
                                inputDisabled ||
                                draft.context.length >=
                                  20 -
                                    Number(!!detail.task.webTarget) -
                                    Number(!!detail.task.outputTarget) -
                                    (detail.task.attachments?.length ?? 0) ||
                                undefined
                              }
                              onClick={() =>
                                edit({
                                  ...draft,
                                  context: [
                                    ...draft.context,
                                    {
                                      id: crypto.randomUUID(),
                                      kind: 'text',
                                      label: '补充资料',
                                      text: '',
                                    },
                                  ],
                                })
                              }
                            >
                              附加文本资料
                            </Button>
                            <Button
                              disabled={inputDisabled || !!scope || undefined}
                              onClick={() => void openTarget()}
                            >
                              网页链接与对象
                            </Button>
                            <Button
                              disabled={inputDisabled || !!scope || undefined}
                              onClick={() => void understand()}
                            >
                              理解与输出位置
                            </Button>
                          </div>
                          <h2>
                            已选上下文 ·{' '}
                            {draft.context.length +
                              Number(!!detail.task.webTarget) +
                              Number(!!detail.task.outputTarget)}{' '}
                            项
                          </h2>
                          {draft.context.map((entry, index) => (
                            <ConfigProvider
                              componentDisabled={inputDisabled || undefined}
                              key={entry.id}
                            >
                              <fieldset className="ai-task-context" disabled={inputDisabled}>
                                <label>
                                  资料名称
                                  <Input
                                    aria-label={`资料 ${index + 1} 名称`}
                                    value={entry.label}
                                    maxLength={200}
                                    onChange={(e) =>
                                      edit({
                                        ...draft,
                                        context: draft.context.map((c) =>
                                          c.id === entry.id ? { ...c, label: e.target.value } : c,
                                        ),
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  资料内容
                                  <Input.TextArea
                                    aria-label={`资料 ${index + 1} 内容`}
                                    value={entry.text}
                                    maxLength={50000}
                                    onChange={(e) =>
                                      edit({
                                        ...draft,
                                        context: draft.context.map((c) =>
                                          c.id === entry.id ? { ...c, text: e.target.value } : c,
                                        ),
                                      })
                                    }
                                  />
                                </label>
                                <Button
                                  onClick={() =>
                                    edit({
                                      ...draft,
                                      context: draft.context.filter((c) => c.id !== entry.id),
                                    })
                                  }
                                >
                                  移除资料 {index + 1}
                                </Button>
                              </fieldset>
                            </ConfigProvider>
                          ))}
                        </>
                      )}
                      {detail.task.webTarget && (
                        <div className="ai-task-note" aria-label="已选网页来源">
                          <b>{detail.task.webTarget.page.title || '未命名网页'}</b>
                          <p>{detail.task.webTarget.page.url}</p>
                          <p>
                            {detail.task.webTarget.element
                              ? `只读取元素：${detail.task.webTarget.element.target.label || detail.task.webTarget.element.target.tag}`
                              : '只读取此网页'}{' '}
                            · 账号未核对 · 本机内置浏览器
                          </p>
                          <Button
                            disabled={inputDisabled || !!scope || undefined}
                            onClick={() => void openTarget()}
                          >
                            查看或更换网页目标
                          </Button>
                        </div>
                      )}
                      {result?.kind === 'clarify' && (
                        <PlanningQuestions
                          questions={result.questions}
                          clear={clearAnswer}
                          answers={draft.answers}
                          busy={inputDisabled || stale}
                          answer={(id, value) =>
                            edit({ ...draft, answers: { ...draft.answers, [id]: value } })
                          }
                        />
                      )}
                      {planningControls}
                      {page === 'review' && (
                        <Button disabled={busy || undefined} onClick={() => setPage('brief')}>
                          编辑描述与资料
                        </Button>
                      )}
                      {scope && (
                        <Button
                          disabled={inputDisabled || undefined}
                          onClick={() =>
                            void run(async () => {
                              const { scope: _scope, ...whole } = draft;
                              accept(
                                await api('task.save', {
                                  id: detail.task.id,
                                  revision,
                                  ...whole,
                                  answers: {},
                                }),
                              );
                              setReviewed(false);
                              setMessage(
                                '已退出单步范围。接下来将按完整任务需求生成，请重新核对。',
                              );
                            })
                          }
                        >
                          改为修改完整任务
                        </Button>
                      )}
                    </>
                  )}
                </section>
                <section className="ai-task-card ai-task-result">
                  {generating ? (
                    <div className="ai-task-empty" role="status">
                      <h2>正在理解你的任务</h2>
                      <p>
                        {providerName} · {model}
                      </p>
                      <p>收到完整方案后才能采纳。取消会保留原草稿。</p>
                    </div>
                  ) : page === 'brief' && !flow ? (
                    <>
                      <h2>任务会怎样完成？</h2>
                      <div className="ai-task-note">
                        <h2>先理解，再执行</h2>
                        <p>先明确输入、操作对象、修改范围与结果。</p>
                      </div>
                      <div className="ai-task-card">
                        <h2>先展示方案</h2>
                        <p>你可以补充要求，也可以切换到流程图。</p>
                      </div>
                      <div className="ai-task-card">
                        <h2>执行前再次检查</h2>
                        <p>采纳后检查目标与权限，由你决定何时执行。</p>
                      </div>
                    </>
                  ) : scopedProposal && flow ? (
                    <>
                      <h2>
                        修改范围 ·{' '}
                        {
                          new Set(detail.changes.map((change) => change.nodeId).filter(Boolean))
                            .size
                        }{' '}
                        / {flatten(flow.steps).length} 步
                      </h2>
                      <ScopedChanges
                        changes={detail.changes}
                        before={flatten(detail.proposal!.baseFlow!.steps).find(
                          (step) => step.id === detail.proposal!.scope!.nodeId,
                        )}
                        after={flatten(flow.steps).find(
                          (step) => step.id === detail.proposal!.scope!.nodeId,
                        )}
                      />
                      <p>已核对：其他步骤、结构和静态资源保持不变；现有绑定和权限不增加。</p>
                      {detail.conflict && (
                        <p className="ai-task-note ai-task-failure" role="alert">
                          原流程或绑定已变化，请重新核对；不能采纳旧提案。
                        </p>
                      )}
                      <div className="ai-task-actions">
                        <Button
                          type="primary"
                          disabled={busy || dirty || stale || detail.conflict || undefined}
                          onClick={() => void proposalAction('adopt')}
                        >
                          采纳修改
                        </Button>
                        <Button
                          disabled={busy || dirty || stale || undefined}
                          onClick={() => void proposalAction('reject')}
                        >
                          不采纳
                        </Button>
                      </div>
                      <Button
                        disabled={inputDisabled || undefined}
                        onClick={() => {
                          setEditingProposal(true);
                          requestAnimationFrame(() =>
                            document
                              .querySelector<HTMLTextAreaElement>('#task-description')
                              ?.focus(),
                          );
                        }}
                      >
                        继续描述修改
                      </Button>
                    </>
                  ) : flow ? (
                    <>
                      {viewingPreserved && (
                        <div className="ai-task-note" role="status">
                          <p>这是此前保存的草稿。本次回复没有可采纳的方案，也没有修改这些步骤。</p>
                          <Button disabled={busy || undefined} onClick={recoverDescription}>
                            调整任务要求
                          </Button>
                          {detail.task.status === 'unsupported' && (
                            <Button
                              disabled={busy || undefined}
                              onClick={() => setPage('generation')}
                            >
                              返回能力说明
                            </Button>
                          )}
                        </div>
                      )}
                      {!changesView && proposalNavigation}
                      {!changesView && (
                        <>
                          {planListView ? (
                            <TaskPlanIdentity
                              name={flow.name}
                              revision={revision}
                              pending={hasPlanProposal}
                              dirty={dirty}
                              stale={stale}
                            />
                          ) : !standaloneGraph ? (
                            <div className="ai-task-meta">
                              <h2 tabIndex={-1} data-plan-preview-heading>
                                {flow.name}
                              </h2>
                              <span className="badge">
                                {hasPlanProposal ? '待采纳方案' : '已保存草稿'}
                              </span>
                            </div>
                          ) : null}
                          <div
                            className={`ai-task-actions${planListView ? ' task-plan-tabs' : ''}${standaloneGraph ? ' task-graph-toolbar' : ''}`}
                            tabIndex={standaloneGraph ? -1 : undefined}
                            data-plan-preview-heading={standaloneGraph ? true : undefined}
                            aria-label="方案视图"
                          >
                            <Button aria-pressed={view === 'list'} onClick={() => setView('list')}>
                              步骤清单
                            </Button>
                            <Button
                              aria-pressed={view === 'graph'}
                              onClick={() => setView('graph')}
                            >
                              流程图
                            </Button>
                            {!planListView && trialAction}
                            {!detail.proposal && (
                              <Button
                                className="task-plan-more"
                                ref={moreButton}
                                aria-label="打开任务更多操作"
                                aria-describedby={moreUnavailable ? 'task-more-reason' : undefined}
                                disabled={!!moreUnavailable || undefined}
                                onClick={() => void openPlanMore()}
                              >
                                更多 ···
                              </Button>
                            )}
                          </div>
                          {moreUnavailable && !detail.proposal && !viewingPreserved && (
                            <p id="task-more-reason" className="ai-task-note">
                              {moreUnavailable}
                            </p>
                          )}
                          <div
                            className={
                              standaloneGraph ? 'task-graph-workspace' : 'task-graph-inline'
                            }
                          >
                            <TaskStepList
                              key={detail.task.id}
                              ref={planStepList}
                              active={view === 'list'}
                              flow={flow}
                              selected={selected}
                              select={(id) => {
                                setSelected(id);
                                setHiddenListStep('');
                                setGraphFocus((value) => (value ?? 0) + 1);
                                requestAnimationFrame(() => {
                                  const heading = document.querySelector<HTMLHeadingElement>(
                                    '[data-task-step-heading]',
                                  );
                                  heading?.scrollIntoView({ block: 'nearest' });
                                  heading?.focus({ preventScroll: true });
                                });
                              }}
                              context={{
                                bindings: detail.flow?.bindings,
                                webTarget: hasPlanProposal
                                  ? detail.task.webTarget
                                  : detail.flow?.webTarget,
                                outputTarget: hasPlanProposal
                                  ? detail.task.outputTarget
                                  : detail.flow?.outputTarget,
                                toolTargets: hasPlanProposal
                                  ? detail.task.toolTargets
                                  : detail.flow?.toolTargets,
                              }}
                            />
                            {view === 'graph' && (
                              <div className="ai-task-graph" aria-label="任务流程图">
                                <DiagramCanvas
                                  {...diagram}
                                  taskPresentation={standaloneGraph}
                                  focusRequest={graphFocus}
                                  active={props.active && page === 'review'}
                                  selected={selected}
                                  select={(id, source) => {
                                    setSelected(id);
                                    if (source === 'keyboard')
                                      requestAnimationFrame(() => {
                                        const heading = document.querySelector<HTMLHeadingElement>(
                                          '[data-task-step-heading]',
                                        );
                                        heading?.scrollIntoView({ block: 'center' });
                                        heading?.focus({ preventScroll: true });
                                      });
                                  }}
                                />
                              </div>
                            )}
                            {(view === 'graph' ||
                              (selectedStep && hiddenListStep !== selected)) && (
                              <TaskStepInspector
                                presentation={standaloneGraph ? 'graph' : 'full'}
                                focusInGraph={
                                  standaloneGraph
                                    ? () => {
                                        setGraphFocus((value) => (value ?? 0) + 1);
                                        requestAnimationFrame(() => {
                                          const canvas = document.querySelector<HTMLElement>(
                                            '.task-graph-workspace > .ai-task-graph',
                                          );
                                          canvas?.scrollIntoView({ block: 'nearest' });
                                          const node = [
                                            ...(canvas?.querySelectorAll<HTMLElement>(
                                              '.react-flow__node',
                                            ) ?? []),
                                          ].find((item) => item.dataset.id === selected);
                                          node?.focus({ preventScroll: true });
                                        });
                                      }
                                    : undefined
                                }
                                flow={flow}
                                selected={selected}
                                select={(id) => {
                                  setSelected(id);
                                  setGraphFocus((value) => (value ?? 0) + 1);
                                }}
                                context={{
                                  bindings: detail.flow?.bindings,
                                  webTarget: hasPlanProposal
                                    ? detail.task.webTarget
                                    : detail.flow?.webTarget,
                                  outputTarget: hasPlanProposal
                                    ? detail.task.outputTarget
                                    : detail.flow?.outputTarget,
                                  toolTargets: hasPlanProposal
                                    ? detail.task.toolTargets
                                    : detail.flow?.toolTargets,
                                }}
                                actions={
                                  <>
                                    {view === 'list' && selectedStep && (
                                      <Button
                                        onClick={() => {
                                          planStepList.current?.reveal(selectedStep.id);
                                          setHiddenListStep(selectedStep.id);
                                        }}
                                      >
                                        返回步骤清单
                                      </Button>
                                    )}
                                    {selectedStep && !scope && (
                                      <Button
                                        type="primary"
                                        disabled={
                                          inputDisabled ||
                                          dirty ||
                                          stale ||
                                          !!detail.proposal ||
                                          undefined
                                        }
                                        onClick={() =>
                                          void run(() => chooseScope(detail, selectedStep.id))
                                        }
                                      >
                                        用 AI 修改此步
                                      </Button>
                                    )}
                                    {selectedStep &&
                                      !scope &&
                                      (dirty || stale || !!detail.proposal) && (
                                        <p className="task-step-position">
                                          {detail.proposal
                                            ? hasPlanProposal
                                              ? '采纳当前方案后，才能单独修改这一步。'
                                              : '本次没有可采纳方案，请先调整任务要求并重新生成。'
                                            : dirty
                                              ? '先保存或放弃当前任务输入，再修改所选步骤。'
                                              : '任务已变化，请重新读取后继续。'}
                                        </p>
                                      )}
                                    {view === 'graph' && (
                                      <Button onClick={returnToConversation}>回到对话</Button>
                                    )}
                                  </>
                                }
                              />
                            )}
                          </div>
                          <TaskPlanScope
                            flow={flow}
                            compact={planListView}
                            context={{
                              bindings: detail.flow?.bindings,
                              webTarget: hasPlanProposal
                                ? detail.task.webTarget
                                : detail.flow?.webTarget,
                              outputTarget: hasPlanProposal
                                ? detail.task.outputTarget
                                : detail.flow?.outputTarget,
                              toolTargets: hasPlanProposal
                                ? detail.task.toolTargets
                                : detail.flow?.toolTargets,
                            }}
                            select={(id) => {
                              setSelected(id);
                              setHiddenListStep('');
                              setGraphFocus((value) => (value ?? 0) + 1);
                              requestAnimationFrame(() => {
                                const heading = document.querySelector<HTMLHeadingElement>(
                                  '[data-task-step-heading]',
                                );
                                heading?.scrollIntoView({ block: 'nearest' });
                                heading?.focus({ preventScroll: true });
                              });
                            }}
                          />
                          {flatten(flow.steps).some((step) => step.type === 'desktop') && (
                            <p className="ai-task-note">
                              应用方案已保存。进入试运行检查后重新选择窗口与原文，核对替换文字并明确授权单次修改；保存草稿本身不会修改文档。
                            </p>
                          )}
                          {flatten(flow.steps).some((step) => step.type === 'mcp') && (
                            <p className="ai-task-note">
                              检查页会核对工具和参数；明确确认本次试运行后才会连接服务并执行。
                            </p>
                          )}
                        </>
                      )}
                      {detail.proposal && hasPlanProposal && (
                        <>
                          {fullModification ? (
                            <div hidden={!changesView}>
                              <TaskProposalReview
                                key={detail.proposal.id}
                                detail={detail}
                                actions={proposalControls}
                              />
                            </div>
                          ) : (
                            <>
                              <details className="task-proposal-source">
                                <summary>查看完整资源声明与生成差异</summary>
                                <h2>资源与权限</h2>
                                <ul className="ai-task-resources">
                                  {detail.resources.map((resource, i) => (
                                    <li key={i}>{resource}</li>
                                  ))}
                                  {!detail.resources.length && (
                                    <li>没有文件、浏览器、HTTP、脚本或工具资源操作。</li>
                                  )}
                                  <li>
                                    声明的能力：{flow.requiredCapabilities.join('、') || '无'}
                                  </li>
                                </ul>
                                <PlanningChanges
                                  key={detail.proposal.id}
                                  changes={detail.changes}
                                  before={detail.proposal.baseFlow}
                                  after={flow}
                                  revision={detail.proposal.baseRevision}
                                />
                              </details>
                            </>
                          )}
                          {changesView && proposalNavigation}
                          {(!fullModification || !changesView) && proposalControls}
                        </>
                      )}
                      {!detail.proposal && detail.flow && (
                        <div className="ai-task-actions task-plan-confirm">
                          {planListView && trialAction}
                          <Button
                            disabled={busy || undefined}
                            onClick={() =>
                              void run(async () => {
                                const next = await save();
                                if (next.flow) props.openFlow(next.flow);
                              })
                            }
                          >
                            {planListView ? '手动编辑' : '打开流程编排'}
                          </Button>
                          {detail.canUndo && !planListView && (
                            <Button
                              disabled={busy || dirty || stale || undefined}
                              onClick={() => void proposalAction('undo')}
                            >
                              撤销最近采纳
                            </Button>
                          )}
                        </div>
                      )}
                      {!planListView && !fullModification && !viewingPreserved && (
                        <p className="ai-task-note">
                          采纳只更新草稿。当前运行和已建立的计划继续使用原快照。
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <h2>{result?.kind === 'clarify' ? '补充这些信息后继续' : '当前任务说明'}</h2>
                      <p>{result?.summary || '保存描述后，核对本次内容并生成方案。'}</p>
                      <Button disabled={busy || undefined} onClick={() => setPage('brief')}>
                        返回描述与资料
                      </Button>
                    </>
                  )}
                  {result?.limitations.length ? (
                    <div className="ai-task-note">
                      <h2>需要注意的限制</h2>
                      <ul>
                        {result.limitations.map((limitation, index) => (
                          <li key={index}>{limitation}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
  return (
    <>
      {workspace}
      <RunReviewPage
        active={props.active && page === 'check'}
        selection={
          detail?.flow
            ? { id: detail.flow.id, task: { id: detail.task.id, revision: detail.task.revision } }
            : undefined
        }
        source={JSON.stringify(detail?.flow ?? null)}
        bound={(next) => accept(next)}
        back={backToPlan}
        edit={() =>
          void run(async () => {
            const taskId = detail?.task.id;
            await props.changed();
            if (
              location.current.active &&
              location.current.page === 'check' &&
              selectedTask.current === taskId &&
              detail?.flow
            )
              props.openFlow(detail.flow);
          })
        }
        openDetail={(next) => {
          const taskId = detail!.task.id;
          setPage('review');
          props.openRun(next, (intent = 'plan') => returnToTask.current(taskId, intent));
          void props.changed();
        }}
      />
    </>
  );
}

function ScopedChanges({
  changes,
  before,
  after,
}: {
  changes: PlanningChange[];
  before?: Step;
  after?: Step;
}) {
  const labels: Record<string, string> = {
    actual: '判断内容',
    operator: '判断方式',
    expected: '预期值',
    value: '值',
    items: '循环来源',
    rows: '数据来源',
    mappings: '字段映射',
    includeHeaders: '表头',
    sheet: '工作表',
    code: '代码',
    input: '输入',
    language: '语言',
    timeoutMs: '超时',
    name: '名称',
    message: '提示内容',
    content: '写入内容',
    cells: '单元格',
    files: '输出内容',
    body: '请求内容',
  };
  return (
    <div className="ai-step-diff-values">
      {(['before', 'after'] as const).map((side) => (
        <section key={side} className={`ai-step-${side}`}>
          <h2>{side === 'before' ? '原配置' : '新配置'}</h2>
          {before?.type === 'condition' &&
          after?.type === 'condition' &&
          changes.every((change) =>
            ['actual', 'operator', 'expected'].includes(change.path.split('/').at(-1)!),
          ) ? (
            <p>{conditionText(side === 'before' ? before : after)}</p>
          ) : (
            changes.map((change) => (
              <div key={change.path}>
                <h3>{labels[change.path.split('/').at(-1)!] ?? change.path}</h3>
                <pre>{text(change[side])}</pre>
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function conditionText(step: Extract<Step, { type: 'condition' }>) {
  const values = (value: unknown) =>
    value === '' ? '空文本' : value === null ? '空值' : text(value);
  const operators: Record<Extract<Step, { type: 'condition' }>['operator'], string> = {
    equals: '等于',
    notEquals: '不等于',
    contains: '包含',
    gt: '大于（数字）',
    exists: '不是空值',
  };
  return `${values(step.actual)} ${operators[step.operator]}${step.operator === 'exists' ? '' : ` ${values(step.expected)}`}`;
}
