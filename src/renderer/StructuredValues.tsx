import { useEffect, useState } from 'react';
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
  const [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [rename, setRename] = useState(''),
    [error, setError] = useState('');
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
  return (
    <ValueField label={label} value={value} change={change} choices={choices} defaultValue={{}}>
      {object ? (
        <div className="mapping-values">
          <label>{label}</label>
          <div className="mapping-list">
            {keys.map((key) => (
              <div className="mapping-row" key={key}>
                <button
                  className={active === key ? 'selected' : ''}
                  type="button"
                  aria-label={label + '条目 ' + key}
                  onClick={() => setSelected(key)}
                >
                  <strong>{key}</strong>
                  <span>{shortValue(object[key])}</span>
                </button>
                <button
                  type="button"
                  aria-label={'删除' + label + '条目 ' + key}
                  onClick={() => {
                    const next = { ...object };
                    delete next[key];
                    change(next);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {!keys.length && <p className="note">尚无条目。</p>}
          <label htmlFor={kind + '-new-key'}>新增{label}名称</label>
          <div className="resource-inline">
            <input
              id={kind + '-new-key'}
              placeholder={kind === 'cells' ? 'A1' : 'Content-Type'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="button"
              aria-label={'添加' + label + '条目'}
              onClick={() => {
                try {
                  const key = mapKey(kind, name, object);
                  change({ ...object, [key]: '' });
                  setSelected(key);
                  setName('');
                  setError('');
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              添加
            </button>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {active && (
            <div className="mapping-current">
              <label htmlFor={kind + '-rename'}>当前{label}名称</label>
              <div className="resource-inline">
                <input
                  id={kind + '-rename'}
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={'更改' + label + '名称'}
                  onClick={() => {
                    try {
                      const next = renameEntry(object, active, rename, kind);
                      change(next);
                      setSelected(kind === 'cells' ? cellKey(rename) : rename);
                      setError('');
                    } catch (e: any) {
                      setError(e.message);
                    }
                  }}
                >
                  更名
                </button>
              </div>
              <ValueField
                key={active}
                label={label + '值 ' + active}
                value={object[active]}
                change={(next) => change({ ...object, [active]: next })}
                choices={choices}
              />
            </div>
          )}
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
          <label>行列数据</label>
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
                  <th>行</th>
                  {columns.map((c) => (
                    <th key={c}>{columnName(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(rowStart, rowStart + 10).map((row, i) => (
                  <tr key={rowStart + i}>
                    <th>{rowStart + i + 1}</th>
                    {columns.map((c) => (
                      <td key={c}>
                        <button
                          type="button"
                          className={
                            active?.[0] === rowStart + i && active[1] === c ? 'selected' : ''
                          }
                          aria-label={'编辑单元格 ' + columnName(c) + (rowStart + i + 1)}
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
          <div className="matrix-pagination">
            <span>
              {rows.length} 行 · {width} 列
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
