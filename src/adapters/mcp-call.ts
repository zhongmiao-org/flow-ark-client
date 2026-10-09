import type { ConnectionConfig } from '../shared/tool-connections';
import type { McpToolResult } from '../shared/mcp-run';
import { validateObject } from '../core/validate';
import { withMcpSession, DiscoveryError } from './mcp-discovery';

function resultWithinLimits(value: unknown) {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++count > 4096 || entry.depth > 20) throw new DiscoveryError('工具回复超过内容或层级限制');
    if (typeof entry.value === 'number' && !Number.isFinite(entry.value))
      throw new DiscoveryError('工具回复包含无效的 JSON 数值');
    if (entry.value && typeof entry.value === 'object') {
      const children = Object.values(entry.value);
      if (count + pending.length + children.length > 4096)
        throw new DiscoveryError('工具回复超过内容限制');
      for (const value of children) pending.push({ value, depth: entry.depth + 1 });
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
    throw new DiscoveryError('工具回复超过 1 MiB');
}

/** One owned session, one tools/call, no high-level SDK retry helper. */
export function callMcp(input: {
  config: ConnectionConfig;
  token?: string;
  signal: AbortSignal;
  capabilityDigest: string;
  tool: string;
  arguments: Record<string, unknown>;
  timeoutMs: number;
  beforeSend: () => void;
}): Promise<McpToolResult> {
  return withMcpSession(
    input.config,
    input.token,
    input.signal,
    { timeoutMs: input.timeoutMs },
    async (client, discovery, signal) => {
      if (discovery.capabilityDigest !== input.capabilityDigest)
        throw new DiscoveryError('服务能力已变化，请重新连接并核对工具');
      if (!discovery.tools.some((tool) => tool.name === input.tool))
        throw new DiscoveryError('本次核对的工具已不存在');
      signal.throwIfAborted();
      input.beforeSend();
      const reply = await client.request(
        { method: 'tools/call', params: { name: input.tool, arguments: input.arguments } },
        { signal, timeout: input.timeoutMs },
      );
      signal.throwIfAborted();
      resultWithinLimits(reply);
      if (
        !Array.isArray(reply.content) ||
        reply.content.length > 64 ||
        (reply.structuredContent !== undefined &&
          (!reply.structuredContent ||
            typeof reply.structuredContent !== 'object' ||
            Array.isArray(reply.structuredContent))) ||
        (input.token && JSON.stringify(reply).includes(input.token))
      )
        throw new DiscoveryError('工具回复不符合本机支持范围，已拒绝保存原始内容');
      return validateObject<McpToolResult>('McpToolResult', {
        version: 1,
        content: reply.content,
        isError: reply.isError === true,
        ...(reply.structuredContent !== undefined
          ? { structuredContent: reply.structuredContent as Record<string, any> }
          : {}),
      });
    },
  );
}
