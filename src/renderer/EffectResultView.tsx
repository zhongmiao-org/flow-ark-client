import { Alert, Button, Card, Collapse, Descriptions } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { EffectResult } from '../shared/effect-node';
import { effectOperations, effectStates } from '../shared/effect-node';
import ReadonlyValue from './ReadonlyValue';
import { activateCollapseWithSpace } from './collapseKeyboard';

export default function EffectResultView({
  value,
  openRun,
}: {
  value: EffectResult;
  openRun?: (detail: any) => void;
}) {
  const generation = useRef(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    generation.current++;
    setBusy(false);
    setError('');
    return () => {
      generation.current++;
    };
  }, [value.id, value.operation]);
  const source = async () => {
    if (value.operation !== 'prepare' || !openRun || busy) return;
    const request = generation.current;
    setBusy(true);
    setError('');
    try {
      const detail = await window.flowark.request('run.detail', { id: value.runId });
      if (request === generation.current) openRun(detail);
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : '来源运行读取失败');
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const preparing = value.operation === 'prepare';
  return (
    <Card title={effectOperations[value.operation]} className="effect-result">
      <Alert
        type={value.state === 'unknown' || value.state === 'failed' ? 'warning' : 'info'}
        title={
          preparing
            ? value.execute
              ? '本次准备已登记'
              : '同键已有记录，不再执行'
            : '操作结果已登记'
        }
        description={
          preparing
            ? '这里显示准备时的历史回执。仅原运行当时的新回执可进入执行分支；查看或重开不会再次授权。'
            : '结果由模板按实际核对登记；未知不重放。登记本身不证明外部业务成功。'
        }
      />
      <Descriptions
        column={1}
        items={[
          {
            key: 'state',
            label: preparing ? '准备时状态' : '登记状态',
            children: effectStates[value.state],
          },
          ...(preparing
            ? [
                {
                  key: 'execute',
                  label: '准备时允许执行',
                  children: value.execute ? '是，仅原运行当时' : '否',
                },
                { key: 'action', label: '声明动作', children: value.action },
                { key: 'key', label: '原去重键', children: value.key },
              ]
            : []),
        ]}
      />
      {preparing && openRun && (
        <Button loading={busy} onClick={() => void source()}>
          查看来源运行
        </Button>
      )}
      {error && <Alert type="error" title={error} />}
      {value.state === 'unknown' && (
        <p>请在待办与来源运行核对原操作是否真正完成。不要自动换键、重试或补发。</p>
      )}
      <Collapse
        items={[
          {
            key: 'receipt',
            label: '查看原操作记录',
            onKeyDown: activateCollapseWithSpace,
            children: <ReadonlyValue value={value} />,
          },
          {
            key: 'advanced',
            label: '完整回执（高级，可选）',
            onKeyDown: activateCollapseWithSpace,
            children: (
              <pre className="context-json" tabIndex={0}>
                {JSON.stringify(value, null, 2)}
              </pre>
            ),
          },
        ]}
      />
    </Card>
  );
}
