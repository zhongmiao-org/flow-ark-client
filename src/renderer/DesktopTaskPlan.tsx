import { useEffect, useRef, useState } from 'react';
import type { PlanningTask } from '../shared/planning';
import type { DesktopSelectionPreview, DesktopWindow } from '../shared/desktop-windows';
import { desktopPlanResponse, type DesktopPlanResponse } from '../shared/desktop-planning';
import { aiModel, type AIConfigurationState, type AIProviderId } from '../shared/ai-settings';
import './desktop-task-plan.css';
import DesktopModificationCheck from './DesktopModificationCheck';
import type { TaskDetail } from '../shared/planning';

type Ready = Extract<DesktopSelectionPreview, { status: 'ready' }>;
const api = (method: string, args: unknown) => window.flowark.request(method, args);
export default function DesktopTaskPlan({
  adopted,
  adoptionUnavailable,
  phaseChanged,
  task,
  selection,
  target,
  back,
  editDescription,
}: {
  adopted: (detail: TaskDetail) => void;
  adoptionUnavailable?: string;
  phaseChanged: (phase: 'plan' | 'changes') => void;
  task: PlanningTask;
  selection: Ready;
  target: DesktopWindow;
  back: () => void;
  editDescription: () => void;
}) {
  const [provider, setProvider] = useState<AIProviderId>(task.provider ?? 'deepseek');
  const [configuration, setConfiguration] = useState<AIConfigurationState>();
  const [configEpoch, setConfigEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<DesktopPlanResponse>();
  const [view, setView] = useState<'plan' | 'changes'>('plan');
  const completedRequest = useRef<string | undefined>(undefined);
  const request = useRef<string | undefined>(undefined),
    epoch = useRef(0);
  const heading = useRef<HTMLParagraphElement>(null);
  const name = provider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
  const cancel = () => {
    epoch.current++;
    if (request.current)
      void api('desktop.plan.cancel', { id: task.id, requestId: request.current }).catch(() => {});
    if (completedRequest.current)
      void api('desktop.plan.cancel', { id: task.id, requestId: completedRequest.current }).catch(
        () => {},
      );
    completedRequest.current = undefined;
    request.current = undefined;
    setBusy(false);
    setReviewed(false);
  };
  useEffect(
    () => () => {
      epoch.current++;
      if (request.current)
        void api('desktop.plan.cancel', { id: task.id, requestId: request.current }).catch(
          () => {},
        );
      if (completedRequest.current)
        void api('desktop.plan.cancel', {
          id: task.id,
          requestId: completedRequest.current,
        }).catch(() => {});
    },
    [task.id],
  );
  useEffect(() => {
    let live = true;
    cancel();
    setConfiguration(undefined);
    setLoading(true);
    setResult(undefined);
    setMessage('');
    void api('ai.configuration.get', { provider })
      .then((value: any) => {
        if (!live) return;
        if (
          value?.provider !== provider ||
          typeof value.configured !== 'boolean' ||
          (value.configured && !/^[a-f0-9]{64}$/.test(value.revision ?? ''))
        )
          throw new Error('配置来源无效');
        aiModel.parse(value.model);
        setConfiguration(value);
      })
      .catch(() => {
        if (live) setMessage('无法取得 AI 配置，请重新读取或返回描述页配置服务。');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [provider, configEpoch, task.id, task.revision, selection.previewId]);
  useEffect(() => {
    phaseChanged(view);
    heading.current?.focus();
  }, [view, phaseChanged]);
  const ready =
    !loading &&
    !busy &&
    configuration?.provider === provider &&
    configuration.configured &&
    configuration.revision &&
    !configuration.operation &&
    !selection.redacted &&
    task.description.trim() &&
    selection.expiresAt > Date.now();
  const generate = async () => {
    if (!ready || !reviewed || request.current) return;
    const requestId = crypto.randomUUID(),
      ticket = ++epoch.current;
    request.current = requestId;
    completedRequest.current = undefined;
    setBusy(true);
    setMessage('');
    setResult(undefined);
    setReviewed(false);
    const source = {
      id: task.id,
      revision: task.revision,
      requestId,
      observationId: selection.observationId,
      windowId: selection.windowId,
      previewId: selection.previewId,
      provider,
      configurationRevision: configuration!.revision,
      reviewed: true,
    };
    try {
      const next = desktopPlanResponse.parse(await api('desktop.plan.generate', source));
      if (ticket !== epoch.current) return;
      if (
        next.id !== task.id ||
        next.revision !== task.revision ||
        next.requestId !== requestId ||
        next.observationId !== selection.observationId ||
        next.windowId !== selection.windowId ||
        next.previewId !== selection.previewId ||
        next.provider !== provider ||
        next.model !== configuration!.model ||
        next.expiresAt !== selection.expiresAt ||
        next.expiresAt <= Date.now()
      )
        throw new Error('候选来源已失效，请重新核对');
      completedRequest.current = next.requestId;
      setResult(next);
      heading.current?.focus();
    } catch {
      if (ticket === epoch.current)
        setMessage('未能取得可核对的改动。请重新检查选区和 AI 配置；原文未修改。');
      void api('desktop.plan.cancel', { id: task.id, requestId }).catch(() => {});
    } finally {
      if (ticket === epoch.current) {
        request.current = undefined;
        setBusy(false);
      }
    }
  };
  const proposal = result?.result.kind === 'proposal' ? result.result : undefined;
  const unchanged = proposal?.replacement === selection.text;
  const plainText = (label: string, text: string, className = '') => (
    <section className={`desktop-plan-text ${className}`}>
      <h2>{label}</h2>
      <pre tabIndex={0} aria-label={label}>
        {text}
      </pre>
    </section>
  );
  return (
    <section className="ai-task-page desktop-task-plan">
      <div className="ai-task-heading desktop-plan-heading">
        <div>
          <p ref={heading} tabIndex={-1}>
            应用任务 · 文本编辑 / {target.title || '未命名窗口'}
          </p>
        </div>
        <button onClick={back}>返回窗口与选区</button>
      </div>
      <div className={`desktop-plan-columns ${view === 'changes' ? 'is-changes' : ''}`}>
        <section className="ai-task-card desktop-plan-stack">
          {view === 'changes' && proposal ? (
            <>
              {plainText('原选区', selection.text, 'is-before')}
              {plainText('修改为', proposal.replacement, 'is-after')}
              <div className="desktop-plan-scope">
                <h2>影响范围</h2>
                <p>目标为这个 TextEdit 窗口的原选区。当前只生成候选，尚未修改文档。</p>
              </div>
              <p className="ai-task-note">
                未来写入前仍须核对同一窗口与原选区；本次预览不代表写入授权。
              </p>
            </>
          ) : (
            <>
              <div className="desktop-plan-description">
                <h2>你的需求</h2>
                <p>{task.description || '尚未填写需求'}</p>
                <button onClick={editDescription}>返回修改需求</button>
              </div>
              <div className="desktop-plan-scope">
                <h2>当前对象</h2>
                <p>文本编辑 · {target.title || '未命名窗口'}</p>
                <p>仅本次选中段落 · 尚未建立执行绑定</p>
              </div>
              {plainText('本次发送的原段落', selection.text)}
              <p className="ai-task-note">
                窗口关闭、选区变化或权限失效时停止，重新确认目标。检查有效至{' '}
                {new Date(selection.expiresAt).toLocaleTimeString('zh-CN')}。
              </p>
            </>
          )}
        </section>
        <section className="ai-task-card desktop-plan-stack">
          {view === 'changes' && proposal ? (
            <>
              <h2>改动说明</h2>
              <p>{proposal.summary}</p>
              {unchanged && (
                <p className="ai-task-note" role="status">
                  候选与原段落相同，没有文字改动。
                </p>
              )}
              {!!proposal.limitations.length && (
                <div>
                  <h3>需要你核对</h3>
                  <ul>
                    {proposal.limitations.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              <DesktopModificationCheck
                candidate={result!}
                unchanged={unchanged}
                back={back}
                adopted={adopted}
                adoptionUnavailable={adoptionUnavailable}
              />
              <button onClick={() => setView('plan')}>取消，回到方案</button>
            </>
          ) : (
            <>
              <h2>处理步骤</h2>
              <ol className="desktop-plan-steps">
                {[
                  ['读取选中段落', '已读取 · 发送前重新核对'],
                  [
                    'AI 整理文字',
                    busy
                      ? '正在生成预览…'
                      : proposal
                        ? '已生成候选，等待核对'
                        : '核对文本和模型后生成',
                  ],
                  ['确认修改范围', '先查看原文与候选对照'],
                  ['写入并回读', '尚未接入 · 当前不会修改文档'],
                ].map(([title, description], i) => (
                  <li key={title}>
                    <span>{i + 1}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <fieldset className="ai-task-provider" disabled={busy}>
                <legend>本次 AI 服务</legend>
                <label>
                  供应商
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as AIProviderId)}
                  >
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai-codex">OpenAI</option>
                  </select>
                </label>
                <p>
                  {loading
                    ? '正在读取配置…'
                    : configuration?.configured
                      ? `模型：${configuration.model}`
                      : '尚未配置这个服务'}
                </p>
                <button
                  type="button"
                  onClick={() => setConfigEpoch((x) => x + 1)}
                  disabled={loading}
                >
                  重新读取配置
                </button>
              </fieldset>
              {!loading && configuration?.operation && (
                <p role="status">AI 配置正在处理，请完成后重新读取。</p>
              )}
              {!loading && !configuration?.configured && (
                <button onClick={editDescription}>返回描述页配置 AI</button>
              )}
              {selection.redacted && (
                <p className="ai-task-note">原段落包含已遮盖的信息，请返回缩小选区后重新读取。</p>
              )}
              <p className="desktop-plan-send-note">
                只发送左侧需求和原段落给 {name}
                ；不附带网页、工具、附件或其他文档。生成可能产生服务费用。
              </p>
              <label className="ai-task-checkbox">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={!ready}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                我已核对本次文字与模型，同意发送给 {name}
              </label>
              {busy ? (
                <div role="status">
                  <p>正在核对选区并生成预览，尚未修改文档。</p>
                  <button
                    onClick={() => {
                      cancel();
                      setMessage('已取消生成，原文未修改。再次生成前请重新核对。');
                    }}
                  >
                    取消生成
                  </button>
                </div>
              ) : (
                <button
                  className="primary"
                  disabled={!ready || !reviewed}
                  onClick={() => void generate()}
                >
                  {result ? '重新生成改动预览' : '生成改动预览'}
                </button>
              )}
              {result?.result.kind === 'unsupported' && (
                <div className="ai-task-note" role="status">
                  <h3>这次需求还不能生成候选</h3>
                  <p>{result.result.summary}</p>
                  <ul>
                    {result.result.limitations.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {proposal && (
                <div className="desktop-plan-candidate" role="status">
                  <h3>{unchanged ? '候选与原文相同' : '已生成改动预览'}</h3>
                  <p>{proposal.summary}</p>
                  <button className="primary" onClick={() => setView('changes')}>
                    查看改动并核对
                  </button>
                </div>
              )}
              {message && (
                <p className="ai-task-note" role="status">
                  {message}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
