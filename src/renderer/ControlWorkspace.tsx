import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FlowRecord, Step } from '../shared/types';
import DiagramCanvas from './DiagramCanvas';
import { buildTaskDiagram } from './task-diagram';
import { flatten } from './flow-editing';
import { taskStepTitle } from './task-step-title';
import EditorWorkspaceToolbar from './EditorWorkspaceToolbar';
import { referenceChoices, referenceScope } from './value-references';
import LogicNodeConfiguration from './LogicNodeConfiguration';
import ValueField from './ValueField';
import { kinds } from './node-kinds';
import './editor-workspace-dialog.css';
import './control-workspace.css';

type Props = {
  record: FlowRecord;
  selected: string;
  select: (id: string) => boolean;
  change: (node: Step) => void;
  destination: string;
  setDestination: (value: string) => void;
  targets: { value: string; label: string }[];
  add: () => void;
  edit: () => void;
  close: () => void;
  save: () => Promise<unknown>;
  busy: boolean;
  saved: boolean;
  error: string;
  clearError: () => void;
};
export default function ControlWorkspace(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const currentHeading = useRef<HTMLHeadingElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const wasSaving = useRef(false);
  const titleId = useId();
  const [attemptedSave, setAttemptedSave] = useState(false);
  const steps = flatten(props.record.flow.steps);
  const node = steps.find((step) => step.id === props.selected);
  const destination = props.targets.find((target) => target.value === props.destination);
  const diagram = buildTaskDiagram(
    props.record.flow,
    props.selected,
    { bindings: props.record.bindings },
    'control',
  );
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
    if (props.error && !props.busy) {
      if (!document.activeElement?.closest('[aria-invalid="true"]')) errorRef.current?.focus();
    } else if (wasSaving.current && !props.busy) saveButton.current?.focus();
    wasSaving.current = props.busy;
  }, [props.error, props.busy]);
  const selectRelated = (id: string) => {
    if (props.select(id)) requestAnimationFrame(() => currentHeading.current?.focus());
  };
  const related =
    node?.type === 'loop'
      ? flatten(node.body).find((step) => step.type === 'condition' || step.type === 'human')
      : undefined;
  const dataSource = node
    ? referenceScope(props.record.flow.steps, node.id)
        ?.steps.filter((step) => step.type === 'value')
        .at(-1)
    : undefined;
  const supported = node && ['value', 'condition', 'assert', 'loop', 'human'].includes(node.type);
  return createPortal(
    <dialog
      ref={dialog}
      className="editor-workspace-dialog control-workspace-dialog"
      data-compact-navigation="true"
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
          if (
            (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (!props.busy) props.close();
        }
      }}
    >
      <EditorWorkspaceToolbar current="条件与串行循环" back={props.close} disabled={props.busy} />
      <div className="control-workspace-page">
        <header>
          <h1 id={titleId} ref={heading} tabIndex={-1}>
            条件与串行循环
          </h1>
          <p>逐项执行、真假分支与明确汇合；回边仅表示既有串行循环。</p>
        </header>
        {props.error && (
          <div ref={errorRef} tabIndex={-1} role="alert" className="control-workspace-error">
            <p>{props.error}</p>
            <button onClick={props.clearError}>关闭提示</button>
          </div>
        )}
        <div className="control-workspace-columns">
          <div className="control-workspace-canvas" aria-label="条件与循环流程图">
            <DiagramCanvas
              taskPresentation
              nodes={diagram.nodes}
              edges={diagram.edges}
              selected={props.selected}
              select={props.select}
              active={!props.busy}
            />
          </div>
          <fieldset disabled={props.busy} className="control-workspace-card">
            {node ? (
              <>
                <h2 ref={currentHeading} tabIndex={-1}>
                  {kinds[node.type].label}
                </h2>
                <p className="control-workspace-current">
                  {String(steps.indexOf(node) + 1).padStart(2, '0')} {taskStepTitle(node)}
                </p>
                {node.type === 'loop' ? (
                  <ValueField
                    compactReference
                    label="集合来源"
                    value={node.items}
                    defaultValue={[]}
                    choices={referenceChoices(props.record.flow, node.id)}
                    change={(items) => props.change({ ...node, items })}
                  />
                ) : supported ? (
                  <LogicNodeConfiguration
                    key={node.id}
                    node={node}
                    choices={referenceChoices(props.record.flow, node.id)}
                    change={props.change}
                  />
                ) : (
                  <p>此步骤的详细配置在步骤编辑器中。</p>
                )}
                <label htmlFor={titleId + '-destination'}>添加位置</label>
                <div className="control-workspace-add">
                  <select
                    id={titleId + '-destination'}
                    value={destination ? props.destination : ''}
                    title={destination?.label}
                    aria-invalid={!destination}
                    aria-describedby={!destination ? titleId + '-destination-error' : undefined}
                    onChange={(event) => props.setDestination(event.target.value)}
                  >
                    {!destination && (
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
                  <button disabled={!destination} onClick={props.add}>
                    选择动作
                  </button>
                </div>
                {!destination && (
                  <p id={titleId + '-destination-error'} className="field-error" role="alert">
                    添加位置已失效，请先重新选择位置。
                  </p>
                )}
                {node.type === 'loop' && (
                  <p>空集合直接走完成路径；每次迭代分别记录步骤实例和输出。</p>
                )}
                {node.type === 'condition' && <p>空分支直接汇合，不会创建或执行额外步骤。</p>}
                {related && (
                  <button onClick={() => selectRelated(related.id)}>
                    配置 {taskStepTitle(related)}
                  </button>
                )}
                {dataSource && (
                  <button onClick={() => selectRelated(dataSource.id)}>
                    配置数据 · {taskStepTitle(dataSource)}
                  </button>
                )}
                <button onClick={props.edit}>编辑当前步骤与期限</button>
              </>
            ) : (
              <>
                <h2>选择一个步骤</h2>
                <p>在左侧流程图选择条件、循环或其他步骤。</p>
              </>
            )}
            <button
              ref={saveButton}
              className="primary"
              onClick={() => {
                setAttemptedSave(true);
                void props.save();
              }}
            >
              {props.busy
                ? '正在保存…'
                : attemptedSave && props.error
                  ? '重试保存草稿'
                  : '保存草稿'}
            </button>
            <p role="status">
              {props.saved ? '草稿已保存' : '有未保存的更改'} · 修改不影响已开始的运行。
            </p>
          </fieldset>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
