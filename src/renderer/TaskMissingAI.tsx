import { Badge, Button, Collapse, Tag } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import type { PlanningContext } from '../shared/planning';

const contextKinds: Record<PlanningContext['kind'], string> = {
  text: '文字资料',
  web: '网页',
  file: '文件',
  image: '图片',
  application: '应用窗口',
  mcp: '工具',
};

export default function TaskMissingAI({
  providerName,
  configured,
  description,
  context,
  busy,
  configure,
  manual,
}: {
  providerName: string;
  configured: boolean;
  description: string;
  context: PlanningContext[];
  busy: boolean;
  configure: () => void;
  manual: () => void;
}) {
  return (
    <section
      className="ai-task-card ai-missing-card"
      aria-label="配置 AI 后继续任务"
      aria-busy={busy}
    >
      <Tag
        className="run-state-tag"
        variant="filled"
        color={configured ? 'default' : 'warning'}
        icon={<Badge status={configured ? 'default' : 'warning'} />}
      >
        {providerName} · {configured ? '已配置 · 使用前核对' : '未配置'}
      </Tag>
      <h2>配置一次，就能继续规划任务</h2>
      <p>在本地设置中填写 Key 与模型并测试连接。返回时继续本次任务，不需要重新描述。</p>
      <article className="ai-missing-draft" aria-labelledby="missing-draft-title">
        <h3 id="missing-draft-title">当前草稿</h3>
        <p tabIndex={0} className="ai-missing-description" aria-label="完整任务需求">
          {description || '尚未填写需求'}
        </p>
        {!!context.length && (
          <Collapse
            className="ai-missing-context"
            items={[
              {
                key: 'context',
                label: `已保留 ${context.length} 项任务资料`,
                forceRender: true,
                onKeyDown: activateCollapseWithSpace,
                children: (
                  <div className="feedback-body">
                    <ul tabIndex={0} aria-label="已保留的任务资料">
                      {context.map((item) => (
                        <li key={item.id}>
                          <span>{contextKinds[item.kind]}</span>
                          <strong>{item.label}</strong>
                        </li>
                      ))}
                    </ul>
                    <p>这里仅列出草稿中的资料；配置或测试 AI 服务不会发送这些内容。</p>
                  </div>
                ),
              },
            ]}
          />
        )}
      </article>
      <div className="ai-task-actions">
        <Button type="primary" disabled={busy || undefined} onClick={configure}>
          去配置 AI 服务
        </Button>
        <Button disabled={busy || undefined} onClick={manual}>
          {busy ? '正在准备…' : '先手动搭建'}
        </Button>
      </div>
    </section>
  );
}
