import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { composeReference, type ReferenceChoice } from './value-references';
import './variable-picker.css';

export default function VariablePicker({
  label,
  choices,
  current,
  choose,
  fixed,
  close,
}: {
  label: string;
  choices: ReferenceChoice[];
  current?: string;
  choose: (path: string) => void;
  fixed: () => void;
  close: () => void;
}) {
  const source =
    choices.find((choice) => choice.path === current) ??
    choices
      .filter((choice) => current?.startsWith(choice.path + '.'))
      .sort((a, b) => b.path.length - a.path.length)[0];
  const [base, setBase] = useState(source?.path ?? '');
  const [suffix, setSuffix] = useState(
    source && current ? current.slice(source.path.length + 1) : '',
  );
  const [search, setSearch] = useState('');
  const [failure, setFailure] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const closeRef = useRef(close);
  closeRef.current = close;
  const selected = choices.find((choice) => choice.path === base);
  const filtered = choices.filter((choice) =>
    `${choice.label} ${choice.path} ${choice.group}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  let path = '',
    invalid = '';
  try {
    path = composeReference(choices, base, suffix);
  } catch (error) {
    invalid = error instanceof Error ? error.message : '此引用不可用';
  }
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    searchInput.current?.focus();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  const apply = (operation: () => void) => {
    try {
      operation();
      close();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '字段尚未更新，请重试');
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="variable-picker-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onKeyDown={(event) => {
        if ((event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[')) {
          if ((event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]'))
            return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="variable-picker-heading">
        <div>
          <h2 id={titleId}>选择变量</h2>
          <p>用于「{label}」· 仅列出当前位置可访问的参数与前序输出。</p>
        </div>
        <button type="button" onClick={close} aria-label={'返回字段 · ' + label}>
          返回字段
        </button>
      </header>
      <div className="variable-picker-columns">
        <section className="variable-picker-sources" aria-label="可用变量来源">
          <label htmlFor={titleId + '-search'}>搜索名称或来源</label>
          <input
            id={titleId + '-search'}
            ref={searchInput}
            value={search}
            placeholder="输入名称、来源或路径"
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="variable-picker-source-list">
            {(['流程参数', '前序步骤', '当前循环'] as const).map((group) => {
              const items = filtered.filter((choice) => choice.group === group);
              return items.length ? (
                <section key={group} aria-label={group}>
                  <h3>{group}</h3>
                  {items.map((choice) => (
                    <button
                      key={choice.path}
                      type="button"
                      aria-pressed={base === choice.path}
                      onClick={() => {
                        setBase(choice.path);
                        setSuffix('');
                        setFailure('');
                      }}
                    >
                      <strong>{choice.label}</strong>
                      <code>{choice.path}</code>
                    </button>
                  ))}
                </section>
              ) : null;
            })}
            {!filtered.length && (
              <div className="variable-picker-empty">
                <h3>{choices.length ? '没有匹配的变量' : '当前位置没有可用变量'}</h3>
                <p>
                  {choices.length
                    ? '尝试搜索其他名称或路径。已选来源会保留。'
                    : '先添加流程参数或可访问的前序步骤，也可以返回填写固定值。'}
                </p>
                {search && (
                  <button type="button" onClick={() => setSearch('')}>
                    清除搜索
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="variable-picker-note">
            当前循环变量只在循环体内出现。另一条件分支的输出不在候选中。
          </p>
        </section>
        <section className="variable-picker-detail" aria-label="引用详情">
          {selected ? (
            <>
              <span className="variable-picker-source-kind">{selected.group}</span>
              <h3>{selected.label}</h3>
              <dl>
                <dt>来源说明</dt>
                <dd>{selected.hint}</dd>
                <dt>来源路径</dt>
                <dd>
                  <code>{selected.path}</code>
                </dd>
              </dl>
              <label htmlFor={titleId + '-suffix'}>子路径（可选）</label>
              <input
                id={titleId + '-suffix'}
                value={suffix}
                disabled={base === 'index'}
                placeholder={base === 'index' ? '循环序号没有子字段' : '例如 rows.0.name'}
                aria-invalid={!!invalid}
                onChange={(event) => {
                  setSuffix(event.target.value);
                  setFailure('');
                }}
              />
              <p className="variable-picker-note">
                不使用历史运行值作为默认数据；未知子路径在运行时核验。缺失字段会报错，不会执行表达式。
              </p>
              {path && (
                <div className="variable-picker-path">
                  <span>将使用的引用路径</span>
                  <code>{path}</code>
                </div>
              )}
              {invalid && (
                <p role="alert" className="field-error">
                  {invalid}
                </p>
              )}
            </>
          ) : (
            <div className="variable-picker-empty">
              <h3>{base || current ? '引用来源不可用' : '选择一个变量来源'}</h3>
              <p>
                {base || current
                  ? '原引用已缺失或不在当前作用域，请重新选择。取消不会修改原字段。'
                  : '在左侧选择参数、前序输出或当前循环变量，核对路径后再应用到字段。'}
              </p>
              {current && <code>{current}</code>}
            </div>
          )}
          {failure && (
            <p role="alert" className="field-error">
              {failure}
            </p>
          )}
        </section>
      </div>
      <footer className="variable-picker-actions">
        <button
          type="button"
          className="primary"
          disabled={!path}
          onClick={() => apply(() => choose(path))}
        >
          使用此变量
        </button>
        <button type="button" onClick={() => apply(fixed)}>
          改用固定值
        </button>
        <button type="button" onClick={close} aria-label={'取消选择 · ' + label}>
          取消
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}
