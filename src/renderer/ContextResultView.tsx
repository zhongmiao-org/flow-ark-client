import { Card, Descriptions } from 'antd';
import type { DataOutput } from '../shared/template-data';
import { contextOperations } from '../shared/template-data';
export default function ContextResultView({ value }: { value: DataOutput }) {
  return (
    <Card title={contextOperations[value.operation]} className="context-result">
      <Descriptions
        column={1}
        items={[
          { key: 'context', label: '上下文', children: value.contextId },
          {
            key: 'revision',
            label: '修订',
            children:
              value.operation === 'state.write'
                ? `${value.previousRevision} → ${value.revision}`
                : value.revision,
          },
          ...(value.operation === 'state.write'
            ? [
                { key: 'operation', label: '操作身份', children: value.operationId },
                { key: 'at', label: '已提交', children: value.committedAt },
              ]
            : []),
        ]}
      />
      <pre className="context-json" tabIndex={0} aria-label="完整配置或状态值">
        {JSON.stringify(value.value, null, 2)}
      </pre>
    </Card>
  );
}
