import { useEffect, useState } from 'react';
import { Alert, Button, Card, InputNumber, Radio } from 'antd';
import type { BatchLimits } from '../shared/entry-batches';
import { batchLimitsSchema } from '../shared/entry-batches';
import './entry-batches.css';
export default function RunBatchSettings({
  limits,
  disabled,
  supported,
  change,
  editing,
}: {
  limits?: BatchLimits;
  disabled: boolean;
  supported: boolean;
  change: (limits?: BatchLimits) => void;
  editing: (pending: boolean) => void;
}) {
  const [draft, setDraft] = useState<{
    count: number | null;
    minutes: number | null;
    seconds: number | null;
  }>({
    count: limits?.maxBatches ?? 50,
    minutes: (limits?.maxDurationMs ?? 28800000) / 60000,
    seconds: (limits?.delayMs ?? 5000) / 1000,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!pending)
      setDraft({
        count: limits?.maxBatches ?? 50,
        minutes: (limits?.maxDurationMs ?? 28800000) / 60000,
        seconds: (limits?.delayMs ?? 5000) / 1000,
      });
  }, [limits?.maxBatches, limits?.maxDurationMs, limits?.delayMs, pending]);
  const parsed = batchLimitsSchema.safeParse({
    maxBatches: draft.count,
    maxDurationMs: draft.minutes === null ? null : draft.minutes * 60000,
    delayMs: draft.seconds === null ? null : draft.seconds * 1000,
  });
  const update = (key: keyof typeof draft, value: number | null) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setPending(true);
    editing(true);
    setError('');
  };
  return (
    <div className="batch-settings-grid">
      <Card title={limits ? '有限运行设置' : '运行方式'} className="batch-settings-card">
        <Radio.Group
          aria-label="运行方式"
          value={limits ? 'batches' : 'single'}
          disabled={disabled}
          options={[
            { value: 'single', label: '仅运行一次' },
            { value: 'batches', label: '连续运行有限批次', disabled: !supported },
          ]}
          onChange={(e) => {
            setError('');
            setPending(false);
            editing(false);
            if (e.target.value === 'single') {
              setDraft({ count: 50, minutes: 480, seconds: 5 });
              change(undefined);
            } else if (parsed.success) change(parsed.data);
            else {
              setError('请先填写完整的有限设置');
              setPending(true);
              editing(true);
            }
          }}
        />
        {!supported && <p>逐步调试、任务重跑和单次选区/工具目标使用原单次运行路径。</p>}
        {limits && (
          <>
            <div className="batch-form">
              <label>
                <span>批数上限</span>
                <InputNumber
                  aria-label="批数上限"
                  value={draft.count}
                  min={1}
                  max={1000}
                  precision={0}
                  disabled={disabled}
                  onChange={(v) => update('count', v)}
                  addonAfter="批"
                />
              </label>
              <label>
                <span>新批次调度时限</span>
                <InputNumber
                  aria-label="新批次调度时限（分钟）"
                  value={draft.minutes}
                  min={1}
                  max={1440}
                  precision={0}
                  disabled={disabled}
                  onChange={(v) => update('minutes', v)}
                  addonAfter="分钟"
                />
              </label>
              <label>
                <span>批间等待</span>
                <InputNumber
                  aria-label="批间等待（秒）"
                  value={draft.seconds}
                  min={1}
                  max={300}
                  precision={0}
                  disabled={disabled}
                  onChange={(v) => update('seconds', v)}
                  addonAfter="秒"
                />
              </label>
            </div>
            <p>
              固定同一入口、输入、配置与资源引用。每批完整运行并释放运行槽，再根据当前批次的结果决定是否继续。
            </p>
            <p>
              到达时限停止启动新批；当前批按原预算结束，可单独取消。费用继续使用你自己的 API Key。
            </p>
            {pending && (
              <Alert
                type="info"
                showIcon
                title="设置已改变，需要重新检查"
                description="此前的检查与确认不再适用于这些设置。"
              />
            )}
            {error && <Alert type="warning" showIcon title={error} />}
            {pending && (
              <Button
                disabled={disabled || !parsed.success}
                onClick={() => {
                  if (!parsed.success) return;
                  setPending(false);
                  editing(false);
                  change(parsed.data);
                }}
              >
                核对连续设置
              </Button>
            )}
          </>
        )}
      </Card>
      {limits && (
        <Card title="本次范围与终点" className="batch-settings-card">
          <p>同一流程、输入、配置与资源引用。固定来源与具体影响仍须核对下方原检查内容。</p>
          <p>状态可以推进；配置、凭据或权限变化时停止后续批次。</p>
          <p>
            只有当前批次完整结果中已核验的“目标完成”决策，才能标记目标已完成。到达本地批数或时限仅表示停止。
          </p>
          <p>失败、取消、未知操作、进度不变或结果不完整时停止并保留原记录，重开不自动续跑。</p>
          <p>
            连续批次不增加单批容量。费用继续使用你自己的 API Key，实际业务与发送回执由模板逐项核对。
          </p>
        </Card>
      )}
    </div>
  );
}
