import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Collapse, Input, Select } from 'antd';
import {
  assertTrialResult,
  type SkillTrialPreview,
  type SkillTrialRequest,
} from '../shared/skill-trial';
import type { AIConfiguration, AIProviderId } from '../shared/ai-settings';
import type { ConversationLeave } from './ConversationPanel';
import EditorLeaveDialog from './EditorLeaveDialog';
const api = (method: string, args: unknown) => window.flowark.request(method, args);
export default function SkillTrialSetup({
  preview,
  open,
  back,
  refresh,
  registerLeave,
}: {
  preview: SkillTrialPreview;
  open: (id: string) => void;
  back: () => void;
  refresh: () => Promise<void>;
  registerLeave: (fn: ConversationLeave | undefined) => void;
}) {
  const [provider, setProvider] = useState<AIProviderId>(),
    [configuration, setConfiguration] = useState<AIConfiguration>();
  const [instructions, setInstructions] = useState(''),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [leave, setLeave] = useState<{ next: () => void; label: string }>();
  const alive = useRef(true),
    locked = useRef(false),
    pending = useRef<SkillTrialRequest | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    heading.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setConfiguration(undefined);
    setError('');
    if (provider)
      void api('ai.configuration.get', { provider })
        .then((v) => {
          if (live && v?.provider === provider) setConfiguration(v);
        })
        .catch((e) => {
          if (live) setError(e.message ?? '无法读取模型配置，当前设置保留');
        });
    return () => {
      live = false;
    };
  }, [provider]);
  const dirty = !!provider || !!instructions || uncertain;
  const navigate: ConversationLeave = (next, label) => {
    if (locked.current) return;
    if (dirty) setLeave({ next, label });
    else next();
  };
  useLayoutEffect(() => {
    registerLeave(navigate);
    return () => registerLeave(undefined);
  });
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  const start = async (show = true) => {
    if (locked.current) throw Error('试聊设置正在保存');
    if (!pending.current) {
      if (!provider || !configuration?.model) throw Error('先明确选择本机服务和当前模型');
      pending.current = {
        version: 1,
        requestId: crypto.randomUUID(),
        source: preview.source,
        provider,
        model: configuration.model,
        instructions,
      };
    }
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api('skill.trial.start', pending.current);
      assertTrialResult(result);
      if (
        result.requestId !== pending.current.requestId ||
        result.source.proposalId !== preview.source.proposalId ||
        result.source.revision !== preview.source.revision ||
        result.source.sha256 !== preview.source.sha256
      )
        throw Error('试聊回执不是本次固定草稿，请核对原请求');
      if (!alive.current) return;
      setUncertain(false);
      try {
        await refresh();
      } catch {
        /* The created conversation and receipt remain authoritative. */
      }
      if (alive.current && show) open(result.sessionId);
    } catch (e) {
      if (alive.current) {
        setUncertain(true);
        setError(e instanceof Error ? e.message : '尚未取得建立会话的回执，输入保留');
      }
      throw e;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="page skill-panel skill-trial-setup" aria-label="准备草稿试聊">
      <header>
        <h1 tabIndex={-1} ref={heading}>
          准备草稿试聊
        </h1>
        <p>先核对固定草稿与自己的模型服务。建立会话不调用模型，每轮发送前另行核对费用。</p>
      </header>
      {error && <Alert type="error" showIcon title={error} />}
      {uncertain && (
        <Alert
          type="warning"
          title="当前设置已固定，请核对同一建立请求"
          description="再次核对只取得原回执或完成原建立请求，不调用模型；已建立会话也会保留在待办中。"
        />
      )}
      <div className="skill-grid">
        <Card title="固定草稿">
          <div className="skill-field">
            <label htmlFor="trial-revision">草稿修订</label>
            <Input
              id="trial-revision"
              readOnly
              value={`修订 ${preview.source.revision} · 仅供内部试聊`}
            />
          </div>
          <div className="skill-field">
            <label htmlFor="trial-digest">内容摘要</label>
            <Input
              id="trial-digest"
              readOnly
              value={preview.source.sha256}
              title={preview.source.sha256}
            />
          </div>
          <div className="skill-field">
            <label htmlFor="trial-parent">父版本</label>
            <Input id="trial-parent" readOnly value={preview.base?.versionId ?? '尚无确认版本'} />
          </div>
          <p>草稿键：{preview.key}</p>
          <p>包括正文、结构化数据及来源；修改后须重新建立。回复不会自动写回草稿或生成确认版本。</p>
          <Collapse
            items={[
              {
                key: 'fixed',
                label: '查看完整固定内容',
                children: (
                  <>
                    <pre tabIndex={0}>{preview.draft.markdown}</pre>
                    <pre tabIndex={0}>
                      {JSON.stringify(
                        {
                          data: preview.draft.data,
                          evidence: preview.draft.evidence,
                          base: preview.base,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </>
                ),
              },
            ]}
          />
          <div className="skill-actions">
            <Button disabled={busy} onClick={() => navigate(back, '当前草稿')}>
              回到草稿核对
            </Button>
          </div>
        </Card>
        <Card title="模型与补充要求">
          <div className="skill-field">
            <label htmlFor="trial-provider">模型服务</label>
            <Select
              id="trial-provider"
              value={provider}
              placeholder="选择自己的本机服务"
              disabled={busy || uncertain}
              onChange={setProvider}
              options={[
                { value: 'deepseek', label: 'DeepSeek · 自有 Key' },
                { value: 'openai-codex', label: 'OpenAI · 自有 Key' },
              ]}
            />
          </div>
          <div className="skill-field">
            <label htmlFor="trial-model">当前模型</label>
            <Input
              id="trial-model"
              readOnly
              value={configuration?.model ?? ''}
              placeholder="选择服务后核对其当前模型"
            />
          </div>
          <div className="skill-field">
            <label htmlFor="trial-instructions">补充要求</label>
            <Input.TextArea
              id="trial-instructions"
              maxLength={16000}
              value={instructions}
              disabled={busy || uncertain}
              onChange={(e) => setInstructions(e.target.value)}
              autoSize={{ minRows: 4, maxRows: 10 }}
            />
          </div>
          {configuration && !configuration.configured && (
            <Alert
              type="warning"
              title="此服务尚未配置自己的 Key"
              description="可先建立内部会话保留设置；发送前须到本地设置完成 Key 配置。不会使用其他服务或共享额度。"
            />
          )}
          <p>下一步可核对完整指令、所选上下文和历史。仅使用本机所选服务，不继承模板作者的 Key。</p>
          <div className="skill-actions">
            <Button
              type="primary"
              loading={busy}
              disabled={busy || (!uncertain && (!provider || !configuration))}
              onClick={() => void start().catch((e) => setError(e.message))}
            >
              {uncertain ? '核对原建立请求' : '建立试聊会话'}
            </Button>
          </div>
        </Card>
      </div>
      {leave && (
        <EditorLeaveDialog
          name="草稿试聊设置"
          destination={leave.label}
          draftLabel="试聊设置（保存将建立不调用模型的内部会话）"
          stay={() => setLeave(undefined)}
          discard={() => {
            const next = leave.next;
            setLeave(undefined);
            next();
          }}
          save={async () => {
            await start(false);
            const next = leave.next;
            setLeave(undefined);
            next();
          }}
        />
      )}
    </section>
  );
}
