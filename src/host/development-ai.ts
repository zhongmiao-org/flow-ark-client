// Explicit local development transport. It never resolves a stored credential.
export const DEVELOPMENT_AI_PLACEHOLDER = 'flowark-local-development-placeholder';

export function developmentAILoopbackOnly() {
  return process.env.FLOWARK_DEVELOPMENT_AI_LOOPBACK === '1';
}

export function defaultDevelopmentAIConnection() {
  return {
    provider: 'compatible' as const,
    baseUrl: process.env.FLOWARK_DEVELOPMENT_AI_URL ?? 'http://127.0.0.1:48573/v1',
    protocol: 'chat-completions' as const,
    model: 'flowark-subagent',
    credentialId: 'local-00000000-0000-0000-0000-000000000000',
  };
}

export function assertDevelopmentAIConnection(connection: { provider: string; baseUrl?: string }) {
  if (connection.provider !== 'compatible' || !connection.baseUrl)
    throw Error('本机子智能体开发模式仅允许显式配置的本机兼容服务；未读取AI凭据或调用模型');
  const url = new URL(connection.baseUrl);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.port === '0' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('本机子智能体开发模式须使用带端口的HTTP回环IP地址；不允许远程服务、域名或真实Key');
  return url;
}

export function developmentAIFetch(baseUrl: string, fetcher: typeof fetch = fetch): typeof fetch {
  const expected = assertDevelopmentAIConnection({ provider: 'compatible', baseUrl });
  const basePath = expected.pathname.replace(/\/$/, '');
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.origin !== expected.origin ||
      ![basePath + '/chat/completions', basePath + '/responses'].includes(url.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error('本机子智能体请求目标与已固定连接不一致，未发送请求');
    return fetcher(input, { ...init, redirect: 'error' });
  };
}
