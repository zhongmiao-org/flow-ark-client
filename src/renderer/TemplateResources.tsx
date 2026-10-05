import { useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Bootstrap } from '../shared/types';
import { equal, type TemplateDetail } from './template-draft';
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
  save: () => void;
  cancel: () => void;
  openEntry: (id: string) => void;
}) {
  const { instance, manifest } = detail;
  const scopeId = useId();
  const chooseButtons = useRef(new Map<string, HTMLButtonElement>());
  const [choosing, setChoosing] = useState<string>();
  const patch = (
    id: string,
    binding: TemplateDetail['instance']['resources'][string] | undefined,
  ) =>
    change((current) => {
      const resources = { ...current.instance.resources };
      if (binding) resources[id] = binding;
      else delete resources[id];
      return { ...current, instance: { ...current.instance, resources } };
    });
  const grant = (id: string, mode: 'deny' | 'confirm' | 'auto') =>
    change((current) => ({
      ...current,
      instance: { ...current.instance, grants: { ...current.instance.grants, [id]: mode } },
    }));
  return (
    <div className="template-instance-columns template-resources-columns">
      <section className="ai-task-card template-instance-form">
        <h2>本机资源绑定</h2>
        <fieldset disabled={busy} className="template-resource-fields">
          {manifest.resources.length === 0 && <p>此模板未声明本机资源。</p>}
          {manifest.resources.map((resource) => {
            const binding = instance.resources[resource.id] ?? {};
            return (
              <div
                className={
                  'template-resource' +
                  (resource.kind === 'file' || resource.kind === 'directory'
                    ? ' template-resource-file'
                    : '')
                }
                key={resource.id}
              >
                <label className="ai-settings-field">
                  <span>
                    {resource.name} · {resource.kind} / {resource.access}
                    {resource.required ? '（必需）' : '（可选）'}
                  </span>
                  {resource.kind === 'file' || resource.kind === 'directory' ? (
                    <input
                      aria-label={resource.name}
                      readOnly
                      value={binding.path ?? ''}
                      placeholder="尚未绑定"
                    />
                  ) : resource.kind === 'browser' ? (
                    <select
                      aria-label={resource.name}
                      value={binding.browserId ?? ''}
                      onChange={(event) =>
                        patch(
                          resource.id,
                          event.target.value ? { browserId: event.target.value } : undefined,
                        )
                      }
                    >
                      <option value="">选择浏览器</option>
                      {binding.browserId &&
                        !data.browsers.some((browser) => browser.id === binding.browserId) && (
                          <option value={binding.browserId}>
                            原绑定（不在本机清单）：{binding.browserId}
                          </option>
                        )}
                      {data.browsers.map((browser) => (
                        <option key={browser.id} value={browser.id}>
                          {browser.product === 'embedded' ? '内置浏览器' : browser.product}{' '}
                          {browser.version}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      aria-label={resource.name + '供应商'}
                      value={binding.provider ?? ''}
                      onChange={(event) =>
                        patch(
                          resource.id,
                          event.target.value
                            ? {
                                provider: event.target.value as 'deepseek' | 'openai-codex',
                                model: '',
                              }
                            : undefined,
                        )
                      }
                    >
                      <option value="">选择 AI</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="openai-codex">OpenAI</option>
                    </select>
                  )}
                </label>
                {resource.kind === 'file' || resource.kind === 'directory' ? (
                  <>
                    <div className="template-resource-file-actions">
                      <button
                        ref={(element) => {
                          if (element) chooseButtons.current.set(resource.id, element);
                          else chooseButtons.current.delete(resource.id);
                        }}
                        aria-label={`选择${resource.name}${resource.kind === 'file' ? '文件' : '目录'}`}
                        onClick={() =>
                          void work(async () => {
                            setChoosing(resource.id);
                            try {
                              const path = await api('file.choose', { kind: resource.kind });
                              if (path) patch(resource.id, { path });
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
                      </button>
                      {binding.path && (
                        <button
                          aria-label={`清除${resource.name}绑定`}
                          onClick={() => {
                            patch(resource.id, undefined);
                            chooseButtons.current.get(resource.id)?.focus();
                          }}
                        >
                          清除绑定
                        </button>
                      )}
                    </div>
                    {!binding.path && saved.resources[resource.id]?.path && (
                      <p className="template-resource-cleared" role="status">
                        已清除草稿绑定，保存授权后生效。
                      </p>
                    )}
                  </>
                ) : resource.kind === 'browser' ? (
                  !data.browsers.some((browser) => browser.product === 'embedded') && (
                    <button onClick={() => void work(() => api('browser.embedded.enable'))}>
                      启用内置浏览器
                    </button>
                  )
                ) : (
                  <>
                    <label className="ai-settings-field">
                      模型 ID
                      <input
                        aria-label={resource.name + '模型'}
                        value={binding.model ?? ''}
                        onChange={(event) =>
                          patch(resource.id, { ...binding, model: event.target.value })
                        }
                      />
                    </label>
                    <p>切换供应商后，请重新填写该供应商的模型 ID；保存后才更新实例绑定。</p>
                    <button onClick={(event) => openAI(resource.id, event.currentTarget)}>
                      管理 AI 配置
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </fieldset>
        <h2>动作权限</h2>
        {manifest.actions.length === 0 && <p>此模板未声明需要授权的动作。</p>}
        {manifest.actions.map((action) => (
          <div className="template-action-grant" key={action.id}>
            <strong>{action.name}</strong>
            <p id={`${scopeId}-${action.id}-description`}>{action.description}</p>
            <label className="ai-settings-field">
              允许范围
              <select
                aria-label={action.name + '授权'}
                aria-describedby={`${scopeId}-${action.id}-description`}
                disabled={busy}
                value={instance.grants[action.id] ?? 'deny'}
                onChange={(event) =>
                  grant(action.id, event.target.value as 'deny' | 'confirm' | 'auto')
                }
              >
                <option value="deny">禁止</option>
                <option value="confirm">每次确认</option>
                <option value="auto">配置范围内自动</option>
              </select>
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
                <button
                  key={mode}
                  disabled={busy}
                  className={(instance.grants[action.id] ?? 'deny') === mode ? 'primary' : ''}
                  aria-pressed={(instance.grants[action.id] ?? 'deny') === mode}
                  onClick={() => grant(action.id, mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p>默认为禁止。选择目录只建立资源绑定，不等于授权写入。</p>
        <div className="ai-task-actions template-resource-actions">
          <button className="primary" disabled={blocked} onClick={save}>
            保存授权
          </button>
          <button disabled={busy} onClick={cancel}>
            取消
          </button>
        </div>
      </section>
      <aside className="ai-task-card template-instance-guide">
        <h2>按入口检查</h2>
        {detail.entries.map((entry) => {
          const missing = entry.resources.filter((id) => {
            const declaration = manifest.resources.find((item) => item.id === id)!;
            const binding = instance.resources[id];
            if (!binding) return declaration.required;
            return declaration.kind === 'ai'
              ? !binding.provider || !binding.model || !data.credentials.includes(binding.provider)
              : declaration.kind === 'browser'
                ? !data.browsers.some((browser) => browser.id === binding.browserId)
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
              <span
                role="status"
                className={'ai-config-status ' + (pending || incomplete ? 'warning' : 'neutral')}
              >
                {entry.name} ·{' '}
                {pending ? '待保存' : incomplete ? '尚未就绪' : '已填写 · 运行前复核'}
              </span>
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
              {!pending && !incomplete && <p>只核对当前入口所需的资源与动作；保存不会自动运行。</p>}
              <button disabled={busy} onClick={() => openEntry(entry.id)}>
                打开 {entry.name}
              </button>
            </section>
          );
        })}
      </aside>
    </div>
  );
}
