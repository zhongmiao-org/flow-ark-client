import { Alert, Descriptions, Tag } from 'antd';
import type { BrowserScrollResult } from '../shared/contracts.generated';

export default function BrowserScrollResultView({ value }: { value: BrowserScrollResult }) {
  const pixels = (n: number) => `${Math.round(n * 100) / 100} 像素`;
  return (
    <section aria-label="网页区域滚动结果">
      <h3>本次滚动结果</h3>
      <Tag color={value.moved ? 'success' : 'default'}>
        {value.moved ? '已发生位移' : '位置未变化'}
      </Tag>
      {value.atStart && <Tag>已到区域顶部</Tag>}
      {value.atEnd && <Tag>已到区域底部</Tag>}
      <Descriptions
        column={1}
        items={[
          {
            key: 'direction',
            label: '配置范围',
            children: `${value.direction === 'down' ? '向下' : '向上'}，最多${pixels(value.distance)}`,
          },
          {
            key: 'region',
            label: '实际区域',
            children:
              value.region === 'document'
                ? '目标所在文档'
                : value.region === 'target'
                  ? '目标自身'
                  : `目标的第 ${value.ancestorDepth} 层祖先`,
          },
          {
            key: 'moved',
            label: '实际位移',
            children: pixels(Math.abs(value.offsetAfter - value.offsetBefore)),
          },
          {
            key: 'position',
            label: '前后位置',
            children: `${pixels(value.offsetBefore)} → ${pixels(value.offsetAfter)}`,
          },
          {
            key: 'height',
            label: '内容高度',
            children: `${pixels(value.heightBefore)} → ${pixels(value.heightAfter)}`,
          },
          {
            key: 'viewport',
            label: '可见高度',
            children: `${pixels(value.viewportBefore)} → ${pixels(value.viewportAfter)}`,
          },
        ]}
      />
      <Alert
        type="info"
        title="后续内容需要另行核对"
        description="此回执只记录本次实际位移和区域边界，不代表新增内容已加载或任务完成。到边界不会继续滚动父区域。"
      />
    </section>
  );
}
