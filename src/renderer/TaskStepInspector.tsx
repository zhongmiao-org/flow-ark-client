import { Select, Button, Card, Collapse, Descriptions } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Flow, Step } from '../shared/types';
import { flatten } from './flow-editing';
import { flowOutline } from './flow-outline';
import { kinds } from './node-kinds';
import McpNodeConfiguration from './McpNodeConfiguration';
import DesktopStepDetails from './DesktopStepDetails';
import { referenceOf } from './value-references';
import {
  taskStepSummary,
  taskStepTitle,
  taskStepValue,
  type TaskStepContext,
} from './task-step-presentation';
import './task-graph.css';

export default function TaskStepInspector({
  flow,
  selected,
  select,
  context,
  actions,
  presentation = 'full',
  focusInGraph,
}: {
  flow: Flow;
  selected: string;
  select: (id: string) => void;
  context: TaskStepContext;
  actions: ReactNode;
  presentation?: 'full' | 'graph';
  focusInGraph?: () => void;
}) {
  const entries = useMemo(() => flowOutline(flow.steps).entries, [flow.steps]);
  const index = entries.findIndex((entry) => entry.step.id === selected);
  const entry = entries[index];
  const step = entry?.step;
  const longGraph = presentation === 'graph' && entries.length > 12;
  const heading = useRef<HTMLHeadingElement>(null);
  const navigationTarget = useRef<string | null>(null);
  const navigateStep = (id: string) => {
    navigationTarget.current = id;
    select(id);
  };
  useLayoutEffect(() => {
    const target = navigationTarget.current;
    navigationTarget.current = null;
    if (presentation === 'graph') {
      const body = heading.current?.closest<HTMLElement>('.ant-card-body');
      if (body && body.scrollHeight > body.clientHeight) body.scrollTop = 0;
    }
    if (target !== selected || !heading.current) return;
    heading.current.scrollIntoView({ block: 'nearest' });
    heading.current.focus({ preventScroll: true });
  }, [selected, presentation]);
  const value = (input: unknown) => (
    <ConfiguredValue key={selected} input={input} flow={flow} selected={selected} />
  );
  const facts: [string, ReactNode][] = [];
  if (step) {
    if (step.type === 'condition' || step.type === 'assert') {
      facts.push(['判断内容', value(step.actual)]);
      if (step.operator !== 'exists') facts.push(['比较值', value(step.expected)]);
    }
    if (step.type === 'value') facts.push(['输出内容', value(step.value)]);
    if (step.type === 'loop')
      facts.push(['循环数据', value(step.items)], ['执行方式', '依次处理每项，循环体串行执行']);
    if (step.type === 'human') facts.push(['需要你处理', step.message]);
    if (step.type === 'script')
      facts.push(
        ['语言', step.language === 'ts' ? 'TypeScript' : 'JavaScript'],
        ['输入', value(step.input)],
        [
          '依赖',
          step.dependencies.length
            ? step.dependencies.map((item) => `${item.name} @ ${item.version}`).join('\n')
            : '未声明第三方依赖',
        ],
      );
    if (step.type === 'http')
      facts.push(
        ['请求方法', step.method],
        ['请求地址', value(step.url)],
        ['请求头', value(step.headers)],
        ['请求内容', value(step.body)],
      );
    if (step.type === 'browser') {
      if (step.operation === 'navigate') facts.push(['目标网址', value(step.value)]);
      else if (step.operation !== 'screenshot')
        facts.push(
          ['元素定位', step.selector || '尚未设置'],
          ['选取时的页面', context.webTarget?.page.title || '未提供页面来源'],
        );
      if (
        !['navigate', 'screenshot', 'read', 'inputValue', 'click', 'wait', 'download'].includes(
          step.operation,
        )
      )
        facts.push(['操作内容', value(step.value)]);
      facts.push([
        '内嵌页面',
        'framePath' in step && step.framePath.length ? step.framePath.join(' → ') : '页面主文档',
      ]);
    }
    if (step.type === 'file' || step.type === 'excel') {
      const path =
        step.binding === 'task_output' && context.outputTarget
          ? context.outputTarget.directory
          : context.bindings?.files[step.binding];
      facts.push(
        ['本机目录', path || `资源「${step.binding}」尚未绑定`],
        ['文件名', value(step.name)],
      );
      if (step.type === 'file') {
        if (step.operation === 'archive') facts.push(['归档文件', value(step.files)]);
        else if (step.operation !== 'read')
          facts.push([step.operation === 'copy' ? '来源文件' : '文件内容', value(step.content)]);
      } else {
        if ('sheet' in step) facts.push(['工作表', step.sheet || '首个工作表']);
        if ('rows' in step && step.operation !== 'read') facts.push(['行数据', value(step.rows)]);
        if (step.operation === 'fill')
          facts.push(['模板文件', value(step.templateName)], ['单元格内容', value(step.cells)]);
        if (step.operation === 'map')
          facts.push([
            '字段映射',
            <Collapse
              key={step.id}
              items={[
                {
                  key: 'mapping',
                  label: `${step.mappings.length} 列；${step.includeHeaders ? '写入表头' : '不写表头'}`,
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  children: (
                    <div className="feedback-body">
                      {step.mappings.map((mapping, index) => (
                        <p key={index}>
                          {`来源「${mapping.source}」 → ${mapping.column} 列\n类型：${{ text: '文本', number: '数字', boolean: '布尔' }[mapping.type]}\n${step.includeHeaders ? '表头' : '已设表头（不写入）'}：${mapping.header ? `「${mapping.header}」` : '空白'}`}
                        </p>
                      ))}
                    </div>
                  ),
                },
              ]}
            />,
          ]);
      }
    }
    facts.push([
      '步骤期限',
      step.timeoutMs === undefined ? '使用执行默认期限' : `${step.timeoutMs} 毫秒`,
    ]);
  }
  const branch = (label: string, nodes: Step[]) => (
    <div className="task-step-branch">
      <h3>
        {label} · {flatten(nodes).length} 个步骤
      </h3>
      {nodes.length ? (
        nodes.map((node) => (
          <Button key={node.id} onClick={() => navigateStep(node.id)}>
            {entries.find((item) => item.step.id === node.id)?.ordinal} · {taskStepTitle(node)}
          </Button>
        ))
      ) : (
        <p>没有步骤，继续后续流程。</p>
      )}
    </div>
  );
  const picker = (
    <label>
      按定义浏览步骤
      <Select<string>
        aria-label="选择方案步骤"
        value={step?.id ?? ''}
        onChange={(value) => select(value)}
        options={[
          { value: '', disabled: true, label: '选择一个步骤' },
          ...entries.map((item) => ({
            value: item.step.id,
            label: (
              <>
                {item.ordinal} · {taskStepTitle(item.step)}
              </>
            ),
          })),
        ]}
      />
    </label>
  );
  const stepDetails = step ? (
    <>
      <Descriptions
        className="metadata-facts task-step-facts"
        column={1}
        layout="vertical"
        bordered
        size="small"
        items={facts.map(([label, content]) => ({ key: label, label, children: content }))}
      />
      {step.type === 'mcp' && <McpNodeConfiguration node={step} targets={context.toolTargets} />}
      {step.type === 'desktop' && <DesktopStepDetails node={step} />}
    </>
  ) : null;
  const location = step ? (
    <>
      {!!entry.ancestors.length && (
        <p className="task-step-position">
          所在范围：
          {entry.ancestors
            .map((key) => {
              const split = key.lastIndexOf(':');
              const ancestor = entries.find((item) => item.step.id === key.slice(0, split));
              return `${ancestor ? taskStepTitle(ancestor.step) : key.slice(0, split)} · ${{ then: '条件成立', else: '条件不成立', body: '循环体' }[key.slice(split + 1)] ?? ''}`;
            })
            .join(' → ')}
        </p>
      )}
    </>
  ) : null;
  const browse = step ? (
    <div className="task-step-browse" aria-label="按定义顺序浏览">
      <Button
        disabled={index <= 0 || undefined}
        onClick={() => navigateStep(entries[index - 1].step.id)}
      >
        上一步
      </Button>
      <Button
        disabled={index >= entries.length - 1 || undefined}
        onClick={() => navigateStep(entries[index + 1].step.id)}
      >
        下一步
      </Button>
    </div>
  ) : null;
  if (presentation === 'graph')
    return (
      <aside className="task-step-inspector task-step-graph" aria-label="当前方案步骤">
        <Card className="task-step-inspector-card">
          {longGraph && (
            <div className="task-step-graph-navigation">
              {picker}
              <p className="task-step-position" role="status">
                {step
                  ? `当前第 ${entry.ordinal} / ${entries.length} 步`
                  : `共 ${entries.length} 步，选择后聚焦图中位置。`}
              </p>
              {browse}
              {step && focusInGraph && <Button onClick={focusInGraph}>回到图中此步</Button>}
            </div>
          )}
          {step ? (
            <>
              <h2 ref={heading} tabIndex={-1} data-task-step-heading>
                第 {entry.ordinal} 步 · {taskStepTitle(step)}
              </h2>
              <div className="task-step-field">
                <h3>{step.type === 'condition' || step.type === 'assert' ? '条件' : '操作'}</h3>
                <p>{taskStepSummary(step, flow, context)}</p>
              </div>
              {step.type === 'condition' && (
                <>
                  {branch('条件成立', step.then)}
                  {branch('条件不成立', step.else)}
                </>
              )}
              {step.type === 'loop' && branch('循环体', step.body)}
              <div className="task-step-actions">{actions}</div>
              <Collapse
                className="task-step-graph-details"
                items={[
                  {
                    key: 'parameters',
                    label: '完整参数与步骤导航',
                    forceRender: true,
                    onKeyDown: activateCollapseWithSpace,
                    children: (
                      <div className="feedback-body">
                        {!longGraph && picker}
                        {location}
                        {stepDetails}
                        {!longGraph && browse}
                        {!longGraph && focusInGraph && (
                          <Button onClick={focusInGraph}>回到图中此步</Button>
                        )}
                        <p className="task-step-position">
                          编号按流程定义排列，实际执行取决于条件与循环。
                        </p>
                        <Collapse
                          className="task-step-original"
                          items={[
                            {
                              key: 'original',
                              label: '查看步骤原始配置',
                              forceRender: true,
                              onKeyDown: activateCollapseWithSpace,
                              children: <pre>{JSON.stringify(step, null, 2)}</pre>,
                            },
                          ]}
                        />
                      </div>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <>
              <div className="task-step-empty">
                <h2>选择当前一步</h2>
                <p>
                  {entries.length
                    ? '点击图中的步骤，或从列表选择，查看输入、条件和去向。'
                    : '这份方案还没有步骤。'}
                </p>
              </div>
              {!longGraph && picker}
              <div className="task-step-actions">{actions}</div>
            </>
          )}
        </Card>
      </aside>
    );
  return (
    <aside className="task-step-inspector" aria-label="当前方案步骤">
      <Card className="task-step-inspector-card">
        {picker}
        {step ? (
          <>
            <div>
              <p className="task-step-position">
                第 {entry.ordinal} / {entries.length} 步 · {kinds[step.type].label}
              </p>
              <h2 ref={heading} tabIndex={-1} data-task-step-heading>
                {taskStepTitle(step)}
              </h2>
            </div>
            <p className="task-step-summary">{taskStepSummary(step, flow, context)}</p>
            {location}
            {stepDetails}
            {step.type === 'condition' && (
              <>
                {branch('条件成立', step.then)}
                {branch('条件不成立', step.else)}
              </>
            )}
            {step.type === 'loop' && branch('循环体', step.body)}
            {browse}
            <p className="task-step-position">编号按流程定义排列，实际执行取决于条件与循环。</p>
            <Collapse
              className="task-step-original"
              items={[
                {
                  key: 'original',
                  label: '查看步骤原始配置',
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  children: <pre>{JSON.stringify(step, null, 2)}</pre>,
                },
              ]}
            />
          </>
        ) : (
          <div className="task-step-empty">
            <h2>选择当前一步</h2>
            <p>
              {entries.length
                ? '点击图中的步骤，或从上方列表选择，查看输入、条件和去向。'
                : '这份方案还没有步骤。'}
            </p>
          </div>
        )}
        <div className="task-step-actions">{actions}</div>
      </Card>
    </aside>
  );
}

function ConfiguredValue({
  input,
  flow,
  selected,
}: {
  input: unknown;
  flow: Flow;
  selected: string;
}) {
  const summary = taskStepValue(input, flow, selected);
  const reference = referenceOf(input);
  const expandable =
    (input !== null && typeof input === 'object') ||
    (typeof input === 'string' &&
      (input.length > 120 || input !== input.trim() || /[\r\n\t]/.test(input)));
  if (!expandable) return <>{summary}</>;
  return (
    <Collapse
      className="task-step-value"
      items={[
        {
          key: 'value',
          label: `${summary} · 查看配置`,
          forceRender: true,
          onKeyDown: activateCollapseWithSpace,
          children: (
            <div className="feedback-body">
              <p className="task-step-position">
                {reference !== undefined
                  ? '这是引用来源，实际值由运行提供。'
                  : typeof input === 'string'
                    ? `完整文本 · ${input.length} 个字符；保留换行与空白。`
                    : '当前方案的配置内容，不是运行结果。'}
              </p>
              <pre tabIndex={0} aria-label={reference !== undefined ? '引用来源' : '完整配置值'}>
                {reference ?? (typeof input === 'string' ? input : JSON.stringify(input, null, 2))}
              </pre>
            </div>
          ),
        },
      ]}
    />
  );
}
