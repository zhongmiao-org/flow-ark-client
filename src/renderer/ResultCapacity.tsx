import { Alert, Button, Card, Typography } from 'antd';
import { useId, useState } from 'react';
import {
  resultBytes,
  savedResultBudget,
  TYPED_RESULT_LIMITS,
  typedResultNames,
} from '../shared/typed-result-budget';
import './result-capacity.css';

export default function ResultCapacity({
  entries,
}: {
  entries: ReadonlyArray<{ type: string; bytes: number }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  let budget: ReturnType<typeof savedResultBudget>;
  try {
    budget = savedResultBudget(entries);
  } catch {
    return <Alert type="warning" showIcon title="结果容量暂时无法核对，请保留原运行记录" />;
  }
  return (
    <Card className="result-capacity" aria-label="结构化结果容量">
      <div className="result-capacity-group">
        <Typography.Text type="secondary">结构化结果容量</Typography.Text>
        <p>
          已保存 {budget.count} / {TYPED_RESULT_LIMITS.count} 项 · {resultBytes(budget.bytes)} /{' '}
          {resultBytes(TYPED_RESULT_LIMITS.bytes)}
        </p>
        <Button
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起容量明细' : '查看容量明细'}
        </Button>
      </div>
      <div id={detailsId} hidden={!expanded} className="result-capacity-group">
        <Typography.Text type="secondary">容量分类明细</Typography.Text>
        <ul className="result-capacity-breakdown">
          {budget.groups.map((group) => (
            <li key={group.type}>
              {typedResultNames[group.type] ?? '其他已保存结果'} · {group.count} 项 ·{' '}
              {resultBytes(group.bytes)}
            </li>
          ))}
        </ul>
        <p>
          当前余量 {budget.remainingCount} 项 · {resultBytes(budget.remainingBytes)}。
          逐项累计完整值的 UTF-8 字节，重复结果分别计入；只计已保存项，不是数据库文件大小。
        </p>
      </div>
      <Typography.Paragraph type="secondary" className="result-capacity-note">
        当前余量尚未预留给后续步骤。显示容量不代表可以安全提交下一项。
      </Typography.Paragraph>
    </Card>
  );
}
