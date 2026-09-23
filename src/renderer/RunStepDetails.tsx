import type { Step } from '../shared/types';
import type { RunPresentationInput, RunStepPresentation } from '../shared/run-presentation';
import { flatten } from './flow-editing';
import { browserActions } from './browser-actions';
import { kinds } from './node-kinds';
import './run-step-details.css';
import { runEventMessage } from './run-event-presentation';

const configured = (value: unknown): string => {
  if (value === undefined) return '未配置';
  if (value === null) return '空值';
  if (typeof value === 'object') {
    if ('$ref' in value && typeof value.$ref === 'string') return `引用：${value.$ref}`;
    return Array.isArray(value)
      ? `数组 · ${value.length} 项`
      : `对象 · ${Object.keys(value).length} 个字段`;
  }
  const text = String(value);
  return text ? text.slice(0, 240) + (text.length > 240 ? '…' : '') : '空文本';
};
const comparisons: Record<string, string> = {
  equals: '等于',
  notEquals: '不等于',
  contains: '包含',
  gt: '大于',
  exists: '不是空值',
};
const operations: Record<string, string> = {
  read: '读取',
  write: '写入',
  create: '新建',
  copy: '复制',
  archive: '压缩归档',
  fill: '填充模板',
  map: '字段映射',
};

function fields(node: Step): [string, string][] {
  switch (node.type) {
    case 'desktop':
      return [
        ['应用目标', node.target],
        ['动作', '替换选区并回读'],
        ['替换文字', configured(node.text)],
      ];
    case 'mcp':
      return [
        ['工具对象', node.target],
        ['工具名称', node.tool],
        ['工具参数', configured(node.arguments)],
      ];
    case 'browser':
      return [
        ['网页动作', browserActions[node.operation]?.label ?? node.operation],
        ...(node.operation === 'navigate'
          ? [['网页地址', configured(node.value)]]
          : node.operation === 'screenshot'
            ? [['截图范围', '当前网页视口']]
            : [
                ['目标定位', node.selector || '未配置'],
                ['框架层级', `${'framePath' in node ? (node.framePath?.length ?? 0) : 0} 层`],
              ]),
      ] as [string, string][];
    case 'http':
      return [
        ['请求方法', node.method],
        ['请求地址', configured(node.url)],
        ['请求头', configured(node.headers)],
        ['请求体', node.method === 'GET' ? 'GET 不发送请求体' : configured(node.body)],
      ];
    case 'file':
    case 'excel':
      return [
        ['操作', operations[node.operation] ?? node.operation],
        ['目录绑定', node.binding],
        ['文件名称', configured(node.name)],
      ];
    case 'script':
      return [
        ['脚本语言', node.language === 'ts' ? 'TypeScript' : 'JavaScript'],
        ['输入', configured(node.input)],
        ['依赖声明', `${node.dependencies.length} 项`],
      ];
    case 'value':
      return [['数据值', configured(node.value)]];
    case 'human':
      return [['人工确认提示', node.message]];
    case 'loop':
      return [
        ['循环数据', configured(node.items)],
        ['循环体', `${node.body.length} 个直接子步骤`],
      ];
    case 'condition':
    case 'assert':
      return [
        ['判断值', configured(node.actual)],
        ['判断方式', comparisons[node.operator] ?? node.operator],
        ...(node.operator === 'exists' ? [] : [['比较值', configured(node.expected)]]),
        ...(node.type === 'condition'
          ? [
              ['成立分支', `${node.then.length} 个直接子步骤`],
              ['否则分支', `${node.else.length} 个直接子步骤`],
            ]
          : []),
      ] as [string, string][];
  }
}

export default function RunStepDetails({
  detail,
  step,
}: {
  detail: RunPresentationInput;
  step: RunStepPresentation;
}) {
  const node = flatten(detail.snapshot?.steps ?? []).find((item) => item.id === step.nodeId);
  const events = step.instance
    ? detail.events
        .filter((event) => event.runId === detail.run.id && event.nodeInstance === step.instance)
        .sort((a, b) => a.sequence - b.sequence)
    : [];
  const recent = events.slice(-6);
  return (
    <section className="run-step-details" aria-label="当前步骤信息">
      {node ? (
        <>
          <header>
            <h3>{kinds[node.type]?.label ?? node.type} · 启动时配置</h3>
            <span>只读快照</span>
          </header>
          <p>以下为本次运行保存的配置；变量引用保留原路径，不代表运行时解析值或动作回执。</p>
          <dl>
            {fields(node).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p>
          {step.instance
            ? '未取得此步骤的固定配置，保留已保存的步骤记录。'
            : '尚未取得明确步骤位置，收到记录后会显示对应配置。'}
        </p>
      )}
      <div className="run-step-events">
        <h3>此步骤的最近记录</h3>
        {recent.length ? (
          <>
            <ol>
              {recent.map((event) => (
                <li key={event.sequence}>
                  <time dateTime={event.time}>
                    {Number.isFinite(Date.parse(event.time))
                      ? new Date(event.time).toLocaleTimeString('zh-CN', { hour12: false })
                      : '时间未记录'}
                  </time>
                  <span>
                    {runEventMessage(event).length > 1000
                      ? runEventMessage(event).slice(0, 1000) + '…（完整内容见运行日志）'
                      : runEventMessage(event)}
                  </span>
                </li>
              ))}
            </ol>
            {events.length > recent.length && (
              <p>仅列出最近 {recent.length} 条；完整内容见“运行日志”。</p>
            )}
          </>
        ) : (
          <p>尚无此节点实例的已保存记录。</p>
        )}
      </div>
    </section>
  );
}
