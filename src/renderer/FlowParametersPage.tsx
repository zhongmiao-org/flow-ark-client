import SkillPicker from './SkillPicker';
import SourcePicker from './SourcePicker';
import { flatten } from './flow-editing';
import ActionButton from './ActionButton';
import { changeParameterValues, resolveParameterSources } from '../shared/parameter-sources';
import {
  ConfigProvider,
  Select,
  Button,
  Checkbox,
  Modal,
  Flex,
  Tag,
  Badge,
  Alert,
  Collapse,
  Card,
} from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { usePageBack } from './use-page-back';
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { BrowserBinding, FlowRecord, Json } from '../shared/types';
import { referenceIssues, type ReferenceIssue } from '../shared/flow-references';
import { flowOutline } from './flow-outline';
import { taskStepTitle } from './task-step-presentation';
import { fileBindingNames } from './file-bindings';
import ParameterConfiguration from './ParameterConfiguration';
import { renameParameter } from './parameter-rename';
import TemplateParameters from './TemplateParameters';
import type { ScriptNavigation } from './ScriptEditorPage';
import './flow-parameters.css';

export default function FlowParametersPage({
  record,
  browsers,
  credentials,
  navigation,
  close,
  save,
  configuration,
  onDirtyChange,
  returnLabel = '流程编排',
}: {
  record: FlowRecord;
  browsers: BrowserBinding[];
  credentials: string[];
  navigation: MutableRefObject<ScriptNavigation | undefined>;
  close: (next?: () => void) => void;
  save: (record: FlowRecord) => Promise<FlowRecord>;
  configuration: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  returnLabel?: string;
}) {
  const [credentialNames, setCredentialNames] = useState<Record<string, string>>({});
  const [credentialError, setCredentialError] = useState('');
  useEffect(() => {
    let live = true;
    window.flowark
      .request('credential.local.list')
      .then((entries: { id: string; name: string }[]) => {
        if (live)
          setCredentialNames(Object.fromEntries(entries.map((entry) => [entry.id, entry.name])));
      })
      .catch(() => {
        if (live) setCredentialError('凭据名称暂未读取，以下保留实际引用标识。');
      });
    return () => {
      live = false;
    };
  }, []);
  const [draft, setDraft] = useState(() => structuredClone(record));
  const [busy, setBusy] = useState('');
  const [choosing, setChoosing] = useState('');
  const [selection, setSelection] = useState<{
    binding: string;
    message: string;
    failed: boolean;
  }>();
  const selectionMessage = useRef<HTMLParagraphElement>(null);
  const selectionTrigger = useRef<HTMLElement | null>(null);
  const selectionFocus = useRef(false);
  useLayoutEffect(() => {
    if (busy || !selectionFocus.current) return;
    selectionFocus.current = false;
    if (selection?.failed) selectionMessage.current?.focus();
    else selectionTrigger.current?.focus({ preventScroll: true });
  }, [busy, selection]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const saveFeedback = useRef<HTMLDivElement>(null);
  const [errorKind, setErrorKind] = useState<'input' | 'save'>('save');
  const [incompleteInput, setIncompleteInput] = useState(false);
  const pageError = useRef<HTMLDivElement>(null);
  const focusPageError = useRef(false);
  const [pending, setPending] = useState<{ next?: () => void; destination: string }>();
  const [failureRevision, setFailureRevision] = useState(0);
  useLayoutEffect(() => {
    if (error && !busy && !pending && focusPageError.current) {
      pageError.current?.focus();
      focusPageError.current = false;
    }
  }, [error, busy, pending]);
  const root = useRef<HTMLElement>(null),
    dialogHeading = useRef<HTMLHeadingElement>(null),
    continueButton = useRef<HTMLButtonElement>(null);
  const locked = useRef(false),
    alive = useRef(true),
    lastFocus = useRef<HTMLElement | null>(null);
  const dirty = JSON.stringify(record) !== JSON.stringify(draft);
  const unsaved = dirty || incompleteInput;
  useLayoutEffect(() => {
    if (saved && !unsaved && !busy) saveFeedback.current?.focus();
  }, [saved, unsaved, busy]);
  useLayoutEffect(() => {
    onDirtyChange?.(unsaved);
  }, [unsaved, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const incomplete = () => !!root.current?.querySelector('[data-value-invalid]');
  const focusIncomplete = () => {
    const invalid = root.current?.querySelector<HTMLElement>('[data-value-invalid]');
    const target = invalid?.matches('input,textarea')
      ? invalid
      : (invalid?.querySelector<HTMLElement>(
          'input[aria-invalid="true"],textarea[aria-invalid="true"]',
        ) ?? invalid?.querySelector<HTMLElement>('input,textarea'));
    target?.focus();
    return !!target;
  };
  const leave: ScriptNavigation = (next, destination = returnLabel) => {
    if (locked.current || pending) return;
    if (dirty || incomplete()) {
      if (!lastFocus.current?.isConnected)
        lastFocus.current = document.activeElement as HTMLElement;
      setPending({ next, destination });
    } else close(next);
  };
  useLayoutEffect(() => {
    navigation.current = leave;
    return () => {
      navigation.current = undefined;
    };
  });
  useEffect(() => {
    alive.current = true;
    root.current?.querySelector<HTMLElement>('h1')?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (pending && error && !busy) dialogHeading.current?.focus();
  }, [pending, error, busy, failureRevision]);
  usePageBack(leave);
  const stay = () => {
    if (locked.current) return;
    setPending(undefined);
    requestAnimationFrame(() => {
      if (errorKind === 'input' && focusIncomplete()) return;
      if (lastFocus.current?.isConnected) lastFocus.current.focus();
    });
  };
  const parameters = (next: Record<string, Json>) => {
    const before = new Set(
      referenceIssues(draft.flow.steps, draft.flow.parameters).map((issue) =>
        JSON.stringify(issue),
      ),
    );
    const added = referenceIssues(draft.flow.steps, next).filter(
      (issue) => !before.has(JSON.stringify(issue)),
    );
    if (added.length) throw new Error(referenceFeedback(added));
    const removed = Object.keys(draft.flow.parameters).some((key) => !Object.hasOwn(next, key));
    if (removed && root.current?.querySelector('.parameter-source-field[data-value-invalid]'))
      throw new Error('请先修正未完成的来源表达式，再删除参数。');
    const flow = changeParameterValues(draft.flow, next);
    setDraft({ ...draft, flow });
    setError('');
  };
  const referenceFeedback = (issues: ReferenceIssue[]) => {
    const entries = flowOutline(draft.flow.steps).byId;
    const references = [
      ...new Set(
        issues.map(({ nodeId, reference }) => {
          const entry = entries.get(nodeId);
          const name = entry
            ? `第 ${entry.ordinal} 步「${taskStepTitle(entry.step)}」`
            : `步骤 ${nodeId}`;
          return `${name} → ${reference}`;
        }),
      ),
    ];
    return `参数尚未修改，以下步骤仍使用这些引用：\n${references.join('\n')}\n请先在对应步骤中调整引用，再修改参数。`;
  };
  const persist = async (leaveAfterSave = false, next?: () => void) => {
    if (locked.current) return;
    if (incomplete()) {
      setErrorKind('input');
      setError('请先确认参数名称并修正未完成的参数值或来源表达式，再保存。');
      if (pending) setFailureRevision((revision) => revision + 1);
      else requestAnimationFrame(focusIncomplete);
      return;
    }
    locked.current = true;
    setBusy('save');
    setError('');
    setSaved(false);
    try {
      resolveParameterSources(draft.flow);
      const result = await save(draft);
      if (alive.current) {
        setDraft(structuredClone(result));
        setSelection(undefined);
        if (leaveAfterSave) close(next);
        else setSaved(true);
      }
    } catch (reason) {
      if (alive.current) {
        focusPageError.current = !pending;
        setErrorKind('save');
        setError(reason instanceof Error ? reason.message : '保存未完成，请重试');
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy('');
    }
  };
  const choose = async (binding: string) => {
    if (locked.current) return;
    locked.current = true;
    selectionTrigger.current = document.activeElement as HTMLElement;
    lastFocus.current = selectionTrigger.current;
    setBusy('choose');
    setChoosing(binding);
    setSelection(undefined);
    try {
      const path = await window.flowark.request('file.choose', { kind: 'directory' });
      if (!alive.current) return;
      if (typeof path === 'string' && path) {
        setDraft((current) => ({
          ...current,
          bindings: { ...current.bindings, files: { ...current.bindings.files, [binding]: path } },
        }));
        setSelection({
          binding,
          failed: false,
          message:
            path === draft.bindings.files[binding]
              ? '选择位置未改变。其他未保存更改仍需保存。'
              : '已选择目录，尚未保存。点击“保存参数”后应用到流程。',
        });
      } else {
        setSelection({
          binding,
          failed: false,
          message: draft.bindings.files[binding]
            ? '已取消选择，保留原目录和其他未保存更改。'
            : '已取消选择，尚未设置目录。其他未保存更改已保留。',
        });
      }
    } catch (reason) {
      if (alive.current)
        setSelection({
          binding,
          failed: true,
          message: `${reason instanceof Error ? reason.message : '目录未选择'}。原目录和其他输入已保留，可重新选择。`,
        });
    } finally {
      locked.current = false;
      if (alive.current) {
        selectionFocus.current = true;
        setBusy('');
        setChoosing('');
      }
    }
  };
  const managed = draft.bindings.configuration?.adapter === 'flow-parameters-v1';
  const values = draft.bindings.configuration?.values;
  const managedValues =
    values && typeof values === 'object' && !Array.isArray(values) ? values : undefined;
  const ids = [...new Set([...credentials, ...draft.bindings.credentials])];
  const actions = (
    <>
      <ActionButton
        hint={
          busy === 'save'
            ? '正在保存，请等待当前操作完成'
            : busy
              ? '当前资源操作尚未完成，请稍候'
              : '保存参数、资源及当前流程草稿，留在本页'
        }
        aria-label="保存参数"
        type="primary"
        loading={busy === 'save'}
        disabled={!!busy || undefined}
        title="保存参数、资源及当前流程草稿，留在本页"
        onClick={() => void persist()}
      >
        {busy === 'save' ? '正在保存…' : error ? '重试保存参数' : '保存参数'}
      </ActionButton>
      <Button disabled={!!busy || undefined} onClick={() => leave()}>
        返回{returnLabel}
      </Button>
    </>
  );
  return (
    <section
      className="page flow-parameters-page"
      ref={root}
      aria-label="流程参数与资源"
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.matches('input,textarea,select') && !target.closest('dialog'))
          lastFocus.current = target;
      }}
    >
      <header className="flow-parameters-heading">
        <div>
          <h1 tabIndex={-1}>流程参数与资源{unsaved ? ' · 未保存' : ''}</h1>
          <p>普通流程自由编辑参数；模板实例使用独立共享配置与入口输入。</p>
        </div>
      </header>
      {saved && !unsaved && (
        <div ref={saveFeedback} tabIndex={-1}>
          <Alert
            type="success"
            showIcon
            title="参数与资源已保存"
            description="保存不会运行；当前编辑不影响已开始的运行或固定计划。可继续编辑或返回。"
            role="status"
          />
        </div>
      )}
      {error && !pending && (
        <div className="flow-parameters-error" tabIndex={-1} ref={pageError}>
          <Alert
            type="error"
            showIcon
            title={errorKind === 'input' ? '参数输入尚未完成' : '保存未完成'}
            description={
              <>
                <p>{error}</p>
                <p>当前输入已保留，修正后可再次保存。</p>
              </>
            }
            action={
              <Button
                disabled={!!busy || undefined}
                onClick={() => {
                  if (focusIncomplete()) return;
                  (
                    (lastFocus.current?.isConnected ? lastFocus.current : undefined) ??
                    root.current?.querySelector<HTMLElement>('input,textarea,[role="combobox"]')
                  )?.focus();
                }}
              >
                返回编辑
              </Button>
            }
            role="alert"
          />
        </div>
      )}
      <ConfigProvider componentDisabled={!!busy}>
        <fieldset disabled={!!busy} className="flow-parameters-columns">
          <section
            className="flow-parameters-card flow-parameters-card--values"
            aria-label="运行参数"
          >
            <Card>
              <h2>运行参数</h2>
              {managed ? (
                managedValues ? (
                  <TemplateParameters
                    value={managedValues}
                    edit={() => leave(configuration, '实例配置')}
                  />
                ) : (
                  <>
                    <p role="alert">实例参数格式不可用，请打开实例配置核对。</p>
                    <Button htmlType="button" onClick={() => leave(configuration, '实例配置')}>
                      编辑实例配置
                    </Button>
                  </>
                )
              ) : (
                <>
                  {!Object.keys(draft.flow.parameters).length && (
                    <p className="flow-parameters-empty">
                      还没有运行参数。添加后可在步骤中选择变量引用。
                    </p>
                  )}
                  <ParameterConfiguration
                    columns
                    actions={actions}
                    value={draft.flow.parameters}
                    flow={draft.flow}
                    sourceChange={(flow) => {
                      setDraft({ ...draft, flow });
                      setError('');
                    }}
                    change={parameters}
                    onIncompleteChange={setIncompleteInput}
                    rename={(from, to) => {
                      if (
                        root.current?.querySelector(
                          '[data-value-invalid]:not([data-parameter-name])',
                        )
                      )
                        throw new Error('请先完成参数值和新参数输入，再确认改名。');
                      if (
                        root.current?.querySelector('.parameter-source-field[data-value-invalid]')
                      )
                        throw new Error('请先修正未完成的来源表达式，再重命名参数。');
                      const next = renameParameter(draft.flow, from, to);
                      resolveParameterSources(next.flow);
                      const before = new Set(
                        referenceIssues(draft.flow.steps, draft.flow.parameters).map((issue) =>
                          JSON.stringify(issue),
                        ),
                      );
                      const added = referenceIssues(next.flow.steps, next.flow.parameters).filter(
                        (issue) => !before.has(JSON.stringify(issue)),
                      );
                      if (added.length) throw new Error(referenceFeedback(added));
                      setDraft({ ...draft, flow: next.flow });
                      setError('');
                      return next.references;
                    }}
                  />
                </>
              )}
              {managed && <div className="parameter-actions">{actions}</div>}
            </Card>
          </section>
          <section className="flow-parameters-card" aria-label="本机资源">
            <Card>
              <h2>本机资源</h2>
              <div className="flow-parameters-binding">
                <label htmlFor="parameters-browser">浏览器</label>
                <Select<string>
                  id="parameters-browser"
                  value={draft.bindings.browserId ?? ''}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      bindings: { ...draft.bindings, browserId: value || undefined },
                    })
                  }
                  options={[
                    { value: '', label: '尚未绑定' },
                    ...(draft.bindings.browserId &&
                    !browsers.some((browser) => browser.id === draft.bindings.browserId)
                      ? [
                          {
                            value: draft.bindings.browserId,
                            label: <>原浏览器绑定不可用 · {draft.bindings.browserId}</>,
                          },
                        ]
                      : []),
                    ...browsers.map((browser) => ({
                      value: browser.id,
                      label: (
                        <>
                          {browser.product === 'embedded' ? 'FlowArk 内置浏览器' : browser.product}{' '}
                          {browser.version}
                        </>
                      ),
                    })),
                  ]}
                />
              </div>
              {!browsers.length && <p>尚未发现可用绑定，请先在本地设置中配置浏览器。</p>}
              {fileBindingNames(
                draft.flow.steps,
                draft.bindings.files,
                draft.flow.parameters,
                draft.flow.parameterSources,
              ).map((binding) => (
                <div
                  className="flow-parameters-resource"
                  key={binding}
                  aria-busy={busy === 'choose' && choosing === binding}
                >
                  <strong>{binding} 目录</strong>
                  <ActionButton
                    stretch
                    triggerClassName="parameter-resource-action"
                    hint={
                      busy === 'choose' && choosing === binding
                        ? '正在选择目录，取消后保留原绑定'
                        : (draft.bindings.files[binding] ?? '选择本机目录作为当前流程的资源绑定')
                    }
                    htmlType="button"
                    color="default"
                    variant="filled"
                    loading={busy === 'choose' && choosing === binding}
                    onClick={() => void choose(binding)}
                    aria-label={'选择 ' + binding + ' 目录'}
                    title={draft.bindings.files[binding] ?? '尚未选择'}
                  >
                    {draft.bindings.files[binding] ?? '选择目录'}
                  </ActionButton>
                  {selection?.binding === binding && (
                    <p
                      ref={selectionMessage}
                      tabIndex={-1}
                      role={selection.failed ? 'alert' : 'status'}
                      className={selection.failed ? 'field-error' : undefined}
                    >
                      {selection.message}
                    </p>
                  )}
                </div>
              ))}
              {[
                ...new Set(
                  flatten(draft.flow.steps)
                    .filter((n) => n.type === 'skill' && n.operation === 'read')
                    .map((n) => (n as import('../shared/skill').SkillNode).binding),
                ),
              ].map((binding) => (
                <div key={'skill:' + binding}>
                  <h3>{binding} · 固定Skill版本</h3>
                  <SkillPicker
                    disabled={!!busy}
                    value={draft.bindings.resources?.[binding]}
                    change={(value) =>
                      setDraft((current) => {
                        const resources = { ...current.bindings.resources };
                        if (value) resources[binding] = value;
                        else delete resources[binding];
                        return { ...current, bindings: { ...current.bindings, resources } };
                      })
                    }
                  />
                </div>
              ))}
              {[
                ...new Set(
                  flatten(draft.flow.steps)
                    .filter((n) => n.type === 'source')
                    .map((n) => (n as import('../shared/conversation-source').SourceNode).binding),
                ),
              ].map((binding) => (
                <div key={'source:' + binding}>
                  <h3>完整会话来源 · {binding}</h3>
                  {draft.bindings.template ? (
                    <>
                      <p>完整来源由实例资源统一管理。</p>
                      <Button onClick={configuration}>编辑实例资源</Button>
                    </>
                  ) : (
                    <SourcePicker
                      target={{ kind: 'flow', id: record.id, revision: record.updatedAt }}
                      binding={binding}
                      value={draft.bindings.resources?.[binding]}
                      disabled={!!busy}
                      change={(value) =>
                        setDraft((current) => {
                          const resources = { ...current.bindings.resources };
                          if (value) resources[binding] = value;
                          else delete resources[binding];
                          return { ...current, bindings: { ...current.bindings, resources } };
                        })
                      }
                    />
                  )}
                </div>
              ))}
              <h3>凭据引用 · 允许脚本读取</h3>
              {!ids.length && <p>未使用凭据。可在本地设置的凭据、AI 服务或应用与工具中管理。</p>}
              {credentialError && <p role="status">{credentialError}</p>}
              {ids.map((id) => (
                <Checkbox
                  checked={draft.bindings.credentials.includes(id)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      bindings: {
                        ...draft.bindings,
                        credentials: event.target.checked
                          ? [...draft.bindings.credentials, id]
                          : draft.bindings.credentials.filter((key) => key !== id),
                      },
                    })
                  }
                  className="flow-parameters-credential"
                  key={id}
                >
                  <span>
                    {credentialNames[id] ? `${credentialNames[id]} · ${id}` : id}
                    {!credentials.includes(id) ? ' · 凭据不可用' : ''}
                  </span>
                </Checkbox>
              ))}
              <div onKeyDown={activateCollapseWithSpace}>
                <Collapse
                  size="small"
                  items={[
                    {
                      key: 'binding-scope',
                      label: '本机绑定与凭据范围',
                      forceRender: true,
                      children: (
                        <p>
                          绑定只在本机保存，不随流程导出。勾选凭据后允许脚本读取对应凭据；这里只显示引用，不显示密钥。资源可用性在运行前重新核对。
                        </p>
                      ),
                    },
                  ]}
                />
              </div>
              <Alert
                type="info"
                showIcon
                title="删除被引用的参数会被阻止，并标出引用步骤或参数来源。"
                role="note"
              />
            </Card>
          </section>
        </fieldset>
      </ConfigProvider>
      {pending && (
        <Modal
          open
          width={640}
          centered
          closable={false}
          mask={{ closable: false }}
          keyboard={!busy}
          focusable={{ focusTriggerAfterClose: false }}
          className="flowark-leave-modal"
          aria-describedby="parameter-leave-description"
          aria-busy={!!busy}
          onCancel={stay}
          afterOpenChange={(open) => {
            if (open) (error ? dialogHeading.current : continueButton.current)?.focus();
          }}
          title={
            <Flex vertical gap={16} align="flex-start">
              <Tag
                color={error ? 'error' : 'warning'}
                variant="filled"
                className="flowark-leave-status"
                icon={<Badge status={error ? 'error' : 'warning'} />}
              >
                {error ? '未保存 · 留在当前页' : '存在未保存更改'}
              </Tag>
              <h2 ref={dialogHeading} tabIndex={-1}>
                {error ? '保存未完成，尚未离开' : '离开前保存更改？'}
              </h2>
            </Flex>
          }
          footer={
            <Flex gap={12} wrap className="flowark-leave-actions">
              <Button ref={continueButton} disabled={!!busy || undefined} onClick={stay}>
                继续编辑
              </Button>
              <Button
                color="danger"
                variant="filled"
                disabled={!!busy || undefined}
                onClick={() => close(pending.next)}
              >
                不保存离开
              </Button>
              <Button
                type="primary"
                loading={busy === 'save'}
                disabled={!!busy || undefined}
                onClick={() => void persist(true, pending.next)}
              >
                {busy === 'save' ? '正在保存…' : error ? '重试保存并离开' : '保存并离开'}
              </Button>
            </Flex>
          }
        >
          <p id="parameter-leave-description">
            当前参数与资源更改尚未保存。保存成功后前往“{pending.destination}
            ”；不保存只放弃本页更改。
          </p>
          <p className="flowark-leave-note">打开前的流程草稿、已开始的运行和固定计划保持原状。</p>
          {error && <Alert type="error" title="保存未完成" description={error} role="alert" />}
        </Modal>
      )}
    </section>
  );
}
