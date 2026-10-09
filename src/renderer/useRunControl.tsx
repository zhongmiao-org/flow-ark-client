import { Alert, Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { Event, Run } from '../shared/types';
import type { RunPresentation } from '../shared/run-presentation';

type Command = {
  action: string;
  state: string;
  sequence: number;
  accepted: boolean;
};

export function useRunControl({
  run,
  events,
  view,
  control,
  reload,
}: {
  run: Run;
  events: Event[];
  view: RunPresentation;
  control: (id: string, action: string) => Promise<boolean>;
  reload: () => Promise<void>;
}) {
  const [controlError, setControlError] = useState('');
  const [controlBusy, setControlBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [command, setCommand] = useState<Command | null>(null);
  const sending = useRef(false);
  const reading = useRef(false);
  const alive = useRef(true);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const origin = useRef<Element | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!command?.accepted) return;
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state);
    const progressed = events.some(
      (event) =>
        event.runId === run.id &&
        event.sequence > command.sequence &&
        (event.type === 'debug-pause' || event.type === 'node-start'),
    );
    if (
      terminal ||
      view.closing ||
      (command.action !== 'cancel' &&
        view.activity === 'active' &&
        (run.state !== command.state || (command.action !== 'pause' && progressed)))
    )
      setCommand(null);
  }, [command, events, run.id, run.state, view.closing, view.activity]);
  useEffect(() => {
    if (
      controlError &&
      (document.activeElement === origin.current || document.activeElement === document.body)
    )
      feedbackRef.current?.focus();
  }, [controlError]);
  const sendControl = async (action: string) => {
    if (
      sending.current ||
      reading.current ||
      (command && (action !== 'cancel' || command.action === 'cancel'))
    )
      return;
    sending.current = true;
    origin.current = document.activeElement;
    setControlBusy(true);
    setControlError('');
    const request: Command = {
      action,
      state: run.state,
      sequence: events.reduce(
        (latest, event) => (event.runId === run.id ? Math.max(latest, event.sequence) : latest),
        0,
      ),
      accepted: false,
    };
    setCommand(request);
    let accepted: boolean | undefined;
    try {
      accepted = await control(run.id, action);
      if (!alive.current) return;
      setCommand(accepted ? { ...request, accepted: true } : null);
      await reload();
      if (alive.current && !accepted)
        setControlError('本次控制未执行，运行可能已经结束，请核对最新状态。');
    } catch (error) {
      if (!alive.current) return;
      if (!accepted) setCommand(null);
      setControlError(
        (accepted === true
          ? '控制请求已接收，但状态读取失败：'
          : accepted === false
            ? '本次控制未执行，但状态读取失败：'
            : '控制请求未确认，请先刷新状态：') +
          (error instanceof Error ? error.message : '暂时无法读取运行状态'),
      );
    } finally {
      sending.current = false;
      if (alive.current) setControlBusy(false);
    }
  };
  const refreshControl = async () => {
    if (sending.current || reading.current) return;
    reading.current = true;
    origin.current = document.activeElement;
    setRefreshing(true);
    setControlError('');
    try {
      await reload();
    } catch (error) {
      if (alive.current) setControlError(error instanceof Error ? error.message : '状态读取失败');
    } finally {
      reading.current = false;
      if (alive.current) setRefreshing(false);
    }
  };
  const controlPending = controlBusy || refreshing || !!command;
  const controlNote =
    command &&
    (command.accepted
      ? {
          pause: '暂停请求已接收，将在步骤边界暂停；当前步骤可能仍在执行。',
          resume: '继续请求已接收，等待执行状态更新。',
          step: '单步请求已接收，等待新的步骤记录；不会重复发送。',
          cancel: '取消请求已接收，等待停止与资源回收；尚未确认结束。',
        }[command.action]
      : '正在发送控制请求…');
  return {
    controlError,
    controlBusy: controlBusy || refreshing,
    controlPending,
    controlNote,
    command,
    sendControl,
    refreshControl,
    refreshing,
    feedbackRef,
  };
}

export function RunControlFeedback({
  controller,
  showNote = false,
}: {
  controller: ReturnType<typeof useRunControl>;
  showNote?: boolean;
}) {
  const { controlError, controlPending, controlNote, controlBusy, refreshing } = controller;
  if (!controlError && !controlPending && !refreshing) return null;
  return (
    <div
      ref={controller.feedbackRef}
      tabIndex={-1}
      className="run-control-feedback"
      aria-label="运行控制状态"
    >
      <Alert
        type={controlError ? 'error' : 'info'}
        role={controlError ? 'alert' : 'status'}
        showIcon
        title={
          controlError ||
          (showNote && controlNote) ||
          (refreshing ? '正在刷新状态…' : '正在核对运行状态')
        }
        description={showNote && controlError && controlNote ? controlNote : undefined}
        action={
          <Button
            disabled={controlBusy || refreshing || undefined}
            onClick={() => void controller.refreshControl()}
          >
            {refreshing ? '正在刷新状态…' : '刷新状态'}
          </Button>
        }
      />
    </div>
  );
}
