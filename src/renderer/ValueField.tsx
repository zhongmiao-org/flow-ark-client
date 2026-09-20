import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Json } from '../shared/types';
import { composeReference, referenceOf, type ReferenceChoice } from './value-references';

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
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState('');
  const [base, setBase] = useState(''),
    [suffix, setSuffix] = useState('');
  const available = choices ?? [];
  const source =
    available.find((choice) => choice.path === current) ??
    available
      .filter((choice) => current?.startsWith(choice.path + '.'))
      .sort((a, b) => b.path.length - a.path.length)[0];
  const filtered = available.filter((choice) =>
    `${choice.label} ${choice.path} ${choice.group}`.toLowerCase().includes(search.toLowerCase()),
  );
  let preview = '',
    error = '';
  try {
    preview = composeReference(available, base, suffix);
  } catch (e: any) {
    error = e.message;
  }
  const show = () => {
    setBase(source?.path ?? '');
    setSuffix(source && current ? current.slice(source.path.length + 1) : '');
    setSearch('');
    setOpen(true);
  };
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
          onClick={show}
        >
          ↳ {current !== undefined ? '更换变量' : '选择变量'}
        </button>
      )}
      {open && (
        <div className="reference-picker" role="group" aria-label={label + '变量选择'}>
          <input
            autoFocus
            aria-label={label + '变量搜索'}
            placeholder="搜索名称或路径"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label={label + '变量来源'}
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              setSuffix('');
            }}
          >
            <option value="">选择参数或前序输出…</option>
            {base && !filtered.some((c) => c.path === base) && (
              <option value={base}>{available.find((c) => c.path === base)?.label ?? base}</option>
            )}
            {(['流程参数', '前序步骤', '当前循环'] as const).map((group) => (
              <optgroup key={group} label={group}>
                {filtered
                  .filter((c) => c.group === group)
                  .map((c) => (
                    <option key={c.path} value={c.path}>
                      {c.label} · {c.path}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {!filtered.length && <p className="note">没有匹配的可用变量。</p>}
          {base && <p className="note">{available.find((c) => c.path === base)?.hint}</p>}
          <details>
            <summary>子路径 · 高级</summary>
            <input
              aria-label={label + '变量子路径'}
              placeholder="例如 rows.0.name（可留空）"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
            />
            <p className="note">子字段在执行时核对；缺失将报错。不会执行表达式。</p>
          </details>
          {preview && <code className="reference-preview">{preview}</code>}
          {base && error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="value-picker-actions">
            <button type="button" onClick={() => setOpen(false)} aria-label={'取消选择 · ' + label}>
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={!preview}
              aria-label={'使用变量 · ' + label}
              onClick={() => {
                change({ $ref: preview });
                setOpen(false);
              }}
            >
              使用变量
            </button>
          </div>
        </div>
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
