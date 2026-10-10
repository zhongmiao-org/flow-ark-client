import { Collapse, Descriptions } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import type { Attention } from '../shared/types';
import './attention-workspace.css';

const detailLabels: Record<string, string> = {
  description: '请求内容',
  review: '本次核对目标与内容',
  reason: '原因',
  message: '说明',
  error: '错误信息',
  runId: '来源运行',
  runIds: '相关运行',
  effectId: '操作记录',
  value: '内容',
  name: '名称',
  contact: '联系人',
  source: '来源',
  url: '网页地址',
};
export default function AttentionDetails({
  item,
  omitRunReferences = false,
}: {
  item: Attention;
  omitRunReferences?: boolean;
}) {
  const entries = Object.entries(item.detail ?? {}).filter(
    ([key]) =>
      !['schema', 'answered'].includes(key) &&
      !(omitRunReferences && ['runId', 'runIds'].includes(key)),
  );
  return (
    <>
      {!!entries.length && (
        <Descriptions
          className="attention-facts"
          colon={false}
          layout="vertical"
          column={1}
          items={entries.map(([key, value]) => ({
            key,
            label: detailLabels[key] ?? key,
            children: (
              <span className="attention-fact-value">
                {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
              </span>
            ),
          }))}
        />
      )}
      {!entries.length && (
        <p className="attention-muted">
          {omitRunReferences
            ? '请逐项查看关联运行，核对已保存的结果与外部操作。'
            : '该提醒没有附加说明。'}
        </p>
      )}
      <Collapse
        className="attention-raw"
        size="small"
        items={[
          {
            key: 'raw',
            label: '查看原始详情',
            forceRender: true,
            onKeyDown: activateCollapseWithSpace,
            children: (
              <pre tabIndex={0} aria-label="原始提醒详情">
                {JSON.stringify(item.detail, null, 2)}
              </pre>
            ),
          },
        ]}
      />
    </>
  );
}
