import { useEffect, useId, useRef, useState } from 'react';
import './editor-leave.css';

export default function EditorLeaveDialog({
  name,
  destination,
  save,
  discard,
  stay,
}: {
  name: string;
  destination: string;
  save: () => Promise<void>;
  discard: () => void;
  stay: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (error) heading.current?.focus();
  }, [error]);
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    element?.showModal();
    continueButton.current?.focus();
    return () => {
      alive.current = false;
      element?.close();
    };
  }, []);
  const persist = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await save();
    } catch (reason) {
      if (alive.current)
        setError(
          (reason instanceof Error ? reason.message : '保存未完成，请重试').replace(
            /^Error invoking remote method 'flowark:request': (?:Error: )?/,
            '',
          ),
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <dialog
      className="editor-leave-dialog"
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked.current) stay();
      }}
    >
      <span className={`editor-leave-status${error ? ' is-error' : ''}`}>
        {error ? '未保存 · 留在当前页' : '存在未保存更改'}
      </span>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>
        {error ? '保存未完成，尚未离开' : '离开前保存更改？'}
      </h2>
      <p id={`${id}-description`}>
        “{name}”的当前输入尚未保存。保存成功后前往“{destination}”；不保存将放弃本次草稿更改。
      </p>
      <p className="editor-leave-note">已开始的运行和固定计划保持原版本。</p>
      {error && (
        <p className="editor-leave-error" role="alert">
          {error}
        </p>
      )}
      <div className="editor-leave-actions">
        <button autoFocus ref={continueButton} disabled={busy} onClick={stay}>
          继续编辑
        </button>
        <button className="editor-leave-discard" disabled={busy} onClick={discard}>
          不保存离开
        </button>
        <button className="primary" disabled={busy} onClick={() => void persist()}>
          {busy ? '正在保存…' : error ? '重试保存并离开' : '保存并离开'}
        </button>
      </div>
    </dialog>
  );
}
