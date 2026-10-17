import { Checkbox, Input, Collapse } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { useEffect, useId, useState } from 'react';
import type { Step } from '../shared/types';
import './node-configuration.css';

function timeoutError(value: number | undefined) {
  return value !== undefined && (!Number.isInteger(value) || value < 100 || value > 3600000)
    ? '请输入 100–3600000 的整数毫秒数'
    : '';
}

export default function NodeTiming({
  node,
  change,
  compact = false,
}: {
  node: Step;
  change: (next: Step) => void;
  compact?: boolean;
}) {
  const id = useId();
  const defaultMs = node.type === 'source-reduce' ? 1800000 : 60000;
  const [text, setText] = useState(String(node.timeoutMs ?? defaultMs));
  const [error, setError] = useState(timeoutError(node.timeoutMs));
  const enabled = node.timeoutMs !== undefined;
  const noDefault = ['condition', 'loop', 'value', 'assert', 'human'].includes(node.type);
  useEffect(() => {
    setText(String(node.timeoutMs ?? defaultMs));
    setError(timeoutError(node.timeoutMs));
  }, [node.id, node.timeoutMs]);
  const help = enabled ? (
    <p id={id + '-help'}>
      100–3600000 毫秒。{!error && `${Number(text) / 1000} 秒。`}从此节点开始执行时计时。
    </p>
  ) : (
    <p>
      {noDefault
        ? '此类节点未配置时没有自身默认期限；仍受父容器期限和运行取消约束。'
        : `未配置时使用 ${defaultMs} 毫秒（${defaultMs / 1000} 秒）；父容器可以更早到期。`}
    </p>
  );
  return (
    <section className="node-timing" aria-label="节点期限" data-value-invalid={error || undefined}>
      {!compact && (
        <header>
          <h4>执行期限</h4>
          <span>{enabled ? '自定义' : '默认规则'}</span>
        </header>
      )}
      <Checkbox
        id={id + '-enabled'}
        checked={enabled}
        onChange={(event) => {
          setError('');
          if (event.target.checked) {
            setText(String(defaultMs));
            change({ ...node, timeoutMs: defaultMs });
          } else {
            const { timeoutMs: _timeout, ...next } = node;
            change(next as Step);
          }
        }}
        className="node-timing-toggle"
      >
        <span>为此节点设置期限</span>
      </Checkbox>
      {enabled && (
        <>
          <label htmlFor={id}>期限（毫秒）</label>
          <Input
            status={!!error ? 'error' : undefined}
            id={id}
            type="text"
            inputMode="numeric"
            value={text}
            aria-invalid={!!error}
            aria-describedby={id + '-help'}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              const amount = Number(value);
              if (!value.trim() || !Number.isInteger(amount) || amount < 100 || amount > 3600000) {
                setError('请输入 100–3600000 的整数毫秒数');
                return;
              }
              setError('');
              change({ ...node, timeoutMs: amount });
            }}
          />
        </>
      )}
      {compact ? (
        <Collapse
          size="small"
          items={[
            {
              key: 'rules',
              onKeyDown: activateCollapseWithSpace,
              label: '期限规则',
              forceRender: true,
              children: help,
            },
          ]}
        />
      ) : (
        help
      )}
      {['condition', 'loop'].includes(node.type) && (
        <p>容器期限覆盖子步骤及内部等待、暂停，不会在每个子步骤开始时重新计时。</p>
      )}
      {node.type === 'human' && <p>设置后，等待人工确认的时间也计入期限。</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}；修正或恢复默认规则后才能保存、运行或切换步骤。
        </p>
      )}
    </section>
  );
}
