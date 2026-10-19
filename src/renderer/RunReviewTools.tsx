import TechnicalDetails from './TechnicalDetails';
import { Alert, Badge, Collapse, Descriptions, Card } from 'antd';
import { useEffect, useState } from 'react';
import { activateCollapseWithSpace } from './collapseKeyboard';
import type { ReviewToolCall } from '../shared/run-review';
import { referenceOf } from './value-references';
import './run-review-tools.css';
import McpArgumentCheck, { argumentStatusLabels } from './McpArgumentCheck';

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
  const needsReview =
    !!call.argumentCheck &&
    ['invalid', 'unsupported', 'unavailable'].includes(call.argumentCheck.status);
  const [expanded, setExpanded] = useState(needsReview);
  useEffect(() => {
    setExpanded(needsReview);
  }, [needsReview]);
  return (
    <Collapse
      className="run-review-tool"
      activeKey={expanded ? ['call'] : []}
      onChange={(keys) => setExpanded(keys.includes('call'))}
      items={[
        {
          key: 'call',
          forceRender: true,
          onKeyDown: activateCollapseWithSpace,
          label: (
            <div className="run-review-tool-label">
              <span>
                第 {call.ordinal} 步 · {step.name || definition?.title || step.tool}
              </span>
              <small>
                {target?.displayName || '工具对象未绑定'} · {step.tool}
              </small>
              <span className="run-review-tool-status">
                <Badge
                  status={call.current ? 'default' : 'error'}
                  text={call.current ? '本机记录一致 · 执行前复核服务' : '工具对象需要处理'}
                />
              </span>
              <small>
                参数：{argumentStatusLabels[call.argumentCheck?.status ?? 'unavailable']}
              </small>
            </div>
          ),
          children: (
            <>
              <div className="run-review-tool-body">
                <p>{call.reason}</p>
                <p>
                  执行条件：{call.context.length ? call.context.join(' → ') : '执行到此步骤时'}。
                  {call.context.length > 0 && '分支是否进入、循环实际次数在运行时确定。'}
                </p>
                <Descriptions
                  className="metadata-facts"
                  bordered
                  size="small"
                  column={1}
                  items={[
                    {
                      key: 'target',
                      label: '连接对象',
                      children: target?.displayName || '尚未绑定',
                    },
                    { key: 'tool', label: '工具原名', children: <code>{step.tool}</code> },
                    {
                      key: 'source',
                      label: '来源说明',
                      children: target?.source || '没有保存的来源说明',
                    },
                    {
                      key: 'account',
                      label: '账号与权限',
                      children: '未核对，不能从连接名称或服务说明推断',
                    },
                    {
                      key: 'timeout',
                      label: '步骤期限',
                      children:
                        step.timeoutMs === undefined ? '未单独设置' : `${step.timeoutMs} 毫秒`,
                    },
                  ]}
                />
                {definition && (
                  <>
                    <h3>服务说明与行为声明</h3>
                    <p>{definition.description || '服务没有提供用途说明。'}</p>
                    <Descriptions
                      className="metadata-facts"
                      bordered
                      size="small"
                      column={1}
                      items={hints.map(([key, label]) => ({
                        key,
                        label,
                        children:
                          definition.annotations?.[key] === undefined
                            ? '未声明'
                            : definition.annotations[key]
                              ? '服务声明为是'
                              : '服务声明为否',
                      }))}
                    />
                    <Alert
                      type="info"
                      role="note"
                      showIcon
                      title="服务声明不能证明没有外部影响，也不代表已经授权。读取范围、外发、覆盖和删除仍需核对。"
                    />
                  </>
                )}
                <McpArgumentCheck result={call.argumentCheck} />
                <h3>拟发送参数</h3>
                <p>以下是已保存方案中的原始配置；动态引用未求值，固定值的核对结果见上方。</p>
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
                          <TechnicalDetails
                            items={[{ label: '完整引用路径', value: entry.reference }]}
                          />
                        </li>
                      ))}
                    </ul>
                    <p>
                      引用值要到执行时才能确定；成功工具回复包含 structuredContent 与
                      content。字段路径使用 / 分隔，~1 表示字段名中的 /，~0 表示 ~。
                    </p>
                    {refs.remaining > 0 && (
                      <p>另有 {refs.remaining} 项引用，请在上方完整参数中查看。</p>
                    )}
                  </>
                ) : (
                  <p>参数全部来自方案中保存的固定值，没有动态引用。</p>
                )}
                <Collapse
                  items={[
                    {
                      key: 'definition',
                      forceRender: true,
                      onKeyDown: activateCollapseWithSpace,
                      label: <>查看保存的选择与完整工具定义</>,
                      children: (
                        <>
                          <p>逻辑目标：{step.target}</p>
                          {target && (
                            <p>
                              连接修订 {target.connectionRevision} ·{' '}
                              {target.transport === 'stdio' ? '本机程序' : 'HTTP 服务'} · 协议{' '}
                              {target.protocolVersion} · 选择时间{' '}
                              {new Date(target.selectedAt).toLocaleString()}
                            </p>
                          )}
                          {definition ? (
                            <pre tabIndex={0} aria-label={`第 ${call.ordinal} 步完整工具定义`}>
                              {JSON.stringify(definition, null, 2)}
                            </pre>
                          ) : (
                            <p>没有匹配的已选工具定义。</p>
                          )}
                        </>
                      ),
                    },
                  ]}
                />
              </div>
            </>
          ),
        },
      ]}
    />
  );
}

export default function RunReviewTools({ calls }: { calls: ReviewToolCall[] }) {
  return (
    <section aria-label="工具调用与参数">
      <Card size="small" className="run-review-card run-review-tools">
        <h2>工具调用与参数 · {calls.length} 个步骤</h2>
        <p>
          展开核对每个工具的连接、参数与服务声明。查看或重新检查不会连接服务、启动程序或调用工具。
        </p>
        <Alert
          type="warning"
          role="note"
          showIcon
          title="确认试运行将按这些步骤执行真实调用；服务声明不能保证没有副作用，结果未知时不会自动重试。"
        />
        {calls.map((call) => (
          <Call key={call.step.id} call={call} />
        ))}
      </Card>
    </section>
  );
}
