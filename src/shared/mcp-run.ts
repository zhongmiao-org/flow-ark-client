import type { McpToolResult } from './contracts.generated';

export type { McpToolResult };
export type McpReceipt = {
  runId: string;
  nodeId: string;
  nodeInstance: string;
  selectionId: string;
  connectionName: string;
  tool: string;
  attemptedAt: string;
  completedAt?: string;
  status: 'received' | 'tool-error' | 'not-sent' | 'unknown';
  message: string;
  result?: McpToolResult;
};
