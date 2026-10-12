import { Alert, Button, Input } from 'antd';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Flow, Json } from '../shared/types';
import ParameterSourceField from './ParameterSourceField';
import { LiteralValue } from './ValueField';
import { referenceKey } from './value-references';

export default function ParameterConfiguration({
  value,
  flow,
  sourceChange,
  change,
  rename,
  onPendingNameChange,
  onIncompleteChange,
  columns = false,
  actions,
}: {
  value: Record<string, Json>;
  flow: Flow;
  sourceChange: (flow: Flow) => void;
  change: (next: Record<string, Json>) => void;
  rename: (from: string, to: string) => number;
  onPendingNameChange?: (pending: boolean) => void;
  onIncompleteChange?: (incomplete: boolean) => void;
  columns?: boolean;
  actions?: ReactNode;
}) {
  const [name, setName] = useState(''),
    [error, setError] = useState('');
  const [adding, setAdding] = useState(!columns);
  const [addError, setAddError] = useState('');
  const addId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  const focusName = useRef<string | undefined>(undefined);
  const removedFocus = useRef<{ name: string | null; origin: HTMLElement | null } | undefined>(
    undefined,
  );
  const operationError = useRef<HTMLDivElement | null>(null);
  const errorOrigin = useRef<HTMLElement | null>(null);
  const [deleteFailure, setDeleteFailure] = useState(0);
  const [notice, setNotice] = useState('');
  const [incompleteFields, setIncompleteFields] = useState(new Set<string>());
  const markIncomplete = useCallback((key: string, incomplete: boolean) => {
    setIncompleteFields((current) => {
      if (current.has(key) === incomplete) return current;
      const next = new Set(current);
      if (incomplete) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  useLayoutEffect(() => {
    onIncompleteChange?.(!!name || incompleteFields.size > 0);
  }, [name, incompleteFields, onIncompleteChange]);
  const pendingNames = useRef(new Set<string>());
  const markPendingName = useCallback(
    (key: string, pending: boolean) => {
      if (pending) pendingNames.current.add(key);
      else pendingNames.current.delete(key);
      onPendingNameChange?.(pendingNames.current.size > 0);
      markIncomplete('name:' + key, pending);
    },
    [onPendingNameChange, markIncomplete],
  );
  useLayoutEffect(() => {
    if (focusName.current !== undefined) {
      root.current
        ?.querySelector<HTMLInputElement>(
          `input[data-parameter-name="${CSS.escape(focusName.current)}"]`,
        )
        ?.focus({ preventScroll: true });
      focusName.current = undefined;
    }
    const removed = removedFocus.current;
    if (!removed) return;
    removedFocus.current = undefined;
    if (document.activeElement !== removed.origin && document.activeElement !== document.body)
      return;
    const row = removed.name
      ? root.current?.querySelector<HTMLElement>(
          `[data-parameter-key="${CSS.escape(removed.name)}"]`,
        )
      : undefined;
    (
      row?.querySelector<HTMLElement>('input,textarea,[tabindex="0"]') ??
      addButton.current ??
      nameInput.current
    )?.focus();
  }, [value]);
  useLayoutEffect(() => {
    if (
      error &&
      errorOrigin.current?.isConnected &&
      (document.activeElement === errorOrigin.current || document.activeElement === document.body)
    )
      operationError.current?.focus();
    errorOrigin.current = null;
  }, [error, deleteFailure]);
  useEffect(() => {
    if (columns && adding) nameInput.current?.focus();
  }, [columns, adding]);
  const apply = (next: Record<string, Json>) => {
    change(next);
    setError('');
    setNotice('');
  };
  const cancelAdd = () => {
    setName('');
    setAddError('');
    setAdding(false);
    requestAnimationFrame(() => addButton.current?.focus());
  };
  const add = () => {
    try {
      if (!referenceKey(name) || name.trim() !== name)
        throw new Error('名称不能为空、含点、首尾空格或原型相关属性');
      if (Object.hasOwn(value, name)) throw new Error('参数名称已存在');
      apply({ ...value, [name]: '' });
      setName('');
      setAddError('');
      if (columns) {
        setAdding(false);
        requestAnimationFrame(() => addButton.current?.focus());
      }
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : '添加未完成，请重新核对名称。');
      nameInput.current?.focus();
    }
  };
  return (
    <section ref={root} aria-label="运行参数配置" className="parameter-fields">
      {Object.entries(value).map(([key, val]) => (
        <div className="parameter-field" key={key} data-parameter-key={key}>
          <header>
            {columns ? (
              <ParameterName
                name={key}
                pending={markPendingName}
                rename={(next) => {
                  const references = rename(key, next);
                  focusName.current = next;
                  setError('');
                  setNotice(
                    `已将 ${key} 改为 ${next}，同步更新 ${references} 处变量引用。保存后生效。`,
                  );
                }}
              />
            ) : (
              <strong>{key}</strong>
            )}
            <Button
              htmlType="button"
              type={columns ? 'text' : 'default'}
              size={columns ? 'small' : 'middle'}
              aria-label={'删除参数 ' + key}
              onClick={() => {
                const origin =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
                try {
                  const next = { ...value };
                  delete next[key];
                  apply(next);
                  const names = Object.keys(value);
                  const index = names.indexOf(key);
                  removedFocus.current = {
                    name: names[index + 1] ?? names[index - 1] ?? null,
                    origin,
                  };
                } catch (e: any) {
                  errorOrigin.current = origin;
                  setDeleteFailure((count) => count + 1);
                  setError(e.message);
                }
              }}
            >
              删除
            </Button>
          </header>
          <div className="parameter-value-fields">
            <LiteralValue
              compact
              displayLabels={columns ? { type: '类型', value: '值' } : undefined}
              label={'参数 ' + key}
              value={val}
              onIncompleteChange={markIncomplete}
              change={(next) => apply({ ...value, [key]: next })}
            />
            <ParameterSourceField
              flow={flow}
              name={key}
              change={sourceChange}
              incomplete={markIncomplete}
            />
          </div>
          {!referenceKey(key) && <p className="note">此名称无法用点路径引用；已有参数保持不变。</p>}
        </div>
      ))}
      {adding && (
        <div className="parameter-add-fields">
          <label htmlFor={addId}>新参数名称</label>
          <Input
            status={!!addError ? 'error' : undefined}
            ref={(instance) => {
              nameInput.current = instance?.input ?? null;
            }}
            id={addId}
            data-value-invalid={name ? '新参数名称尚未添加，请添加或清空' : undefined}
            value={name}
            placeholder="例如 userName"
            aria-invalid={!!addError}
            aria-describedby={addError ? addId + '-error' : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setAddError('');
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                add();
              } else if (event.key === 'Escape' && columns) {
                event.preventDefault();
                event.stopPropagation();
                cancelAdd();
              }
            }}
          />
          {addError && (
            <p id={addId + '-error'} className="field-error" role="alert">
              {addError}
            </p>
          )}
          <Button htmlType="button" onClick={add}>
            {columns ? '确认添加' : '添加参数'}
          </Button>
          {columns && (
            <Button htmlType="button" onClick={cancelAdd}>
              取消添加
            </Button>
          )}
        </div>
      )}
      {error && (
        <Alert
          ref={(instance) => {
            operationError.current = instance?.nativeElement ?? null;
            operationError.current?.setAttribute('tabindex', '-1');
          }}
          className="parameter-operation-error"
          type="error"
          showIcon
          title="参数删除未完成"
          description={error}
        />
      )}
      {notice && (
        <p className="parameter-rename-notice" role="status">
          {notice}
        </p>
      )}
      {columns && (
        <div className="parameter-actions">
          <Button
            ref={addButton}
            htmlType="button"
            disabled={adding || undefined}
            onClick={() => setAdding(true)}
          >
            添加参数
          </Button>
          {actions}
        </div>
      )}
    </section>
  );
}

function ParameterName({
  name,
  rename,
  pending,
}: {
  name: string;
  rename: (next: string) => void;
  pending: (name: string, pending: boolean) => void;
}) {
  const [next, setNext] = useState(name);
  const [error, setError] = useState('');
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const changed = next !== name;
  useLayoutEffect(() => {
    pending(name, changed);
    return () => pending(name, false);
  }, [name, changed, pending]);
  const cancel = () => {
    setNext(name);
    setError('');
    input.current?.focus();
  };
  const apply = () => {
    try {
      rename(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '改名未完成，请重新核对。');
      input.current?.focus();
    }
  };
  return (
    <div>
      <label className="parameter-name-field" htmlFor={id}>
        名称
        <Input
          status={!!error ? 'error' : undefined}
          id={id}
          ref={(instance) => {
            input.current = instance?.input ?? null;
          }}
          value={next}
          data-parameter-name={name}
          data-value-invalid={changed ? '参数名称尚未确认，请确认改名或取消' : undefined}
          aria-label={'参数 ' + name + ' 名称'}
          aria-invalid={!!error}
          aria-describedby={changed ? id + '-feedback' : undefined}
          onChange={(event) => {
            setNext(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || !changed) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
        />
      </label>
      {changed && (
        <div className="parameter-rename-controls">
          <p
            id={id + '-feedback'}
            className={error ? 'field-error' : 'note'}
            role={error ? 'alert' : undefined}
          >
            {error || '同步更新变量引用；代码和普通文本请自行核对。'}
          </p>
          <div>
            <Button size="small" htmlType="button" onClick={apply}>
              确认改名
            </Button>
            <Button size="small" htmlType="button" onClick={cancel}>
              取消改名
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
