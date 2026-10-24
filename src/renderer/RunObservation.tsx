import TechnicalDetails from './TechnicalDetails';
import { Button, Collapse, Input } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import type { Event } from '../shared/types';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Clock, ListChecks, Terminal } from 'lucide-react';
import { formatRunDuration, presentRun } from './run-presentation';
import RunStepDetails, { RunFileOperation } from './RunStepDetails';
import { flatten } from './flow-editing';
import { runInstancePresenter } from './run-instance-presentation';

export function RunObservation({
  detail,
  compact = false,
  rerun,
  openRun,
}: {
  detail: any;
  compact?: boolean;
  rerun?: () => void;
  openRun?: (detail: any) => void;
}) {
  const [, updateClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => updateClock((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const view = presentRun({ ...detail, output: undefined }, Date.now());
  const unresolved =
    !!view.step.instance && runInstancePresenter(detail.snapshot)(view.step.instance) === null;
  const node = unresolved
    ? undefined
    : flatten(detail.snapshot?.steps ?? []).find((item) => item.id === view.step.nodeId);
  const fileNode = node?.type === 'file' || node?.type === 'excel' ? node : undefined;
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
          {unresolved ? '步骤位置待核对' : (view.step.name ?? view.step.label)}
        </strong>
        {view.step.instance && !compact && (
          <TechnicalDetails items={[{ label: '步骤实例路径', value: view.step.instance }]} />
        )}
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
      <RunStepDetails
        detail={detail}
        step={view.step}
        compact={compact}
        rerun={rerun}
        openRun={openRun}
      />
    </section>
  );
}

const rawOutputSegmentSize = 8192;

export function RunOutput({
  detail,
  layout = 'panel',
}: {
  detail: any;
  layout?: 'panel' | 'task' | 'result' | 'log';
}) {
  const [expanded, setExpanded] = useState(false);
  const [segment, setSegment] = useState(0);
  const [segmentInput, setSegmentInput] = useState('1');
  const [segmentError, setSegmentError] = useState('');
  const outputId = useId();
  const rangeId = useId();
  const errorId = useId();
  const content = useRef<HTMLPreElement>(null);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const navigationOrigin = useRef<HTMLElement | null>(null);
  const expandOrigin = useRef<HTMLElement | null>(null);
  const output = useMemo(() => presentRun(detail, Date.now()).output, [detail.output]);
  const segmentCount = Math.max(1, Math.ceil(output.characters / rawOutputSegmentSize));
  const currentSegment = Math.min(segment, segmentCount - 1);
  // Adjacent segments share this boundary so a surrogate pair is never split or repeated.
  const boundary = (index: number) => {
    const position = Math.min(output.characters, index * rawOutputSegmentSize);
    const before = output.full.charCodeAt(position - 1);
    const after = output.full.charCodeAt(position);
    return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
      ? position - 1
      : position;
  };
  const segmentStart = boundary(currentSegment);
  const segmentEnd = boundary(currentSegment + 1);
  useLayoutEffect(() => {
    navigationOrigin.current = null;
    expandOrigin.current = null;
    setExpanded(false);
    setSegment(0);
    setSegmentInput('1');
    setSegmentError('');
    content.current?.scrollTo(0, 0);
  }, [detail.run.id, output.full]);
  useLayoutEffect(() => {
    const origin = navigationOrigin.current;
    const expandButton = expandOrigin.current;
    navigationOrigin.current = null;
    expandOrigin.current = null;
    content.current?.scrollTo(0, 0);
    if (expanded && expandButton && document.activeElement === expandButton) {
      content.current?.focus({ preventScroll: true });
    } else if (
      origin instanceof HTMLButtonElement &&
      origin.disabled &&
      (document.activeElement === origin || document.activeElement === document.body)
    ) {
      const enabledDirection = previous.current?.disabled ? next.current : previous.current;
      enabledDirection?.focus({ preventScroll: true });
    }
  }, [expanded, currentSegment]);
  const goToSegment = (target: number, origin: HTMLElement) => {
    navigationOrigin.current = document.activeElement === origin ? origin : null;
    setSegment(target);
    setSegmentInput(String(target + 1));
    setSegmentError('');
    content.current?.scrollTo(0, 0);
  };
  const jumpToSegment = (origin: HTMLElement) => {
    const target = Number(segmentInput);
    if (
      !/^[1-9]\d*$/.test(segmentInput) ||
      !Number.isSafeInteger(target) ||
      target > segmentCount
    ) {
      setSegmentError(`请输入 1—${segmentCount.toLocaleString('zh-CN')} 的整数段号。`);
      return;
    }
    goToSegment(target - 1, origin);
  };
  return (
    <section
      className={
        layout === 'task'
          ? 'run-output task-run-output'
          : layout === 'result'
            ? 'run-output result-output'
            : layout === 'log'
              ? 'run-output log-output'
              : 'run-output panel'
      }
      aria-label={layout === 'task' ? '结构化输出' : layout === 'result' ? '入口结果' : '运行输出'}
    >
      <div className="section-row">
        <h3>
          {layout === 'task' ? (
            '结构化输出'
          ) : layout === 'result' ? (
            '入口结果'
          ) : layout === 'log' ? (
            '普通输出'
          ) : (
            <>
              <Terminal size={16} />
              运行输出
            </>
          )}
        </h3>
      </div>
      {output.available ? (
        <Collapse
          key={detail.run.id}
          size="small"
          onChange={(keys) => {
            if (!keys.includes('raw-output')) {
              setExpanded(false);
              setSegment(0);
              setSegmentInput('1');
              setSegmentError('');
            }
          }}
          items={[
            {
              key: 'raw-output',
              label: '原始输出（高级诊断）',
              onKeyDown: activateCollapseWithSpace,
              children: (
                <>
                  <p className="muted">
                    {layout === 'task'
                      ? '已脱敏 JSON'
                      : layout === 'result'
                        ? '已保存输出 · 已脱敏'
                        : '已保存的脱敏输出；业务结果请结合回执核对。'}
                  </p>
                  {output.truncated && !expanded && (
                    <p className="output-limit">
                      长输出预览已截断，共 {output.characters.toLocaleString('zh-CN')}{' '}
                      字符。展开后分段读取已保存内容。
                    </p>
                  )}
                  {output.truncated && (
                    <Button
                      onClick={(event) => {
                        expandOrigin.current = event.currentTarget;
                        setExpanded(!expanded);
                        setSegment(0);
                        setSegmentInput('1');
                        setSegmentError('');
                      }}
                      aria-expanded={expanded}
                      aria-controls={outputId}
                    >
                      {expanded ? '收起完整输出' : '阅读完整输出'}
                    </Button>
                  )}
                  {expanded && output.truncated && (
                    <div className="run-output-segments">
                      <p id={rangeId} role="status">
                        第 {(currentSegment + 1).toLocaleString('zh-CN')} /{' '}
                        {segmentCount.toLocaleString('zh-CN')} 段 · 当前字符{' '}
                        {(segmentStart + 1).toLocaleString('zh-CN')}—
                        {segmentEnd.toLocaleString('zh-CN')}，共{' '}
                        {output.characters.toLocaleString('zh-CN')} 字符
                      </p>
                      <div className="run-output-segment-controls">
                        <Button
                          ref={previous}
                          disabled={currentSegment === 0}
                          aria-controls={outputId}
                          onClick={(event) => goToSegment(currentSegment - 1, event.currentTarget)}
                        >
                          上一段
                        </Button>
                        <Button
                          ref={next}
                          disabled={currentSegment === segmentCount - 1}
                          aria-controls={outputId}
                          onClick={(event) => goToSegment(currentSegment + 1, event.currentTarget)}
                        >
                          下一段
                        </Button>
                        <label className="run-output-segment-jump">
                          段号
                          <Input
                            value={segmentInput}
                            inputMode="numeric"
                            status={segmentError ? 'error' : undefined}
                            aria-invalid={!!segmentError}
                            aria-describedby={segmentError ? errorId : rangeId}
                            onChange={(event) => {
                              setSegmentInput(event.target.value);
                              setSegmentError('');
                            }}
                            onPressEnter={(event) => {
                              event.preventDefault();
                              jumpToSegment(event.currentTarget);
                            }}
                          />
                        </label>
                        <Button
                          aria-controls={outputId}
                          onClick={(event) => jumpToSegment(event.currentTarget)}
                        >
                          跳转
                        </Button>
                      </div>
                      {segmentError && (
                        <p id={errorId} className="run-output-segment-error" role="alert">
                          {segmentError}
                        </p>
                      )}
                    </div>
                  )}
                  <pre
                    data-expanded={expanded}
                    id={outputId}
                    ref={content}
                    tabIndex={0}
                    aria-label="已保存的结构化输出"
                  >
                    {expanded
                      ? output.full.slice(segmentStart, segmentEnd)
                      : output.truncated
                        ? output.full.slice(0, boundary(1))
                        : output.preview}
                  </pre>
                </>
              ),
            },
          ]}
        />
      ) : (
        <p className="muted">
          尚无已保存的运行输出。失败、取消或存储异常时，请查看步骤记录与业务回执。
        </p>
      )}
      {layout === 'result' && (
        <>
          <p className="run-output-boundary">
            运行结束、外部业务结果与文件可用性分别核对；查看结果不会重新执行步骤。
          </p>
        </>
      )}
    </section>
  );
}

// Each saved output follows latest-step changes while retaining manual expansion on ordinary refresh.
export function RunStepOutput({
  event,
  latest,
  label,
  instance,
}: {
  event: Event;
  latest: boolean;
  label: string;
  instance?: string;
}) {
  const [expanded, setExpanded] = useState(latest);
  useEffect(() => setExpanded(latest), [latest, event.runId]);
  return (
    <Collapse
      className="run-saved-step-output"
      size="small"
      activeKey={expanded ? ['output'] : []}
      onChange={(keys) => setExpanded(keys.includes('output'))}
      items={[
        {
          key: 'output',
          label,
          forceRender: true,
          onKeyDown: activateCollapseWithSpace,
          children: (
            <>
              {instance && (
                <TechnicalDetails items={[{ label: '步骤实例路径', value: instance }]} />
              )}
              <pre tabIndex={0} aria-label={`${label} · 已保存步骤输出`}>
                {event.data.outputPreview}
              </pre>
            </>
          ),
        },
      ]}
    />
  );
}
