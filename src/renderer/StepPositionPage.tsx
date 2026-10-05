import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './editor-workspace-dialog.css';
import './step-position.css';

type Props = {
  title?: string;
  targets: { value: string; label: string }[];
  destination: string;
  setDestination: (value: string) => void;
  moveTo: string;
  setMoveTo: (value: string) => void;
  add: () => void;
  insert: (side: 'before' | 'after') => void;
  duplicate: () => void;
  move: () => void;
  remove: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
  save: () => Promise<unknown>;
  busy: boolean;
  structureError: string;
  referenceRecovery?: ReactNode;
  saveError: string;
  view: (mode: 'all' | 'selected') => void;
  close: () => void;
};
export default function StepPositionPage(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const titleId = useId();
  const [attempted, setAttempted] = useState(false);
  const addTarget = props.targets.find((target) => target.value === props.destination);
  const moveTarget = props.targets.find((target) => target.value === props.moveTo);
  const targetErrorId = useId();
  const error = props.structureError || (attempted ? props.saveError : '');
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    heading.current?.focus();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (error && !props.busy) errorRef.current?.focus();
  }, [error, props.busy]);
  return createPortal(
    <dialog
      ref={dialog}
      className="editor-workspace-dialog step-position-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!props.busy) props.close();
      }}
      onKeyDown={(event) => {
        if (props.busy && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
        }
        if ((event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[')) {
          if ((event.target as HTMLElement).closest('input,textarea,select')) return;
          event.preventDefault();
          event.stopPropagation();
          if (!props.busy) props.close();
        }
      }}
    >
      <div className="step-position-toolbar">
        <button disabled={props.busy} onClick={props.close}>
          ← 返回步骤配置
        </button>
        <nav aria-label="当前位置">步骤编辑与位置</nav>
      </div>
      <div className="step-position-page">
        <header>
          <h1 ref={heading} tabIndex={-1} id={titleId}>
            步骤编辑
          </h1>
          <p>所有操作只修改草稿，不撤销已执行的网页或文件动作。</p>
        </header>
        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="step-position-error">
            {error}
          </p>
        )}
        {props.referenceRecovery}
        <fieldset disabled={props.busy} className="step-position-columns">
          <section className="step-position-card" aria-label="当前步骤与位置">
            <h2>{props.title ? `当前步骤 · ${props.title}` : '当前未选择步骤'}</h2>
            {props.title ? (
              <>
                <label>
                  添加到
                  <span className="step-position-add-target">
                    <select
                      aria-label="动作添加位置"
                      title={addTarget?.label}
                      aria-invalid={!addTarget}
                      aria-describedby={!addTarget ? targetErrorId : undefined}
                      value={addTarget ? props.destination : ''}
                      onChange={(event) => props.setDestination(event.target.value)}
                    >
                      {!addTarget && (
                        <option value="" disabled>
                          原位置已删除，请重新选择
                        </option>
                      )}
                      {props.targets.map((target) => (
                        <option key={target.value} value={target.value}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                    <button type="button" disabled={!addTarget} onClick={props.add}>
                      选择动作
                    </button>
                  </span>
                </label>
                {!addTarget && (
                  <p id={targetErrorId} className="step-position-error" role="alert">
                    添加位置已失效，请先重新选择位置。
                  </p>
                )}
                <label>
                  移动到
                  <select
                    aria-label="步骤移动位置"
                    title={moveTarget?.label}
                    value={props.moveTo}
                    onChange={(event) => props.setMoveTo(event.target.value)}
                  >
                    <option value="">选择移动位置…</option>
                    {props.targets.map((target) => (
                      <option key={target.value} value={target.value}>
                        {target.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="step-position-actions">
                  <button onClick={() => props.insert('before')}>前方插入</button>
                  <button onClick={() => props.insert('after')}>后方插入</button>
                  <button onClick={props.duplicate}>复制子树</button>
                </div>
                <div className="step-position-actions">
                  <button className="primary" disabled={!moveTarget} onClick={props.move}>
                    移动步骤
                  </button>
                  <button className="step-position-delete" onClick={props.remove}>
                    删除步骤
                  </button>
                </div>
              </>
            ) : (
              <p>步骤已删除或不再可用。可撤销恢复，或返回画布选择其他步骤。</p>
            )}
            <p className="step-position-note">
              删除或移动导致引用失效时，保留草稿并指出受影响字段。
            </p>
          </section>
          <section className="step-position-card step-position-draft" aria-label="草稿与视图">
            <h2>草稿与视图</h2>
            <div className="step-position-actions">
              <button disabled={!props.canUndo} onClick={props.undo}>
                撤销
              </button>
              <button disabled={!props.canRedo} onClick={props.redo}>
                重做
              </button>
            </div>
            <button
              className="primary"
              onClick={() => {
                setAttempted(true);
                void props.save();
              }}
            >
              {props.busy
                ? '正在保存…'
                : attempted && props.saveError
                  ? '重试保存草稿'
                  : '保存草稿'}
            </button>
            <button onClick={() => props.view('all')}>显示全图</button>
            <button disabled={!props.title} onClick={() => props.view('selected')}>
              聚焦所选步骤
            </button>
            <p>输入框内使用文本撤销；流程结构撤销不影响活动 Run 的固定快照。</p>
            <p role="status">{props.saved ? '草稿已保存' : '有未保存的更改'}</p>
          </section>
        </fieldset>
      </div>
    </dialog>,
    document.body,
  );
}
