import { z } from 'zod';

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const connectionConfig = z
  .object({
    version: z.literal(1),
    displayName: text(100),
    source: text(500),
    protocolVersion: z.enum(['2026-07-28', '2025-11-25']),
    transport: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('http'),
          url: z
            .string()
            .max(2048)
            .refine((value) => {
              try {
                const u = new URL(value);
                return (
                  !u.username &&
                  !u.password &&
                  !u.hash &&
                  !u.search &&
                  (u.protocol === 'https:' ||
                    (u.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(u.hostname)))
                );
              } catch {
                return false;
              }
            }, '请使用 HTTPS 或本机回环 HTTP 地址，不在地址中填写凭据、查询串或片段'),
          auth: z.enum(['none', 'bearer', 'oauth']),
          oauth: z
            .object({
              issuer: text(2048),
              clientId: text(500),
              callbackPort: z.number().int().min(1024).max(65535),
            })
            .strict()
            .optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal('stdio'),
          command: text(4096).refine((value) => value.startsWith('/'), '请选择绝对可执行文件路径'),
          args: z
            .array(
              z
                .string()
                .max(4096)
                .refine((v) => !v.includes('\0')),
            )
            .max(40),
        })
        .strict(),
    ]),
  })
  .strict();
export type ConnectionConfig = z.infer<typeof connectionConfig>;
const revision = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
export const connectionMethods = {
  'tool.connection.list': z.object({}).strict(),
  'tool.connection.oauth.inspect': z
    .object({
      requestId: id,
      url: connectionConfig.shape.transport.options[0].shape.url,
      protocolVersion: connectionConfig.shape.protocolVersion,
      reviewedSource: z.literal(true),
    })
    .strict(),
  'tool.connection.oauth.authorize': z
    .object({
      requestId: id,
      inspectionToken: id,
      config: connectionConfig,
      reviewedAuthorization: z.literal(true),
      connectionId: id.optional(),
      revision: revision.optional(),
    })
    .strict()
    .refine((v) => !!v.connectionId === (v.revision !== undefined))
    .refine(
      (v) =>
        v.config.transport.type === 'http' &&
        v.config.transport.auth === 'oauth' &&
        !!v.config.transport.oauth,
    ),
  'tool.connection.discover': z
    .object({
      requestId: id,
      config: connectionConfig,
      reviewedSource: z.literal(true),
      connectionId: id.optional(),
      revision: revision.optional(),
      bearerToken: z
        .string()
        .min(1)
        .max(8192)
        .regex(/^[\x21-\x7e]+$/)
        .optional(),
    })
    .strict()
    .refine((v) => !!v.connectionId === (v.revision !== undefined), '连接和修订必须同时提供')
    .refine(
      (v) =>
        !v.bearerToken ||
        (v.config.transport.type === 'http' && v.config.transport.auth === 'bearer'),
      '此连接不接受 Bearer Token',
    ),
  'tool.connection.cancel': z.object({ requestId: id }).strict(),
  'tool.connection.save': z.object({ token: id, reviewedCapabilities: z.literal(true) }).strict(),
  'tool.connection.disconnect': z.object({ id, revision }).strict(),
  'tool.connection.remove': z.object({ id, revision, confirmed: z.literal(true) }).strict(),
};
export type ToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};
export type ConnectionDiscovery = {
  server: { name: string; version: string } | null;
  protocolVersion: string;
  tools: ToolDefinition[];
  capabilityDigest: string;
  testedAt: string;
};
export type OAuthSummary = {
  issuer: string;
  clientId: string;
  resource: string;
  scopes: string[];
  expiresAt?: number;
};
export type ToolConnection = ConnectionDiscovery & {
  oauth?: OAuthSummary;
  id: string;
  revision: number;
  config: ConnectionConfig;
  hasCredential: boolean;
  taskReferences?: { taskId: string; flowId: string; description: string }[];
  activeRunCount?: number;
  status: 'verified' | 'unverified' | 'disconnected' | 'failed';
};
export type ConnectionCandidate = ConnectionDiscovery & {
  oauth?: OAuthSummary;
  token: string;
  requestId: string;
  config: ConnectionConfig;
  connectionId?: string;
  revision?: number;
  expiresAt: number;
  changed: boolean;
};
export type OAuthInspection = {
  inspectionToken?: string;
  protocolVersion: string;
  version: 1;
  url: string;
  resource: string;
  checkedAt: string;
  expiresAt: number;
  scopes: string[];
  scopeSource: 'challenge' | 'resource' | 'unspecified';
  contactedOrigins: string[];
  servers: {
    issuer: string;
    status: 'ready' | 'unsupported' | 'failed';
    issues: string[];
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    registrationEndpoint?: string;
    clientIdMetadataSupported?: boolean;
    publicClientSupported?: boolean;
    issuerParameterSupported?: boolean;
  }[];
};
