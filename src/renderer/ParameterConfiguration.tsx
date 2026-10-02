import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Json } from '../shared/types';
import { LiteralValue } from './ValueField';
import { referenceKey } from './value-references';

export default function ParameterConfiguration({
  value,
  change,
  columns = false,
  actions,
}: {
  value: Record<string, Json>;
  change: (next: Record<string, Json>) => void;
  columns?: boolean;
  actions?: ReactNode;
}) {
  const [name, setName] = useState(''),
    [error, setError] = useState('');
  const [adding, setAdding] = useState(!columns);
  const nameInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (columns && adding) nameInput.current?.focus();
  }, [columns, adding]);
  const apply = (next: Record<string, Json>) => {
    change(next);
    setError('');
  };
  return (
    <section aria-label="运行参数配置" className="parameter-fields">
      {Object.entries(value).map(([key, val]) => (
        <div className="parameter-field" key={key}>
          <header>
            {columns ? (
              <label className="parameter-name-field">
                名称
                <input readOnly value={key} aria-label={'参数 ' + key + ' 名称'} />
              </label>
            ) : (
              <strong>{key}</strong>
            )}
            <button
              type="button"
              aria-label={'删除参数 ' + key}
              onClick={() => {
                try {
                  const next = { ...value };
                  delete next[key];
                  apply(next);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              删除
            </button>
          </header>
          <LiteralValue
            compact
            displayLabels={columns ? { type: '类型', value: '值' } : undefined}
            label={'参数 ' + key}
            value={val}
            change={(next) => apply({ ...value, [key]: next })}
          />
          {!referenceKey(key) && <p className="note">此名称无法用点路径引用；已有参数保持不变。</p>}
        </div>
      ))}
      {adding && (
        <div className="parameter-add-fields">
          <label htmlFor="parameter-name">新参数名称</label>
          <input
            ref={nameInput}
            id="parameter-name"
            data-value-invalid={name ? '新参数名称尚未添加，请添加或清空' : undefined}
            value={name}
            placeholder="例如 userName"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              if (!referenceKey(name) || name.trim() !== name)
                return setError('名称不能为空、含点、首尾空格或原型相关属性');
              if (Object.hasOwn(value, name)) return setError('参数名称已存在');
              apply({ ...value, [name]: '' });
              setName('');
              if (columns) {
                setAdding(false);
                requestAnimationFrame(() => addButton.current?.focus());
              }
            }}
          >
            {columns ? '确认添加' : '添加参数'}
          </button>
          {columns && (
            <button
              type="button"
              onClick={() => {
                setName('');
                setError('');
                setAdding(false);
                requestAnimationFrame(() => addButton.current?.focus());
              }}
            >
              取消添加
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {columns && (
        <div className="parameter-actions">
          <button ref={addButton} type="button" disabled={adding} onClick={() => setAdding(true)}>
            添加参数
          </button>
          {actions}
        </div>
      )}
    </section>
  );
}
