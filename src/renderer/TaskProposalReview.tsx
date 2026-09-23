import type { TaskDetail } from '../shared/planning';
import { flatten } from './flow-editing';
import PlanningChanges from './PlanningChanges';
import './task-proposal-review.css';

/** Host-computed differences are authoritative; this component only presents them. */
export default function TaskProposalReview({ detail }: { detail: TaskDetail }) {
  const proposal = detail.proposal;
  if (!proposal?.baseFlow || proposal.result.kind !== 'plan' || !proposal.result.flow) return null;
  const before = proposal.baseFlow;
  const after = proposal.result.flow;
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
  const added = after.requiredCapabilities.filter(
    (name) => !before.requiredCapabilities.includes(name),
  );
  const removed = before.requiredCapabilities.filter(
    (name) => !after.requiredCapabilities.includes(name),
  );
  return (
    <div className="task-proposal-review" aria-label="完整方案修改核对">
      <header>
        <h2 tabIndex={-1} data-proposal-diff-heading>
          修改范围 · {affected.size} 个步骤
        </h2>
        <span>待采纳</span>
      </header>
      <p>
        原草稿 {flatten(before.steps).length} 步 → 新方案 {flatten(after.steps).length} 步；共{' '}
        {detail.changes.length} 项差异{settings ? `，其中 ${settings} 项流程设置变化` : ''}。
      </p>
      {!!(addedSteps || removedSteps) && (
        <p>
          其中新增 {addedSteps} 个、删除 {removedSteps} 个，其余{' '}
          {affected.size - addedSteps - removedSteps} 个步骤的配置或位置有调整。
        </p>
      )}
      <PlanningChanges
        prioritizeDetail
        changes={detail.changes}
        before={before}
        after={after}
        revision={proposal.baseRevision}
      />
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
        <p>能力声明不等于授权。采纳不会替你授予新权限，试运行前还需检查对象与实际读写范围。</p>
        <details>
          <summary>查看新方案需要的全部资源</summary>
          <ul>
            {detail.resources.map((resource, index) => (
              <li key={index}>{resource}</li>
            ))}
            {!detail.resources.length && <li>没有文件、浏览器、HTTP、脚本或工具资源操作。</li>}
          </ul>
          <p>声明的能力：{after.requiredCapabilities.join('、') || '无'}</p>
        </details>
      </section>
      <details className="task-proposal-source">
        <summary>查看提案来源与基线</summary>
        <p>
          任务基线修订 {proposal.baseRevision} · 提案 {proposal.id}
        </p>
        <p>基线摘要：{proposal.baseFlowHash}</p>
        <p>
          原草稿：{before.name} · 新方案：{after.name}
        </p>
      </details>
    </div>
  );
}
