import { ConfigProvider, Select, Button, Checkbox, Input } from 'antd';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Bindings, Json } from '../shared/types';
import { schemaDefaults } from '../shared/template-config';
import { LiteralValue, type LiteralValueDraftSlot } from './ValueField';
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

export type ConfigurationFieldDraft = LiteralValueDraftSlot & {
  children?: Map<string, ConfigurationFieldDraft>;
  rows?: { keys: number[]; next: number };
};
function childDraft(draft: ConfigurationFieldDraft | undefined, key: string) {
  if (!draft) return undefined;
  const children = (draft.children ??= new Map());
  if (!children.has(key)) children.set(key, {});
  return children.get(key);
}

/** A generic, data-only form. Business field labels and options live in the package. */
export function Field({ schema: s, value, change, label, required = false, draft }: any) {
  const id = useId();
  if (Object.hasOwn(s, 'const') || s.readOnly) return null;
  const title = s.title ?? label;
  const options =
    s.oneOf ??
    s.enum?.map((v: Json) => ({
      const: v,
      title: typeof v === 'object' ? JSON.stringify(v) : String(v),
    }));
  if (!s.type && !s.enum && !s.oneOf)
    return (
      <LiteralValue label={title ?? '值'} value={value ?? null} change={change} draft={draft} />
    );
  if (s.type === 'object' && !options)
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
            draft={childDraft(draft, 'property:' + key)}
            value={value?.[key]}
            change={(next: Json) => change({ ...(value ?? schemaDefaults(s)), [key]: next })}
          />
        ))}
      </fieldset>
    );
  if (s.type === 'array' && !options)
    return <TemplateArray schema={s} value={value} change={change} title={title} draft={draft} />;
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
    <div
      className={`template-field${s.type === 'boolean' && !options ? ' template-boolean-field' : ''}`}
    >
      <span id={id}>
        {title}
        {required && <small className="template-required">（必需）</small>}
      </span>
      {options ? (
        <Select<string>
          status={!!error ? 'error' : undefined}
          aria-labelledby={id}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          aria-invalid={!!error}
          data-value-invalid={!!error || undefined}
          value={selected === -1 ? '' : String(selected)}
          onChange={(value) => {
            const option = options[Number(value)];
            if (value && option) change(option.const);
          }}
          options={[
            { value: '', disabled: true, label: '请选择' },
            ...options.map((o: any, index: number) => ({
              value: String(index),
              label:
                o.title ??
                (typeof o.const === 'object' ? JSON.stringify(o.const) : String(o.const)),
            })),
          ]}
        />
      ) : s.type === 'boolean' ? (
        <Checkbox
          aria-labelledby={id}
          aria-describedby={describedBy}
          aria-invalid={!!error}
          data-value-invalid={!!error || undefined}
          checked={Boolean(value)}
          onChange={(e) => change(e.target.checked)}
        />
      ) : s.type === 'number' || s.type === 'integer' ? (
        <TemplateNumber schema={s} value={value} change={change} labelId={id} required={required} />
      ) : s.type === 'string' && s.maxLength > 500 ? (
        <Input.TextArea
          status={!!error ? 'error' : undefined}
          aria-labelledby={id}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          aria-invalid={!!error}
          data-value-invalid={!!error || undefined}
          value={value ?? ''}
          onChange={(e) => change(e.target.value)}
        />
      ) : (
        <Input
          status={!!error ? 'error' : undefined}
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
    </div>
  );
}
function TemplateArray({ schema, value, change, title, draft }: any) {
  const errorId = useId();
  const values: Json[] = Array.isArray(value) ? value : [];
  const [rows, setRows] = useState<{ keys: number[]; next: number }>(
    () =>
      draft?.rows ?? {
        keys: values.map((_, index) => index),
        next: values.length,
      },
  );
  useLayoutEffect(() => {
    if (draft) draft.rows = rows;
  }, [draft, rows]);
  const rowElements = useRef(new Map<number, HTMLDivElement>());
  const add = useRef<HTMLButtonElement>(null);
  const focusRow = useRef<number | 'add' | null>(null);
  // Keep a surviving row's unfinished input with that row when another is removed.
  // Parent resets can still replace the list length without reusing deleted keys.
  if (rows.keys.length !== values.length) {
    const keys = rows.keys.slice(0, values.length);
    let next = rows.next;
    while (keys.length < values.length) keys.push(next++);
    setRows({ keys, next });
  }
  useLayoutEffect(() => {
    const key = focusRow.current;
    if (key === null) return;
    focusRow.current = null;
    const target =
      key === 'add'
        ? add.current
        : rowElements.current
            .get(key)
            ?.querySelector<HTMLElement>(
              'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)',
            );
    target?.focus();
  }, [rows]);
  const limit = schema.maxItems ?? 1000;
  const minimum = schema.minItems ?? 0;
  const error =
    values.length < minimum
      ? `至少添加 ${minimum} 项，当前 ${values.length} 项。`
      : values.length > limit
        ? `最多保留 ${limit} 项，当前 ${values.length} 项。`
        : '';
  return (
    <fieldset
      className="template-fieldset template-array-field"
      tabIndex={error ? -1 : undefined}
      aria-invalid={!!error || undefined}
      aria-describedby={error ? errorId : undefined}
      data-value-invalid={!!error || undefined}
    >
      <legend>{title}</legend>
      {schema.description && <p className="muted">{schema.description}</p>}
      <p className="muted" role="status">
        已添加 {values.length} / {limit} 项{values.length >= limit ? '，已达到数量上限。' : '。'}
        {minimum > 0 && `至少需要 ${minimum} 项。`}
      </p>
      {error && (
        <p id={errorId} className="template-field-error">
          {error}
        </p>
      )}
      {values.map((item, index) => (
        <div
          className="template-array-row"
          key={rows.keys[index]}
          ref={(element) => {
            if (element) rowElements.current.set(rows.keys[index], element);
            else rowElements.current.delete(rows.keys[index]);
          }}
        >
          <Field
            schema={schema.items}
            label={`${title} ${index + 1}`}
            value={item}
            draft={childDraft(draft, 'item:' + rows.keys[index])}
            change={(next: Json) => change(values.map((v, i) => (i === index ? next : v)))}
          />
          <Button
            htmlType="button"
            className="icon-button"
            aria-label={`移除 ${title} ${index + 1}`}
            onClick={() => {
              draft?.children?.delete('item:' + rows.keys[index]);
              const keys = rows.keys.filter((_, i) => i !== index);
              focusRow.current = keys[Math.min(index, keys.length - 1)] ?? 'add';
              setRows({ ...rows, keys });
              change(values.filter((_, i) => i !== index));
            }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button
        ref={add}
        htmlType="button"
        disabled={values.length >= limit || undefined}
        onClick={() => {
          focusRow.current = rows.next;
          setRows({ keys: [...rows.keys, rows.next], next: rows.next + 1 });
          change([...values, schemaDefaults(schema.items)]);
        }}
      >
        <Plus size={14} />
        添加{title}
      </Button>
    </fieldset>
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
      <Input
        status={invalid ? 'error' : undefined}
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
          else change(raw);
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
  const [feedbackRevision, setFeedbackRevision] = useState(0);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const saveError = useRef<HTMLParagraphElement>(null);
  const focusFeedback = useRef(false);
  useLayoutEffect(() => {
    if (saving || !error || !focusFeedback.current) return;
    focusFeedback.current = false;
    const invalid = form.current?.querySelector<HTMLElement>('[data-value-invalid]');
    const target = invalid
      ? invalid.matches('input,textarea,select,[role="combobox"],button')
        ? invalid
        : (invalid.querySelector<HTMLElement>('input,textarea,[role="combobox"],button') ?? invalid)
      : saveError.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [saving, error, feedbackRevision]);
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
          <Button
            aria-label="关闭实例配置"
            className="icon-button"
            onClick={close}
            disabled={saving || undefined}
          >
            <X size={20} />
          </Button>
        </header>
        <form
          ref={form}
          onInvalid={(event) => {
            const field = event.target as HTMLInputElement | HTMLSelectElement;
            focusFeedback.current = true;
            setFeedbackRevision((revision) => revision + 1);
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
              focusFeedback.current = true;
              setFeedbackRevision((revision) => revision + 1);
              setError(error instanceof Error ? error.message : String(error));
            } finally {
              submitting.current = false;
              setSaving(false);
            }
          }}
        >
          <ConfigProvider componentDisabled={saving || undefined}>
            <fieldset className="template-form-scroll template-form-fields" disabled={saving}>
              <Field schema={configuration.schema} value={values} change={setValues} />
            </fieldset>
          </ConfigProvider>
          {error && (
            <p
              className="field-error template-save-error"
              role="alert"
              tabIndex={-1}
              ref={saveError}
            >
              {error}
            </p>
          )}
          <footer>
            <span>只保存当前实例；不会开始运行</span>
            <Button htmlType="button" onClick={close} disabled={saving || undefined}>
              取消
            </Button>
            <Button type="primary" disabled={saving || undefined} htmlType="submit">
              保存配置
            </Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
