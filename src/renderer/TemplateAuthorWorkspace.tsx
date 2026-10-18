import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { Alert, Button, Card, Checkbox, Collapse, Input, Select, Tabs, Tag } from 'antd';
import {
  assertAuthorDraft,
  newAuthorEntry,
  promptMarker,
  type AuthorDefinition,
  type AuthorDraft,
  type AuthorCheckout,
  type AuthorReceipt,
} from '../shared/template-author';
import type { Bootstrap, FlowRecord } from '../shared/types';
import type { TemplateNavigation } from './TemplateInstancePage';
import { flatten } from './flow-editing';
import AuthorSchemaEditor from './AuthorSchemaEditor';
import EditorLeaveDialog from './EditorLeaveDialog';
import TemplateManifestOverview from './TemplateManifestOverview';
import MarkdownBody from './MarkdownBody';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { usePageBack } from './use-page-back';
import './template-author.css';
export type AuthorOpenRequest = { nonce: string; id?: string; checkoutId?: string };
export type AuthorEditorOrigin = {
  draftId: string;
  checkoutId: string;
  flowId: string;
  name: string;
  sdk?: import('../shared/contracts.generated').TemplateAuthorSdkContext;
  sdkError?: string;
  sdkLoaded?: boolean;
};
const api = (method: string, args: unknown = {}) => window.flowark.request(method, args);
const status: Record<string, string> = {
  choosing: '正在选择位置',
  writing: '正在保存ZIP',
  written: 'ZIP已保存',
  cancelled: '已取消',
  failed: '导出未完成',
  unknown: '导出结果待核对',
};
const idFor = (prefix: string, list: { id: string }[]) => {
  let id = prefix,
    n = 2;
  while (list.some((e) => e.id === id)) id = prefix + '-' + n++;
  return id;
};
export default function TemplateAuthorWorkspace({
  active,
  request,
  data,
  refresh,
  back,
  navigation,
  openEditor,
  inspectZip,
}: {
  active: boolean;
  request?: AuthorOpenRequest;
  data: Bootstrap;
  refresh: () => Promise<void>;
  back: () => void;
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  openEditor: (record: FlowRecord, origin: AuthorEditorOrigin) => void;
  inspectZip: () => void;
}) {
  const [list, setList] = useState<any[]>([]),
    [saved, setSaved] = useState<AuthorDraft>(),
    [definition, setDefinition] = useState<AuthorDefinition>(),
    [remote, setRemote] = useState<AuthorDraft>(),
    [exports, setExports] = useState<AuthorReceipt[]>([]),
    [checkouts, setCheckouts] = useState<AuthorCheckout[]>([]);
  const [tab, setTab] = useState('metadata'),
    [entryIndex, setEntryIndex] = useState(0),
    [promptIndex, setPromptIndex] = useState(0),
    [assetIndex, setAssetIndex] = useState(0),
    [schemaScope, setSchemaScope] = useState('configuration'),
    [pendingInput, setPendingInput] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [merged, setMerged] = useState(false);
  const [preview, setPreview] = useState<any>(),
    [file, setFile] = useState('README.md'),
    [fileContent, setFileContent] = useState<any>(),
    [exportReviewed, setExportReviewed] = useState(false),
    [adoption, setAdoption] = useState<any>(),
    [adoptReviewed, setAdoptReviewed] = useState(false),
    [detach, setDetach] = useState<string[]>([]),
    [selectedCheckout, setSelectedCheckout] = useState(''),
    [binding, setBinding] = useState<{ entryId: string; nodeId: string; promptId: string }>(),
    [bindingReviewed, setBindingReviewed] = useState(false),
    [forkKey, setForkKey] = useState(''),
    [sourceFlow, setSourceFlow] = useState(''),
    [leave, setLeave] = useState<{ next: () => void; label: string }>();
  const heading = useRef<HTMLHeadingElement>(null),
    focus = useRef<HTMLElement | null>(null),
    locked = useRef(false),
    alive = useRef(true),
    base = useRef<AuthorDraft | undefined>(undefined),
    draftRef = useRef(definition),
    pendingExport = useRef<any>(undefined),
    adoptRequest = useRef<string | undefined>(undefined),
    createRequest = useRef<{ key: string; id: string } | undefined>(undefined),
    checkoutRequest = useRef<{ key: string; id: string } | undefined>(undefined),
    generation = useRef(0);
  draftRef.current = definition;
  const dirty =
      !!saved && !!definition && JSON.stringify(saved.definition) !== JSON.stringify(definition),
    dirtyRef = useRef(false);
  dirtyRef.current = dirty || pendingInput;
  function accept(d: AuthorDraft) {
    assertAuthorDraft(d);
    if (base.current?.id === d.id && base.current.revision > d.revision) return;
    base.current = d;
    setSaved(d);
    setDefinition(structuredClone(d.definition));
    setRemote(undefined);
    setMerged(false);
    setPreview(undefined);
    setAdoption(undefined);
    setExportReviewed(false);
    setAdoptReviewed(false);
    setPendingInput(false);
  }
  async function metadata(id: string) {
    const v = await api('author.detail', { id });
    if (!alive.current || base.current?.id !== id) return;
    setExports(v.exports);
    setCheckouts(v.checkouts);
    if (v.draft.revision > (base.current?.revision ?? 0)) setRemote(v.draft);
    return v;
  }
  async function lists() {
    const v = await api('author.list');
    if (alive.current) setList(v);
  }
  async function work<T>(fn: () => Promise<T>, apply?: (v: T) => void) {
    if (locked.current) throw Error('操作正在处理');
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const v = await fn();
      if (alive.current) apply?.(v);
      return v;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '操作未完成，当前输入保留');
      throw e;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const attempt = (fn: () => Promise<any>) => void fn().catch(() => {});
  async function createDraft(key = '') {
    const prior = createRequest.current;
    const requestId = prior?.key === key ? prior.id : crypto.randomUUID();
    createRequest.current = { key, id: requestId };
    await work(
      () => (key ? api('author.fork', { key, requestId }) : api('author.create', { requestId })),
      (d) => {
        createRequest.current = undefined;
        accept(d);
        setTab('metadata');
        attempt(lists);
      },
    );
  }
  async function open(id: string, checkoutId?: string) {
    const visit = ++generation.current;
    await work(
      () => api('author.detail', { id }),
      (v) => {
        if (visit !== generation.current) return;
        accept(v.draft);
        setExports(v.exports);
        setCheckouts(v.checkouts);
        setSelectedCheckout(checkoutId ?? '');
        setTab(checkoutId ? 'entries' : 'metadata');
        const returnedEntryId = v.checkouts.find(
          (c: AuthorCheckout) => c.id === checkoutId,
        )?.entryId;
        const entries: AuthorDefinition['entries'] = v.draft.definition.entries;
        setEntryIndex(
          Math.max(
            0,
            entries.findIndex((e) => e.id === returnedEntryId),
          ),
        );
        setPromptIndex(0);
        setAssetIndex(0);
        setBinding(undefined);
        requestAnimationFrame(() => heading.current?.focus());
      },
    );
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    attempt(async () => {
      try {
        await lists();
      } catch (e) {
        setError(e instanceof Error ? e.message : '制作列表未读取');
      }
    });
  }, [active]);
  useEffect(() => {
    if (!request) return;
    if (request.id) attempt(() => open(request.id!, request.checkoutId));
    else {
      base.current = undefined;
      setSaved(undefined);
      setDefinition(undefined);
      setError('');
      setNotice('');
      setPendingInput(false);
    }
  }, [request?.nonce]);
  useEffect(() => {
    if (!active || !saved?.id || !exports.some((e) => ['choosing', 'writing'].includes(e.status)))
      return;
    let reading = false,
      live = true;
    const timer = setInterval(() => {
      if (reading || locked.current) return;
      reading = true;
      void metadata(saved.id)
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
      void live;
    };
  }, [active, saved?.id, exports.map((e) => e.status).join(',')]);
  useEffect(() => {
    setExportReviewed(false);
  }, [preview?.token]);
  async function save() {
    if (!base.current || !draftRef.current) throw Error('制作草稿尚未读取');
    if (pendingInput) throw Error('请先应用或取消当前未完成的字段/Schema编辑');
    if (remote) throw Error('请先对照较新修订并明确合并');
    const current = base.current;
    return work(
      () =>
        api('author.save', {
          id: current.id,
          revision: current.revision,
          definition: draftRef.current,
        }),
      (d) => {
        accept(d);
        setNotice('制作草稿已保存，不会执行流程。');
        void lists().catch(() => {});
      },
    );
  }
  const navigate = (next: () => void, label = '目标页面') => {
    if (locked.current) return;
    if (dirtyRef.current) {
      focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setLeave({ next, label });
    } else next();
  };
  useLayoutEffect(() => {
    navigation.current = navigate;
    return () => {
      if (navigation.current === navigate) navigation.current = undefined;
    };
  });
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, []);
  const showList = () =>
    navigate(() => {
      base.current = undefined;
      setSaved(undefined);
      setDefinition(undefined);
      setPendingInput(false);
      attempt(lists);
    }, '制作草稿列表');
  usePageBack(() => (saved ? showList() : back()), active && !leave);
  const edit = (change: (d: AuthorDefinition) => void) => {
    if (!definition || busy) return;
    const next = structuredClone(definition);
    change(next);
    setDefinition(next);
    setPreview(undefined);
    setExportReviewed(false);
    setAdoption(undefined);
    setAdoptReviewed(false);
    setNotice('');
  };
  const entry = definition?.entries[entryIndex],
    prompt = definition?.prompts[promptIndex],
    asset = definition?.assets[assetIndex];
  const setEntry = (change: (e: NonNullable<typeof entry>) => void) =>
    edit((d) => {
      if (d.entries[entryIndex]) change(d.entries[entryIndex]);
    });
  const addEntry = () =>
    attempt(() =>
      work(
        async () => (sourceFlow ? api('author.flow.source', { flowId: sourceFlow }) : null),
        (v) => {
          edit((d) => {
            const e = newAuthorEntry(idFor('entry', d.entries));
            if (v) {
              e.name = v.flow.name;
              e.flow = v.flow;
              e.inputSchema = v.inputSchema;
            }
            d.entries.push(e);
          });
          setEntryIndex(definition?.entries.length ?? 0);
        },
      ),
    );
  async function checkout() {
    if (!saved || !entry) return;
    if (dirty || pendingInput) throw Error('请先保存制作草稿再打开编排副本');
    const key = JSON.stringify([saved.id, saved.revision, entry.id]);
    const prior = checkoutRequest.current;
    const requestId = prior?.key === key ? prior.id : crypto.randomUUID();
    checkoutRequest.current = { key, id: requestId };
    await work(
      () =>
        api('author.checkout', {
          id: saved.id,
          revision: saved.revision,
          entryId: entry.id,
          requestId,
        }),
      (v) => {
        checkoutRequest.current = undefined;
        setCheckouts((c) => [...c, v.checkout]);
        openEditor(v.record, {
          draftId: saved.id,
          checkoutId: v.checkout.id,
          flowId: v.record.id,
          name: saved.definition.metadata.name,
        });
        void refresh().catch(() => {});
      },
    );
  }
  async function prepareAdoption() {
    if (!saved || !selectedCheckout) return;
    if (dirty || pendingInput) throw Error('请先保存制作草稿，再核对带回');
    await work(
      () =>
        api('author.adopt.preview', {
          checkoutId: selectedCheckout,
          revision: saved.revision,
          detach,
        }),
      (v) => {
        setAdoption(v);
        setAdoptReviewed(false);
        adoptRequest.current = undefined;
      },
    );
  }
  async function prepareExport() {
    if (!saved) return;
    if (dirty || pendingInput) throw Error('请先保存有效草稿，再检查完整包');
    await work(
      () => api('author.preview', { id: saved.id, revision: saved.revision }),
      (v) => {
        setPreview(v);
        setFile(
          v.files.find((f: { path: string }) => f.path === 'README.md')?.path ??
            v.files[0]?.path ??
            'manifest.json',
        );
        setFileContent(undefined);
        setExportReviewed(false);
        pendingExport.current = undefined;
      },
    );
  }
  async function exportZip() {
    if (!saved || !preview) return;
    const args = pendingExport.current ?? {
      id: saved.id,
      revision: saved.revision,
      token: preview.token,
      requestId: crypto.randomUUID(),
      reviewed: true,
    };
    pendingExport.current = args;
    await work(
      () => api('author.export', args),
      (v) => {
        if (v) {
          setExports((old) => [...old.filter((e) => e.id !== v.id), v]);
          pendingExport.current = undefined;
        }
        setExportReviewed(false);
        void metadata(saved.id).catch(() => {});
      },
    );
  }
  const changeTab = (key: string) => {
    if (busy) return;
    if (pendingInput) {
      setError('请先应用或取消当前字段/Schema编辑，输入已保留');
      return;
    }
    setTab(key);
    setBinding(undefined);
    setBindingReviewed(false);
  };
  const chosenSchema = definition
    ? schemaScope === 'configuration'
      ? definition.configurationSchema
      : schemaScope === 'state'
        ? definition.stateSchema
        : schemaScope === 'input'
          ? entry?.inputSchema
          : entry?.resultSchema
    : undefined;
  return (
    <div hidden={!active} className="template-author-root">
      <header className="context-bar">
        <Button className="context-back" onClick={() => (saved ? showList() : back())}>
          {saved ? '← 返回制作草稿' : '← 返回模板库'}
        </Button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <span>模板库</span>
          <span>/</span>
          <span>模板制作</span>
          {saved && (
            <>
              <span>/</span>
              <span>{definition?.metadata.name}</span>
            </>
          )}
        </nav>
      </header>
      <section className="page template-author" aria-label="模板制作工作区">
        <header className="author-heading">
          <div>
            <h1 ref={heading} tabIndex={-1}>
              {saved ? '模板制作 · ' + (definition?.metadata.name ?? '草稿') : '你的模板制作草稿'}
            </h1>
            <p>
              {saved
                ? `修订 ${saved.revision}${dirty || pendingInput ? ' · 有未保存编辑' : ''} · 制作不会执行流程或调用模型`
                : '可视化维护入口、字段、提示词与资源，再导出公开定义。使用者重新绑定自己的资源。'}
            </p>
          </div>
          {saved && (
            <div className="author-actions">
              <Button
                disabled={busy || !dirty || pendingInput || !!remote}
                loading={busy}
                onClick={() => attempt(save)}
              >
                保存制作草稿
              </Button>
              <Button
                type="primary"
                disabled={busy || dirty || pendingInput || !!pendingExport.current}
                onClick={() => attempt(prepareExport)}
              >
                检查并导出
              </Button>
            </div>
          )}
        </header>
        {error && <Alert type="error" showIcon title={error} />}
        {notice && <Alert type="info" showIcon title={notice} />}
        {!saved ? (
          <div className="author-grid">
            <Card title="本机制作草稿">
              <div className="author-stack">
                {list.map((d) => (
                  <Button key={d.id} disabled={busy} onClick={() => attempt(() => open(d.id))}>
                    {d.name} · {d.entries}个入口 · 修订{d.revision}
                  </Button>
                ))}
                {!list.length && <p>还没有制作草稿，可从空白模板开始。</p>}
                <Button type="primary" disabled={busy} onClick={() => attempt(() => createDraft())}>
                  创建空白模板
                </Button>
                <Button disabled={busy} onClick={() => attempt(() => work(lists))}>
                  刷新草稿列表
                </Button>
              </div>
            </Card>
            <Card title="从准确包复制">
              <Select
                aria-label="选择来源包"
                value={forkKey || undefined}
                placeholder="选择已安装的准确版本"
                options={data.templates.map((p) => ({
                  value: p.key,
                  label: `${p.manifest.name} · ${p.manifest.version} · ${p.manifest.contentDigest.slice(0, 8)}`,
                }))}
                onChange={setForkKey}
              />
              <p>只复制定义及公开资源，产生新公开身份；不会读取实例Key、配置值、绑定或运行历史。</p>
              <Button
                disabled={busy || !forkKey}
                onClick={() => attempt(() => createDraft(forkKey))}
              >
                复制为新制作草稿
              </Button>
            </Card>
          </div>
        ) : (
          definition && (
            <>
              <div className="author-actions">
                <Tag>{pendingInput ? '字段编辑未应用' : dirty ? '未保存' : '已保存'}</Tag>
                <Button
                  disabled={busy}
                  onClick={() =>
                    attempt(() =>
                      work(
                        () => api('author.detail', { id: saved.id }),
                        (v) => {
                          setCheckouts(v.checkouts);
                          setExports(v.exports);
                          if (v.draft.revision > saved.revision) setRemote(v.draft);
                          else setNotice('当前已是最新修订。');
                        },
                      ),
                    )
                  }
                >
                  读取最新修订，保留输入
                </Button>
              </div>
              {remote && (
                <Card title="较新修订已保存，当前输入保留">
                  <Collapse
                    items={[
                      {
                        key: 'full',
                        label: '对照完整已保存定义',
                        children: (
                          <pre tabIndex={0}>{JSON.stringify(remote.definition, null, 2)}</pre>
                        ),
                      },
                    ]}
                  />
                  <Checkbox checked={merged} onChange={(e) => setMerged(e.target.checked)}>
                    已对照较新定义与当前编辑
                  </Checkbox>
                  <div className="author-actions">
                    <Button
                      disabled={!merged || busy}
                      onClick={() => {
                        base.current = remote;
                        setSaved(remote);
                        setRemote(undefined);
                        setMerged(false);
                        setNotice('保留当前输入作为合并草稿；保存前请继续核对。');
                      }}
                    >
                      保留当前合并编辑
                    </Button>
                    <Button disabled={!merged || busy} onClick={() => accept(remote)}>
                      明确采用较新保存内容
                    </Button>
                  </div>
                </Card>
              )}
              <Tabs
                activeKey={tab}
                onChange={changeTab}
                items={[
                  ['metadata', '基本信息'],
                  ['entries', '入口与编排'],
                  ['fields', '字段与表单'],
                  ['prompts', '公开提示词'],
                  ['resources', '资源与动作'],
                  ['files', '公共文件'],
                  ['history', '导出记录'],
                ].map(([key, label]) => ({ key, label }))}
              />
              {tab === 'metadata' && (
                <div className="author-grid">
                  <Card title="公开包信息">
                    {(['id', 'name', 'version', 'author', 'minimumClientVersion'] as const).map(
                      (key) => (
                        <div className="author-field" key={key}>
                          <label htmlFor={'author-meta-' + key}>
                            {
                              {
                                id: '模板标识',
                                name: '显示名称',
                                version: '版本',
                                author: '作者',
                                minimumClientVersion: '最低客户端',
                              }[key]
                            }
                          </label>
                          <Input
                            id={'author-meta-' + key}
                            maxLength={key === 'name' || key === 'author' ? 200 : 100}
                            value={definition.metadata[key]}
                            disabled={busy}
                            onChange={(e) =>
                              edit((d) => {
                                d.metadata[key] = e.target.value;
                              })
                            }
                          />
                        </div>
                      ),
                    )}
                  </Card>
                  <Card title="来源与说明">
                    <div className="author-field">
                      <label htmlFor="author-source">来源声明</label>
                      <Input
                        id="author-source"
                        value={definition.metadata.source}
                        maxLength={1000}
                        disabled={busy}
                        onChange={(e) =>
                          edit((d) => {
                            d.metadata.source = e.target.value;
                          })
                        }
                      />
                    </div>
                    <div className="author-field">
                      <label htmlFor="author-description">模板说明</label>
                      <Input.TextArea
                        id="author-description"
                        autoSize={{ minRows: 4, maxRows: 10 }}
                        maxLength={4000}
                        value={definition.metadata.description}
                        disabled={busy}
                        onChange={(e) =>
                          edit((d) => {
                            d.metadata.description = e.target.value;
                          })
                        }
                      />
                    </div>
                    <p>
                      来源是作者声明。默认值、字面量和公共文件须核对公开性；同标识同版本不同内容需先修改版本或身份。
                    </p>
                    <Button onClick={() => changeTab('entries')}>入口与编排</Button>
                  </Card>
                </div>
              )}
              {tab === 'entries' && (
                <>
                  <div className="author-grid">
                    <Card title="操作入口">
                      <div className="author-stack">
                        {definition.entries.map((e, i) => (
                          <Button
                            type={i === entryIndex ? 'primary' : 'default'}
                            key={i}
                            onClick={() => setEntryIndex(i)}
                          >
                            {e.id} · {e.name} · {e.schedulable ? '可定时' : '不定时'}
                          </Button>
                        ))}
                        <Select
                          aria-label="加入入口的来源流程"
                          value={sourceFlow}
                          onChange={setSourceFlow}
                          options={[
                            { value: '', label: '空白入口' },
                            ...data.flows.map((f) => ({ value: f.id, label: f.flow.name })),
                          ]}
                        />
                        <Button
                          disabled={busy || definition.entries.length >= 50}
                          onClick={addEntry}
                        >
                          添加入口
                        </Button>
                      </div>
                    </Card>
                    <Card title={'当前入口 · ' + (entry?.name ?? '尚未选择')}>
                      {entry ? (
                        <>
                          <div className="author-field">
                            <label htmlFor="author-entry-id">入口标识</label>
                            <Input
                              id="author-entry-id"
                              value={entry.id}
                              maxLength={100}
                              disabled={busy}
                              onChange={(e) =>
                                setEntry((n) => {
                                  n.id = e.target.value;
                                })
                              }
                            />
                          </div>
                          <div className="author-field">
                            <label htmlFor="author-entry-name">显示名称</label>
                            <Input
                              id="author-entry-name"
                              value={entry.name}
                              maxLength={200}
                              disabled={busy}
                              onChange={(e) =>
                                setEntry((n) => {
                                  n.name = e.target.value;
                                })
                              }
                            />
                          </div>
                          <Checkbox
                            checked={entry.schedulable}
                            disabled={busy}
                            onChange={(e) =>
                              setEntry((n) => {
                                n.schedulable = e.target.checked;
                              })
                            }
                          >
                            允许此入口配置本机计划
                          </Checkbox>
                          <p>
                            {flatten(entry.flow.steps).length}个步骤 ·
                            输入/结果结构独立，副本保存不会自动带回。
                          </p>
                          <div className="author-actions">
                            <Button
                              type="primary"
                              disabled={busy || dirty || pendingInput}
                              onClick={() => attempt(checkout)}
                            >
                              打开编排副本
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => {
                                setSchemaScope('input');
                                changeTab('fields');
                              }}
                            >
                              编辑字段
                            </Button>
                            <Button
                              danger
                              disabled={busy}
                              onClick={() => {
                                edit((d) => {
                                  d.entries.splice(entryIndex, 1);
                                });
                                setEntryIndex(Math.max(0, entryIndex - 1));
                              }}
                            >
                              移除入口定义
                            </Button>
                          </div>
                        </>
                      ) : (
                        <p>先添加入口，再在现有编排器中维护步骤。</p>
                      )}
                    </Card>
                  </div>
                  <Card title="从编排副本核对带回">
                    <Select
                      aria-label="选择编排副本"
                      value={selectedCheckout || undefined}
                      placeholder="选择本草稿的编排副本"
                      onChange={(v) => {
                        setSelectedCheckout(v);
                        setDetach([]);
                        setAdoption(undefined);
                      }}
                      options={checkouts.map((c) => ({
                        value: c.id,
                        label: `${c.entryId} · 来源修订${c.baseRevision} · ${c.flowId.slice(0, 8)}`,
                      }))}
                    />
                    <Button
                      disabled={busy || dirty || pendingInput || !selectedCheckout}
                      onClick={() => attempt(prepareAdoption)}
                    >
                      核对带回入口
                    </Button>
                    <p>当前制作草稿与副本摘要在确认时再次核对，不自动更换字段结构或公共提示词。</p>
                    {adoption && (
                      <>
                        <div className="author-grid">
                          <Collapse
                            items={[
                              {
                                key: 'base',
                                label: '完整原入口定义',
                                children: <pre>{JSON.stringify(adoption.base, null, 2)}</pre>,
                              },
                            ]}
                          />
                          <Collapse
                            items={[
                              {
                                key: 'copy',
                                label: '完整副本定义（对照）',
                                children: <pre>{JSON.stringify(adoption.flow, null, 2)}</pre>,
                              },
                            ]}
                          />
                        </div>
                        {adoption.status === 'blocked' ? (
                          <>
                            <Alert type="warning" title="提示词正文或目标需要处理，当前副本保留" />
                            {adoption.issues.map((i: any) => (
                              <Checkbox
                                key={i.nodeId}
                                checked={detach.includes(i.nodeId)}
                                onChange={(e) =>
                                  setDetach((s) =>
                                    e.target.checked
                                      ? [...s, i.nodeId]
                                      : s.filter((v) => v !== i.nodeId),
                                  )
                                }
                              >
                                明确解除 {i.nodeId} 的 {i.promptId} 绑定后，再采用副本手工内容
                              </Checkbox>
                            ))}
                            <Button
                              disabled={busy || !detach.length}
                              onClick={() => attempt(prepareAdoption)}
                            >
                              已核对解除范围，重新检查
                            </Button>
                            <Button onClick={() => changeTab('prompts')}>返回修改公共提示词</Button>
                          </>
                        ) : (
                          <>
                            <Collapse
                              items={[
                                {
                                  key: 'adopted',
                                  label: '将带回的完整入口（参数值已清空）',
                                  children: (
                                    <pre>{JSON.stringify(adoption.definition, null, 2)}</pre>
                                  ),
                                },
                              ]}
                            />
                            <Checkbox
                              checked={adoptReviewed}
                              onChange={(e) => setAdoptReviewed(e.target.checked)}
                            >
                              已核对完整差异、解除范围和当前修订；保留现有共享及输入/结果Schema
                            </Checkbox>
                            <Button
                              type="primary"
                              disabled={busy || !adoptReviewed}
                              onClick={() =>
                                attempt(() =>
                                  work(
                                    () =>
                                      api('author.adopt.confirm', {
                                        id: saved.id,
                                        revision: saved.revision,
                                        token: adoption.token,
                                        requestId:
                                          adoptRequest.current ??
                                          (adoptRequest.current = crypto.randomUUID()),
                                        reviewed: true,
                                      }),
                                    (d) => {
                                      accept(d);
                                      setNotice('入口已带回制作草稿，本机绑定和参数值未带回。');
                                      void metadata(saved.id).catch(() => {});
                                    },
                                  ),
                                )
                              }
                            >
                              我已核对，带回入口
                            </Button>
                            <Collapse
                              items={[
                                {
                                  key: 'suggested',
                                  label: '副本输入类型建议（不会自动替换Schema）',
                                  children: (
                                    <pre>
                                      {JSON.stringify(adoption.suggestedInputSchema, null, 2)}
                                    </pre>
                                  ),
                                },
                              ]}
                            />
                          </>
                        )}
                      </>
                    )}
                  </Card>
                </>
              )}
              {tab === 'fields' && (
                <>
                  <div className="author-actions">
                    <Select
                      aria-label="字段结构范围"
                      value={schemaScope}
                      options={[
                        { value: 'configuration', label: '共享配置' },
                        { value: 'state', label: '共享状态结构' },
                        { value: 'input', label: '入口输入' },
                        { value: 'result', label: '入口结果' },
                      ]}
                      onChange={(v) => {
                        if (pendingInput) {
                          setError('请先应用或取消当前字段编辑');
                          return;
                        }
                        setSchemaScope(v);
                      }}
                    />
                    {['input', 'result'].includes(schemaScope) && (
                      <Select
                        aria-label="字段所属入口"
                        value={entryIndex}
                        options={definition.entries.map((e, i) => ({
                          value: i,
                          label: e.id + ' · ' + e.name,
                        }))}
                        onChange={(i) => {
                          if (!pendingInput) setEntryIndex(i);
                          else setError('请先完成当前字段编辑');
                        }}
                      />
                    )}
                  </div>
                  {chosenSchema ? (
                    <AuthorSchemaEditor
                      key={schemaScope + ':' + (entry?.id ?? '')}
                      label={
                        {
                          configuration: '共享配置',
                          state: '共享状态',
                          input: '入口输入',
                          result: '入口结果',
                        }[schemaScope] ?? ''
                      }
                      schema={chosenSchema}
                      disabled={busy || !active}
                      form={schemaScope === 'configuration' || schemaScope === 'input'}
                      rootObject={schemaScope === 'input'}
                      pending={setPendingInput}
                      change={(s) =>
                        edit((d) => {
                          if (schemaScope === 'configuration') d.configurationSchema = s;
                          else if (schemaScope === 'state') d.stateSchema = s;
                          else if (d.entries[entryIndex]) {
                            if (schemaScope === 'input') d.entries[entryIndex].inputSchema = s;
                            else d.entries[entryIndex].resultSchema = s;
                          }
                        })
                      }
                    />
                  ) : (
                    <p>请先添加入口。</p>
                  )}
                </>
              )}
              {tab === 'prompts' && (
                <div className="author-grid">
                  <Card title="提示词内容">
                    <Select
                      aria-label="选择公开提示词"
                      value={prompt ? promptIndex : undefined}
                      options={definition.prompts.map((p, i) => ({
                        value: i,
                        label: p.id + ' · ' + p.name,
                      }))}
                      onChange={setPromptIndex}
                    />
                    <Button
                      disabled={busy || definition.prompts.length >= 100}
                      onClick={() => {
                        edit((d) =>
                          d.prompts.push({
                            id: idFor('guide', d.prompts),
                            name: '新公开规程',
                            body: '请依据用户明确选定的上下文，无法确定的内容标为待核实。',
                          }),
                        );
                        setPromptIndex(definition.prompts.length);
                      }}
                    >
                      添加公开提示词
                    </Button>
                    {prompt && (
                      <>
                        <div className="author-field">
                          <label htmlFor="author-prompt-id">提示词键</label>
                          <Input
                            id="author-prompt-id"
                            disabled={busy}
                            value={prompt.id}
                            onChange={(e) =>
                              edit((d) => {
                                const before = d.prompts[promptIndex].id;
                                d.prompts[promptIndex].id = e.target.value;
                                for (const entry of d.entries)
                                  for (const b of entry.promptBindings)
                                    if (b.promptId === before) {
                                      b.promptId = e.target.value;
                                      const n = flatten(entry.flow.steps).find(
                                        (n) => n.id === b.nodeId,
                                      );
                                      if (n && 'instructions' in n)
                                        n.instructions = promptMarker(e.target.value);
                                    }
                              })
                            }
                          />
                        </div>
                        <div className="author-field">
                          <label htmlFor="author-prompt-name">公开名称</label>
                          <Input
                            id="author-prompt-name"
                            disabled={busy}
                            value={prompt.name}
                            onChange={(e) =>
                              edit((d) => {
                                d.prompts[promptIndex].name = e.target.value;
                              })
                            }
                          />
                        </div>
                        <div className="author-field">
                          <label htmlFor="author-prompt-body">公开正文</label>
                          <Input.TextArea
                            id="author-prompt-body"
                            disabled={busy}
                            maxLength={60000}
                            autoSize={{ minRows: 7, maxRows: 20 }}
                            value={prompt.body}
                            onChange={(e) =>
                              edit((d) => {
                                d.prompts[promptIndex].body = e.target.value;
                              })
                            }
                          />
                        </div>
                        <p>修改会影响所有绑定入口；用户回答、资料正文和Key不应写入公共规程。</p>
                        <Button
                          danger
                          disabled={busy}
                          onClick={() => {
                            if (
                              definition.entries.some((e) =>
                                e.promptBindings.some((b) => b.promptId === prompt.id),
                              )
                            ) {
                              setError('提示词仍有绑定，请先明确解除后移除');
                              return;
                            }
                            edit((d) => d.prompts.splice(promptIndex, 1));
                            setPromptIndex(Math.max(0, promptIndex - 1));
                          }}
                        >
                          移除未绑定提示词
                        </Button>
                      </>
                    )}
                  </Card>
                  <Card title="绑定范围">
                    {definition.entries.flatMap((e) =>
                      e.promptBindings.map((b) => (
                        <div className="author-stack" key={e.id + '/' + b.nodeId}>
                          <p>
                            {e.id} / {b.nodeId} → {b.promptId}
                          </p>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              edit((d) => {
                                const entry = d.entries.find((v) => v.id === e.id)!;
                                const n = flatten(entry.flow.steps).find((v) => v.id === b.nodeId),
                                  p = d.prompts.find((p) => p.id === b.promptId);
                                if (n && p && 'instructions' in n) n.instructions = p.body;
                                entry.promptBindings = entry.promptBindings.filter(
                                  (v) => v.nodeId !== b.nodeId,
                                );
                              })
                            }
                          >
                            解除绑定，保留当前公共原文
                          </Button>
                        </div>
                      )),
                    )}
                    <Select
                      aria-label="绑定提示词的目标节点"
                      placeholder="选择AI或对话步骤"
                      value={
                        binding ? JSON.stringify([binding.entryId, binding.nodeId]) : undefined
                      }
                      onChange={(value) => {
                        const [eid, nid] = JSON.parse(value);
                        if (prompt) setBinding({ entryId: eid, nodeId: nid, promptId: prompt.id });
                        setBindingReviewed(false);
                      }}
                      options={definition.entries.flatMap((e) =>
                        flatten(e.flow.steps)
                          .filter((n) => ['ai', 'conversation', 'source-reduce'].includes(n.type))
                          .map((n) => ({
                            value: JSON.stringify([e.id, n.id]),
                            label: e.id + ' / ' + n.id,
                          })),
                      )}
                    />
                    {binding && prompt && (
                      <>
                        <pre tabIndex={0}>
                          原正文：
                          {(() => {
                            const e = definition.entries.find((e) => e.id === binding.entryId);
                            const n =
                              e && flatten(e.flow.steps).find((n) => n.id === binding.nodeId);
                            const old = e?.promptBindings.find((b) => b.nodeId === binding.nodeId);
                            return old
                              ? definition.prompts.find((p) => p.id === old.promptId)?.body
                              : n && 'instructions' in n
                                ? n.instructions
                                : '目标不可用';
                          })()}
                        </pre>
                        <pre tabIndex={0}>
                          将绑定 {prompt.id}：{prompt.body}
                        </pre>
                        <Checkbox
                          checked={bindingReviewed}
                          onChange={(e) => setBindingReviewed(e.target.checked)}
                        >
                          已核对目标步骤与公共正文，明确替换其原instructions
                        </Checkbox>
                        <Button
                          type="primary"
                          disabled={busy || !bindingReviewed || binding.promptId !== prompt.id}
                          onClick={() => {
                            edit((d) => {
                              const e = d.entries.find((e) => e.id === binding.entryId)!,
                                n = flatten(e.flow.steps).find((n) => n.id === binding.nodeId);
                              if (n && 'instructions' in n) {
                                n.instructions = promptMarker(prompt.id);
                                e.promptBindings = [
                                  ...e.promptBindings.filter((v) => v.nodeId !== n.id),
                                  { nodeId: n.id, field: 'instructions', promptId: prompt.id },
                                ];
                              }
                            });
                            setBinding(undefined);
                            setBindingReviewed(false);
                          }}
                        >
                          确认绑定公共提示词
                        </Button>
                      </>
                    )}
                    <p>正文在编排副本中被手改时，须核对后修改公共规程或明确解除，不自动覆盖。</p>
                  </Card>
                </div>
              )}
              {tab === 'resources' && (
                <>
                  <div className="author-grid">
                    <Card title="逻辑资源声明">
                      {definition.resources.map((r, i) => (
                        <div className="author-resource" key={i}>
                          <Input
                            aria-label={'资源' + (i + 1) + '标识'}
                            value={r.id}
                            disabled={busy}
                            onChange={(e) =>
                              edit((d) => {
                                const previousId = d.resources[i].id;
                                d.resources[i].id = e.target.value;
                                for (const resource of d.resources)
                                  if (resource.defaultDirectoryFrom === previousId)
                                    resource.defaultDirectoryFrom = e.target.value;
                              })
                            }
                          />
                          <Input
                            aria-label={'资源' + (i + 1) + '名称'}
                            value={r.name}
                            disabled={busy}
                            onChange={(e) =>
                              edit((d) => {
                                d.resources[i].name = e.target.value;
                              })
                            }
                          />
                          <Select
                            aria-label={'资源' + (i + 1) + '类型'}
                            value={r.kind}
                            disabled={busy}
                            options={[
                              'directory',
                              'file',
                              'browser',
                              'ai',
                              'skill',
                              'conversation-source',
                            ].map((value) => ({
                              value,
                              label: {
                                directory: '目录',
                                file: '文件',
                                browser: '浏览器',
                                ai: 'AI服务',
                                skill: '确认Skill',
                                'conversation-source': '完整会话来源',
                              }[value],
                            }))}
                            onChange={(v) => {
                              if (
                                v !== 'directory' &&
                                (r.defaultDirectoryFrom ||
                                  definition.resources.some(
                                    (resource) => resource.defaultDirectoryFrom === r.id,
                                  ))
                              ) {
                                setError('请先解除此目录及其他目录对它的默认来源引用，再改变类型');
                                return;
                              }
                              edit((d) => {
                                d.resources[i].kind = v;
                                d.resources[i].access = ['browser', 'ai'].includes(v)
                                  ? 'use'
                                  : 'read';
                              });
                            }}
                          />
                          <Select
                            aria-label={'资源' + (i + 1) + '访问'}
                            value={r.access}
                            disabled={busy}
                            options={(['browser', 'ai'].includes(r.kind)
                              ? ['use']
                              : ['skill', 'conversation-source'].includes(r.kind)
                                ? ['read']
                                : ['read', 'write', 'readwrite']
                            ).map((value) => ({
                              value,
                              label: {
                                use: '使用',
                                read: '读取',
                                write: '写入',
                                readwrite: '读写',
                              }[value],
                            }))}
                            onChange={(v) =>
                              edit((d) => {
                                d.resources[i].access = v;
                              })
                            }
                          />
                          <Checkbox
                            checked={r.required}
                            disabled={busy}
                            onChange={(e) =>
                              edit((d) => {
                                d.resources[i].required = e.target.checked;
                              })
                            }
                          >
                            必需
                          </Checkbox>
                          <Button
                            danger
                            disabled={busy}
                            onClick={() => {
                              if (definition.entries.some((e) => e.resourceIds.includes(r.id))) {
                                setError('资源仍被入口声明，请先解除入口引用');
                                return;
                              }
                              if (
                                definition.resources.some(
                                  (resource) => resource.defaultDirectoryFrom === r.id,
                                )
                              ) {
                                setError('目录仍被其他资源用作默认来源，请先解除默认来源引用');
                                return;
                              }
                              edit((d) => d.resources.splice(i, 1));
                            }}
                          >
                            移除
                          </Button>
                          {r.kind === 'directory' && (
                            <div className="author-directory-default">
                              <span>默认目录来源</span>
                              <Select
                                aria-label={'资源' + (i + 1) + '默认目录来源'}
                                value={r.defaultDirectoryFrom ?? ''}
                                disabled={busy}
                                options={[
                                  { value: '', label: '不设置默认来源' },
                                  ...definition.resources
                                    .filter(
                                      (source) =>
                                        source.id !== r.id &&
                                        source.kind === 'directory' &&
                                        !source.defaultDirectoryFrom,
                                    )
                                    .map((source) => ({
                                      value: source.id,
                                      label: `${source.name}（${source.id}）`,
                                    })),
                                ]}
                                onChange={(value) => {
                                  if (
                                    value &&
                                    definition.resources.some(
                                      (resource) => resource.defaultDirectoryFrom === r.id,
                                    )
                                  ) {
                                    setError('此目录仍作为其他目录的默认来源，请先解除引用');
                                    return;
                                  }
                                  edit((d) => {
                                    if (value) d.resources[i].defaultDirectoryFrom = value;
                                    else delete d.resources[i].defaultDirectoryFrom;
                                  });
                                }}
                              />
                              <p>
                                仅复用使用者选定的目录路径作为草稿默认值，可另选或清除；不保存本机路径或授予写入权限。
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                      <Button
                        disabled={busy || definition.resources.length >= 100}
                        onClick={() =>
                          edit((d) =>
                            d.resources.push({
                              id: idFor('resource', d.resources),
                              name: '新逻辑资源',
                              kind: 'directory',
                              access: 'read',
                              required: true,
                            }),
                          )
                        }
                      >
                        添加逻辑资源
                      </Button>
                      <p>只声明逻辑资源，不能在此配置实际路径、Key或授予权限。</p>
                    </Card>
                    <Card title="动作声明 · 默认拒绝">
                      {definition.actions.map((a, i) => (
                        <div className="author-stack" key={i}>
                          <Input
                            aria-label={'动作' + (i + 1) + '标识'}
                            disabled={busy}
                            value={a.id}
                            onChange={(e) =>
                              edit((d) => {
                                d.actions[i].id = e.target.value;
                              })
                            }
                          />
                          <Input
                            aria-label={'动作' + (i + 1) + '名称'}
                            disabled={busy}
                            value={a.name}
                            onChange={(e) =>
                              edit((d) => {
                                d.actions[i].name = e.target.value;
                              })
                            }
                          />
                          <Input.TextArea
                            aria-label={'动作' + (i + 1) + '说明'}
                            disabled={busy}
                            value={a.description}
                            onChange={(e) =>
                              edit((d) => {
                                d.actions[i].description = e.target.value;
                              })
                            }
                          />
                          <Button
                            danger
                            disabled={busy}
                            onClick={() => {
                              if (definition.entries.some((e) => e.actionIds.includes(a.id))) {
                                setError('动作仍被入口声明，请先解除入口引用');
                                return;
                              }
                              edit((d) => d.actions.splice(i, 1));
                            }}
                          >
                            移除动作声明
                          </Button>
                        </div>
                      ))}
                      <Button
                        disabled={busy || definition.actions.length >= 100}
                        onClick={() =>
                          edit((d) =>
                            d.actions.push({
                              id: idFor('action', d.actions),
                              name: '新动作',
                              description: '请描述准确影响与范围',
                              default: 'deny',
                            }),
                          )
                        }
                      >
                        添加动作声明
                      </Button>
                      <p>
                        节点最低资源、能力与写入动作由编译器补齐。脚本行为需要作者明确补充，不能据此自动分析任意代码。
                      </p>
                    </Card>
                  </div>
                  {entry && (
                    <Card title={'入口额外声明 · ' + entry.name}>
                      <Select
                        aria-label="资源声明所属入口"
                        value={entryIndex}
                        options={definition.entries.map((e, i) => ({
                          value: i,
                          label: e.id + ' · ' + e.name,
                        }))}
                        onChange={setEntryIndex}
                      />
                      <span>额外资源</span>
                      <Select
                        mode="multiple"
                        aria-label="入口额外资源"
                        value={entry.resourceIds}
                        options={definition.resources.map((r) => ({
                          value: r.id,
                          label: r.id + ' · ' + r.name,
                        }))}
                        onChange={(v) =>
                          setEntry((e) => {
                            e.resourceIds = v;
                          })
                        }
                      />
                      <span>额外动作</span>
                      <Select
                        mode="multiple"
                        aria-label="入口额外动作"
                        value={entry.actionIds}
                        options={definition.actions.map((a) => ({
                          value: a.id,
                          label: a.id + ' · ' + a.name,
                        }))}
                        onChange={(v) =>
                          setEntry((e) => {
                            e.actionIds = v;
                          })
                        }
                      />
                      <span>额外能力（标识）</span>
                      <Select
                        mode="tags"
                        aria-label="入口额外能力"
                        value={entry.capabilities}
                        onChange={(v) =>
                          setEntry((e) => {
                            e.capabilities = v;
                          })
                        }
                      />
                    </Card>
                  )}
                </>
              )}
              {tab === 'files' && (
                <>
                  <div className="author-grid">
                    <Card title="README · 公开使用说明">
                      <Input.TextArea
                        aria-label="公开README"
                        maxLength={60000}
                        value={definition.readme}
                        autoSize={{ minRows: 12, maxRows: 25 }}
                        disabled={busy}
                        onChange={(e) =>
                          edit((d) => {
                            d.readme = e.target.value;
                          })
                        }
                      />
                      <p>来源、许可、使用限制及所需资源可写在这里；不执行其中代码。</p>
                    </Card>
                    <Card title="附加公开文件">
                      <Select
                        aria-label="选择附加公开文件"
                        value={asset ? assetIndex : undefined}
                        options={definition.assets.map((a, i) => ({ value: i, label: a.path }))}
                        onChange={setAssetIndex}
                      />
                      <Button
                        disabled={busy || definition.assets.length >= 100}
                        onClick={() => {
                          edit((d) => {
                            let n = 1;
                            while (d.assets.some((a) => a.path === `assets/note-${n}.md`)) n++;
                            d.assets.push({
                              path: `assets/note-${n}.md`,
                              encoding: 'utf8',
                              body: '',
                            });
                          });
                          setAssetIndex(definition.assets.length);
                        }}
                      >
                        添加公开文本文件
                      </Button>
                      {asset && (
                        <>
                          <Input
                            aria-label="公开文件包内路径"
                            value={asset.path}
                            disabled={busy}
                            onChange={(e) =>
                              edit((d) => {
                                d.assets[assetIndex].path = e.target.value;
                              })
                            }
                          />
                          <p>编码：{asset.encoding} · 原包附加文件保留，不从本机任意路径读取。</p>
                          <Input.TextArea
                            aria-label="附加公开文件正文"
                            disabled={busy || asset.encoding === 'base64'}
                            value={asset.body}
                            maxLength={1048576}
                            autoSize={{ minRows: 8, maxRows: 20 }}
                            onChange={(e) =>
                              edit((d) => {
                                d.assets[assetIndex].body = e.target.value;
                              })
                            }
                          />
                          <Button
                            danger
                            disabled={busy}
                            onClick={() => {
                              edit((d) => d.assets.splice(assetIndex, 1));
                              setAssetIndex(Math.max(0, assetIndex - 1));
                            }}
                          >
                            移除此附加文件
                          </Button>
                        </>
                      )}
                    </Card>
                  </div>
                  <Card title="已打包依赖声明">
                    {definition.dependencies.map((d, i) => (
                      <div className="author-option" key={i}>
                        {(['name', 'version', 'license'] as const).map((k) => (
                          <Input
                            key={k}
                            aria-label={`依赖${i + 1}${k}`}
                            value={d[k]}
                            disabled={busy}
                            onChange={(e) =>
                              edit((v) => {
                                v.dependencies[i][k] = e.target.value;
                              })
                            }
                          />
                        ))}
                        <Button
                          danger
                          disabled={busy}
                          onClick={() => edit((d) => d.dependencies.splice(i, 1))}
                        >
                          移除
                        </Button>
                      </div>
                    ))}
                    <Button
                      disabled={busy}
                      onClick={() =>
                        edit((d) =>
                          d.dependencies.push({
                            name: 'package-name',
                            version: '1.0.0',
                            license: '请填写准确许可',
                          }),
                        )
                      }
                    >
                      添加依赖声明
                    </Button>
                    <p>仅声明已静态打包的依赖；此处不会安装或下载。</p>
                  </Card>
                </>
              )}
              {preview && (
                <Card title="导出前完整核对">
                  <p>先查看每个入口及资源和动作，再核对公开说明。导出不执行流程或授予权限。</p>
                  <TemplateManifestOverview
                    key={preview.token}
                    manifest={preview.manifest}
                    checked
                    layout="review"
                  />
                  <Card title="公开文件预览" size="small">
                    <div className="author-export-files">
                      <Select
                        aria-label="查看固定包文件"
                        disabled={busy}
                        value={file}
                        options={[
                          ...new Set<string>([
                            'manifest.json',
                            ...preview.files.map((f: { path: string }) => f.path),
                          ]),
                        ].map((value) => ({
                          value,
                          label: value === 'manifest.json' ? `${value}（高级声明）` : value,
                        }))}
                        onChange={(v) => {
                          setFile(v);
                          setFileContent(undefined);
                        }}
                      />
                      <Button
                        disabled={busy}
                        onClick={() =>
                          attempt(() =>
                            work(
                              () =>
                                api('author.file', {
                                  id: saved.id,
                                  token: preview.token,
                                  path: file,
                                }),
                              setFileContent,
                            ),
                          )
                        }
                      >
                        读取所选文件
                      </Button>
                    </div>
                    <p className="template-catalog-muted">
                      Markdown 提供阅读预览；脚本与 JSON 保留原文，不执行其中代码。
                    </p>
                    {fileContent?.kind === 'text' ? (
                      /\.md$/i.test(file) ? (
                        <Tabs
                          key={`${preview.token}:${file}`}
                          items={[
                            {
                              key: 'reading',
                              label: '阅读预览',
                              children: <MarkdownBody text={fileContent.text} />,
                            },
                            {
                              key: 'source',
                              label: '原文',
                              children: <pre tabIndex={0}>{fileContent.text}</pre>,
                            },
                          ]}
                        />
                      ) : (
                        <pre tabIndex={0}>{fileContent.text}</pre>
                      )
                    ) : (
                      fileContent && (
                        <p className="path-text">
                          {fileContent.reason} · {fileContent.size}字节 · {fileContent.sha256}
                        </p>
                      )
                    )}
                  </Card>
                  <Collapse
                    items={[
                      {
                        key: 'requirements',
                        label: '高级：原始声明与摘要（可选）',
                        onKeyDown: activateCollapseWithSpace,
                        children: (
                          <>
                            <p>
                              {preview.manifest.id} · {preview.manifest.version} · {preview.bytes}
                              字节
                            </p>
                            <p className="path-text">
                              包摘要：{preview.manifest.contentDigest} · 归档摘要：
                              {preview.archiveSha256}
                            </p>
                            <pre tabIndex={0}>
                              {JSON.stringify(
                                {
                                  entries: preview.manifest.entries,
                                  resources: preview.manifest.resources,
                                  actions: preview.manifest.actions,
                                  dependencies: preview.manifest.dependencies,
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
                  <Alert
                    type="info"
                    title="参数/配置实际值、个人Skill、简历、聊天、Key、绑定与运行记录不进入定义。字面量、代码、README、提示词和公开默认值仍须逐项核对。"
                  />
                  <Checkbox
                    checked={exportReviewed}
                    onChange={(e) => setExportReviewed(e.target.checked)}
                  >
                    已核对所有入口及公开文件、版本和保存内容，可以导出
                  </Checkbox>
                  <div className="author-actions">
                    <Button
                      type="primary"
                      disabled={
                        busy || !exportReviewed || dirty || pendingInput || !!pendingExport.current
                      }
                      onClick={() => attempt(exportZip)}
                    >
                      已核对公开内容，导出ZIP
                    </Button>
                    <Button disabled={busy} onClick={() => setPreview(undefined)}>
                      返回修改
                    </Button>
                  </div>
                </Card>
              )}
              {pendingExport.current && (
                <Alert
                  type="warning"
                  title="导出回执未取得，原请求身份保留"
                  description="先读取实际导出记录；不会自动换身份或重写。"
                  action={
                    <div className="author-actions">
                      <Button
                        disabled={busy}
                        onClick={() => attempt(() => work(() => metadata(saved.id)))}
                      >
                        重新读取记录
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          attempt(() =>
                            work(
                              () => api('author.export', pendingExport.current),
                              (v) => {
                                if (v) {
                                  setExports((old) => [...old.filter((e) => e.id !== v.id), v]);
                                  pendingExport.current = undefined;
                                }
                              },
                            ),
                          )
                        }
                      >
                        重试原确认请求
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          attempt(() =>
                            work(
                              () =>
                                api('author.export.cancel', {
                                  id: saved.id,
                                  requestId: pendingExport.current.requestId,
                                  reviewed: true,
                                }),
                              (v) => {
                                if (v.cancelled) pendingExport.current = undefined;
                                if (v.receipt)
                                  setExports((old) => [
                                    ...old.filter((e) => e.id !== v.receipt.id),
                                    v.receipt,
                                  ]);
                                setNotice(
                                  v.cancelled
                                    ? '未开始的导出已撤销，请重新核对'
                                    : '操作已开始，请核对原导出记录',
                                );
                              },
                            ),
                          )
                        }
                      >
                        核对并撤销未开始请求
                      </Button>
                    </div>
                  }
                />
              )}
              {(tab === 'history' || exports.length > 0) && (
                <Card title="固定导出回执">
                  {!exports.length && <p>尚无导出记录。</p>}
                  {exports.map((e) => (
                    <div className="author-receipt" key={e.id}>
                      <Tag>{status[e.status]}</Tag>
                      <p>
                        {e.package.id} · {e.package.version} · 制作修订{e.revision}
                      </p>
                      <p className="path-text">
                        包摘要：{e.package.contentDigest} · 归档摘要：{e.archiveSha256}
                      </p>
                      {e.destination && <p className="path-text">{e.destination}</p>}
                      {e.error && <Alert type="warning" title={e.error} />}
                      <div className="author-actions">
                        {['unknown', 'writing'].includes(e.status) && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              attempt(() =>
                                work(
                                  () =>
                                    api('author.export.inspect', { id: saved.id, requestId: e.id }),
                                  (v) =>
                                    setExports((old) => old.map((e) => (e.id === v.id ? v : e))),
                                ),
                              )
                            }
                          >
                            核对原导出结果
                          </Button>
                        )}
                        {e.status === 'choosing' && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              attempt(() =>
                                work(
                                  () =>
                                    api('author.export.cancel', {
                                      id: saved.id,
                                      requestId: e.id,
                                      reviewed: true,
                                    }),
                                  (v) => {
                                    if (v.receipt)
                                      setExports((old) =>
                                        old.map((e) => (e.id === v.receipt.id ? v.receipt : e)),
                                      );
                                  },
                                ),
                              )
                            }
                          >
                            撤销未开始的导出
                          </Button>
                        )}
                        {e.status === 'written' && (
                          <Button
                            disabled={busy}
                            onClick={() => navigate(inspectZip, '选择ZIP复导检查')}
                          >
                            选择ZIP复导检查
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </Card>
              )}
            </>
          )
        )}
      </section>
      {leave && (
        <EditorLeaveDialog
          name={definition?.metadata.name ?? '制作草稿'}
          destination={leave.label}
          draftLabel="制作定义"
          stay={() => {
            setLeave(undefined);
            requestAnimationFrame(() => focus.current?.focus());
          }}
          discard={() => {
            if (saved) setDefinition(structuredClone(saved.definition));
            setPendingInput(false);
            const next = leave.next;
            setLeave(undefined);
            next();
          }}
          save={async () => {
            await save();
            const next = leave.next;
            setLeave(undefined);
            next();
          }}
        />
      )}
    </div>
  );
}
