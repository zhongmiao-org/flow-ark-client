import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import EditorWorkspaceToolbar from './EditorWorkspaceToolbar';
import type { FlowRecord, Step } from '../shared/types';
import { flatten } from './flow-editing';
import { taskStepTitle } from './task-step-title';
import { taskStepValue } from './task-step-presentation';
import { referenceChoices } from './value-references';
import ResourceNodeConfiguration from './ResourceNodeConfiguration';
import { newStep } from './node-defaults';
import { resourceOperation, type FileNode } from './resource-form-model';
import './editor-workspace-dialog.css';
import './resource-workspace.css';

type ResourceStep = Extract<Step, { type: 'http' | 'file' | 'excel' }>;
const groups = [
  { title: 'HTTP 请求', type: 'http', operations: [] },
  { title: '文件读取 / 写入', type: 'file', operations: ['read', 'write', 'create'] },
  { title: '文件复制 / ZIP', type: 'file', operations: ['copy', 'archive'] },
  { title: 'Excel 读取', type: 'excel', operations: ['read'] },
  { title: 'Excel 写入', type: 'excel', operations: ['write'] },
  { title: '模板工作簿映射', type: 'excel', operations: ['fill', 'map'] },
];
const matchesGroup = (step: Step, group: (typeof groups)[number]) =>
  step.type === group.type &&
  (step.type === 'http' || ('operation' in step && group.operations.includes(step.operation)));
function fields(node: ResourceStep, record: FlowRecord): [string, string][] {
  const value = (input: unknown) => taskStepValue(input, record.flow, node.id);
  if (node.type === 'http')
    return [
      ['方法 / URL', node.method + ' / ' + value(node.url)],
      ['请求头', value(node.headers)],
      ['请求体', node.method === 'GET' ? 'GET 不发送请求体' : value(node.body)],
    ];
  const resource = node.binding + ' / ' + value(node.name);
  if (node.type === 'file') {
    if (node.operation === 'copy')
      return [
        ['源文件', value(node.content)],
        ['目标位置', resource],
        ['资源绑定', record.bindings.files[node.binding] || '尚未选择本机目录'],
      ];
    if (node.operation === 'archive')
      return [
        ['源文件列表', value(node.files)],
        ['归档位置', resource],
        ['资源绑定', record.bindings.files[node.binding] || '尚未选择本机目录'],
      ];
    return [
      ['操作', { read: '读取', write: '写入（可能覆盖）', create: '新建文本文件' }[node.operation]],
      ['资源', resource],
      ['内容', node.operation === 'read' ? '运行时读取文件内容' : value(node.content)],
    ];
  }
  if (node.operation === 'read')
    return [
      ['工作簿', resource],
      ['工作表', '首个工作表'],
      ['输出', '保留空行与原始行列位置'],
    ];
  if (node.operation === 'write')
    return [
      ['目标', resource],
      ['工作表', 'Sheet1'],
      ['矩阵', value(node.rows)],
    ];
  if (node.operation === 'fill')
    return [
      ['模板', value(node.templateName)],
      ['单元格映射', value(node.cells)],
      ['输出名称', resource],
    ];
  return [
    ['数据源', value(node.rows)],
    ['字段映射', node.operation === 'map' ? `${node.mappings.length} 个字段` : '未设置'],
    ['输出名称', resource],
  ];
}
type Props = {
  record: FlowRecord;
  selected: string;
  select: (id: string) => void;
  change: (node: Step) => void;
  choose: (binding: string) => void;
  add: (node: Step) => void;
  guard: () => boolean;
  close: () => void;
  showBrowser: () => void;
  openExcel: (id: string) => void;
  error: string;
  clearError: () => void;
};
export default function ResourceWorkspace(props: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const steps = flatten(props.record.flow.steps);
  const selected = steps.find((step) => step.id === props.selected);
  const currentGroup = groups.findIndex((group) => selected && matchesGroup(selected, group));
  const previousGroup = useRef(currentGroup);
  useLayoutEffect(() => {
    if (previousGroup.current === currentGroup) return;
    previousGroup.current = currentGroup;
    const target = dialog.current?.querySelector<HTMLElement>('[data-current] h2');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start' });
  }, [currentGroup]);
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
  const finish = () => {
    if (props.guard()) props.close();
  };
  const select = (nodeId: string) => {
    if (props.guard()) {
      props.select(nodeId);
      requestAnimationFrame(() =>
        dialog.current?.querySelector<HTMLElement>('[data-current] h2')?.focus(),
      );
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="editor-workspace-dialog resource-workspace"
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
      <EditorWorkspaceToolbar
        current="HTTP文件与表格配置"
        back={finish}
        showBrowser={() => {
          if (props.guard()) props.showBrowser();
        }}
      />
      <div className="resource-workspace-page">
        <header>
          <h1 id={id} ref={heading} tabIndex={-1}>
            HTTP文件与表格配置
          </h1>
          <p>
            配置当前流程中的请求、文件与工作簿步骤。字段支持固定值和变量引用，应用后返回编排页保存。
          </p>
        </header>
        {props.error && (
          <div className="resource-workspace-error" role="alert">
            <p>{props.error}</p>
            <button onClick={props.clearError}>关闭提示</button>
          </div>
        )}
        <div className="resource-workspace-grid">
          {groups.map((group, index) => {
            const matches = steps.filter((step) => matchesGroup(step, group)) as ResourceStep[];
            const node = matches.find((step) => step.id === props.selected) ?? matches[0];
            const active = node?.id === props.selected;
            return (
              <section
                key={group.title}
                className="resource-workspace-card"
                aria-label={group.title}
                data-current={active || undefined}
              >
                <h2 tabIndex={-1}>
                  {group.title}
                  {active && <span>当前步骤</span>}
                </h2>
                {node && matches.length === 1 && (
                  <p className="resource-workspace-step">
                    {String(steps.indexOf(node) + 1).padStart(2, '0')} {taskStepTitle(node)}
                  </p>
                )}
                {matches.length > 1 && (
                  <>
                    <label htmlFor={`${id}-${index}`}>流程步骤</label>
                    <select
                      id={`${id}-${index}`}
                      value={node?.id}
                      onChange={(event) => select(event.target.value)}
                    >
                      {matches.map((step) => (
                        <option key={step.id} value={step.id}>
                          {String(steps.findIndex((item) => item.id === step.id) + 1).padStart(
                            2,
                            '0',
                          )}{' '}
                          {taskStepTitle(step)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {node ? (
                  active ? (
                    <>
                      <ResourceNodeConfiguration
                        compact
                        guard={props.guard}
                        key={node.id}
                        node={node}
                        choices={referenceChoices(props.record.flow, node.id)}
                        change={props.change}
                        bindings={props.record.bindings}
                        choose={(binding) => {
                          if (props.guard()) props.choose(binding);
                        }}
                      />
                      {node.type === 'excel' && node.operation === 'map' && (
                        <button
                          onClick={() => {
                            if (props.guard()) props.openExcel(node.id);
                          }}
                        >
                          打开字段映射编辑器
                        </button>
                      )}
                      <button className="primary" onClick={finish}>
                        应用配置
                      </button>
                    </>
                  ) : (
                    <>
                      <dl>
                        {fields(node, props.record).map(([label, text]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd title={text}>{text}</dd>
                          </div>
                        ))}
                      </dl>
                      <button className="primary" onClick={() => select(node.id)}>
                        配置此步骤
                      </button>
                    </>
                  )
                ) : (
                  <>
                    <p className="resource-workspace-empty">当前流程尚无此类步骤。</p>
                    <p>添加后先配置资源和输入，保存草稿不会执行步骤。</p>
                    <button
                      onClick={() => {
                        if (!props.guard()) return;
                        const draft = newStep(group.type);
                        props.add(
                          group.type === 'http'
                            ? draft
                            : resourceOperation(draft as FileNode, group.operations[0]),
                        );
                        requestAnimationFrame(() =>
                          dialog.current?.querySelector<HTMLElement>('[data-current] h2')?.focus(),
                        );
                      }}
                    >
                      添加到主流程末尾
                    </button>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
