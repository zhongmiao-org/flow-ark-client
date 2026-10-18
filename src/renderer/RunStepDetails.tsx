import SourceReductionPanel from './SourceReductionPanel';
import { Alert, Button, Collapse, Descriptions, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ai_receipt_v1 } from '../shared/node-schema.generated';
import { aiReceiptMessage } from '../shared/ai-outcome';
import type { AINodeReceipt, Event } from '../shared/types';
import { activateCollapseWithSpace } from './collapseKeyboard';
import type { Step } from '../shared/types';
import type { RunPresentationInput, RunStepPresentation } from '../shared/run-presentation';
import { flatten } from './flow-editing';
import { browserActions } from './browser-actions';
import { kinds } from './node-kinds';
import './run-step-details.css';
import { runEventMessage } from './run-event-presentation';
import { runInstancePresenter } from './run-instance-presentation';

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
    case 'context':
      return [
        [
          '操作',
          node.operation === 'configuration'
            ? '读取本次配置'
            : node.operation === 'state.read'
              ? '读取最新状态'
              : '按修订更新状态',
        ],
        ...(node.operation === 'state.write'
          ? ([
              ['预期修订', configured(node.expectedRevision)],
              ['完整新值', configured(node.value)],
            ] as [string, string][])
          : []),
      ];
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
    case 'conversation':
      return [
        ['会话标题', node.title],
        ['会话键', configured(node.key)],
        ['AI资源', node.binding],
        [
          node.version === 2 ? '每轮历史窗口' : '请求上限',
          node.version === 2 ? `${node.historyWindow}轮，无总次数限制` : String(node.maxRequests),
        ],
        ['指令', configured(node.instructions)],
        ['上下文', configured(node.input)],
      ];
    case 'ai':
      return [
        ['结果格式', node.version === 2 ? 'v2：status / result.output' : 'v1：output'],
        [
          '请求失败时',
          node.version === 2 && node.failureMode === 'result'
            ? '返回失败状态，供后续条件判断'
            : '停止运行',
        ],
        ['AI资源', node.binding],
        ['指令', configured(node.instructions)],
        ['输入', configured(node.input)],
        ['输出格式', configured(node.schema)],
      ];
    case 'http':
      return [
        ['请求方法', node.method],
        ['请求地址', configured(node.url)],
        ['请求头', configured(node.headers)],
        ['请求体', node.method === 'GET' ? 'GET 不发送请求体' : configured(node.body)],
      ];
    case 'source-reduce':
      return [
        ['来源资源', node.binding],
        ['本人AI资源', node.aiBinding],
        ['本批请求上限', String(node.maxRequests)],
        ['初始数据', configured(node.seed)],
        ['进度恢复', '完整响应与草稿、下一位置一起保存；未知结果须核对。'],
      ];
    case 'source':
      return [
        ['来源资源', node.binding],
        ['操作', node.operation === 'manifest' ? '读取固定来源清单' : '读取一个有界片段'],
        ['模型调用', '无，读取不代表AI已整理'],
      ];
    case 'skill':
      return [
        [
          '操作',
          node.operation === 'read'
            ? '固定确认版本读取'
            : node.version === 2
              ? '更新建议 · 保留手工内容'
              : '创建待确认草稿',
        ],
        ['逻辑资源', node.binding],
        ['结果', '正文与结构化内容需独立确认；不授予发送权限'],
      ];
    case 'document':
      return [
        ['来源目录', node.binding],
        ['相对文件名', configured(node.file)],
        ['操作', '本机文字提取，来源及缺口见输出与产物'],
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

export function RunFileOperation({
  detail,
  step,
  node,
}: {
  detail: RunPresentationInput;
  step: RunStepPresentation;
  node: Extract<Step, { type: 'file' | 'excel' }>;
}) {
  const last = detail.events
    .filter(
      (event) =>
        event.runId === detail.run.id &&
        event.nodeInstance === step.instance &&
        ['node-start', 'node-end'].includes(event.type),
    )
    .sort((a, b) => a.sequence - b.sequence)
    .at(-1);
  const operation = operations[node.operation] ?? node.operation;
  const complete = last?.type === 'node-end' && last.data?.completed === true;
  const status = complete
    ? '此步骤已记录完成'
    : step.kind === 'paused'
      ? '尚未开始，暂停在步骤之前'
      : step.kind === 'current'
        ? detail.run.state === 'CANCELLING'
          ? '正在取消，文件结果待核对'
          : `正在${operation}`
        : '未取得完成记录，文件结果待核对';
  return (
    <section className="run-file-operation" aria-label="文件操作状态">
      <Descriptions
        layout="vertical"
        column={{ xs: 1, sm: 2 }}
        items={[
          { key: 'status', label: `${operation}状态`, children: status },
          { key: 'target', label: '目标文件 · 启动时配置', children: configured(node.name) },
        ]}
      />
      <p>
        {complete
          ? '步骤完成记录与文件副本、外部业务结果分别核对；已保存内容可在“输出与产物”查看。'
          : '目标来自固定配置；变量保留引用路径。总量未知时不估算完成百分比。'}
      </p>
    </section>
  );
}

export function fileOperationTitle(node: Extract<Step, { type: 'file' | 'excel' }>) {
  return `${operations[node.operation] ?? node.operation}${node.type === 'excel' ? '表格' : '文件'}`;
}

export function RunAIOutcome({
  node,
  events,
  showConfiguration,
}: {
  node: Extract<Step, { type: 'ai' }>;
  events: Event[];
  showConfiguration: () => void;
}) {
  if (node.version !== 2) return null;
  const saved = events.findLast((event) => event.type === 'ai-outcome');
  if (!saved || !ai_receipt_v1(saved.data))
    return (
      <Alert
        type="info"
        title="尚未取得可确认的AI请求回执"
        description="取消、节点期限、资源缺口或本地记录失败仍会阻止运行；不会自动重试或把迟到内容交给后续步骤。原始脱敏记录保留。"
      />
    );
  const receipt = saved.data as AINodeReceipt;
  const handled =
    receipt.status === 'failed' &&
    node.failureMode === 'result' &&
    events.some(
      (event) =>
        event.type === 'node-end' &&
        event.data?.completed === true &&
        event.sequence > saved.sequence,
    );
  return (
    <section className="run-ai-outcome" aria-label="AI请求结果">
      <div>
        <h3>{receipt.status === 'failed' ? '失败回执' : '完整结果回执'}</h3>
        <p>{handled ? '请求失败，已交给后续处理。' : aiReceiptMessage(receipt)}</p>
        <Descriptions
          layout="vertical"
          column={1}
          items={[
            {
              key: 'model',
              label: '服务 / 模型',
              children: receipt.provider + ' / ' + receipt.model,
            },
            { key: 'id', label: '请求ID', children: receipt.requestId ?? '未知' },
            {
              key: 'usage',
              label: '已知用量',
              children:
                receipt.usage === null
                  ? '未知（null），不补零'
                  : JSON.stringify(receipt.usage, null, 2),
            },
            ...(receipt.status === 'failed'
              ? [
                  {
                    key: 'error',
                    label: '失败分类 / HTTP',
                    children: receipt.error.code + ' / ' + (receipt.error.httpStatus ?? '未知'),
                  },
                  { key: 'reason', label: '原因', children: receipt.error.message },
                ]
              : []),
          ]}
        />
      </div>
      <div>
        <h3>
          {receipt.status === 'failed'
            ? node.failureMode === 'result'
              ? '由后续步骤明确处理'
              : '按配置停止运行'
            : '条件节点与变量来源'}
        </h3>
        <p>
          {receipt.status === 'failed'
            ? node.failureMode === 'result'
              ? '先判断 status = failed，再由编排连接保存原因和本人待办。失败没有 result 或可用正文；是否完成提醒须核对后续记录。'
              : '本节点选择停止运行；不会执行失败提醒分支，实际终态以运行记录为准。'
            : '先判断 status = success，再引用 result.output；完整输出可在输出与产物查看。模型结果不成为业务事实或外发授权。'}
        </p>
        <p>取消、期限、权限和资源缺口仍停止；查看与重开不会重新调用模型。</p>
        <Button type="primary" onClick={showConfiguration}>
          查看节点配置
        </Button>
      </div>
    </section>
  );
}

export default function RunStepDetails({
  detail,
  step,
  compact = false,
  rerun,
  openRun,
}: {
  detail: RunPresentationInput;
  step: RunStepPresentation;
  compact?: boolean;
  rerun?: () => void;
  openRun?: (detail: any) => void;
}) {
  const configurationRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    setExpanded(false);
    setReveal(0);
  }, [detail.run.id, step.instance]);
  useEffect(() => {
    if (!reveal) return;
    // Collapse makes its force-rendered contents visible on its next motion frame.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        configurationRef.current?.scrollIntoView({ block: 'nearest' });
        configurationRef.current?.focus();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);
  const node =
    step.instance && runInstancePresenter(detail.snapshot)(step.instance)
      ? flatten(detail.snapshot?.steps ?? []).find((item) => item.id === step.nodeId)
      : undefined;
  const events = step.instance
    ? detail.events
        .filter((event) => event.runId === detail.run.id && event.nodeInstance === step.instance)
        .sort((a, b) => a.sequence - b.sequence)
    : [];
  const recent = events.slice(-6);
  const configuration = node ? (
    <>
      <header>
        <h3>{kinds[node.type]?.label ?? node.type} · 启动时配置</h3>
        <Tag>只读快照</Tag>
      </header>
      <p>以下为本次运行保存的配置；变量引用保留原路径，不代表运行时解析值或动作回执。</p>
      <Descriptions
        layout="vertical"
        column={{ xs: 1, sm: 2 }}
        items={fields(node).map(([label, value]) => ({ key: label, label, children: value }))}
      />
    </>
  ) : (
    <p>
      {step.instance
        ? '未取得此步骤的固定配置，保留已保存的步骤记录。'
        : '尚未取得明确步骤位置，收到记录后会显示对应配置。'}
    </p>
  );
  return (
    <section className="run-step-details" aria-label="当前步骤信息">
      {!compact && (
        <div ref={configurationRef} tabIndex={-1}>
          {configuration}
        </div>
      )}
      {node?.type === 'source-reduce' && step.instance && (
        <SourceReductionPanel
          key={detail.run.id + step.instance}
          target={{ runId: detail.run.id, nodeId: node.id, nodeInstance: step.instance }}
          rerun={rerun}
          openRun={openRun}
        />
      )}
      {node?.type === 'ai' && (
        <RunAIOutcome
          node={node}
          events={events}
          showConfiguration={() => {
            setExpanded(true);
            setReveal((value) => value + 1);
          }}
        />
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
      {compact && (
        <Collapse
          activeKey={expanded ? ['configuration'] : []}
          onChange={(keys) => setExpanded(keys.includes('configuration'))}
          className="run-snapshot-details"
          items={[
            {
              key: 'configuration',
              label: '启动时配置 · 只读快照',
              forceRender: true,
              onKeyDown: activateCollapseWithSpace,
              children: (
                <div className="feedback-body" ref={configurationRef} tabIndex={-1}>
                  {step.instance && <p>节点实例：{step.instance}</p>}
                  {configuration}
                </div>
              ),
            },
          ]}
        />
      )}
    </section>
  );
}
