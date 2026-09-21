import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { FlowRecord } from '../shared/types';
import {
  ExcelMappingError,
  mappingPreview,
  type MappedExcel,
  type ExcelMapping,
} from '../shared/excel-mapping';
import { changeSteps, flatten } from './flow-editing';
import { referenceChoices } from './value-references';
import ValueField from './ValueField';
import { columnName } from './resource-form-model';
import type { ScriptNavigation } from './ScriptEditorPage';

export default function ExcelMappingPage({
  record,
  nodeId,
  save,
  close,
  navigation,
}: {
  record: FlowRecord;
  nodeId: string;
  save: (record: FlowRecord) => Promise<void>;
  close: (next?: () => void) => void;
  navigation: MutableRefObject<ScriptNavigation | undefined>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(record));
  const node = flatten(draft.flow.steps).find((step) => step.id === nodeId) as MappedExcel;
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof mappingPreview>>();
  const [pending, setPending] = useState<{ next?: () => void }>();
  const root = useRef<HTMLElement>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true),
    persisting = useRef(false),
    choosing = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(record);
  const choices = referenceChoices(draft.flow, nodeId);
  const incomplete = () => !!root.current?.querySelector('[data-value-invalid]');
  const change = (next: MappedExcel) => {
    setPreview(undefined);
    setError('');
    setDraft((current) => ({
      ...current,
      flow: { ...current.flow, steps: changeSteps(current.flow.steps, nodeId, () => next) },
    }));
  };
  useEffect(() => {
    alive.current = true;
    root.current?.querySelector<HTMLElement>('h1')?.focus();
    return () => {
      alive.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    navigation.current = (next) => {
      if (persisting.current || choosing.current) return;
      if (dirty || incomplete()) setPending({ next });
      else close(next);
    };
    return () => {
      navigation.current = undefined;
    };
  });
  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);
  const report = (error: unknown) => {
    setError((error as Error).message);
    setPending(undefined);
    setPreview(undefined);
    if (error instanceof ExcelMappingError) {
      const selector =
        error.mapping === undefined
          ? `[data-excel-field="${error.field}"]`
          : `[data-mapping="${error.mapping}"] [data-excel-field="${error.field}"]`;
      const element = root.current?.querySelector<HTMLElement>(selector);
      const details = element?.closest('details');
      if (details) details.open = true;
      element?.focus();
      element?.scrollIntoView({ block: 'nearest' });
    }
  };
  const validate = () => {
    if (incomplete()) {
      const invalid = root.current?.querySelector<HTMLElement>('[data-value-invalid]');
      const details = invalid?.closest('details');
      if (details) details.open = true;
      invalid?.querySelector<HTMLElement>('textarea,input')?.focus();
      throw new Error('请先修正未完成的输入配置');
    }
    return mappingPreview(node, draft.flow.parameters);
  };
  const persist = async (next?: () => void) => {
    if (persisting.current || choosing.current) return;
    try {
      validate();
      persisting.current = true;
      setSaving(true);
      setError('');
      await save({
        ...draft,
        flow: {
          ...draft.flow,
          requiredCapabilities: [
            ...new Set([...draft.flow.requiredCapabilities, 'excel-mapping-v1']),
          ],
        },
      });
      if (alive.current) close(next);
    } catch (error) {
      if (alive.current) report(error);
    } finally {
      persisting.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const patchMapping = (index: number, patch: Partial<ExcelMapping>) =>
    change({
      ...node,
      mappings: node.mappings.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ) as MappedExcel['mappings'],
    });
  const choose = async () => {
    if (choosing.current || persisting.current) return;
    if (!node.binding.trim() || ['__proto__', 'constructor', 'prototype'].includes(node.binding)) {
      setError('请先填写有效的目录绑定名称');
      return;
    }
    choosing.current = true;
    setSaving(true);
    const binding = node.binding;
    try {
      const path = await window.flowark.request('file.choose', { kind: 'directory' });
      if (alive.current && path)
        setDraft((current) => ({
          ...current,
          bindings: { ...current.bindings, files: { ...current.bindings.files, [binding]: path } },
        }));
    } catch (error) {
      if (alive.current) report(error);
    } finally {
      choosing.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const rows = preview?.available
    ? preview.rows.slice(Number(node.includeHeaders), Number(node.includeHeaders) + 3)
    : [];
  const columns = [...node.mappings].sort(
    (a, b) => a.column.length - b.column.length || a.column.localeCompare(b.column),
  );
  const columnIndex = (name: string) =>
    [...name].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return (
    <section className="excel-mapping-page page" aria-label="Excel 字段映射" ref={root}>
      <header>
        <h1 tabIndex={-1}>Excel：预览数据并映射字段</h1>
        <p>写入普通工作簿 · 修改草稿，不自动修改源文件</p>
      </header>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={saving}>
        <div className="excel-workbook-fields">
          <ValueField
            label="工作簿"
            value={node.name}
            choices={choices}
            defaultValue="mapped.xlsx"
            change={(name) => change({ ...node, name })}
          >
            {typeof node.name === 'string' ? (
              <label>
                工作簿
                <input
                  aria-label="输出工作簿"
                  data-excel-field="name"
                  value={node.name}
                  onChange={(event) => change({ ...node, name: event.target.value })}
                />
              </label>
            ) : undefined}
          </ValueField>
          <label>
            工作表
            <input
              aria-label="映射工作表"
              data-excel-field="sheet"
              value={node.sheet}
              onChange={(event) => change({ ...node, sheet: event.target.value })}
            />
          </label>
          <label>
            写入方式
            <input value="新建文件 · 不覆盖" readOnly />
          </label>
        </div>
        <div className="excel-mapping-columns">
          <section className="ai-task-card excel-mapping-list" aria-label="字段映射配置">
            <h2>字段映射</h2>
            <div className="excel-mapping-rows">
              {node.mappings.map((item, i) => (
                <div className="excel-mapping-row" key={i} data-mapping={i}>
                  <label>
                    来源
                    <input
                      aria-label={`映射 ${i + 1} 来源`}
                      data-excel-field="source"
                      value={item.source}
                      placeholder="记录字段名，或数组索引 0"
                      onChange={(event) => patchMapping(i, { source: event.target.value })}
                    />
                  </label>
                  <label>
                    目标列
                    <input
                      aria-label={`映射 ${i + 1} 目标列`}
                      data-excel-field="column"
                      value={item.column}
                      onChange={(event) =>
                        patchMapping(i, { column: event.target.value.toUpperCase() })
                      }
                    />
                  </label>
                  <details className="excel-column-options">
                    <summary>
                      {item.header || '无表头'} ·{' '}
                      {{ text: '文本', number: '数字', boolean: '布尔' }[item.type]}
                    </summary>
                    <label>
                      表头
                      <input
                        aria-label={`映射 ${i + 1} 表头`}
                        data-excel-field="header"
                        value={item.header}
                        onChange={(event) => patchMapping(i, { header: event.target.value })}
                      />
                    </label>
                    <label>
                      类型
                      <select
                        aria-label={`映射 ${i + 1} 类型`}
                        data-excel-field="type"
                        value={item.type}
                        onChange={(event) =>
                          patchMapping(i, { type: event.target.value as ExcelMapping['type'] })
                        }
                      >
                        <option value="text">文本</option>
                        <option value="number">数字</option>
                        <option value="boolean">布尔</option>
                      </select>
                    </label>
                    <button
                      onClick={() =>
                        change({
                          ...node,
                          mappings: node.mappings.filter(
                            (_, j) => j !== i,
                          ) as MappedExcel['mappings'],
                        })
                      }
                    >
                      删除映射 {i + 1}
                    </button>
                  </details>
                </div>
              ))}
            </div>
            <div className="excel-actions">
              <button
                data-excel-field="mappings"
                disabled={node.mappings.length >= 256}
                onClick={() => {
                  let i = 0;
                  while (node.mappings.some((item) => item.column === columnName(i))) i++;
                  change({
                    ...node,
                    mappings: [
                      ...node.mappings,
                      { source: '', column: columnName(i), header: '', type: 'text' },
                    ],
                  });
                }}
              >
                添加映射
              </button>
              <button
                className="primary"
                onClick={() => {
                  try {
                    setPreview(validate());
                    setError('');
                  } catch (error) {
                    report(error);
                  }
                }}
              >
                预览 3 行
              </button>
            </div>
            <details className="excel-source-settings">
              <summary>来源数据、输出目录与表头</summary>
              <ValueField
                label="来源记录"
                value={node.rows}
                choices={choices}
                defaultValue={[]}
                change={(rows) => change({ ...node, rows })}
              />
              <label>
                输出目录绑定
                <input
                  aria-label="映射目录绑定"
                  value={node.binding}
                  onChange={(event) => change({ ...node, binding: event.target.value })}
                />
              </label>
              <p className="path-text">
                {draft.bindings.files[node.binding] || '尚未绑定；运行前需要选择输出目录'}
              </p>
              <button onClick={choose}>选择输出目录</button>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={node.includeHeaders}
                  onChange={(event) => change({ ...node, includeHeaders: event.target.checked })}
                />
                首行写入表头
              </label>
            </details>
          </section>
          <section className="ai-task-card excel-data-preview" aria-label="写入预览">
            <h2>写入预览{preview?.available ? ` · ${rows.length} 行` : ''}</h2>
            {preview?.available ? (
              <>
                <p>
                  已核对全部 {preview.count} 条记录。以下显示前 {rows.length} 条，未写入文件。
                </p>
                <div className="excel-preview-scroll">
                  <table aria-label="Excel 映射预览">
                    <thead>
                      <tr>
                        {columns.map((item) => (
                          <th key={item.column}>
                            {item.column}
                            {node.includeHeaders && ` · ${item.header}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i}>
                          {columns.map((item) => (
                            <td key={item.column}>
                              {row[columnIndex(item.column)] === null ? (
                                <span className="muted">空</span>
                              ) : (
                                String(row[columnIndex(item.column)])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="note">未映射的列保留空白；预览仅展示选定列。</p>
              </>
            ) : (
              <p>
                {preview && !preview.available
                  ? preview.reason
                  : '点击「预览 3 行」核对来源及映射。修改配置后需要重新预览。'}
              </p>
            )}
            <div className="excel-mapping-note">
              空值策略：保留空单元格。类型冲突时阻止保存并定位字段；公式和宏不在本次能力范围。
            </div>
          </section>
        </div>
        <footer className="excel-actions">
          <button className="primary" onClick={() => void persist()}>
            {saving ? '正在保存…' : '保存映射并返回'}
          </button>
          <button onClick={() => navigation.current?.()}>取消</button>
        </footer>
      </fieldset>
      <dialog
        ref={dialog}
        className="script-leave-dialog"
        onCancel={(event) => {
          event.preventDefault();
          setPending(undefined);
        }}
      >
        <h2>映射有未保存的修改</h2>
        <p>保存后离开，或放弃本次映射编辑。</p>
        <div>
          <button className="primary" disabled={saving} onClick={() => void persist(pending?.next)}>
            保存并离开
          </button>
          <button disabled={saving} onClick={() => close(pending?.next)}>
            放弃修改
          </button>
          <button disabled={saving} onClick={() => setPending(undefined)}>
            继续编辑
          </button>
        </div>
      </dialog>
    </section>
  );
}
