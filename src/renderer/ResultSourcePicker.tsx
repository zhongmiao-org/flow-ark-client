import { Alert, Button, Card, Input, Modal, Select, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { Bindings } from '../shared/types';
import type {
  RunResultTarget as Target,
  RunResultListResponse as Page,
  RunResultPreviewAvailable as Preview,
  RunResultInspectAvailable as Inspection,
} from '../shared/contracts.generated';
import { resultBudget } from '../shared/run-result-source';
import { browserDigest } from '../shared/conversation-archive';
import {
  run_result_list_response_v1,
  run_result_preview_response_v1,
  run_result_select_response_v1,
  run_result_inspect_response_v1,
} from '../shared/node-schema.generated';
import CompleteValue from './CompleteValue';
import './result-source.css';
const reason: Record<string, string> = {
  'source-unavailable': '来源不在当前范围内或暂不可核验',
  'source-not-succeeded': '来源运行尚未成功结束',
  'reuse-unavailable': '没有可核验的复用副本，旧记录不会自动重建',
  'privacy-unavailable': '无法提供完整受保护副本',
  'schema-invalid': '固定结果结构不可核验',
  'result-invalid': '完整数据或结构校验未通过',
  'read-limit': '完整读取超过预算，未截断采用',
  'changed-during-read': '读取期间来源或目标发生变化，请重新核对',
  'storage-unavailable': '本机存储暂不可用',
};
const canonical = (v: any): string =>
  v && typeof v === 'object'
    ? Array.isArray(v)
      ? '[' + v.map(canonical).join(',') + ']'
      : '{' +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
          .join(',') +
        '}'
    : JSON.stringify(v);
async function checked(method: string, args: any, validate: (v: unknown) => boolean) {
  const v = await window.flowark.request('resultSource.' + method, args);
  if (
    !resultBudget(v) ||
    !validate(v) ||
    canonical(v.target) !== canonical(args.target) ||
    v.binding !== args.binding
  )
    throw Error('结果来源响应与当前目标不一致，原绑定保留');
  if ('readStamp' in v) {
    const { readStamp, ...body } = v;
    if ((await browserDigest(body)) !== readStamp) throw Error('结果读取核对摘要不一致');
  }
  if ('value' in v) {
    if (
      (await browserDigest(v.value)) !== v.ref.dataSha256 ||
      new TextEncoder().encode(canonical(v.value)).length !== v.ref.dataBytes
    )
      throw Error('完整数据摘要或字节数不一致，未采用');
  }
  return v;
}
export default function ResultSourcePicker({
  target,
  binding,
  value,
  change,
  label,
  disabled = false,
}: {
  target: Target;
  binding: string;
  value?: NonNullable<Bindings['resources']>[string];
  label: string;
  disabled?: boolean;
  change: (
    value: NonNullable<Bindings['resources']>[string] | undefined,
    choiceId?: string,
  ) => void;
}) {
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState<'list' | 'preview' | 'saved'>('list');
  const [query, setQuery] = useState(''),
    [listedQuery, setListedQuery] = useState(''),
    [page, setPage] = useState<Page>(),
    [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState<Preview | Inspection>(),
    [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0),
    lock = useRef(false),
    signature = JSON.stringify({ target, binding, value, disabled }),
    scope = useRef(signature);
  scope.current = signature;
  const close = () => {
    generation.current++;
    lock.current = false;
    setBusy(false);
    setOpen(false);
    setPreview(undefined);
    setError('');
  };
  useEffect(() => {
    close();
    setPage(undefined);
    setSelected(undefined);
    return () => {
      generation.current++;
      lock.current = false;
    };
  }, [signature]);
  const work = async (fn: (live: () => boolean) => Promise<void>) => {
    if (lock.current || disabled) return;
    lock.current = true;
    const visit = ++generation.current,
      current = signature;
    const live = () => generation.current === visit && scope.current === current;
    setBusy(true);
    setError('');
    try {
      await fn(live);
    } catch (e) {
      if (live()) setError((e as Error).message || '结果来源暂未读取，原绑定保留');
    } finally {
      if (live()) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const list = (cursor: Page['next'] = null) =>
    void work(async (live) => {
      const requestedQuery = cursor ? listedQuery : query;
      const v = await checked(
        'list',
        { target, binding, query: requestedQuery, cursor },
        run_result_list_response_v1,
      );
      if (new Set(v.choices.map((c: any) => c.run.id)).size !== v.choices.length)
        throw Error('目录包含重复记录');
      if (live()) {
        setListedQuery(requestedQuery);
        setPage(v);
        setSelected(undefined);
        setMode('list');
        setPreview(undefined);
        setOpen(true);
      }
    });
  const inspect = () =>
    void work(async (live) => {
      const v = await checked('inspect', { target, binding }, run_result_inspect_response_v1);
      if (v.status !== 'available') throw Error(reason[v.reason] || '当前目标尚未保存来源绑定');
      if (live()) {
        setPreview(v);
        setFull(true);
        setMode('saved');
        setOpen(true);
      }
    });
  const view = () =>
    void work(async (live) => {
      const v = await checked(
        'preview',
        { target, binding, runId: selected },
        run_result_preview_response_v1,
      );
      if (v.status !== 'available') throw Error(reason[v.reason] || '来源暂不可复用');
      if (v.ref.run.id !== selected) throw Error('预览并非所选运行');
      if (live()) {
        setPreview(v);
        setFull(false);
        setMode('preview');
      }
    });
  const confirm = () =>
    void work(async (live) => {
      if (!preview || !('reviewId' in preview)) return;
      const v = await checked(
        'select',
        {
          target,
          binding,
          reviewId: preview.reviewId,
          readStamp: preview.readStamp,
          reviewed: true,
        },
        run_result_select_response_v1,
      );
      if (canonical(v.ref) !== canonical(preview.ref)) throw Error('选择回执不是当前完整预览');
      if (live()) {
        change({ result: v.ref }, v.choiceId);
        close();
      }
    });
  return (
    <div className="source-picker result-source-picker">
      <p role="status">
        {value?.result
          ? `固定来源入口：${value.result.source.entryId} · 数据摘要 ${value.result.dataSha256.slice(0, 12)}`
          : '尚未选择前次结果'}
      </p>
      <Space wrap>
        <Button disabled={disabled || busy} onClick={() => list()}>
          {value?.result ? '替换结果来源' : '选择结果来源'}
        </Button>
        <Button disabled={disabled || busy || !value?.result} onClick={inspect}>
          查看已保存来源
        </Button>
        <Button
          disabled={disabled || busy || !value?.result}
          onClick={() => {
            close();
            change(undefined);
          }}
        >
          清除选择
        </Button>
      </Space>
      <p>选择或清除只更新表单草稿，保存后生效；不会跟随最新结果，也不会创建运行。</p>
      {error && !open && <Alert type="error" title={error} showIcon />}
      <Modal
        open={open}
        title={
          mode === 'list'
            ? '选择前次已保存结果'
            : mode === 'saved'
              ? '已保存的准确来源'
              : full
                ? '阅读完整可复用数据'
                : '核对这次要复用的内容'
        }
        width="min(1100px, calc(100vw - 64px))"
        className="result-source-modal"
        onCancel={close}
        mask={{ closable: false }}
        footer={
          <Space wrap>
            {mode === 'list' ? (
              <>
                <Button onClick={close}>取消选择</Button>
                <Button type="primary" disabled={busy || !selected} onClick={view}>
                  预览所选结果
                </Button>
              </>
            ) : (
              <>
                <Button disabled={busy} onClick={() => list()}>
                  返回目录
                </Button>
                {mode === 'preview' ? (
                  <Button
                    type="primary"
                    disabled={busy || !preview || !('reviewId' in preview)}
                    onClick={confirm}
                  >
                    确认选择此结果
                  </Button>
                ) : (
                  <Button onClick={close}>关闭</Button>
                )}
              </>
            )}
          </Space>
        }
      >
        <p className="readonly-value-muted">
          {target.kind === 'instance'
            ? '仅本实例声明入口内的结果'
            : '仅同一制作草稿声明入口内的结果'}{' '}
          · {label}
        </p>
        <Card className="result-source-card">
          <div className="result-source-scroll" aria-busy={busy}>
            {error && <Alert type="error" title={error} showIcon />}
            {mode === 'list' ? (
              <>
                <label className="source-field">
                  搜索
                  <Input.Search
                    aria-label="搜索前次结果"
                    value={query}
                    maxLength={200}
                    disabled={busy}
                    onChange={(e) => setQuery(e.target.value)}
                    onSearch={() => list()}
                    enterButton="搜索"
                    placeholder="按入口名称或运行标识搜索"
                  />
                </label>
                <label className="source-field">
                  可选来源
                  <Select
                    aria-label="可复用结果来源"
                    value={selected}
                    disabled={busy}
                    placeholder="选择准确的已完成运行"
                    onChange={setSelected}
                    options={(page?.choices ?? []).map((c) => ({
                      value: c.run.id,
                      disabled: c.status !== 'candidate',
                      label: `${c.entryName || c.entryId} · ${c.run.id.slice(0, 8)} · ${c.status === 'candidate' ? '可预览' : reason[c.reason!] || '不可复用'}`,
                    }))}
                  />
                </label>
                {!page?.choices.length && (
                  <p>
                    本页没有可复用记录。只有已成功结束且已登记完整受保护副本的来源可选；旧记录不会自动重跑。
                  </p>
                )}
                {page?.next && (
                  <Button disabled={busy || query !== listedQuery} onClick={() => list(page.next)}>
                    查看后续结果（每页最多20条）
                  </Button>
                )}
              </>
            ) : (
              preview && (
                <>
                  <p>
                    <Tag>准确来源 · 固定版本</Tag>
                    {preview.ref.source.entryId} · {preview.ref.run.id}
                  </p>
                  <p className="readonly-value-muted">
                    凭据字段、已知秘密和常见Key文本已过滤，可能包含本人资料。
                    {preview.dataChanged ? '本副本经过过滤。' : ''}
                  </p>
                  {!full && <Button onClick={() => setFull(true)}>阅读完整内容</Button>}
                  <CompleteValue
                    key={preview.ref.dataSha256 + ':' + preview.ref.run.id}
                    value={preview.value}
                    labels={preview.labels}
                  />
                </>
              )
            )}
          </div>
        </Card>
        <p className="readonly-value-muted">
          确认选择采用完整已核验副本，保存参数后才生效。后续AI、网络或外发仍按相应节点、资源与运行确认执行。
        </p>
      </Modal>
    </div>
  );
}
