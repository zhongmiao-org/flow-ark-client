import { Alert, Tag } from 'antd';
import { desktopReceiptColors } from './theme';
import type { DesktopReceipt } from '../shared/desktop-run';
import type { Flow } from '../shared/types';
import { flatten } from './flow-editing';
import { verifiedDesktopReceipt } from './desktop-run-presentation';
import './desktop-run.css';

export default function DesktopRunReceipt({
  runId,
  receipts,
  snapshot,
}: {
  runId: string;
  receipts?: DesktopReceipt[];
  snapshot?: Flow;
}) {
  const nodes = flatten(snapshot?.steps ?? []);
  const selected = receipts?.filter((receipt) => receipt.runId === runId) ?? [];
  const items = selected.map((receipt): DesktopReceipt => {
    const node = nodes.find((item) => item.id === receipt.nodeId);
    if (
      (receipt.status === 'verified' &&
        (!verifiedDesktopReceipt(receipt, node) ||
          selected.filter((item) => item.nodeId === receipt.nodeId).length !== 1)) ||
      (receipt.status === 'not-written' && (!receipt.completedAt || node?.type !== 'desktop'))
    )
      return {
        ...receipt,
        status: 'unknown',
        message: '回执与本次固定方案未能核对一致，请人工检查文档结果；未自动重试。',
      };
    return receipt;
  });
  if (!items.length) return null;
  return (
    <section className="ai-task-card desktop-run-receipt" aria-label="应用修改回执">
      <h2>应用修改回执</h2>
      {items.map((receipt, index) => (
        <div key={receipt.nodeId + ':' + index} data-desktop-result={receipt.status}>
          <Tag className="run-state-tag" color={desktopReceiptColors[receipt.status]}>
            {receipt.status === 'verified'
              ? '选区文字已替换并回读一致'
              : receipt.status === 'not-written'
                ? '本次没有发出文字修改'
                : '修改结果尚未确认，请人工核对'}
          </Tag>
          <Alert
            className="desktop-receipt-feedback"
            type={
              receipt.status === 'unknown'
                ? 'warning'
                : receipt.status === 'verified'
                  ? 'success'
                  : 'info'
            }
            role={receipt.status === 'unknown' ? 'alert' : 'status'}
            showIcon
            title={receipt.message}
          />
          {receipt.status === 'verified' ? (
            <>
              <div className="desktop-run-texts">
                <div>
                  <h3>修改前</h3>
                  <pre tabIndex={0}>{receipt.original}</pre>
                </div>
                <div>
                  <h3>本次回读</h3>
                  <pre tabIndex={0}>{receipt.readback}</pre>
                </div>
              </div>
              <p>此回执仅核对当时的文档缓冲区，未自动保存文件；之后的文档变化不会自动更新这里。</p>
            </>
          ) : receipt.status === 'unknown' ? (
            <p>文档可能已经改变。取消或中断状态不能证明原文未改；请到原窗口检查，未自动重试。</p>
          ) : (
            <p>请回到原任务重新选择窗口与原文，再决定是否创建新的试运行。</p>
          )}
          <p className="task-desktop-observed">
            尝试时间：{new Date(receipt.attemptedAt).toLocaleString('zh-CN')}
            {receipt.completedAt
              ? ` · 回执时间：${new Date(receipt.completedAt).toLocaleString('zh-CN')}`
              : ' · 尚未取得最终回执'}
          </p>
        </div>
      ))}
    </section>
  );
}
