import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Clock, ListChecks, Terminal } from 'lucide-react';
import { formatRunDuration, presentRun } from '../shared/run-presentation';
import RunStepDetails, { RunFileOperation, fileOperationTitle } from './RunStepDetails';
import { kinds } from './node-kinds';
import { flatten } from './flow-editing';
import { browserActions } from './browser-actions';

export function RunObservation({ detail, compact = false }: { detail: any; compact?: boolean }) {
  const [, updateClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => updateClock((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const view = presentRun({ ...detail, output: undefined }, Date.now());
  const node = flatten(detail.snapshot?.steps ?? []).find((item) => item.id === view.step.nodeId);
  const fileNode = node?.type === 'file' || node?.type === 'excel' ? node : undefined;
  const defaultName =
    node?.type === 'browser'
      ? browserActions[node.operation]?.label
      : view.step.type
        ? kinds[view.step.type]?.label
        : undefined;
  const stepLabel = {
    current: '当前步骤',
    paused: '下一步',
    waiting: '等待人工',
    last: '最后记录步骤',
    pending: '运行位置',
    unknown: '运行位置',
  }[view.step.kind];
  const elapsedLabel = {
    live: '运行耗时',
    final: '总耗时',
    recorded: '已记录时长',
    unknown: '运行耗时',
  }[view.elapsed.kind];
  return (
    <section
      className={`run-observation panel${compact ? ' is-compact' : ''}`}
      aria-label="运行概览"
    >
      <div className="run-observation-step">
        {(!compact || view.step.kind !== 'current') && (
          <span className="run-observation-label">
            <ListChecks size={15} />
            {stepLabel}
          </span>
        )}
        <strong data-testid="run-current-step">
          {fileNode
            ? fileOperationTitle(fileNode)
            : view.step.name === view.step.nodeId && view.step.type
              ? (defaultName ?? view.step.name)
              : (view.step.name ?? view.step.label)}
        </strong>
        {view.step.instance && !compact && <code>{view.step.instance}</code>}
      </div>
      {(!compact || !fileNode) && (
        <div className="run-observation-metrics">
          {!compact && (
            <div>
              <span className="run-observation-label">
                <Clock size={14} />
                {elapsedLabel}
              </span>
              <strong
                data-testid="run-elapsed"
                data-duration-ms={view.elapsed.milliseconds ?? ''}
                data-elapsed-kind={view.elapsed.kind}
              >
                {view.elapsed.milliseconds === null
                  ? '待核对'
                  : formatRunDuration(view.elapsed.milliseconds)}
              </strong>
              <small>{view.elapsed.note}</small>
            </div>
          )}
          {!fileNode && (
            <div>
              <span className="run-observation-label">脚本报告的进度</span>
              <strong data-testid="run-progress">{view.progress.label}</strong>
              <small>仅显示该步骤报告的数量</small>
            </div>
          )}
        </div>
      )}
      {fileNode && <RunFileOperation detail={detail} step={view.step} node={fileNode} />}
      {view.statusNote && !compact && <p className="run-observation-note">{view.statusNote}</p>}
      <RunStepDetails detail={detail} step={view.step} compact={compact} />
    </section>
  );
}

export function RunOutput({
  detail,
  layout = 'panel',
}: {
  detail: any;
  layout?: 'panel' | 'task';
}) {
  const [expanded, setExpanded] = useState(false);
  const outputId = useId();
  const content = useRef<HTMLPreElement>(null);
  const toggleOrigin = useRef<HTMLButtonElement | null>(null);
  const output = useMemo(() => presentRun(detail, Date.now()).output, [detail.output]);
  useLayoutEffect(() => {
    const origin = toggleOrigin.current;
    toggleOrigin.current = null;
    if (!origin || !content.current) return;
    content.current.scrollTo(0, 0);
    if (document.activeElement === origin) {
      content.current.focus({ preventScroll: true });
      content.current.scrollIntoView({ block: 'nearest' });
    }
  }, [expanded]);
  return (
    <section
      className={layout === 'task' ? 'run-output task-run-output' : 'run-output panel'}
      aria-label={layout === 'task' ? '结构化输出' : '运行输出'}
    >
      <div className="section-row">
        <h3>
          {layout === 'task' ? (
            '结构化输出'
          ) : (
            <>
              <Terminal size={16} />
              运行输出
            </>
          )}
        </h3>
        {output.truncated && (
          <button
            onClick={(event) => {
              toggleOrigin.current = event.currentTarget;
              setExpanded(!expanded);
            }}
            aria-expanded={expanded}
            aria-controls={outputId}
          >
            {expanded ? '收起输出' : '展开完整输出'}
          </button>
        )}
      </div>
      {output.available ? (
        <>
          <p className="muted">
            {layout === 'task' ? '已脱敏 JSON' : '已保存的脱敏输出；业务结果请结合回执核对。'}
          </p>
          {output.truncated && !expanded && (
            <p className="output-limit">
              长输出预览已截断，共 {output.characters.toLocaleString('zh-CN')}{' '}
              字符。展开只读取已保存内容。
            </p>
          )}
          <pre id={outputId} ref={content} tabIndex={0} aria-label="已保存的结构化输出">
            {expanded ? output.full : output.preview}
          </pre>
        </>
      ) : (
        <p className="muted">
          尚无已保存的运行输出。失败、取消或存储异常时，请查看步骤记录与业务回执。
        </p>
      )}
    </section>
  );
}
