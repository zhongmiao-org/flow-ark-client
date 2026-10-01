import { useEffect, useId, useRef, type RefObject } from 'react';
import './editor-leave.css';
import './schedule-leave.css';

export default function ScheduleLeaveDialog({
  dialogRef,
  destination,
  creating,
  busy,
  blocked,
  unconfirmed,
  error,
  stay,
  discard,
  save,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  destination: string;
  creating: boolean;
  busy: boolean;
  blocked: boolean;
  unconfirmed: boolean;
  error?: string;
  stay: () => void;
  discard: () => void;
  save: () => void;
}) {
  const titleId = useId(),
    descriptionId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
    continueButton.current?.focus();
  }, [dialogRef]);
  useEffect(() => {
    if (error) heading.current?.focus();
  }, [error]);
  return (
    <dialog
      ref={dialogRef}
      className="editor-leave-dialog schedule-leave-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        stay();
      }}
    >
      <span className={`editor-leave-status${error ? ' is-error' : ''}`}>
        {error ? '保存未完成' : '存在未保存更改'}
      </span>
      <h2 id={titleId} ref={heading} tabIndex={-1}>
        保存计划更改再离开？
      </h2>
      <p id={descriptionId}>
        {creating
          ? '保存会创建并启用一个固定版本的计划'
          : '保存仅修改未来触发的计划，保留原启停状态'}
        ，成功后前往“{destination}”。不保存将放弃本次计划更改。
      </p>
      <p className="editor-leave-note">
        {unconfirmed
          ? '请先继续编辑，选择来源并确认固定当前已保存版本与入口。'
          : '已排队和正在执行的运行保持原状，不追赶错过的触发。'}
      </p>
      {error && (
        <p role="alert" className="editor-leave-error">
          {error}
        </p>
      )}
      <div className="editor-leave-actions">
        <button ref={continueButton} autoFocus disabled={busy} onClick={stay}>
          继续编辑
        </button>
        <button className="editor-leave-discard" disabled={busy} onClick={discard}>
          不保存离开
        </button>
        <button className="primary" disabled={busy || blocked || unconfirmed} onClick={save}>
          {busy ? (creating ? '正在创建…' : '正在保存…') : error ? '重试保存并离开' : '保存并离开'}
        </button>
      </div>
    </dialog>
  );
}
