import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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
  compact = false,
  displayLabels,
}: {
  label: string;
  value: Json;
  change: (value: Json) => void;
  compact?: boolean;
  displayLabels?: { type: string; value: string };
}) {
  const id = useId(),
    type = valueType(value);
  const format = () =>
    type === 'json' ? JSON.stringify(value, null, compact ? undefined : 2) : String(value ?? '');
  const [text, setText] = useState(format),
    [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
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
      <label htmlFor={id + '-type'}>{displayLabels?.type ?? `${label}类型`}</label>
      <select
        id={id + '-type'}
        aria-label={displayLabels ? `${label}类型` : undefined}
        value={type}
        onChange={(e) => {
          try {
            change(defaults[e.target.value]);
            setError('');
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : '类型未修改，请检查引用');
          }
        }}
      >
        <option value="string">文本</option>
        <option value="number">数字</option>
        <option value="boolean">布尔</option>
        <option value="null">空值</option>
        <option value="json">数组 / 对象</option>
      </select>
      <label htmlFor={id}>{displayLabels?.value ?? label}</label>
      {type === 'boolean' ? (
        <select
          id={id}
          aria-label={displayLabels ? label : undefined}
          value={String(value)}
          onChange={(e) => change(e.target.value === 'true')}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : type === 'null' ? (
        <p className="note">null · 空值</p>
      ) : (
        <textarea
          ref={input}
          id={id}
          aria-label={displayLabels ? label : undefined}
          rows={compact ? 1 : type === 'json' ? 5 : 2}
          className={type === 'json' ? 'code-input small' : ''}
          value={text}
          aria-invalid={!!error}
          aria-describedby={error ? id + '-error' : undefined}
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
              setError(e instanceof SyntaxError ? '数组 / 对象 JSON 尚未完成' : e.message);
            }
          }}
        />
      )}
      {error && (
        <>
          <p id={id + '-error'} className="field-error" role="alert">
            {error}；修正后才能保存、运行或切换步骤。
          </p>
          <button
            type="button"
            className="literal-value-restore"
            aria-label={'恢复已应用值 · ' + label}
            onClick={() => {
              setText(format());
              setError('');
              input.current?.focus({ preventScroll: true });
            }}
          >
            恢复已应用值
          </button>
        </>
      )}
    </div>
  );
}
