import { activateCollapseWithSpace } from './collapseKeyboard';
import { Card, Alert, Button, Collapse, Descriptions } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { presentRun } from '../shared/run-presentation';
import { runDisplayLabels } from '../shared/run-history';
import type { RunRerunDetails } from '../shared/run-rerun';
import type { Run } from '../shared/types';
import { RunOutput } from './RunObservation';

export default function RunLogSummary({
  detail,
  active,
  restoredRunId,
  inspect,
  showOutput,
  showCurrent,
  showRerun,
}: {
  detail: any;
  active: boolean;
  restoredRunId?: string;
  inspect: (detail: any, runId: string) => void;
  showOutput: () => void;
  showCurrent: () => void;
  showRerun: () => void;
}) {
  const run: Run = detail.run;
  const related: RunRerunDetails | undefined = detail.rerun;
  const view = presentRun({ ...detail, output: undefined }, Date.now());
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const request = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const busy = useRef(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) {
      request.current++;
      busy.current = false;
      setOpening('');
      setError('');
    }
    return () => {
      request.current++;
    };
  }, [active]);
  useEffect(() => {
    if (error && active) errorRef.current?.focus({ preventScroll: true });
  }, [error, active]);
  useEffect(() => {
    if (!restoredRunId) return;
    const frame = requestAnimationFrame(() =>
      (buttons.current.get(restoredRunId) ?? heading.current)?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  async function open(id: string) {
    if (busy.current || !activeRef.current) return;
    busy.current = true;
    const token = ++request.current;
    setOpening(id);
    setError('');
    try {
      const next = await window.flowark.request('run.detail', { id });
      if (request.current !== token || !activeRef.current) return;
      if (next?.run?.id !== id) throw new Error('返回的记录与所选运行不一致，请重新读取');
      inspect(next, id);
    } catch (reason) {
      if (request.current === token && activeRef.current)
        setError(reason instanceof Error ? reason.message : '无法读取关联运行，请重试');
    } finally {
      if (request.current === token) {
        busy.current = false;
        setOpening('');
      }
    }
  }
  const recordButton = (id: string, name?: string) => (
    <Button
      htmlType="button"
      ref={(element) => {
        if (element instanceof HTMLButtonElement) buttons.current.set(id, element);
        else buttons.current.delete(id);
      }}
      disabled={!!opening || undefined}
      aria-label={`查看关联运行 ${id}`}
      onClick={() => void open(id)}
    >
      {opening === id ? '正在读取…' : name || '查看运行'}
      <code>{id}</code>
    </Button>
  );
  return (
    <>
      <section aria-label="普通输出">
        <Card className="run-log-output-card">
          <RunOutput detail={detail} layout="log" />
          <Button htmlType="button" onClick={showOutput}>
            查看输出与产物
          </Button>
        </Card>
      </section>
      <section aria-label="步骤进度说明">
        <Card>
          <h3>{view.step.type === 'script' ? '脚本进度' : '步骤进度'}</h3>
          <Descriptions
            colon={false}
            size="small"
            layout="vertical"
            column={1}
            items={[
              {
                key: 'position',
                label: view.step.kind === 'last' ? '最后记录步骤' : '记录位置',
                children: view.step.name ?? view.step.label,
              },
              {
                key: 'progress',
                label: '活动步骤数量',
                children:
                  view.step.kind === 'last' ? '历史步骤请查看已保存日志' : view.progress.label,
              },
            ]}
          />
          <p>仅显示该步骤实际报告的数量；未报告时不以步骤数估算百分比。</p>
          {view.statusNote && <p>{view.statusNote}</p>}
          <Button htmlType="button" onClick={showCurrent}>
            查看运行详情
          </Button>
        </Card>
      </section>
      <section aria-label="日志来源与派生记录">
        <Card className="run-log-relations">
          <h3 ref={heading} tabIndex={-1}>
            来源与派生
          </h3>
          {error && (
            <div ref={errorRef} tabIndex={-1} className="run-log-error">
              <Alert type="error" showIcon title={error} />
            </div>
          )}
          {run.rerun ? (
            <>
              <p>原运行</p>
              {recordButton(run.rerun.runId, related?.source?.name)}
              <p>采用内容</p>
              <div>{run.rerun.mode === 'snapshot' ? '原执行快照' : '当前已保存流程'}</div>
            </>
          ) : (
            <p>此记录不是由其他运行重新执行创建。</p>
          )}
          {related ? (
            related.derived.length ? (
              <Collapse
                className="run-log-derived"
                size="small"
                defaultActiveKey={['derived']}
                items={[
                  {
                    key: 'derived',
                    onKeyDown: activateCollapseWithSpace,
                    label: `派生运行 · ${related.derived.length}`,
                    forceRender: true,
                    children: (
                      <ul>
                        {related.derived.map((item) => (
                          <li key={item.id}>
                            {recordButton(item.id, item.name)}
                            <span>{runDisplayLabels[item.state] ?? item.state}</span>
                          </li>
                        ))}
                      </ul>
                    ),
                  },
                ]}
              />
            ) : (
              <p>尚无派生运行。</p>
            )
          ) : (
            <p>尚未取得关联记录，请重新读取运行详情。</p>
          )}
          <Button htmlType="button" onClick={showRerun}>
            核对后重新运行
          </Button>
          <p>查看只读取已有记录。重新执行需另行预览并确认。</p>
        </Card>
      </section>
    </>
  );
}
