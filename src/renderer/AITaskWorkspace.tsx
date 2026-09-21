import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bootstrap, FlowRecord, Step } from '../shared/types';
import type { PlanningChange, PlanningContext, PlanningTask, TaskDetail } from '../shared/planning';
import { buildDiagram } from './flow-diagram';
import DiagramCanvas from './DiagramCanvas';
import { kinds } from './node-kinds';
import { flatten } from './flow-editing';
import RunReviewPage from './RunReviewPage';
import type { TaskRunIntent } from './task-run-presentation';
import { scopedDescription, type PlanningScope } from '../shared/planning-scope';
import { stepTitle } from './flow-outline';
import TaskWebTargetPage from './TaskWebTargetPage';
import FirstTaskGuide from './FirstTaskGuide';
import { learningSteps, type LearningStatus } from '../shared/learning';
import { webContext } from '../shared/task-web-target';

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
type Props = {
  guideEntry?: number;
  showBrowser: (visible: boolean) => void;
  entry?: { key: string; record: FlowRecord; nodeId: string };
  entryHandled: () => void;
  sourceFlowId?: string;
  returnToSource: (record: FlowRecord) => Promise<void>;
  active: boolean;
  data: Bootstrap;
  onNavigation: (title: string, back?: () => void, backLabel?: string) => void;
  openRun: (detail: any, back: (intent?: TaskRunIntent) => void) => void;
  settings: (provider: 'deepseek' | 'openai-codex', model: string) => void;
  flows: () => void;
  createFlow: () => void;
  openFlow: (flow: FlowRecord) => void;
  changed: () => Promise<void>;
};

export default function AITaskWorkspace(props: Props) {
  const [tasks, setTasks] = useState<PlanningTask[]>([]);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [draft, setDraft] = useState<Draft>({ description: '', context: [], answers: {} });
  const [saved, setSaved] = useState('');
  const [revision, setRevision] = useState(0);
  const [homeText, setHomeText] = useState('');
  const [learning, setLearning] = useState<LearningStatus>();
  const handledGuide = useRef(0);
  const [page, setPage] = useState<'home' | 'guide' | 'brief' | 'target' | 'review' | 'check'>(
    'home',
  );
  const backToBrief = useCallback(() => setPage('brief'), []);
  const location = useRef({ active: props.active, page });
  location.current = { active: props.active, page };
  const planScroll = useRef(0);
  const returnToTask = useRef<(id: string, intent: TaskRunIntent) => void>(() => {});
  const trialButton = useRef<HTMLButtonElement>(null);
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
  const [provider, setProvider] = useState<'deepseek' | 'openai-codex'>('deepseek');
  const [model, setModel] = useState('deepseek-flash');
  const [reviewed, setReviewed] = useState(false);
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [selected, setSelected] = useState('');
  const [editingProposal, setEditingProposal] = useState(false);
  const dirty = !!detail && JSON.stringify(draft) !== saved;
  const generating = detail?.task.status === 'generating';
  const stale = !!detail && detail.task.revision !== revision;
  const result = detail?.proposal?.result;
  const flow = result?.kind === 'plan' ? result.flow : detail?.flow?.flow;
  const diagram = useMemo(() => buildDiagram(flow?.steps ?? [], selected), [flow, selected]);
  const selectedStep = flow && flatten(flow.steps).find((step) => step.id === selected);
  const scope = draft.scope;
  const scopedSteps = flatten(detail?.flow?.flow.steps ?? []);
  const scopeIndex = scopedSteps.findIndex((step) => step.id === scope?.nodeId);
  const scopedStep = scopedSteps[scopeIndex];
  const scopeConflict = !!scope && scope.baseFlowHash !== detail?.flowHash;
  const scopedProposal = result?.kind === 'plan' && !!detail?.proposal?.scope;
  const scopeDiffView = scopedProposal && !editingProposal;
  const title =
    page === 'guide'
      ? '第一次，让我们一起完成'
      : page === 'target'
        ? '这次要操作哪里？'
        : page === 'check'
          ? '试运行前，最后确认一次'
          : page === 'home'
            ? '开始任务'
            : page === 'brief'
              ? '描述需求，带上必要资料'
              : result?.kind === 'clarify'
                ? '我理解你要……'
                : result?.kind === 'unsupported'
                  ? '这项任务还需要支持'
                  : result?.kind === 'plan' && detail?.proposal?.baseFlow
                    ? '检查 AI 提议的修改'
                    : '先看看任务步骤';

  useEffect(() => {
    if (props.active)
      props.onNavigation(
        title,
        page === 'check'
          ? backToPlan
          : page === 'target'
            ? backToBrief
            : page === 'guide'
              ? () => {
                  void back();
                }
              : undefined,
        page === 'target' ? '描述与附件' : page === 'guide' ? '开始任务' : undefined,
      );
  }, [props.active, title, page, backToPlan, backToBrief, props.onNavigation]);
  useEffect(() => {
    if (!props.active) return;
    let live = true;
    void api('task.list')
      .then((next) => {
        if (live) setTasks(next);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [props.active, page]);
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
            next.proposal
          )
            setPage('review');
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
      if (pending) return;
      pending = true;
      try {
        const ticket = epoch.current;
        const next = await api('learning.status');
        if (live && ticket === epoch.current) setLearning(next);
      } catch (e) {
        if (live) setError((e as Error).message);
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

  function accept(next: TaskDetail) {
    selectedTask.current = next.task.id;
    setDetail(next);
    const nextDraft = draftOf(next);
    setDraft(nextDraft);
    setSaved(JSON.stringify(nextDraft));
    setRevision(next.task.revision);
  }
  function edit(next: Draft) {
    setDraft(next);
    setReviewed(false);
    setMessage('');
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
  async function save(): Promise<TaskDetail> {
    if (!detail) throw new Error('请先创建任务');
    if (stale) throw new Error('任务已在其他位置修改，请重新读取后继续');
    if (!dirty) return detail;
    const next: TaskDetail = await api('task.save', { id: detail.task.id, revision, ...draft });
    accept(next);
    return next;
  }
  async function open(id: string) {
    await run(async () => {
      if (detail && dirty) await save();
      const next: TaskDetail = await api('task.detail', { id });
      accept(next);
      setReviewed(false);
      setSelected('');
      setProvider(next.task.provider ?? 'deepseek');
      setModel(next.task.model ?? 'deepseek-flash');
      setPage(next.proposal || next.flow ? 'review' : 'brief');
    });
  }
  async function create(description: string) {
    await run(async () => {
      if (detail && dirty) await save();
      const next: TaskDetail = await api('task.create');
      const stored: TaskDetail = await api('task.save', {
        id: next.task.id,
        revision: next.task.revision,
        description,
        context: [],
        answers: {},
      });
      accept(stored);
      setReviewed(false);
      setPage('brief');
      setSelected('');
      setHomeText('');
    });
  }
  async function generate() {
    await run(async () => {
      if (!reviewed) throw new Error('请先核对本次发送的内容');
      const next = await save();
      setEditingProposal(false);
      accept(
        await api('task.generate', {
          id: next.task.id,
          revision: next.task.revision,
          provider,
          model,
          reviewed: true,
        }),
      );
      setReviewed(false);
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
    });
  }
  async function back() {
    await run(async () => {
      if (detail && dirty) await save();
      setPage('home');
    });
  }
  async function openTarget() {
    await run(async () => {
      await save();
      setReviewed(false);
      props.showBrowser(false);
      setPage('target');
    });
  }
  async function showGuide() {
    await run(async () => {
      if (detail && dirty) await save();
      setLearning(await api('learning.status'));
      props.showBrowser(false);
      setPage('guide');
    });
  }
  async function startLearning(mode: 'continue' | 'restart') {
    await run(async () => {
      if (!learning) return;
      if (detail && dirty) await save();
      const next = await api('learning.start', { revision: learning.revision, mode });
      setLearning(next.learning);
      accept(next.detail);
      setReviewed(false);
      setProvider(next.detail.task.provider ?? 'deepseek');
      setModel(next.detail.task.model ?? 'deepseek-flash');
      setPage(next.detail.proposal || next.detail.flow ? 'review' : 'brief');
      if (next.learning.latestRunId) {
        const result = await api('run.detail', { id: next.learning.latestRunId });
        if (result.run)
          props.openRun(result, (intent = 'plan') =>
            returnToTask.current(next.detail.task.id, intent),
          );
      }
    });
  }
  async function skipLearning() {
    await run(async () => {
      if (!learning) return;
      setLearning(await api('learning.skip', { revision: learning.revision }));
      setPage('home');
    });
  }
  const providerName = provider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
  const inputDisabled = busy || generating;

  returnToTask.current = (taskId, intent) => {
    const arrive = () => {
      if (intent === 'plan') backToPlan();
      else {
        setPage(intent === 'home' ? 'home' : 'brief');
        requestAnimationFrame(() => {
          document.querySelector('main')?.scrollTo(0, 0);
          document.querySelector<HTMLTextAreaElement>('#task-description')?.focus();
        });
      }
    };
    if (selectedTask.current === taskId) arrive();
    else
      void run(async () => {
        if (dirty) await save();
        const original = await api('task.detail', { id: taskId });
        if (!location.current.active) return;
        accept(original);
        setReviewed(false);
        arrive();
      });
  };

  const workspace = (
    <div
      className={`page ai-task-page${page === 'target' ? ' ai-task-web-target' : ''}${scope ? ' ai-task-scoped' : ''}${scopeDiffView ? ' ai-task-scoped-diff' : ''}`}
      hidden={!props.active || page === 'check'}
    >
      <div className="page-heading ai-task-heading">
        <div>
          <h1>{page === 'home' ? '你想完成什么？' : title}</h1>
          <p>
            {page === 'guide'
              ? '大约 2 分钟 · 使用无账号的示例网页和你选择的输出目录'
              : page === 'home'
                ? '用一句话开始。FlowArk 先给你看步骤，由你决定何时执行。'
                : page === 'target'
                  ? '第 2 步 / 选目标 · 只有你明确选择的对象会进入任务上下文'
                  : generating
                    ? '正在理解本次任务，你可以取消生成。'
                    : scope
                      ? `仅修改第 ${scopeIndex + 1} 步 · ${scopedStep ? stepTitle(scopedStep) : scope.nodeId} · 尚未执行`
                      : '描述、补问与方案保存在本机；采纳方案后再检查执行。'}
          </p>
        </div>
        {page !== 'home' && page !== 'target' && page !== 'guide' && (
          <div className="ai-task-actions">
            {detail?.flow && detail.flow.id === props.sourceFlowId && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = scopeConflict ? detail : await save();
                    if (next.flow) await props.returnToSource(next.flow);
                  })
                }
              >
                返回来源步骤
              </button>
            )}
            <button disabled={busy} onClick={() => void back()}>
              返回开始任务
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="alert error" role="alert">
          <b>操作未完成</b>
          <span>{error}</span>
          <button onClick={() => setError('')}>关闭</button>
        </div>
      )}
      {message && (
        <p className="ai-task-note" role="status">
          {message}
        </p>
      )}
      {page === 'guide' ? (
        <FirstTaskGuide
          progress={learning}
          busy={busy}
          start={(mode) => void startLearning(mode)}
          skip={() => void skipLearning()}
        />
      ) : page === 'home' ? (
        <>
          <section className="ai-task-composer">
            <label htmlFor="new-task-description">你想完成的任务</label>
            <textarea
              id="new-task-description"
              value={homeText}
              maxLength={20000}
              onChange={(e) => setHomeText(e.target.value)}
              placeholder="把指定网页的标题保存到文件，标题为空就提醒我。"
            />
            <p>描述目标、输入与希望得到的结果，下一步可以补充文本资料。</p>
            <div className="ai-task-actions">
              <button
                className="primary"
                disabled={busy || !homeText.trim()}
                onClick={() => void create(homeText)}
              >
                开始规划
              </button>
              <button onClick={() => props.settings('deepseek', 'deepseek-flash')}>
                AI 服务 ·{' '}
                {props.data.credentials.includes('deepseek') ? 'DeepSeek 已配置' : '配置服务'}
              </button>
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
                '整理一段文本',
                '粘贴资料，说明需要的格式。',
                '请根据我接下来提供的文本，设计整理并保存结果的流程。先确认整理规则和输出位置。',
              ],
            ].map(([heading, description, prompt]) => (
              <button
                key={heading}
                disabled={busy}
                onClick={() => void (heading === '跟着示例做一次' ? showGuide() : create(prompt))}
              >
                <h2>{heading}</h2>
                <p>{description}</p>
                <small>用这个需求开始</small>
              </button>
            ))}
          </div>
          {learning?.taskId && (
            <section className="ai-task-card learning-home" aria-label="教学进度">
              <h2>{learning.status === 'completed' ? '已完成第一次学习' : '继续上次学习'}</h2>
              <p>
                {learning.status === 'skipped' ? '已跳过 · ' : ''}已完成{' '}
                {Object.keys(learning.achieved).length} / 4 项学习。运行状态和结果在原任务中查看。
              </p>
              <div className="ai-task-actions">
                <button disabled={busy} onClick={() => void startLearning('continue')}>
                  {learning.status === 'completed' ? '查看教学结果' : '继续教学'}
                </button>
                <button disabled={busy} onClick={() => void showGuide()}>
                  重新学习
                </button>
              </div>
            </section>
          )}
          <section className="ai-task-card">
            <h2>继续你的任务</h2>
            {!tasks.length ? (
              <p>还没有任务草稿。从上面描述一个目标开始。</p>
            ) : (
              <div className="ai-task-recents">
                {tasks.map((task) => (
                  <button key={task.id} disabled={busy} onClick={() => void open(task.id)}>
                    <span>{task.description || '尚未描述的任务'}</span>
                    <small>
                      {status[task.status]} · {new Date(task.updatedAt).toLocaleString('zh-CN')}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </section>
          <div className="ai-task-actions">
            <button onClick={props.flows}>使用已有流程</button>
            <button disabled={busy} onClick={props.createFlow}>
              手动创建流程
            </button>
          </div>
        </>
      ) : page === 'target' && detail ? (
        <TaskWebTargetPage
          task={detail.task}
          initialUrl={learning?.taskId === detail.task.id ? 'https://example.com' : undefined}
          back={backToBrief}
          changed={props.changed}
          showBrowser={() => props.showBrowser(true)}
          selected={(next) => {
            epoch.current++;
            accept(next);
            setReviewed(false);
            setPage('brief');
            props.showBrowser(false);
          }}
        />
      ) : (
        detail && (
          <>
            {learning?.taskId === detail.task.id && (
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
            {!scopeDiffView && (
              <div className="ai-task-state" role="status">
                <span>{status[detail.task.status]}</span>
                <span>
                  {dirty ? '有未保存修改' : '草稿已保存'} · 修订 {revision}
                </span>
              </div>
            )}
            {stale && (
              <div className="alert error" role="alert">
                <span>任务已在其他位置修改；重新读取会替换当前未保存输入。</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      accept(await api('task.detail', { id: detail.task.id }));
                      setReviewed(false);
                    })
                  }
                >
                  重新读取任务
                </button>
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
            <div className={`ai-task-columns ${page === 'review' ? 'ai-task-review' : ''}`}>
              <section className="ai-task-card ai-task-input">
                {scopeDiffView ? (
                  <>
                    <div className="ai-step-user">
                      <b>你</b>
                      <p>{scope?.instruction}</p>
                    </div>
                    <div className="ai-task-note ai-step-reply">
                      <b>FlowArk</b>
                      <p>{result?.summary}</p>
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
                    {scope && (
                      <div className="ai-task-scope-source">
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
                    <label htmlFor="task-description">{scope ? '这一步怎么改' : '你的需求'}</label>
                    <textarea
                      id="task-description"
                      disabled={inputDisabled}
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
                          <button
                            disabled={
                              inputDisabled ||
                              draft.context.length >= (detail.task.webTarget ? 19 : 20)
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
                          </button>
                          <button
                            disabled={inputDisabled || !!scope}
                            onClick={() => void openTarget()}
                          >
                            网页链接与对象
                          </button>
                        </div>
                        <h2>
                          已选上下文 · {draft.context.length + Number(!!detail.task.webTarget)} 项
                        </h2>
                        {draft.context.map((entry, index) => (
                          <fieldset
                            key={entry.id}
                            className="ai-task-context"
                            disabled={inputDisabled}
                          >
                            <label>
                              资料名称
                              <input
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
                              <textarea
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
                            <button
                              onClick={() =>
                                edit({
                                  ...draft,
                                  context: draft.context.filter((c) => c.id !== entry.id),
                                })
                              }
                            >
                              移除资料 {index + 1}
                            </button>
                          </fieldset>
                        ))}
                      </>
                    )}
                    {detail.task.webTarget && (
                      <div className="ai-task-note" aria-label="已选网页来源">
                        <b>{detail.task.webTarget.page.title || '未命名网页'}</b>
                        <p>{detail.task.webTarget.page.url}</p>
                        <p>只读取此网页 · 账号未核对 · 本机内置浏览器</p>
                        <button
                          disabled={inputDisabled || !!scope}
                          onClick={() => void openTarget()}
                        >
                          查看或更换网页目标
                        </button>
                      </div>
                    )}
                    {result?.kind === 'clarify' &&
                      result.questions.map((question) => (
                        <fieldset
                          className="ai-task-question"
                          key={question.id}
                          disabled={inputDisabled}
                        >
                          <legend>{question.prompt}</legend>
                          <div className="ai-task-options">
                            {question.options.map((option) => (
                              <button
                                type="button"
                                key={option}
                                aria-pressed={draft.answers[question.id] === option}
                                onClick={() =>
                                  edit({
                                    ...draft,
                                    answers: { ...draft.answers, [question.id]: option },
                                  })
                                }
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                          <textarea
                            aria-label={question.prompt}
                            value={draft.answers[question.id] ?? ''}
                            maxLength={3000}
                            placeholder="也可以直接补充说明"
                            onChange={(e) =>
                              edit({
                                ...draft,
                                answers: { ...draft.answers, [question.id]: e.target.value },
                              })
                            }
                          />
                        </fieldset>
                      ))}
                    <fieldset className="ai-task-provider" disabled={inputDisabled}>
                      <label>
                        AI 服务
                        <select
                          value={provider}
                          onChange={(e) => {
                            const p = e.target.value as typeof provider;
                            setProvider(p);
                            setModel(p === 'deepseek' ? 'deepseek-flash' : 'gpt-5.3-codex');
                            setReviewed(false);
                          }}
                        >
                          <option value="deepseek">DeepSeek</option>
                          <option value="openai-codex">OpenAI · Codex</option>
                        </select>
                      </label>
                      <label>
                        模型 ID
                        <input
                          value={model}
                          maxLength={100}
                          onChange={(e) => {
                            setModel(e.target.value);
                            setReviewed(false);
                          }}
                        />
                      </label>
                    </fieldset>
                    {!props.data.credentials.includes(provider) && (
                      <div className="ai-task-note">
                        <p>{providerName} 尚未配置，先保存草稿，再配置服务。</p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await save();
                              props.settings(provider, model);
                            })
                          }
                        >
                          配置 AI 服务
                        </button>
                      </div>
                    )}
                    <details className="ai-task-disclosure">
                      <summary>查看本次发送给 {providerName} 的内容</summary>
                      <p>
                        {scope
                          ? '所选步骤的修改要求与范围、已选资料、补问答案、当前完整流程及支持的能力说明。原任务描述和本机绑定不会额外加入。'
                          : '描述、所选资料与网页元数据、补问答案、当前已采纳流程及支持的能力说明。'}
                      </p>
                      <h3>描述</h3>
                      <pre>{scope ? scopedDescription(scope) : draft.description}</pre>
                      {draft.context.map((entry) => (
                        <div key={entry.id}>
                          <h3>{entry.label}</h3>
                          <pre>{entry.text}</pre>
                        </div>
                      ))}
                      {detail.task.webTarget && (
                        <div>
                          <h3>已选网页 · 只读</h3>
                          <pre>{webContext(detail.task.webTarget).text}</pre>
                        </div>
                      )}
                      {Object.keys(draft.answers).length > 0 && (
                        <>
                          <h3>补问答案</h3>
                          <pre>{text(draft.answers)}</pre>
                        </>
                      )}
                      {detail.flow && (
                        <>
                          <h3>当前流程 · {detail.flow.flow.name}</h3>
                          <pre>{text(detail.flow.flow)}</pre>
                        </>
                      )}
                    </details>
                    <label className="ai-task-checkbox">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        disabled={inputDisabled}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      我已核对本次内容，将发送给 {providerName}
                    </label>
                    <div className="ai-task-actions">
                      {generating ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              accept(await api('task.cancel', { id: detail.task.id }));
                              setReviewed(false);
                            })
                          }
                        >
                          取消生成
                        </button>
                      ) : (
                        <button
                          className="primary"
                          disabled={
                            busy ||
                            stale ||
                            !(scope?.instruction ?? draft.description).trim() ||
                            scopeConflict ||
                            !model.trim() ||
                            !reviewed ||
                            !props.data.credentials.includes(provider)
                          }
                          onClick={() => void generate()}
                        >
                          {result?.kind === 'clarify'
                            ? '确认并生成方案'
                            : result || detail.flow
                              ? scope
                                ? '生成这一步的修改'
                                : '生成修改方案'
                              : '理解我的任务'}
                        </button>
                      )}
                      <button
                        disabled={inputDisabled || !dirty || stale}
                        onClick={() =>
                          void run(async () => {
                            await save();
                            setMessage('任务草稿已保存。');
                          })
                        }
                      >
                        保存任务草稿
                      </button>
                    </div>
                    {page === 'review' && (
                      <button disabled={busy} onClick={() => setPage('brief')}>
                        编辑描述与资料
                      </button>
                    )}
                    {scope && (
                      <button
                        disabled={inputDisabled}
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
                            setMessage('已退出单步范围。接下来将按完整任务需求生成，请重新核对。');
                          })
                        }
                      >
                        改为修改完整任务
                      </button>
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
                      {new Set(detail.changes.map((change) => change.nodeId).filter(Boolean)).size}{' '}
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
                      <button
                        className="primary"
                        disabled={busy || dirty || stale || detail.conflict}
                        onClick={() => void proposalAction('adopt')}
                      >
                        采纳修改
                      </button>
                      <button
                        disabled={busy || dirty || stale}
                        onClick={() => void proposalAction('reject')}
                      >
                        不采纳
                      </button>
                    </div>
                    <button
                      disabled={inputDisabled}
                      onClick={() => {
                        setEditingProposal(true);
                        requestAnimationFrame(() =>
                          document.querySelector<HTMLTextAreaElement>('#task-description')?.focus(),
                        );
                      }}
                    >
                      继续描述修改
                    </button>
                  </>
                ) : flow ? (
                  <>
                    <div className="ai-task-meta">
                      <h2>{flow.name}</h2>
                      <span className="badge">{detail.proposal ? '待采纳方案' : '已保存草稿'}</span>
                    </div>
                    <div className="ai-task-actions" aria-label="方案视图">
                      <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
                        步骤清单
                      </button>
                      <button aria-pressed={view === 'graph'} onClick={() => setView('graph')}>
                        流程图
                      </button>
                    </div>
                    {view === 'list' ? (
                      <StepList steps={flow.steps} selected={selected} select={setSelected} />
                    ) : (
                      <div className="ai-task-graph">
                        <DiagramCanvas {...diagram} selected={selected} select={setSelected} />
                      </div>
                    )}
                    {selectedStep && (
                      <details open className="ai-task-disclosure">
                        <summary>
                          所选步骤 ·{' '}
                          {typeof selectedStep.name === 'string' && selectedStep.name
                            ? selectedStep.name
                            : kinds[selectedStep.type]?.label}{' '}
                          · {selectedStep.id}
                        </summary>
                        <pre>{text(selectedStep)}</pre>
                        {!scope && (
                          <button
                            disabled={inputDisabled || dirty || stale || !!detail.proposal}
                            onClick={() => void run(() => chooseScope(detail, selectedStep.id))}
                          >
                            用 AI 修改此步
                          </button>
                        )}
                      </details>
                    )}
                    {detail.proposal && (
                      <>
                        <h2>资源与权限</h2>
                        <ul className="ai-task-resources">
                          {detail.resources.map((resource, i) => (
                            <li key={i}>{resource}</li>
                          ))}
                          {!detail.resources.length && (
                            <li>没有文件、浏览器、HTTP 或脚本资源操作。</li>
                          )}
                          <li>声明的能力：{flow.requiredCapabilities.join('、') || '无'}</li>
                        </ul>
                        <details className="ai-task-diff" open={!!detail.proposal.baseFlow}>
                          <summary>检查修改 · {detail.changes.length} 项</summary>
                          {detail.changes.map((change, index) => (
                            <div className="ai-task-change" key={index}>
                              <h3>
                                {
                                  {
                                    added: '新增',
                                    removed: '删除',
                                    changed: '修改',
                                    moved: '移动',
                                  }[change.kind]
                                }{' '}
                                · {change.label}
                              </h3>
                              <small>{change.path}</small>
                              <div>
                                <section>
                                  <b>原值</b>
                                  <pre>{text(change.before)}</pre>
                                </section>
                                <section>
                                  <b>新值</b>
                                  <pre>{text(change.after)}</pre>
                                </section>
                              </div>
                            </div>
                          ))}
                        </details>
                        {detail.conflict && (
                          <p className="ai-task-note ai-task-failure" role="alert">
                            原流程或绑定已变化，请重新生成方案后再采纳。
                          </p>
                        )}
                        <div className="ai-task-actions">
                          <button
                            className="primary"
                            disabled={busy || dirty || stale || detail.conflict}
                            onClick={() => void proposalAction('adopt')}
                          >
                            采纳方案
                          </button>
                          <button
                            disabled={busy || dirty || stale}
                            onClick={() => void proposalAction('reject')}
                          >
                            不采纳
                          </button>
                        </div>
                      </>
                    )}
                    {!detail.proposal && detail.flow && (
                      <div className="ai-task-actions">
                        <button
                          className="primary"
                          disabled={busy || dirty || stale || generating || !!scope}
                          ref={trialButton}
                          data-run-review-start
                          onClick={() => {
                            planScroll.current = document.querySelector('main')?.scrollTop ?? 0;
                            setMessage('');
                            setError('');
                            setPage('check');
                          }}
                        >
                          确认方案，去试运行
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const next = await save();
                              if (next.flow) props.openFlow(next.flow);
                            })
                          }
                        >
                          打开流程编排
                        </button>
                        {detail.canUndo && (
                          <button
                            disabled={busy || dirty || stale}
                            onClick={() => void proposalAction('undo')}
                          >
                            撤销最近采纳
                          </button>
                        )}
                      </div>
                    )}
                    <p className="ai-task-note">
                      采纳只更新草稿。当前运行和已建立的计划继续使用原快照。
                    </p>
                  </>
                ) : (
                  <>
                    <h2>{result?.kind === 'clarify' ? '补充这些信息后继续' : '当前任务说明'}</h2>
                    <p>{result?.summary || '保存描述后，核对本次内容并生成方案。'}</p>
                    <button disabled={busy} onClick={() => setPage('brief')}>
                      返回描述与资料
                    </button>
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

function StepList({
  steps,
  selected,
  select,
  branch,
}: {
  steps: Step[];
  selected: string;
  select: (id: string) => void;
  branch?: string;
}) {
  return (
    <div className="ai-task-steps">
      {branch && <h3>{branch}</h3>}
      {steps.map((step, index) => (
        <div key={step.id}>
          <button
            className="ai-task-step"
            aria-pressed={selected === step.id}
            data-step-id={step.id}
            onClick={() => select(step.id)}
          >
            <b>{String(index + 1).padStart(2, '0')}</b>
            <span>
              <strong>
                {typeof step.name === 'string' && step.name
                  ? step.name
                  : kinds[step.type]?.label || step.type}
              </strong>
              <small>
                {kinds[step.type]?.label} · {step.id}
              </small>
            </span>
          </button>
          {step.type === 'condition' && (
            <div className="ai-task-branches">
              <StepList steps={step.then} selected={selected} select={select} branch="条件成立" />
              <StepList steps={step.else} selected={selected} select={select} branch="条件不成立" />
            </div>
          )}
          {step.type === 'loop' && (
            <div className="ai-task-branches">
              <StepList
                steps={step.body}
                selected={selected}
                select={select}
                branch="循环体 · 串行执行"
              />
            </div>
          )}
        </div>
      ))}
      {!steps.length && <p>此分支没有步骤，继续后续流程。</p>}
    </div>
  );
}
