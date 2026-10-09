import { Select, Button, Input } from 'antd';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Json } from '../shared/types';
import { referenceOf, type ReferenceChoice } from './value-references';
import VariablePicker from './VariablePicker';

type Props = {
  label: string;
  value: Json;
  change: (value: Json) => void;
  choices?: ReferenceChoice[];
  defaultValue?: Json;
  jsonDefault?: Json;
  compactReference?: boolean;
  children?: ReactNode;
  onIncompleteChange?: (label: string, incomplete: boolean) => void;
};
export default function ValueField({
  label,
  value,
  change,
  choices,
  defaultValue = '',
  jsonDefault,
  compactReference = false,
  children,
  onIncompleteChange,
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
      {current !== undefined && compactReference ? (
        <div className="reference-value-compact">
          <span className="value-field-label">{label}</span>
          <Button
            htmlType="button"
            className="value-source-button"
            aria-label={'选择变量 · ' + label}
            aria-expanded={open}
            onClick={(event) => {
              event.currentTarget.focus();
              setOpen(true);
            }}
            title={current}
          >
            {source ? `${source.group} → ${source.label}` : current}
          </Button>
          {!source && <p className="field-error">来源已缺失或不在当前作用域，请重新选择。</p>}
        </div>
      ) : current !== undefined ? (
        <div className="reference-value">
          <span className="value-field-label">{label}</span>
          <span className="eyebrow">{source?.group ?? '已有引用'}</span>
          <strong>{source?.label ?? '当前来源不可用'}</strong>
          <code>{current}</code>
          {!source && <p className="field-error">来源已缺失或不在当前作用域，请重新选择。</p>}
          <Button
            htmlType="button"
            aria-label={'改为固定值 · ' + label}
            onClick={() => {
              change(structuredClone(defaultValue));
              setOpen(false);
            }}
          >
            改为固定值
          </Button>
        </div>
      ) : (
        (children ?? (
          <LiteralValue
            label={label}
            value={value}
            change={change}
            jsonDefault={jsonDefault}
            onIncompleteChange={onIncompleteChange}
          />
        ))
      )}
      {choices && !(compactReference && current !== undefined) && (
        <Button
          className="value-source-button"
          htmlType="button"
          aria-expanded={open}
          aria-label={'选择变量 · ' + label}
          onClick={(event) => {
            event.currentTarget.focus();
            setOpen(true);
          }}
        >
          ↳ {current !== undefined ? '更换变量' : '选择变量'}
        </Button>
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
export type LiteralValueDraftSlot = {
  literal?: { source: string; text: string; error: string };
};
export function LiteralValue({
  label,
  value,
  change,
  compact = false,
  displayLabels,
  onIncompleteChange,
  draft,
  jsonDefault,
}: {
  label: string;
  value: Json;
  change: (value: Json) => void;
  compact?: boolean;
  displayLabels?: { type: string; value: string };
  onIncompleteChange?: (label: string, incomplete: boolean) => void;
  draft?: LiteralValueDraftSlot;
  jsonDefault?: Json;
}) {
  const id = useId(),
    type = valueType(value);
  const format = () =>
    type === 'json' ? JSON.stringify(value, null, compact ? undefined : 2) : String(value ?? '');
  const source = JSON.stringify(value);
  const restored = draft?.literal && draft.literal.source === source ? draft.literal : undefined;
  const [text, setText] = useState(() => restored?.text ?? format()),
    [error, setError] = useState(() => restored?.error ?? '');
  const previousSource = useRef(source);
  const sourceChanged = previousSource.current !== source;
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    onIncompleteChange?.(label, !!error);
    return () => onIncompleteChange?.(label, false);
  }, [label, error, onIncompleteChange]);
  useEffect(() => {
    if (previousSource.current === source) return;
    previousSource.current = source;
    setText(format());
    setError('');
  }, [source]);
  useEffect(() => {
    if (draft && !sourceChanged) draft.literal = { source, text, error };
  }, [draft, source, text, error, sourceChanged]);
  const defaults: Record<string, Json> = {
    string: '',
    number: 0,
    boolean: true,
    null: null,
    json: jsonDefault ?? {},
  };
  return (
    <div className="literal-value" data-value-invalid={error || undefined}>
      <label htmlFor={id + '-type'}>{displayLabels?.type ?? `${label}类型`}</label>
      <Select<string>
        id={id + '-type'}
        aria-label={displayLabels ? `${label}类型` : undefined}
        value={type}
        onChange={(value) => {
          try {
            change(defaults[value]);
            setError('');
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : '类型未修改，请检查引用');
          }
        }}
        options={[
          { value: 'string', label: '文本' },
          { value: 'number', label: '数字' },
          { value: 'boolean', label: '布尔' },
          { value: 'null', label: '空值' },
          { value: 'json', label: '数组 / 对象' },
        ]}
      />
      <label htmlFor={id}>{displayLabels?.value ?? label}</label>
      {type === 'boolean' ? (
        <Select<string>
          status={!!error ? 'error' : undefined}
          id={id}
          aria-label={displayLabels ? label : undefined}
          value={String(value)}
          aria-invalid={!!error}
          aria-describedby={error ? id + '-error' : undefined}
          onChange={(value) => {
            try {
              change(value === 'true');
              setError('');
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '值未修改，请检查输入');
            }
          }}
          options={[
            { value: 'true', label: 'true' },
            { value: 'false', label: 'false' },
          ]}
        />
      ) : type === 'null' ? (
        <p className="note">null · 空值</p>
      ) : (
        <Input.TextArea
          status={!!error ? 'error' : undefined}
          ref={(instance) => {
            input.current = instance?.resizableTextArea?.textArea ?? null;
          }}
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
          <Button
            htmlType="button"
            className="literal-value-restore"
            aria-label={'恢复已应用值 · ' + label}
            onClick={() => {
              setText(format());
              setError('');
              input.current?.focus({ preventScroll: true });
            }}
          >
            恢复已应用值
          </Button>
        </>
      )}
    </div>
  );
}
