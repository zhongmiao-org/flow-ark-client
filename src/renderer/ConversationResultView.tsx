import { Card, Collapse, Tag } from 'antd';
import type { ConversationOutput } from '../shared/conversation';
export default function ConversationResultView({ value }: { value: ConversationOutput }) {
  return (
    <section className="skill-version" aria-label="固定会话来源结果">
      <Tag>{value.status === 'confirmed' ? '已确认来源' : '会话尚未确认，历史暂不可采用'}</Tag>
      <div className="skill-grid">
        <Card title="本次固定会话">
          <p>会话：{value.sessionId}</p>
          <p>
            修订 {value.revision} · 序号 {value.sequence}
          </p>
          {value.evidence && <p className="path-text">来源摘要：{value.evidence.sha256}</p>}
          <p>确认只固定本次会话，不确认 Skill，也不授予外发权限。</p>
        </Card>
        <Card title="查看完整引用结果">
          <Collapse
            items={[
              {
                key: 'source',
                label: '来源与完整历史',
                children: <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>,
              },
            ]}
          />
        </Card>
      </div>
    </section>
  );
}
