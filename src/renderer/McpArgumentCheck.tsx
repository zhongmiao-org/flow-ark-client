import type { McpArgumentReview } from '../shared/mcp-argument-review';
import './mcp-argument-check.css';

export const argumentStatusLabels = {
  valid: '固定值符合定义',
  invalid: '参数需要修改',
  deferred: '引用待求值',
  unsupported: '输入定义暂不支持',
  unavailable: '尚未取得核对结果',
};

export default function McpArgumentCheck({ result }: { result?: McpArgumentReview }) {
  const status = result?.status ?? 'unavailable';

  return (
    <section className={`mcp-argument-check is-${status}`} aria-label="参数核对结果">
      <div className="mcp-argument-check-heading">
        <h3>参数核对</h3>
        <span>{argumentStatusLabels[status]}</span>
      </div>
      <p>{result?.summary ?? '未取得本次参数核对结果，请重新检查；不能据此开始调用。'}</p>
      {!!result?.issues.length && (
        <ul aria-label="需要处理的参数问题">
          {result.issues.map((issue, index) => (
            <li key={index}>
              <span>
                {status === 'unsupported' ? '输入定义位置' : '参数位置'}：
                <code tabIndex={0} aria-label="完整问题字段路径">
                  {issue.path || (status === 'unsupported' ? '整个输入定义' : '整组参数')}
                </code>
              </span>
              <strong>{issue.message}</strong>
            </li>
          ))}
        </ul>
      )}
      {status === 'invalid' && (
        <p>
          请返回方案修改对应参数，再重新检查。这里显示首先发现的问题；未自动转换类型或填入默认值。
        </p>
      )}
      {status === 'unsupported' && (
        <p>请展开完整工具定义核对规则；当前不支持的规则不会被忽略，也不会触发工具调用。</p>
      )}
      {status === 'deferred' && (
        <p>
          发现 {result?.referenceCount ?? '未确定数量的'}{' '}
          处引用。未读取参数值、前序输出或循环项；整组参数仍需在执行前求值后重新核对。
        </p>
      )}
      {status === 'valid' && (
        <p>
          仅核对方案中的固定值与保存的定义。当前连接、账号权限、外部影响和执行授权仍需分别核对。
        </p>
      )}
      <p className="mcp-argument-check-note">
        本次只读核对不连接服务、不发送参数；工具调用尚未开放。
      </p>
    </section>
  );
}
