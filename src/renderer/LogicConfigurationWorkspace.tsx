import { Card, Drawer, ConfigProvider, Select, Button, Descriptions, Alert } from 'antd';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import EditorWorkspaceToolbar from './EditorWorkspaceToolbar';
import ActionButton from './ActionButton';
import type { FlowRecord, Step } from '../shared/types';
import { flatten } from './flow-editing';
import { stepTitle } from './flow-outline';
import { taskStepValue } from './task-step-presentation';
import { referenceChoices } from './value-references';
import { newStep } from './node-defaults';
import LogicNodeConfiguration from './LogicNodeConfiguration';
import NodeTiming from './NodeTiming';
import './editor-workspace-dialog.css';
import './resource-workspace.css';
import './logic-configuration-workspace.css';

const groups = [
  { title: '数据', type: 'value' },
  { title: '条件分支', type: 'condition' },
  { title: '结果断言', type: 'assert' },
  { title: '串行循环', type: 'loop' },
  { title: '等待人工', type: 'human' },
];
const operators = {
  equals: '等于',
  notEquals: '不等于',
  contains: '包含',
  gt: '大于',
  exists: '不是空值',
};
function fields(node: Step, record: FlowRecord): [string, string][] {
  const value = (input: unknown) => taskStepValue(input, record.flow, node.id);
  if (node.type === 'value')
    return [
      ['值', value(node.value)],
      ['输出', '当前数据值'],
      ['用途', '供后续步骤引用'],
    ];
  if (node.type === 'condition' || node.type === 'assert')
    return [
      ['判断值', value(node.actual)],
      [
        '判断方式',
        operators[node.operator] + (node.operator === 'exists' ? '' : ' / ' + value(node.expected)),
      ],
      [
        node.type === 'condition' ? '分支' : '失败处理',
        node.type === 'condition'
          ? `成立 ${node.then.length} 步 / 否则 ${node.else.length} 步`
          : '中止并记录错误',
      ],
    ];
  if (node.type === 'loop')
    return [
      ['集合', value(node.items)],
      ['体内变量', 'item / index'],
      ['执行', `逐项串行 · ${node.body.length} 个直接子步骤`],
    ];
  if (node.type === 'human')
    return [
      ['提示', node.message],
      ['确认', '等待用户继续'],
      ['期限', node.timeoutMs === undefined ? '无自身默认期限' : `${node.timeoutMs} 毫秒`],
    ];
  return [];
}
type Props = {
  record: FlowRecord;
  selected: string;
  select: (id: string) => void;
  change: (node: Step) => void;
  changeTiming: (node: Step) => void;
  add: (node: Step) => void;
  guard: () => boolean;
  close: () => void;
  showBrowser: () => void;
  openControl: () => void;
  advanced: ReactNode;
  advancedInvalid: boolean;
  error: string;
  clearError: () => void;
};
export default function LogicConfigurationWorkspace(props: Props) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const origin = useRef(document.activeElement as HTMLElement | null);
  const heading = useRef<HTMLHeadingElement>(null);
  const steps = flatten(props.record.flow.steps);
  const selected = steps.find((node) => node.id === props.selected);
  useEffect(() => {
    const trigger = origin.current;
    return () => {
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, []);
  const focusCurrent = () =>
    requestAnimationFrame(() =>
      dialog.current?.querySelector<HTMLElement>('[data-current] h2')?.focus(),
    );
  const finish = () => {
    if (props.guard()) props.close();
  };
  const select = (nodeId: string) => {
    if (props.guard()) {
      props.select(nodeId);
      focusCurrent();
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
      afterOpenChange={(opened) => {
        if (opened) heading.current?.focus();
      }}
      className="editor-workspace-dialog resource-workspace logic-configuration-workspace"
      aria-labelledby={id}
      onClose={() => {
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
        current="流程控制配置"
        back={finish}
        showBrowser={() => {
          if (props.guard()) props.showBrowser();
        }}
      />
      <div className="resource-workspace-page">
        <header>
          <h1 id={id} ref={heading} tabIndex={-1}>
            流程控制配置
          </h1>
          <p>配置当前流程的数据、判断、循环和人工等待。应用后返回编排页保存。</p>
        </header>
        {props.error && (
          <Alert
            type="error"
            showIcon
            title={props.error}
            action={<Button onClick={props.clearError}>关闭提示</Button>}
          />
        )}
        <div className="resource-workspace-grid">
          {groups.map((group, index) => {
            const matches = steps.filter((node) => node.type === group.type);
            const node = matches.find((node) => node.id === props.selected) ?? matches[0];
            const active = node?.id === props.selected;
            return (
              <section key={group.type} aria-label={group.title} data-current={active || undefined}>
                <Card className="resource-workspace-card">
                  <h2 tabIndex={-1}>
                    {group.title}
                    {active && <span>当前步骤</span>}
                  </h2>
                  {matches.length > 1 && (
                    <>
                      <label htmlFor={`${id}-${index}`}>流程步骤</label>
                      <Select<string>
                        id={`${id}-${index}`}
                        value={node?.id}
                        onChange={(value) => select(value)}
                        options={[
                          ...matches.map((step) => ({
                            value: step.id,
                            label: (
                              <>
                                {steps.findIndex((item) => item.id === step.id) + 1}.{' '}
                                {stepTitle(step)}
                              </>
                            ),
                          })),
                        ]}
                      />
                    </>
                  )}
                  {node ? (
                    active ? (
                      <>
                        <ConfigProvider componentDisabled={props.advancedInvalid}>
                          <fieldset
                            disabled={props.advancedInvalid}
                            className="logic-configuration-fields"
                          >
                            <LogicNodeConfiguration
                              compact
                              guard={props.guard}
                              key={node.id}
                              node={node}
                              choices={referenceChoices(props.record.flow, node.id)}
                              change={props.change}
                            />
                          </fieldset>
                        </ConfigProvider>
                        {['condition', 'loop'].includes(node.type) && (
                          <ActionButton
                            hint="配置当前条件或循环内的子步骤与分支，不会执行流程"
                            aria-label="配置子步骤与分支"
                            onClick={() => {
                              if (props.guard()) props.openControl();
                            }}
                          >
                            配置子步骤
                          </ActionButton>
                        )}
                        <ActionButton
                          hint="应用当前配置并返回编排；仍需保存草稿，不会开始运行"
                          type="primary"
                          onClick={finish}
                        >
                          应用配置
                        </ActionButton>
                      </>
                    ) : (
                      <>
                        <Descriptions
                          className="logic-configuration-summary"
                          size="small"
                          column={1}
                          layout="vertical"
                          colon={false}
                          items={fields(node, props.record).map(([label, text]) => ({
                            key: label,
                            label,
                            children: <span title={text}>{text}</span>,
                          }))}
                        />
                        <ActionButton
                          hint={`选择并配置 ${stepTitle(node)}`}
                          type="primary"
                          onClick={() => select(node.id)}
                        >
                          配置此步骤
                        </ActionButton>
                      </>
                    )
                  ) : (
                    <>
                      <p className="resource-workspace-empty">当前流程尚无此类步骤。</p>
                      <p>添加后配置输入，保存草稿不会执行步骤。</p>
                      <ActionButton
                        hint={`将${group.title}添加到主流程末尾，添加后仍需保存，不会执行`}
                        aria-label="添加到主流程末尾"
                        onClick={() => {
                          if (props.guard()) {
                            props.add(newStep(group.type));
                            focusCurrent();
                          }
                        }}
                      >
                        添加步骤
                      </ActionButton>
                    </>
                  )}
                </Card>
              </section>
            );
          })}
          <section aria-label="节点高级输入">
            <Card className="resource-workspace-card logic-configuration-advanced">
              <h2>节点高级输入</h2>
              {selected ? (
                <>
                  <p>当前步骤：{stepTitle(selected)}</p>
                  <ConfigProvider componentDisabled={props.advancedInvalid}>
                    <fieldset
                      disabled={props.advancedInvalid}
                      className="logic-configuration-fields"
                    >
                      <NodeTiming
                        compact
                        key={selected.id}
                        node={selected}
                        change={props.changeTiming}
                      />
                    </fieldset>
                  </ConfigProvider>
                  {props.advanced}
                  <ActionButton
                    hint="应用当前配置并返回编排；仍需保存草稿，不会开始运行"
                    type="primary"
                    onClick={finish}
                  >
                    应用配置
                  </ActionButton>
                </>
              ) : (
                <p>选择一个步骤后配置期限和高级输入。</p>
              )}
            </Card>
          </section>
        </div>
      </div>
    </Drawer>
  );
}
