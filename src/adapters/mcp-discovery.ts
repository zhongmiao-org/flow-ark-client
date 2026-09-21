import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
  type Tool,
} from '@modelcontextprotocol/client';
import {
  connectionConfig,
  type ConnectionConfig,
  type ConnectionDiscovery,
  type ToolDefinition,
} from '../shared/tool-connections';
import { digest, now } from '../shared/utils';
import { McpStdio } from './mcp-stdio';

const RESPONSE_LIMIT = 2 * 1024 * 1024;
export class DiscoveryError extends Error {}
export class McpCleanupError extends Error {}
// Modern HTTP tools may mirror statically reachable primitive arguments into
// headers. Reject an invalid declaration instead of advertising a partial list.
function checkHeaders(schema: Record<string, unknown>) {
  const names = new Set<string>();
  const maps = new Set(['patternProperties', 'dependentSchemas', '$defs', 'definitions']);
  const branches = [
    'items',
    'prefixItems',
    'contains',
    'additionalProperties',
    'unevaluatedProperties',
    'unevaluatedItems',
    'propertyNames',
    'oneOf',
    'anyOf',
    'allOf',
    'not',
    'if',
    'then',
    'else',
    ...maps,
  ];
  const pending: { value: any; reachable: boolean; property: boolean }[] = [
    { value: schema, reachable: true, property: false },
  ];
  while (pending.length) {
    const { value, reachable, property } = pending.pop()!;
    if (!value || typeof value !== 'object') continue;
    if ('x-mcp-header' in value) {
      const header = value['x-mcp-header'];
      if (
        !reachable ||
        !property ||
        typeof header !== 'string' ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header) ||
        !['string', 'integer', 'boolean'].includes(value.type) ||
        names.has(header.toLowerCase())
      )
        throw new DiscoveryError('工具包含无效的请求头声明，请联系服务提供者核对');
      names.add(header.toLowerCase());
    }
    if (value.properties && typeof value.properties === 'object')
      for (const child of Object.values(value.properties))
        pending.push({ value: child, reachable, property: true });
    for (const key of branches) {
      const child = value[key];
      if (!child || typeof child !== 'object') continue;
      const children = Array.isArray(child) || maps.has(key) ? Object.values(child) : [child];
      for (const value of children) pending.push({ value, reachable: false, property: false });
    }
  }
}
function safeTool(tool: Tool): ToolDefinition {
  if (
    !tool.name ||
    tool.name.length > 128 ||
    (tool.description?.length ?? 0) > 8000 ||
    (tool.title?.length ?? 0) > 200 ||
    Buffer.byteLength(JSON.stringify(tool)) > 65536
  )
    throw new DiscoveryError('工具名称、说明或 Schema 超过限制');
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations
      ? {
          annotations: {
            readOnlyHint: tool.annotations.readOnlyHint,
            destructiveHint: tool.annotations.destructiveHint,
            idempotentHint: tool.annotations.idempotentHint,
            openWorldHint: tool.annotations.openWorldHint,
          },
        }
      : {}),
  };
}
export async function discoverMcp(
  config: ConnectionConfig,
  token: string | undefined,
  signal: AbortSignal,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<ConnectionDiscovery> {
  connectionConfig.parse(config);
  const auth = config.transport.type === 'http' && config.transport.auth === 'bearer';
  if (auth && (!token || !/^[\x21-\x7e]{1,8192}$/.test(token)))
    throw new Error('请提供 Bearer Token');
  if (!auth && token) throw new Error('此连接不接受 Bearer Token');
  const abort = new AbortController();
  const combined = AbortSignal.any([signal, abort.signal]);
  const timeout = setTimeout(() => abort.abort(), options.timeoutMs ?? 30000);
  const client = new Client(
    { name: 'flowark', version: '0.3.0' },
    {
      capabilities: {},
      inputRequired: { autoFulfill: false },
      versionNegotiation: {
        mode: config.protocolVersion === '2026-07-28' ? { pin: '2026-07-28' } : 'legacy',
      },
    },
  );
  let transportFault = false;
  let transportError: DiscoveryError | undefined;
  const rejectTransport = (message: string): never => {
    throw (transportError = new DiscoveryError(message));
  };
  client.onerror = () => {
    transportFault = true;
    abort.abort();
  };
  const boundedFetch: FetchLike = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (
      config.transport.type !== 'http' ||
      new URL(url).href !== new URL(config.transport.url).href
    )
      rejectTransport('连接请求偏离已确认的地址');
    const response = await (options.fetcher ?? fetch)(input as any, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.any([combined, ...(init?.signal ? [init.signal] : [])]),
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      rejectTransport('认证失败或权限不足，请核对当前连接');
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      rejectTransport('服务要求重定向，请核对并显式填写最终地址');
    }
    if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT) {
      await response.body?.cancel();
      rejectTransport('MCP 响应超过 2 MiB');
    }
    if (!response.body) return response;
    let received = 0;
    const limited = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > RESPONSE_LIMIT) rejectTransport('MCP 响应超过 2 MiB');
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(limited, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  const transport =
    config.transport.type === 'stdio'
      ? new McpStdio(config.transport.command, config.transport.args)
      : new StreamableHTTPClientTransport(new URL(config.transport.url), {
          fetch: boundedFetch,
          authProvider: auth ? { token: async () => token! } : undefined,
          onInsufficientScope: 'throw',
          reconnectionOptions: {
            maxRetries: 0,
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1,
          },
        });
  let closeFailure: unknown;
  const close = () => {
    void transport.close().catch((e) => {
      closeFailure = e;
    });
  };
  combined.addEventListener('abort', close, { once: true });
  try {
    combined.throwIfAborted();
    await client.connect(transport, { signal: combined, timeout: options.timeoutMs ?? 30000 });
    if (client.getNegotiatedProtocolVersion() !== config.protocolVersion)
      throw new DiscoveryError('服务协议版本与所选版本不一致');
    const identity = client.getServerVersion();
    if (identity && (identity.name.length > 200 || identity.version.length > 100))
      throw new DiscoveryError('服务身份超过限制');
    const tools: ToolDefinition[] = [];
    const names = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | undefined;
    if (client.getServerCapabilities()?.tools) {
      do {
        combined.throwIfAborted();
        // The high-level SDK helper auto-aggregates and silently truncates a
        // repeated cursor. Fetch raw typed pages so incomplete discovery fails.
        const page = await client.request(
          { method: 'tools/list', params: cursor ? { cursor } : {} },
          {
            signal: combined,
            timeout: options.timeoutMs ?? 30000,
          },
        );
        for (const item of page.tools) {
          if (config.transport.type === 'http' && config.protocolVersion === '2026-07-28')
            checkHeaders(item.inputSchema);
          if (names.has(item.name)) throw new DiscoveryError('服务返回重复工具名称');
          names.add(item.name);
          tools.push(safeTool(item));
          if (tools.length > 100 || Buffer.byteLength(JSON.stringify(tools)) > 1024 * 1024)
            throw new DiscoveryError('工具数量或总内容超过限制');
        }
        cursor = page.nextCursor;
        if (cursor && (cursor.length > 2000 || cursors.has(cursor) || cursors.size >= 7))
          throw new DiscoveryError('工具列表分页无效或超过限制');
        if (cursor) cursors.add(cursor);
      } while (cursor);
    }
    combined.throwIfAborted();
    const result = {
      server: identity ? { name: identity.name, version: identity.version } : null,
      protocolVersion: config.protocolVersion,
      tools,
    };
    if (token && JSON.stringify(result).includes(token))
      throw new DiscoveryError('服务响应包含认证内容，已拒绝保存');
    return { ...result, capabilityDigest: digest(result), testedAt: now() };
  } catch (error) {
    if (transportError) throw transportError;
    if (error instanceof DiscoveryError) throw error;
    if (signal.aborted) throw new Error('连接发现已取消');
    if (transportFault) throw new Error('MCP 连接返回无效消息或已断开');
    if (combined.aborted) throw new Error('连接发现超时，请核对服务后重试');
    throw new Error('MCP 连接或能力发现失败，请核对来源、协议与认证');
  } finally {
    clearTimeout(timeout);
    combined.removeEventListener('abort', close);
    try {
      await client.close();
      await transport.close();
    } catch (error) {
      closeFailure = error;
    }
    if (closeFailure)
      throw new McpCleanupError('无法确认 MCP 连接已关闭，请退出应用并核对本机程序');
  }
}
