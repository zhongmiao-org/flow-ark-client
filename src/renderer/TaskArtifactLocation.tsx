import { Button } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import type { RunArtifact } from './task-run-presentation';

export default function TaskArtifactLocation({
  artifact,
  reveal,
}: {
  artifact: RunArtifact;
  reveal: (id: string) => Promise<boolean>;
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const live = useRef(true);
  const button = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const feedbackId = useId();
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      state === 'error' &&
      feedback.current?.getClientRects().length &&
      (document.activeElement === button.current || document.activeElement === document.body)
    )
      feedback.current.focus();
  }, [state]);
  const locate = async () => {
    if (pending.current || !artifact.available) return;
    pending.current = true;
    setState('pending');
    setError('');
    try {
      const accepted = await reveal(artifact.artifactId);
      if (!live.current) return;
      if (!accepted) throw new Error('定位请求未完成，请核对文件状态后重试。');
      setState('sent');
    } catch (reason) {
      if (!live.current) return;
      setError(reason instanceof Error ? reason.message : '暂时无法定位文件，请重试。');
      setState('error');
    } finally {
      pending.current = false;
    }
  };
  const label = state === 'pending' ? '正在定位…' : state === 'error' ? '重新定位文件' : '定位文件';
  return (
    <div className="task-artifact-location">
      <Button
        ref={button}
        disabled={!artifact.available || state === 'pending' || undefined}
        aria-label={`${label}：${artifact.name}`}
        aria-describedby={state !== 'idle' ? feedbackId : undefined}
        onClick={() => void locate()}
      >
        {label}
      </Button>
      {state !== 'idle' && (
        <p
          id={feedbackId}
          ref={feedback}
          tabIndex={state === 'error' ? -1 : undefined}
          role={state === 'error' ? 'alert' : 'status'}
          className={state === 'error' ? 'field-error' : undefined}
        >
          {state === 'pending'
            ? '正在请求定位此文件…'
            : state === 'error'
              ? error
              : '已请求在系统文件管理器中定位此文件。'}
        </p>
      )}
    </div>
  );
}
