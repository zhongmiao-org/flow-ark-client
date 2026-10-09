import { Alert, Select } from 'antd';
import type { Step } from '../shared/types';
import type { TaskMcpTarget } from '../shared/task-mcp-targets';
import type { ReferenceChoice } from './value-references';
import { referenceOf } from './value-references';
import ValueField from './ValueField';
import './mcp-node.css';

type ToolStep = Extract<Step, { type: 'mcp' }>;
const value = (input: unknown): string => {
  const ref = referenceOf(input);
  if (ref !== undefined) return `引用 ${ref}`;
  return typeof input === 'string' ? input : JSON.stringify(input, null, 2);
};
export default function McpNodeConfiguration({
  node,
  targets = [],
  choices = [],
  change,
}: {
  node: ToolStep;
  targets?: readonly TaskMcpTarget[];
  choices?: ReferenceChoice[];
  change?: (node: Step) => void;
}) {
  const target = targets.find((target) => target.selectionId === node.target);
  const tool = target?.tools.find((tool) => tool.name === node.tool);
  const fields = tool?.inputSchema.properties;
  const properties =
    fields && typeof fields === 'object' && !Array.isArray(fields) ? Object.entries(fields) : [];
  const required = Array.isArray(tool?.inputSchema.required) ? tool.inputSchema.required : [];
  const argsRef = referenceOf(node.arguments);
  return (
    <section className="node-configuration mcp-node" aria-label="工具步骤配置">
      <h4>所选工具与输入</h4>
      {change ? (
        <>
          <label>
            连接对象
            <Select<string>
              aria-label="工具连接对象"
              value={node.target}
              onChange={(value) => {
                const selected = targets.find((target) => target.selectionId === value);
                if (selected)
                  change({
                    ...node,
                    target: selected.selectionId,
                    tool: selected.tools[0]?.name ?? '',
                    arguments: {},
                  });
              }}
              options={[
                ...(!target ? [{ value: node.target, label: <>未绑定 · {node.target}</> }] : []),
                ...targets.map((target) => ({
                  value: target.selectionId,
                  label: target.displayName,
                })),
              ]}
            />
          </label>
          <label>
            工具
            <Select<string>
              aria-label="工具名称"
              value={node.tool}
              disabled={!target || undefined}
              onChange={(value) => change({ ...node, tool: value, arguments: {} })}
              options={[
                ...(!tool ? [{ value: node.tool, label: `未选择 · ${node.tool}` }] : []),
                ...(target?.tools ?? []).map((tool) => ({
                  value: tool.name,
                  label: `${tool.title || tool.name} · ${tool.name}`,
                })),
              ]}
            />
          </label>
          <p>更换工具会清空参数；仅可使用该任务已确认的工具。</p>
        </>
      ) : (
        <dl className="mcp-step-facts">
          <div>
            <dt>连接对象</dt>
            <dd>{target?.displayName || '尚未绑定本机连接'}</dd>
          </div>
          <div>
            <dt>工具</dt>
            <dd>
              {tool?.title || node.tool}
              <code>{node.tool}</code>
            </dd>
          </div>
        </dl>
      )}
      <p>{target ? `来源：${target.source}` : '此流程只有逻辑目标，请从原任务重新选择工具。'}</p>
      <details>
        <summary>查看逻辑目标与选择记录</summary>
        <code>{node.target}</code>
        {target && (
          <p>
            选择修订 {target.connectionRevision} · {new Date(target.selectedAt).toLocaleString()}
            ；此记录不代表实时连接可用。
          </p>
        )}
      </details>
      {tool && (
        <>
          <p>{tool.description || '服务未提供用途说明'}</p>
          <Alert
            type="info"
            role="note"
            showIcon
            title={
              <>
                只读：
                {tool.annotations?.readOnlyHint === undefined
                  ? '未声明'
                  : tool.annotations.readOnlyHint
                    ? '服务声明为是'
                    : '服务声明为否'}
                。服务声明不证明没有外部影响；账号与具体读写范围仍需核对。
              </>
            }
          />
          {!!properties.length && (
            <details>
              <summary>参数说明 · {properties.length} 项</summary>
              <dl className="mcp-step-facts">
                {properties.map(([name, definition]) => {
                  const field =
                    definition && typeof definition === 'object'
                      ? (definition as Record<string, unknown>)
                      : {};
                  return (
                    <div key={name}>
                      <dt>
                        {name}
                        {required.includes(name) ? ' · 必填' : ' · 可选'}
                      </dt>
                      <dd>
                        {typeof field.description === 'string' ? field.description : '未提供说明'}
                        <small>
                          类型：{typeof field.type === 'string' ? field.type : '查看完整定义'}
                        </small>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </details>
          )}
          <details>
            <summary>完整输入与输出定义</summary>
            <pre>{JSON.stringify(tool, null, 2)}</pre>
          </details>
        </>
      )}
      <h4>本步骤参数</h4>
      {change ? (
        <ValueField
          label="工具参数"
          value={node.arguments}
          choices={choices}
          defaultValue={{}}
          change={(argumentsValue) => {
            if (
              !argumentsValue ||
              typeof argumentsValue !== 'object' ||
              Array.isArray(argumentsValue)
            )
              throw new Error('工具参数必须是对象或对象引用');
            change({ ...node, arguments: argumentsValue });
          }}
        />
      ) : argsRef ? (
        <p className="mcp-argument-reference">
          整组参数来自 <code>{argsRef}</code>
        </p>
      ) : (
        <dl className="mcp-step-facts" aria-label="本次工具参数">
          {Object.entries(node.arguments ?? {}).map(([key, input]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                <pre>{value(input)}</pre>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Alert
        type="info"
        role="note"
        showIcon
        title={
          <>
            保存、编辑与采纳不会调用服务。执行需从原任务检查并确认试运行；成功回复可通过
            structuredContent 或 content 引用。
          </>
        }
      />
    </section>
  );
}
