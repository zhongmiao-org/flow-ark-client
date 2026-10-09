import {
  checkResourceAllowed,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
  resourceUrlFromServerUrl,
  type FetchLike,
} from '@modelcontextprotocol/client';
import { connectionMethods, type OAuthInspection } from '../shared/tool-connections';

export class OAuthInspectionError extends Error {}
const limit = 1024 * 1024;
function fail(message: string): never {
  throw new OAuthInspectionError(message);
}

export async function inspectMcpOAuth(
  input: { requestId: string; url: string; protocolVersion: string; reviewedSource: true },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<OAuthInspection> {
  const args = connectionMethods['tool.connection.oauth.inspect'].parse(input);
  const source = new URL(args.url);
  const origins = new Set<string>();
  let requests = 0;
  const checkedUrl = (value: string) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return fail('服务返回了无效的 OAuth 地址');
    }
    if (
      value.length > 2048 ||
      /[\u0000-\u0020\u007f]/.test(value) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      (url.protocol !== 'https:' && !(source.protocol === 'http:' && url.origin === source.origin))
    )
      return fail('OAuth 地址须为 HTTPS，或所选本机服务的同源地址，且不能包含凭据、查询串或片段');
    return url;
  };
  const get = async (raw: string, metadata: boolean): Promise<Response> => {
    signal.throwIfAborted();
    const url = checkedUrl(raw);
    if (++requests > 32) fail('OAuth 检查请求超过限制');
    origins.add(url.origin);
    const response = await fetcher(url, {
      method: 'GET',
      headers: {
        Accept: metadata ? 'application/json' : 'application/json, text/event-stream',
        'MCP-Protocol-Version': args.protocolVersion,
      },
      credentials: 'omit',
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return fail('OAuth 配置要求重定向，请核对服务的最终地址');
    }
    if (!metadata) return response;
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      return fail('OAuth 元数据超过 1 MiB');
    }
    if (!response.body) return response;
    let received = 0;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > limit) fail('OAuth 元数据超过 1 MiB');
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, headers: response.headers });
  };
  const metadataFetch: FetchLike = (input) =>
    get(input instanceof Request ? input.url : String(input), true);
  try {
    const response = await get(args.url, false);
    const challenge = response.status === 401 ? extractWWWAuthenticateParams(response) : {};
    const header = response.headers.get('www-authenticate') ?? '';
    await response.body?.cancel();
    if (header.length > 32768) fail('OAuth 认证声明超过限制');
    if (
      response.status === 401 &&
      /resource_metadata\s*=/i.test(header) &&
      !challenge.resourceMetadataUrl
    )
      fail('服务声明的 OAuth 资源元数据地址无效');
    const resource = await discoverOAuthProtectedResourceMetadata(
      args.url,
      {
        protocolVersion: args.protocolVersion,
        resourceMetadataUrl: challenge.resourceMetadataUrl,
      },
      metadataFetch,
    );
    checkedUrl(resource.resource);
    if (
      !checkResourceAllowed({
        requestedResource: resourceUrlFromServerUrl(args.url),
        configuredResource: resource.resource,
      })
    )
      fail('OAuth 资源与所选 MCP 服务不匹配');
    const issuers = resource.authorization_servers;
    if (!issuers?.length || issuers.length > 8 || new Set(issuers).size !== issuers.length)
      fail('服务须提供 1–8 个不重复的 OAuth 认证站点');
    const scopeSource = challenge.scope
      ? 'challenge'
      : resource.scopes_supported
        ? 'resource'
        : 'unspecified';
    const scopes = [
      ...new Set(
        challenge.scope
          ? challenge.scope.split(/\s+/).filter(Boolean)
          : (resource.scopes_supported ?? []),
      ),
    ];
    if (
      scopes.length > 128 ||
      scopes.some((s) => s.length > 200 || !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(s))
    )
      fail('OAuth 权限范围声明无效或超过限制');
    const servers: OAuthInspection['servers'] = [];
    for (const issuer of issuers) {
      signal.throwIfAborted();
      if (issuer.length > 2048 || /[\u0000-\u001f\u007f]/.test(issuer))
        fail('OAuth 认证站点声明无效');
      try {
        checkedUrl(issuer);
        const metadata = await discoverAuthorizationServerMetadata(issuer, {
          protocolVersion: args.protocolVersion,
          fetchFn: metadataFetch,
        });
        if (!metadata) fail('未取得有效的认证站点元数据');
        if (metadata.issuer !== issuer) fail('认证站点身份与声明不一致');
        const authorizationEndpoint = metadata.authorization_endpoint
          ? checkedUrl(metadata.authorization_endpoint).href
          : undefined;
        const tokenEndpoint = metadata.token_endpoint
          ? checkedUrl(metadata.token_endpoint).href
          : undefined;
        const registrationEndpoint = metadata.registration_endpoint
          ? checkedUrl(metadata.registration_endpoint).href
          : undefined;
        const issues: string[] = [];
        if (!authorizationEndpoint || !tokenEndpoint) issues.push('缺少授权或令牌地址');
        if (!metadata.response_types_supported.includes('code')) issues.push('未声明授权码方式');
        if (!metadata.code_challenge_methods_supported?.includes('S256'))
          issues.push('未声明 S256 PKCE 支持');
        servers.push({
          issuer,
          status: issues.length ? 'unsupported' : 'ready',
          issues,
          authorizationEndpoint,
          tokenEndpoint,
          registrationEndpoint,
          clientIdMetadataSupported: metadata.client_id_metadata_document_supported === true,
          publicClientSupported:
            metadata.token_endpoint_auth_methods_supported?.includes('none') === true,
          issuerParameterSupported:
            metadata.authorization_response_iss_parameter_supported === true,
        });
      } catch (error) {
        signal.throwIfAborted();
        servers.push({
          issuer,
          status: 'failed',
          issues: [
            error instanceof OAuthInspectionError
              ? error.message
              : '认证站点元数据读取或身份校验失败，请向服务提供者核对',
          ],
        });
      }
    }
    signal.throwIfAborted();
    return {
      version: 1,
      protocolVersion: args.protocolVersion,
      url: args.url,
      resource: resource.resource,
      checkedAt: new Date().toISOString(),
      expiresAt: Date.now() + 300000,
      scopes,
      scopeSource,
      servers,
      contactedOrigins: [...origins],
    };
  } catch (error) {
    if (signal.aborted) throw new OAuthInspectionError('OAuth 检查已取消或超时');
    if (error instanceof OAuthInspectionError) throw error;
    throw new OAuthInspectionError('OAuth 资源元数据读取或校验失败，请核对服务地址和协议');
  }
}
