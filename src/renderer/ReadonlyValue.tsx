import type { ReactNode } from 'react';
import './readonly-value.css';

/** A bounded presentation of an already validated JSON value; never changes its source. */
export default function ReadonlyValue({ value }: { value: unknown }) {
  let remaining = 200;
  let limited = false;
  const render = (current: unknown, depth: number): ReactNode => {
    if (remaining-- <= 0 || depth > 8) {
      limited = true;
      return <span className="readonly-value-muted">其余内容请查看高级原文</span>;
    }
    if (current === null) return <span>空值（null）</span>;
    if (typeof current === 'boolean') return <span>{current ? '是（true）' : '否（false）'}</span>;
    if (typeof current === 'number') return <span>{String(current)}</span>;
    if (typeof current === 'string') {
      if (!current.length) return <span>空文本</span>;
      if (current.length > 4000) {
        limited = true;
        return <span>{current.slice(0, 4000).replace(/[\uD800-\uDBFF]$/, '')}…（摘要已截断）</span>;
      }
      return <span>{current}</span>;
    }
    if (Array.isArray(current)) {
      if (!current.length) return <span>空列表 · 0 项</span>;
      const items: ReactNode[] = [];
      for (let i = 0; i < current.length && remaining > 0; i++)
        items.push(<li key={i}>{render(current[i], depth + 1)}</li>);
      if (items.length < current.length) limited = true;
      return (
        <div>
          <p className="readonly-value-muted">列表 · {current.length} 项</p>
          <ol>{items}</ol>
        </div>
      );
    }
    if (current && typeof current === 'object') {
      const entries = Object.entries(current);
      if (!entries.length) return <span>空对象 · 0 个字段</span>;
      const rows: ReactNode[] = [];
      for (const [key, item] of entries) {
        if (remaining <= 0) break;
        rows.push(
          <div className="readonly-value-field" key={key}>
            <dt>{key || '空字段名'}</dt>
            <dd>{render(item, depth + 1)}</dd>
          </div>,
        );
      }
      if (rows.length < entries.length) limited = true;
      return <dl>{rows}</dl>;
    }
    return <span>不可展示的值，请查看高级原文</span>;
  };
  const summary = render(value, 0);
  return (
    <section className="readonly-value" aria-label="配置与状态值">
      <p className="readonly-value-muted">字段名按已保存内容展示，不推断业务含义。</p>
      {summary}
      {limited && (
        <p role="status" className="readonly-value-muted">
          摘要范围有限，完整值仍可在高级原文中核对。
        </p>
      )}
    </section>
  );
}
