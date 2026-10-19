import TechnicalDetails from './TechnicalDetails';
import { Card, Collapse, Descriptions } from 'antd';
import type { DataOutput } from '../shared/template-data';
import { contextOperations } from '../shared/template-data';
import ReadonlyValue from './ReadonlyValue';
import { activateCollapseWithSpace } from './collapseKeyboard';
export default function ContextResultView({ value }: { value: DataOutput }) {
  return (
    <Card title={contextOperations[value.operation]} className="context-result">
      <Descriptions
        column={1}
        items={[
          { key: 'context', label: '范围', children: '本次运行的共享配置与状态' },
          {
            key: 'revision',
            label: '修订',
            children:
              value.operation === 'state.write'
                ? `${value.previousRevision} → ${value.revision}`
                : value.revision,
          },
          ...(value.operation === 'state.write'
            ? [{ key: 'at', label: '已提交', children: value.committedAt }]
            : []),
        ]}
      />
      <TechnicalDetails
        items={[
          { label: '上下文 ID', value: value.contextId },
          {
            label: '操作 ID',
            value: value.operation === 'state.write' ? value.operationId : undefined,
          },
        ]}
      />
      <ReadonlyValue value={value.value} />
      <Collapse
        key={`${value.contextId}:${value.operation}:${value.revision}`}
        items={[
          {
            key: 'context-source',
            label: '原始配置或状态（高级，可选）',
            onKeyDown: activateCollapseWithSpace,
            children: (
              <pre className="context-json" tabIndex={0} aria-label="完整配置或状态值">
                {JSON.stringify(value.value, null, 2)}
              </pre>
            ),
          },
        ]}
      />
    </Card>
  );
}
