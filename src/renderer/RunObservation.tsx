import { useEffect, useMemo, useState } from 'react';
import { Clock, ListChecks, Terminal } from 'lucide-react';
import { formatRunDuration, presentRun } from '../shared/run-presentation';

export function RunObservation({ detail }: { detail: any }) {
  const [, updateClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => updateClock((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const view = presentRun({ ...detail, output: undefined }, Date.now());
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
    <section className="run-observation panel" aria-label="运行概览">
      <div className="run-observation-step">
        <span className="run-observation-label">
          <ListChecks size={15} />
          {stepLabel}
        </span>
        <strong data-testid="run-current-step">{view.step.name ?? view.step.label}</strong>
        {view.step.instance && <code>{view.step.instance}</code>}
      </div>
      <div className="run-observation-metrics">
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
        <div>
          <span className="run-observation-label">脚本报告的进度</span>
          <strong data-testid="run-progress">{view.progress.label}</strong>
          <small>仅显示该步骤报告的数量</small>
        </div>
      </div>
      {view.statusNote && <p className="run-observation-note">{view.statusNote}</p>}
    </section>
  );
}

export function RunOutput({ detail }: { detail: any }) {
  const [expanded, setExpanded] = useState(false);
  const output = useMemo(() => presentRun(detail, Date.now()).output, [detail.output]);
  return (
    <section className="run-output panel" aria-label="运行输出">
      <div className="section-row">
        <h3>
          <Terminal size={16} />
          运行输出
        </h3>
        {output.truncated && (
          <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            {expanded ? '收起输出' : '展开完整输出'}
          </button>
        )}
      </div>
      {output.available ? (
        <>
          <p className="muted">已保存的脱敏输出；业务结果请结合回执核对。</p>
          {output.truncated && !expanded && (
            <p className="output-limit">
              长输出预览已截断，共 {output.characters.toLocaleString('zh-CN')}{' '}
              字符。展开只读取已保存内容。
            </p>
          )}
          <pre>{expanded ? output.full : output.preview}</pre>
        </>
      ) : (
        <p className="muted">
          尚无已保存的运行输出。失败、取消或存储异常时，请查看步骤记录与业务回执。
        </p>
      )}
    </section>
  );
}
