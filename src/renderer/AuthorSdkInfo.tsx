import { Alert, Button, Collapse, Descriptions, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type {
  TemplateAuthorSdkContext,
  TemplateAuthorSdkResult,
} from '../shared/contracts.generated';
import { author_sdk_context_v1, author_sdk_result_v1 } from '../shared/node-schema.generated';
import { activateCollapseWithSpace } from './collapseKeyboard';

export default function AuthorSdkInfo({
  context,
  error,
  loading = false,
  runId,
}: {
  context?: TemplateAuthorSdkContext;
  error?: string;
  loading?: boolean;
  runId?: string;
}) {
  const [value, setValue] = useState<TemplateAuthorSdkResult>();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('');
  const sequence = useRef(0),
    trigger = useRef<HTMLButtonElement>(null),
    feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sequence.current++;
    setValue(undefined);
    setOpen(false);
    setBusy(false);
    setFailure('');
    return () => {
      sequence.current++;
    };
  }, [runId, context?.id]);
  useEffect(() => {
    if (failure) feedback.current?.focus();
  }, [failure]);
  if (loading) return <p role="status">正在读取本副本固定SDK来源…</p>;
  if (!context || !author_sdk_context_v1(context))
    return (
      <Alert
        type="warning"
        showIcon
        title="结果与提醒调试暂不可用"
        description={
          error ||
          '此副本没有固定SDK上下文。请核对带回并保存制作修订后创建新副本，原编排和记录保留。'
        }
      />
    );
  const read = async () => {
    if (busy || !runId) return;
    if (open) {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (value) {
      setOpen(true);
      return;
    }
    const request = ++sequence.current;
    setBusy(true);
    setFailure('');
    try {
      const response = await window.flowark.request('author.sdk.result', { runId });
      if (!author_sdk_result_v1(response)) throw Error('保存结果格式无效');
      const next = response as TemplateAuthorSdkResult;
      if (sequence.current !== request) return;
      if (
        next.runId !== runId ||
        next.contextId !== context.id ||
        next.definitionSha256 !== context.definitionSha256
      )
        throw Error('保存结果与本Run固定作者来源不符');
      setValue(next);
      setOpen(true);
    } catch (error) {
      if (sequence.current === request)
        setFailure(
          (error instanceof Error ? error.message : '读取未完成').replace(
            /^Error invoking remote method 'flowark:request': (?:Error: )?/,
            '',
          ),
        );
    } finally {
      if (sequence.current === request) setBusy(false);
    }
  };
  return (
    <section className="author-sdk-info" aria-label="作者调试来源与结果">
      <Tag color="processing" variant="filled">
        作者调试
      </Tag>
      <p>
        固定入口 {context.owner.entryId} · 制作修订 {context.owner.baseRevision}
        。结果与提醒只属本副本，不写入正式实例或公开ZIP。
      </p>
      <Collapse
        size="small"
        items={[
          {
            key: 'source',
            label: '查看固定SDK来源',
            onKeyDown: activateCollapseWithSpace,
            children: (
              <>
                <Descriptions
                  size="small"
                  column={1}
                  items={[
                    { key: 'checkout', label: '编排副本', children: context.owner.checkoutId },
                    { key: 'draft', label: '制作草稿', children: context.owner.draftId },
                    {
                      key: 'hash',
                      label: '固定定义摘要',
                      children: <span className="path-text">{context.definitionSha256}</span>,
                    },
                    {
                      key: 'time',
                      label: '创建时间',
                      children: new Date(context.createdAt).toLocaleString('zh-CN'),
                    },
                    {
                      key: 'capabilities',
                      label: '固定能力',
                      children: context.capabilities.join('、') || '未声明',
                    },
                  ]}
                />
                <p>
                  本版支持result/attention，两者需模板SDK能力，提醒还需attention；其他SDK须在正式实例中配置和验收。修改结果结构或能力后，请保存制作修订并创建新副本。
                </p>
                <pre tabIndex={0} aria-label="固定结果结构">
                  {JSON.stringify(context.resultSchema, null, 2)}
                </pre>
              </>
            ),
          },
        ]}
      />
      {runId && (
        <>
          <Button
            ref={trigger}
            loading={busy}
            disabled={busy}
            aria-expanded={open}
            onClick={() => void read()}
          >
            {open ? '收起作者SDK保存结果' : '查看作者SDK保存结果'}
          </Button>
          {failure && (
            <div ref={feedback} tabIndex={-1}>
              <Alert type="error" showIcon title={failure} />
            </div>
          )}
          {open && value && (
            <div className="author-sdk-saved-result">
              <p>
                本机完整保存结果 · {new Date(value.createdAt).toLocaleString('zh-CN')}
                。只读取原记录，不重新执行；已保存结果不代表整个Run或外部业务成功。
              </p>
              <pre tabIndex={0} aria-label="作者SDK完整保存结果">
                {JSON.stringify(value.value, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}
