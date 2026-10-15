import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Input, Tag } from 'antd';
import {
  assertConversation,
  conversationEvent,
  type ConversationEvent,
  type ConversationSnapshot,
} from '../shared/conversation';
import EditorLeaveDialog from './EditorLeaveDialog';
import './conversation.css';
export type ConversationLeave = (navigate: () => void, label: string) => void;
const labels = {
  draft: '尚未开始',
  generating: '正在生成',
  ready: '等待你补充',
  failed: '本轮未完成',
  cancelled: '本轮已取消',
  confirmed: '已确认',
};
export default function ConversationPanel({
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
  const [snapshot, setSnapshot] = useState<ConversationSnapshot>();
  const saved = useRef<ConversationSnapshot | undefined>(undefined);
  const [text, setText] = useState('');
  const inputText = useRef('');
  const [error, setError] = useState(''),
    [recovering, setRecovering] = useState(true),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [leave, setLeave] = useState<{ navigate: () => void; label: string }>();
  const locked = useRef(false),
    alive = useRef(true),
    textarea = useRef<any>(null);
  const pending = useRef<{ method: string; args: any } | undefined>(undefined);
  const [uncertain, setUncertain] = useState(false);
  const read = useRef<() => Promise<void>>(async () => {});
  const apply = useRef<(s: ConversationSnapshot) => void>(() => {});
  const updateText = (value: string) => {
    inputText.current = value;
    setText(value);
  };
  useEffect(() => {
    alive.current = true;
    let disposed = false,
      reading = false;
    let future: ConversationEvent | undefined;
    let queued: ConversationEvent | undefined,
      scheduled = false;
    const accept = (value: ConversationSnapshot) => {
      assertConversation(value);
      if (disposed || value.id !== id || value.sequence < (saved.current?.sequence ?? 0)) return;
      const before = saved.current;
      if (before?.status === 'confirmed' && value.status !== 'confirmed')
        throw new Error('已确认会话收到无效的旧请求状态');
      if (pending.current && value.attempts.some((a) => a.id === pending.current?.args.requestId)) {
        if (pending.current.method === 'conversation.send') updateText('');
        pending.current = undefined;
        setUncertain(false);
      } else if (!before || inputText.current === before.draft) updateText(value.draft);
      saved.current = value;
      setSnapshot(value);
    };
    apply.current = accept;
    const recover = async () => {
      if (reading || disposed) return;
      reading = true;
      setRecovering(true);
      try {
        const value = await window.flowark.request('conversation.detail', { id });
        if (disposed) return;
        assertConversation(value);
        let latest = value;
        if (future && future.sequence > value.sequence) latest = future.snapshot;
        future = undefined;
        if (
          pending.current &&
          !latest.attempts.some((a) => a.id === pending.current?.args.requestId)
        )
          pending.current.args.revision = latest.revision;
        accept(latest);
        setRecovering(false);
        setError('');
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : '消息核对未完成，输入保留');
      } finally {
        reading = false;
      }
    };
    read.current = recover;
    const consume = (raw: ConversationEvent) => {
      if (disposed || raw.sessionId !== id) return;
      try {
        const event = conversationEvent(raw),
          previous = saved.current?.sequence ?? 0;
        if (event.sequence <= previous) return;
        if (reading) {
          if (!future || event.sequence > future.sequence) future = event;
          return;
        }
        if (!previous || event.sequence !== previous + 1) {
          future = event;
          void recover();
          return;
        }
        accept(event.snapshot);
      } catch {
        void recover();
      }
    };
    const stop = window.flowark.onmessage((raw) => {
      if (raw?.sessionId !== id) return;
      if (!queued || raw.sequence > queued.sequence) queued = raw;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        const event = queued;
        queued = undefined;
        if (event) consume(event);
      });
    });
    void recover();
    return () => {
      disposed = true;
      alive.current = false;
      stop();
    };
  }, [id]);
  const act = async (method: string, args: any) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await window.flowark.request(method, args);
      if (!alive.current) return;
      apply.current(value);
      if (method === 'conversation.draft') updateText(value.draft);
      if (method === 'conversation.send' || method === 'conversation.retry') {
        pending.current = undefined;
        setUncertain(false);
      }
      try {
        await refresh();
      } catch {
        if (alive.current) setError('会话状态已保存，待办列表尚未刷新；可重新读取核对。');
      }
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : '操作未完成，输入保留');
      if (method === 'conversation.send' || method === 'conversation.retry') {
        setUncertain(true);
        void read.current();
      }
      throw e;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const save = async () => {
    const s = saved.current;
    if (!s) throw new Error('会话尚未读取');
    await act('conversation.draft', { id, revision: s.revision, text: inputText.current });
  };
  const navigate: ConversationLeave = (next, label) => {
    if (locked.current) return;
    const s = saved.current;
    if (s && inputText.current !== s.draft) {
      setLeave({ navigate: next, label });
      return;
    }
    next();
  };
  useLayoutEffect(() => {
    registerLeave(navigate);
    return () => registerLeave(undefined);
  });
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (saved.current && inputText.current !== saved.current.draft) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, []);
  const send = (retry = false) => {
    if (!snapshot || !reviewed) return;
    const method = retry ? 'conversation.retry' : 'conversation.send';
    const command = pending.current ?? {
      method,
      args: {
        id,
        revision: snapshot.revision,
        requestId: crypto.randomUUID(),
        reviewed: true,
        ...(!retry ? { text: inputText.current } : {}),
      },
    };
    pending.current = command;
    void act(command.method, command.args).catch(() => {});
  };
  const generating = snapshot?.status === 'generating',
    confirmed = snapshot?.status === 'confirmed';
  const draftChanged = !!snapshot && text !== snapshot.draft;
  const exhausted = !!snapshot && snapshot.attempts.length >= snapshot.maxRequests;
  return (
    <section className="page conversation-page" aria-label="引导会话">
      <header>
        <h1>引导会话 · {snapshot?.title ?? '正在读取'}</h1>
        <p>保存后可稍后继续。全部模型请求消耗你自己的 API Key 额度。</p>
        <Button onClick={() => navigate(back, '待办列表')}>返回待办</Button>
      </header>
      {recovering && (
        <Alert
          type="info"
          showIcon
          title="正在核对完整会话"
          description="保留当前输入，恢复展示不会重新调用模型。核对前不能发送或确认。"
        />
      )}
      {error && (
        <Alert
          role="alert"
          type="error"
          showIcon
          title={error}
          action={<Button onClick={() => void read.current()}>重新读取</Button>}
        />
      )}
      {snapshot && (
        <>
          <Tag>
            {labels[snapshot.status]} · {snapshot.attempts.length} / {snapshot.maxRequests}{' '}
            次模型请求
          </Tag>
          <div className="conversation-columns">
            <Card title="对话">
              <div
                className="conversation-messages"
                aria-live="polite"
                aria-relevant="additions text"
              >
                {!snapshot.messages.length && (
                  <p>先核对右侧上下文，再发送你的要求或补充。不会自动调用模型。</p>
                )}
                {snapshot.messages.map((message) => (
                  <article key={message.id} className={'conversation-message is-' + message.role}>
                    <strong>
                      {message.role === 'user' ? '你' : '助手'}
                      {message.state === 'partial' ? ' · 未完成' : ''}
                    </strong>
                    <p>{message.text || (generating ? '等待正文…' : '本轮没有完整正文')}</p>
                  </article>
                ))}
              </div>
              {snapshot.error && <Alert type="warning" showIcon title={snapshot.error} />}
            </Card>
            <Card title={confirmed ? '已确认的对话' : '本次输入'}>
              <Collapse
                items={[
                  {
                    key: 'context',
                    label: '核对指令、上下文与模型',
                    children: (
                      <>
                        <p>
                          {snapshot.provider} / {snapshot.model}
                        </p>
                        <h4>引导指令</h4>
                        <pre>{snapshot.instructions}</pre>
                        <h4>所选上下文</h4>
                        <pre>{JSON.stringify(snapshot.context, null, 2)}</pre>
                        <p>下一轮仅发送完整历史和所选上下文。Key不进入会话；未知用量不会填零。</p>
                      </>
                    ),
                  },
                ]}
              />
              {confirmed && draftChanged && (
                <Alert
                  type="warning"
                  title="会话已在其他位置确认，未提交输入仍保留"
                  description={
                    <Input.TextArea readOnly value={text} aria-label="保留的未提交输入" />
                  }
                />
              )}
              {!confirmed && (
                <>
                  <label htmlFor={'conversation-input-' + id}>你的补充</label>
                  <Input.TextArea
                    ref={textarea}
                    id={'conversation-input-' + id}
                    value={text}
                    maxLength={4000}
                    autoSize={{ minRows: 4, maxRows: 10 }}
                    disabled={busy || generating || uncertain}
                    onChange={(e) => updateText(e.target.value)}
                  />
                  <p>
                    {draftChanged ? '有未保存输入，请保存后退出。' : '输入已保存，可稍后继续。'}
                  </p>
                  <Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)}>
                    已核对指令、所选上下文、完整历史及自己的 Key 费用
                  </Checkbox>
                </>
              )}
              <div className="conversation-actions">
                {generating ? (
                  <Button
                    onClick={() =>
                      void act('conversation.cancel', {
                        id,
                        requestId: snapshot.attempts.at(-1)!.id,
                      }).catch(() => {})
                    }
                    disabled={busy}
                  >
                    取消生成
                  </Button>
                ) : (
                  !confirmed && (
                    <>
                      <Button
                        type="primary"
                        disabled={
                          busy ||
                          recovering ||
                          !reviewed ||
                          (!text.trim() && !uncertain) ||
                          exhausted
                        }
                        onClick={() => send()}
                      >
                        {uncertain ? '重试本次提交' : '发送'}
                      </Button>
                      <Button
                        disabled={busy || recovering || !draftChanged || uncertain}
                        onClick={() => void save().catch(() => {})}
                      >
                        保存输入
                      </Button>
                      {['failed', 'cancelled'].includes(snapshot.status) && (
                        <Button
                          disabled={busy || recovering || !reviewed || exhausted || uncertain}
                          onClick={() => send(true)}
                        >
                          手动重试本轮
                        </Button>
                      )}
                      <Button
                        disabled={
                          busy || recovering || snapshot.status !== 'ready' || !!text || uncertain
                        }
                        onClick={() =>
                          void act('conversation.confirm', {
                            id,
                            revision: snapshot.revision,
                          }).catch(() => {})
                        }
                      >
                        结束并确认
                      </Button>
                    </>
                  )
                )}
                <Button disabled={busy} onClick={() => void read.current()}>
                  重新读取
                </Button>
                {confirmed && openFlow && (
                  <Button
                    type="primary"
                    onClick={() => navigate(() => openFlow(snapshot.flowId), '来源流程')}
                  >
                    返回来源流程
                  </Button>
                )}
              </div>
              {confirmed ? (
                <Alert
                  type="success"
                  showIcon
                  title="完整对话已固定为只读内容"
                  description="回到来源流程核对后再显式运行；本次确认不生成Skill、不授予发送权限。"
                />
              ) : (
                <p>未完成助手消息不能供后续步骤采用。确认对话不替代事实、Skill确认或外发授权。</p>
              )}
              <Collapse
                items={[
                  {
                    key: 'receipts',
                    label: '查看请求用量',
                    children: snapshot.attempts.map((a) => (
                      <p key={a.id}>
                        {a.state} · {a.model} · {a.providerRequestId || '尚未取得请求ID'}
                        <br />
                        {a.usage === null ? '用量未知' : JSON.stringify(a.usage)}
                      </p>
                    )),
                  },
                ]}
              />
            </Card>
          </div>
        </>
      )}
      {leave && (
        <EditorLeaveDialog
          name={snapshot?.title ?? '引导会话'}
          destination={leave.label}
          draftLabel="会话输入"
          save={async () => {
            await save();
            const next = leave.navigate;
            setLeave(undefined);
            next();
          }}
          discard={() => {
            updateText(saved.current?.draft ?? '');
            const next = leave.navigate;
            setLeave(undefined);
            next();
          }}
          stay={() => {
            setLeave(undefined);
            requestAnimationFrame(() => textarea.current?.focus());
          }}
        />
      )}
    </section>
  );
}
