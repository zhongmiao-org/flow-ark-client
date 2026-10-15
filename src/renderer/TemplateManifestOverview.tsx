import { Badge, Card, Button, Collapse, Descriptions, Tag } from 'antd';
import { useState } from 'react';
import { activateCollapseWithSpace } from './collapseKeyboard';
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
      'ai-node-v1': '结构化 AI v1',
      conversation: '引导会话',
      'conversation-v1': '持久会话 v1',
      'conversation-evidence-v1': '已确认会话来源',
      skill: '个人 Skill',
      'skill-v1': 'Skill 确认版本 v1',
      'skill-trial-v1': '草稿内部试聊',
      document: '资料解析',
      'document-extract-v1': '可追溯资料解析 v1',
      deepseek: 'DeepSeek',
      'openai-codex': 'OpenAI',
      human: '人工处理',
      'human-review-v1': '目标与内容核对',
      condition: '条件判断',
      loop: '串行循环',
      value: '数据赋值',
      assert: '结果核对',
      state: '实例状态读写',
      context: '配置与状态',
      'template-data-v1': '配置与状态 v1',
      effect: '动作去重与回执',
      'template-sdk-v1': '模板 SDK',
    }) as Record<string, string>
  )[name] ?? name;
const resourceKind = {
  skill: '确认Skill',
  file: '文件',
  directory: '目录',
  browser: '浏览器',
  ai: 'AI 服务',
};
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
    <section className="template-manifest">
      <Card className="template-catalog-card">
        <Tag
          className="run-state-tag"
          variant="filled"
          color={checked ? 'success' : 'default'}
          icon={<Badge status={checked ? 'success' : 'default'} />}
        >
          {checked ? '格式与内容摘要校验通过' : '本机已安装'}
        </Tag>
        <h2>{manifest.name}</h2>
        <p>{manifest.description}</p>
        <p className="template-catalog-muted">
          版本 {manifest.version} · SDK {manifest.sdkVersion} · 最低客户端{' '}
          {manifest.minimumClientVersion}
        </p>
        <Descriptions
          className="template-catalog-facts"
          layout="vertical"
          column={1}
          size="small"
          items={[
            { key: 'author', label: '作者声明', children: manifest.author },
            { key: 'source', label: '来源声明', children: manifest.source },
          ]}
        />
        <p className="template-catalog-muted">作者和来源由包提供，不代表签名认证。</p>
        <h3>操作入口与要求</h3>
        <div className="template-entry-choices" role="group" aria-label="查看入口要求">
          {manifest.entries.map((e) => (
            <Button key={e.id} aria-pressed={entry?.id === e.id} onClick={() => setEntryId(e.id)}>
              <strong>{e.name}</strong>
              <span>{e.capabilities.map(capabilityLabel).join(' · ') || '无额外能力声明'}</span>
              <small>
                {e.actions.length ? `${e.actions.length} 项动作待授权` : '未声明写入动作'} ·{' '}
                {e.schedulable ? '可创建本机计划' : '手动运行'}
              </small>
            </Button>
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
        <Collapse
          className="template-manifest-details"
          size="small"
          items={[
            {
              key: 'identity',
              label: '包内容与身份',
              forceRender: true,
              onKeyDown: activateCollapseWithSpace,
              children: (
                <>
                  <Descriptions
                    className="template-catalog-facts"
                    layout="vertical"
                    column={1}
                    size="small"
                    items={[
                      { key: 'id', label: '模板 ID', children: manifest.id },
                      { key: 'digest', label: '内容摘要', children: manifest.contentDigest },
                      {
                        key: 'files',
                        label: '包内容',
                        children: `${manifest.files.length} 个文件 · ${manifest.scripts.length} 个脚本`,
                      },
                    ]}
                  />
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
                </>
              ),
            },
          ]}
        />
      </Card>
    </section>
  );
}
