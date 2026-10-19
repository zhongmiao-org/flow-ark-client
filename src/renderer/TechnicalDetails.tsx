import { Collapse, Descriptions, Typography } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';

/** Exact identifiers are available on demand, outside the ordinary task narrative. */
export default function TechnicalDetails({
  items,
}: {
  items: { label: string; value: string | undefined | null }[];
}) {
  const available = items.filter((item) => item.value);
  if (!available.length) return null;
  return (
    <Collapse
      size="small"
      items={[
        {
          key: 'technical',
          label: '技术标识（高级诊断）',
          onKeyDown: activateCollapseWithSpace,
          children: (
            <Descriptions
              column={1}
              size="small"
              items={available.map((item, index) => ({
                key: index,
                label: item.label,
                children: (
                  <Typography.Text code copyable style={{ overflowWrap: 'anywhere' }}>
                    {item.value}
                  </Typography.Text>
                ),
              }))}
            />
          ),
        },
      ]}
    />
  );
}
