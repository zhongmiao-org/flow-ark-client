import { useEffect, useRef, useState } from 'react';
import type { OAuthInspection } from '../shared/tool-connections';

export default function ToolOAuthInspection({ result }: { result: OAuthInspection }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    heading.current?.focus();
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [result]);
  const expired = clock >= result.expiresAt;
  return (
    <section className="tool-oauth-inspection" aria-label="OAuth 授权前检查">
      <h2 ref={heading} tabIndex={-1}>
        认证站点与权限范围
      </h2>
      <p className="ai-task-note tool-warning" role="status">
        {expired ? '本次检查已过期，请重新检查。' : '仅完成配置读取，尚未登录或保存连接。'}
        登录授权与令牌接入尚未完成，本次结果不能用于执行任务。
      </p>
      <dl>
        <div>
          <dt>所选服务</dt>
          <dd>{result.url}</dd>
        </div>
        <div>
          <dt>声明的资源</dt>
          <dd>{result.resource}</dd>
        </div>
        <div>
          <dt>检查时间</dt>
          <dd>{new Date(result.checkedAt).toLocaleString('zh-CN')} · 有效 5 分钟</dd>
        </div>
        <div>
          <dt>权限范围来源</dt>
          <dd>
            {result.scopeSource === 'challenge'
              ? '服务本次认证要求'
              : result.scopeSource === 'resource'
                ? '服务资源声明'
                : '未声明'}
          </dd>
        </div>
      </dl>
      <h3>
        {result.scopeSource === 'challenge'
          ? '本次请求的范围'
          : result.scopeSource === 'resource'
            ? '服务声明的可用范围'
            : '权限范围'}
      </h3>
      {result.scopes.length ? (
        <ul>
          {result.scopes.map((scope) => (
            <li key={scope}>
              <code>{scope}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p>服务未列出具体范围；这不表示无需权限或已经授权。</p>
      )}
      <h3>认证站点 · {result.servers.length}</h3>
      {result.servers.map((server) => (
        <article className="tool-oauth-server" key={server.issuer}>
          <h4>{server.issuer}</h4>
          <p>
            {server.status === 'ready'
              ? '声明满足授权码与 S256 要求 · 待登录接入'
              : server.status === 'unsupported'
                ? '声明不满足当前授权要求'
                : '检查未通过'}
          </p>
          {!!server.issues.length && (
            <ul>
              {server.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {server.status !== 'failed' && (
            <details>
              <summary>查看站点声明</summary>
              <dl>
                <div>
                  <dt>授权地址</dt>
                  <dd>{server.authorizationEndpoint ?? '未声明'}</dd>
                </div>
                <div>
                  <dt>令牌地址</dt>
                  <dd>{server.tokenEndpoint ?? '未声明'}</dd>
                </div>
                <div>
                  <dt>客户端元数据文档</dt>
                  <dd>{server.clientIdMetadataSupported ? '声明支持' : '未声明支持'}</dd>
                </div>
                <div>
                  <dt>动态注册</dt>
                  <dd>{server.registrationEndpoint ?? '未声明，需向服务提供者核对预注册方式'}</dd>
                </div>
              </dl>
            </details>
          )}
        </article>
      ))}
      <details>
        <summary>本次访问的站点</summary>
        <ul>
          {result.contactedOrigins.map((origin) => (
            <li key={origin}>{origin}</li>
          ))}
        </ul>
      </details>
      <p>
        以上信息由服务提供，不证明账号、工作区或发布者身份。本次没有发送凭据、注册客户端或调用工具。
      </p>
    </section>
  );
}
