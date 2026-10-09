import { useState } from 'react';
import type { InstalledPackage } from '../templates/archive';
export type TemplateManifest = InstalledPackage['manifest'];
export const capabilityLabel = (name: string) =>
  (
    ({
      browser: '网页操作',
      'browser-frames-v1': '网页框架',
      'browser-forms-v1': '网页表单',
      file: '文件操作',
      'file-create-v1': '创建文件',
      'file-create-numbered-v1': '同名文件编号',
      excel: '工作簿',
      'excel-mapping-v1': '表格映射',
      script: 'JS / TS 脚本',
      http: '网络请求',
      ai: 'AI 服务',
      deepseek: 'DeepSeek',
      'openai-codex': 'OpenAI',
      human: '人工处理',
      'human-review-v1': '目标与内容核对',
      condition: '条件判断',
      loop: '串行循环',
      value: '数据赋值',
      assert: '结果核对',
      state: '实例状态读写',
      effect: '动作去重与回执',
      'template-sdk-v1': '模板 SDK',
    }) as Record<string, string>
  )[name] ?? name;
const resourceKind = { file: '文件', directory: '目录', browser: '浏览器', ai: 'AI 服务' };
const accessLabel = { read: '读取', write: '写入', readwrite: '读写', use: '使用' };
export default function TemplateManifestOverview({
  manifest,
  checked = false,
}: {
  manifest: TemplateManifest;
  checked?: boolean;
}) {
  const [entryId, setEntryId] = useState(manifest.entries[0]?.id ?? '');
  const entry = manifest.entries.find((e) => e.id === entryId) ?? manifest.entries[0];
  return (
    <section className="template-catalog-card template-manifest">
      <span className={`template-catalog-status${checked ? ' success' : ''}`}>
        {checked ? '格式与内容摘要校验通过' : '本机已安装'}
      </span>
      <h2>{manifest.name}</h2>
      <p>{manifest.description}</p>
      <p className="template-catalog-muted">
        版本 {manifest.version} · SDK {manifest.sdkVersion} · 最低客户端{' '}
        {manifest.minimumClientVersion}
      </p>
      <dl className="template-catalog-facts">
        <div>
          <dt>作者声明</dt>
          <dd>{manifest.author}</dd>
        </div>
        <div>
          <dt>来源声明</dt>
          <dd>{manifest.source}</dd>
        </div>
      </dl>
      <p className="template-catalog-muted">作者和来源由包提供，不代表签名认证。</p>
      <h3>操作入口与要求</h3>
      <div className="template-entry-choices" role="group" aria-label="查看入口要求">
        {manifest.entries.map((e) => (
          <button key={e.id} aria-pressed={entry?.id === e.id} onClick={() => setEntryId(e.id)}>
            <strong>{e.name}</strong>
            <span>{e.capabilities.map(capabilityLabel).join(' · ') || '无额外能力声明'}</span>
            <small>
              {e.actions.length ? `${e.actions.length} 项动作待授权` : '未声明写入动作'} ·{' '}
              {e.schedulable ? '可创建本机计划' : '手动运行'}
            </small>
          </button>
        ))}
      </div>
      {entry && (
        <div className="template-entry-requirements" aria-live="polite">
          <h3>{entry.name} · 本机资源</h3>
          {entry.resources.length ? (
            <ul>
              {entry.resources.map((id) => {
                const r = manifest.resources.find((r) => r.id === id);
                return (
                  <li key={id}>
                    <strong>{r?.name ?? id}</strong>
                    <span>
                      {r
                        ? `${resourceKind[r.kind]} · ${accessLabel[r.access]} · ${r.required ? '必需' : '可选'}`
                        : id}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>该入口未声明本机资源。</p>
          )}
          <h3>动作授权</h3>
          {entry.actions.length ? (
            <ul>
              {entry.actions.map((id) => {
                const a = manifest.actions.find((a) => a.id === id);
                return (
                  <li key={id}>
                    <strong>{a?.name ?? id}</strong>
                    <span>{a?.description}</span>
                    <small>新实例默认禁止；需在资源与动作授权中配置。</small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>该入口未声明需授权动作；实际行为仍以模板定义和运行检查为准。</p>
          )}
        </div>
      )}
      <details className="template-manifest-details">
        <summary>包内容与身份</summary>
        <dl className="template-catalog-facts">
          <div>
            <dt>模板 ID</dt>
            <dd>{manifest.id}</dd>
          </div>
          <div>
            <dt>内容摘要</dt>
            <dd>{manifest.contentDigest}</dd>
          </div>
          <div>
            <dt>包内容</dt>
            <dd>
              {manifest.files.length} 个文件 · {manifest.scripts.length} 个脚本
            </dd>
          </div>
        </dl>
        {manifest.dependencies.length > 0 && (
          <>
            <h3>依赖声明</h3>
            <ul>
              {manifest.dependencies.map((d) => (
                <li key={`${d.name}@${d.version}`}>
                  {d.name} · {d.version} · {d.license}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}
