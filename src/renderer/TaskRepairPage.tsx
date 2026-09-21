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
  const [priorReviewed, setPriorReviewed] = useState(false);
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
  const canAdopt = ours && proposal?.result.kind === 'plan' && !task?.conflict;
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
              针对运行 {run.id} · {stepName || '网页步骤'}
            </p>
          </div>
        </div>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {task?.task.error && (
          <p className="alert error" role="alert">
            {task.task.error}
          </p>
        )}
        {phase === 'pick' ? (
          <div className="ai-task-card task-repair-pick">
            <h2>从真实网页选择元素</h2>
            <p>在右侧网页打开要修复的页面，然后点选目标。选取不会点击、填写或提交网页。</p>
            {node?.type === 'browser' && (
              <ElementPicker
                selector={node.selector}
                framePath={'framePath' in node ? node.framePath : []}
                onSelect={(target, requestId) => {
                  ownPick.current = requestId;
                  setPicked({ target, requestId });
                  setPreview(undefined);
                  setReviewed(false);
                }}
                onInspect={() => setError('验证原定位不等于重新选择，请从网页选取修复目标。')}
              />
            )}
            {picked && (
              <div className="task-repair-box task-repair-new">
                <h3>已选目标</h3>
                <p>{picked.target.label || picked.target.tag}</p>
                <p>
                  元素类型：{picked.target.tag} · {picked.target.framePath.length} 层框架
                </p>
              </div>
            )}
            <div className="ai-task-actions">
              <button
                className="primary"
                disabled={!picked || !task || busy || generating}
                onClick={() => void act(confirmTarget)}
              >
                确认这个目标
              </button>
              <button onClick={back}>取消重新拾取</button>
            </div>
            <p className="task-run-note">
              无法唯一匹配时不允许确认。确认后可收起网页；页面或目标变化时需要重新核对。
            </p>
          </div>
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
                    <pre>{JSON.stringify(preview?.input, null, 2)}</pre>
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
                    disabled={busy || !reviewed || !model.trim() || !preview}
                    onClick={() =>
                      void act(async (epoch) => {
                        setReviewed(false);
                        const next = await api('task.repair.generate', {
                          ...selection,
                          token: preview!.token,
                          provider,
                          model,
                          reviewed: true,
                        });
                        if (current(epoch)) setTask(next);
                      })
                    }
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
                disabled={busy || generating}
                onClick={() => {
                  setReviewed(false);
                  setPreview(undefined);
                  setPhase('pick');
                  browser(true);
                }}
              >
                重新选择目标
              </button>
            </section>
            <section className="ai-task-card">
              <h2>{canAdopt ? '只改变目标引用' : '待核对的目标变化'}</h2>
              <div className="task-repair-box task-repair-old">
                <h3>原目标</h3>
                <p>{preview?.source.nodeName || stepName}</p>
                <p>{preview?.source.selector || (node?.type === 'browser' ? node.selector : '')}</p>
                <p>原运行在此步骤停止，历史匹配数未记录。</p>
              </div>
              <div className="task-repair-box task-repair-new">
                <h3>新目标</h3>
                <p>{preview?.selection.target.label || '需要重新选择'}</p>
                <p>{preview?.selection.target.selector}</p>
              </div>
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
                        <pre>{JSON.stringify({ 原值: c.before, 新值: c.after }, null, 2)}</pre>
                      </div>
                    ))}
                  </details>
                  {proposal!.result.limitations.map((text, i) => (
                    <p key={i}>{text}</p>
                  ))}
                  <div className="ai-task-actions">
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
          <div className="task-run-columns task-restart-columns">
            <section className="ai-task-card">
              <div className="task-repair-box">
                <h2>从头重新运行</h2>
                <p>
                  {observation.summary}。{observation.effectNote}
                </p>
              </div>
              <label className="run-review-toggle">
                <input
                  type="checkbox"
                  checked={priorReviewed}
                  disabled={!applied}
                  onChange={(e) => setPriorReviewed(e.target.checked)}
                />
                我已核对原运行的输出与外部结果，确认可以从头执行
              </label>
              <p>
                执行起点：第 1 步<br />
                采用版本：当前已采纳的修复方案；下一页核对实际资源与可能更改。
              </p>
              <p className="task-run-note">
                不恢复旧脚本内部现场。已经完成或结果未知的外部操作，可能在新运行中再次发生。
              </p>
            </section>
            <section className="ai-task-card">
              <h2>已完成操作不会被隐藏</h2>
              <p>已完成：{observation.completed.map((r) => r.name).join('、') || '尚无完成记录'}</p>
              <p>
                已开始未确认完成：{observation.unresolved.map((r) => r.name).join('、') || '无'}
              </p>
              <p>新运行将关联 {run.id}，重新检查对象与权限，再按新快照执行。</p>
              <p>如果此前已提交试运行确认，下一页会保留该次请求，先查询或查看结果。</p>
              <button
                className="primary"
                disabled={!priorReviewed || !applied}
                onClick={() => setPhase('check')}
              >
                确认，重新检查
              </button>
              <button onClick={back}>先不运行</button>
            </section>
          </div>
        )}
      </div>
      <RunReviewPage
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
