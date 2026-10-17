import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Input, Tag } from 'antd';
import {
  assertThread,
  assertThreadPage,
  assertThreadContext,
  assertThreadPrepared,
  assertThreadOutput,
  assertThreadCheckpoint,
  threadEvent,
  type ConversationThreadSnapshot as Head,
  type ConversationThreadEntry as Entry,
  type ConversationContext,
  type ConversationHistoryPage,
  type ConversationHistorySelection as Selection,
  type ThreadPreparedPreview,
  type ThreadCheckpointPreview,
  type ConversationContextProposal,
} from '../shared/conversation-thread';
import { assertConversation, type ConversationSnapshot } from '../shared/conversation';
import type { ConversationLeave } from './ConversationPanel';
import MarkdownBody from './MarkdownBody';
import ConversationResultView from './ConversationResultView';
import EditorLeaveDialog from './EditorLeaveDialog';
import './conversation.css';
const api = (method: string, args: unknown): Promise<any> =>
  window.flowark.request('conversation.thread.' + method, args);
const refKey = (r: Selection[number]) =>
  r.kind === 'origin' ? 'origin:' + r.requestId : 'history:' + r.ordinal;
const labels = {
  draft: '尚未开始',
  generating: '正在生成',
  ready: '等待你补充',
  failed: '本轮未完成',
  cancelled: '本轮已取消',
};
export default function ConversationThreadPanel({
  id,
  refresh,
  registerLeave,
  back,
  openFlow,
}: {
  id: string;
  refresh: () => Promise<void>;
  registerLeave: (fn: ConversationLeave | undefined) => void;
  back: () => void;
  openFlow?: (id: string) => void;
}) {
  const [head, setHead] = useState<Head>(),
    saved = useRef<Head | undefined>(undefined);
  const [context, setContext] = useState<ConversationContext>();
  const [origin, setOrigin] = useState<ConversationSnapshot | null>(null);
  const [history, setHistory] = useState<ConversationHistoryPage>();
  const [latestPage, setLatestPage] = useState(true),
    latestPageRef = useRef(true);
  const [selection, setSelection] = useState<Selection>([]);
  const [proposal, setProposal] = useState<ConversationContextProposal | null>(null);
  const [text, setText] = useState(''),
    input = useRef('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false),
    locked = useRef(false),
    alive = useRef(true);
  const [recovering, setRecovering] = useState(true);
  const [prepared, setPrepared] = useState<ThreadPreparedPreview>();
  const [checkpoint, setCheckpoint] = useState<ThreadCheckpointPreview>();
  const [confirmRequest, setConfirmRequest] = useState<string>();
  const [reviewed, setReviewed] = useState(false),
    [contextReviewed, setContextReviewed] = useState(false);
  const pending = useRef<
    { requestId: string; preparedId: string; sha256: string; text: string } | undefined
  >(undefined);
  const [uncertain, setUncertain] = useState(false);
  const [output, setOutput] = useState<any>();
  const [historicalCheckpoint, setHistoricalCheckpoint] = useState<unknown>();
  useEffect(() => setHistoricalCheckpoint(undefined), [id, head?.latestCheckpoint?.checkpointId]);
  const [leave, setLeave] = useState<{ navigate: () => void; label: string }>();
  const page = useRef<HTMLElement>(null),
    messages = useRef<HTMLDivElement>(null);
  const follow = useRef(true),
    [showLatest, setShowLatest] = useState(false);
  const updateText = (v: string) => {
    input.current = v;
    setText(v);
  };
  const resetReview = () => {
    setPrepared(undefined);
    setCheckpoint(undefined);
    setConfirmRequest(undefined);
    setReviewed(false);
    setOutput(undefined);
  };
  const accept = useRef<(s: Head) => void>(() => {});
  accept.current = (s) => {
    assertThread(s);
    if (!alive.current || s.id !== id || s.sequence < (saved.current?.sequence ?? 0)) return;
    const old = saved.current;
    if (old && old.revision !== s.revision) {
      setReviewed(false);
      setContextReviewed(false);
    }
    const p = pending.current;
    if (p && (s.active?.requestId === p.requestId || s.lastEntry?.requestId === p.requestId)) {
      if (input.current === p.text) updateText(s.draft);
      pending.current = undefined;
      setUncertain(false);
      setPrepared(undefined);
    } else if (!old || input.current === old.draft) updateText(s.draft);
    saved.current = s;
    setHead(s);
  };
  const recover = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    alive.current = true;
    saved.current = undefined;
    input.current = '';
    setText('');
    setHead(undefined);
    setHistory(undefined);
    setContext(undefined);
    setOrigin(null);
    setProposal(null);
    setSelection([]);
    resetReview();
    pending.current = undefined;
    setUncertain(false);
    latestPageRef.current = true;
    setLatestPage(true);
    follow.current = true;
    let disposed = false,
      reading = false,
      again = false;
    const read = async () => {
      if (disposed) return;
      if (reading) {
        again = true;
        return;
      }
      reading = true;
      setRecovering(true);
      try {
        const s = await api('detail', { id });
        assertThread(s);
        if (!disposed) {
          accept.current(s);
          setError('');
          setRecovering(false);
        }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : '会话读取失败，输入保留');
      } finally {
        reading = false;
        if (again && !disposed) {
          again = false;
          void read();
        }
      }
    };
    recover.current = read;
    let queued: unknown,
      scheduled = false;
    const stop = window.flowark.onmessage((raw) => {
      if (raw.kind !== 'conversation.thread.snapshot' || raw.sessionId !== id) return;
      if (!queued || raw.sequence > (queued as { sequence: number }).sequence) queued = raw;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        const value = queued;
        queued = undefined;
        if (disposed || !value) return;
        try {
          const event = threadEvent(value),
            before = saved.current?.sequence ?? 0;
          if (event.sequence <= before) return;
          if (reading || !before || event.sequence !== before + 1) {
            void read();
            return;
          }
          accept.current(event.snapshot);
        } catch {
          void read();
        }
      });
    });
    const focus = () => void read();
    window.addEventListener('focus', focus);
    void read();
    return () => {
      disposed = true;
      alive.current = false;
      stop();
      window.removeEventListener('focus', focus);
    };
  }, [id]);
  useEffect(() => {
    if (!head) return;
    let live = true;
    void Promise.all([api('context', { id }), api('origin', { id }), api('proposal', { id })])
      .then(([c, o, p]) => {
        assertThreadContext(c);
        if (o !== null) assertConversation(o);
        if (
          c.id !== head.context.id ||
          c.sha256 !== head.context.sha256 ||
          (p?.id ?? null) !== head.contextProposalId
        )
          throw Error('来源身份已变化，请重新读取');
        if (live) {
          setContext(c);
          setOrigin(o);
          setProposal(p);
        }
      })
      .catch((e) => {
        if (live) setError(e.message ?? '来源核对失败');
      });
    return () => {
      live = false;
    };
  }, [id, head?.context.id, head?.contextProposalId]);
  useEffect(() => {
    if (!head) return;
    let live = true;
    void api('selection', { id })
      .then((s) => {
        if (live) {
          setSelection(s);
          resetReview();
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, head?.historyCount, head?.historyWindow, head?.context.id]);
  useEffect(() => {
    if (!head || !latestPage) return;
    let live = true;
    void api('history', { id, cursor: null })
      .then((p) => {
        assertThreadPage(p);
        if (p.cursor.sessionId !== id) throw Error('历史不属于当前会话');
        if (live) setHistory(p);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, head?.historyCount, latestPage]);
  useLayoutEffect(() => {
    const element = page.current;
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
  useLayoutEffect(() => {
    const element = messages.current;
    if (!element) return;
    const resize = () => {
      if (follow.current) element.scrollTop = element.scrollHeight;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    if (!follow.current && latestPage) setShowLatest(true);
    return () => observer.disconnect();
  }, [history, head?.active?.answer, prepared, checkpoint, latestPage]);
  const act = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '操作未完成，输入保留');
      throw e;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const save = async () => {
    if (uncertain) throw Error('先核对原请求回执，输入保留');
    await act(async () => {
      const s = saved.current!;
      const v = await api('draft', { id, revision: s.revision, text: input.current });
      accept.current(v);
      resetReview();
    });
  };
  const navigate: ConversationLeave = (next, label) => {
    if (locked.current) return;
    if (pending.current || confirmRequest) {
      setError('请先核对原请求或确认操作，再离开；输入保留。');
      return;
    }
    if (saved.current && input.current !== saved.current.draft) setLeave({ navigate: next, label });
    else next();
  };
  useLayoutEffect(() => {
    registerLeave(navigate);
    return () => registerLeave(undefined);
  });
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (pending.current || (saved.current && input.current !== saved.current.draft)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, []);
  const pick = (r: Selection[number], checked: boolean) => {
    if (!head) return;
    resetReview();
    setSelection((old) => {
      const next = old.filter((i) => refKey(i) !== refKey(r));
      if (checked) {
        if (next.length >= head.historyWindow) {
          setError(`最多选择${head.historyWindow}轮完整问答，请先取消其他轮次。`);
          return old;
        }
        next.push(r);
      }
      return next.sort((a, b) =>
        a.kind === 'origin' && b.kind === 'origin'
          ? (origin?.attempts.findIndex((v) => v.id === a.requestId) ?? 0) -
            (origin?.attempts.findIndex((v) => v.id === b.requestId) ?? 0)
          : a.kind === 'origin'
            ? -1
            : b.kind === 'origin'
              ? 1
              : a.ordinal - b.ordinal,
      );
    });
  };
  const inspect = async (withdraw = false) => {
    const p = pending.current;
    if (!p) return;
    await act(async () => {
      const receipt = await api(withdraw ? 'withdraw' : 'receipt', {
        id,
        requestId: p.requestId,
        ...(withdraw ? { preparedId: p.preparedId, sha256: p.sha256, reviewed: true } : {}),
      });
      if (!receipt) {
        setNotice('尚无原请求准入回执。可撤销未开始请求；未另建请求或重试模型。');
        return;
      }
      if (receipt.preparedId !== p.preparedId || receipt.preparedHash !== p.sha256)
        throw Error('原请求身份不一致，停止发送');
      if (receipt.state === 'withdrawn') {
        pending.current = undefined;
        setUncertain(false);
        setPrepared(undefined);
        setReviewed(false);
        setNotice('原请求已撤销，当前输入保留。');
      } else {
        accept.current(await api('detail', { id }));
        pending.current = undefined;
        setUncertain(false);
        if (input.current === p.text) updateText(saved.current!.draft);
      }
    });
  };
  const previewSend = (retryOf: string | null = null) =>
    act(async () => {
      const s = saved.current!,
        body = retryOf ? s.lastEntry!.text : input.current;
      const value = (await api('preview', {
        id,
        revision: s.revision,
        text: body,
        selection,
        retryOf,
      })) as ThreadPreparedPreview;
      assertThreadPrepared(value.prepared);
      if (value.prepared.sessionId !== id || value.prepared.text !== body)
        throw Error('预览不属于本次输入');
      accept.current(await api('detail', { id }));
      if (
        value.prepared.revision !== saved.current?.revision ||
        value.prepared.text !== input.current
      )
        throw Error('预览期间内容已变化，请重新核对');
      setPrepared(value);
      setCheckpoint(undefined);
      setReviewed(false);
      follow.current = true;
    });
  const send = () =>
    act(async () => {
      const s = saved.current!,
        p = prepared!;
      if (!reviewed || p.prepared.revision !== s.revision || p.prepared.text !== input.current)
        throw Error('发送内容已变化，请重新核对');
      const requestId = crypto.randomUUID();
      pending.current = {
        requestId,
        preparedId: p.prepared.id,
        sha256: p.prepared.sha256,
        text: p.prepared.text,
      };
      try {
        accept.current(
          await api('send', {
            id,
            revision: s.revision,
            requestId,
            preparedId: p.prepared.id,
            sha256: p.prepared.sha256,
            token: p.token,
            reviewed: true,
          }),
        );
        await refresh();
      } catch (e) {
        if (pending.current) setUncertain(true);
        void recover.current();
        throw e;
      }
    });
  const previewCheckpoint = () =>
    act(async () => {
      const s = saved.current!;
      if (input.current) throw Error('先发送补充，或明确清空并保存输入，再固定本次来源');
      const c = (await api('checkpoint.preview', {
        id,
        revision: s.revision,
        selection,
      })) as ThreadCheckpointPreview;
      if (c.source.sessionId !== id || c.source.sourceRevision !== s.revision)
        throw Error('确认来源身份不一致');
      setCheckpoint(c);
      setPrepared(undefined);
      setReviewed(false);
      follow.current = true;
    });
  const confirm = () =>
    act(async () => {
      if (!checkpoint || (!reviewed && !confirmRequest)) return;
      const requestId = confirmRequest ?? crypto.randomUUID();
      setConfirmRequest(requestId);
      const value = await api('checkpoint.confirm', {
        id,
        revision: checkpoint.source.sourceRevision,
        requestId,
        token: checkpoint.token,
        sha256: checkpoint.sha256,
        reviewed: true,
      });
      accept.current(value.snapshot);
      setConfirmRequest(undefined);
      setCheckpoint(undefined);
      setReviewed(false);
      const v = await api('output', { id });
      assertThreadOutput(v);
      setOutput(v);
      setNotice('本次来源已确认，仍可继续补充。Skill 尚需整理、核对差异并另行确认保存。');
      await refresh();
    });
  const readPage = (older: boolean) =>
    act(async () => {
      const p = await api('history', { id, cursor: older ? history?.next : null });
      assertThreadPage(p);
      if (p.cursor.sessionId !== id) throw Error('历史游标不属于本会话');
      follow.current = !older;
      latestPageRef.current = !older;
      setLatestPage(!older);
      setHistory(p);
      setShowLatest(false);
    });
  const entryView = (e: Entry) => (
    <article key={e.requestId} className="conversation-thread-turn">
      <Checkbox
        disabled={busy || !!prepared || !!checkpoint || e.state !== 'complete'}
        checked={selection.some((r) => r.kind === 'history' && r.ordinal === e.ordinal)}
        onChange={(v) =>
          pick({ kind: 'history', ordinal: e.ordinal, sha256: e.sha256 }, v.target.checked)
        }
      >
        本次采用第 {e.ordinal} 次请求
      </Checkbox>
      <div className="conversation-message is-user">
        <strong>你</strong>
        <p>{e.text}</p>
      </div>
      <div className="conversation-message">
        <strong>助手 · {e.state}</strong>
        <MarkdownBody text={e.answer} />
        {e.error && <p>{e.error}</p>}
        <Collapse
          items={[
            {
              key: 'receipt',
              label: '本轮用量与来源',
              children: (
                <pre>
                  {JSON.stringify(
                    {
                      requestId: e.requestId,
                      model: e.model,
                      providerRequestId: e.providerRequestId,
                      usage: e.usage,
                      context: e.context,
                      retryOf: e.retryOf,
                    },
                    null,
                    2,
                  )}
                </pre>
              ),
            },
          ]}
        />
      </div>
    </article>
  );
  const disabled =
    busy ||
    recovering ||
    uncertain ||
    !!head?.active ||
    !!head?.contextProposalId ||
    !!confirmRequest;
  return (
    <section ref={page} className="page conversation-page" aria-label="持续会话">
      <header className="conversation-heading">
        <div>
          <h1>持续对话 · {head?.title ?? '正在读取'}</h1>
          <p>访谈与历史持续保存；确认来源后仍可继续补充，Skill 另行确认保存。</p>
        </div>
        <Button onClick={() => navigate(back, '待办')}>返回待办</Button>
      </header>
      {!head && (
        <Alert
          type={error ? 'error' : 'info'}
          title={error || '正在核对本机会话，恢复不会调用模型'}
          action={<Button onClick={() => void recover.current()}>重新读取</Button>}
        />
      )}
      {head && (
        <Card className="conversation-card">
          <div className="conversation-status">
            <Tag>
              {head.contextProposalId ? '新资料待核对' : labels[head.status]} · 累计{' '}
              {head.requestCount + (origin?.attempts.length ?? 0)} 次请求 · 无总轮数限制
            </Tag>
            {head.latestCheckpoint && (
              <Tag>{head.checkpointCurrent ? '当前来源已确认' : '旧确认保留 · 新补充待确认'}</Tag>
            )}
          </div>
          <Collapse
            className="conversation-review"
            items={[
              {
                key: 'context',
                label: `核对发送范围 · 已选 ${selection.length}/${head.historyWindow} 轮完整问答`,
                children: (
                  <>
                    <p>
                      {context?.provider} / {context?.model} · 每轮最长120秒 · 使用你自己的 API
                      Key，重试也可能计费。
                    </p>
                    <p>
                      旧历史保存在本机。仅发送已选轮次、当前指令、上下文和本次输入；未选内容不会自动总结或删除。必要规则不在本次范围时，请先调整资料或选择。
                    </p>
                    <pre>{JSON.stringify(context, null, 2)}</pre>
                    <pre>{JSON.stringify(selection, null, 2)}</pre>
                  </>
                ),
              },
            ]}
          />
          <div
            ref={messages}
            className="conversation-messages"
            role="log"
            aria-label="持续会话消息"
            aria-live="off"
            onScroll={() => {
              const e = messages.current!;
              follow.current =
                latestPageRef.current && e.scrollHeight - e.scrollTop - e.clientHeight < 60;
              if (follow.current) setShowLatest(false);
            }}
          >
            <div className="conversation-message-list">
              {proposal && (
                <Card title="核对新资料与设置">
                  <p>
                    旧历史和确认快照保留。采用更新不会自动合并事实冲突；请在后续补充中明确更正与撤回。
                  </p>
                  <div className="skill-grid">
                    <div>
                      <h4>原设置</h4>
                      <pre>
                        {JSON.stringify({ context, historyWindow: head.historyWindow }, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <h4>提议设置</h4>
                      <pre>{JSON.stringify(proposal, null, 2)}</pre>
                    </div>
                  </div>
                  <Checkbox
                    checked={contextReviewed}
                    onChange={(v) => setContextReviewed(v.target.checked)}
                  >
                    已核对资料、指令、模型和历史窗口差异
                  </Checkbox>
                  <div className="conversation-actions">
                    {[true, false].map((v) => (
                      <Button
                        key={String(v)}
                        disabled={busy || !contextReviewed}
                        onClick={() =>
                          void act(async () => {
                            accept.current(
                              await api('context.adopt', {
                                id,
                                revision: head.revision,
                                proposalId: proposal.id,
                                accept: v,
                                reviewed: true,
                              }),
                            );
                            resetReview();
                          }).catch(() => {})
                        }
                      >
                        {v ? '采用新设置' : '保留原设置'}
                      </Button>
                    ))}
                  </div>
                </Card>
              )}
              {head.latestCheckpoint && (
                <Collapse
                  items={[
                    {
                      key: 'fixed-source',
                      label: head.checkpointCurrent
                        ? '查看当前确认来源'
                        : '查看上次确认来源（只读保留）',
                      children: (
                        <>
                          <p>
                            确认快照保持原内容；继续补充后，旧快照不能作为新 Skill 发布的当前来源。
                          </p>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                const value = await api('checkpoint.detail', {
                                  id,
                                  checkpointId: head.latestCheckpoint!.checkpointId,
                                });
                                assertThreadCheckpoint(value);
                                if (
                                  value.sessionId !== id ||
                                  value.id !== head.latestCheckpoint!.checkpointId ||
                                  value.sha256 !== head.latestCheckpoint!.sha256
                                )
                                  throw Error('历史确认身份不一致');
                                setHistoricalCheckpoint(value);
                              }).catch(() => {})
                            }
                          >
                            读取固定内容
                          </Button>
                          {historicalCheckpoint !== undefined && (
                            <pre tabIndex={0}>{JSON.stringify(historicalCheckpoint, null, 2)}</pre>
                          )}
                        </>
                      ),
                    },
                  ]}
                />
              )}
              {origin && (
                <Collapse
                  items={[
                    {
                      key: 'origin',
                      label: `原访谈 · ${origin.attempts.length} 次请求（只读保留）`,
                      children: origin.attempts.map((a) => {
                        const user = origin.messages.find(
                            (m) => m.role === 'user' && m.requestId === a.id,
                          ),
                          assistant = origin.messages.find(
                            (m) => m.role === 'assistant' && m.requestId === a.id,
                          );
                        return (
                          <article key={a.id} className="conversation-thread-turn">
                            <Checkbox
                              disabled={
                                busy || !!prepared || !!checkpoint || a.state !== 'complete'
                              }
                              checked={selection.some(
                                (r) => r.kind === 'origin' && r.requestId === a.id,
                              )}
                              onChange={(e) =>
                                pick({ kind: 'origin', requestId: a.id }, e.target.checked)
                              }
                            >
                              采用原访谈本轮
                            </Checkbox>
                            <div className="conversation-message is-user">
                              <strong>你</strong>
                              <p>{user?.text}</p>
                            </div>
                            <div className="conversation-message">
                              <strong>助手 · {a.state}</strong>
                              <MarkdownBody text={assistant?.text ?? ''} />
                              <p>{a.usage === null ? '用量未知' : JSON.stringify(a.usage)}</p>
                            </div>
                          </article>
                        );
                      }),
                    },
                  ]}
                />
              )}
              <div className="conversation-actions">
                <Button
                  disabled={busy || !history?.next}
                  onClick={() => void readPage(true).catch(() => {})}
                >
                  加载更早历史
                </Button>
                {!latestPage && (
                  <Button disabled={busy} onClick={() => void readPage(false).catch(() => {})}>
                    回到最新记录
                  </Button>
                )}
                <span>每页最多20次请求；更早记录保留。可跨页选择完整轮次。</span>
              </div>
              {history?.entries.map(entryView)}
              {latestPage && head.active && (
                <article className="conversation-thread-turn">
                  <div className="conversation-message is-user">
                    <strong>你</strong>
                    <p>{head.active.text}</p>
                  </div>
                  <div className="conversation-message">
                    <strong>助手 · 正在生成</strong>
                    <MarkdownBody text={head.active.answer} partial />
                  </div>
                </article>
              )}
              {!head.historyCount && !origin && (
                <div className="conversation-message">
                  <strong>随时补充或更正</strong>
                  <p>
                    可以提问、补充事实或表达样本，不必答完固定题单。发送前核对当前指令、资料和所选对话。
                  </p>
                </div>
              )}
              {prepared && (
                <Card title="本次模型实际接收的内容">
                  <p>
                    仅下列固定内容会发送。预览5分钟有效；你自己的 Key 费用按服务商实际用量结算。
                  </p>
                  <pre tabIndex={0}>{JSON.stringify(prepared.prepared.input, null, 2)}</pre>
                  <p>历史范围：</p>
                  <pre>{JSON.stringify(prepared.prepared.selection, null, 2)}</pre>
                  <p>有效至：{new Date(prepared.expiresAt).toLocaleTimeString()}</p>
                </Card>
              )}
              {checkpoint && (
                <Card title="固定本次确认来源">
                  <p>只固定下面选择的完整来源，仍可继续聊天。此操作不生成或发布 Skill。</p>
                  <pre tabIndex={0}>{JSON.stringify(checkpoint.source, null, 2)}</pre>
                </Card>
              )}
              {output && <ConversationResultView value={output} />}
            </div>
          </div>
          {showLatest && (
            <Button
              className="conversation-latest"
              onClick={() => {
                follow.current = true;
                setShowLatest(false);
                messages.current?.scrollTo({ top: messages.current.scrollHeight });
              }}
            >
              查看最新回复
            </Button>
          )}
          <div className="conversation-composer">
            {error && <Alert role="alert" type="error" title={error} />}
            {notice && <Alert type="info" title={notice} />}
            {head.error && !error && <p>{head.error}</p>}
            <label htmlFor={'thread-reply-' + id}>回复或补充</label>
            <Input.TextArea
              id={'thread-reply-' + id}
              value={text}
              maxLength={4000}
              disabled={busy || !!head.active || uncertain || !!confirmRequest}
              autoSize={{ minRows: window.innerHeight <= 800 ? 2 : 3, maxRows: 4 }}
              placeholder="补充新情况、表达样本，或直接提出问题…"
              onChange={(e) => {
                updateText(e.target.value);
                resetReview();
              }}
            />
            {(prepared || checkpoint) && (
              <Checkbox
                checked={reviewed}
                disabled={busy || !!confirmRequest}
                onChange={(e) => setReviewed(e.target.checked)}
              >
                {prepared
                  ? '已核对本次完整发送内容、历史范围和自己的 Key 费用'
                  : '已核对本次完整确认来源；Skill 仍需另行确认保存'}
              </Checkbox>
            )}
            <div className="conversation-actions">
              {uncertain ? (
                <>
                  <Button disabled={busy} onClick={() => void inspect().catch(() => {})}>
                    核对原请求
                  </Button>
                  <Button disabled={busy} onClick={() => void inspect(true).catch(() => {})}>
                    撤销未开始请求
                  </Button>
                </>
              ) : head.active ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(async () =>
                      accept.current(
                        await api('cancel', { id, requestId: head.active!.requestId }),
                      ),
                    ).catch(() => {})
                  }
                >
                  取消生成
                </Button>
              ) : (
                <>
                  {checkpoint ? (
                    <Button
                      type="primary"
                      disabled={busy || (!reviewed && !confirmRequest)}
                      onClick={() => void confirm().catch(() => {})}
                    >
                      {confirmRequest ? '核对原确认' : '确认本次来源'}
                    </Button>
                  ) : prepared ? (
                    <Button
                      type="primary"
                      disabled={
                        disabled ||
                        !reviewed ||
                        prepared.prepared.revision !== head.revision ||
                        prepared.prepared.text !== text
                      }
                      onClick={() => void send().catch(() => {})}
                    >
                      发送
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      disabled={disabled || !text.trim()}
                      onClick={() => void previewSend().catch(() => {})}
                    >
                      核对本次发送
                    </Button>
                  )}
                  <Button
                    disabled={disabled || text === head.draft}
                    onClick={() => void save().catch(() => {})}
                  >
                    保存输入
                  </Button>
                  {(prepared || checkpoint) && (
                    <Button disabled={busy || !!confirmRequest} onClick={resetReview}>
                      返回继续核对
                    </Button>
                  )}
                  {!prepared && !checkpoint && ['failed', 'cancelled'].includes(head.status) && (
                    <Button
                      disabled={disabled || (!!text && text !== head.lastEntry?.text)}
                      onClick={() => void previewSend(head.lastEntry!.requestId).catch(() => {})}
                    >
                      核对后重试本轮
                    </Button>
                  )}
                  {!checkpoint && (
                    <Button
                      disabled={disabled || !!text || !selection.length}
                      onClick={() => void previewCheckpoint().catch(() => {})}
                    >
                      固定本次来源
                    </Button>
                  )}
                </>
              )}
              <Button disabled={busy} onClick={() => void recover.current()}>
                重新读取
              </Button>
              {openFlow && (
                <Button
                  disabled={busy}
                  onClick={() => navigate(() => openFlow(head.flowId), '来源流程')}
                >
                  返回来源流程
                </Button>
              )}
            </div>
            <p className="conversation-finish-hint">
              聊天先保留，整理与发布分别由你决定；继续聊天不会自动覆盖已发布 Skill 或流程绑定。
            </p>
          </div>
        </Card>
      )}
      {leave && (
        <EditorLeaveDialog
          name={head?.title ?? '持续会话'}
          destination={leave.label}
          draftLabel="输入"
          stay={() => setLeave(undefined)}
          discard={() => {
            const next = leave.navigate;
            setLeave(undefined);
            next();
          }}
          save={async () => {
            await save();
            const next = leave.navigate;
            setLeave(undefined);
            next();
          }}
        />
      )}
    </section>
  );
}
