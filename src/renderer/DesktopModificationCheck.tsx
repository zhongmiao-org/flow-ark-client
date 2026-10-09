import { Alert, Button, Descriptions, Tag } from 'antd';
import { desktopCapabilityColors } from './theme';
import { useEffect, useId, useRef, useState } from 'react';
import type { TaskDetail } from '../shared/planning';
import {
  desktopPlanInspection,
  type DesktopPlanInspection,
  type DesktopPlanResponse,
} from '../shared/desktop-planning';

const capabilityLabel = {
  available: '系统报告支持',
  unsupported: '当前不支持',
  unavailable: '未能核对',
};
export default function DesktopModificationCheck({
  candidate,
  unchanged,
  back,
  adopted,
  adoptionUnavailable,
}: {
  candidate: DesktopPlanResponse;
  unchanged: boolean;
  back: () => void;
  adopted: (detail: TaskDetail) => void;
  adoptionUnavailable?: string;
}) {
  const titleId = useId();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<DesktopPlanInspection>();
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);
  const epoch = useRef(0),
    locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const inspect = async () => {
    if (locked.current || savingRef.current || unchanged || candidate.expiresAt <= Date.now())
      return;
    const ticket = ++epoch.current;
    locked.current = true;
    setChecking(true);
    setChecked(undefined);
    setError('');
    const source = {
      id: candidate.id,
      revision: candidate.revision,
      requestId: candidate.requestId,
      observationId: candidate.observationId,
      windowId: candidate.windowId,
      previewId: candidate.previewId,
    };
    try {
      const result = desktopPlanInspection.parse(
        await window.flowark.request('desktop.plan.inspect', source),
      );
      if (ticket !== epoch.current) return;
      if (
        result.id !== candidate.id ||
        result.revision !== candidate.revision ||
        result.requestId !== candidate.requestId ||
        result.observationId !== candidate.observationId ||
        result.windowId !== candidate.windowId ||
        result.previewId !== candidate.previewId ||
        result.expiresAt !== candidate.expiresAt ||
        result.expiresAt <= Date.now()
      )
        throw new Error('检查来源已变化');
      setChecked(result);
    } catch {
      if (ticket === epoch.current)
        setError('未能核对这份候选的修改条件。请返回窗口，重新读取原段落并生成候选。');
    } finally {
      if (ticket === epoch.current) {
        setChecking(false);
        locked.current = false;
        heading.current?.focus();
      }
    }
  };
  useEffect(() => {
    setChecked(undefined);
    setError('');
    setExpired(false);
    setSaving(false);
    setSaveError('');
    savingRef.current = false;
    locked.current = false;
    void inspect();
    const timer = setTimeout(
      () => {
        epoch.current++;
        locked.current = false;
        setChecking(false);
        setChecked(undefined);
        setExpired(true);
        setSaving(false);
        savingRef.current = false;
        setError('本次选区检查已到期，请返回窗口重新读取。');
      },
      Math.max(0, candidate.expiresAt - Date.now()),
    );
    return () => {
      epoch.current++;
      locked.current = false;
      clearTimeout(timer);
    };
  }, [
    candidate.id,
    candidate.revision,
    candidate.requestId,
    candidate.previewId,
    candidate.expiresAt,
    unchanged,
  ]);
  const complete = checked?.replacement === 'available' && checked.readback === 'available';
  const save = async () => {
    if (
      adoptionUnavailable ||
      !complete ||
      checking ||
      savingRef.current ||
      expired ||
      candidate.expiresAt <= Date.now()
    )
      return;
    const ticket = ++epoch.current;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const detail: TaskDetail = await window.flowark.request('desktop.plan.adopt', {
        id: candidate.id,
        revision: candidate.revision,
        requestId: candidate.requestId,
        observationId: candidate.observationId,
        windowId: candidate.windowId,
        previewId: candidate.previewId,
        adopted: true,
      });
      if (ticket !== epoch.current) return;
      if (
        detail.task.id !== candidate.id ||
        detail.task.revision !== candidate.revision + 1 ||
        detail.flow?.desktopTarget?.requestId !== candidate.requestId ||
        detail.flow.id !== detail.task.flowId
      )
        throw new Error('保存返回来源不符');
      adopted(detail);
    } catch {
      if (ticket === epoch.current)
        setSaveError(
          '未能确认方案保存结果。请返回任务查看当前草稿，再决定是否重新生成；未自动重试。',
        );
    } finally {
      if (ticket === epoch.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  return (
    <section className="desktop-modification-check" aria-labelledby={titleId}>
      <div className="desktop-modification-check-title">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          修改条件
        </h2>
        {!unchanged && (
          <Button
            disabled={checking || saving || expired || !!error || undefined}
            onClick={() => void inspect()}
          >
            {checking ? '正在检查…' : '重新检查'}
          </Button>
        )}
      </div>
      {unchanged ? (
        <Alert
          className="desktop-modification-feedback"
          type="info"
          role="status"
          showIcon
          title="候选与原文相同，无需检查或发起文字修改。"
        />
      ) : checking ? (
        <Alert
          className="desktop-modification-feedback"
          type="info"
          role="status"
          showIcon
          title="正在核对同一窗口、原段落和可用能力；没有修改文档。"
        />
      ) : checked ? (
        <>
          <Descriptions
            className="desktop-modification-capabilities"
            bordered
            column={1}
            items={[
              { key: 'source', label: '窗口与原选区', children: '与生成时一致' },
              {
                key: 'replacement',
                label: '替换选中段落',
                children: (
                  <Tag
                    color={desktopCapabilityColors[checked.replacement]}
                    data-state={checked.replacement}
                  >
                    {capabilityLabel[checked.replacement]}
                  </Tag>
                ),
              },
              {
                key: 'readback',
                label: '按选区范围读取',
                children: (
                  <Tag
                    color={desktopCapabilityColors[checked.readback]}
                    data-state={checked.readback}
                  >
                    {checked.readback === 'available'
                      ? '原范围读取一致'
                      : capabilityLabel[checked.readback]}
                  </Tag>
                ),
              },
            ]}
          />
          <p className="task-desktop-observed">
            检查于 {new Date(checked.checkedAt).toLocaleTimeString('zh-CN')} · 有效至{' '}
            {new Date(checked.expiresAt).toLocaleTimeString('zh-CN')}
          </p>
          {!complete && (
            <Alert
              className="desktop-modification-feedback"
              type="warning"
              role="status"
              showIcon
              title={
                checked.replacement === 'unsupported'
                  ? '这个编辑区未提供选中文本替换能力，当前不能确认修改。'
                  : checked.readback === 'unsupported'
                    ? '这个编辑区未提供按范围读取能力，无法核对修改后的文字。'
                    : '有条件尚未核对成功，可以重新检查。'
              }
            />
          )}
          <p>
            这是本次只读检查。系统报告可写和原范围读取成功，都不代表实际写入或写后回读已经通过。
          </p>
        </>
      ) : null}
      {error && (
        <Alert
          className="desktop-modification-feedback"
          type="error"
          role="alert"
          showIcon
          title={error}
          description={<Button onClick={back}>返回窗口重新读取</Button>}
        />
      )}
      {!unchanged && (
        <>
          <p>保存这份方案后，可在任务清单和流程图中继续核对；保存不会修改文档。</p>
          {adoptionUnavailable && (
            <Alert
              className="desktop-modification-feedback"
              type="warning"
              role="status"
              showIcon
              title={adoptionUnavailable}
            />
          )}
          <Button
            type="primary"
            disabled={
              !!adoptionUnavailable ||
              !complete ||
              checking ||
              saving ||
              expired ||
              !!error ||
              !!saveError ||
              undefined
            }
            onClick={() => void save()}
          >
            {saving ? '正在保存方案…' : '保存方案，继续核对'}
          </Button>
          {saveError && (
            <Alert
              className="desktop-modification-feedback"
              type="error"
              role="alert"
              showIcon
              title={saveError}
            />
          )}
        </>
      )}
      <h2>下一步：确认试运行</h2>
      <p>
        保存方案后，在试运行前检查中重新选择窗口与原选区。核对原文、替换文字与能力后，由你明确授权单次修改并回读。本页不会修改文档。
      </p>
    </section>
  );
}
