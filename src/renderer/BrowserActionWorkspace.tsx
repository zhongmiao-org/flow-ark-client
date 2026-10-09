import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import EditorWorkspaceToolbar from './EditorWorkspaceToolbar';
import type { FlowRecord } from '../shared/types';
import type { FramePath } from '../shared/contracts.generated';
import { browserActions, type BrowserNode, type BrowserOperation } from './browser-actions';
import BrowserNodeConfiguration from './BrowserNodeConfiguration';
import NodeTiming from './NodeTiming';
import { referenceChoices } from './value-references';
import { flowOutline } from './flow-outline';
import { taskStepTitle } from './task-step-title';
import './editor-workspace-dialog.css';
import './browser-action-workspace.css';

const groups: { title: string; operations: BrowserOperation[]; detail: string }[] = [
  {
    title: '导航 / 等待',
    operations: ['navigate', 'wait'],
    detail: '打开指定网址，或等待目标元素可见。',
  },
  {
    title: '填写 / 读取',
    operations: ['fill', 'read', 'inputValue', 'click'],
    detail: '填写内容、读取文字与输入值，或点击目标元素。',
  },
  {
    title: '下拉 / 勾选',
    operations: ['select', 'check'],
    detail: '使用选项值或布尔值配置原生表单控件。',
  },
  {
    title: '上传 / 下载',
    operations: ['upload', 'download'],
    detail: '上传使用已绑定目录中的文件；下载保存为运行产物。',
  },
  {
    title: '按键 / 截图',
    operations: ['press', 'screenshot'],
    detail: '向目标控件发送表单按键，或保存顶层网页视口。',
  },
];

type Props = {
  record: FlowRecord;
  node: BrowserNode;
  change: (node: BrowserNode) => void;
  guard: () => boolean;
  close: () => void;
  showBrowser: () => void;
  error: string;
  clearError: () => void;
};

export default function BrowserActionWorkspace(props: Props) {
  const { node } = props;
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const locator = useRef<HTMLInputElement>(null);
  const frameInput = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const ordinal = flowOutline(props.record.flow.steps).byId.get(node.id)?.ordinal;
  const path =
    node.version >= 2 ? (node as Extract<BrowserNode, { version: 2 | 3 }>).framePath : [];
  const pathKey = JSON.stringify(path);
  const [frames, setFrames] = useState(path.join('\n'));
  const [frameError, setFrameError] = useState('');
  const topLevel = ['navigate', 'screenshot'].includes(node.operation);
  const currentGroup = groups.findIndex((group) => group.operations.includes(node.operation));
  const previousGroup = useRef(currentGroup);
  useLayoutEffect(() => {
    if (previousGroup.current === currentGroup) return;
    previousGroup.current = currentGroup;
    const target = dialog.current?.querySelector<HTMLElement>('[data-current] h2');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start' });
  }, [currentGroup]);
  useEffect(() => {
    setFrames(path.join('\n'));
    setFrameError('');
  }, [pathKey]);
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
    if (props.error && !document.activeElement?.closest('[aria-invalid="true"]'))
      errorRef.current?.focus();
  }, [props.error]);
  const operation = (value: BrowserOperation) => {
    if (value === node.operation || !props.guard()) return;
    props.change({
      ...node,
      version: node.version === 3 ? 3 : browserActions[value].version,
      operation: value,
      value: structuredClone(browserActions[value].value),
      framePath: ['navigate', 'screenshot'].includes(value) ? [] : path,
    } as BrowserNode);
  };
  const finish = () => {
    if (props.guard()) props.close();
  };
  const showBrowser = () => {
    if (props.guard()) props.showBrowser();
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="editor-workspace-dialog browser-action-workspace"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        finish();
      }}
      onKeyDown={(event) => {
        if ((event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[')) {
          if (
            (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
    >
      <EditorWorkspaceToolbar current="网页动作配置" back={finish} showBrowser={showBrowser} />
      <div className="browser-action-page">
        <header>
          <h1 ref={heading} id={id} tabIndex={-1}>
            网页动作配置
          </h1>
          <p>
            当前步骤：{ordinal ? `${String(ordinal).padStart(2, '0')} ` : ''}
            {taskStepTitle(node)}。切换动作会恢复该动作的默认输入；应用后返回流程编排保存。
          </p>
        </header>
        {props.error && (
          <div ref={errorRef} tabIndex={-1} role="alert" className="browser-action-error">
            <p>{props.error}</p>
            <button
              onClick={() => {
                props.clearError();
                heading.current?.focus();
              }}
            >
              关闭提示
            </button>
          </div>
        )}
        <div className="browser-action-grid">
          {groups.map((group, index) => {
            const active = group.operations.includes(node.operation);
            return (
              <section
                key={group.title}
                className="browser-action-card"
                aria-label={group.title}
                data-current={active || undefined}
              >
                <h2 tabIndex={-1}>
                  {group.title}
                  {active && <span>当前动作</span>}
                </h2>
                <label htmlFor={`${id}-operation-${index}`}>操作</label>
                <select
                  id={`${id}-operation-${index}`}
                  value={active ? node.operation : ''}
                  onChange={(event) => operation(event.target.value as BrowserOperation)}
                >
                  <option value="" disabled>
                    选择动作以配置此步骤
                  </option>
                  {group.operations.map((value) => (
                    <option key={value} value={value}>
                      {browserActions[value].label}
                    </option>
                  ))}
                </select>
                {active ? (
                  <>
                    {!topLevel && (
                      <div className="browser-action-target">
                        <span>目标元素</span>
                        <button onClick={() => locator.current?.focus()}>
                          {node.selector || '设置目标元素选择器'}
                        </button>
                      </div>
                    )}
                    <BrowserNodeConfiguration
                      key={node.operation}
                      fieldsOnly
                      node={node}
                      choices={referenceChoices(props.record.flow, node.id)}
                      change={props.change}
                    />
                    <p>
                      {browserActions[node.operation].detail}。
                      {['download', 'screenshot'].includes(node.operation)
                        ? '结果进入本次运行产物。'
                        : ''}
                    </p>
                    <button className="primary" onClick={finish}>
                      应用配置
                    </button>
                  </>
                ) : (
                  <>
                    <p className="browser-action-description">{group.detail}</p>
                    <p>选择操作将切换当前步骤，不会添加或执行新步骤。</p>
                    <button onClick={() => operation(group.operations[0])}>配置此类动作</button>
                  </>
                )}
              </section>
            );
          })}
          <section
            className="browser-action-card browser-action-locator"
            aria-label="定位与期限"
            data-value-invalid={frameError || undefined}
          >
            <h2>定位与期限</h2>
            {topLevel && <p>此动作作用于顶层网页，不使用元素定位和 iframe 路径。</p>}
            <label htmlFor={id + '-selector'}>选择器</label>
            <input
              ref={locator}
              id={id + '-selector'}
              disabled={topLevel}
              value={node.selector}
              placeholder="目标元素的 CSS 选择器"
              onChange={(event) => props.change({ ...node, selector: event.target.value })}
            />
            <label htmlFor={id + '-frames'}>iframe 路径</label>
            <textarea
              ref={frameInput}
              id={id + '-frames'}
              disabled={topLevel}
              rows={1}
              value={frames}
              aria-invalid={!!frameError}
              aria-describedby={`${id}-frame-help${frameError ? ` ${id}-frame-error` : ''}`}
              placeholder="每行一层；留空表示顶层页面"
              onChange={(event) => {
                const text = event.target.value;
                setFrames(text);
                const next = text
                  .split('\n')
                  .map((part) => part.trim())
                  .filter(Boolean);
                if (next.length > 8) {
                  setFrameError('iframe 路径最多 8 层，请修正后再应用或切换动作。');
                  return;
                }
                setFrameError('');
                props.change({
                  ...node,
                  version: node.version === 3 ? 3 : 2,
                  framePath: next as FramePath,
                } as BrowserNode);
              }}
            />
            <details>
              <summary>定位规则</summary>
              <p id={id + '-frame-help'}>
                {topLevel
                  ? '此动作作用于顶层网页，不使用元素定位和 iframe 路径。'
                  : '从外到内，最多 8 层，每层必须唯一匹配。可返回网页面板拾取并验证。'}
              </p>
            </details>
            {frameError && (
              <>
                <p id={id + '-frame-error'} role="alert" className="field-error">
                  {frameError}
                </p>
                <button
                  onClick={() => {
                    setFrames(path.join('\n'));
                    setFrameError('');
                    frameInput.current?.focus();
                  }}
                >
                  恢复已应用路径
                </button>
              </>
            )}
            <NodeTiming compact node={node} change={(next) => props.change(next as BrowserNode)} />
            <button className="primary" onClick={finish}>
              应用配置
            </button>
          </section>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
