import { Alert, Button, Card, Checkbox, Collapse, Descriptions, Input, Select } from 'antd';
import { useEffect, useId, useState } from 'react';
import type { FlowRecord } from '../shared/types';
import type { EffectNode } from '../shared/effect-node';
import { effectOperations, effectStates } from '../shared/effect-node';
import { referenceOf, referenceScope, type ReferenceChoice } from './value-references';
import ValueField from './ValueField';
import ReadonlyValue from './ReadonlyValue';
import { activateCollapseWithSpace } from './collapseKeyboard';
import './effect-node.css';

type Action = { id: string; name: string; description: string };
type Catalog = { actions: Action[]; kind: 'instance' | 'author'; grants: Record<string, string> };
export default function EffectNodeConfiguration({
  node,
  record,
  choices,
  change,
  guard,
}: {
  node: EffectNode;
  record: FlowRecord;
  choices: ReferenceChoice[];
  change: (node: EffectNode) => void;
  guard: () => boolean;
}) {
  const id = useId(),
    ref = record.bindings.template;
  const [catalog, setCatalog] = useState<Catalog>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [reviewEditing, setReviewEditing] = useState(false);
  useEffect(() => {
    let live = true;
    setCatalog(undefined);
    setError('');
    setLoading(true);
    const load = async (): Promise<Catalog> => {
      if (ref) {
        const detail = await window.flowark.request('template.detail', { id: ref.instanceId });
        const entry = detail.entries.find((e: any) => e.id === ref.entryId);
        if (
          !entry ||
          detail.instance.packageKey !== ref.packageKey ||
          detail.manifest.contentDigest !== ref.digest ||
          detail.instance.entryFlows[ref.entryId] !== record.id
        )
          throw Error('原模板入口已变化，请返回原入口重新读取');
        return {
          kind: 'instance',
          actions: detail.manifest.actions.filter((a: Action) => entry.actions.includes(a.id)),
          grants: detail.instance.grants,
        };
      }
      const origin = await window.flowark.request('author.checkout.origin', { flowId: record.id });
      if (!origin) throw Error('此步骤需要模板入口；请从模板制作副本或实例入口打开');
      const entry = origin.draft.definition.entries.find(
        (e: any) => e.id === origin.checkout.entryId,
      );
      if (
        !entry ||
        origin.checkout.flowId !== record.id ||
        origin.checkout.baseRevision !== origin.draft.revision
      )
        throw Error('制作草稿已变化，请回到原入口创建较新的编排副本');
      return {
        kind: 'author',
        actions: origin.draft.definition.actions.filter((a: Action) =>
          entry.actionIds.includes(a.id),
        ),
        grants: {},
      };
    };
    void load()
      .then((v) => {
        if (live) setCatalog(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [record.id, ref?.instanceId, ref?.entryId, ref?.packageKey, ref?.digest, refresh]);
  const textField = (
    label: string,
    value: string | { $ref: string },
    update: (value: string | { $ref: string }) => void,
  ) => (
    <ValueField
      label={label}
      value={value}
      choices={choices}
      change={(next) => {
        if (typeof next !== 'string' && referenceOf(next) === undefined)
          throw Error('请选择文字或变量');
        update(next as string | { $ref: string });
      }}
    >
      <label htmlFor={id + '-' + label}>{label}</label>
      <Input.TextArea
        id={id + '-' + label}
        value={typeof value === 'string' ? value : ''}
        autoSize={{ minRows: label === '完整内容' ? 4 : 1, maxRows: 12 }}
        onChange={(event) => update(event.target.value)}
      />
    </ValueField>
  );
  const actions = catalog?.actions ?? [];
  const action =
    node.operation === 'prepare' ? actions.find((a) => a.id === node.action) : undefined;
  const preceding = referenceScope(record.flow.steps, node.id)?.steps ?? [];
  const receipts = choices.filter((c) =>
    preceding.some(
      (n) => n.type === 'effect' && n.operation === 'prepare' && c.path === 'steps.' + n.id,
    ),
  );
  const currentReceipt = node.operation === 'resolve' ? referenceOf(node.receipt) : undefined;
  return (
    <section className="node-configuration effect-node-configuration" aria-label="操作记录配置">
      <h4>操作记录</h4>
      <p>准备、实际执行和结果核对分为独立步骤；只有本次新记录允许继续。</p>
      {error && (
        <Alert
          type="warning"
          title={error}
          action={<Button onClick={() => setRefresh((v) => v + 1)}>重新读取动作</Button>}
        />
      )}
      <div className="effect-configuration-grid">
        <Card title={node.operation === 'prepare' ? '准备本次操作' : '登记本次操作结果'}>
          <label htmlFor={id + '-operation'}>操作</label>
          <Select
            id={id + '-operation'}
            value={node.operation}
            options={Object.entries(effectOperations).map(([value, label]) => ({ value, label }))}
            onChange={(operation: EffectNode['operation']) => {
              if (!guard()) return;
              setReviewEditing(false);
              const base = {
                id: node.id,
                type: 'effect' as const,
                version: 1 as const,
                ...(node.name === undefined ? {} : { name: node.name }),
                ...(node.timeoutMs === undefined ? {} : { timeoutMs: node.timeoutMs }),
              };
              change(
                operation === 'prepare'
                  ? { ...base, operation, action: '', key: '' }
                  : { ...base, operation, receipt: null, state: 'unknown' },
              );
            }}
          />
          {node.operation === 'prepare' ? (
            <>
              <label htmlFor={id + '-action'}>声明动作</label>
              <Select
                id={id + '-action'}
                value={node.action || undefined}
                loading={loading}
                placeholder="选择当前入口声明的动作"
                disabled={loading || !!error}
                options={[
                  ...actions.map((a) => ({ value: a.id, label: a.name || a.id })),
                  ...(node.action && !action
                    ? [
                        {
                          value: node.action,
                          label: '未在当前入口声明：' + node.action,
                          disabled: true,
                        },
                      ]
                    : []),
                ]}
                onChange={(action) => {
                  if (guard()) change({ ...node, action });
                }}
              />
              {!loading && catalog && !actions.length && (
                <p className="field-error">
                  当前入口尚未声明动作。请在模板制作的动作与入口范围中维护后，重新读取。
                </p>
              )}
              <p>未授权时停止；相同键的失败或未知记录也不再次授权。</p>
              <Button
                onClick={() => {
                  if (guard()) setReviewEditing((v) => !v);
                }}
              >
                {reviewEditing ? '返回基本配置' : '配置人工核对'}
              </Button>
              <Collapse
                items={[
                  {
                    key: 'permissions',
                    label: '查看动作权限',
                    onKeyDown: activateCollapseWithSpace,
                    children: (
                      <>
                        <Descriptions
                          column={1}
                          items={[
                            {
                              key: 'action',
                              label: '动作',
                              children: action?.name || node.action || '尚未选择',
                            },
                            { key: 'detail', label: '说明', children: action?.description || '无' },
                            {
                              key: 'grant',
                              label: '本机授权',
                              children:
                                catalog?.kind === 'author'
                                  ? '制作副本不携带授权'
                                  : ({ deny: '禁止', confirm: '每次确认', auto: '允许自动' }[
                                      catalog?.grants[node.action] ?? 'deny'
                                    ] ?? '禁止'),
                            },
                          ]}
                        />
                        <p>
                          此处只查看；请在实例的资源与动作授权中维护。确认期间授权变化会阻止准备。
                        </p>
                      </>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <>
              <label htmlFor={id + '-receipt'}>准备回执</label>
              <Select
                id={id + '-receipt'}
                value={currentReceipt}
                placeholder="选择前序准备操作的完整结果"
                options={[
                  ...receipts.map((c) => ({ value: c.path, label: c.label })),
                  ...(currentReceipt && !receipts.some((c) => c.path === currentReceipt)
                    ? [
                        {
                          value: currentReceipt,
                          label: '原引用不可用：' + currentReceipt,
                          disabled: true,
                        },
                      ]
                    : []),
                ]}
                onChange={(path) => {
                  if (guard()) change({ ...node, receipt: { $ref: path } });
                }}
              />
              {currentReceipt === undefined && node.receipt !== null && (
                <p>当前为高级固定回执；选择前序准备步骤可替换，宿主仍核对真实账本。</p>
              )}
              <p>
                宿主核对同一实例、同一运行和仍在提交的记录。旧运行、去重回执或终态不能再次登记。
              </p>
            </>
          )}
        </Card>
        <Card
          title={
            node.operation === 'prepare'
              ? reviewEditing
                ? '可选人工核对'
                : '输入与后续条件'
              : '结果与证据'
          }
        >
          {node.operation === 'prepare' ? (
            reviewEditing ? (
              <>
                <Checkbox
                  checked={!!node.review}
                  onChange={(event) => {
                    if (guard())
                      change({
                        ...node,
                        review: event.target.checked
                          ? { version: 1, target: '', content: '' }
                          : null,
                      });
                  }}
                >
                  附带核对目标与完整内容
                </Checkbox>
                {node.review && (
                  <>
                    {textField('核对目标', node.review.target, (target) =>
                      change({ ...node, review: { ...node.review!, target } }),
                    )}
                    {textField('完整内容', node.review.content, (content) =>
                      change({ ...node, review: { ...node.review!, content } }),
                    )}
                    <Collapse
                      items={[
                        {
                          key: 'preview',
                          label: '预览核对内容配置',
                          onKeyDown: activateCollapseWithSpace,
                          children: (
                            <>
                              <ReadonlyValue value={node.review} />
                              <p>
                                引用显示的是来源配置；真正核对内容在运行时固定。超限停止，不截断。
                              </p>
                            </>
                          ),
                        },
                      ]}
                    />
                  </>
                )}
                <p>
                  只在“每次确认”授权下等待本人。关闭正文核对不取消动作确认；确认本身不执行后续操作。
                </p>
              </>
            ) : (
              <>
                {textField('去重键', node.key, (key) => change({ ...node, key }))}
                {textField('操作说明', node.description ?? '', (description) =>
                  change({ ...node, description }),
                )}
                <p>
                  键由模板配置；不会自动识别账号、对象或新内容。下一步以“允许执行”为真进入实际操作。
                </p>
              </>
            )
          ) : (
            <>
              <label htmlFor={id + '-state'}>结果状态</label>
              <Select
                id={id + '-state'}
                value={node.state}
                options={(['confirmed', 'failed', 'unknown'] as const).map((value) => ({
                  value,
                  label: effectStates[value],
                }))}
                onChange={(state: 'confirmed' | 'failed' | 'unknown') => {
                  if (guard()) change({ ...node, state });
                }}
              />
              <ValueField
                label="核对证据"
                value={node.evidence ?? null}
                choices={choices}
                defaultValue=""
                change={(evidence) => change({ ...node, evidence })}
              />
              <p>先实际执行并核对，再登记结果。程序完成、按钮点击或模型推测都不能当作成功证据。</p>
              <p>未知会建立本地待办；不重试或重新执行。</p>
            </>
          )}
        </Card>
      </div>
      {catalog?.kind === 'author' && (
        <p>制作副本仅用于编排；导出、导入正式实例并单独授权后，才可执行操作记录。</p>
      )}
      <Collapse
        items={[
          {
            key: 'outputs',
            label: '查看结果字段',
            onKeyDown: activateCollapseWithSpace,
            children: (
              <p>
                准备输出完整回执及“允许执行（execute）”、状态（state）、操作身份（id）、动作（action）、原键（key）和来源运行（runId）；登记输出身份和终态。历史回执不得重放。
              </p>
            ),
          },
        ]}
      />
    </section>
  );
}
