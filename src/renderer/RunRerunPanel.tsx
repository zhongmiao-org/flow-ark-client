import { Alert, Collapse, ConfigProvider, Button, Checkbox, Descriptions, Radio } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { useEffect, useId, useRef, useState } from 'react';
import type { Run } from '../shared/types';
import type {
  RunRerunConfirmInput,
  RunRerunDetails,
  RunRerunMode,
  RunRerunPreview,
} from '../shared/run-rerun';
import { runStateLabels } from '../shared/run-history';
import './run-rerun-layout.css';

const api = (method: string, args: unknown) => window.flowark.request(method, args);
const modes = { snapshot: '原执行快照', saved: '当前已保存流程' };
const names = (values: string[]) => values.join('、') || '无';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type RunRerunView = {
  mode: RunRerunMode;
  debug: boolean;
  reasonsOpen: boolean;
  relationsOpen: boolean;
  focusRunId?: string;
};

export default function RunRerunPanel({
  run,
  related,
  open,
  initialMode = 'snapshot',
  page = false,
  active = true,
  cancel,
  busyChanged,
  inspectSource,
  inspectRelated,
  initialView,
}: {
  run: Run;
  related?: RunRerunDetails;
  open: (detail: any) => void;
  initialMode?: RunRerunMode;
  page?: boolean;
  active?: boolean;
  cancel?: () => void;
  busyChanged?: (busy: boolean) => void;
  inspectSource?: (tab: 'output' | 'logs') => void;
  inspectRelated?: (detail: any, view: RunRerunView) => void;
  initialView?: RunRerunView;
}) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const choiceId = useId();
  const [reasonsOpen, setReasonsOpen] = useState(initialView?.reasonsOpen ?? false);
  const [relationsOpen, setRelationsOpen] = useState(initialView?.relationsOpen ?? false);
  const relatedButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoringFocus = useRef(!!initialView?.focusRunId);
  useEffect(() => {
    if (!initialView?.focusRunId) return;
    const frame = requestAnimationFrame(() => {
      restoringFocus.current = false;
      (relatedButtons.current.get(initialView.focusRunId!) ?? relationsHeading.current)?.focus({
        preventScroll: true,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const reasonsHeading = useRef<HTMLHeadingElement>(null);
  const relationsHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!reasonsOpen || restoringFocus.current) return;
    const frame = requestAnimationFrame(() =>
      reasonsHeading.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [reasonsOpen]);
  useEffect(() => {
    if (!relationsOpen || restoringFocus.current) return;
    const frame = requestAnimationFrame(() =>
      relationsHeading.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [relationsOpen]);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const previewRegion = useRef<HTMLFormElement>(null);
  const errorPanel = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<RunRerunMode>(initialView?.mode ?? initialMode);
  const [debug, setDebug] = useState(initialView?.debug ?? false);
  const [preview, setPreview] = useState<RunRerunPreview>();
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(false);
  const [created, setCreated] = useState<Run>();
  const [opening, setOpening] = useState<string>();
  const [error, setError] = useState('');
  const live = useRef(true);
  const generation = useRef(0);
  const sending = useRef(false);
  const attempt = useRef<RunRerunConfirmInput | undefined>(undefined);
  const previewButton = useRef<HTMLButtonElement>(null);
  const createdButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    busyChanged?.(submitting && active);
    return () => busyChanged?.(false);
  }, [submitting, busyChanged, active]);
  const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (preview && active) (page ? previewRegion.current : previewHeading.current)?.focus();
  }, [preview, active, page]);
  useEffect(() => {
    if (active && created && !submitting && !opening) createdButton.current?.focus();
  }, [created, submitting, opening, active]);
  useEffect(() => {
    if (error && active) errorPanel.current?.focus();
  }, [error, active]);
  const current = (id: number) => live.current && generation.current === id;
  const reset = (preserveCreated = false) => {
    generation.current++;
    attempt.current = undefined;
    setPreview(undefined);
    setReviewed(false);
    setLoading(false);
    setRetry(false);
    if (!preserveCreated) setCreated(undefined);
    setOpening(undefined);
    setError('');
  };
  const leave = () => {
    if (sending.current) return;
    if (cancel) {
      reset(true);
      cancel();
    } else {
      reset();
      previewButton.current?.focus();
    }
  };
  const load = async () => {
    if (sending.current || !related?.available) return;
    reset();
    const id = generation.current;
    setLoading(true);
    try {
      const result: RunRerunPreview = await api('run.rerun.preview', {
        id: run.id,
        mode,
        debug,
      });
      if (current(id)) setPreview(result);
    } catch (error) {
      if (current(id)) setError(message(error));
    } finally {
      if (current(id)) setLoading(false);
    }
  };
  const inspect = async (runId: string) => {
    if (sending.current) return;
    reset(true);
    const id = generation.current;
    setOpening(runId);
    try {
      const detail = await api('run.detail', { id: runId });
      if (current(id) && activeRef.current) {
        if (detail?.run?.id !== runId) throw new Error('返回的记录与所选运行不一致，请重新读取');
        if (inspectRelated)
          inspectRelated(detail, { mode, debug, reasonsOpen, relationsOpen, focusRunId: runId });
        else open(detail);
      }
    } catch (error) {
      if (current(id)) setError(message(error));
    } finally {
      if (current(id)) setOpening(undefined);
    }
  };
  const confirm = async () => {
    if (!preview || !reviewed || sending.current || (!related?.available && !attempt.current))
      return;
    // Keep exactly this payload after an uncertain reply; a retry uses the same request ID.
    const request =
      attempt.current ??
      (attempt.current = {
        id: run.id,
        mode: preview.mode,
        debug: preview.debug,
        token: preview.token,
        requestId: crypto.randomUUID(),
        reviewed: true,
      });
    const id = ++generation.current;
    sending.current = true;
    setSubmitting(true);
    setRetry(false);
    setError('');
    try {
      const next: Run = await api('run.rerun.confirm', request);
      if (!current(id)) return;
      attempt.current = undefined;
      setCreated(next);
      setPreview(undefined);
      setReviewed(false);
      try {
        const detail = await api('run.detail', { id: next.id });
        if (current(id) && activeRef.current) open(detail);
      } catch (error) {
        if (current(id)) setError('新运行已创建，但详情暂时无法读取：' + message(error));
      }
    } catch (error) {
      if (current(id)) {
        setError(message(error));
        setRetry(true);
      }
    } finally {
      if (current(id)) {
        sending.current = false;
        setSubmitting(false);
      }
    }
  };
  return (
    <section className="run-rerun run-rerun-workspace" aria-label="人工核对后重新运行">
      {!page && (
        <div className="section-row">
          <div>
            <h2>重新运行前，核对已完成操作</h2>
            <p className="muted">创建独立运行记录，从第一个步骤开始。</p>
          </div>
        </div>
      )}
      <div className="run-rerun-layout">
        <div className="run-rerun-main">
          {!terminal && (
            <div className="run-rerun-unavailable" role="status">
              <h2>当前不可重新运行</h2>
              <p>{related?.reason ?? '请等待原运行结束，再核对结果。'}</p>
              <p>可以查看原运行的输出、日志和关联记录。</p>
            </div>
          )}
          {terminal && !created && (
            <>
              <div className="run-rerun-options">
                <ConfigProvider componentDisabled={submitting || undefined}>
                  <fieldset className="run-rerun-mode" disabled={submitting}>
                    <legend>选择执行内容</legend>
                    {(['snapshot', 'saved'] as const).map((value) => (
                      <Radio
                        name={choiceId}
                        value={value}
                        checked={mode === value}
                        onChange={() => {
                          if (sending.current) return;
                          reset();
                          setMode(value);
                        }}
                        key={value}
                        className={mode === value ? 'is-selected' : undefined}
                      >
                        <span>
                          <strong>{modes[value]}</strong>
                          <small>
                            {value === 'snapshot'
                              ? '采用原运行保存的流程、参数与固定脚本。'
                              : '采用当前已保存的流程，未保存草稿不包含在内。'}
                          </small>
                        </span>
                      </Radio>
                    ))}
                  </fieldset>
                </ConfigProvider>
                <Checkbox
                  checked={debug}
                  disabled={submitting || undefined}
                  onChange={(event) => {
                    if (sending.current) return;
                    reset();
                    setDebug(event.target.checked);
                  }}
                  className="run-rerun-check"
                >
                  逐步调试新运行
                </Checkbox>
                <Button
                  htmlType="button"
                  hidden={!!preview}
                  ref={previewButton}
                  disabled={loading || submitting || !related?.available || undefined}
                  onClick={() => void load()}
                >
                  {loading ? '正在准备预览…' : '预览重新运行'}
                </Button>
              </div>
              <p className="note" hidden={!!preview}>
                {mode === 'snapshot'
                  ? '使用原运行的流程、参数、本地绑定和固定脚本，并重新检查当前授权。'
                  : '使用当前已保存的内容；编辑器尚未保存的修改不在本次范围内。'}
              </p>
            </>
          )}
          {loading && <p role="status">正在准备重新运行预览…</p>}
          {opening && <p role="status">正在读取关联运行…</p>}
          {created && (
            <p role="status" className="run-rerun-source">
              已创建新运行
              <Button
                htmlType="button"
                aria-label={'查看新运行 ' + created.id}
                ref={createdButton}
                disabled={submitting || !!opening || undefined}
                onClick={() => void inspect(created.id)}
              >
                {created.id.slice(0, 8)} · 查看新运行
              </Button>
            </p>
          )}
          {error && (
            <div ref={errorPanel} tabIndex={-1} className="run-rerun-error">
              <Alert type="error" role="alert" showIcon title={error} />
            </div>
          )}
          {retry && (
            <Alert
              type="warning"
              role="status"
              showIcon
              title="确认请求可能已经入队。重试此次确认会查询同一次结果；取消、更改选择或重新预览不会撤销已经创建的运行，之后再次确认属于新的请求。"
            />
          )}
          {preview && (
            <form
              aria-label="重新运行预览"
              ref={previewRegion}
              tabIndex={-1}
              className="run-rerun-preview"
              onSubmit={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              <h3 ref={previewHeading} tabIndex={-1} className={page ? 'sr-only' : undefined}>
                {preview.flow.name} · 本次预览
              </h3>
              <Descriptions
                className="metadata-facts run-rerun-summary"
                column={1}
                bordered
                size="small"
                items={[
                  {
                    key: 'source',
                    label: '来源运行',
                    children: `${preview.source.id} · ${modes[preview.mode]}`,
                  },
                  {
                    key: 'summary',
                    label: '内容摘要',
                    children: `${preview.flow.stepCount} 个步骤 · ${preview.debug ? '逐步调试' : '连续运行'} · 参数 ${names(preview.flow.parameterNames)}`,
                  },
                ]}
              />
              <Collapse
                className="run-rerun-configuration"
                items={[
                  {
                    key: 'evidence-0',
                    label: <>查看版本、绑定与引用明细</>,
                    forceRender: true,
                    onKeyDown: activateCollapseWithSpace,
                    children: (
                      <div className="feedback-body">
                        <Descriptions
                          className="metadata-facts"
                          column={1}
                          bordered
                          size="small"
                          items={[
                            {
                              key: 'source',
                              label: '原运行',
                              children: (
                                <>
                                  {preview.source.name} · <code>{preview.source.id}</code>
                                </>
                              ),
                            },
                            { key: 'mode', label: '内容来源', children: modes[preview.mode] },
                            {
                              key: 'source-version',
                              label: '原执行版本',
                              children: <code>{preview.source.versionId}</code>,
                            },
                            {
                              key: 'version',
                              label: '采用版本',
                              children: <code>{preview.flow.versionId}</code>,
                            },
                            {
                              key: 'execution',
                              label: '执行方式',
                              children: `${preview.debug ? '逐步调试' : '连续运行'} · ${preview.flow.stepCount} 个步骤`,
                            },
                            {
                              key: 'parameters',
                              label: '参数名',
                              children: names(preview.flow.parameterNames),
                            },
                            {
                              key: 'directories',
                              label: '目录绑定名',
                              children: names(preview.flow.directoryBindings),
                            },
                            {
                              key: 'credentials',
                              label: '凭据引用名',
                              children: names(preview.flow.credentialRefs),
                            },
                            {
                              key: 'browser',
                              label: '浏览器标识',
                              children: preview.flow.browserId ?? '无',
                            },
                          ]}
                        />
                      </div>
                    ),
                  },
                ]}
              />
              {!!preview.flow.scriptBundles.length && (
                <Collapse
                  items={[
                    {
                      key: 'evidence-1',
                      label: <>固定脚本与依赖 · {preview.flow.scriptBundles.length} 个节点</>,
                      forceRender: true,
                      onKeyDown: activateCollapseWithSpace,
                      children: (
                        <div className="feedback-body">
                          {preview.flow.scriptBundles.map((bundle) => (
                            <p key={bundle.nodeId} className="path-text">
                              {bundle.nodeId} ·{' '}
                              {names(
                                bundle.dependencies.map((item) => item.name + '@' + item.version),
                              )}
                              <br />
                              SHA-256 {bundle.sha256}
                            </p>
                          ))}
                        </div>
                      ),
                    },
                  ]}
                />
              )}
              {preview.warnings.map((warning, index) => (
                <Alert
                  className="run-rerun-warning"
                  key={index}
                  type="warning"
                  role="status"
                  showIcon
                  title={warning}
                />
              ))}
              <Checkbox
                checked={reviewed}
                disabled={submitting || undefined}
                onChange={(event) => setReviewed(event.target.checked)}
                className="run-rerun-check run-rerun-review"
              >
                已核对原运行的输出与外部结果，确认从头执行
              </Checkbox>
              <div className="run-rerun-actions">
                <Button
                  htmlType="submit"
                  type="primary"
                  disabled={
                    submitting ||
                    !reviewed ||
                    (!related?.available && !attempt.current) ||
                    undefined
                  }
                >
                  {submitting ? '正在确认…' : retry ? '重试此次确认' : '确认创建新运行'}
                </Button>
                <Button htmlType="button" disabled={submitting || undefined} onClick={leave}>
                  取消
                </Button>
              </div>
            </form>
          )}
          {!preview && (cancel || loading || retry || created) && (
            <Button
              htmlType="button"
              className="run-rerun-cancel"
              disabled={submitting || undefined}
              onClick={leave}
            >
              {created ? '返回原运行' : cancel ? '取消并返回' : '取消重新运行'}
            </Button>
          )}
        </div>
        <aside className="run-rerun-context" aria-label="重新运行的来源与边界">
          <h3>当前授权重新检查</h3>
          <p>旧快照不会恢复已撤销的授权。确认时会重新检查当前授权、资源和执行环境。</p>
          <Collapse
            className="run-rerun-context-disclosure"
            activeKey={reasonsOpen ? ['reasons'] : []}
            onChange={(keys) => setReasonsOpen(keys.includes('reasons'))}
            items={[
              {
                key: 'reasons',
                label: reasonsOpen ? '收起阻止原因' : '查看阻止原因',
                forceRender: true,
                onKeyDown: activateCollapseWithSpace,
                children: reasonsOpen ? (
                  <section
                    id={choiceId + '-reasons'}
                    className="run-rerun-context-detail"
                    aria-labelledby={choiceId + '-reasons-title'}
                  >
                    <h4 id={choiceId + '-reasons-title'} ref={reasonsHeading} tabIndex={-1}>
                      当前可用性与阻止原因
                    </h4>
                    <p className="run-rerun-availability" role="status">
                      {created
                        ? '新运行已创建，请先查看记录'
                        : !terminal
                          ? (related?.reason ?? '请等待原运行结束，再核对结果。')
                          : related?.available
                            ? '当前记录允许准备预览'
                            : (related?.reason ?? '当前运行暂不可重新运行。')}
                    </p>
                    {error && (
                      <Alert type="error" role="status" showIcon title={`最近操作：${error}`} />
                    )}
                    {retry && <p>确认结果尚未明确。请在左侧使用“重试此次确认”核对同一次请求。</p>}
                    <p>
                      此处显示已取得的记录。允许预览不代表已通过当前授权检查；预览和确认仍可能返回具体阻止原因。
                    </p>
                  </section>
                ) : null,
              },
            ]}
          />
          <Collapse
            className="run-rerun-context-disclosure"
            activeKey={relationsOpen ? ['relations'] : []}
            onChange={(keys) => setRelationsOpen(keys.includes('relations'))}
            items={[
              {
                key: 'relations',
                label: relationsOpen ? '收起来源与派生记录' : '查看来源与派生记录',
                forceRender: true,
                onKeyDown: activateCollapseWithSpace,
                children: relationsOpen ? (
                  <section
                    id={choiceId + '-relations'}
                    className="run-rerun-context-detail"
                    aria-labelledby={choiceId + '-relations-title'}
                  >
                    <h4 id={choiceId + '-relations-title'} ref={relationsHeading} tabIndex={-1}>
                      来源与派生记录
                    </h4>
                    {inspectSource && (
                      <div className="run-rerun-source-actions">
                        <Button
                          htmlType="button"
                          disabled={submitting || undefined}
                          onClick={() => inspectSource('output')}
                        >
                          查看原运行输出
                        </Button>
                        <Button
                          htmlType="button"
                          disabled={submitting || undefined}
                          onClick={() => inspectSource('logs')}
                        >
                          查看原运行日志
                        </Button>
                      </div>
                    )}
                    <Descriptions
                      className="metadata-facts run-rerun-origin"
                      column={1}
                      bordered
                      size="small"
                      items={[
                        { key: 'name', label: '当前运行', children: run.name },
                        { key: 'id', label: '运行标识', children: <code>{run.id}</code> },
                        {
                          key: 'state',
                          label: '当前记录状态',
                          children: runStateLabels[run.state],
                        },
                      ]}
                    />
                    <p className="run-rerun-effect-note">
                      新运行从第一步开始，可能再次发生网页或文件操作。原运行记录、产物和副作用去重记录保持保留。
                    </p>
                    {run.rerun && (
                      <div className="run-rerun-source">
                        <span>本次根据{modes[run.rerun.mode]}重新运行，来源：</span>
                        <Button
                          htmlType="button"
                          aria-label={'查看来源运行 ' + run.rerun.runId}
                          ref={(element) => {
                            if (element instanceof HTMLButtonElement)
                              relatedButtons.current.set(run.rerun!.runId, element);
                            else relatedButtons.current.delete(run.rerun!.runId);
                          }}
                          disabled={submitting || !!opening || undefined}
                          onClick={() => void inspect(run.rerun!.runId)}
                        >
                          {related?.source?.name ?? '来源运行'} · {run.rerun.runId.slice(0, 8)}
                        </Button>
                        {related?.source && <span>{runStateLabels[related.source.state]}</span>}
                      </div>
                    )}
                    {related && !related.derived.length && <p>尚无由本次运行派生的记录。</p>}
                    {!!related?.derived.length && (
                      <Collapse
                        className="run-rerun-relations"
                        defaultActiveKey={['derived']}
                        items={[
                          {
                            key: 'derived',
                            label: <>由本次派生的运行 · {related.derived.length}</>,
                            forceRender: true,
                            onKeyDown: activateCollapseWithSpace,
                            children: (
                              <div className="feedback-body">
                                <ul aria-label="派生运行">
                                  {related.derived.map((item) => (
                                    <li key={item.id}>
                                      <Button
                                        htmlType="button"
                                        aria-label={'查看派生运行 ' + item.id}
                                        ref={(element) => {
                                          if (element instanceof HTMLButtonElement)
                                            relatedButtons.current.set(item.id, element);
                                          else relatedButtons.current.delete(item.id);
                                        }}
                                        disabled={submitting || !!opening || undefined}
                                        onClick={() => void inspect(item.id)}
                                      >
                                        {item.name} · {item.id.slice(0, 8)}
                                      </Button>
                                      <span>{runStateLabels[item.state]}</span>
                                      <time>
                                        {new Date(item.createdAt).toLocaleString('zh-CN')}
                                      </time>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ),
                          },
                        ]}
                      />
                    )}
                  </section>
                ) : null,
              },
            ]}
          />
        </aside>
      </div>
    </section>
  );
}
