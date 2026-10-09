import TaskRepairTarget from './TaskRepairTarget';
import TaskRepairRestart from './TaskRepairRestart';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TaskDetail } from '../shared/planning';
import type { ElementTarget } from '../shared/element-picker';
import type { RepairInput, RepairPreview } from '../shared/task-repair';
import ElementPicker from './ElementPicker';
import RunReviewPage from './RunReviewPage';
import { taskRunPresentation } from './task-run-presentation';

const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
type Phase = 'pick' | 'review' | 'restart' | 'check';
export default function TaskRepairPage({
  active,
  taskId,
  runDetail,
  back,
  browser,
  open,
  modify,
}: {
  active: boolean;
  taskId: string;
  runDetail: any;
  back: () => void;
  browser: (visible: boolean) => void;
  open: (detail: any) => void;
  modify: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [task, setTask] = useState<TaskDetail>();
  const [picked, setPicked] = useState<{ target: ElementTarget; requestId: string }>();
  const [preview, setPreview] = useState<RepairPreview>();
  const [selection, setSelection] = useState<RepairInput>();
  const [provider, setProvider] = useState<'deepseek' | 'openai-codex'>('deepseek');
  const [model, setModel] = useState('deepseek-flash');
  const [reviewed, setReviewed] = useState(false);
  const [priorReviewKey, setPriorReviewKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingAdoption, setPendingAdoption] = useState<string>();
  const location = useRef({ active, phase, epoch: 0 });
  location.current.active = active;
  location.current.phase = phase;
  const lock = useRef(false);
  const mutation = useRef(0);
  const ownPick = useRef('');
  const heading = useRef<HTMLHeadingElement>(null);
  const pickConfirm = useRef<HTMLButtonElement>(null);
  const proposalHeading = useRef<HTMLHeadingElement>(null);
  const proposalOrigin = useRef<HTMLButtonElement | null>(null);
  const operationError = useRef<HTMLParagraphElement>(null);
  const generationError = useRef<HTMLParagraphElement>(null);
  const observation = taskRunPresentation(runDetail);
  const node = observation.node;
  const stepName = typeof node?.name === 'string' ? node.name : node?.id;
  const run = runDetail.run;
  const proposal = task?.proposal;
  const repair = proposal?.repair;
  const ours =
    !!repair &&
    repair.runId === run.id &&
    repair.pickRequestId === selection?.pickRequestId &&
    repair.token === preview?.token;
  const generating = task?.task.status === 'generating';
  const applied = task?.task.appliedRepair?.runId === run.id;
  const priorKey = JSON.stringify([
    run.id,
    taskId,
    task?.task.revision,
    task?.task.appliedRepair?.proposalId,
  ]);
  const priorReviewed = applied && priorReviewKey === priorKey;
  const setPriorReviewed = (checked: boolean) => setPriorReviewKey(checked ? priorKey : '');
  const selectionChanged = !!selection && !!task && task.task.revision !== selection.revision;
  const canAdopt = ours && proposal?.result.kind === 'plan' && !task?.conflict && !selectionChanged;
  const current = (epoch: number) => location.current.active && location.current.epoch === epoch;
  useEffect(() => {
    const epoch = ++location.current.epoch;
    if (!active) {
      if (location.current.phase === 'check') setPhase('restart');
      setReviewed(false);
      setPriorReviewed(false);
      setPicked(undefined);
      setPreview(undefined);
      setSelection(undefined);
      const id = ownPick.current;
      ownPick.current = '';
      if (id) void api('browser.embedded.pick.cancel', { requestId: id }).catch(() => {});
      return;
    }
    setError('');
    let reading = false;
    let initial = true;
    const refresh = async () => {
      if (reading) return;
      if (lock.current) return;
      reading = true;
      const version = mutation.current;
      try {
        const next: TaskDetail = await api('task.detail', { id: taskId });
        if (!current(epoch) || version !== mutation.current) return;
        setTask((previous) =>
          !previous || next.task.revision >= previous.task.revision ? next : previous,
        );
        if (initial) {
          initial = false;
          setProvider(next.task.provider ?? 'deepseek');
          setModel(next.task.model ?? 'deepseek-flash');
          // A confirmation receipt in the mounted check page survives leaving.
          if (location.current.phase !== 'check')
            setPhase(next.task.appliedRepair?.runId === run.id ? 'restart' : 'pick');
        }
      } catch (e: any) {
        if (current(epoch)) setError(e.message);
      } finally {
        reading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 750);
    return () => {
      clearInterval(timer);
      location.current.epoch++;
    };
  }, [active, taskId, run.id]);
  useEffect(
    () => () => {
      const requestId = ownPick.current;
      if (requestId) void api('browser.embedded.pick.cancel', { requestId }).catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (selection && task && task.task.revision !== selection.revision) setReviewed(false);
  }, [task?.task.revision, selection]);
  useLayoutEffect(() => {
    if (!active || phase === 'check') return;
    document.querySelector('main')?.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [phase, active]);
  useLayoutEffect(() => {
    if (active && phase === 'pick' && picked) pickConfirm.current?.focus({ preventScroll: true });
  }, [active, phase, picked]);
  useLayoutEffect(() => {
    if (!active || phase !== 'review') {
      proposalOrigin.current = null;
      return;
    }
    if (busy || generating || !proposalOrigin.current) return;
    const followOperation =
      document.activeElement === proposalOrigin.current || document.activeElement === document.body;
    if (ours) {
      if (followOperation) proposalHeading.current?.focus();
      proposalOrigin.current = null;
    } else if (error || task?.task.error || task?.task.status === 'cancelled') {
      if (followOperation && (error || task?.task.error))
        (error ? operationError.current : generationError.current)?.focus();
      proposalOrigin.current = null;
    }
  }, [active, phase, busy, generating, ours, error, task?.task.error, task?.task.status]);
  async function act(fn: (epoch: number) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    mutation.current++;
    setBusy(true);
    setError('');
    const epoch = location.current.epoch;
    try {
      await fn(epoch);
    } catch (e: any) {
      if (current(epoch)) setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function confirmTarget(epoch: number) {
    if (!picked || !task || !node) return;
    const args = {
      id: taskId,
      revision: task.task.revision,
      runId: run.id,
      nodeId: node.id,
      pickRequestId: picked.requestId,
    };
    const next: RepairPreview = await api('task.repair.preview', args);
    if (!current(epoch) || ownPick.current !== args.pickRequestId) return;
    setSelection(args);
    setPreview(next);
    setReviewed(false);
    setPhase('review');
    browser(false);
  }
  async function queryAdoption(epoch: number, proposalId: string, reason = '') {
    const next: TaskDetail = await api('task.detail', { id: taskId });
    if (!current(epoch)) return;
    setTask(next);
    if (next.task.appliedRepair?.proposalId !== proposalId)
      throw new Error(
        (reason ? reason + '。' : '') + '尚未核对到这次采纳，未重新提交；可以取消等待后重新选择。',
      );
    setPendingAdoption(undefined);
    setPriorReviewed(false);
    setPhase('restart');
  }
  async function generateRepair(epoch: number) {
    if (!preview || !selection || !reviewed || selectionChanged) return;
    setReviewed(false);
    const next = await api('task.repair.generate', {
      ...selection,
      token: preview.token,
      provider,
      model,
      reviewed: true,
    });
    if (current(epoch)) setTask(next);
  }
  function discardSelection() {
    const previous = ownPick.current;
    ownPick.current = '';
    setPicked(undefined);
    setPreview(undefined);
    setSelection(undefined);
    setReviewed(false);
    if (previous) void api('browser.embedded.pick.cancel', { requestId: previous }).catch(() => {});
  }
  const title =
    phase === 'pick'
      ? '重新选择要修复的网页目标'
      : phase === 'restart'
        ? '修复后怎样重新执行？'
        : '检查修复提议';
  return (
    <>
      <div
        className="task-repair-page"
        hidden={!active || phase === 'check'}
        data-repair-phase={phase}
      >
        <div className="page-heading">
          <div>
            <h1 tabIndex={-1} ref={heading}>
              {title}
            </h1>
            <p>
              {phase === 'restart'
                ? `会创建新运行，关联 ${run.id}；不恢复旧脚本内部现场`
                : `针对运行 ${run.id} · ${stepName || '网页步骤'}`}
            </p>
          </div>
        </div>
        {error && (
          <p className="alert error" role="alert" tabIndex={-1} ref={operationError}>
            {error}
          </p>
        )}
        {task?.task.error && (
          <p className="alert error" role="alert" tabIndex={-1} ref={generationError}>
            {task.task.error}
          </p>
        )}
        {phase === 'review' && selectionChanged && (
          <p className="task-run-note" role="status">
            任务已更新到修订 {task.task.revision}，这次目标核对基于修订 {selection.revision}。
            请重新选择目标并核对修复，当前记录不会覆盖新方案。
          </p>
        )}
        {phase === 'pick' ? (
          <>
            <div className="ai-task-actions task-repair-pick-actions" aria-label="重新拾取操作">
              <button onClick={back}>取消重新拾取</button>
              <button
                ref={pickConfirm}
                className="primary"
                disabled={!picked || !task || busy || generating}
                onClick={() => void act(confirmTarget)}
              >
                {busy ? '正在核对目标…' : '确认这个目标'}
              </button>
              <button onClick={back}>返回失败详情</button>
            </div>
            <section className="ai-task-card task-repair-pick" aria-label="重新拾取的目标">
              <h2>{picked ? picked.target.label || picked.target.tag : '从真实网页选择元素'}</h2>
              <p>
                {picked
                  ? '这是所选元素的摘要；完整内容请在右侧网页核对。'
                  : '在右侧网页打开要修复的页面，然后点选目标。选取不会点击、填写或提交网页。'}
              </p>
              <div className="task-repair-pick-meta">
                {picked ? (
                  <>
                    <p>
                      元素类型：{picked.target.tag}
                      {picked.target.inputType ? ` · ${picked.target.inputType}` : ''}
                    </p>
                    <p>
                      所在框架：
                      {picked.target.framePath.length
                        ? `${picked.target.framePath.length} 层嵌套框架`
                        : '网页主框架'}
                    </p>
                    <p>
                      {picked.target.structural
                        ? '采用结构定位，网页布局变化后需要重新选择。'
                        : '确认时会重新核对页面与目标是否仍唯一匹配。'}
                    </p>
                  </>
                ) : (
                  <p role="status">尚未选取修复目标，请使用下方“从网页选取”。</p>
                )}
              </div>
            </section>
            <p className="task-run-note task-repair-pick-note">
              定位来自选择的真实元素；无法唯一匹配时不会采用。返回保留任务草稿，修复不会自动重复执行。
            </p>
            <details className="task-repair-picker-options" open={!picked}>
              <summary>{picked ? '重新选择其他目标' : '选择网页目标'}</summary>
              {node?.type === 'browser' && (
                <ElementPicker
                  selector={node.selector}
                  framePath={'framePath' in node ? node.framePath : []}
                  allowInspect={false}
                  active={active && phase === 'pick'}
                  disabled={busy || generating}
                  onStart={() => {
                    setError('');
                    discardSelection();
                  }}
                  onSelect={(target, requestId) => {
                    if (!location.current.active || location.current.phase !== 'pick') {
                      void api('browser.embedded.pick.cancel', { requestId }).catch(() => {});
                      return;
                    }
                    ownPick.current = requestId;
                    setPicked({ target, requestId });
                    setPreview(undefined);
                    setReviewed(false);
                  }}
                  onInspect={() => setError('验证原定位不等于重新选择，请从网页选取修复目标。')}
                />
              )}
            </details>
          </>
        ) : phase === 'review' ? (
          <div className="task-run-columns task-repair-columns">
            <section className="ai-task-card">
              <div className="task-repair-box task-repair-chat">
                <span className="task-repair-speaker">FlowArk</span>
                <p>
                  {ours
                    ? proposal!.result.summary
                    : '已取得你确认的网页目标。核对下方发送范围，再让 AI 提议修改。'}
                </p>
              </div>
              <div className="task-repair-box task-repair-new">
                <h3>复核结果</h3>
                <p>{preview ? '确认时唯一匹配 · 1 个元素' : '需要重新选取目标'}</p>
                <p>
                  目标描述：
                  {preview?.selection.target.label || preview?.selection.target.tag || '尚无'}
                </p>
                <p>描述不是完整读取结果；生成与采纳时会再次核对。</p>
                {task?.task.webTarget && preview && (
                  <>
                    <p>采纳后，任务的只读网页对象将更新为本次确认的网页。</p>
                    <p>{preview.selection.title || '未命名网页'}</p>
                    <p className="task-run-path">{preview.selection.url}</p>
                    {task.task.webTarget.element && <p>仍只允许读取本次选中的元素。</p>}
                  </>
                )}
                {preview && (
                  <details className="task-repair-location">
                    <summary>核对选择时的网页与元素信息</summary>
                    <p>网页：{preview.selection.title || '未命名网页'}</p>
                    <p className="task-run-path">{preview.selection.url}</p>
                    <p>
                      元素类型：{preview.selection.target.tag}
                      {preview.selection.target.inputType
                        ? ` · ${preview.selection.target.inputType}`
                        : ''}
                    </p>
                    {preview.selection.target.structural && (
                      <p>使用结构定位，网页布局变化后需要重新选择。</p>
                    )}
                    <p>
                      仅供本机核对，不表示网页当前仍未变化；网页地址和标题不会自动加入模型输入。
                    </p>
                  </details>
                )}
              </div>
              <p className="task-run-note">
                如果原操作结果未知，请先核对；修复目标不会自动重复提交。
              </p>
              {!ours && !generating && (
                <>
                  <h3>本次使用的 AI</h3>
                  <label>
                    供应商
                    <select
                      value={provider}
                      disabled={busy}
                      onChange={(e) => {
                        const value = e.target.value as typeof provider;
                        setProvider(value);
                        setModel(value === 'deepseek' ? 'deepseek-flash' : 'gpt-5.4');
                        setReviewed(false);
                      }}
                    >
                      <option value="deepseek">DeepSeek</option>
                      <option value="openai-codex">OpenAI</option>
                    </select>
                  </label>
                  <label>
                    模型
                    <input
                      value={model}
                      disabled={busy}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setReviewed(false);
                      }}
                    />
                  </label>
                  <details>
                    <summary>核对实际发送内容</summary>
                    <p>
                      发送任务描述、当前完整流程及本次目标修复说明。未选择的附件和历史输出不自动发送。
                    </p>
                    <pre tabIndex={0} aria-label="本次修复实际发送内容">
                      {JSON.stringify(preview?.input, null, 2)}
                    </pre>
                  </details>
                  <label className="run-review-toggle">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={busy || !preview || task?.task.revision !== selection?.revision}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    我已核对发送内容、供应商和模型
                  </label>
                  <button
                    className="primary"
                    disabled={busy || !reviewed || !model.trim() || !preview || selectionChanged}
                    onClick={(event) => {
                      proposalOrigin.current = event.currentTarget;
                      void act(generateRepair);
                    }}
                  >
                    让 AI 提议修复
                  </button>
                </>
              )}
              {generating && (
                <>
                  <p role="status">正在生成修复提议，尚未更改流程或执行。</p>
                  <button
                    onClick={() =>
                      void act(async (epoch) => {
                        const next = await api('task.cancel', { id: taskId });
                        if (current(epoch)) setTask(next);
                      })
                    }
                  >
                    取消生成
                  </button>
                </>
              )}
              <button
                className={selectionChanged ? 'primary' : undefined}
                disabled={busy || generating}
                onClick={() => {
                  discardSelection();
                  setPhase('pick');
                  browser(true);
                }}
              >
                重新选择目标
              </button>
            </section>
            <section className="ai-task-card">
              <h2 ref={proposalHeading} tabIndex={-1}>
                {canAdopt ? '只改变目标引用' : '待核对的目标变化'}
              </h2>
              <TaskRepairTarget
                title="原目标"
                label={preview?.source.nodeName || stepName}
                selector={
                  preview?.source.selector || (node?.type === 'browser' ? node.selector : undefined)
                }
                framePath={
                  preview?.source.framePath ??
                  (node?.type === 'browser' && 'framePath' in node ? node.framePath : undefined)
                }
                kind="old"
                note="原运行停止于此，历史匹配数未记录"
              />
              <TaskRepairTarget
                title="新目标"
                label={preview?.selection.target.label || preview?.selection.target.tag}
                selector={preview?.selection.target.selector}
                framePath={preview?.selection.target.framePath}
                kind="new"
                note={preview ? '确认时唯一匹配，采纳前再次核对' : '需要重新选择'}
              />
              {ours && (
                <>
                  <p>
                    {canAdopt
                      ? '已核对：只改变所选步骤的目标；没有新增步骤、账号、工具或授权。旧运行保持不变。'
                      : proposal!.result.kind === 'plan'
                        ? '当前方案已有变化，请重新核对修复。'
                        : '本次未产生可采纳的修复方案，请回到任务补充信息。'}
                  </p>
                  <details>
                    <summary>查看完整差异 · {task?.changes.length} 项</summary>
                    {task?.changes.map((c) => (
                      <div key={c.path}>
                        <b>
                          {c.label} · {c.path}
                        </b>
                        <pre tabIndex={0} aria-label={`${c.label}的完整差异`}>
                          {JSON.stringify({ 原值: c.before, 新值: c.after }, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </details>
                  {proposal!.result.limitations.map((text, i) => (
                    <p key={i}>{text}</p>
                  ))}
                  <div className="ai-task-actions task-repair-adoption">
                    <button
                      className="primary"
                      disabled={!canAdopt || busy || !!pendingAdoption}
                      onClick={() =>
                        void act(async (epoch) => {
                          const proposalId = proposal!.id;
                          setPendingAdoption(proposalId);
                          try {
                            await api('task.adopt', {
                              id: taskId,
                              revision: task!.task.revision,
                              proposalId,
                            });
                          } catch (e) {
                            await queryAdoption(
                              epoch,
                              proposalId,
                              e instanceof Error ? e.message : '采纳回复未取得',
                            );
                            return;
                          }
                          await queryAdoption(epoch, proposalId);
                        })
                      }
                    >
                      采纳并检查起点
                    </button>
                    <button
                      disabled={busy || !!pendingAdoption}
                      onClick={() =>
                        void act(async (epoch) => {
                          const next = await api('task.reject', {
                            id: taskId,
                            revision: task!.task.revision,
                            proposalId: proposal!.id,
                          });
                          if (current(epoch)) {
                            setTask(next);
                            back();
                          }
                        })
                      }
                    >
                      不采纳
                    </button>
                  </div>
                </>
              )}
              {pendingAdoption && (
                <>
                  <p role="status">采纳结果以任务记录为准，未自动重新提交。</p>
                  <button
                    disabled={busy}
                    onClick={() => void act((epoch) => queryAdoption(epoch, pendingAdoption))}
                  >
                    核对采纳结果
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async (epoch) => {
                        // Stop an adoption still awaiting native verification, then read
                        // the persisted receipt. A committed adoption is not undone.
                        await api('task.cancel', { id: taskId });
                        const next: TaskDetail = await api('task.detail', { id: taskId });
                        if (!current(epoch)) return;
                        setTask(next);
                        setPendingAdoption(undefined);
                        setPriorReviewed(false);
                        setReviewed(false);
                        if (next.task.appliedRepair?.proposalId === pendingAdoption) {
                          setPhase('restart');
                        } else {
                          setPicked(undefined);
                          setPreview(undefined);
                          setSelection(undefined);
                          setPhase('pick');
                          browser(true);
                        }
                      })
                    }
                  >
                    取消等待并核对当前方案
                  </button>
                </>
              )}
              <button onClick={modify}>回到任务修改</button>
            </section>
          </div>
        ) : (
          <TaskRepairRestart
            observation={observation}
            revision={task?.task.revision}
            applied={applied}
            reviewed={priorReviewed}
            review={setPriorReviewed}
            check={() => setPhase('check')}
            back={back}
            modify={modify}
          />
        )}
      </div>
      <RunReviewPage
        embedded
        repair={
          applied && task ? { taskId, revision: task.task.revision, runId: run.id } : undefined
        }
        active={active && phase === 'check'}
        selection={
          task?.flow
            ? {
                id: task.flow.id,
                task: { id: taskId, revision: task.task.revision },
                rerun: { runId: run.id, reviewed: true },
              }
            : undefined
        }
        source={JSON.stringify(task?.flow ?? null)}
        back={() => {
          setPriorReviewed(false);
          setPhase('restart');
        }}
        edit={modify}
        openDetail={open}
      />
    </>
  );
}
