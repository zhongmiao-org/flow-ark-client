import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { TaskDetail } from '../shared/planning';
import DesktopRunBinding from './DesktopRunBinding';
import DesktopRunConfirmation from './DesktopRunConfirmation';
import './desktop-run.css';
import type { RunReviewInput, RunReviewPreview, ReviewResource } from '../shared/run-review';
import { RunReviewSession } from './run-review-session';
import RunReviewTools from './RunReviewTools';
import RunReviewCheck, { reviewResourceIssue } from './RunReviewCheck';

type Props = {
  active: boolean;
  selection?: RunReviewInput;
  source: string;
  back: () => void;
  edit: () => void;
  openDetail: (detail: any) => void;
  bound?: (detail: TaskDetail) => void;
  embedded?: boolean;
  repair?: { taskId: string; revision: number; runId: string };
};
const access: Record<string, string> = {
  read: '读取',
  write: '写入',
  readwrite: '读写',
  use: '使用',
  confirm: '逐次确认',
  auto: '已授权',
};
function Resource({ resource }: { resource: ReviewResource }) {
  return (
    <li>
      <b>{resource.name}</b> · {access[resource.access] ?? resource.access}
      {resource.location && <p className="run-review-version">{resource.location}</p>}
      {resource.detail && <p>{resource.detail}</p>}
    </li>
  );
}
function Contents({
  preview,
  compact,
  repairRevision,
}: {
  preview: RunReviewPreview;
  compact: boolean;
  repairRevision?: number;
}) {
  if (preview.desktop) return <DesktopRunConfirmation preview={preview} />;
  const tools = preview.toolCalls ?? [];
  const objects = preview.resources.filter((r) => !['file', 'directory'].includes(r.kind));
  const locations = preview.resources.filter((r) => ['file', 'directory'].includes(r.kind));
  const sources = locations.filter((r) => ['read', 'readwrite'].includes(r.access));
  const destinations = locations.filter((r) => ['write', 'readwrite'].includes(r.access));
  const reads = preview.effects.filter((e) => e.kind === 'read');
  const changes = preview.effects.filter((e) => ['write', 'network', 'unknown'].includes(e.kind));
  const versionSummary = (
    <p>
      {preview.flow.name} · {preview.flow.stepCount} 个步骤 ·{' '}
      {preview.debug ? '逐步调试' : '正常试运行'}
    </p>
  );
  return (
    <>
      {preview.rerun && !compact && (
        <section className="run-review-card">
          <h2>关联原运行，从头执行</h2>
          <p>
            {preview.rerun.name} · {preview.rerun.runId}
          </p>
          <p>已核对原输出与外部结果；新运行不恢复旧脚本内部现场，可能再次产生外部更改。</p>
        </section>
      )}
      <section className="run-review-card">
        <h2>操作对象</h2>
        {!!tools.length && (
          <p>包含 {tools.length} 个工具步骤；已保存连接及当前记录状态见下方“工具调用与参数”。</p>
        )}
        {objects.length ? (
          <ul>
            {objects.map((r) => (
              <Resource key={r.id} resource={r} />
            ))}
          </ul>
        ) : (
          <p>
            {preview.ready
              ? locations.length
                ? `本机文件资源：${locations.map((r) => r.name).join('、')}。实际位置见下方。`
                : '在本机处理流程中的数据，无网页或文件资源。'
              : '检查尚未完成，请先处理执行前检查中的提示。'}
          </p>
        )}
      </section>
      <section className="run-review-card">
        <h2>读取内容</h2>
        {!!sources.length && (
          <div className="run-review-resource-group">
            <h3>读取来源</h3>
            <ul>
              {sources.map((resource) => (
                <Resource key={resource.id} resource={resource} />
              ))}
            </ul>
          </div>
        )}
        {reads.length ? (
          <ul>
            {reads.map((e) => (
              <li key={e.nodeId}>
                <b>{e.name}</b> · {e.detail}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {sources.length
              ? '以上资源允许读取；具体内容取决于流程参数和实际执行步骤。'
              : '没有独立的文件或网页读取步骤。'}
            脚本、HTTP、上传、工具与应用选区的读取范围需结合下方影响说明核对。
          </p>
        )}
      </section>
      <section className="run-review-card">
        <h2>会产生的更改</h2>
        {changes.length ? (
          <ul>
            {changes.map((e) => (
              <li key={e.nodeId}>
                <b>{e.name}</b> · {e.detail}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {preview.ready
              ? '没有列出的文件写入、网络请求或其他外部更改步骤。运行记录和结果会保存在本机。'
              : '检查尚未通过，暂不确认外部更改范围。请先处理执行前检查中的提示。'}
          </p>
        )}
      </section>
      {!!tools.length && <RunReviewTools calls={tools} />}
      <section className="run-review-card">
        <h2>保存位置</h2>
        {destinations.length ? (
          <ul>
            {destinations.map((r) => (
              <Resource key={r.id} resource={r} />
            ))}
          </ul>
        ) : (
          <p>
            {preview.ready
              ? '没有已核对的文件写入位置。本次运行记录与结果仍保存在本机，可在运行详情查看。'
              : '资源尚未核对，暂不确认保存位置。'}
          </p>
        )}
      </section>
      <section className="run-review-card">
        <h2>执行版本</h2>
        {!compact && versionSummary}
        <p>
          {repairRevision !== undefined
            ? preview.ready
              ? `采用已检查的目标修复方案 · 任务修订 ${repairRevision}，运行中修改草稿不影响此次执行。`
              : `目标修复方案 · 任务修订 ${repairRevision}；检查未通过，尚未固定执行版本。`
            : preview.ready
              ? '采用已检查的固定方案，运行中修改草稿不影响此次执行。'
              : '当前显示已保存方案；检查尚未通过，还没有创建运行或固定执行版本。'}
        </p>
        <details>
          <summary>查看版本与参数</summary>
          {compact && versionSummary}
          <p className="run-review-version">{preview.flow.versionId || '检查通过后固定版本'}</p>
          <p>参数：{preview.flow.parameterNames.join('、') || '无'}</p>
          <p>声明能力：{preview.flow.capabilities.join('、') || '无'}</p>
          {compact && preview.rerun && (
            <div className="run-review-rerun-origin">
              <p>关联原运行：{preview.rerun.name}</p>
              <p className="run-review-version">{preview.rerun.runId}</p>
              <p>已核对原输出与外部结果；新运行从第 1 步开始，不恢复旧脚本内部现场。</p>
            </div>
          )}
        </details>
      </section>
    </>
  );
}
export default function RunReviewPage(props: Props) {
  const [binding, setBinding] = useState(false);
  const bindings = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const controller = useRef<RunReviewSession | null>(null);
  controller.current ??= new RunReviewSession(
    (method, args) => window.flowark.request(method, args),
    (detail) => callbacks.current.openDetail(detail),
  );
  const session = controller.current;
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const selectionKey = JSON.stringify(props.selection);
  useLayoutEffect(() => {
    if (props.active && props.selection) {
      session.enter(props.selection, props.source);
      document.querySelector('main')?.scrollTo({ top: 0 });
      heading.current?.focus({ preventScroll: true });
    } else session.leave();
    return () => session.leave();
  }, [session, props.active, selectionKey, props.source]);
  const attempt = state.attempt;
  const preview = attempt?.preview ?? state.preview;
  if (props.active && preview?.desktop?.bindingId) bindings.current.add(preview.desktop.bindingId);
  useEffect(() => {
    setBinding(false);
    return () => {
      for (const id of bindings.current)
        void window.flowark.request('desktop.run.release', { bindingId: id }).catch(() => {});
      bindings.current.clear();
    };
  }, [props.active, props.selection?.id, props.selection?.task?.id]);
  useEffect(() => {
    if (!props.active || attempt || !preview?.desktop?.expiresAt || !preview.ready) return;
    const timer = setTimeout(
      () => void session.refresh(),
      Math.max(0, preview.desktop.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [props.active, attempt, preview, session]);
  const locked = attempt?.phase === 'pending' || attempt?.phase === 'unknown';
  const title =
    attempt?.phase === 'created'
      ? '本次试运行已创建'
      : attempt?.phase === 'pending'
        ? '正在确认本次试运行'
        : attempt?.phase === 'unknown'
          ? '确认结果尚未核对'
          : attempt?.phase === 'rejected'
            ? '本次确认未创建运行'
            : state.loading
              ? '正在检查'
              : preview?.ready
                ? '检查通过'
                : '需要处理';
  const desktopReview = !!preview?.desktop;
  const compactReview = !!props.selection?.task && !preview?.desktop;
  const repairRevision =
    props.repair &&
    preview?.task?.id === props.repair.taskId &&
    preview.task.revision === props.repair.revision &&
    preview.rerun?.runId === props.repair.runId
      ? props.repair.revision
      : undefined;
  const debugToggle = !attempt ? (
    <label className="run-review-toggle">
      <input
        type="checkbox"
        checked={!!state.selection?.debug}
        disabled={state.loading || binding}
        onChange={(e) => void session.refresh(e.target.checked)}
      />
      逐步调试，在每个步骤前暂停
    </label>
  ) : null;
  const refreshButton = !locked && (
    <button
      onClick={() => void session.refresh()}
      disabled={state.loading || state.opening || binding}
    >
      {attempt?.run ? '检查新的试运行' : '重新检查'}
    </button>
  );
  const hasResourceIssue = preview?.checks.some((check) => !!reviewResourceIssue(check));
  const configureButton = !locked && !attempt?.run && !hasResourceIssue && (
    <button onClick={props.edit}>配置流程与资源</button>
  );
  const rebindButton =
    !locked && !attempt?.run && desktopReview && props.selection?.task && props.bound ? (
      <button
        disabled={state.loading || binding}
        onClick={() => {
          session.setReviewed(false);
          setBinding(true);
        }}
      >
        重新选择窗口与原选区
      </button>
    ) : null;
  const reviewUtilities = (
    <>
      {refreshButton}
      {configureButton}
    </>
  );
  return (
    <div
      className={
        'page run-review-page' +
        (preview?.desktop ? ' is-desktop' : '') +
        (props.embedded ? ' is-embedded-review' : '') +
        (compactReview ? ' is-task-review' : '')
      }
      hidden={!props.active}
      aria-busy={state.loading}
    >
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {preview?.desktop ? '确认这次应用修改' : '试运行前，最后确认一次'}
          </h1>
          <p>
            {desktopReview
              ? preview?.desktop?.windowTitle
                ? `本机应用助手 · 文本编辑 / ${preview.desktop.windowTitle}`
                : '重新选择本次 TextEdit 窗口与原选区后，才能确认修改。'
              : '试运行也会执行已列出的操作；这不是无副作用的预览'}
          </p>
        </div>
      </div>
      <div className="run-review-columns">
        <div className="ai-task-card run-review-summary">
          {binding && props.selection?.task && preview?.desktop && props.bound ? (
            <DesktopRunBinding
              key={preview.desktop.flowHash}
              selection={props.selection}
              flowHash={preview.desktop.flowHash}
              close={() => setBinding(false)}
              bound={(detail) => {
                const id = detail.flow?.desktopTarget?.binding?.bindingId;
                if (id) bindings.current.add(id);
                setBinding(false);
                props.bound?.(detail);
              }}
            />
          ) : preview ? (
            <Contents preview={preview} compact={compactReview} repairRevision={repairRevision} />
          ) : (
            <div role="status">
              <h2>{state.loading ? '正在核对保存的流程与资源' : '尚未取得检查结果'}</h2>
              <p>检查不会创建运行。目标、读取内容、可能更改和保存位置将在这里显示。</p>
            </div>
          )}
        </div>
        <section className="ai-task-card run-review-confirm" aria-label="执行前检查">
          <h2 aria-live="polite">{preview?.desktop ? '本次授权' : title}</h2>
          {desktopReview && (!preview?.ready || attempt || state.loading) && (
            <p aria-live="polite">{title}</p>
          )}
          {!attempt && (
            <>
              {preview?.checks
                .filter((check) => !desktopReview || !check.passed)
                .map((check, i) => (
                  <RunReviewCheck
                    key={`${i}:${check.detail}`}
                    check={check}
                    compact={compactReview}
                    configure={props.edit}
                    disabled={state.loading || state.opening || binding || locked}
                  />
                ))}
              {!compactReview && !desktopReview && debugToggle}
              {compactReview && preview?.rerun && (
                <p className="run-review-rerun-note">
                  从第 1 步创建新运行；已完成或结果未知的外部操作，可能再次发生。
                </p>
              )}
              <label className="run-review-toggle">
                <input
                  type="checkbox"
                  checked={state.reviewed}
                  disabled={!preview?.ready || state.loading || binding}
                  onChange={(e) => session.setReviewed(e.target.checked)}
                />
                {preview?.desktop
                  ? '读取选区、替换选区并回读'
                  : preview?.toolCalls?.length
                    ? '我授权本次按已列工具和参数来源执行，已核对外部影响；结果未知时不自动重试'
                    : '我已核对操作对象、可能更改和保存位置'}
              </label>
              {desktopReview && (
                <p className="desktop-confirm-authorization">
                  我授权本次只替换已核对的原选区，并读取修改后的文字核对。试运行会实际修改文档；运行期间请保持文档与选区不变，结果未知不自动重放。
                </p>
              )}
              <button
                className="primary"
                disabled={!preview?.ready || !state.reviewed || state.loading || binding}
                onClick={() => void session.confirm()}
              >
                {preview?.desktop ? '确认修改并试运行' : '开始试运行'}
              </button>
            </>
          )}
          {attempt?.phase === 'pending' && (
            <p role="status">正在核对并提交本次确认。离开页面不会撤销已创建的运行。</p>
          )}
          {attempt?.phase === 'unknown' && (
            <>
              <p role="alert">{attempt.message}</p>
              <p>可能已经创建运行。查询会使用同一个请求编号，不会另建确认请求。</p>
              <button className="primary" onClick={() => void session.confirm()}>
                查询本次确认结果
              </button>
            </>
          )}
          {attempt?.phase === 'rejected' && <p role="alert">{attempt.message}</p>}
          {attempt?.run && (
            <div className="run-review-receipt" role="status">
              <p>运行已创建</p>
              <b>{attempt.run.name}</b>
              <p className="run-review-version" data-run-id={attempt.run.id}>
                {attempt.run.id}
              </p>
              <p>返回或查看结果不会重复执行。</p>
              <button
                className="primary"
                disabled={state.opening}
                onClick={() => void session.open()}
              >
                {state.opening ? '正在读取详情…' : '查看本次运行'}
              </button>
            </div>
          )}
          {state.error && (
            <p className="run-review-error" role="alert">
              {state.error}
            </p>
          )}
          {!compactReview && !desktopReview && refreshButton}
          <button onClick={props.back}>
            {desktopReview
              ? attempt && attempt.phase !== 'rejected'
                ? '返回方案（不撤销本次运行）'
                : '取消，回到方案'
              : '回去修改'}
          </button>
          {desktopReview ? (
            <>
              {!preview?.ready && !state.loading && rebindButton}
              <details className="run-review-options desktop-review-options">
                <summary>窗口绑定、检查与试运行选项</summary>
                <p aria-live="polite">{title}</p>
                {!attempt &&
                  preview?.checks
                    .filter((check) => check.passed)
                    .map((check, i) => (
                      <RunReviewCheck key={`${i}:${check.detail}`} check={check} compact />
                    ))}
                {debugToggle}
                {(preview?.ready || state.loading) && rebindButton}
                {reviewUtilities}
              </details>
            </>
          ) : compactReview && !attempt ? (
            <>
              <details className="run-review-options">
                <summary>试运行选项与重新检查</summary>
                {debugToggle}
                {(preview?.ready || state.loading) && reviewUtilities}
              </details>
              {!preview?.ready && !state.loading && reviewUtilities}
            </>
          ) : (
            <>
              {compactReview ? (
                <>
                  {debugToggle}
                  {reviewUtilities}
                </>
              ) : (
                configureButton
              )}
            </>
          )}
          {preview && (
            <details className="run-review-limitations">
              <summary>检查范围与限制</summary>
              <ul>
                {preview.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
