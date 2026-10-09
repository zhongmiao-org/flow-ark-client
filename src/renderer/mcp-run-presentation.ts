import type { McpReceipt } from '../shared/mcp-run';
import type { Flow } from '../shared/types';
import { flatten } from './flow-editing';

export function mcpReceiptsForRun(runId: string, receipts: McpReceipt[] = [], snapshot?: Flow) {
  const nodes = flatten(snapshot?.steps ?? []);
  const selected = receipts.filter((receipt) => receipt.runId === runId);
  return selected.map((receipt): McpReceipt => {
    const node = nodes.find((node) => node.id === receipt.nodeId);
    const matches =
      node?.type === 'mcp' &&
      node.tool === receipt.tool &&
      node.target === receipt.selectionId &&
      selected.filter((item) => item.nodeInstance === receipt.nodeInstance).length === 1;
    const validReply =
      receipt.completedAt &&
      receipt.result?.version === 1 &&
      Array.isArray(receipt.result.content) &&
      (receipt.status === 'received'
        ? receipt.result.isError === false
        : receipt.result.isError === true);
    if (
      !matches ||
      (['received', 'tool-error'].includes(receipt.status) && !validReply) ||
      (receipt.status === 'not-sent' && !receipt.completedAt)
    )
      return {
        ...receipt,
        status: 'unknown',
        result: undefined,
        message: '回执与本次固定方案未能核对一致，请人工检查原服务中的结果。',
      };
    return receipt;
  });
}
