import { Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { Run } from '../shared/types';

export default function TaskRunSource({ run, open }: { run: Run; open: (detail: any) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    return () => {
      request.current++;
    };
  }, []);
  if (!run.rerun) return null;
  const sourceId = run.rerun.runId;
  async function inspect() {
    if (locked.current) return;
    locked.current = true;
    const generation = ++request.current;
    setPending(true);
    setError('');
    try {
      const detail = await window.flowark.request('run.detail', { id: sourceId });
      if (generation !== request.current) return;
      if (detail?.run?.id !== sourceId) throw new Error('返回的记录与关联原运行不一致');
      open(detail);
    } catch (e) {
      if (generation === request.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation === request.current) {
        locked.current = false;
        setPending(false);
      }
    }
  }
  return (
    <span className="task-run-source">
      关联{' '}
      <Button
        htmlType="button"
        aria-label="查看关联的原运行记录"
        disabled={pending || undefined}
        onClick={() => void inspect()}
      >
        原运行记录
      </Button>
      {pending && <span role="status"> · 正在读取原运行…</span>}
      {error && (
        <span className="field-error" role="alert">
          {' '}
          · {error}
        </span>
      )}
    </span>
  );
}
