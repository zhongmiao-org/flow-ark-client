import { useId, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Bindings, Json } from '../shared/types';
import { schemaDefaults } from '../shared/template-config';
import { LiteralValue } from './ValueField';

/** A generic, data-only form. Business field labels and options live in the package. */
export function Field({ schema: s, value, change, label }: any) {
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
            value={value?.[key]}
            change={(next: Json) => change({ ...schemaDefaults(s), ...value, [key]: next })}
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
  const options = s.oneOf ?? s.enum?.map((v: Json) => ({ const: v, title: String(v) }));
  return (
    <label className="template-field">
      <span id={id}>{title}</span>
      {options ? (
        <select
          aria-labelledby={id}
          aria-describedby={s.description ? id + '-description' : undefined}
          value={String(value ?? '')}
          onChange={(e) =>
            change(options.find((o: any) => String(o.const) === e.target.value).const)
          }
        >
          {options.map((o: any) => (
            <option value={String(o.const)} key={String(o.const)}>
              {o.title ?? String(o.const)}
            </option>
          ))}
        </select>
      ) : s.type === 'boolean' ? (
        <input
          aria-labelledby={id}
          aria-describedby={s.description ? id + '-description' : undefined}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => change(e.target.checked)}
        />
      ) : (
        <input
          aria-labelledby={id}
          aria-describedby={s.description ? id + '-description' : undefined}
          value={value ?? ''}
          type={s.type === 'number' || s.type === 'integer' ? 'number' : 'text'}
          min={s.minimum}
          max={s.maximum}
          minLength={s.minLength}
          maxLength={s.maxLength}
          step={s.type === 'integer' ? 1 : undefined}
          onChange={(e) =>
            change(
              s.type === 'number' || s.type === 'integer' ? Number(e.target.value) : e.target.value,
            )
          }
        />
      )}
      {s.description && <small id={id + '-description'}>{s.description}</small>}
    </label>
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
