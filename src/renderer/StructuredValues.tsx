import { Button, Card, Empty, Input, Table } from 'antd';
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
function focusValueInput(root: HTMLElement | null) {
  const valueLabel = root?.querySelector<HTMLLabelElement>('.literal-value label:last-of-type');
  const input = valueLabel?.control ?? root?.querySelector<HTMLElement>('textarea, input, button');
  if (input instanceof HTMLElement) {
    input.focus();
    input.scrollIntoView({ block: 'nearest' });
  }
}
function retainIncompleteValue(root: HTMLElement | null) {
  const invalid = root?.querySelector<HTMLElement>('.literal-value[data-value-invalid]');
  if (!invalid) return false;
  focusValueInput(invalid);
  return true;
}
export function MappingValues({
  label,
  value,
  change,
  choices,
  kind,
  protectDraft = false,
}: {
  label: string;
  value: Json;
  change: (value: Json) => void;
  choices: ReferenceChoice[];
  kind: 'headers' | 'cells';
  protectDraft?: boolean;
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
  const canLeaveEntry = () => {
    if (retainIncompleteValue(root.current)) return false;
    if (rename !== active) {
      setError('请先应用当前条目的名称，或恢复原名称。');
      root.current?.querySelector<HTMLInputElement>('.mapping-rename-input')?.focus();
      return false;
    }
    return true;
  };
  const add = () => {
    if (!object || !canLeaveEntry()) return;
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
    if (!object || !active || retainIncompleteValue(root.current)) return;
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
        <div
          className="mapping-values"
          ref={root}
          data-value-invalid={
            protectDraft && (name || rename !== active || error)
              ? '请完成条目名称编辑，或放弃未应用的名称。'
              : undefined
          }
        >
          <header className="structured-values-heading">
            <strong>{label}</strong>
            <span>{keys.length} 个条目</span>
          </header>
          <div className="mapping-workspace">
            <div className="mapping-inventory">
              <div className="mapping-list" role="group" aria-label={label + '条目'}>
                {keys.map((key, index) => (
                  <div className="mapping-row" key={key}>
                    <Button
                      className={active === key ? 'selected' : ''}
                      htmlType="button"
                      aria-pressed={active === key}
                      aria-label={label + '条目 ' + key}
                      onClick={() => {
                        if (!canLeaveEntry()) return;
                        setSelected(key);
                        setError('');
                        focus.current = 'value';
                      }}
                    >
                      <strong title={key}>{key}</strong>
                      <span title={shortValue(object[key])}>{shortValue(object[key])}</span>
                    </Button>
                    <Button
                      htmlType="button"
                      aria-label={'删除' + label + '条目 ' + key}
                      onClick={() => {
                        if (!canLeaveEntry()) return;
                        const next = { ...object };
                        delete next[key];
                        changed(next, `已移除 ${key}。`);
                        if (active === key) setSelected(keys[index + 1] ?? keys[index - 1] ?? '');
                        focus.current = 'list';
                      }}
                    >
                      移除
                    </Button>
                  </div>
                ))}
              </div>
              {!keys.length && (
                <Empty
                  className="structured-values-empty"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="尚无条目。填写名称后添加，再编辑对应值。"
                />
              )}
              <label htmlFor={`${id}-new`}>新增{label}名称</label>
              <div className="resource-inline">
                <Input
                  status={protectDraft && !!name ? 'error' : undefined}
                  id={`${id}-new`}
                  className="mapping-new-input"
                  aria-invalid={protectDraft && !!name}
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
                <Button htmlType="button" aria-label={'添加' + label + '条目'} onClick={add}>
                  添加
                </Button>
              </div>
            </div>
            {active && (
              <Card size="small" className="mapping-current">
                <h5>当前条目 · {active}</h5>
                <label htmlFor={`${id}-rename`}>当前{label}名称</label>
                <div className="resource-inline">
                  <Input
                    status={protectDraft && rename !== active ? 'error' : undefined}
                    id={`${id}-rename`}
                    className="mapping-rename-input"
                    aria-invalid={protectDraft && rename !== active}
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
                  <Button
                    htmlType="button"
                    aria-label={'更改' + label + '名称'}
                    disabled={rename === active || undefined}
                    onClick={renameCurrent}
                  >
                    更名
                  </Button>
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
              </Card>
            )}
          </div>
          {protectDraft && (name || rename !== active || error) && (
            <Button
              htmlType="button"
              onClick={() => {
                setName('');
                setRename(active);
                setError('');
              }}
            >
              放弃未应用的名称
            </Button>
          )}
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
  const paginationStatus = useRef<HTMLSpanElement>(null);
  const paginationTrigger = useRef<HTMLButtonElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusEditor = useRef(false);
  const rows = isMatrix(value) ? value : null,
    width = rows ? matrixColumns(rows) : 1;
  const rowStart = Math.min(rowPage, Math.max(0, Math.ceil((rows?.length ?? 0) / 10) - 1)) * 10;
  const columnStart = Math.min(columnPage, Math.max(0, Math.ceil(width / 6) - 1)) * 6;
  const columns = Array.from(
    { length: Math.min(6, width - columnStart) },
    (_, i) => columnStart + i,
  );
  useLayoutEffect(() => {
    const trigger = paginationTrigger.current;
    paginationTrigger.current = null;
    if (trigger?.disabled) paginationStatus.current?.focus({ preventScroll: true });
  }, [rowStart, columnStart]);
  const active =
    selected && rows && selected[0] < rows.length && selected[1] < width ? selected : null;
  useLayoutEffect(() => {
    if (!focusEditor.current) return;
    const editor = root.current?.querySelector<HTMLElement>('.matrix-current .value-field');
    if (!editor) return;
    focusEditor.current = false;
    focusValueInput(editor);
  }, [selected, value]);
  return (
    <ValueField label="行列数据" value={value} change={change} choices={choices} defaultValue={[]}>
      {rows ? (
        <div className="matrix-values" ref={root}>
          <header className="structured-values-heading">
            <strong>行列数据</strong>
            <span>
              {rows.length} 行 · {width} 列
            </span>
          </header>
          <div className="matrix-actions">
            <Button
              htmlType="button"
              disabled={rows.length >= 1048576 || undefined}
              onClick={() => {
                if (retainIncompleteValue(root.current)) return;
                focusEditor.current = true;
                change([...rows, Array.from({ length: width }, () => null)]);
                setRowPage(Math.floor(rows.length / 10));
                setColumnPage(0);
                setSelected([rows.length, 0]);
              }}
            >
              添加数据行
            </Button>
            <Button
              htmlType="button"
              disabled={!rows.length || width >= 16384 || undefined}
              onClick={() => {
                if (retainIncompleteValue(root.current)) return;
                focusEditor.current = true;
                change(addColumn(rows));
                setColumnPage(Math.floor(width / 6));
                setRowPage(0);
                setSelected([0, width]);
              }}
            >
              添加数据列
            </Button>
          </div>
          <div className="matrix-scroll">
            <Table<{ index: number; values: Json[] }>
              aria-label="Excel 数据表格"
              size="small"
              bordered
              pagination={false}
              rowKey="index"
              scroll={{ x: 'max-content' }}
              dataSource={rows.slice(rowStart, rowStart + 10).map((values, index) => ({
                index: rowStart + index,
                values,
              }))}
              locale={{ emptyText: '尚无数据行' }}
              columns={[
                {
                  key: 'row',
                  title: '行',
                  width: 48,
                  rowScope: 'row',
                  render: (_, row) => row.index + 1,
                },
                ...columns.map((column) => ({
                  key: column,
                  title: columnName(column),
                  width: 120,
                  render: (_: unknown, row: { index: number; values: Json[] }) => (
                    <Button
                      htmlType="button"
                      className="matrix-cell-button"
                      color={
                        active?.[0] === row.index && active[1] === column ? 'primary' : 'default'
                      }
                      variant={
                        active?.[0] === row.index && active[1] === column ? 'filled' : 'outlined'
                      }
                      aria-label={'编辑单元格 ' + columnName(column) + (row.index + 1)}
                      aria-pressed={active?.[0] === row.index && active?.[1] === column}
                      title={shortValue(row.values[column])}
                      onClick={() => {
                        if (retainIncompleteValue(root.current)) return;
                        focusEditor.current = true;
                        setSelected([row.index, column]);
                      }}
                    >
                      {shortValue(row.values[column])}
                    </Button>
                  ),
                })),
              ]}
            />
          </div>
          {!rows.length && (
            <Empty
              className="structured-values-empty"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="尚无数据行。添加一行后，点击单元格编辑文本、数字、布尔、空值或变量。"
            />
          )}
          <div className="matrix-pagination" aria-label="矩阵分页">
            <span role="status" ref={paginationStatus} tabIndex={-1}>
              {rows.length
                ? `第 ${rowStart + 1}–${Math.min(rowStart + 10, rows.length)} 行 / 共 ${rows.length} 行`
                : '尚无数据行'}{' '}
              · {columnName(columnStart)}–{columnName(columnStart + columns.length - 1)} 列
            </span>
            <Button
              htmlType="button"
              aria-label="上一页数据行"
              disabled={!rowStart || undefined}
              onClick={(event) => {
                if (retainIncompleteValue(root.current)) return;
                paginationTrigger.current = event.currentTarget as HTMLButtonElement;
                setRowPage(rowStart / 10 - 1);
                setSelected(null);
              }}
            >
              ↑ 行
            </Button>
            <Button
              htmlType="button"
              aria-label="下一页数据行"
              disabled={rowStart + 10 >= rows.length || undefined}
              onClick={(event) => {
                if (retainIncompleteValue(root.current)) return;
                paginationTrigger.current = event.currentTarget as HTMLButtonElement;
                setRowPage(rowStart / 10 + 1);
                setSelected(null);
              }}
            >
              ↓ 行
            </Button>
            <Button
              htmlType="button"
              aria-label="上一组数据列"
              disabled={!columnStart || undefined}
              onClick={(event) => {
                if (retainIncompleteValue(root.current)) return;
                paginationTrigger.current = event.currentTarget as HTMLButtonElement;
                setColumnPage(columnStart / 6 - 1);
                setSelected(null);
              }}
            >
              ← 列
            </Button>
            <Button
              htmlType="button"
              aria-label="下一组数据列"
              disabled={columnStart + 6 >= width || undefined}
              onClick={(event) => {
                if (retainIncompleteValue(root.current)) return;
                paginationTrigger.current = event.currentTarget as HTMLButtonElement;
                setColumnPage(columnStart / 6 + 1);
                setSelected(null);
              }}
            >
              → 列
            </Button>
          </div>
          {active && (
            <Card size="small" className="matrix-current">
              <p className="note">
                当前单元格 {columnName(active[1])}
                {active[0] + 1}
              </p>
              <div className="matrix-actions">
                <Button
                  htmlType="button"
                  aria-label="删除当前数据行"
                  onClick={() => {
                    if (retainIncompleteValue(root.current)) return;
                    change(rows.filter((_, i) => i !== active[0]));
                    setSelected(null);
                  }}
                >
                  删除此行
                </Button>
                <Button
                  htmlType="button"
                  aria-label="删除当前数据列"
                  disabled={width <= 1 || undefined}
                  onClick={() => {
                    if (retainIncompleteValue(root.current)) return;
                    change(removeColumn(rows, active[1]));
                    setSelected(null);
                  }}
                >
                  删除此列
                </Button>
              </div>
              <ValueField
                key={active.join(':')}
                label="单元格值"
                value={rows[active[0]][active[1]] ?? null}
                change={(next) => change(setCell(rows, active[0], active[1], next))}
                choices={choices}
              />
            </Card>
          )}
          <p className="note">点击单元格编辑类型和变量。每页显示 10 行、6 列，翻页保留全部数据。</p>
        </div>
      ) : undefined}
    </ValueField>
  );
}
