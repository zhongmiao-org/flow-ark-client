import type { TemplateEntryOrigin } from './template-entry-navigation';
import { useState, useEffect, type MutableRefObject } from 'react';
import type { Bootstrap } from '../shared/types';
import type { AISettingsEntry } from './AISettingsPage';
import type { TemplateDetail } from './template-draft';
import TemplateInstancePage, { type TemplateNavigation } from './TemplateInstancePage';
const api = (method: string, args: any = {}) => window.flowark.request(method, args);
export default function TemplateLibrary({
  data,
  action,
  initialPreview,
  consumePreview,
  active,
  settings,
  navigation,
  showRun,
  schedule,
}: {
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  showRun: (detail: any, origin: TemplateEntryOrigin, output?: boolean) => void;
  schedule: (origin: TemplateEntryOrigin) => void;
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  initialPreview?: any;
  consumePreview?: () => void;
  active: boolean;
  settings: (entry: AISettingsEntry) => void;
}) {
  const [preview, setPreview] = useState<any>(initialPreview);
  useEffect(() => {
    if (initialPreview) {
      setPreview(initialPreview);
      setDetail(undefined);
      consumePreview?.();
    }
  }, [initialPreview, consumePreview]);
  const [detail, setDetail] = useState<TemplateDetail>();
  const [busy, setBusy] = useState(false);
  const work = async (fn: () => Promise<any>, message?: string) => {
    setBusy(true);
    try {
      return await action(fn, message);
    } finally {
      setBusy(false);
    }
  };
  const edit = async (id: string) => {
    const d = await work(() => api('template.detail', { id }));
    if (d) {
      setDetail(d);
    }
  };
  if (detail)
    return (
      <TemplateInstancePage
        key={detail.instance.id}
        initial={detail}
        active={active}
        data={data}
        action={action}
        navigation={navigation}
        showRun={showRun}
        schedule={schedule}
        settings={settings}
        close={() => setDetail(undefined)}
        choose={(id) => void edit(id)}
      />
    );
  navigation.current = (next) => next();
  return (
    <>
      <header className="topbar">
        <nav className="breadcrumbs" aria-label="当前位置">
          <span aria-current="page">模板库</span>
        </nav>
      </header>
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
      </section>
    </>
  );
}
