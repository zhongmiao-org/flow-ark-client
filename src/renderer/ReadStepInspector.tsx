import TechnicalDetails from './TechnicalDetails';
import { referenceChoices } from './value-references';
import { Alert, Button, Collapse, Input, Space, Tag } from 'antd';
import { useEffect, useState, type RefObject, type Ref } from 'react';
import type { FlowRecord, Step } from '../shared/types';
import { nodeReferenceValues } from '../shared/flow-references';
import { flatten } from './flow-editing';
import { taskStepTitle } from './task-step-presentation';
import BrowserNodeConfiguration from './BrowserNodeConfiguration';
import NodeTiming from './NodeTiming';
import type { ElementPickerControls } from './ElementPicker';
import './read-step-inspector.css';
import { activateCollapseWithSpace } from './collapseKeyboard';

type BrowserNode = Extract<Step, { type: 'browser' }>;
function usesOutput(value: unknown, reference: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if ('$ref' in value)
    return (
      typeof value.$ref === 'string' &&
      (value.$ref === reference || value.$ref.startsWith(reference + '.'))
    );
  return Object.values(value).some((child) => usesOutput(child, reference));
}

export default function ReadStepInspector({
  record,
  node,
  heading,
  active,
  blockingRunId,
  onViewRun,
  change,
  changeTiming,
  guard,
  position,
  view,
  select,
  pickerControls,
  compact = false,
}: {
  compact?: boolean;
  pickerControls?: Ref<ElementPickerControls>;
  record: FlowRecord;
  node: BrowserNode;
  heading: RefObject<HTMLHeadingElement | null>;
  active: boolean;
  blockingRunId?: string;
  onViewRun: (detail: any, trigger?: HTMLElement) => void;
  change: (node: Step) => void;
  changeTiming: (node: Step) => void;
  guard: () => boolean;
  position: () => void;
  view: (mode: 'all' | 'selected') => void;
  select: (id: string) => void;
}) {
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const steps = flatten(record.flow.steps);
  const ordinal = steps.findIndex((step) => step.id === node.id) + 1;
  const reference = 'steps.' + node.id;
  const consumers = steps.filter((step) => usesOutput(nodeReferenceValues(step), reference));
  useEffect(() => setNotice(''), [node]);
  const identity = (
    <Collapse
      key="identity"
      className="read-step-identity"
      size="small"
      ghost={!compact}
      activeKey={!compact || identityOpen ? ['identity'] : []}
      onChange={(keys) => {
        if (compact) setIdentityOpen(keys.includes('identity'));
      }}
      styles={!compact ? { header: { display: 'none' }, body: { padding: 0 } } : undefined}
      items={[
        {
          key: 'identity',
          label: '步骤名称与编号',
          forceRender: true,
          children: (
            <div className="read-step-identity-fields">
              <Tag color="blue" className="read-step-selection">
                步骤 {String(ordinal).padStart(2, '0')} · 已选择
              </Tag>
              <label htmlFor="step-name">动作名称</label>
              <Input
                size="small"
                id="step-name"
                aria-label="步骤名称"
                value={node.name ?? ''}
                placeholder="便于识别的名称（可选）"
                onChange={(event) => change({ ...node, name: event.target.value })}
              />
            </div>
          ),
        },
      ]}
    />
  );
  const configuration = (
    <BrowserNodeConfiguration
      key="configuration"
      compact={compact}
      pickerControls={pickerControls}
      node={node}
      choices={referenceChoices(record.flow, node.id)}
      change={change}
      active={active}
      blockingRunId={blockingRunId}
      onViewRun={onViewRun}
      readInspector={{
        timing: <NodeTiming node={node} change={changeTiming} compact={compact} />,
        output: (
          <div className="read-step-output">
            <label>输出</label>
            <p className="read-step-value" title="当前步骤输出 → 文本">
              当前步骤输出 → 文本
            </p>
            <Collapse
              size="small"
              activeKey={referencesOpen ? ['references'] : []}
              onChange={(keys) => setReferencesOpen(keys.includes('references'))}
              items={[
                {
                  key: 'references',
                  label: `查看输出引用 · ${consumers.length}`,
                  forceRender: true,
                  children: (
                    <div className="read-step-references">
                      <TechnicalDetails items={[{ label: '完整输出引用', value: reference }]} />
                      <p>
                        后续步骤可通过变量选择引用此输出。这里展示草稿引用关系，不包含实际读取结果。
                      </p>
                      {consumers.length ? (
                        consumers.map((step) => (
                          <Button type="text" block key={step.id} onClick={() => select(step.id)}>
                            {String(steps.indexOf(step) + 1).padStart(2, '0')} {taskStepTitle(step)}
                          </Button>
                        ))
                      ) : (
                        <p>当前草稿没有步骤引用此输出。</p>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        ),
      }}
    />
  );
  return (
    <section
      className={`read-step-inspector${compact ? ' is-compact' : ''}`}
      aria-label="读取文字步骤配置"
      onKeyDown={activateCollapseWithSpace}
    >
      <h3 ref={heading} tabIndex={-1}>
        {compact ? '配置 · 读取文字' : '读取文字'}
      </h3>
      {compact ? [configuration, identity] : [identity, configuration]}
      <Button
        className="read-step-apply"
        type="primary"
        onClick={() => {
          if (guard()) setNotice('已应用到当前草稿；保存后用于下一次运行。');
        }}
      >
        应用配置
      </Button>
      {notice && (
        <Alert
          type="success"
          showIcon
          role="status"
          className="read-step-feedback"
          title={notice}
        />
      )}
      <Button onClick={position}>复制 / 移动 / 删除</Button>
      <Space.Compact block className="read-step-view" role="group" aria-label="流程图视图">
        <Button onClick={() => view('all')}>全图</Button>
        <Button onClick={() => view('selected')}>聚焦当前步骤</Button>
      </Space.Compact>
    </section>
  );
}
