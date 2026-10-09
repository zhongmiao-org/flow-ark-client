import { ConfigProvider, Select, Button, Checkbox, Input } from 'antd';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
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

const incompleteInputMessage = '请先修正未完成的输入配置';

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
    [saving, setSaving] = useState(false),
    [selectingDirectory, setSelectingDirectory] = useState(false);
  const busy = saving || selectingDirectory;
  const issueId = useId();
  const [issue, setIssue] = useState<{ field: string; mapping?: number }>();
  const focusRequest = useRef<string | undefined>(undefined);
  const [focusRevision, setFocusRevision] = useState(0);
  const [preview, setPreview] = useState<ReturnType<typeof mappingPreview>>();
  const [incompleteSource, setIncompleteSource] = useState(false);
  const sourceInputChanged = useCallback((_label: string, incomplete: boolean) => {
    setIncompleteSource(incomplete);
    if (incomplete) setPreview(undefined);
    else if (!root.current?.querySelector('[data-value-invalid]'))
      setError((current) => (current === incompleteInputMessage ? '' : current));
  }, []);
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
    setIssue(undefined);
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
  useEffect(() => {
    if (pending || !focusRequest.current) return;
    const element = root.current?.querySelector<HTMLElement>(focusRequest.current);
    if (!element) return;
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== root.current) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    const target = element.matches('input,textarea,select,button')
      ? element
      : (element.querySelector<HTMLElement>('textarea') ??
        element.querySelector<HTMLElement>('input,select,button') ??
        element);
    target.focus({ preventScroll: true });
    const scrollTarget = element.hasAttribute('data-excel-preview')
      ? (element.closest('.excel-data-preview') ?? target)
      : target;
    scrollTarget.scrollIntoView({ block: 'nearest' });
    focusRequest.current = undefined;
  }, [focusRevision, pending, draft]);
  const report = (reason: unknown) => {
    setFocusRevision((revision) => revision + 1);
    setError(reason instanceof Error ? reason.message : '配置未完成，请检查后重试');
    setPending(undefined);
    setPreview(undefined);
    if (reason instanceof ExcelMappingError) {
      setIssue({ field: reason.field, mapping: reason.mapping });
      focusRequest.current =
        reason.mapping === undefined
          ? `[data-excel-field="${reason.field}"]`
          : `[data-mapping="${reason.mapping}"] [data-excel-field="${reason.field}"]`;
    } else {
      setIssue(undefined);
      focusRequest.current = incomplete() ? '[data-value-invalid]' : '[data-excel-error]';
    }
  };
  const invalid = (field: string, mapping?: number) =>
    issue?.field === field && issue.mapping === mapping;
  const fieldProps = (field: string, mapping?: number) => ({
    'data-excel-field': field,
    'aria-invalid': invalid(field, mapping) || undefined,
    'aria-describedby': invalid(field, mapping)
      ? `${issueId}-${field}-${mapping ?? 'node'}`
      : undefined,
  });
  const fieldError = (field: string, mapping?: number) =>
    invalid(field, mapping) ? (
      <span className="excel-field-error" id={`${issueId}-${field}-${mapping ?? 'node'}`}>
        {error}
      </span>
    ) : null;
  const validate = () => {
    if (incomplete()) {
      const invalid = root.current?.querySelector<HTMLElement>('[data-value-invalid]');
      const details = invalid?.closest('details');
      if (details) details.open = true;
      invalid?.querySelector<HTMLElement>('textarea,input')?.focus();
      throw new Error(incompleteInputMessage);
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
      report(new ExcelMappingError('请先填写有效的目录绑定名称', 'binding'));
      return;
    }
    choosing.current = true;
    setSelectingDirectory(true);
    setError('');
    setIssue(undefined);
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
      if (alive.current) setSelectingDirectory(false);
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
        <p className="alert error" role="alert" data-excel-error tabIndex={-1}>
          {error}
        </p>
      )}
      <ConfigProvider componentDisabled={busy || undefined}>
        <fieldset disabled={busy}>
          <div className="excel-workbook-fields">
            <div className="excel-workbook-name" {...fieldProps('name')} tabIndex={-1}>
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
                    <Input
                      aria-label="输出工作簿"
                      {...fieldProps('name')}
                      value={node.name}
                      onChange={(event) => change({ ...node, name: event.target.value })}
                    />
                  </label>
                ) : undefined}
              </ValueField>
              {fieldError('name')}
            </div>
            <label>
              工作表
              <Input
                aria-label="映射工作表"
                {...fieldProps('sheet')}
                value={node.sheet}
                onChange={(event) => change({ ...node, sheet: event.target.value })}
              />
              {fieldError('sheet')}
            </label>
            <label>
              写入方式
              <Input value="新建文件 · 不覆盖" readOnly />
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
                      <Input
                        aria-label={`映射 ${i + 1} 来源`}
                        {...fieldProps('source', i)}
                        value={item.source}
                        placeholder="记录字段名，或数组索引 0"
                        onChange={(event) => patchMapping(i, { source: event.target.value })}
                      />
                      {fieldError('source', i)}
                    </label>
                    <label>
                      目标列
                      <Input
                        aria-label={`映射 ${i + 1} 目标列`}
                        {...fieldProps('column', i)}
                        value={item.column}
                        onChange={(event) =>
                          patchMapping(i, { column: event.target.value.toUpperCase() })
                        }
                      />
                      {fieldError('column', i)}
                    </label>
                    <details className="excel-column-options">
                      <summary>
                        {item.header || '无表头'} ·{' '}
                        {{ text: '文本', number: '数字', boolean: '布尔' }[item.type]}
                      </summary>
                      <label>
                        表头
                        <Input
                          aria-label={`映射 ${i + 1} 表头`}
                          {...fieldProps('header', i)}
                          value={item.header}
                          onChange={(event) => patchMapping(i, { header: event.target.value })}
                        />
                        {fieldError('header', i)}
                      </label>
                      <label>
                        类型
                        <Select<string>
                          aria-label={`映射 ${i + 1} 类型`}
                          {...fieldProps('type', i)}
                          value={item.type}
                          onChange={(value) =>
                            patchMapping(i, { type: value as ExcelMapping['type'] })
                          }
                          options={[
                            { value: 'text', label: '文本' },
                            { value: 'number', label: '数字' },
                            { value: 'boolean', label: '布尔' },
                          ]}
                        />
                        {fieldError('type', i)}
                      </label>
                      <Button
                        onClick={() => {
                          focusRequest.current =
                            node.mappings.length > 1
                              ? `[data-mapping="${Math.min(i, node.mappings.length - 2)}"] [data-excel-field="source"]`
                              : '[data-excel-field="mappings"]';
                          change({
                            ...node,
                            mappings: node.mappings.filter(
                              (_, j) => j !== i,
                            ) as MappedExcel['mappings'],
                          });
                        }}
                      >
                        删除映射 {i + 1}
                      </Button>
                    </details>
                  </div>
                ))}
              </div>
              <div className="excel-actions">
                <Button
                  {...fieldProps('mappings')}
                  disabled={node.mappings.length >= 256 || undefined}
                  onClick={() => {
                    let i = 0;
                    while (node.mappings.some((item) => item.column === columnName(i))) i++;
                    focusRequest.current = `[data-mapping="${node.mappings.length}"] [data-excel-field="source"]`;
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
                </Button>
                <Button
                  type="primary"
                  onClick={() => {
                    try {
                      setPreview(validate());
                      setError('');
                      setIssue(undefined);
                      focusRequest.current = '[data-excel-preview]';
                      setFocusRevision((revision) => revision + 1);
                    } catch (error) {
                      report(error);
                    }
                  }}
                >
                  预览 3 行
                </Button>
              </div>
              {fieldError('mappings')}
              <details className="excel-source-settings">
                <summary>来源数据、输出目录与表头</summary>
                <div className="excel-source-value" {...fieldProps('rows')} tabIndex={-1}>
                  <ValueField
                    label="来源记录"
                    value={node.rows}
                    choices={choices}
                    defaultValue={[]}
                    change={(rows) => change({ ...node, rows })}
                    onIncompleteChange={sourceInputChanged}
                  />
                  {fieldError('rows')}
                </div>
                <label>
                  输出目录绑定
                  <Input
                    aria-label="映射目录绑定"
                    {...fieldProps('binding')}
                    value={node.binding}
                    onChange={(event) => change({ ...node, binding: event.target.value })}
                  />
                  {fieldError('binding')}
                </label>
                <p className="path-text">
                  {draft.bindings.files[node.binding] || '尚未绑定；运行前需要选择输出目录'}
                </p>
                <Button onClick={choose}>
                  {selectingDirectory ? '正在选择目录…' : '选择输出目录'}
                </Button>
                <Checkbox
                  checked={node.includeHeaders}
                  onChange={(event) => change({ ...node, includeHeaders: event.target.checked })}
                  className="check-label"
                >
                  首行写入表头
                </Checkbox>
              </details>
            </section>
            <section className="ai-task-card excel-data-preview" aria-label="写入预览">
              <h2
                data-excel-preview
                tabIndex={-1}
                aria-describedby={`${issueId}-preview-description`}
              >
                写入预览{preview?.available ? ` · ${rows.length} 行` : ''}
              </h2>
              {preview?.available ? (
                <>
                  <div
                    className="excel-preview-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="映射结果表格，可滚动查看"
                  >
                    <table aria-label="Excel 映射预览">
                      <thead>
                        <tr>
                          {columns.map((item) => (
                            <th key={item.column} scope="col">
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
                  {!rows.length && <p>来源记录为空；当前预览没有数据行。</p>}
                </>
              ) : (
                <p id={`${issueId}-preview-description`} role="status">
                  {incompleteSource
                    ? '来源记录输入尚未完成。修正后重新预览。'
                    : preview && !preview.available
                      ? preview.reason
                      : '点击「预览 3 行」核对来源及映射。修改配置后需要重新预览。'}
                </p>
              )}
              <div className="excel-mapping-note">
                空值策略：保留空单元格。类型冲突时阻止保存并定位字段；公式和宏不在本次能力范围。
              </div>
              {preview?.available && (
                <p className="note" id={`${issueId}-preview-description`}>
                  已核对全部 {preview.count} 条记录。预览显示前 {rows.length} 条，未写入文件。
                  未映射的列保留空白，预览仅展示选定列。
                </p>
              )}
            </section>
          </div>
          <footer className="excel-actions">
            <Button type="primary" onClick={() => void persist()}>
              {saving ? '正在保存…' : '保存映射并返回'}
            </Button>
            <Button onClick={() => navigation.current?.()}>取消</Button>
          </footer>
        </fieldset>
      </ConfigProvider>
      <dialog
        ref={dialog}
        className="script-leave-dialog"
        aria-labelledby={`${issueId}-leave-title`}
        aria-describedby={`${issueId}-leave-description`}
        onCancel={(event) => {
          event.preventDefault();
          if (!persisting.current) setPending(undefined);
        }}
      >
        <h2 id={`${issueId}-leave-title`}>映射有未保存的修改</h2>
        <p id={`${issueId}-leave-description`}>保存后离开，或放弃本次映射编辑。</p>
        <div>
          <Button
            type="primary"
            disabled={saving || undefined}
            onClick={() => void persist(pending?.next)}
          >
            {saving ? '正在保存…' : '保存并离开'}
          </Button>
          <Button disabled={saving || undefined} onClick={() => close(pending?.next)}>
            放弃修改
          </Button>
          <Button disabled={saving || undefined} onClick={() => setPending(undefined)}>
            继续编辑
          </Button>
        </div>
      </dialog>
    </section>
  );
}
