import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Tag } from 'antd';
import {
  archiveEvent,
  assertArchiveView,
  verifyArchivePage,
  type ArchiveView,
  type ConversationArchivePage as Page,
  type ConversationArchiveRecord as Row,
  type ConversationArchiveCursor as Cursor,
} from '../shared/conversation-archive';
import MarkdownBody from './MarkdownBody';
import './conversation.css';
const api = (method: string, args: unknown): Promise<any> =>
  window.flowark.request('conversation.archive.' + method, args);
const states = {
  preparing: '正在准备本机完整来源',
  review: '来源已准备 · 等待核对',
  confirmed: '完整来源已确认',
  cancelled: '上次准备已停止',
  failed: '准备未完成',
};
function SourceBranch({ label, value }: { label: string; value: any }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {label}
        {value && typeof value === 'object' ? ` · ${Object.keys(value).length} 项` : ''}
      </summary>
      {open && <SourceData value={value} />}
    </details>
  );
}
function SourceData({ value }: { value: any }) {
  const [limit, setLimit] = useState(30);
  if (value === null || typeof value !== 'object')
    return <p className="archive-text">{value === null ? '空值' : String(value)}</p>;
  const entries = Object.entries(value);
  return (
    <div className="archive-data">
      {entries.slice(0, limit).map(([key, child]) => (
        <SourceBranch
          key={key}
          label={Array.isArray(value) ? `第 ${Number(key) + 1} 项` : key}
          value={child}
        />
      ))}
      {limit < entries.length && (
        <Button onClick={() => setLimit(limit + 30)}>
          查看后续条目（还有 {entries.length - limit} 项）
        </Button>
      )}
    </div>
  );
}
const usage = (v: any) => {
  if (!v || typeof v !== 'object') return '用量未知';
  const fields = [
    ['输入', v.prompt_tokens ?? v.input_tokens],
    ['输出', v.completion_tokens ?? v.output_tokens],
    ['合计', v.total_tokens],
  ].filter(([, n]) => Number.isSafeInteger(n));
  return fields.length
    ? fields.map(([label, n]) => `${label} ${n}`).join(' · ') + ' token'
    : '用量字段待核对';
};
function Turn({
  text,
  answer,
  state,
  tokens,
}: {
  text: string;
  answer: string;
  state: string;
  tokens: any;
}) {
  return (
    <div className="conversation-thread-turn">
      <div className="conversation-message is-user">
        <strong>你</strong>
        <p>{text}</p>
      </div>
      <div className="conversation-message">
        <strong>助手 · {state === 'complete' ? '完整回复' : '未完成片段'}</strong>
        {answer ? <MarkdownBody text={answer} /> : <p>没有完成的助手正文</p>}
        <p>{usage(tokens)}</p>
      </div>
    </div>
  );
}
function RecordView({ row }: { row: Row }) {
  const p = row.payload;
  if (p.kind === 'history')
    return (
      <Card
        size="small"
        title={`第 ${p.entry.ordinal} 次补充 · ${p.entry.state === 'complete' ? '完成' : p.entry.state === 'failed' ? '失败' : '取消'}`}
      >
        <Turn
          text={p.entry.text}
          answer={p.entry.answer}
          state={p.entry.state}
          tokens={p.entry.usage}
        />
        {p.entry.retryOf && <p>本次是原未完成请求的显式重试；原请求仍保留。</p>}
      </Card>
    );
  if (p.kind === 'context')
    return (
      <Card size="small" title="固定资料与设置">
        <p>
          {p.context.title} · {p.context.provider} / {p.context.model}
        </p>
        <Collapse
          items={[
            {
              key: 'source',
              label: '查看资料原文与字段',
              children: <SourceData value={p.context.context} />,
            },
            {
              key: 'instructions',
              label: '查看当时的指令（只读）',
              children: <p className="archive-text">{p.context.instructions}</p>,
            },
          ]}
        />
      </Card>
    );
  const s = p.snapshot;
  return (
    <Card size="small" title={`原访谈 · ${s.attempts.length} 次请求（完整保留一次）`}>
      <Collapse
        items={s.attempts.map((a, i) => {
          const user = s.messages.find((m) => m.role === 'user' && m.turnId === a.turnId),
            assistant = s.messages.find((m) => m.role === 'assistant' && m.requestId === a.id);
          return {
            key: a.id,
            label: `原访谈第 ${i + 1} 次 · ${a.state === 'complete' ? '完成' : a.state === 'failed' ? '失败' : '取消'}`,
            children: (
              <Turn
                text={user?.text ?? '本人消息对应待核对'}
                answer={assistant?.text ?? ''}
                state={a.state}
                tokens={a.usage}
              />
            ),
          };
        })}
      />
      <details>
        <summary>原访谈的资料与指令</summary>
        <p className="archive-text">{s.instructions}</p>
        <SourceData value={s.context} />
      </details>
    </Card>
  );
}
export default function ConversationArchivePanel({
  id,
  headRevision,
  hasInput,
  back,
}: {
  id: string;
  headRevision: number;
  hasInput: boolean;
  back: () => void;
}) {
  const [view, setView] = useState<ArchiveView | null>(),
    saved = useRef<ArchiveView | null | undefined>(undefined);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    locked = useRef(false);
  const [reviewed, setReviewed] = useState(false),
    [page, setPage] = useState<Page>();
  const pending = useRef<{ requestId: string; revision: number } | null>(null);
  const alive = useRef(true),
    expectedHead = useRef(headRevision),
    read = useRef<() => Promise<void>>(async () => {}),
    root = useRef<HTMLElement>(null);
  expectedHead.current = headRevision;
  const accept = useRef<(v: ArchiveView | null, replace?: boolean) => void>(() => {});
  accept.current = (v, replace = false) => {
    if (!alive.current) return;
    if (v) {
      assertArchiveView(v);
      if (v.operation.sessionId !== id) throw Error('来源不属于此会话');
      if (v.headRevision < expectedHead.current) {
        void read.current();
        return;
      }
      const before = saved.current;
      if (
        before &&
        before.operation.id === v.operation.id &&
        (v.operation.revision < before.operation.revision ||
          (v.operation.revision === before.operation.revision &&
            v.headRevision < before.headRevision))
      )
        return;
      if (before && before.operation.id !== v.operation.id && !replace) {
        void read.current();
        return;
      }
      if (
        before?.operation.id !== v.operation.id ||
        before.operation.manifest?.sha256 !== v.operation.manifest?.sha256
      )
        setPage(undefined);
      if (before?.operation.revision !== v.operation.revision) setReviewed(false);
    }
    saved.current = v;
    setView(v);
  };
  useEffect(() => {
    alive.current = true;
    saved.current = undefined;
    setView(undefined);
    setPage(undefined);
    setError('');
    let disposed = false,
      reading = false,
      again = false;
    const load = async () => {
      if (disposed) return;
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      try {
        const v = await api('latest', { id });
        if (!disposed) accept.current(v, true);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : '来源读取未完成');
      } finally {
        reading = false;
        if (again && !disposed) {
          again = false;
          void load();
        }
      }
    };
    read.current = load;
    const stop = window.flowark.onmessage((raw) => {
      if (raw.kind !== 'conversation.archive.snapshot' || raw.sessionId !== id) return;
      try {
        const e = archiveEvent(raw),
          current = saved.current;
        if (
          !current ||
          e.archiveId !== current.operation.id ||
          e.sequence > current.operation.revision + 1
        ) {
          void load();
          return;
        }
        if (e.sequence <= current.operation.revision) return;
        accept.current(e.snapshot);
      } catch {
        void load();
      }
    });
    const focus = () => void load();
    window.addEventListener('focus', focus);
    void load();
    return () => {
      disposed = true;
      alive.current = false;
      stop();
      window.removeEventListener('focus', focus);
    };
  }, [id]);
  useEffect(() => {
    void read.current();
  }, [headRevision]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const main = element.closest('main');
    const measure = () => {
      const top = element.getBoundingClientRect().top;
      const offset = main ? top - main.getBoundingClientRect().top + main.scrollTop : top;
      element.style.height = `${Math.max(300, (main?.clientHeight ?? window.innerHeight) - offset)}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main ?? document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const act = async (fn: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '操作未完成，请重新读取原结果');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const prepare = () =>
    act(async () => {
      if (hasInput) throw Error('请先返回聊天处理当前输入、请求或资料变化，再准备新来源。');
      if (pending.current) {
        const v = await api('receipt', { id, requestId: pending.current.requestId });
        pending.current = null;
        if (v) {
          accept.current(v, true);
          return;
        }
        throw Error('本次准备未被受理；现在可重新点击准备完整来源。');
      }
      const request = { requestId: crypto.randomUUID(), revision: expectedHead.current };
      pending.current = request;
      const v = await api('prepare', { id, ...request });
      pending.current = null;
      accept.current(v, true);
    });
  const loadPage = (next: boolean) =>
    act(async () => {
      const s = saved.current,
        m = s?.operation.manifest;
      if (!s || !m) return;
      const source = { version: 1 as const, archiveId: m.id, sessionId: id, sha256: m.sha256 };
      const cursor: Cursor =
        next && page?.next ? page.next : { source, nextOrdinal: 1, previousHash: m.rootHash };
      const v = await api('page', { id, operationId: s.operation.id, cursor });
      await verifyArchivePage(v, m, cursor, next ? (page?.records.at(-1) ?? null) : null);
      if (
        alive.current &&
        saved.current?.operation.id === s.operation.id &&
        saved.current.operation.manifest?.sha256 === m.sha256
      )
        setPage(v);
    });
  const control = (method: 'resume' | 'cancel') =>
    act(async () => {
      const o = saved.current?.operation;
      if (!o) return;
      accept.current(await api(method, { id, operationId: o.id, revision: o.revision }));
    });
  const confirm = () =>
    act(async () => {
      const s = saved.current;
      if (!s || !reviewed || hasInput) return;
      const o = s.operation,
        p = await api('preview', { id, operationId: o.id, revision: o.revision });
      assertArchiveView(p.operation);
      if (p.operation.operation.id !== o.id || p.sha256 !== o.manifest?.sha256)
        throw Error('来源核对内容已变化');
      try {
        accept.current(
          await api('confirm', {
            id,
            operationId: o.id,
            revision: o.revision,
            requestId: crypto.randomUUID(),
            token: p.token,
            sha256: p.sha256,
            reviewed: true,
          }),
        );
      } catch (e) {
        await read.current();
        throw e;
      }
    });
  const o = view?.operation,
    m = o?.manifest;
  return (
    <section ref={root} className="page conversation-page" aria-label="完整访谈来源">
      <header className="conversation-heading">
        <div>
          <h1>完整访谈来源</h1>
          <p>原访谈与后续请求完整保留；固定来源不调用模型，AI整理与Skill保存另行进行。</p>
        </div>
        <Button onClick={back}>返回继续聊天</Button>
      </header>
      {error && <Alert type="error" title={error} />}
      {hasInput && (
        <Alert type="warning" title="聊天中有待处理输入、请求或资料变化，暂不固定新来源" />
      )}
      <Card className="conversation-card">
        <div className="conversation-status">
          <Tag>
            {o ? states[o.state] : view === undefined ? '正在读取本机来源' : '尚未准备完整来源'}
          </Tag>
          {o && (
            <span>
              已保存 {o.requestCount}/{o.totalRequests} 次请求 · 本机操作，未调用模型
            </span>
          )}
        </div>
        {view && !view.current && (
          <Alert
            type="warning"
            title="访谈或资料已变化，本次固定范围保留"
            description={view.currentError}
          />
        )}
        <div className="conversation-messages">
          <div className="conversation-message-list">
            {!o && (
              <div className="conversation-message archive-summary">
                <h3>完整范围独立于聊天窗口</h3>
                <p>
                  包含原访谈、后续全部成功/失败/取消请求、资料与设置。准备完成后可按页查看原文；无需复制或编辑JSON。
                </p>
              </div>
            )}
            {o?.state === 'preparing' && (
              <div className="conversation-message archive-summary">
                <h3>
                  {o.verifiedRecords < o.recordCount
                    ? '正在核对已保存前缀'
                    : '正在分批准备本机来源'}
                </h3>
                <p>
                  已保存 {o.recordCount} 条来源记录，本次已核对 {o.verifiedRecords}{' '}
                  条。可以取消并保留进度；重开不会自动继续。
                </p>
              </div>
            )}
            {o?.error && <Alert type={o.state === 'failed' ? 'error' : 'info'} title={o.error} />}
            {m && (
              <div className="conversation-message archive-summary">
                <h3>完整来源目录</h3>
                <p>
                  原访谈 {m.originRequestCount} 次 + 持续补充 {m.historyCount} 次 = {m.requestCount}{' '}
                  次请求
                </p>
                <p>
                  完成 {m.completeCount} 次 · 失败 {m.failedCount} 次 · 取消 {m.cancelledCount} 次 ·
                  固定资料 {m.contextCount} 份
                </p>
                <p>未完成的本人输入和助手片段保留；助手建议不自动成为已确认事实。</p>
                <Button disabled={busy} onClick={() => void loadPage(false)}>
                  查看来源原文
                </Button>
              </div>
            )}
            {page && (
              <>
                <p>
                  来源原文 · 第 {page.records[0].ordinal}–{page.records.at(-1)!.ordinal} 条 /{' '}
                  {m?.recordCount} 条{page.next ? '' : ' · 已到固定终点'}
                </p>
                {page.records.map((r) => (
                  <RecordView key={r.ordinal} row={r} />
                ))}
              </>
            )}
          </div>
        </div>
        <footer className="conversation-composer">
          {o?.state === 'review' && (
            <Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)}>
              已核对完整访谈范围及未完成记录的处理；这不等于确认Skill或外发授权
            </Checkbox>
          )}
          {o?.state === 'confirmed' && <p>来源已完整固定；AI整理尚未开始，Skill尚未生成。</p>}
          <div className="conversation-actions">
            {(!o || (o.state !== 'preparing' && !view?.current)) && (
              <Button
                type={o && ['cancelled', 'failed'].includes(o.state) ? 'default' : 'primary'}
                disabled={busy || hasInput || view === undefined}
                onClick={() => void prepare()}
              >
                {pending.current ? '核对准备结果' : o ? '准备新的完整来源' : '准备完整来源'}
              </Button>
            )}
            {o?.state === 'preparing' && (
              <Button disabled={busy} onClick={() => void control('cancel')}>
                取消准备
              </Button>
            )}
            {o && ['cancelled', 'failed'].includes(o.state) && (
              <Button type="primary" disabled={busy} onClick={() => void control('resume')}>
                继续准备原范围
              </Button>
            )}
            {o?.state === 'review' && (
              <Button
                type="primary"
                disabled={busy || !reviewed || !view?.current || hasInput}
                onClick={() => void confirm()}
              >
                确认完整访谈来源
              </Button>
            )}
            {page && (
              <Button disabled={busy || !page.next} onClick={() => void loadPage(true)}>
                下一页
              </Button>
            )}
            <Button disabled={busy} onClick={() => void read.current()}>
              重新读取
            </Button>
            <Button onClick={back}>返回继续聊天</Button>
          </div>
          <p className="conversation-finish-hint">
            这里只准备与固定本机来源；整理、编辑及最终保存Skill均另行进行。
          </p>
        </footer>
      </Card>
    </section>
  );
}
