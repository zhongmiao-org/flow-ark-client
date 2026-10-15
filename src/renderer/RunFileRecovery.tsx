import { Alert, Button, Collapse, Descriptions } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { RunPresentationInput } from '../shared/run-presentation';
import type { RunTargetContext } from '../shared/run-target-context';
import { flatten } from './flow-editing';
import { runTimeline } from './run-timeline';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { referenceOf } from './value-references';
import './run-file-recovery.css';

/** An open step is evidence of uncertainty, never evidence of a committed file. */
export function unconfirmedFileSteps(detail: RunPresentationInput) {
  if (!['FAILED', 'CANCELLED', 'INTERRUPTED', 'CANCELLING'].includes(detail.run.state)) return [];
  const snapshot = detail.snapshot?.id === detail.run.flowId ? detail.snapshot : undefined;
  const nodes = flatten(snapshot?.steps ?? []);
  return runTimeline({ ...detail, snapshot }).flatMap((row) => {
    if (!row.started || row.ended) return [];
    const node = row.located ? nodes.find((entry) => entry.id === row.nodeId) : undefined;
    if (node) {
      if (
        !['file', 'excel'].includes(node.type) ||
        !('operation' in node) ||
        node.operation === 'read'
      )
        return [];
    } else if (
      !detail.events.some(
        (event) =>
          event.runId === detail.run.id &&
          event.nodeInstance === row.instance &&
          event.type === 'node-start' &&
          ['file', 'excel'].includes(event.data?.type),
      )
    )
      return [];
    return [{ ...row, node: node?.type === 'file' || node?.type === 'excel' ? node : undefined }];
  });
}

export default function RunFileRecovery({
  detail,
  output,
}: {
  detail: RunPresentationInput & { targetContext?: RunTargetContext };
  output?: () => void;
}) {
  const steps = unconfirmedFileSteps(detail);
  const [copying, setCopying] = useState<string>();
  const [feedback, setFeedback] = useState('');
  const [failed, setFailed] = useState(false);
  const epoch = useRef(0);
  const lock = useRef(false);
  const copyOrigin = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (copying || !copyOrigin.current) return;
    const origin = copyOrigin.current;
    copyOrigin.current = null;
    if (
      origin.isConnected &&
      !origin.closest('[hidden]') &&
      document.activeElement === document.body
    )
      origin.focus({ preventScroll: true });
  }, [copying]);
  useEffect(() => {
    epoch.current++;
    lock.current = false;
    setCopying(undefined);
    setFeedback('');
    setFailed(false);
    copyOrigin.current = null;
    return () => {
      epoch.current++;
    };
  }, [detail.run.id]);
  const context = detail.targetContext;
  const current =
    context?.formatVersion === 1 &&
    context.runId === detail.run.id &&
    context.versionId === detail.run.versionId
      ? context
      : undefined;
  if (!steps.length) return null;
  const copy = async (directory: string) => {
    if (lock.current) return;
    lock.current = true;
    const request = epoch.current;
    setCopying(directory);
    setFeedback('');
    try {
      await window.flowark.request('clipboard.copy', { value: directory });
      if (request !== epoch.current) return;
      setFailed(false);
      setFeedback('已复制快照中的原目录；请在文件管理器核对，复制不代表文件已经核验。');
    } catch (error) {
      if (request !== epoch.current) return;
      setFailed(true);
      setFeedback(error instanceof Error ? error.message : '目录复制失败，可按下方位置人工核对。');
    } finally {
      if (request === epoch.current) {
        lock.current = false;
        setCopying(undefined);
      }
    }
  };
  return (
    <section className="run-file-recovery" aria-label="文件副作用核对">
      <Alert
        type="warning"
        showIcon
        title="文件操作结果待核对"
        description="这些步骤已开始，但没有完成回执。取消不代表文件已撤回；没有已登记产物，也不能证明原目录没有文件。已提交的文件不会自动删除或恢复，不会自动重试。"
      />
      <Collapse
        key={detail.run.id}
        items={[
          {
            key: 'targets',
            label: `核对本次文件目标 · ${steps.length} 个步骤实例`,
            onKeyDown: activateCollapseWithSpace,
            children: (
              <div className="run-file-recovery-targets">
                <p>
                  来源 Run：<code>{detail.run.id}</code> · 固定版本：
                  <code>{detail.run.versionId}</code>
                </p>
                {steps.map((step) => {
                  const node = step.node;
                  const directory =
                    node &&
                    current?.files.find((entry) => entry.binding === node.binding)?.directory;
                  const name =
                    node &&
                    (typeof node.name === 'string'
                      ? node.name
                      : referenceOf(node.name) !== undefined
                        ? `引用 ${referenceOf(node.name)}（实际名称待核对）`
                        : '配置未提供可核对的文件名');
                  return (
                    <article key={step.instance}>
                      <h4>{step.pathLabel || step.instance}</h4>
                      <p>已开始 · 未取得完成记录</p>
                      <Descriptions
                        column={1}
                        size="small"
                        layout="vertical"
                        items={[
                          {
                            key: 'instance',
                            label: '步骤实例',
                            children: <code>{step.instance}</code>,
                          },
                          {
                            key: 'binding',
                            label: '目录绑定 · 固定配置',
                            children: node?.binding || '固定配置不可确定',
                          },
                          {
                            key: 'directory',
                            label: '原目录 · 快照位置',
                            children: directory || '此记录未提供可核对的目录位置',
                          },
                          {
                            key: 'name',
                            label: '文件名 · 固定配置',
                            children: name || '实际名称不可确定',
                          },
                        ]}
                      />
                      {node?.type === 'file' &&
                        node.operation === 'create' &&
                        node.version === 4 && <p>同名会使用序号；配置名称不能代表最终名称。</p>}
                      {directory && (
                        <Button
                          disabled={!!copying || undefined}
                          onClick={(event) => {
                            copyOrigin.current =
                              event.currentTarget instanceof HTMLButtonElement
                                ? event.currentTarget
                                : null;
                            void copy(directory);
                          }}
                        >
                          {copying === directory ? '正在复制…' : '复制原目录'}
                        </Button>
                      )}
                    </article>
                  );
                })}
                <p>
                  先核对原目录中的名称、内容和覆盖情况。若仍需运行，先修改当前流程的文件名或输出配置并保存，再选择“当前已保存流程”重新检查和确认。旧
                  Run 保留，不直接重放原快照。
                </p>
                <p>若有本次临时文件，请先保留并核对；清理临时文件不能撤销已经提交的目标文件。</p>
              </div>
            ),
          },
        ]}
      />
      {feedback && (
        <Alert
          type={failed ? 'error' : 'info'}
          showIcon
          title={feedback}
          role={failed ? 'alert' : 'status'}
        />
      )}
      {output && <Button onClick={output}>查看本次已登记产物</Button>}
    </section>
  );
}
