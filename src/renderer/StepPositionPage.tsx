import { Drawer, ConfigProvider, Select, Button } from 'antd';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import EditorWorkspaceToolbar from './EditorWorkspaceToolbar';
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
  duplicate: () => boolean;
  move: () => boolean;
  remove: () => boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
  revision: number;
  save: () => Promise<unknown>;
  busy: boolean;
  structureError: string;
  referenceRecovery?: ReactNode;
  saveError: string;
  view: (mode: 'all' | 'selected') => void;
  close: () => void;
};
export default function StepPositionPage(props: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const origin = useRef(document.activeElement as HTMLElement | null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const wasSaving = useRef(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [notice, setNotice] = useState('');
  const titleId = useId();
  const [attempted, setAttempted] = useState(false);
  const addTarget = props.targets.find((target) => target.value === props.destination);
  const moveTarget = props.targets.find((target) => target.value === props.moveTo);
  const targetErrorId = useId();
  const error = props.structureError || (attempted ? props.saveError : '');
  useEffect(() => {
    const trigger = origin.current;
    return () => {
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, []);
  useEffect(() => {
    if (error && !props.busy) errorRef.current?.focus();
    else if (wasSaving.current && !props.busy) saveButton.current?.focus();
    wasSaving.current = props.busy;
  }, [error, props.busy]);
  useEffect(() => {
    heading.current?.focus();
    setNotice('');
  }, [props.revision]);
  const applyStructure = (operation: () => boolean, message: string) => {
    setNotice('');
    if (operation()) {
      setNotice(message);
      requestAnimationFrame(() => noticeRef.current?.focus());
    }
  };
  return (
    <Drawer
      open
      panelRef={dialog}
      size="calc(100vw - var(--fa-workspace-navigation-width))"
      closable={false}
      mask={{ closable: false }}
      push={false}
      focusable={{ focusTriggerAfterClose: false, trap: true }}
      rootClassName="editor-workspace-overlay"
      keyboard={!props.busy}
      afterOpenChange={(opened) => {
        if (opened) heading.current?.focus();
      }}
      className="editor-workspace-dialog step-position-dialog"
      aria-labelledby={titleId}
      onClose={() => {
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
      <EditorWorkspaceToolbar
        current="步骤编辑与位置"
        back={props.close}
        backLabel="返回步骤配置"
        disabled={props.busy}
      />
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
        {notice && !error && (
          <p ref={noticeRef} tabIndex={-1} role="status" className="step-position-note">
            {notice} {props.saved ? '草稿与已保存内容一致。' : '尚未保存。'}没有启动运行。
          </p>
        )}
        {props.referenceRecovery}
        <ConfigProvider componentDisabled={props.busy || undefined}>
          <fieldset disabled={props.busy} className="step-position-columns">
            <section className="step-position-card" aria-label="当前步骤与位置">
              <h2>{props.title ? `当前步骤 · ${props.title}` : '当前未选择步骤'}</h2>
              {props.title ? (
                <>
                  <label>
                    添加到
                    <span className="step-position-add-target">
                      <Select<string>
                        status={!addTarget ? 'error' : undefined}
                        aria-label="动作添加位置"
                        title={addTarget?.label}
                        aria-invalid={!addTarget}
                        aria-describedby={!addTarget ? targetErrorId : undefined}
                        value={addTarget ? props.destination : ''}
                        onChange={(value) => props.setDestination(value)}
                        options={[
                          ...(!addTarget
                            ? [{ value: '', disabled: true, label: '原位置已删除，请重新选择' }]
                            : []),
                          ...props.targets.map((target) => ({
                            value: target.value,
                            label: target.label,
                          })),
                        ]}
                      />
                      <Button
                        htmlType="button"
                        disabled={!addTarget || undefined}
                        onClick={props.add}
                      >
                        选择动作
                      </Button>
                    </span>
                  </label>
                  {!addTarget && (
                    <p id={targetErrorId} className="step-position-error" role="alert">
                      添加位置已失效，请先重新选择位置。
                    </p>
                  )}
                  <label>
                    移动到
                    <Select<string>
                      aria-label="步骤移动位置"
                      title={moveTarget?.label}
                      value={props.moveTo}
                      onChange={(value) => props.setMoveTo(value)}
                      options={[
                        { value: '', label: '选择移动位置…' },
                        ...props.targets.map((target) => ({
                          value: target.value,
                          label: target.label,
                        })),
                      ]}
                    />
                  </label>
                  <div className="step-position-actions">
                    <Button onClick={() => props.insert('before')}>前方插入</Button>
                    <Button onClick={() => props.insert('after')}>后方插入</Button>
                    <Button
                      onClick={() =>
                        applyStructure(props.duplicate, `已复制「${props.title}」及其子步骤。`)
                      }
                    >
                      复制子树
                    </Button>
                  </div>
                  <div className="step-position-actions">
                    <Button
                      type="primary"
                      disabled={!moveTarget || undefined}
                      onClick={() =>
                        applyStructure(
                          props.move,
                          `已将「${props.title}」移动到「${moveTarget?.label}」。`,
                        )
                      }
                    >
                      移动步骤
                    </Button>
                    <Button
                      className="step-position-delete"
                      onClick={() =>
                        applyStructure(
                          props.remove,
                          `已删除「${props.title}」及其子步骤，可撤销恢复。`,
                        )
                      }
                    >
                      删除步骤
                    </Button>
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
                <Button
                  disabled={!props.canUndo || undefined}
                  onClick={() => {
                    setNotice('');
                    props.undo();
                  }}
                >
                  撤销
                </Button>
                <Button
                  disabled={!props.canRedo || undefined}
                  onClick={() => {
                    setNotice('');
                    props.redo();
                  }}
                >
                  重做
                </Button>
              </div>
              <Button
                ref={saveButton}
                type="primary"
                onClick={() => {
                  setNotice('');
                  setAttempted(true);
                  void props.save();
                }}
              >
                {props.busy
                  ? '正在保存…'
                  : attempted && props.saveError
                    ? '重试保存草稿'
                    : '保存草稿'}
              </Button>
              <Button onClick={() => props.view('all')}>显示全图</Button>
              <Button disabled={!props.title || undefined} onClick={() => props.view('selected')}>
                聚焦所选步骤
              </Button>
              <p>输入框内使用文本撤销；流程结构撤销不影响活动 Run 的固定快照。</p>
              <p role="status">{props.saved ? '草稿已保存' : '有未保存的更改'}</p>
            </section>
          </fieldset>
        </ConfigProvider>
      </div>
    </Drawer>
  );
}
