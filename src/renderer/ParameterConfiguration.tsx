import { useState } from 'react';
import type { Json } from '../shared/types';
import { LiteralValue } from './ValueField';
import { referenceKey } from './value-references';

export default function ParameterConfiguration({
  value,
  change,
}: {
  value: Record<string, Json>;
  change: (next: Record<string, Json>) => void;
}) {
  const [name, setName] = useState(''),
    [error, setError] = useState('');
  const apply = (next: Record<string, Json>) => {
    change(next);
    setError('');
  };
  return (
    <section aria-label="运行参数配置" className="parameter-fields">
      {Object.entries(value).map(([key, val]) => (
        <div className="parameter-field" key={key}>
          <header>
            <strong>{key}</strong>
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
            label={'参数 ' + key}
            value={val}
            change={(next) => apply({ ...value, [key]: next })}
          />
          {!referenceKey(key) && <p className="note">此名称无法用点路径引用；已有参数保持不变。</p>}
        </div>
      ))}
      <label htmlFor="parameter-name">新参数名称</label>
      <input
        id="parameter-name"
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
        }}
      >
        添加参数
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
