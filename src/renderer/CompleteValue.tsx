import { Button, Space } from 'antd';
import { useLayoutEffect, useRef, useState } from 'react';
import './readonly-value.css';
type Annotation = { path: string; label: string; description?: string };
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
function Branch({
  value,
  path,
  labels,
  root = false,
}: {
  value: unknown;
  path: string;
  labels: Map<string, Annotation>;
  root?: boolean;
}) {
  const [open, setOpen] = useState(root),
    [start, setStart] = useState(0),
    [count, setCount] = useState(20);
  const [characters, setCharacters] = useState(4000);
  const origin = useRef<HTMLElement | null>(null),
    position = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const control = origin.current;
    origin.current = null;
    if (!control) return;
    const target =
      control.isConnected && !control.hasAttribute('disabled') ? control : position.current;
    target?.focus({ preventScroll: true });
  }, [open, start, count, characters]);
  if (value === null) return <span>空值（null）</span>;
  if (typeof value === 'boolean') return <span>{value ? '是（true）' : '否（false）'}</span>;
  if (typeof value === 'number') return <span>{String(value)}</span>;
  if (typeof value === 'string') {
    const visible = value.slice(0, characters).replace(/[\uD800-\uDBFF]$/, '');
    return (
      <div>
        {value.length ? (
          <span>{characters >= value.length ? value : visible}</span>
        ) : (
          <span>空文本</span>
        )}
        {value.length > 4000 && (
          <p ref={position} tabIndex={-1} className="readonly-value-muted" role="status">
            当前已展开 {Math.min(visible.length, value.length)} / {value.length} 字符
          </p>
        )}
        {characters < value.length && (
          <Button
            onClick={(event) => {
              origin.current = event.currentTarget;
              setCharacters((n) => n + 4000);
            }}
          >
            继续阅读文本（尚有 {value.length - visible.length} 字符）
          </Button>
        )}
      </div>
    );
  }
  if (!value || typeof value !== 'object') return <span>不可展示的值</span>;
  const array = Array.isArray(value),
    entries = Object.entries(value);
  if (!entries.length) return <span>{array ? '空列表 · 0 项' : '空对象 · 0 个字段'}</span>;
  return (
    <div className="complete-value-branch">
      <Space wrap>
        <span className="readonly-value-muted">
          {array ? '列表' : '对象'} · {entries.length} {array ? '项' : '个字段'}
        </span>
        <Button size="small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开字段'}
        </Button>
      </Space>
      {open && (
        <>
          <dl>
            {entries.slice(start, start + count).map(([key, item]) => {
              const child = path + '/' + pointer(key),
                annotation = labels.get(child);
              return (
                <div className="readonly-value-field" key={key}>
                  <dt>
                    {annotation?.label || (array ? `条目 ${Number(key) + 1}` : key || '空字段名')}
                  </dt>
                  <dd>
                    {annotation?.description && (
                      <p className="readonly-value-muted">{annotation.description}</p>
                    )}
                    <Branch value={item} path={child} labels={labels} />
                  </dd>
                </div>
              );
            })}
          </dl>
          <p ref={position} tabIndex={-1} className="readonly-value-muted" role="status">
            当前第 {start + 1}—{Math.min(start + count, entries.length)} 项，共 {entries.length} 项
          </p>
          <Space wrap>
            {start > 0 && (
              <Button
                onClick={(event) => {
                  origin.current = event.currentTarget;
                  setStart((n) => Math.max(0, n - 200));
                  setCount(200);
                }}
              >
                上一页字段
              </Button>
            )}
            {start + count < entries.length && (
              <Button
                onClick={(event) => {
                  origin.current = event.currentTarget;
                  if (count < 200) setCount((n) => Math.min(200, n + 20));
                  else {
                    setStart((n) => n + 200);
                    setCount(20);
                  }
                }}
              >
                {count < 200 ? '展开更多' : '下一页字段'}（尚有 {entries.length - start - count}{' '}
                项）
              </Button>
            )}
          </Space>
        </>
      )}
    </div>
  );
}
/** Full already-protected JSON through normal controls; expansion never changes selected data. */
export default function CompleteValue({
  value,
  labels = [],
  ariaLabel = '完整可复用数据',
  description = '逐层展开对象和列表，每页最多200项；展开范围仅影响显示，完整已核验数据保持不变。字段说明来自模板，不是事实认证。',
}: {
  value: unknown;
  labels?: Annotation[];
  ariaLabel?: string;
  description?: string;
}) {
  return (
    <section className="readonly-value" aria-label={ariaLabel}>
      <p className="readonly-value-muted">{description}</p>
      <Branch value={value} path="" labels={new Map(labels.map((a) => [a.path, a]))} root />
    </section>
  );
}
