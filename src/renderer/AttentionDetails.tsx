import type { Attention } from '../shared/types';
import './attention-workspace.css';

const detailLabels: Record<string, string> = {
  description: '请求内容',
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
export default function AttentionDetails({ item }: { item: Attention }) {
  const entries = Object.entries(item.detail ?? {}).filter(
    ([key]) => !['schema', 'answered'].includes(key),
  );
  return (
    <>
      <dl className="attention-facts">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{detailLabels[key] ?? key}</dt>
            <dd>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</dd>
          </div>
        ))}
      </dl>
      {!entries.length && <p className="attention-muted">该提醒没有附加说明。</p>}
      <details className="attention-raw">
        <summary>查看原始详情</summary>
        <pre>{JSON.stringify(item.detail, null, 2)}</pre>
      </details>
    </>
  );
}
