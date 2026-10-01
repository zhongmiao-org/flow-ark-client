import { useMemo, type ReactNode } from 'react';
import type { Flow, Step } from '../shared/types';
import { flatten } from './flow-editing';
import { flowOutline } from './flow-outline';
import { kinds } from './node-kinds';
import McpNodeConfiguration from './McpNodeConfiguration';
import DesktopStepDetails from './DesktopStepDetails';
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
}: {
  flow: Flow;
  selected: string;
  select: (id: string) => void;
  context: TaskStepContext;
  actions: ReactNode;
  presentation?: 'full' | 'graph';
}) {
  const entries = useMemo(() => flowOutline(flow.steps).entries, [flow.steps]);
  const index = entries.findIndex((entry) => entry.step.id === selected);
  const entry = entries[index];
  const step = entry?.step;
  const value = (input: unknown) => taskStepValue(input, flow, selected);
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
            `${step.mappings.length} 列；${step.includeHeaders ? '写入表头' : '不写表头'}`,
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
          <button key={node.id} onClick={() => select(node.id)}>
            {entries.find((item) => item.step.id === node.id)?.ordinal} · {taskStepTitle(node)}
          </button>
        ))
      ) : (
        <p>没有步骤，继续后续流程。</p>
      )}
    </div>
  );
  const picker = (
    <label>
      按定义浏览步骤
      <select
        aria-label="选择方案步骤"
        value={step?.id ?? ''}
        onChange={(event) => select(event.target.value)}
      >
        <option value="" disabled>
          选择一个步骤
        </option>
        {entries.map((item) => (
          <option key={item.step.id} value={item.step.id}>
            {item.ordinal} · {taskStepTitle(item.step)}
          </option>
        ))}
      </select>
    </label>
  );
  const stepDetails = step ? (
    <>
      <dl className="task-step-facts">
        {facts.map(([label, content]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{content}</dd>
          </div>
        ))}
      </dl>
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
      <button disabled={index <= 0} onClick={() => select(entries[index - 1].step.id)}>
        上一步
      </button>
      <button
        disabled={index >= entries.length - 1}
        onClick={() => select(entries[index + 1].step.id)}
      >
        下一步
      </button>
    </div>
  ) : null;
  if (presentation === 'graph')
    return (
      <aside className="task-step-inspector task-step-graph" aria-label="当前方案步骤">
        {step ? (
          <>
            <h2 tabIndex={-1} data-task-step-heading>
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
            <details className="task-step-graph-details">
              <summary>完整参数与步骤导航</summary>
              {picker}
              {location}
              {stepDetails}
              {browse}
              <p className="task-step-position">编号按流程定义排列，实际执行取决于条件与循环。</p>
              <details className="task-step-original">
                <summary>查看步骤原始配置</summary>
                <pre>{JSON.stringify(step, null, 2)}</pre>
              </details>
            </details>
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
            {picker}
            <div className="task-step-actions">{actions}</div>
          </>
        )}
      </aside>
    );
  return (
    <aside className="task-step-inspector" aria-label="当前方案步骤">
      {picker}
      {step ? (
        <>
          <div>
            <p className="task-step-position">
              第 {entry.ordinal} / {entries.length} 步 · {kinds[step.type].label}
            </p>
            <h2 tabIndex={-1} data-task-step-heading>
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
          <details className="task-step-original">
            <summary>查看步骤原始配置</summary>
            <pre>{JSON.stringify(step, null, 2)}</pre>
          </details>
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
    </aside>
  );
}
