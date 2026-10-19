import { Card, Collapse, Descriptions } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { activateCollapseWithSpace } from './collapseKeyboard';
import type { TaskDetail } from '../shared/planning';
import { flatten } from './flow-editing';
import PlanningChanges from './PlanningChanges';
import { taskStepSummary } from './task-step-presentation';
import './task-proposal-review.css';

/** Host-computed differences are authoritative; this component only presents them. */
export default function TaskProposalReview({
  detail,
  actions,
}: {
  detail: TaskDetail;
  actions?: ReactNode;
}) {
  const proposal = detail.proposal;
  const before = proposal?.baseFlow;
  const after = proposal?.result.kind === 'plan' ? proposal.result.flow : null;

  const affected = new Set(
    detail.changes.flatMap((change) => (change.nodeId ? [change.nodeId] : [])),
  );
  const settings = detail.changes.filter((change) => !change.nodeId).length;
  const addedSteps = new Set(
    detail.changes
      .filter((change) => change.kind === 'added' && change.nodeId)
      .map((change) => change.nodeId),
  ).size;
  const removedSteps = new Set(
    detail.changes
      .filter((change) => change.kind === 'removed' && change.nodeId)
      .map((change) => change.nodeId),
  ).size;
  const added =
    after?.requiredCapabilities.filter((name) => !before?.requiredCapabilities.includes(name)) ??
    [];
  const removed =
    before?.requiredCapabilities.filter((name) => !after?.requiredCapabilities.includes(name)) ??
    [];
  const oldSteps = flatten(before?.steps ?? []);
  const newSteps = flatten(after?.steps ?? []);
  const affectedId = [...affected][0];
  const oldIndex = oldSteps.findIndex((step) => step.id === affectedId);
  const newIndex = newSteps.findIndex((step) => step.id === affectedId);
  const oldStep = oldSteps[oldIndex];
  const newStep = newSteps[newIndex];
  const conditionOnly =
    affected.size === 1 &&
    !settings &&
    !added.length &&
    !removed.length &&
    oldStep &&
    newStep &&
    oldStep.type === newStep.type &&
    ['condition', 'assert'].includes(oldStep.type) &&
    detail.changes.every(
      (change) =>
        change.kind === 'changed' &&
        ['actual', 'operator', 'expected', 'name'].includes(change.path.split('/').at(-1)!),
    );
  const defaultCapabilitiesExpanded = !conditionOnly;
  const [capabilitiesExpanded, setCapabilitiesExpanded] = useState(defaultCapabilitiesExpanded);
  useEffect(() => {
    setCapabilitiesExpanded(defaultCapabilitiesExpanded);
  }, [defaultCapabilitiesExpanded]);
  if (!proposal || !before || !after) return null;
  const changes = (
    <PlanningChanges
      prioritizeDetail
      changes={detail.changes}
      before={before}
      after={after}
      revision={proposal.baseRevision}
    />
  );
  return (
    <div
      className={`task-proposal-review${conditionOnly ? ' is-condition-review' : ''}`}
      aria-label="完整方案修改核对"
    >
      <header>
        <h2 tabIndex={-1} data-proposal-diff-heading>
          修改范围 · {conditionOnly ? `1 / ${newSteps.length} 步` : `${affected.size} 个步骤`}
        </h2>
        <span>待采纳</span>
      </header>
      {conditionOnly ? (
        <>
          <div className="task-condition-comparison" aria-label="条件修改对照">
            {[
              { step: oldStep, index: oldIndex, flow: before, side: 'before', label: '原条件' },
              { step: newStep, index: newIndex, flow: after, side: 'after', label: '新条件' },
            ].map(({ step, index, flow, side, label }) => (
              <section key={side}>
                <Card
                  size="small"
                  className={`task-condition-card planning-change-${side}`}
                  styles={{ body: { padding: 16 } }}
                >
                  <h3>{label}</h3>
                  <p>
                    第 {index + 1} 步 · {taskStepSummary(step, flow)}
                  </p>
                </Card>
              </section>
            ))}
          </div>
          <p>保持原配置：其余 {newSteps.length - 1} 个步骤。对象与权限请展开核对。</p>
          {actions}
          <Collapse
            className="task-proposal-condition-details"
            items={[
              {
                key: 'changes',
                forceRender: true,
                onKeyDown: activateCollapseWithSpace,
                label: <>展开逐项差异 · {detail.changes.length} 项</>,
                children: <>{changes}</>,
              },
            ]}
          />
        </>
      ) : (
        <>
          <p>
            原草稿 {oldSteps.length} 步 → 新方案 {newSteps.length} 步；共 {detail.changes.length}{' '}
            项差异{settings ? `，其中 ${settings} 项流程设置变化` : ''}。
          </p>
          {!!(addedSteps || removedSteps) && (
            <p>
              其中新增 {addedSteps} 个、删除 {removedSteps} 个，其余{' '}
              {affected.size - addedSteps - removedSteps} 个步骤的配置或位置有调整。
            </p>
          )}
          {changes}
        </>
      )}
      <Collapse
        className="task-proposal-capability-details"
        activeKey={capabilitiesExpanded ? ['capabilities'] : []}
        onChange={(keys) => setCapabilitiesExpanded(keys.includes('capabilities'))}
        items={[
          {
            key: 'capabilities',
            forceRender: true,
            onKeyDown: activateCollapseWithSpace,
            label: <>核对资源与能力</>,
            children: (
              <>
                <section className="task-proposal-permissions" aria-label="方案资源与能力变化">
                  <h3>资源与能力变化</h3>
                  {added.length || removed.length ? (
                    <ul>
                      {!!added.length && <li>新增声明能力：{added.join('、')}</li>}
                      {!!removed.length && <li>移除声明能力：{removed.join('、')}</li>}
                    </ul>
                  ) : (
                    <p>声明的能力集合没有变化；步骤参数和实际影响仍需逐项核对。</p>
                  )}
                  <p>
                    能力声明不等于授权。采纳不会替你授予新权限，试运行前还需检查对象与实际读写范围。
                  </p>
                  <Collapse
                    items={[
                      {
                        key: 'resources',
                        forceRender: true,
                        onKeyDown: activateCollapseWithSpace,
                        label: <>查看新方案需要的全部资源</>,
                        children: (
                          <>
                            <ul>
                              {detail.resources.map((resource, index) => (
                                <li key={index}>{resource}</li>
                              ))}
                              {!detail.resources.length && (
                                <li>没有文件、浏览器、HTTP、脚本或工具资源操作。</li>
                              )}
                            </ul>
                            <p>声明的能力：{after?.requiredCapabilities.join('、') || '无'}</p>
                          </>
                        ),
                      },
                    ]}
                  />
                </section>
              </>
            ),
          },
        ]}
      />
      <Collapse
        className="task-proposal-source"
        items={[
          {
            key: 'source',
            forceRender: true,
            onKeyDown: activateCollapseWithSpace,
            label: <>查看提案来源与基线（高级诊断）</>,
            children: (
              <>
                <Descriptions
                  className="metadata-facts"
                  bordered
                  size="small"
                  column={1}
                  items={[
                    { key: 'revision', label: '任务基线修订', children: proposal.baseRevision },
                    { key: 'proposal', label: '提案', children: proposal.id },
                    { key: 'hash', label: '基线摘要', children: proposal.baseFlowHash },
                    { key: 'before', label: '原草稿', children: before.name },
                    { key: 'after', label: '新方案', children: after.name },
                  ]}
                />
              </>
            ),
          },
        ]}
      />
      {!conditionOnly && actions}
    </div>
  );
}
