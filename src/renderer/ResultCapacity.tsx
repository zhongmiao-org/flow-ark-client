import { Alert, Button, Card, Typography } from 'antd';
import { useId, useState } from 'react';
import { resultBytes, savedResultBudget, typedResultNames } from '../shared/typed-result-budget';
import {
  capacityReasons,
  checkedResultCapacity,
  type RunResultCapacity,
} from '../shared/result-capacity';
import './result-capacity.css';

export default function ResultCapacity({
  entries,
  runId,
  capacity,
  readableCount,
}: {
  entries: ReadonlyArray<{ type: string; bytes: number }>;
  runId: string;
  capacity: unknown;
  readableCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  let budget: ReturnType<typeof savedResultBudget>;
  let checked: RunResultCapacity;
  try {
    checked = checkedResultCapacity(capacity, runId, entries);
    if (checked.status === 'unavailable')
      return (
        <Alert
          type="warning"
          showIcon
          title="完整结果保存空间暂时无法核对"
          description={`${capacityReasons[checked.reason]}。保留原运行与独立回执；不采用不完整结果，不自动修复或重放。`}
        />
      );
    budget = savedResultBudget(entries);
    if (!Number.isSafeInteger(readableCount) || readableCount < 0 || readableCount > checked.count)
      throw Error('可读结果范围无法核对');
  } catch {
    return <Alert type="warning" showIcon title="完整结果保存空间暂时无法核对，请保留原运行记录" />;
  }
  const retained = checked.policy === 'run-owned-results-v1';
  return (
    <Card className="result-capacity" aria-label="完整结果保存空间">
      <div className="result-capacity-group">
        <Typography.Text type="secondary">完整结果保存空间</Typography.Text>
        <p>
          已保存 {checked.count} / {checked.limits.count} 项 · 完整内容累计{' '}
          {resultBytes(checked.logicalBytes)}
        </p>
        <p>
          {retained ? '实际保留' : '原运行完整值计量'} {resultBytes(checked.retainedBytes)} /{' '}
          {resultBytes(checked.limits.retainedBytes)}
        </p>
        <Button
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起保存明细' : '查看保存明细'}
        </Button>
      </div>
      <div id={detailsId} hidden={!expanded} className="result-capacity-group">
        <Typography.Text type="secondary">完整内容分类 · 全部已保存结果</Typography.Text>
        <ul className="result-capacity-breakdown">
          {budget.groups.map((group) => (
            <li key={group.type}>
              {typedResultNames[group.type] ?? '其他已保存结果'} · {group.count} 项 ·{' '}
              {resultBytes(group.bytes)}
            </li>
          ))}
        </ul>
        {checked.policy === 'run-owned-results-v1' && (
          <p>
            结果目录与共享内容 {resultBytes(checked.catalogBytes)} · 原值回执副本{' '}
            {checked.copyCount} 项 / {resultBytes(checked.copyBytes)}
          </p>
        )}
        <p>
          当前余量 {checked.limits.count - checked.count} 项 ·{' '}
          {resultBytes(checked.limits.retainedBytes - checked.retainedBytes)}。
          {retained
            ? '相同内容只在本次运行内复用；实际保留包括目录、索引和原值回执副本。'
            : '此运行沿用原完整值计量，重复结果分别计入；不会转换或清理历史。'}
          不是数据库文件大小。
        </p>
      </div>
      <Typography.Paragraph type="secondary" className="result-capacity-note">
        当前可读 {readableCount} 项；统计包含全部已保存结果，可读范围遵循原运行状态。
        {readableCount === 0 &&
          (checked.count === 0
            ? '当前没有可阅读的完整结果，可返回运行详情查看执行情况。'
            : '已保存内容保持不变，当前运行状态下尚无可阅读的完整结果。')}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" className="result-capacity-note">
        当前余量尚未预留给后续步骤。显示容量不代表可以安全提交下一项。
      </Typography.Paragraph>
    </Card>
  );
}
