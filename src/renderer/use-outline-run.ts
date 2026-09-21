import { useEffect, useState } from 'react';
import type { RunPresentationInput } from '../shared/run-presentation';

export function useOutlineRun(visible: boolean, flowId: string, activeRunId?: string) {
  const [observation, setObservation] = useState<{
    detail?: RunPresentationInput;
    at: number;
    error?: string;
  }>({ at: 0 });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!visible) return;
    let live = true,
      pending = false;
    setObservation({ at: 0 });
    async function read() {
      if (pending) return;
      pending = true;
      try {
        const id =
          activeRunId ??
          (await window.flowark.request('run.list', { flowId, limit: 1 })).runs[0]?.id;
        if (!live) return;
        setObservation((old) => (old.detail?.run.id === id ? old : { at: 0 }));
        const detail: RunPresentationInput | undefined = id
          ? await window.flowark.request('run.detail', { id })
          : undefined;
        if (!live) return;
        if (
          detail &&
          (detail.run.id !== id || detail.run.flowId !== flowId || detail.snapshot?.id !== flowId)
        )
          throw new Error('运行快照与当前流程不匹配');
        const observedAt = detail ? Date.parse(detail.execution?.observedAt ?? '') : Date.now();
        setObservation({
          detail,
          at: Number.isFinite(observedAt) && observedAt <= Date.now() + 1000 ? observedAt : 0,
        });
      } catch (e) {
        if (live) setObservation((old) => ({ ...old, error: (e as Error).message }));
      } finally {
        pending = false;
      }
    }
    void read();
    const poll = setInterval(() => void read(), 1500);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => {
      live = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [visible, flowId, activeRunId]);
  const stale = !observation.at || now - observation.at > 5000;
  const reason =
    observation.error || (stale ? '正在核对运行状态，暂不显示当前执行位置' : undefined);
  return {
    detail: observation.detail,
    fresh: !reason,
    reason,
    observed: observation.detail
      ? { ...observation.detail, fault: observation.detail.fault ?? reason }
      : undefined,
  };
}
