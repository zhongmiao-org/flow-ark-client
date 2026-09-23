import { useEffect, useId, useRef, useState } from 'react';
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
}: {
  candidate: DesktopPlanResponse;
  unchanged: boolean;
  back: () => void;
}) {
  const titleId = useId();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<DesktopPlanInspection>();
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const epoch = useRef(0),
    locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const inspect = async () => {
    if (locked.current || unchanged || candidate.expiresAt <= Date.now()) return;
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
    locked.current = false;
    void inspect();
    const timer = setTimeout(
      () => {
        epoch.current++;
        locked.current = false;
        setChecking(false);
        setChecked(undefined);
        setExpired(true);
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
  return (
    <section className="desktop-modification-check" aria-labelledby={titleId}>
      <div className="desktop-modification-check-title">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          修改条件
        </h2>
        {!unchanged && (
          <button disabled={checking || expired || !!error} onClick={() => void inspect()}>
            {checking ? '正在检查…' : '重新检查'}
          </button>
        )}
      </div>
      {unchanged ? (
        <p role="status">候选与原文相同，无需检查或发起文字修改。</p>
      ) : checking ? (
        <p role="status">正在核对同一窗口、原段落和可用能力；没有修改文档。</p>
      ) : checked ? (
        <>
          <dl>
            <div>
              <dt>窗口与原选区</dt>
              <dd>与生成时一致</dd>
            </div>
            <div data-state={checked.replacement}>
              <dt>替换选中段落</dt>
              <dd>{capabilityLabel[checked.replacement]}</dd>
            </div>
            <div data-state={checked.readback}>
              <dt>按选区范围读取</dt>
              <dd>
                {checked.readback === 'available'
                  ? '原范围读取一致'
                  : capabilityLabel[checked.readback]}
              </dd>
            </div>
          </dl>
          <p className="task-desktop-observed">
            检查于 {new Date(checked.checkedAt).toLocaleTimeString('zh-CN')} · 有效至{' '}
            {new Date(checked.expiresAt).toLocaleTimeString('zh-CN')}
          </p>
          {!complete && (
            <p className="ai-task-note" role="status">
              {checked.replacement === 'unsupported'
                ? '这个编辑区未提供选中文本替换能力，当前不能确认修改。'
                : checked.readback === 'unsupported'
                  ? '这个编辑区未提供按范围读取能力，无法核对修改后的文字。'
                  : '有条件尚未核对成功，可以重新检查。'}
            </p>
          )}
          <p>
            这是本次只读检查。系统报告可写和原范围读取成功，都不代表实际写入或写后回读已经通过。
          </p>
        </>
      ) : null}
      {error && (
        <div role="alert">
          <p className="ai-task-note ai-task-failure">{error}</p>
          <button onClick={back}>返回窗口重新读取</button>
        </div>
      )}
      <h2>本次授权</h2>
      <label className="ai-task-checkbox">
        <input type="checkbox" checked={false} disabled />
        读取选区、替换选区并回读
      </label>
      <p>
        {complete
          ? '窗口与选区条件已核对，固定运行和写后回读尚未接入。'
          : '固定运行和写后回读尚未接入。'}
        本次未授予修改权限，原文未修改。
      </p>
      <button className="primary" disabled>
        确认修改并试运行 · 尚未开放
      </button>
    </section>
  );
}
