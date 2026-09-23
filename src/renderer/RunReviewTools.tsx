import type { ReviewToolCall } from '../shared/run-review';
import { referenceOf } from './value-references';
import './run-review-tools.css';

const hints = [
  ['readOnlyHint', '只读'],
  ['destructiveHint', '可能破坏数据'],
  ['idempotentHint', '重复调用结果不变'],
  ['openWorldHint', '与外部对象交互'],
] as const;

function referenceLabel(reference: string) {
  if (reference.startsWith('params.')) return '流程参数';
  if (reference.startsWith('steps.')) return '前序步骤输出';
  if (reference === 'item' || reference.startsWith('item.')) return '当前循环项';
  if (reference === 'index') return '当前循环序号';
  return '需核对的引用';
}

/** Describe nested references without reading parameters or evaluating any value. */
function references(value: unknown) {
  const found: { path: string; reference: string }[] = [];
  const pending = [{ path: '', value }];
  let count = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    const ref = referenceOf(entry.value);
    if (ref !== undefined) {
      count++;
      if (found.length < 100) found.push({ path: entry.path || '整组参数', reference: ref });
    } else if (entry.value && typeof entry.value === 'object') {
      for (const [key, child] of Object.entries(entry.value).reverse())
        pending.push({
          path: entry.path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'),
          value: child,
        });
    }
  }
  return { found, remaining: count - found.length };
}

function Call({ call }: { call: ReviewToolCall }) {
  const { step, target, definition } = call;
  const refs = references(step.arguments);
  return (
    <details className="run-review-tool">
      <summary>
        <span>
          第 {call.ordinal} 步 · {step.name || definition?.title || step.tool}
        </span>
        <small>
          {target?.displayName || '工具对象未绑定'} · {step.tool}
        </small>
        <small className={call.current ? '' : 'run-review-error'}>
          {call.current ? '本机记录一致 · 调用尚未开放' : '工具对象需要处理'}
        </small>
      </summary>
      <div className="run-review-tool-body">
        <p>{call.reason}</p>
        <p>
          执行条件：{call.context.length ? call.context.join(' → ') : '执行到此步骤时'}。
          {call.context.length > 0 && '分支是否进入、循环实际次数在运行时确定。'}
        </p>
        <dl className="run-review-tool-facts">
          <div>
            <dt>连接对象</dt>
            <dd>{target?.displayName || '尚未绑定'}</dd>
          </div>
          <div>
            <dt>工具原名</dt>
            <dd>
              <code>{step.tool}</code>
            </dd>
          </div>
          <div>
            <dt>来源说明</dt>
            <dd>{target?.source || '没有保存的来源说明'}</dd>
          </div>
          <div>
            <dt>账号与权限</dt>
            <dd>未核对，不能从连接名称或服务说明推断</dd>
          </div>
          <div>
            <dt>步骤期限</dt>
            <dd>{step.timeoutMs === undefined ? '未单独设置' : `${step.timeoutMs} 毫秒`}</dd>
          </div>
        </dl>
        {definition && (
          <>
            <h3>服务说明与行为声明</h3>
            <p>{definition.description || '服务没有提供用途说明。'}</p>
            <dl className="run-review-tool-facts">
              {hints.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {definition.annotations?.[key] === undefined
                      ? '未声明'
                      : definition.annotations[key]
                        ? '服务声明为是'
                        : '服务声明为否'}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="ai-task-note">
              服务声明不能证明没有外部影响，也不代表已经授权。读取范围、外发、覆盖和删除仍需核对。
            </p>
          </>
        )}
        <h3>拟发送参数</h3>
        <p>以下是已保存方案中的配置；尚未求值，也未按服务的输入定义验证。</p>
        <pre tabIndex={0} aria-label={`第 ${call.ordinal} 步完整参数`}>
          {JSON.stringify(step.arguments, null, 2)}
        </pre>
        {refs.found.length ? (
          <>
            <h3>参数来源</h3>
            <ul>
              {refs.found.map((entry) => (
                <li key={entry.path}>
                  <code>{entry.path}</code> · {referenceLabel(entry.reference)}
                  <code>{entry.reference}</code>
                </li>
              ))}
            </ul>
            <p>
              引用值要到执行时才能确定；前序工具的实际输出尚未接入。字段路径使用 / 分隔，~1
              表示字段名中的 /，~0 表示 ~。
            </p>
            {refs.remaining > 0 && <p>另有 {refs.remaining} 项引用，请在上方完整参数中查看。</p>}
          </>
        ) : (
          <p>参数全部来自方案中保存的固定值，没有动态引用。</p>
        )}
        <details>
          <summary>查看保存的选择与完整工具定义</summary>
          <p>逻辑目标：{step.target}</p>
          {target && (
            <p>
              连接修订 {target.connectionRevision} ·{' '}
              {target.transport === 'stdio' ? '本机程序' : 'HTTP 服务'} · 协议{' '}
              {target.protocolVersion} · 选择时间 {new Date(target.selectedAt).toLocaleString()}
            </p>
          )}
          {definition ? (
            <pre tabIndex={0} aria-label={`第 ${call.ordinal} 步完整工具定义`}>
              {JSON.stringify(definition, null, 2)}
            </pre>
          ) : (
            <p>没有匹配的已选工具定义。</p>
          )}
        </details>
      </div>
    </details>
  );
}

export default function RunReviewTools({ calls }: { calls: ReviewToolCall[] }) {
  return (
    <section className="run-review-card run-review-tools" aria-label="工具调用与参数">
      <h2>工具调用与参数 · {calls.length} 个步骤</h2>
      <p>
        展开核对每个工具的连接、参数与服务声明。查看或重新检查不会连接服务、启动程序或调用工具。
      </p>
      <p className="ai-task-note">工具调用尚未开放，本页不能开始试运行。</p>
      {calls.map((call) => (
        <Call key={call.step.id} call={call} />
      ))}
    </section>
  );
}
