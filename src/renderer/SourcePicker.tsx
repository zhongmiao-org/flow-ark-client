import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space, Tag } from 'antd';
import type { Bindings } from '../shared/types';
import type { SourceTarget } from '../shared/conversation-source';
import { sourceRefSchema } from '../shared/conversation-source';
import type {
  ConversationArchiveRef as Ref,
  ConversationArchiveManifest as Manifest,
  ConversationArchivePage as Page,
  ConversationArchiveRecord as Row,
} from '../shared/conversation-archive';
import { verifyArchivePage } from '../shared/conversation-archive';
import { RecordView } from './ConversationArchivePanel';
import './source.css';
type Choice = {
  ref: Ref;
  title: string;
  confirmedAt: string;
  requestCount: number;
  originRequestCount: number;
  historyCount: number;
  contextCount: number;
  failedCount: number;
  cancelledCount: number;
  current: boolean | null;
  currentError: string;
  manifest?: Manifest;
};
const api = (method: string, args: unknown) => window.flowark.request('source.' + method, args);
function checkChoice(v: Choice) {
  sourceRefSchema.parse(v.ref);
  if (
    typeof v.title !== 'string' ||
    v.title.length > 200 ||
    !Number.isSafeInteger(v.requestCount) ||
    v.requestCount < 1 ||
    ![true, false, null].includes(v.current)
  )
    throw Error('来源目录响应格式无效');
  return v;
}
export default function SourcePicker({
  target,
  binding,
  value,
  change,
  disabled = false,
  label = '完整会话来源',
}: {
  target: SourceTarget;
  binding: string;
  value?: NonNullable<Bindings['resources']>[string];
  change: (value: NonNullable<Bindings['resources']>[string] | undefined) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState('');
  const [choices, setChoices] = useState<Choice[]>([]),
    [cursor, setCursor] = useState<any>(null),
    [next, setNext] = useState<any>(null);
  const [loading, setLoading] = useState(false),
    [selecting, setSelecting] = useState(false),
    [error, setError] = useState('');
  const [current, setCurrent] = useState<Choice>(),
    [preview, setPreview] = useState<Choice & { manifest: Manifest }>();
  const [refresh, setRefresh] = useState(0),
    generation = useRef(0),
    selection = useRef(0);
  const revision = target.revision,
    targetId = target.id,
    kind = target.kind;
  useEffect(() => {
    const visit = ++generation.current;
    setLoading(true);
    setError('');
    void api('list', { target: { kind, id: targetId, revision }, query: search, cursor })
      .then((v) => {
        if (!Array.isArray(v.choices) || v.choices.length > 20) throw Error('来源目录响应超出预算');
        const found = v.choices.map(checkChoice);
        if (visit === generation.current) {
          setChoices(found);
          setNext(v.next);
        }
      })
      .catch((e) => {
        if (visit === generation.current) setError(e.message || '来源目录未读取，原绑定保留');
      })
      .finally(() => {
        if (visit === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [kind, targetId, revision, search, cursor, refresh]);
  useEffect(() => {
    const visit = ++selection.current;
    setCurrent(undefined);
    setPreview(undefined);
    setSelecting(false);
    if (value?.source)
      void api('inspect', { target: { kind, id: targetId, revision }, binding, ref: value.source })
        .then((v) => {
          checkChoice(v);
          if (visit === selection.current) setCurrent(v);
        })
        .catch((e) => {
          if (visit === selection.current) setError(e.message || '原来源暂不可核对，绑定保留');
        });
    return () => {
      selection.current++;
    };
  }, [kind, targetId, revision, binding, value?.source?.archiveId, value?.source?.sha256]);
  const choose = async (id: string) => {
    const found = choices.find((c) => c.ref.archiveId === id);
    if (!found) return;
    const visit = ++selection.current;
    setSelecting(true);
    setError('');
    try {
      const v = checkChoice(await api('select', { target, binding, ref: found.ref }));
      if (visit === selection.current) {
        setCurrent(v);
        change({ source: v.ref });
      }
    } catch (e) {
      if (visit === selection.current) setError((e as Error).message);
    } finally {
      if (visit === selection.current) setSelecting(false);
    }
  };
  const inspect = async () => {
    if (!value?.source) return;
    const visit = ++selection.current;
    setSelecting(true);
    setError('');
    try {
      const v = await api('inspect', { target, binding, ref: value.source });
      checkChoice(v);
      if (visit === selection.current) setPreview(v);
    } catch (e) {
      if (visit === selection.current) setError((e as Error).message);
    } finally {
      if (visit === selection.current) setSelecting(false);
    }
  };
  return (
    <div className="source-picker">
      <div className="source-field">
        搜索来源
        <Input.Search
          aria-label={'搜索' + label}
          value={query}
          maxLength={200}
          placeholder="按名称搜索已确认来源"
          disabled={disabled || selecting}
          onChange={(e) => setQuery(e.target.value)}
          onSearch={() => {
            setCursor(null);
            setSearch(query);
            setRefresh((v) => v + 1);
          }}
          enterButton="搜索"
        />
      </div>
      <label>
        已确认来源
        <Select
          aria-label={label}
          disabled={disabled || selecting || loading}
          loading={loading}
          value={value?.source?.archiveId}
          placeholder="选择本机已确认来源"
          onSelect={(id) => void choose(id)}
          options={[
            ...(value?.source && !choices.some((c) => c.ref.archiveId === value.source!.archiveId)
              ? [
                  {
                    value: value.source.archiveId,
                    label: current
                      ? `${current.title} · ${current.requestCount}次请求`
                      : '原固定绑定 · 待读取',
                    disabled: true,
                  },
                ]
              : []),
            ...choices.map((c) => ({
              value: c.ref.archiveId,
              label: `${c.title} · ${c.requestCount}次请求 · ${new Date(c.confirmedAt).toLocaleString()}${c.current === false ? ' · 已有新补充' : c.current === null ? ' · 暂不可核对' : ''}`,
            })),
          ]}
        />
      </label>
      <Space wrap>
        <Button
          disabled={disabled || loading || selecting}
          onClick={() => {
            setCursor(null);
            setRefresh((v) => v + 1);
          }}
        >
          重新读取目录
        </Button>
        {next && (
          <Button disabled={disabled || loading || selecting} onClick={() => setCursor(next)}>
            查看后续来源
          </Button>
        )}
        <Button disabled={disabled || selecting || !value?.source} onClick={() => void inspect()}>
          查看来源原文
        </Button>
        <Button
          disabled={disabled || selecting || !value?.source}
          onClick={() => {
            selection.current++;
            change(undefined);
            setCurrent(undefined);
            setPreview(undefined);
          }}
        >
          清除选择
        </Button>
      </Space>
      {current && (
        <div role="status">
          <Tag>
            {current.current === true
              ? '当前固定来源'
              : current.current === false
                ? '原访谈已有新补充'
                : '当前性暂不可核对'}
          </Tag>
          <p>
            原访谈 {current.originRequestCount} 次 + 持续 {current.historyCount} 次 ={' '}
            {current.requestCount} 次请求；固定资料 {current.contextCount} 份；失败{' '}
            {current.failedCount} 次，取消 {current.cancelledCount} 次。
          </p>
        </div>
      )}
      {!loading && choices.length === 0 && (
        <p>
          {next
            ? '这一页没有匹配项，可继续查看后续来源。'
            : '暂无匹配的已确认来源。请先在会话中准备并确认完整来源。'}
        </p>
      )}
      {error && <Alert type="error" title={error} />}
      <p>
        保存后仅此流程或实例采用固定版本；新补充不会自动替换。选择和读取来源不调用模型，公开导出不携带本机来源。
      </p>
      {preview && (
        <SourceOriginal
          target={target}
          binding={binding}
          source={preview}
          close={() => setPreview(undefined)}
        />
      )}
    </div>
  );
}
function SourceOriginal({
  target,
  binding,
  source,
  close,
}: {
  target: SourceTarget;
  binding: string;
  source: Choice & { manifest: Manifest };
  close: () => void;
}) {
  const [page, setPage] = useState<Page>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0),
    start = { source: source.ref, nextOrdinal: 1, previousHash: source.manifest.rootHash };
  async function load(cursor: Page['cursor'] | null, previous: Row | null) {
    const visit = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const p = await api('page', { target, binding, ref: source.ref, cursor });
      await verifyArchivePage(p, source.manifest, cursor ?? start, previous);
      if (visit === generation.current) setPage(p);
    } catch (e) {
      if (visit === generation.current) setError((e as Error).message);
    } finally {
      if (visit === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load(null, null);
    return () => {
      generation.current++;
    };
  }, []);
  return (
    <Modal
      open
      width="min(1000px, calc(100vw - 32px))"
      title={source.title + ' · 固定来源原文'}
      onCancel={close}
      footer={
        <Space wrap>
          <Button disabled={busy} onClick={() => void load(null, null)}>
            返回第一页
          </Button>
          <Button
            disabled={busy || !page?.next}
            onClick={() => void load(page!.next, page!.records.at(-1)!)}
          >
            下一页
          </Button>
          <Button onClick={close}>关闭原文</Button>
        </Space>
      }
    >
      <div className="source-original">
        <p>{source.requestCount}次请求 · 只读查看，不调用模型</p>
        {error && <Alert type="error" title={error} />}
        {busy && <p role="status">正在核对来源原文…</p>}
        {page && (
          <>
            <p>
              记录 {page.records[0].ordinal}–{page.records.at(-1)!.ordinal} /{' '}
              {source.manifest.recordCount} · {page.next ? '还有后续' : '已到固定终点'}
            </p>
            {page.records.map((row) => (
              <RecordView key={row.ordinal} row={row} />
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
