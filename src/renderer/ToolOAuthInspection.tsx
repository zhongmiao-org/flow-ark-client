import {
  Alert,
  Card,
  Collapse,
  ConfigProvider,
  Button,
  Checkbox,
  Descriptions,
  Input,
  Radio,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { OAuthInspection } from '../shared/tool-connections';
import { activateCollapseWithSpace } from './collapseKeyboard';

export default function ToolOAuthInspection({
  result,
  authorize,
  disabled,
  busy,
  previous,
  cancel,
}: {
  result: OAuthInspection;
  authorize: (issuer: string, clientId: string, port: number) => Promise<void>;
  disabled: boolean;
  busy: boolean;
  previous?: { issuer: string; clientId: string; callbackPort: number };
  cancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [clock, setClock] = useState(Date.now());
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [port, setPort] = useState(String(previous?.callbackPort ?? 48185));
  const [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    setIssuer('');
    setClientId('');
    setReviewed(false);
    setClock(Date.now());
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
      <Alert
        type="warning"
        role="status"
        showIcon
        title={
          busy
            ? '正在等待浏览器登录返回或读取工具清单，请完成登录后回到这里。最多等待 10 分钟，可取消登录。'
            : expired
              ? '本次检查已过期，请重新检查。'
              : '仅完成配置读取。选择认证站点并登录后，还需核对工具能力才能保存。'
        }
      />
      <Descriptions
        className="tool-connection-facts"
        column={1}
        bordered
        size="small"
        items={[
          { key: 'service', label: '所选服务', children: result.url },
          { key: 'resource', label: '声明的资源', children: result.resource },
          {
            key: 'checked',
            label: '检查时间',
            children: `${new Date(result.checkedAt).toLocaleString('zh-CN')} · 有效 5 分钟`,
          },
          {
            key: 'source',
            label: '权限范围来源',
            children:
              result.scopeSource === 'challenge'
                ? '服务本次认证要求'
                : result.scopeSource === 'resource'
                  ? '服务资源声明'
                  : '未声明',
          },
        ]}
      />
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
        <Card
          className="tool-oauth-server"
          key={server.issuer}
          size="small"
          title={<h4>{server.issuer}</h4>}
        >
          <p>
            {server.status === 'ready'
              ? '声明满足授权码与 S256 要求'
              : server.status === 'unsupported'
                ? '声明不满足当前授权要求'
                : '检查未通过'}
          </p>
          {server.status === 'ready' &&
            (server.publicClientSupported ? (
              <Radio
                name="oauth-issuer"
                checked={issuer === server.issuer}
                disabled={disabled || expired || undefined}
                onChange={() => {
                  setIssuer(server.issuer);
                  setClientId(previous?.issuer === server.issuer ? previous.clientId : '');
                  setReviewed(false);
                }}
                className="ai-task-checkbox"
              >
                选择此认证站点登录
              </Radio>
            ) : (
              <p>
                此站点未声明支持公开客户端。当前无法使用其客户端秘密或动态注册，请向提供者核对。
              </p>
            ))}
          {!!server.issues.length && (
            <ul>
              {server.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {server.status !== 'failed' && (
            <Collapse
              items={[
                {
                  key: 'metadata',
                  onKeyDown: activateCollapseWithSpace,
                  label: '查看站点声明',
                  children: (
                    <Descriptions
                      className="tool-connection-facts"
                      column={1}
                      bordered
                      size="small"
                      items={[
                        {
                          key: 'authorization',
                          label: '授权地址',
                          children: server.authorizationEndpoint ?? '未声明',
                        },
                        {
                          key: 'token',
                          label: '令牌地址',
                          children: server.tokenEndpoint ?? '未声明',
                        },
                        {
                          key: 'metadata',
                          label: '客户端元数据文档',
                          children: server.clientIdMetadataSupported ? '声明支持' : '未声明支持',
                        },
                        {
                          key: 'registration',
                          label: '动态注册',
                          children:
                            server.registrationEndpoint ?? '未声明，需向服务提供者核对预注册方式',
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          )}
        </Card>
      ))}
      <Collapse
        items={[
          {
            key: 'origins',
            onKeyDown: activateCollapseWithSpace,
            label: '本次访问的站点',
            children: (
              <ul>
                {result.contactedOrigins.map((origin) => (
                  <li key={origin}>{origin}</li>
                ))}
              </ul>
            ),
          },
        ]}
      />
      <p>
        以上信息由服务提供，不证明账号、工作区或发布者身份。配置检查不发送凭据、注册客户端或调用工具。
      </p>
      {issuer && (
        <ConfigProvider componentDisabled={disabled || expired || undefined}>
          <fieldset disabled={disabled || expired} className="tool-oauth-login">
            <legend>登录前核对</legend>
            <label className="tool-field">
              公开客户端 ID
              <Input
                value={clientId}
                maxLength={500}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setReviewed(false);
                }}
                placeholder="由此服务提供者分配，无需填写客户端秘密"
              />
            </label>
            <label className="tool-field">
              已登记的回调端口
              <Input
                type="number"
                min={1024}
                max={65535}
                step={1}
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                  setReviewed(false);
                }}
              />
            </label>
            <p>
              回调地址：<code>http://127.0.0.1:{port || '端口'}/oauth/callback</code>
            </p>
            <p>
              请核对该地址已在此客户端登记。FlowArk
              将打开系统浏览器，向所选认证站点请求上方展示的全部范围；登录后仅发现工具，不执行工具。
            </p>
            <Checkbox
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              className="ai-task-checkbox"
            >
              我已核对认证站点、客户端、回调地址和请求范围，同意打开登录网页
            </Checkbox>
            <Button
              htmlType="button"
              type="primary"
              disabled={
                !reviewed ||
                !clientId.trim() ||
                !Number.isInteger(Number(port)) ||
                Number(port) < 1024 ||
                Number(port) > 65535 ||
                undefined
              }
              onClick={() => void authorize(issuer, clientId.trim(), Number(port))}
            >
              登录并核对能力
            </Button>
          </fieldset>
        </ConfigProvider>
      )}
      {busy && (
        <Button htmlType="button" onClick={cancel}>
          取消本次登录
        </Button>
      )}
    </section>
  );
}
