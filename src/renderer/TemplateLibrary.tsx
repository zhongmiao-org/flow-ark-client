import { useState, useEffect } from 'react';
import type { Bootstrap } from '../shared/types';
import { Field } from './TemplateConfiguration';
const api = (method: string, args: any = {}) => window.flowark.request(method, args);
export default function TemplateLibrary({
  data,
  action,
  initialPreview,
  consumePreview,
}: {
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  initialPreview?: any;
  consumePreview?: () => void;
}) {
  const [preview, setPreview] = useState<any>(initialPreview);
  useEffect(() => {
    if (initialPreview) consumePreview?.();
  }, [initialPreview, consumePreview]);
  const [detail, setDetail] = useState<any>();
  const [busy, setBusy] = useState(false);
  const work = async (fn: () => Promise<any>, message?: string) => {
    setBusy(true);
    try {
      return await action(() => {
        if (document.querySelector('.templates-page [data-value-invalid]'))
          throw new Error('请先修正未完成的字段值');
        return fn();
      }, message);
    } finally {
      setBusy(false);
    }
  };
  const edit = async (id: string) => {
    const d = await work(() => api('template.detail', { id }));
    if (d) setDetail(d);
  };
  const instance = detail?.instance;
  return (
    <section className="templates-page">
      <header className="section-header">
        <div>
          <h2>模板库</h2>
          <p>安装模板包，配置本地资源，再选择操作入口。</p>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            if (preview) await api('template.cancelImport', { token: preview.token });
            const p = await work(() => api('template.inspect'));
            if (p) setPreview(p);
          }}
        >
          导入模板包
        </button>
      </header>
      {preview && (
        <article className="template-card">
          <h3>安装预览：{preview.manifest.name}</h3>
          <p>{preview.manifest.description}</p>
          <p>
            版本 {preview.manifest.version} · 作者声明 {preview.manifest.author}
          </p>
          <p>来源声明：{preview.manifest.source}</p>
          <p>
            SDK {preview.manifest.sdkVersion} · 最低客户端 {preview.manifest.minimumClientVersion}
          </p>
          {preview.manifest.entries.map((e: any) => (
            <p key={e.id}>
              {e.name}：{e.capabilities.join('、')}；动作 {e.actions.join('、') || '无'}
            </p>
          ))}
          <small>模板可包含可信脚本。安装不会运行或授予动作权限。</small>
          <div className="actions">
            <button
              disabled={busy}
              onClick={async () => {
                await work(() => api('template.cancelImport', { token: preview.token }));
                setPreview(undefined);
              }}
            >
              取消
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                const p = await work(
                  () => api('template.install', { token: preview.token }),
                  '模板已安装',
                );
                if (p) setPreview(undefined);
              }}
            >
              安装模板
            </button>
          </div>
        </article>
      )}
      <div className="template-grid">
        {data.templates.map((p) => (
          <article className="template-card" key={p.key}>
            <span className="badge">v{p.manifest.version}</span>
            <h3>{p.manifest.name}</h3>
            <p>{p.manifest.description}</p>
            <small>{p.manifest.entries.length} 个操作入口</small>
            <div className="actions">
              <button
                disabled={busy}
                className="primary"
                onClick={async () => {
                  const i = await work(() => api('template.create', { key: p.key }));
                  if (i) await edit(i.id);
                }}
              >
                创建实例
              </button>
              <button
                disabled={busy}
                onClick={() => work(() => api('template.export', { key: p.key }))}
              >
                导出 ZIP
              </button>
              <button
                disabled={busy}
                onClick={() => work(() => api('template.remove', { key: p.key }))}
              >
                卸载
              </button>
            </div>
            {data.instances.some(
              (i) => i.packageKey.startsWith(p.manifest.id + '@') && i.packageKey !== p.key,
            ) && (
              <select
                aria-label="从旧实例复制普通配置"
                value=""
                onChange={async (e) => {
                  const i = await work(() =>
                    api('template.create', { key: p.key, copyFrom: e.target.value }),
                  );
                  if (i) await edit(i.id);
                }}
              >
                <option value="">采用此版本并复制旧配置…</option>
                {data.instances
                  .filter(
                    (i) => i.packageKey.startsWith(p.manifest.id + '@') && i.packageKey !== p.key,
                  )
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · {i.id.slice(0, 8)}
                    </option>
                  ))}
              </select>
            )}
          </article>
        ))}
      </div>
      {!data.templates.length && (
        <p className="empty">尚未安装模板。请选择标准 .flowark-template.zip 文件。</p>
      )}
      <h2>本地实例</h2>
      {data.instances.map((i) => (
        <button key={i.id} disabled={busy} onClick={() => edit(i.id)}>
          {i.name} · {i.id.slice(0, 8)}
        </button>
      ))}
      {instance && (
        <article className="template-card">
          <h3>{instance.name} · 实例配置</h3>
          <Field
            schema={detail.configurationSchema}
            value={instance.configuration}
            change={(value: any) =>
              setDetail({ ...detail, instance: { ...instance, configuration: value } })
            }
          />
          <h4>本地资源</h4>
          {detail.manifest.resources.map((r: any) => {
            const b = instance.resources[r.id] ?? {};
            const change = (v: any) =>
              setDetail({
                ...detail,
                instance: { ...instance, resources: { ...instance.resources, [r.id]: v } },
              });
            return (
              <div key={r.id} className="field">
                <label>
                  {r.name} · {r.access}
                  {r.required ? '（必需）' : '（可选）'}
                </label>
                {['file', 'directory'].includes(r.kind) ? (
                  <>
                    <input readOnly value={b.path ?? ''} aria-label={r.name} />
                    <button
                      onClick={async () => {
                        const path = await api('file.choose', { kind: r.kind });
                        if (path) change({ ...b, path });
                      }}
                    >
                      选择
                    </button>
                  </>
                ) : r.kind === 'browser' ? (
                  <>
                    <select
                      aria-label={r.name}
                      value={b.browserId ?? ''}
                      onChange={(e) => change({ browserId: e.target.value })}
                    >
                      <option value="">选择浏览器</option>
                      {data.browsers.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.product} {v.version}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => work(() => api('browser.embedded.enable'))}>
                      启用内置浏览器
                    </button>
                  </>
                ) : (
                  <>
                    <select
                      aria-label={r.name + '供应商'}
                      value={b.provider ?? ''}
                      onChange={(e) => change({ ...b, provider: e.target.value })}
                    >
                      <option value="">选择 AI</option>
                      {data.credentials.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={r.name + '模型'}
                      placeholder="模型 ID"
                      value={b.model ?? ''}
                      onChange={(e) => change({ ...b, model: e.target.value })}
                    />
                  </>
                )}
              </div>
            );
          })}
          <h4>动作授权</h4>
          {detail.manifest.actions.map((a: any) => (
            <label className="field" key={a.id}>
              {a.name}
              <small>{a.description}</small>
              <select
                aria-label={a.name + '授权'}
                value={instance.grants[a.id] ?? 'deny'}
                onChange={(e) =>
                  setDetail({
                    ...detail,
                    instance: {
                      ...instance,
                      grants: { ...instance.grants, [a.id]: e.target.value },
                    },
                  })
                }
              >
                <option value="deny">禁止</option>
                <option value="confirm">每次确认</option>
                <option value="auto">配置范围内自动</option>
              </select>
            </label>
          ))}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              work(
                () =>
                  api('template.configure', {
                    id: instance.id,
                    configuration: instance.configuration,
                    resources: instance.resources,
                    grants: instance.grants,
                  }),
                '实例配置已保存',
              )
            }
          >
            保存实例配置
          </button>
          <h4>操作入口</h4>
          <p>运行使用已保存配置；运行中编辑不会改变当前任务。</p>
          {detail.entries.map((e: any) => (
            <div className="field" key={e.id}>
              <b>{e.name}</b>
              <Field
                schema={e.input}
                value={e.values}
                change={(values: any) =>
                  setDetail({
                    ...detail,
                    entries: detail.entries.map((v: any) => (v.id === e.id ? { ...v, values } : v)),
                  })
                }
              />
              <button
                disabled={busy}
                onClick={() =>
                  work(
                    () =>
                      api('template.input', { id: instance.id, entryId: e.id, value: e.values }),
                    '入口参数已保存',
                  )
                }
              >
                保存入口参数
              </button>
              <small>
                {e.unavailable.length
                  ? '缺少能力：' + e.unavailable.join('、')
                  : e.schedulable
                    ? '支持在流程的定时计划中配置'
                    : '仅手动执行'}
              </small>
              <button
                disabled={busy || !!e.unavailable.length}
                onClick={() =>
                  work(() => api('flow.run', { id: instance.entryFlows[e.id] }), '任务已创建')
                }
              >
                运行 {e.name}
              </button>
            </div>
          ))}
        </article>
      )}
    </section>
  );
}
