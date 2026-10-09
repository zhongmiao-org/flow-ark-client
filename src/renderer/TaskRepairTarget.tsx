import { Card, Collapse } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
export default function TaskRepairTarget({
  title,
  label,
  selector,
  framePath,
  kind,
  note,
}: {
  title: string;
  label?: string;
  selector?: string;
  framePath?: string[];
  kind: 'old' | 'new';
  note: string;
}) {
  return (
    <section aria-label={title}>
      <Card size="small" className={`task-repair-box task-repair-${kind} task-repair-target`}>
        <h3>{title}</h3>
        <p>{label || '该记录没有提供目标描述'}</p>
        <p>
          {framePath === undefined
            ? '所在页面层级未记录'
            : framePath.length
              ? `位于 ${framePath.length} 层内嵌页面中`
              : '位于顶层网页'}
          {' · '}
          {note}
        </p>
        <Collapse
          className="task-repair-target-location"
          items={[
            {
              key: 'evidence-1',
              label: <>查看{title}的定位信息</>,
              forceRender: true,
              onKeyDown: activateCollapseWithSpace,
              children: (
                <div className="feedback-body">
                  <p>元素定位</p>
                  <pre tabIndex={0} aria-label={`${title}的元素定位`}>
                    {selector || '该记录未提供元素定位'}
                  </pre>
                  {framePath && framePath.length > 0 && (
                    <>
                      <p>内嵌页面路径（由外到内）</p>
                      <ol aria-label={`${title}的内嵌页面路径`}>
                        {framePath.map((frame, index) => (
                          <li key={index}>
                            <span>第 {index + 1} 层</span>
                            <pre tabIndex={0} aria-label={`${title}第 ${index + 1} 层定位`}>
                              {frame}
                            </pre>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </section>
  );
}
