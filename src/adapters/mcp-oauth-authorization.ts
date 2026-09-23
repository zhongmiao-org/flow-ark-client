import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  validateAuthorizationResponseIssuer,
  type AuthorizationServerMetadata,
  type FetchLike,
  type OAuthTokens,
} from '@modelcontextprotocol/client';
import type { ConnectionConfig, OAuthInspection } from '../shared/tool-connections';
import { oauthGrant, type OAuthGrant } from '../shared/mcp-oauth-grant';
import { OAuthInspectionError } from './mcp-oauth-inspection';

const failure = (message: string): never => {
  throw new OAuthInspectionError(message);
};
function tokenFetch(endpoint: string, signal: AbortSignal): FetchLike {
  let sent = false;
  return async (input, init) => {
    if (sent || String(input) !== endpoint || init?.method !== 'POST')
      return failure('授权令牌请求与核对的地址不符');
    sent = true;
    const response = await fetch(endpoint, {
      ...init,
      credentials: 'omit',
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    });
    if (!response.ok || Number(response.headers.get('content-length')) > 65536) {
      await response.body?.cancel();
      return failure('令牌交换未完成，请重新授权；未自动重试');
    }
    let bytes = 0;
    const body = response.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > 65536) failure('令牌响应超过限制');
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, headers: response.headers });
  };
}
function receiveTokens(
  base: Omit<OAuthGrant, 'accessToken' | 'refreshToken' | 'expiresAt'>,
  tokens: OAuthTokens,
): OAuthGrant {
  if (tokens.token_type.toLowerCase() !== 'bearer') failure('服务未返回支持的 Bearer 令牌');
  const scopes =
    tokens.scope === undefined
      ? base.scopes
      : [...new Set(tokens.scope.split(' ').filter(Boolean))];
  if (scopes.some((s) => !base.scopes.includes(s)))
    failure('服务授予的范围超出本次核对范围，请向提供者核对');
  if (
    tokens.expires_in !== undefined &&
    (!Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0)
  )
    failure('服务返回的令牌有效期无效');
  return oauthGrant.parse({
    ...base,
    scopes,
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    ...(tokens.expires_in !== undefined
      ? { expiresAt: Date.now() + tokens.expires_in * 1000 }
      : {}),
  });
}

export async function authorizeMcpOAuth(
  config: ConnectionConfig,
  inspection: OAuthInspection,
  signal: AbortSignal,
  open: (url: string) => Promise<void>,
): Promise<OAuthGrant> {
  if (
    config.transport.type !== 'http' ||
    config.transport.auth !== 'oauth' ||
    !config.transport.oauth
  )
    return failure('请选择 OAuth 认证站点与客户端');
  const { issuer, clientId, callbackPort } = config.transport.oauth;
  const selected = inspection.servers.find((server) => server.issuer === issuer);
  if (
    !selected ||
    selected.status !== 'ready' ||
    !selected.publicClientSupported ||
    !selected.authorizationEndpoint ||
    !selected.tokenEndpoint
  )
    return failure('所选认证站点未声明支持公开客户端、授权码和 S256');
  const metadata: AuthorizationServerMetadata = {
    issuer,
    authorization_endpoint: selected.authorizationEndpoint,
    token_endpoint: selected.tokenEndpoint,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: selected.issuerParameterSupported === true,
  };
  const state = randomBytes(32).toString('base64url');
  const redirect = `http://127.0.0.1:${callbackPort}/oauth/callback`;
  let consume = false;
  let resolveCallback!: (response: { code: string; iss?: string }) => void;
  let rejectCallback!: (error: Error) => void;
  const callback = new Promise<{ code: string; iss?: string }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  // A close/error can happen while the browser opener is still awaiting the OS.
  void callback.catch(() => {});
  const listener = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const reply = (status: number, text: string) => {
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        Connection: 'close',
      });
      res.end(text);
    };
    if (
      signal.aborted ||
      consume ||
      req.method !== 'GET' ||
      req.headers.host !== `127.0.0.1:${callbackPort}` ||
      !req.url ||
      req.url.length > 8192
    ) {
      reply(400, '此授权返回无效或已经结束，请回到 FlowArk。');
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url, redirect);
    } catch {
      reply(400, '授权回调地址无效。');
      return;
    }
    if (url.origin !== new URL(redirect).origin || url.pathname !== '/oauth/callback') {
      reply(404, '未找到授权回调。');
      return;
    }
    const params = url.searchParams;
    const supplied = params.get('state') ?? '';
    if (
      ['state', 'code', 'iss', 'error'].some((key) => params.getAll(key).length > 1) ||
      !/^[a-zA-Z0-9_-]{43}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(state))
    ) {
      reply(400, '此授权返回不属于当前请求，请回到 FlowArk。');
      return;
    }
    consume = true;
    try {
      const iss = params.get('iss') ?? undefined;
      validateAuthorizationResponseIssuer({
        iss,
        expectedIssuer: issuer,
        issParameterSupported: selected.issuerParameterSupported === true,
      });
      if (params.has('error')) failure('登录授权被拒绝或未完成，请核对后重新发起');
      const code = params.get('code');
      if (!code || code.length > 4096 || /[\u0000-\u001f\u007f]/.test(code))
        failure('授权返回缺少有效授权码');
      reply(200, '已收到授权返回。请回到 FlowArk 查看能力检查结果；连接尚未保存。');
      resolveCallback({ code: code!, iss });
    } catch (error) {
      reply(400, '授权返回未通过核对，请回到 FlowArk。');
      rejectCallback(
        error instanceof OAuthInspectionError
          ? error
          : new OAuthInspectionError('认证站点身份与登录请求不一致'),
      );
    }
  });
  listener.requestTimeout = 10000;
  listener.headersTimeout = 10000;
  const abort = () => {
    rejectCallback(new OAuthInspectionError('登录授权已取消或超时'));
    listener.closeAllConnections();
    listener.close();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(callbackPort, '127.0.0.1', resolve);
    });
    signal.throwIfAborted();
    const { authorizationUrl, codeVerifier } = await startAuthorization(issuer, {
      metadata,
      clientInformation: { client_id: clientId },
      redirectUrl: redirect,
      state,
      scope: inspection.scopes.join(' ') || undefined,
      resource: new URL(inspection.resource),
    });
    signal.throwIfAborted();
    await Promise.race([open(authorizationUrl.href), callback.then(() => undefined)]);
    const response = await callback;
    signal.throwIfAborted();
    const tokens = await exchangeAuthorization(issuer, {
      metadata,
      clientInformation: { client_id: clientId },
      authorizationCode: response.code,
      iss: response.iss,
      codeVerifier,
      redirectUri: redirect,
      resource: new URL(inspection.resource),
      fetchFn: tokenFetch(selected.tokenEndpoint, signal),
    });
    signal.throwIfAborted();
    return receiveTokens(
      {
        kind: 'mcp-oauth-v1',
        url: config.transport.url,
        issuer,
        clientId,
        resource: inspection.resource,
        scopes: inspection.scopes,
        tokenEndpoint: selected.tokenEndpoint,
        authorizationEndpoint: selected.authorizationEndpoint,
      },
      tokens,
    );
  } catch (error) {
    if (signal.aborted) return failure('登录授权已取消或超时');
    if (error instanceof OAuthInspectionError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE')
      return failure('回调端口已占用，请核对登记的端口；没有另开监听');
    return failure('OAuth 登录或令牌交换未完成，请重新检查并授权；未自动重试');
  } finally {
    signal.removeEventListener('abort', abort);
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
}

export async function refreshMcpOAuth(grant: OAuthGrant, signal: AbortSignal): Promise<OAuthGrant> {
  if (!grant.refreshToken) return failure('登录已过期，请重新授权');
  try {
    const tokens = await refreshAuthorization(grant.issuer, {
      metadata: {
        issuer: grant.issuer,
        token_endpoint: grant.tokenEndpoint,
        authorization_endpoint: grant.authorizationEndpoint,
        response_types_supported: ['code'],
        token_endpoint_auth_methods_supported: ['none'],
      },
      clientInformation: { client_id: grant.clientId },
      refreshToken: grant.refreshToken,
      resource: new URL(grant.resource),
      fetchFn: tokenFetch(grant.tokenEndpoint, signal),
    });
    signal.throwIfAborted();
    const { accessToken: _, refreshToken: __, expiresAt: ___, ...base } = grant;
    const next = receiveTokens(base, tokens);
    if (next.scopes.length !== grant.scopes.length)
      failure('刷新后的范围已变化，请重新授权并核对能力');
    return next;
  } catch {
    return failure('登录刷新未完成，请重新授权；未自动重试刷新或工具操作');
  }
}
