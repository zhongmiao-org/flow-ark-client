import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bootstrap, FlowRecord, Step } from '../shared/types';
import type { PlanningContext, PlanningTask, TaskDetail } from '../shared/planning';
import { buildDiagram } from './flow-diagram';
import DiagramCanvas from './DiagramCanvas';
import { kinds } from './node-kinds';
import { flatten } from './flow-editing';

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
type Draft = { description: string; context: PlanningContext[]; answers: Record<string, string> };
const draftOf = (detail: TaskDetail): Draft => ({
  description: detail.task.description,
  context: detail.task.context,
  answers: detail.task.answers,
});
const text = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '无');
type Props = {
  active: boolean;
  data: Bootstrap;
  onTitle: (title: string) => void;
  settings: () => void;
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
  const [page, setPage] = useState<'home' | 'brief' | 'review'>('home');
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
  const dirty = !!detail && JSON.stringify(draft) !== saved;
  const generating = detail?.task.status === 'generating';
  const stale = !!detail && detail.task.revision !== revision;
  const result = detail?.proposal?.result;
  const flow = result?.kind === 'plan' ? result.flow : detail?.flow?.flow;
  const diagram = useMemo(() => buildDiagram(flow?.steps ?? [], selected), [flow, selected]);
  const selectedStep = flow && flatten(flow.steps).find((step) => step.id === selected);
  const title =
    page === 'home'
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
    if (props.active) props.onTitle(title);
  }, [props.active, title, props.onTitle]);
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
  async function proposalAction(method: 'adopt' | 'reject' | 'undo') {
    await run(async () => {
      if (!detail || dirty || stale) throw new Error('请先保存修改并重新生成方案');
      const next = await api(`task.${method}`, {
        id: detail.task.id,
        revision,
        ...(method !== 'undo' ? { proposalId: detail.proposal?.id } : {}),
      });
      accept(next);
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
  const providerName = provider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
  const inputDisabled = busy || generating;

  return (
    <div className="page ai-task-page" hidden={!props.active}>
      <div className="page-heading ai-task-heading">
        <div>
          <h1>{page === 'home' ? '你想完成什么？' : title}</h1>
          <p>
            {page === 'home'
              ? '用一句话开始。FlowArk 先给你看步骤，由你决定何时执行。'
              : generating
                ? '正在理解本次任务，你可以取消生成。'
                : '描述、补问与方案保存在本机；采纳方案后再检查执行。'}
          </p>
        </div>
        {page !== 'home' && (
          <button disabled={busy} onClick={() => void back()}>
            返回开始任务
          </button>
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
      {page === 'home' ? (
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
              <button onClick={props.settings}>
                AI 服务 ·{' '}
                {props.data.credentials.includes('deepseek') ? 'DeepSeek 已配置' : '配置服务'}
              </button>
            </div>
          </section>
          <div className="ai-task-examples">
            {[
              [
                '网页标题归档',
                '读取标题，检查后保存到文件。',
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
              <button key={heading} disabled={busy} onClick={() => void create(prompt)}>
                <h2>{heading}</h2>
                <p>{description}</p>
                <small>用这个需求开始</small>
              </button>
            ))}
          </div>
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
      ) : (
        detail && (
          <>
            <div className="ai-task-state" role="status">
              <span>{status[detail.task.status]}</span>
              <span>
                {dirty ? '有未保存修改' : '草稿已保存'} · 修订 {revision}
              </span>
            </div>
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
            <div className={`ai-task-columns ${page === 'review' ? 'ai-task-review' : ''}`}>
              <section className="ai-task-card ai-task-input">
                <label htmlFor="task-description">你的需求</label>
                <textarea
                  id="task-description"
                  disabled={inputDisabled}
                  value={draft.description}
                  maxLength={20000}
                  onChange={(e) => edit({ ...draft, description: e.target.value })}
                />
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
                        disabled={inputDisabled || draft.context.length >= 20}
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
                    </div>
                    <h2>已选上下文 · {draft.context.length} 项</h2>
                    {draft.context.map((entry, index) => (
                      <fieldset key={entry.id} className="ai-task-context" disabled={inputDisabled}>
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
                          props.settings();
                        })
                      }
                    >
                      配置 AI 服务
                    </button>
                  </div>
                )}
                <details className="ai-task-disclosure">
                  <summary>查看本次发送给 {providerName} 的内容</summary>
                  <p>描述、所选文本、补问答案、当前已采纳流程及支持的能力说明。</p>
                  <h3>描述</h3>
                  <pre>{draft.description}</pre>
                  {draft.context.map((entry) => (
                    <div key={entry.id}>
                      <h3>{entry.label}</h3>
                      <pre>{entry.text}</pre>
                    </div>
                  ))}
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
                        !draft.description.trim() ||
                        !model.trim() ||
                        !reviewed ||
                        !props.data.credentials.includes(provider)
                      }
                      onClick={() => void generate()}
                    >
                      {result?.kind === 'clarify'
                        ? '确认并生成方案'
                        : result || detail.flow
                          ? '生成修改方案'
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
