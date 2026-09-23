import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Json } from '../shared/types';
import { referenceOf, type ReferenceChoice } from './value-references';
import VariablePicker from './VariablePicker';

type Props = {
  label: string;
  value: Json;
  change: (value: Json) => void;
  choices?: ReferenceChoice[];
  defaultValue?: Json;
  children?: ReactNode;
};
export default function ValueField({
  label,
  value,
  change,
  choices,
  defaultValue = '',
  children,
}: Props) {
  const current = referenceOf(value);
  const [open, setOpen] = useState(false);
  const available = choices ?? [];
  const source =
    available.find((choice) => choice.path === current) ??
    available
      .filter((choice) => current?.startsWith(choice.path + '.'))
      .sort((a, b) => b.path.length - a.path.length)[0];
  return (
    <section className="value-field" aria-label={label + '配置'}>
      {current !== undefined ? (
        <div className="reference-value">
          <span className="value-field-label">{label}</span>
          <span className="eyebrow">{source?.group ?? '已有引用'}</span>
          <strong>{source?.label ?? '当前来源不可用'}</strong>
          <code>{current}</code>
          {!source && <p className="field-error">来源已缺失或不在当前作用域，请重新选择。</p>}
          <button
            type="button"
            aria-label={'改为固定值 · ' + label}
            onClick={() => {
              change(structuredClone(defaultValue));
              setOpen(false);
            }}
          >
            改为固定值
          </button>
        </div>
      ) : (
        (children ?? <LiteralValue label={label} value={value} change={change} />)
      )}
      {choices && (
        <button
          className="value-source-button"
          type="button"
          aria-expanded={open}
          aria-label={'选择变量 · ' + label}
          onClick={() => setOpen(true)}
        >
          ↳ {current !== undefined ? '更换变量' : '选择变量'}
        </button>
      )}
      {open && (
        <VariablePicker
          label={label}
          choices={available}
          current={current}
          choose={(path) => change({ $ref: path })}
          fixed={() => {
            if (current !== undefined) change(structuredClone(defaultValue));
          }}
          close={() => setOpen(false)}
        />
      )}
    </section>
  );
}
const valueType = (value: Json) =>
  value === null ? 'null' : typeof value === 'object' ? 'json' : typeof value;
export function LiteralValue({
  label,
  value,
  change,
}: {
  label: string;
  value: Json;
  change: (value: Json) => void;
}) {
  const id = useId(),
    type = valueType(value);
  const format = () => (type === 'json' ? JSON.stringify(value, null, 2) : String(value ?? ''));
  const [text, setText] = useState(format),
    [error, setError] = useState('');
  useEffect(() => {
    setText(format());
    setError('');
  }, [JSON.stringify(value)]);
  const defaults: Record<string, Json> = {
    string: '',
    number: 0,
    boolean: true,
    null: null,
    json: {},
  };
  return (
    <div className="literal-value" data-value-invalid={error || undefined}>
      <label htmlFor={id + '-type'}>{label}类型</label>
      <select
        id={id + '-type'}
        value={type}
        onChange={(e) => {
          setError('');
          change(defaults[e.target.value]);
        }}
      >
        <option value="string">文本</option>
        <option value="number">数字</option>
        <option value="boolean">布尔</option>
        <option value="null">空值</option>
        <option value="json">数组 / 对象</option>
      </select>
      <label htmlFor={id}>{label}</label>
      {type === 'boolean' ? (
        <select id={id} value={String(value)} onChange={(e) => change(e.target.value === 'true')}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : type === 'null' ? (
        <p className="note">null · 空值</p>
      ) : (
        <textarea
          id={id}
          rows={type === 'json' ? 5 : 2}
          className={type === 'json' ? 'code-input small' : ''}
          value={text}
          aria-invalid={!!error}
          onChange={(e) => {
            setText(e.target.value);
            try {
              const parsed =
                type === 'number'
                  ? e.target.value.trim()
                    ? Number(e.target.value)
                    : NaN
                  : type === 'json'
                    ? JSON.parse(e.target.value)
                    : e.target.value;
              if (type === 'number' && !Number.isFinite(parsed)) throw new Error('请输入有限数字');
              if (type === 'json' && (parsed === null || typeof parsed !== 'object'))
                throw new Error('请输入数组或对象');
              change(parsed);
              setError('');
            } catch (e: any) {
              setError(type === 'json' ? '数组 / 对象 JSON 尚未完成' : e.message);
            }
          }}
        />
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}；修正后才能保存或运行。
        </p>
      )}
    </div>
  );
}
