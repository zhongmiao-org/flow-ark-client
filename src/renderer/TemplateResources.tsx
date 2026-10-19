import SkillPicker from './SkillPicker';
import SourcePicker from './SourcePicker';
import ResultSourcePicker from './ResultSourcePicker';
import { Card, Badge, Tag, ConfigProvider, Select, Button, Input } from 'antd';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Bootstrap } from '../shared/types';
import { equal, type TemplateDetail } from './template-draft';
import { patchResourceBinding } from './directory-binding-draft';
const api = (method: string, args: unknown = {}) => window.flowark.request(method, args);
export default function TemplateResources({
  detail,
  saved,
  data,
  busy,
  blocked,
  change,
  work,
  openAI,
  save,
  cancel,
  openEntry,
}: {
  detail: TemplateDetail;
  saved: TemplateDetail['instance'];
  data: Bootstrap;
  busy: boolean;
  blocked: boolean;
  change: Dispatch<SetStateAction<TemplateDetail>>;
  work: (fn: () => Promise<any>, notice?: string) => Promise<any>;
  openAI: (id: string, trigger: HTMLButtonElement) => void;
  save: (control: HTMLButtonElement) => void;
  cancel: () => void;
  openEntry: (id: string) => void;
}) {
  const { instance, manifest } = detail;
  const scopeId = useId();
  const chooseButtons = useRef(new Map<string, HTMLButtonElement>());
  const [choosing, setChoosing] = useState<string>();
  const [returnedChoice, setReturnedChoice] = useState<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (busy || !returnedChoice) return;
    setReturnedChoice(null);
    if (
      returnedChoice.isConnected &&
      !returnedChoice.disabled &&
      !returnedChoice.closest('[hidden]') &&
      returnedChoice.getClientRects().length &&
      (document.activeElement === document.body || document.activeElement === returnedChoice)
    ) {
      returnedChoice.focus();
      returnedChoice.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [busy, returnedChoice]);
  const patch = (
    id: string,
    binding: TemplateDetail['instance']['resources'][string] | undefined,
    mode: 'manual' | 'default' = 'manual',
  ) =>
    change((current) => {
      const { resources, directoryDraft } = patchResourceBinding(
        current.instance.resources,
        current.manifest.resources,
        current.directoryDraft,
        id,
        binding,
        mode,
      );
      return { ...current, directoryDraft, instance: { ...current.instance, resources } };
    });
  const grant = (id: string, mode: 'deny' | 'confirm' | 'auto') =>
    change((current) => ({
      ...current,
      instance: { ...current.instance, grants: { ...current.instance.grants, [id]: mode } },
    }));
  return (
    <div className="template-instance-columns template-resources-columns">
      <section>
        <Card className="template-instance-form" styles={{ body: { padding: 28 } }}>
          <h2 tabIndex={-1} data-navigation-heading>
            本机资源绑定
          </h2>
          <ConfigProvider componentDisabled={busy}>
            <fieldset disabled={busy} className="template-resource-fields">
              {manifest.resources.length === 0 && <p>此模板未声明本机资源。</p>}
              {manifest.resources.map((resource) => {
                const binding = instance.resources[resource.id] ?? {};
                const defaultSource = manifest.resources.find(
                  (source) => source.id === resource.defaultDirectoryFrom,
                );
                const derived = detail.directoryDraft?.derived[resource.id];
                const defaultHintId = `${scopeId}-${resource.id}-directory-default`;
                return (
                  <div
                    className={
                      'template-resource' +
                      (resource.kind === 'file' || resource.kind === 'directory'
                        ? ' template-resource-file'
                        : '') +
                      (defaultSource ? ' template-resource-default' : '')
                    }
                    key={resource.id}
                  >
                    <div className="ai-settings-field">
                      <span>
                        {resource.name} · {resource.kind} / {resource.access}
                        {resource.required ? '（必需）' : '（可选）'}
                      </span>
                      {resource.kind === 'run-result' ? (
                        <ResultSourcePicker
                          target={{ kind: 'instance', id: instance.id, revision: detail.revision }}
                          binding={resource.id}
                          value={instance.resources[resource.id]}
                          label={resource.name}
                          disabled={busy}
                          change={(value, choiceId) =>
                            change((current) => {
                              const resources = { ...current.instance.resources },
                                choices = { ...current.resultSourceChoices };
                              if (value) resources[resource.id] = value;
                              else delete resources[resource.id];
                              if (choiceId) choices[resource.id] = choiceId;
                              else delete choices[resource.id];
                              return {
                                ...current,
                                resultSourceChoices: choices,
                                instance: { ...current.instance, resources },
                              };
                            })
                          }
                        />
                      ) : resource.kind === 'conversation-source' ? (
                        <SourcePicker
                          target={{ kind: 'instance', id: instance.id, revision: detail.revision }}
                          binding={resource.id}
                          value={binding}
                          disabled={busy}
                          label={resource.name}
                          change={(value) => patch(resource.id, value)}
                        />
                      ) : resource.kind === 'skill' ? (
                        <SkillPicker
                          key={instance.id + ':' + resource.id}
                          value={binding}
                          disabled={busy}
                          label={resource.name}
                          change={(value) => patch(resource.id, value)}
                        />
                      ) : resource.kind === 'file' || resource.kind === 'directory' ? (
                        <Input
                          aria-label={resource.name}
                          aria-describedby={defaultSource ? defaultHintId : undefined}
                          readOnly
                          value={binding.path ?? ''}
                          placeholder="尚未绑定"
                        />
                      ) : resource.kind === 'browser' ? (
                        <Select<string>
                          aria-label={resource.name}
                          value={binding.browserId ?? ''}
                          onChange={(value) =>
                            patch(resource.id, value ? { browserId: value } : undefined)
                          }
                          options={[
                            { value: '', label: '选择浏览器' },
                            ...(binding.browserId &&
                            !data.browsers.some((browser) => browser.id === binding.browserId)
                              ? [
                                  {
                                    value: binding.browserId,
                                    label: '原浏览器不在本机清单，请重新选择',
                                  },
                                ]
                              : []),
                            ...data.browsers.map((browser) => ({
                              value: browser.id,
                              label: (
                                <>
                                  {browser.product === 'embedded' ? '内置浏览器' : browser.product}{' '}
                                  {browser.version}
                                </>
                              ),
                            })),
                          ]}
                        />
                      ) : (
                        <Select<string>
                          aria-label={resource.name + '供应商'}
                          value={binding.provider ?? ''}
                          onChange={(value) =>
                            patch(
                              resource.id,
                              value
                                ? {
                                    provider: value as 'deepseek' | 'openai-codex',
                                    model: '',
                                  }
                                : undefined,
                            )
                          }
                          options={[
                            { value: '', label: '选择 AI' },
                            { value: 'deepseek', label: 'DeepSeek' },
                            { value: 'openai-codex', label: 'OpenAI' },
                          ]}
                        />
                      )}
                    </div>
                    {resource.kind === 'skill' ||
                    resource.kind === 'conversation-source' ||
                    resource.kind === 'run-result' ? null : resource.kind === 'file' ||
                      resource.kind === 'directory' ? (
                      <>
                        <div className="template-resource-file-actions">
                          <Button
                            ref={(element) => {
                              if (element instanceof HTMLButtonElement)
                                chooseButtons.current.set(resource.id, element);
                              else chooseButtons.current.delete(resource.id);
                            }}
                            aria-label={`选择${resource.kind === 'file' ? '文件' : '目录'}：${resource.name}`}
                            onClick={() =>
                              void work(async () => {
                                setChoosing(resource.id);
                                try {
                                  const path = await api('file.choose', { kind: resource.kind });
                                  if (path) patch(resource.id, { path });
                                  setReturnedChoice(chooseButtons.current.get(resource.id) ?? null);
                                  return true;
                                } finally {
                                  setChoosing(undefined);
                                }
                              })
                            }
                          >
                            {choosing === resource.id
                              ? '等待选择…'
                              : resource.kind === 'file'
                                ? '选择文件'
                                : '选择目录'}
                          </Button>
                          {binding.path && (
                            <Button
                              aria-label={`清除${resource.name}绑定`}
                              onClick={() => {
                                patch(resource.id, undefined);
                                chooseButtons.current.get(resource.id)?.focus();
                              }}
                            >
                              清除绑定
                            </Button>
                          )}
                          {defaultSource && (
                            <Button
                              disabled={busy || !instance.resources[defaultSource.id]?.path}
                              aria-label={`使用${defaultSource.name}作为${resource.name}`}
                              aria-describedby={defaultHintId}
                              onClick={() => patch(resource.id, undefined, 'default')}
                            >
                              使用来源目录
                            </Button>
                          )}
                        </div>
                        {defaultSource && (
                          <p
                            id={defaultHintId}
                            className="template-directory-default-note"
                            role="status"
                          >
                            {derived && binding.path === derived.path
                              ? `本次默认使用“${defaultSource.name}”，尚未保存；可另选或清除。`
                              : detail.directoryDraft?.manual.includes(resource.id)
                                ? `已手动${binding.path ? '设置' : '清除'}；本次不自动跟随“${defaultSource.name}”。`
                                : `默认可使用“${defaultSource.name}”；已有保存值不随来源改变。`}
                            {!instance.resources[defaultSource.id]?.path &&
                              ` 请先选择“${defaultSource.name}”。`}
                          </p>
                        )}
                        {!binding.path && saved.resources[resource.id]?.path && (
                          <p className="template-resource-cleared" role="status">
                            已清除草稿绑定，保存授权后生效。
                          </p>
                        )}
                      </>
                    ) : resource.kind === 'browser' ? (
                      !data.browsers.some((browser) => browser.product === 'embedded') && (
                        <Button onClick={() => void work(() => api('browser.embedded.enable'))}>
                          启用内置浏览器
                        </Button>
                      )
                    ) : (
                      <>
                        <label className="ai-settings-field">
                          模型 ID
                          <Input
                            aria-label={resource.name + '模型'}
                            value={binding.model ?? ''}
                            onChange={(event) =>
                              patch(resource.id, { ...binding, model: event.target.value })
                            }
                          />
                        </label>
                        <p>切换供应商后，请重新填写该供应商的模型 ID；保存后才更新实例绑定。</p>
                        <Button
                          onClick={(event) =>
                            openAI(resource.id, event.currentTarget as HTMLButtonElement)
                          }
                        >
                          管理 AI 配置
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </fieldset>
          </ConfigProvider>
          <h2>动作权限</h2>
          {manifest.actions.length === 0 && <p>此模板未声明需要授权的动作。</p>}
          {manifest.actions.map((action) => (
            <div className="template-action-grant" key={action.id}>
              <strong>{action.name}</strong>
              <p id={`${scopeId}-${action.id}-description`}>{action.description}</p>
              <label className="ai-settings-field">
                允许范围
                <Select<string>
                  aria-label={action.name + '授权'}
                  aria-describedby={`${scopeId}-${action.id}-description`}
                  disabled={busy || undefined}
                  value={instance.grants[action.id] ?? 'deny'}
                  onChange={(value) => grant(action.id, value as 'deny' | 'confirm' | 'auto')}
                  options={[
                    { value: 'deny', label: '禁止' },
                    { value: 'confirm', label: '每次确认' },
                    { value: 'auto', label: '配置范围内自动' },
                  ]}
                />
              </label>
              <div
                className="template-grant-options"
                role="group"
                aria-label={action.name + '权限模式'}
                aria-describedby={`${scopeId}-${action.id}-description`}
              >
                {(
                  [
                    ['deny', '禁止'],
                    ['confirm', '每次确认'],
                    ['auto', '配置范围内自动'],
                  ] as const
                ).map(([mode, label]) => (
                  <Button
                    type={(instance.grants[action.id] ?? 'deny') === mode ? 'primary' : 'default'}
                    key={mode}
                    disabled={busy || undefined}
                    aria-pressed={(instance.grants[action.id] ?? 'deny') === mode}
                    onClick={() => grant(action.id, mode)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          <p>默认为禁止。选择目录只建立资源绑定，不等于授权写入。</p>
          <div className="ai-task-actions template-resource-actions">
            <Button
              type="primary"
              disabled={blocked || undefined}
              onClick={(event) => save(event.currentTarget as HTMLButtonElement)}
            >
              保存授权
            </Button>
            <Button disabled={busy || undefined} onClick={cancel}>
              取消
            </Button>
          </div>
        </Card>
      </section>
      <aside>
        <Card className="template-instance-guide">
          <h2>按入口检查</h2>
          {detail.entries.map((entry) => {
            const missing = entry.resources.filter((id) => {
              const declaration = manifest.resources.find((item) => item.id === id)!;
              const binding = instance.resources[id];
              if (!binding) return declaration.required;
              return declaration.kind === 'ai'
                ? !binding.provider ||
                    !binding.model ||
                    !data.credentials.includes(binding.provider)
                : declaration.kind === 'browser'
                  ? !data.browsers.some((browser) => browser.id === binding.browserId)
                  : declaration.kind === 'skill'
                    ? !binding.path || !binding.skill
                    : declaration.kind === 'conversation-source'
                      ? !binding.source
                      : declaration.kind === 'run-result'
                        ? !binding.result
                        : !binding.path;
            });
            const denied = entry.actions.filter(
              (id) => !instance.grants[id] || instance.grants[id] === 'deny',
            );
            const incomplete = missing.length || denied.length || entry.unavailable.length;
            const pending =
              entry.resources.some((id) => !equal(instance.resources[id], saved.resources[id])) ||
              entry.actions.some(
                (id) => (instance.grants[id] ?? 'deny') !== (saved.grants[id] ?? 'deny'),
              );
            return (
              <section
                className="template-entry-check"
                key={entry.id}
                aria-label={`${entry.name}资源检查`}
              >
                <Tag
                  role="status"
                  className="run-state-tag"
                  variant="filled"
                  color={pending || incomplete ? 'warning' : 'default'}
                  icon={<Badge status={pending || incomplete ? 'warning' : 'default'} />}
                >
                  {entry.name} ·{' '}
                  {pending ? '待保存' : incomplete ? '尚未就绪' : '已填写 · 运行前复核'}
                </Tag>
                {pending && <p>资源或权限修改尚未保存。核对范围后点击保存授权。</p>}
                {entry.unavailable.length > 0 && <p>缺少能力：{entry.unavailable.join('、')}</p>}
                {denied.length > 0 && (
                  <p>
                    动作仍为禁止：
                    {denied
                      .map((id) => manifest.actions.find((item) => item.id === id)!.name)
                      .join('、')}
                  </p>
                )}
                {missing.length > 0 && (
                  <p>
                    待配置：
                    {missing
                      .map((id) => manifest.resources.find((item) => item.id === id)!.name)
                      .join('、')}
                  </p>
                )}
                {!pending && !incomplete && (
                  <p>只核对当前入口所需的资源与动作；保存不会自动运行。</p>
                )}
                <Button disabled={busy || undefined} onClick={() => openEntry(entry.id)}>
                  打开 {entry.name}
                </Button>
              </section>
            );
          })}
        </Card>
      </aside>
    </div>
  );
}
