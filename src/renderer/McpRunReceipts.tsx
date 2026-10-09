import { mcpReceiptsForRun } from './mcp-run-presentation';
import type { McpReceipt } from '../shared/mcp-run';
import type { Flow } from '../shared/types';
import { flatten } from './flow-editing';
import './mcp-run.css';

const titles = {
  received: '已收到服务回复',
  'tool-error': '服务返回工具错误',
  'not-sent': '本次未发送调用',
  unknown: '结果尚未确认',
};
export default function McpRunReceipts({
  runId,
  receipts,
  snapshot,
  running = false,
}: {
  runId: string;
  receipts?: McpReceipt[];
  snapshot?: Flow;
  running?: boolean;
}) {
  const nodes = flatten(snapshot?.steps ?? []);
  const selected = mcpReceiptsForRun(runId, receipts, snapshot);
  if (!selected.length) return null;
  return (
    <section className="ai-task-card mcp-run-receipts" aria-label="工具调用回执">
      <h2>工具调用回执</h2>
      <p>逐项核对服务回复。收到回复不代表外部业务已完成，查看此页不会再次调用。</p>
      {selected.map((receipt, index) => {
        const node = nodes.find((node) => node.id === receipt.nodeId);
        const status = receipt.status;
        const waiting = status === 'unknown' && !receipt.completedAt && running;
        const result = ['received', 'tool-error'].includes(status) ? receipt.result : undefined;
        const texts =
          result?.content.filter((item) => item.type === 'text' && typeof item.text === 'string') ??
          [];
        const rich = (result?.content.length ?? 0) - texts.length;
        return (
          <article key={receipt.nodeInstance + ':' + index} data-mcp-result={status}>
            <div className="mcp-receipt-heading">
              <h3>{typeof node?.name === 'string' ? node.name : receipt.tool}</h3>
              <span className={'mcp-receipt-status is-' + (waiting ? 'waiting' : status)}>
                {waiting ? '正在等待服务回复' : titles[status]}
              </span>
            </div>
            <p>
              {receipt.connectionName} · <code>{receipt.tool}</code>
            </p>
            <p role={status === 'unknown' && !waiting ? 'alert' : 'status'}>
              {waiting ? '调用尝试已保存，等待服务回复和会话关闭；未自动重试。' : receipt.message}
            </p>
            {status === 'unknown' && !waiting && (
              <p>操作可能已经发生。请先到原服务核对，再决定是否从头创建新的运行。</p>
            )}
            {result && <p>以下回复已脱敏；文本字段最多展示 4000 个字符，较长内容为节选。</p>}
            {texts.map((item, i) => (
              <pre key={i} tabIndex={0} aria-label={`服务文本 ${i + 1}`}>
                {String(item.text)}
              </pre>
            ))}
            {result?.structuredContent !== undefined && (
              <details>
                <summary>查看结构化结果</summary>
                <pre tabIndex={0}>{JSON.stringify(result.structuredContent, null, 2)}</pre>
              </details>
            )}
            {rich > 0 && (
              <p>另有 {rich} 项富内容，保留在完整回复中；未自动打开链接、下载资源或播放媒体。</p>
            )}
            {result && (
              <details>
                <summary>查看完整回执内容</summary>
                <pre tabIndex={0} aria-label="完整回执内容">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            )}
            <p className="mcp-receipt-time">
              尝试时间：{new Date(receipt.attemptedAt).toLocaleString('zh-CN')}
              {receipt.completedAt &&
                ` · 回执时间：${new Date(receipt.completedAt).toLocaleString('zh-CN')}`}
            </p>
            <p className="mcp-receipt-time">
              步骤实例：<code>{receipt.nodeInstance}</code>
            </p>
          </article>
        );
      })}
    </section>
  );
}
