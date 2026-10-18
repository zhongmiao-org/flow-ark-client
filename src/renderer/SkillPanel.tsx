import SkillUpdateReviewPanel from './SkillUpdateReviewPanel';
import type { SkillUpdateApplication, SkillUpdateDetail } from '../shared/contracts.generated';
import { skill_update_detail_v1 } from '../shared/node-schema.generated';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Input, Tag } from 'antd';
import {
  assertSkillDraft,
  assertSkillProposal,
  type SkillProposalSnapshot,
  type SkillDraft,
  type SkillVersion,
} from '../shared/skill';
import type { SkillChoice } from './SkillPicker';
import type { ConversationLeave } from './ConversationPanel';
import EditorLeaveDialog from './EditorLeaveDialog';
import './skill.css';
import SkillTrialSetup from './SkillTrialSetup';
import ConversationPanel from './ConversationPanel';
import { assertTrialPreview, type SkillTrialPreview } from '../shared/skill-trial';
import SkillDataEditor from './SkillDataEditor';
const api = (method: string, args: unknown = {}) => window.flowark.request(method, args);
const isDetail = (v: unknown): v is SkillUpdateDetail => !!skill_update_detail_v1(v);
const labels: Record<SkillProposalSnapshot['status'], string> = {
  draft: '待核对草稿',
  publishing: '正在保存',
  confirmed: '已确认',
  conflict: '需要核对基线',
  failed: '尚未确认',
  unknown: '保存结果待核对',
  discarded: '已放弃草稿',
};
const bundle = (v: SkillDraft | SkillVersion) =>
  JSON.stringify({ data: v.data, evidence: v.evidence }, null, 2);
export function SkillVersionView({ value }: { value: SkillVersion }) {
  return (
    <section className="skill-version" aria-label="固定Skill版本">
      <Alert
        type="info"
        showIcon
        title="本次读取的固定确认版本"
        description="内容不自动发送给模型；原文件后来变化不会改写本次历史。"
      />
      <div className="skill-grid">
        <Card title="来源与确认版本">
          <p>{value.title}</p>
          <p>
            {value.ref.key} / {value.ref.versionId}
          </p>
          <p className="path-text">摘要：{value.ref.sha256}</p>
          <p>
            确认于 {value.confirmedAt} · 父版本 {value.parent?.versionId ?? '无'}
          </p>
          <p>本次运行的内容与来源保存在本机加密记录中。</p>
        </Card>
        <Card title="查看完整内容">
          <Collapse
            items={[
              {
                key: 'markdown',
                label: '查看完整SKILL.md',
                children: <pre tabIndex={0}>{value.markdown}</pre>,
              },
              {
                key: 'data',
                label: '查看完整data.json与来源',
                children: <pre tabIndex={0}>{bundle(value)}</pre>,
              },
            ]}
          />
        </Card>
      </div>
    </section>
  );
}
export default function SkillPanel({
  id: initialId,
  refresh,
  registerLeave,
  back,
  openFlow,
}: {
  id: string;
  refresh: () => Promise<void>;
  registerLeave: (f: ConversationLeave | undefined) => void;
  back: () => void;
  openFlow?: (id: string) => void;
}) {
  const [id, setId] = useState(initialId),
    [snapshot, setSnapshot] = useState<SkillProposalSnapshot>(),
    [workspace, setWorkspace] = useState(''),
    [title, setTitle] = useState(''),
    [markdown, setMarkdown] = useState(''),
    [json, setJson] = useState('');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [publicationReviewed, setPublicationReviewed] = useState(false),
    [concurrent, setConcurrent] = useState(false),
    [comparison, setComparison] = useState<any>(),
    [preview, setPreview] = useState<any>(),
    [versions, setVersions] = useState<SkillChoice[]>([]),
    [relocation, setRelocation] = useState('');
  const [application, setApplication] = useState<SkillUpdateApplication | null>(null),
    [updatePending, setUpdatePending] = useState(false);
  const detailSequence = useRef(0);
  useEffect(() => setPublicationReviewed(false), [preview]);
  const [leave, setLeave] = useState<{ next: () => void; label: string }>();
  const [structuredPending, setStructuredPending] = useState(false);
  const [trial, setTrial] = useState<SkillTrialPreview>(),
    [trialId, setTrialId] = useState<string>();
  const alive = useRef(true),
    locked = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    textarea = useRef<any>(null),
    pending = useRef<any>(undefined);
  const activeId = useRef(id);
  activeId.current = id;
  const saved = useRef<SkillProposalSnapshot | undefined>(undefined);
  const dirty =
    !!snapshot &&
    (title !== snapshot.draft.title ||
      markdown !== snapshot.draft.markdown ||
      json !== bundle(snapshot.draft) ||
      structuredPending);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const accept = (s: SkillProposalSnapshot, replace = false) => {
    assertSkillProposal(s);
    if (
      s.id !== activeId.current ||
      (saved.current?.id === s.id && s.revision < saved.current.revision)
    )
      return;
    if (
      saved.current?.id === s.id &&
      saved.current.status === 'confirmed' &&
      s.status !== 'confirmed'
    )
      return;
    if (replace || !saved.current) {
      setTitle(s.draft.title);
      setMarkdown(s.draft.markdown);
      setJson(bundle(s.draft));
      setConcurrent(false);
    } else if (saved.current.revision !== s.revision && dirtyRef.current) setConcurrent(true);
    else if (!dirtyRef.current) {
      setTitle(s.draft.title);
      setMarkdown(s.draft.markdown);
      setJson(bundle(s.draft));
    }
    saved.current = s;
    setSnapshot(s);
    setPreview(undefined);
    setReviewed(false);
    if (pending.current && s.publication?.requestId === pending.current.requestId)
      pending.current = undefined;
  };
  const read = async () => {
    const visit = id,
      seq = ++detailSequence.current;
    const v = await api('skill.detail', { id });
    if (!alive.current || activeId.current !== visit || detailSequence.current !== seq) return;
    if (!isDetail(v) || v.proposal.id !== visit) throw Error('草稿详情身份无效');
    if (saved.current?.id === visit && v.proposal.revision < saved.current.revision) return;
    setWorkspace(v.workspace);
    setApplication(v.application);
    accept(v.proposal);
  };
  useEffect(() => {
    let live = true;
    alive.current = true;
    saved.current = undefined;
    setSnapshot(undefined);
    setApplication(null);
    setUpdatePending(false);
    const seq = ++detailSequence.current;
    setComparison(undefined);
    setError('');
    setPreview(undefined);
    setRelocation('');
    setStructuredPending(false);
    void api('skill.detail', { id })
      .then((v) => {
        if (live && activeId.current === id && detailSequence.current === seq) {
          if (!isDetail(v) || v.proposal.id !== id) throw Error('草稿详情身份无效');
          if (saved.current?.id === id && v.proposal.revision < saved.current.revision) return;
          setApplication(v.application);
          setWorkspace(v.workspace);
          assertSkillProposal(v.proposal);
          saved.current = v.proposal;
          setSnapshot(v.proposal);
          setTitle(v.proposal.draft.title);
          setMarkdown(v.proposal.draft.markdown);
          setJson(bundle(v.proposal.draft));
          setConcurrent(false);
          heading.current?.focus();
        }
      })
      .catch((e) => {
        if (live && detailSequence.current === seq) setError(String(e.message ?? e));
      });
    return () => {
      live = false;
      alive.current = false;
    };
  }, [id]);
  useEffect(() => {
    let live = true;
    void api('skill.list')
      .then((v) => {
        if (live) setVersions(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, snapshot?.status]);
  const act = async (method: string, args: unknown, apply?: (v: any) => void) => {
    if (locked.current) throw Error('操作正在处理');
    const visit = id;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const v = await api(method, args);
      if (!alive.current || activeId.current !== visit) return v;
      if (apply) apply(v);
      else accept(v, true);
      try {
        await refresh();
      } catch {
        if (alive.current) setNotice('操作回执已取得，但待办列表暂未刷新。');
      }
      return v;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '操作未完成，当前输入保留');
      throw e;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const draft = (): SkillDraft => {
    if (structuredPending) throw Error('请先应用当前字段，或放弃当前编辑，再保存整个草稿。');
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw Error('data.json尚不是有效JSON，当前输入保留');
    }
    if (!parsed || Object.keys(parsed).sort().join(',') !== 'data,evidence')
      throw Error('data.json须包含data对象和evidence数组');
    const d = { title, markdown, data: parsed.data, evidence: parsed.evidence };
    assertSkillDraft(d);
    return d;
  };
  const save = async () => {
    if (!snapshot) throw Error('草稿尚未读取');
    if (concurrent) throw Error('请先对照服务端内容并明确保留当前合并编辑');
    try {
      return await act('skill.save', { id, revision: snapshot.revision, draft: draft() });
    } catch (e) {
      setError(e instanceof Error ? e.message : '草稿未保存，输入保留');
      throw e;
    }
  };
  useLayoutEffect(() => {
    if (trial || trialId) return;
    registerLeave((next, label) => {
      if (locked.current) return;
      if (dirtyRef.current) {
        setLeave({ next, label });
        return;
      }
      next();
    });
    return () => registerLeave(undefined);
  });
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, []);
  useEffect(() => {
    if (snapshot?.status !== 'publishing') return;
    let stopped = false,
      reading = false;
    const timer = setInterval(() => {
      if (stopped || reading) return;
      reading = true;
      void read()
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id, snapshot?.status]);
  const compare = () =>
    void act('skill.base', { id }, (v) => {
      setComparison(v);
      setReviewed(false);
    }).catch(() => {});
  const blocked =
    !snapshot ||
    busy ||
    updatePending ||
    ['publishing', 'unknown', 'confirmed', 'discarded'].includes(snapshot.status);
  const confirmed = snapshot?.status === 'confirmed';
  const version = versions.find(
    (v) => v.workspace === workspace && v.ref.sha256 === snapshot?.confirmed?.sha256,
  );
  const returnToDraft = () => {
    setTrialId(undefined);
    setTrial(undefined);
    void read().catch((e) => setError(e.message));
  };
  if (trialId)
    return (
      <ConversationPanel
        id={trialId}
        refresh={refresh}
        registerLeave={registerLeave}
        back={returnToDraft}
        backLabel="当前草稿"
        openFlow={openFlow}
        openSkill={returnToDraft}
      />
    );
  if (trial)
    return (
      <SkillTrialSetup
        preview={trial}
        open={setTrialId}
        back={returnToDraft}
        refresh={refresh}
        registerLeave={registerLeave}
      />
    );
  return (
    <section className="page skill-panel" aria-label="个人Skill工作区">
      <header>
        <h1 ref={heading} tabIndex={-1}>
          {confirmed ? '个人Skill · 已确认版本' : '核对你的Skill草稿'}
        </h1>
        <p>确认后保存在所选工作区，固定版本供后续流程选择；编辑与保存不调用模型。</p>
      </header>
      {error && <Alert type="error" showIcon title={error} />}{' '}
      {notice && <Alert type="info" title={notice} />}{' '}
      {!snapshot ? (
        <Button onClick={() => void read().catch((e) => setError(e.message))}>重新读取草稿</Button>
      ) : (
        <>
          <Tag>
            {labels[snapshot.status]} · 修订 {snapshot.revision}
          </Tag>
          {snapshot.error && <Alert type="warning" title={snapshot.error} />}
          <SkillUpdateReviewPanel
            key={id}
            snapshot={snapshot}
            application={application}
            dirty={dirty}
            disabled={
              busy || ['publishing', 'unknown', 'confirmed', 'discarded'].includes(snapshot.status)
            }
            refresh={read}
            pendingChange={setUpdatePending}
          />
          <div className="skill-grid">
            <Card title="正文与结构化内容" styles={{ body: { padding: 24 } }}>
              <div className="skill-field">
                <label htmlFor={'skill-title-' + id}>版本标题</label>
                <Input
                  id={'skill-title-' + id}
                  disabled={busy}
                  readOnly={blocked}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setPreview(undefined);
                    setReviewed(false);
                  }}
                />
              </div>
              <div className="skill-field">
                <label htmlFor={'skill-markdown-' + id}>SKILL.md</label>
                <Input.TextArea
                  ref={textarea}
                  id={'skill-markdown-' + id}
                  disabled={busy}
                  readOnly={blocked}
                  value={markdown}
                  autoSize={{ minRows: 7, maxRows: 20 }}
                  onChange={(e) => {
                    setMarkdown(e.target.value);
                    setPreview(undefined);
                    setReviewed(false);
                  }}
                />
              </div>
              <p>
                {dirty ? '有未保存编辑，失败或冲突时输入保留。' : '当前草稿已保存，可稍后继续。'}{' '}
                不执行Markdown中的代码。
              </p>
            </Card>
            <Card title="来源与草稿状态" styles={{ body: { padding: 24 } }}>
              <p>Skill键：{snapshot.key}</p>
              <p className="path-text">工作区：{workspace}</p>
              <p>父版本：{snapshot.base?.versionId ?? '首次确认'}</p>
              <p>
                保存普通可读的SKILL.md、data.json和清单；新版本不会覆盖现有文件或自动更换流程绑定。
              </p>
              <Collapse
                items={[
                  {
                    key: 'evidence',
                    label: '查看完整来源记录',
                    children: (
                      <pre tabIndex={0}>{JSON.stringify(snapshot.draft.evidence, null, 2)}</pre>
                    ),
                  },
                ]}
              />
              <div className="skill-actions">
                <Button
                  disabled={blocked || !dirty || concurrent}
                  onClick={() => void save().catch(() => {})}
                >
                  保存草稿
                </Button>
                <Button disabled={busy} onClick={compare}>
                  查看版本差异
                </Button>
                <Button
                  disabled={blocked || concurrent || !!pending.current}
                  onClick={() =>
                    void (async () => {
                      const current = dirty ? await save() : snapshot;
                      if (!current || !alive.current) return;
                      await act('skill.trial.preview', { id, revision: current.revision }, (v) => {
                        assertTrialPreview(v);
                        setTrial(v);
                      });
                    })().catch(() => {})
                  }
                >
                  {dirty ? '保存并准备试聊' : '试聊草稿'}
                </Button>
                <Button
                  type="primary"
                  disabled={blocked || dirty || concurrent || !!pending.current}
                  onClick={() =>
                    void act(
                      'skill.preview',
                      { id, revision: snapshot.revision },
                      setPreview,
                    ).catch(() => {})
                  }
                >
                  进入确认核对
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act('skill.detail', { id }, (v) => {
                      setWorkspace(v.workspace);
                      accept(v.proposal);
                    }).catch(() => {})
                  }
                >
                  重新读取状态，保留输入
                </Button>
              </div>
              {snapshot.status === 'unknown' && snapshot.publication && (
                <Button
                  type="primary"
                  disabled={busy}
                  onClick={() =>
                    void act('skill.inspect', {
                      id,
                      requestId: snapshot.publication!.requestId,
                    }).catch(() => {})
                  }
                >
                  核对保存结果
                </Button>
              )}
              {pending.current && (
                <Alert
                  type="warning"
                  title="提交回执未取得，操作身份已保留"
                  description="先重新读取状态。若尚未登记，可显式重试同一确认请求；不会使用新的版本身份。"
                  action={
                    <div className="skill-actions">
                      <Button
                        disabled={busy}
                        onClick={() => void act('skill.confirm', pending.current).catch(() => {})}
                      >
                        重试原确认请求
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          const requestId = pending.current.requestId;
                          void act(
                            'skill.cancelUnstarted',
                            { id, requestId, reviewed: true },
                            (v) => {
                              if (v.cancelled) pending.current = undefined;
                              accept(v.proposal);
                              setNotice(
                                v.cancelled
                                  ? '未开始的确认已撤销，请重新核对。'
                                  : '该操作已经开始，请按实际状态核对结果。',
                              );
                            },
                          ).catch(() => {});
                        }}
                      >
                        核对并撤销未开始的确认
                      </Button>
                    </div>
                  }
                />
              )}
            </Card>
          </div>
          <Card title="结构化内容" className="skill-structured-card">
            <SkillDataEditor
              key={id}
              json={json}
              disabled={blocked}
              pending={structuredPending}
              onPendingChange={setStructuredPending}
              change={(value) => {
                setJson(value);
                setError('');
                setPreview(undefined);
                setReviewed(false);
              }}
            />
          </Card>
          {concurrent && (
            <Card title="服务端内容已变化，当前输入保留">
              <pre tabIndex={0}>{JSON.stringify(snapshot.draft, null, 2)}</pre>
              <Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)}>
                已对照当前服务端内容和自己的编辑
              </Checkbox>
              <Button
                disabled={!reviewed || busy}
                onClick={() => {
                  setConcurrent(false);
                  setReviewed(false);
                }}
              >
                保留当前输入作为合并草稿
              </Button>
            </Card>
          )}
          {comparison && (
            <Card title="完整版本与差异核对">
              <div className="skill-grid">
                {(['base', 'current', 'external'] as const).map(
                  (key) =>
                    comparison[key] && (
                      <section key={key}>
                        <h3>
                          {
                            {
                              base: '原确认版本',
                              current: '当前确认版本',
                              external: '当前工作区内容（尚未确认）',
                            }[key]
                          }
                        </h3>
                        <pre tabIndex={0}>{comparison[key].markdown}</pre>
                        <pre tabIndex={0}>{bundle(comparison[key])}</pre>
                      </section>
                    ),
                )}
              </div>
              <p>上方展示完整内容，差异需要人工核对；不自动合并或覆盖手工修改。</p>
              {!confirmed && !['publishing', 'unknown'].includes(snapshot.status) && (
                <>
                  <Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)}>
                    已对照确认版本、当前工作区内容与本次草稿
                  </Checkbox>
                  <div className="skill-actions">
                    <Button
                      disabled={busy || dirty || !reviewed}
                      onClick={() =>
                        void act('skill.rebase', {
                          id,
                          revision: snapshot.revision,
                          head: comparison.head,
                          observation: comparison.observation,
                          adoptExternal: false,
                          reviewed: true,
                        })
                          .then(() => setComparison(undefined))
                          .catch(() => {})
                      }
                    >
                      保留草稿，采用已核对基线
                    </Button>
                    <Button
                      disabled={busy || dirty || !reviewed || !comparison.external}
                      onClick={() =>
                        void act('skill.rebase', {
                          id,
                          revision: snapshot.revision,
                          head: comparison.head,
                          observation: comparison.observation,
                          adoptExternal: true,
                          reviewed: true,
                        })
                          .then(() => setComparison(undefined))
                          .catch(() => {})
                      }
                    >
                      将已核对外部内容作为新草稿
                    </Button>
                  </div>
                </>
              )}
            </Card>
          )}
          {preview && (
            <Card title="确认保存到工作区">
              <p className="path-text">
                目录：{preview.workspace} · 草稿摘要：{preview.draftSha256}
              </p>
              <p>只新增新的版本目录，不覆盖旧版本；保存Skill不授予模型读取或外发权限。</p>
              <Checkbox
                checked={publicationReviewed}
                onChange={(e) => setPublicationReviewed(e.target.checked)}
              >
                我已核对完整正文、结构化内容与来源，以及当前工作区和父版本
              </Checkbox>
              <div className="skill-actions">
                <Button
                  disabled={busy}
                  onClick={() => {
                    setPreview(undefined);
                    setReviewed(false);
                    requestAnimationFrame(() => textarea.current?.focus());
                  }}
                >
                  返回编辑
                </Button>
                <Button
                  type="primary"
                  disabled={!publicationReviewed || busy || dirty || concurrent}
                  onClick={() => {
                    const args = pending.current ?? {
                      id,
                      revision: snapshot.revision,
                      token: preview.token,
                      requestId: crypto.randomUUID(),
                      reviewed: true,
                    };
                    pending.current = args;
                    void act('skill.confirm', args).catch(() => {});
                  }}
                >
                  我已核对，确认保存
                </Button>
              </div>
            </Card>
          )}
          {confirmed && (
            <Card title="固定确认版本与持续维护">
              <p>
                {snapshot.confirmed?.key} / {snapshot.confirmed?.versionId}
              </p>
              <p className="path-text">摘要：{snapshot.confirmed?.sha256}</p>
              <p>在流程的Skill资源中明确选择本版本。首版保留所有确认版本，不提供直接删除入口。</p>
              <div className="skill-actions">
                <Button
                  disabled={busy || !version}
                  onClick={() =>
                    void act('skill.fork', { id: version!.id }, (v) => {
                      setId(v.id);
                      pending.current = undefined;
                    }).catch(() => {})
                  }
                >
                  基于此版本编辑
                </Button>
                <Button
                  disabled={busy || !version}
                  onClick={() =>
                    void act('file.choose', { kind: 'directory' }, (v) => {
                      if (v) setRelocation(v);
                    }).catch(() => {})
                  }
                >
                  重新选择工作区
                </Button>
              </div>
              {relocation && (
                <>
                  <p className="path-text">新位置：{relocation}</p>
                  <Button
                    disabled={busy || !version}
                    onClick={() =>
                      void act(
                        'skill.relocate',
                        { id: version!.id, path: relocation, reviewed: true },
                        () => {
                          setNotice('新位置已核对登记；请在流程资源中重新选择。原绑定保持。');
                          setRelocation('');
                        },
                      ).catch(() => {})
                    }
                  >
                    核对同一版本并登记新位置
                  </Button>
                </>
              )}
            </Card>
          )}
          <div className="skill-actions">
            <Button
              disabled={busy}
              onClick={() => {
                if (dirty) setLeave({ next: back, label: '待办列表' });
                else back();
              }}
            >
              返回待办列表
            </Button>
            {openFlow && (
              <Button
                disabled={busy}
                onClick={() => {
                  const next = () => openFlow(snapshot.sourceFlowId);
                  if (dirty) setLeave({ next, label: '来源流程' });
                  else next();
                }}
              >
                返回来源流程
              </Button>
            )}
          </div>
        </>
      )}
      {leave && (
        <EditorLeaveDialog
          name={snapshot?.draft.title ?? 'Skill草稿'}
          destination={leave.label}
          draftLabel="Skill内容"
          save={async () => {
            await save();
            const next = leave.next;
            setLeave(undefined);
            next();
          }}
          discard={() => {
            const next = leave.next;
            setLeave(undefined);
            next();
          }}
          stay={() => {
            setLeave(undefined);
            requestAnimationFrame(() => {
              const incomplete = heading.current
                ?.closest('section')
                ?.querySelector<HTMLElement>(
                  '.json-tree-editor[data-value-invalid] .json-current input.ant-input:not(:disabled), .json-tree-editor[data-value-invalid] .json-current textarea:not(:disabled), textarea[data-value-invalid]',
                );
              if (incomplete) incomplete.focus();
              else textarea.current?.focus();
            });
          }}
        />
      )}
    </section>
  );
}
