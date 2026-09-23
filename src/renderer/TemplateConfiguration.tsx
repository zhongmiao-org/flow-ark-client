import { useEffect, useId, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Bindings, Json } from '../shared/types';
import { schemaDefaults } from '../shared/template-config';
import { LiteralValue } from './ValueField';
import './template-fields.css';

function sameOption(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameOption(a[key], b[key]))
  );
}

/** A generic, data-only form. Business field labels and options live in the package. */
export function Field({ schema: s, value, change, label, required = false }: any) {
  const id = useId();
  if (Object.hasOwn(s, 'const') || s.readOnly) return null;
  const title = s.title ?? label;
  if (!s.type && !s.enum && !s.oneOf)
    return <LiteralValue label={title ?? '值'} value={value ?? null} change={change} />;
  if (s.type === 'object')
    return (
      <fieldset className="template-fieldset">
        {title && <legend>{title}</legend>}
        {s.description && <p className="muted">{s.description}</p>}
        {Object.entries(s.properties ?? {}).map(([key, schema]) => (
          <Field
            key={key}
            schema={schema}
            label={key}
            required={s.required?.includes(key)}
            value={value?.[key]}
            change={(next: Json) => change({ ...(value ?? schemaDefaults(s)), [key]: next })}
          />
        ))}
      </fieldset>
    );
  if (s.type === 'array') {
    const values = Array.isArray(value) ? value : [];
    return (
      <fieldset className="template-fieldset">
        <legend>{title}</legend>
        {s.description && <p className="muted">{s.description}</p>}
        {values.map((item, index) => (
          <div className="template-array-row" key={index}>
            <Field
              schema={s.items}
              label={`${title} ${index + 1}`}
              value={item}
              change={(next: Json) => change(values.map((v, i) => (i === index ? next : v)))}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`移除 ${title} ${index + 1}`}
              onClick={() => change(values.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={values.length >= (s.maxItems ?? 1000)}
          onClick={() => change([...values, schemaDefaults(s.items)])}
        >
          <Plus size={14} />
          添加{title}
        </button>
      </fieldset>
    );
  }
  const options =
    s.oneOf ??
    s.enum?.map((v: Json) => ({
      const: v,
      title: typeof v === 'object' ? JSON.stringify(v) : String(v),
    }));
  const selected = options?.findIndex((option: any) => sameOption(option.const, value));
  const text = typeof value === 'string' ? value : '';
  const length = [...text].length;
  const error =
    value === undefined
      ? required && s.type !== 'integer' && s.type !== 'number'
        ? '请填写此项。'
        : ''
      : options
        ? selected === -1
          ? '请选择一个有效选项。'
          : ''
        : s.type === 'string'
          ? s.minLength !== undefined && length < s.minLength
            ? `至少填写 ${s.minLength} 个字符。`
            : s.maxLength !== undefined && length > s.maxLength
              ? `最多填写 ${s.maxLength} 个字符，当前 ${length} 个。`
              : ''
          : '';
  const describedBy =
    [error ? id + '-error' : '', s.description ? id + '-description' : '']
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <label className="template-field">
      <span id={id}>
        {title}
        {required && <small className="template-required">（必需）</small>}
      </span>
      {options ? (
        <select
          aria-labelledby={id}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          aria-invalid={!!error}
          data-value-invalid={!!error || undefined}
          value={selected === -1 ? '' : String(selected)}
          onChange={(e) => {
            const option = options[Number(e.target.value)];
            if (e.target.value && option) change(option.const);
          }}
        >
          <option value="" disabled>
            请选择
          </option>
          {options.map((o: any, index: number) => (
            <option value={String(index)} key={index}>
              {o.title ?? String(o.const)}
            </option>
          ))}
        </select>
      ) : s.type === 'boolean' ? (
        <input
          aria-labelledby={id}
          aria-describedby={describedBy}
          aria-invalid={!!error}
          data-value-invalid={!!error || undefined}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => change(e.target.checked)}
        />
      ) : s.type === 'number' || s.type === 'integer' ? (
        <TemplateNumber schema={s} value={value} change={change} labelId={id} required={required} />
      ) : s.type === 'string' && s.maxLength > 500 ? (
        <textarea
          aria-labelledby={id}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          aria-invalid={!!error}
          data-value-invalid={!!error || undefined}
          value={value ?? ''}
          onChange={(e) => change(e.target.value)}
        />
      ) : (
        <input
          aria-labelledby={id}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          aria-invalid={!!error}
          data-value-invalid={!!error || undefined}
          value={value ?? ''}
          type="text"
          onChange={(e) => change(e.target.value)}
        />
      )}
      {error && (
        <small className="template-field-error" id={id + '-error'}>
          {error}
        </small>
      )}
      {s.description && <small id={id + '-description'}>{s.description}</small>}
    </label>
  );
}
function TemplateNumber({ schema, value, change, labelId, required }: any) {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => setText(String(value ?? '')), [value]);
  const number = Number(text);
  const error =
    !text.trim() && value === undefined && !required
      ? ''
      : !text.trim() || !Number.isFinite(number)
        ? '请填写有效数字。'
        : schema.type === 'integer' && !Number.isInteger(number)
          ? '请填写整数。'
          : schema.minimum !== undefined && number < schema.minimum
            ? `不能小于 ${schema.minimum}。`
            : schema.maximum !== undefined && number > schema.maximum
              ? `不能大于 ${schema.maximum}。`
              : '';
  const invalid = !!error;
  return (
    <>
      <input
        aria-labelledby={labelId}
        aria-required={required || undefined}
        aria-invalid={invalid}
        data-value-invalid={invalid || undefined}
        aria-describedby={
          invalid ? labelId + '-error' : schema.description ? labelId + '-description' : undefined
        }
        inputMode={schema.type === 'integer' ? 'numeric' : 'decimal'}
        value={text}
        onChange={(event) => {
          const raw = event.target.value,
            parsed = Number(raw);
          setText(raw);
          if (
            raw.trim() &&
            Number.isFinite(parsed) &&
            (schema.type !== 'integer' || Number.isInteger(parsed))
          )
            change(parsed);
        }}
      />
      {invalid && (
        <small className="template-field-error" id={labelId + '-error'}>
          {error}
        </small>
      )}
    </>
  );
}
export default function TemplateConfiguration({
  configuration,
  name,
  close,
  apply,
}: {
  configuration: NonNullable<Bindings['configuration']>;
  name: string;
  close: () => void;
  apply: (value: Json) => Promise<void>;
}) {
  const [values, setValues] = useState(structuredClone(configuration.values));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="template-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-config-title"
      >
        <header>
          <div>
            <h2 id="template-config-title">实例配置</h2>
            <p>{name}</p>
          </div>
          <button
            aria-label="关闭实例配置"
            className="icon-button"
            onClick={close}
            disabled={saving}
          >
            <X size={20} />
          </button>
        </header>
        <form
          onInvalid={(event) => {
            const field = event.target as HTMLInputElement | HTMLSelectElement;
            setError(field.validationMessage);
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current) return;
            submitting.current = true;
            setSaving(true);
            setError('');
            try {
              if (e.currentTarget.querySelector('[data-value-invalid]'))
                throw new Error('请先修正未完成的字段值');
              await apply(values);
              close();
            } catch (error: unknown) {
              setError(error instanceof Error ? error.message : String(error));
            } finally {
              submitting.current = false;
              setSaving(false);
            }
          }}
        >
          <fieldset className="template-form-scroll template-form-fields" disabled={saving}>
            <Field schema={configuration.schema} value={values} change={setValues} />
          </fieldset>
          {error && (
            <p className="field-error template-save-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <span>只保存当前实例；不会开始运行</span>
            <button type="button" onClick={close} disabled={saving}>
              取消
            </button>
            <button className="primary" disabled={saving} type="submit">
              保存配置
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
