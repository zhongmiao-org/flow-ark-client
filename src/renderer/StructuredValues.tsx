import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './structured-values.css';
import type { Json } from '../shared/types';
import ValueField from './ValueField';
import { referenceOf, type ReferenceChoice } from './value-references';
import {
  addColumn,
  cellKey,
  columnName,
  isMatrix,
  mapKey,
  matrixColumns,
  removeColumn,
  renameEntry,
  setCell,
} from './resource-form-model';
const shortValue = (value: Json | undefined) => {
  if (value === null || value === undefined) return '空';
  const ref = referenceOf(value);
  if (ref !== undefined) return '↳ ' + ref;
  return typeof value === 'string' ? value || '空文本' : JSON.stringify(value);
};
export function MappingValues({
  label,
  value,
  change,
  choices,
  kind,
}: {
  label: string;
  value: Json;
  change: (value: Json) => void;
  choices: ReferenceChoice[];
  kind: 'headers' | 'cells';
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const focus = useRef<'value' | 'name' | 'list' | null>(null);
  const [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [rename, setRename] = useState(''),
    [error, setError] = useState('');
  const [notice, setNotice] = useState<{ message: string; value: string }>();
  const object =
    value && typeof value === 'object' && !Array.isArray(value) && referenceOf(value) === undefined
      ? value
      : null;
  const keys = Object.keys(object ?? {}),
    active = keys.includes(selected) ? selected : (keys[0] ?? '');
  useEffect(() => {
    setRename(active);
    setError('');
  }, [active]);
  useLayoutEffect(() => {
    const target = focus.current;
    if (!target) return;
    focus.current = null;
    const selector =
      target === 'value'
        ? '.mapping-value-editor textarea, .mapping-value-editor input'
        : target === 'name'
          ? '.mapping-rename-input'
          : '.mapping-row button[aria-pressed="true"]';
    (
      root.current?.querySelector<HTMLElement>(selector) ??
      (target === 'value'
        ? root.current?.querySelector<HTMLElement>(
            '.mapping-value-editor select, .mapping-value-editor button',
          )
        : null) ??
      root.current?.querySelector<HTMLElement>('.mapping-new-input')
    )?.focus();
  }, [active, value, selected]);
  const changed = (next: Json, message: string) => {
    change(next);
    setNotice({ message, value: JSON.stringify(next) });
    setError('');
  };
  const add = () => {
    if (!object) return;
    try {
      const key = mapKey(kind, name, object);
      changed({ ...object, [key]: '' }, `已添加 ${key}，请填写对应值。`);
      setSelected(key);
      setName('');
      focus.current = 'value';
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '条目未添加');
    }
  };
  const renameCurrent = () => {
    if (!object || !active) return;
    try {
      const next = renameEntry(object, active, rename, kind);
      const key = kind === 'cells' ? cellKey(rename) : rename;
      changed(next, `已将 ${active} 更名为 ${key}，原值保持。`);
      setSelected(key);
      setRename(key);
      focus.current = 'name';
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '条目未更名');
    }
  };
  return (
    <ValueField label={label} value={value} change={change} choices={choices} defaultValue={{}}>
      {object ? (
        <div className="mapping-values" ref={root}>
          <header className="structured-values-heading">
            <strong>{label}</strong>
            <span>{keys.length} 个条目</span>
          </header>
          <div className="mapping-workspace">
            <div className="mapping-inventory">
              <div className="mapping-list" role="group" aria-label={label + '条目'}>
                {keys.map((key, index) => (
                  <div className="mapping-row" key={key}>
                    <button
                      className={active === key ? 'selected' : ''}
                      type="button"
                      aria-pressed={active === key}
                      aria-label={label + '条目 ' + key}
                      onClick={() => {
                        setSelected(key);
                        setError('');
                        focus.current = 'value';
                      }}
                    >
                      <strong title={key}>{key}</strong>
                      <span title={shortValue(object[key])}>{shortValue(object[key])}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={'删除' + label + '条目 ' + key}
                      onClick={() => {
                        const next = { ...object };
                        delete next[key];
                        changed(next, `已移除 ${key}。`);
                        if (active === key) setSelected(keys[index + 1] ?? keys[index - 1] ?? '');
                        focus.current = 'list';
                      }}
                    >
                      移除
                    </button>
                  </div>
                ))}
              </div>
              {!keys.length && (
                <p className="structured-values-empty">尚无条目。填写名称后添加，再编辑对应值。</p>
              )}
              <label htmlFor={`${id}-new`}>新增{label}名称</label>
              <div className="resource-inline">
                <input
                  id={`${id}-new`}
                  className="mapping-new-input"
                  placeholder={kind === 'cells' ? 'A1' : 'Content-Type'}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      add();
                    }
                  }}
                />
                <button type="button" aria-label={'添加' + label + '条目'} onClick={add}>
                  添加
                </button>
              </div>
            </div>
            {active && (
              <div className="mapping-current">
                <h5>当前条目 · {active}</h5>
                <label htmlFor={`${id}-rename`}>当前{label}名称</label>
                <div className="resource-inline">
                  <input
                    id={`${id}-rename`}
                    className="mapping-rename-input"
                    value={rename}
                    onChange={(event) => {
                      setRename(event.target.value);
                      setError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        renameCurrent();
                      }
                    }}
                  />
                  <button
                    type="button"
                    aria-label={'更改' + label + '名称'}
                    disabled={rename === active}
                    onClick={renameCurrent}
                  >
                    更名
                  </button>
                </div>
                <div className="mapping-value-editor">
                  <ValueField
                    key={active}
                    label={label + '值 ' + active}
                    value={object[active]}
                    change={(next) => {
                      change({ ...object, [active]: next });
                      setNotice(undefined);
                    }}
                    choices={choices}
                  />
                </div>
              </div>
            )}
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <p className="structured-values-feedback" role="status">
            {notice?.value === JSON.stringify(value) ? notice.message : ''}
          </p>
        </div>
      ) : undefined}
    </ValueField>
  );
}

export function MatrixValues({
  value,
  change,
  choices,
}: {
  value: Json;
  change: (value: Json) => void;
  choices: ReferenceChoice[];
}) {
  const [rowPage, setRowPage] = useState(0),
    [columnPage, setColumnPage] = useState(0),
    [selected, setSelected] = useState<[number, number] | null>(null);
  const rows = isMatrix(value) ? value : null,
    width = rows ? matrixColumns(rows) : 1;
  const rowStart = Math.min(rowPage, Math.max(0, Math.ceil((rows?.length ?? 0) / 10) - 1)) * 10;
  const columnStart = Math.min(columnPage, Math.max(0, Math.ceil(width / 6) - 1)) * 6;
  const columns = Array.from(
    { length: Math.min(6, width - columnStart) },
    (_, i) => columnStart + i,
  );
  const active =
    selected && rows && selected[0] < rows.length && selected[1] < width ? selected : null;
  return (
    <ValueField label="行列数据" value={value} change={change} choices={choices} defaultValue={[]}>
      {rows ? (
        <div className="matrix-values">
          <header className="structured-values-heading">
            <strong>行列数据</strong>
            <span>
              {rows.length} 行 · {width} 列
            </span>
          </header>
          <div className="matrix-actions">
            <button
              type="button"
              disabled={rows.length >= 1048576}
              onClick={() => {
                change([...rows, Array.from({ length: width }, () => null)]);
                setRowPage(Math.floor(rows.length / 10));
                setColumnPage(0);
                setSelected([rows.length, 0]);
              }}
            >
              添加数据行
            </button>
            <button
              type="button"
              disabled={!rows.length || width >= 16384}
              onClick={() => {
                change(addColumn(rows));
                setColumnPage(Math.floor(width / 6));
                setRowPage(0);
                setSelected([0, width]);
              }}
            >
              添加数据列
            </button>
          </div>
          <div className="matrix-scroll">
            <table aria-label="Excel 数据表格">
              <thead>
                <tr>
                  <th scope="col">行</th>
                  {columns.map((c) => (
                    <th key={c} scope="col">
                      {columnName(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(rowStart, rowStart + 10).map((row, i) => (
                  <tr key={rowStart + i}>
                    <th scope="row">{rowStart + i + 1}</th>
                    {columns.map((c) => (
                      <td key={c}>
                        <button
                          type="button"
                          className={
                            active?.[0] === rowStart + i && active[1] === c ? 'selected' : ''
                          }
                          aria-label={'编辑单元格 ' + columnName(c) + (rowStart + i + 1)}
                          aria-pressed={active?.[0] === rowStart + i && active?.[1] === c}
                          title={shortValue(row[c])}
                          onClick={() => setSelected([rowStart + i, c])}
                        >
                          {shortValue(row[c])}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p className="structured-values-empty">
              尚无数据行。添加一行后，点击单元格编辑文本、数字、布尔、空值或变量。
            </p>
          )}
          <div className="matrix-pagination" aria-label="矩阵分页">
            <span role="status">
              {rows.length
                ? `第 ${rowStart + 1}–${Math.min(rowStart + 10, rows.length)} 行 / 共 ${rows.length} 行`
                : '尚无数据行'}{' '}
              · {columnName(columnStart)}–{columnName(columnStart + columns.length - 1)} 列
            </span>
            <button
              type="button"
              aria-label="上一页数据行"
              disabled={!rowStart}
              onClick={() => {
                setRowPage(rowStart / 10 - 1);
                setSelected(null);
              }}
            >
              ↑ 行
            </button>
            <button
              type="button"
              aria-label="下一页数据行"
              disabled={rowStart + 10 >= rows.length}
              onClick={() => {
                setRowPage(rowStart / 10 + 1);
                setSelected(null);
              }}
            >
              ↓ 行
            </button>
            <button
              type="button"
              aria-label="上一组数据列"
              disabled={!columnStart}
              onClick={() => {
                setColumnPage(columnStart / 6 - 1);
                setSelected(null);
              }}
            >
              ← 列
            </button>
            <button
              type="button"
              aria-label="下一组数据列"
              disabled={columnStart + 6 >= width}
              onClick={() => {
                setColumnPage(columnStart / 6 + 1);
                setSelected(null);
              }}
            >
              → 列
            </button>
          </div>
          {active && (
            <div className="matrix-current">
              <p className="note">
                当前单元格 {columnName(active[1])}
                {active[0] + 1}
              </p>
              <div className="matrix-actions">
                <button
                  type="button"
                  aria-label="删除当前数据行"
                  onClick={() => {
                    change(rows.filter((_, i) => i !== active[0]));
                    setSelected(null);
                  }}
                >
                  删除此行
                </button>
                <button
                  type="button"
                  aria-label="删除当前数据列"
                  disabled={width <= 1}
                  onClick={() => {
                    change(removeColumn(rows, active[1]));
                    setSelected(null);
                  }}
                >
                  删除此列
                </button>
              </div>
              <ValueField
                key={active.join(':')}
                label="单元格值"
                value={rows[active[0]][active[1]] ?? null}
                change={(next) => change(setCell(rows, active[0], active[1], next))}
                choices={choices}
              />
            </div>
          )}
          <p className="note">点击单元格编辑类型和变量。每页显示 10 行、6 列，翻页保留全部数据。</p>
        </div>
      ) : undefined}
    </ValueField>
  );
}
