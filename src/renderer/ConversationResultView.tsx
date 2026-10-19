import TechnicalDetails from './TechnicalDetails';
import { Card, Collapse, Tag } from 'antd';
import type { ConversationThreadOutput } from '../shared/conversation-thread';
import type { ConversationOutput } from '../shared/conversation';
export default function ConversationResultView({
  value,
}: {
  value: ConversationOutput | ConversationThreadOutput;
}) {
  return (
    <section className="skill-version" aria-label="固定会话来源结果">
      <Tag>{value.status === 'confirmed' ? '已确认来源' : '会话尚未确认，历史暂不可采用'}</Tag>
      <div className="skill-grid">
        <Card title="本次固定会话">
          <p>本次已保存的会话来源</p>
          <p>
            修订 {value.revision} · 序号 {value.sequence}
          </p>
          <TechnicalDetails
            items={[
              { label: '会话 ID', value: value.sessionId },
              { label: '来源摘要', value: value.evidence?.sha256 },
            ]}
          />
          <p>确认只固定本次会话，不确认 Skill，也不授予外发权限。</p>
        </Card>
        <Card title="查看完整引用结果">
          <Collapse
            items={[
              {
                key: 'source',
                label: '原始来源与完整引用（高级诊断）',
                children: <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>,
              },
            ]}
          />
        </Card>
      </div>
    </section>
  );
}
