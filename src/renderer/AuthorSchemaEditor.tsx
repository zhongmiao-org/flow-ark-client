import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  ConfigProvider,
  Input,
  InputNumber,
  Select,
} from 'antd';
import { Field } from './TemplateConfiguration';
import { schemaDefaults } from '../shared/template-config';
type Path = string[];
const types = ['object', 'array', 'string', 'number', 'integer', 'boolean'];
const typeName: Record<string, string> = {
  object: '对象',
  array: '数组',
  string: '文本',
  number: '数值',
  integer: '整数',
  boolean: '布尔',
  any: '任意JSON',
};
const object = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
function at(schema: any, path: Path): any {
  return path.reduce((s, k) => object(s)[k], schema) ?? {};
}
function rows(
  schema: any,
  path: Path = [],
  name = '根结构',
  depth = 0,
): { path: Path; name: string; depth: number }[] {
  if (depth > 12) return [];
  const s = object(schema),
    result = [{ path, name, depth }];
  for (const [k, v] of Object.entries(s.properties ?? {}))
    result.push(...rows(v, [...path, 'properties', k], k, depth + 1));
  if (s.items) result.push(...rows(s.items, [...path, 'items'], '数组项', depth + 1));
  return result;
}
export default function AuthorSchemaEditor({
  schema,
  change,
  disabled,
  pending,
  label,
  form = true,
  rootObject = false,
}: {
  schema: any;
  change: (v: any) => void;
  disabled: boolean;
  pending: (v: boolean) => void;
  label: string;
  form?: boolean;
  rootObject?: boolean;
}) {
  const [path, setPath] = useState<Path>([]),
    [keyDraft, setKeyDraft] = useState(''),
    [error, setError] = useState(''),
    [raw, setRaw] = useState<string>(),
    [preview, setPreview] = useState(false),
    [previewValue, setPreviewValue] = useState<any>();
  const [validating, setValidating] = useState(false);
  const visit = useRef(0);
  useEffect(() => {
    visit.current++;
    setValidating(false);
    return () => {
      visit.current++;
    };
  }, [disabled]);
  async function check(value: any, asForm: boolean, apply: () => void) {
    const generation = ++visit.current;
    setValidating(true);
    try {
      if (rootObject && value.type && value.type !== 'object')
        throw Error('入口输入的根结构须为对象，请在对象内添加数组或其他字段。');
      await window.flowark.request('author.schema.check', { schema: value, form: asForm });
      if (generation === visit.current) apply();
    } catch (e) {
      if (generation === visit.current)
        setError(e instanceof Error ? e.message : '结构核对失败，输入保留');
    } finally {
      if (generation === visit.current) setValidating(false);
    }
  }
  const current = object(at(schema, path)),
    key = path.at(-2) === 'properties' ? path.at(-1) : undefined;
  const keyDirty = key !== undefined && keyDraft !== key,
    rawDirty = raw !== undefined && raw !== JSON.stringify(schema, null, 2),
    dirty = keyDirty || rawDirty;
  useEffect(() => {
    pending(dirty);
    return () => pending(false);
  }, [dirty]);
  useEffect(() => {
    setKeyDraft(key ?? '');
  }, [JSON.stringify(path)]);
  function replace(value: any, where = path) {
    const next = structuredClone(schema);
    if (!where.length) {
      change(value);
      return;
    }
    const parent = at(next, where.slice(0, -1));
    parent[where.at(-1)!] = value;
    change(next);
  }
  const update = (key: string, value: any) => {
    const next = { ...current };
    if (value === undefined) delete next[key];
    else next[key] = value;
    replace(next);
    setPreview(false);
  };
  const select = (next: Path) => {
    if (dirty) {
      setError('请先应用或取消当前字段键/高级Schema编辑，输入已保留');
      return;
    }
    setPath(next);
    setError('');
    setKeyDraft(next.at(-2) === 'properties' ? next.at(-1)! : '');
  };
  const add = () => {
    if (dirty) return;
    let k = 'field',
      i = 2;
    const properties = object(current.properties);
    while (Object.hasOwn(properties, k)) k = 'field' + i++;
    replace({
      ...current,
      type: 'object',
      properties: { ...properties, [k]: { type: 'string', title: '新字段' } },
      additionalProperties: current.additionalProperties ?? false,
    });
    setPath([...path, 'properties', k]);
    setKeyDraft(k);
  };
  const rename = () => {
    if (!key) return;
    if (!keyDraft.trim() || ['__proto__', 'prototype', 'constructor'].includes(keyDraft)) {
      setError('字段键不能为空或使用保留名称');
      return;
    }
    const parent = at(schema, path.slice(0, -2));
    if (keyDraft !== key && Object.hasOwn(parent.properties ?? {}, keyDraft)) {
      setError('同级字段键已存在，当前输入保留');
      return;
    }
    const next = structuredClone(parent);
    next.properties = Object.fromEntries(
      Object.entries(next.properties).map(([k, v]) => [k === key ? keyDraft : k, v]),
    );
    if (next.required) next.required = next.required.map((v: string) => (v === key ? keyDraft : v));
    replace(next, path.slice(0, -2));
    setPath([...path.slice(0, -1), keyDraft]);
    setError('字段键已修改，请核对流程中的已有引用。');
  };
  const remove = () => {
    if (!key) return;
    const parent = structuredClone(at(schema, path.slice(0, -2)));
    delete parent.properties[key];
    if (parent.required) parent.required = parent.required.filter((v: string) => v !== key);
    replace(parent, path.slice(0, -2));
    setPath(path.slice(0, -2));
    setKeyDraft('');
  };
  const constraints =
    current.type === 'string'
      ? ['minLength', 'maxLength']
      : ['number', 'integer'].includes(current.type)
        ? ['minimum', 'maximum']
        : current.type === 'array'
          ? ['maxItems']
          : [];
  function changeType(value: string, where = path) {
    if (dirty) {
      setError('请先完成当前字段键或高级编辑');
      return;
    }
    const next = { ...object(at(schema, where)) };
    for (const k of [
      'type',
      'properties',
      'required',
      'additionalProperties',
      'items',
      'minimum',
      'maximum',
      'minLength',
      'maxLength',
      'maxItems',
      'enum',
      'oneOf',
      'const',
      'default',
    ])
      delete next[k];
    if (value !== 'any') next.type = value;
    if (value === 'object') {
      next.properties = {};
      next.additionalProperties = false;
    }
    if (value === 'array') next.items = { type: 'string' };
    replace(next, where);
    setError('类型已切换，不适用的子项和约束已移除；保存前可重新核对。');
  }
  const options =
    current.oneOf ?? current.enum?.map((v: any) => ({ const: v, title: String(v) })) ?? [];
  function option(index: number, part: string, value: any) {
    const list = structuredClone(options);
    list[index] = { ...list[index], [part]: value };
    const next = { ...current, oneOf: list };
    delete next.enum;
    replace(next);
  }
  return (
    <div className="author-schema" aria-label={label + '字段编辑'}>
      {error && <Alert type="warning" title={error} />}
      <ConfigProvider componentDisabled={disabled || rawDirty || validating}>
        <div className="author-grid">
          <Card title={'字段树 · ' + label}>
            <div className="author-field-tree" role="group" aria-label="可视化字段树">
              {rows(schema).map((row) => {
                const s = object(at(schema, row.path));
                return (
                  <div
                    className="author-schema-row"
                    key={JSON.stringify(row.path)}
                    style={{ paddingInlineStart: row.depth * 12 }}
                  >
                    <Button
                      type={
                        JSON.stringify(row.path) === JSON.stringify(path) ? 'primary' : 'default'
                      }
                      className="author-tree-row"
                      onClick={() => select(row.path)}
                    >
                      {row.name}
                    </Button>
                    <Select
                      aria-label={row.name + '字段类型'}
                      value={s.type ?? 'any'}
                      options={(rootObject && !row.path.length
                        ? ['object']
                        : [...types, 'any']
                      ).map((value) => ({
                        value,
                        label: typeName[value],
                      }))}
                      onChange={(value) => changeType(value, row.path)}
                    />
                    {row.path.at(-2) === 'properties' && (
                      <Checkbox
                        checked={(at(schema, row.path.slice(0, -2)).required ?? []).includes(
                          row.path.at(-1),
                        )}
                        onChange={(e) => {
                          const p = structuredClone(at(schema, row.path.slice(0, -2))),
                            k = row.path.at(-1)!;
                          p.required = e.target.checked
                            ? [...new Set([...(p.required ?? []), k])]
                            : (p.required ?? []).filter((v: string) => v !== k);
                          replace(p, row.path.slice(0, -2));
                        }}
                      >
                        必填
                      </Checkbox>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="author-actions">
              <Button disabled={disabled || dirty} onClick={add}>
                添加子字段
              </Button>
              <Button
                onClick={() => {
                  void check(schema, true, () => {
                    setPreviewValue(schemaDefaults(schema));
                    setPreview(!preview);
                  });
                }}
              >
                预览使用者表单
              </Button>
            </div>
            <p>对象和数组逐层维护；字段键变化后请检查已有引用。公开默认值不复制本机输入。</p>
          </Card>
          <Card title={'所选字段 · ' + (key ?? (path.at(-1) === 'items' ? '数组项' : '根结构'))}>
            {key !== undefined && (
              <div className="author-field">
                <label htmlFor="author-field-key">字段键</label>
                <div className="author-stack">
                  <Input
                    id="author-field-key"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                  />
                  <div className="author-actions">
                    <Button disabled={!keyDirty || disabled} onClick={rename}>
                      应用字段键
                    </Button>
                    <Button
                      disabled={!keyDirty || disabled}
                      onClick={() => {
                        setKeyDraft(key);
                        setError('');
                      }}
                    >
                      取消键修改
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div className="author-field">
              <label htmlFor="author-field-title">显示名称</label>
              <Input
                id="author-field-title"
                value={current.title ?? ''}
                onChange={(e) => update('title', e.target.value)}
              />
            </div>
            <div className="author-field">
              <span id="author-field-type">类型</span>
              <Select
                aria-labelledby="author-field-type"
                value={current.type ?? 'any'}
                options={(rootObject && !path.length ? ['object'] : [...types, 'any']).map(
                  (value) => ({ value, label: typeName[value] }),
                )}
                onChange={(value) => changeType(value)}
              />
            </div>
            <div className="author-field">
              <label htmlFor="author-field-description">说明</label>
              <Input.TextArea
                id="author-field-description"
                value={current.description ?? ''}
                autoSize={{ minRows: 2, maxRows: 5 }}
                onChange={(e) => update('description', e.target.value)}
              />
            </div>
            {key !== undefined && (
              <Checkbox
                checked={(at(schema, path.slice(0, -2)).required ?? []).includes(key)}
                onChange={(e) => {
                  const p = structuredClone(at(schema, path.slice(0, -2))),
                    list = (p.required ?? []).filter((v: string) => v !== key);
                  p.required = e.target.checked ? [...list, key] : list;
                  replace(p, path.slice(0, -2));
                }}
              >
                必填
              </Checkbox>
            )}
            {current.type === 'object' && (
              <Checkbox
                checked={current.additionalProperties === false}
                onChange={(e) => update('additionalProperties', !e.target.checked)}
              >
                拒绝未声明字段
              </Checkbox>
            )}
            <Checkbox
              checked={current.readOnly === true}
              onChange={(e) => update('readOnly', e.target.checked || undefined)}
            >
              只读字段
            </Checkbox>
            {constraints.map((k) => (
              <div className="author-field" key={k}>
                <label htmlFor={'author-constraint-' + k}>
                  {
                    {
                      minLength: '最少字符',
                      maxLength: '最多字符',
                      minimum: '最小值',
                      maximum: '最大值',
                      maxItems: '最多项数',
                    }[k]
                  }
                </label>
                <InputNumber
                  id={'author-constraint-' + k}
                  value={current[k]}
                  min={['minimum', 'maximum'].includes(k) ? undefined : 0}
                  precision={
                    current.type === 'number' && ['minimum', 'maximum'].includes(k) ? undefined : 0
                  }
                  onChange={(v) => update(k, v ?? undefined)}
                />
              </div>
            ))}
            {current.type === 'array' && (
              <Button
                onClick={() => {
                  if (!current.items) update('items', { type: 'string' });
                  select([...path, 'items']);
                }}
              >
                编辑数组项结构
              </Button>
            )}
            {['string', 'number', 'integer', 'boolean'].includes(current.type) && (
              <div className="author-stack">
                <span>选项列表（公开）</span>
                {options.map((o: any, i: number) => (
                  <div className="author-option" key={i}>
                    {current.type === 'boolean' ? (
                      <Checkbox
                        checked={o.const === true}
                        onChange={(e) => option(i, 'const', e.target.checked)}
                      >
                        值
                      </Checkbox>
                    ) : current.type === 'string' ? (
                      <Input
                        aria-label={'选项' + (i + 1) + '值'}
                        value={typeof o.const === 'string' ? o.const : ''}
                        onChange={(e) => option(i, 'const', e.target.value)}
                      />
                    ) : (
                      <InputNumber
                        aria-label={'选项' + (i + 1) + '值'}
                        value={o.const}
                        precision={current.type === 'integer' ? 0 : undefined}
                        onChange={(v) => option(i, 'const', v ?? 0)}
                      />
                    )}
                    <Input
                      aria-label={'选项' + (i + 1) + '名称'}
                      value={o.title ?? ''}
                      onChange={(e) => option(i, 'title', e.target.value)}
                    />
                    <Button
                      aria-label={'移除选项' + (i + 1)}
                      onClick={() => {
                        const next = {
                          ...current,
                          oneOf: options.filter((_: any, j: number) => j !== i),
                        };
                        delete next.enum;
                        if (!next.oneOf.length) delete next.oneOf;
                        replace(next);
                      }}
                    >
                      移除
                    </Button>
                  </div>
                ))}
                <Button
                  onClick={() => {
                    const next = {
                      ...current,
                      oneOf: [
                        ...options,
                        {
                          const:
                            current.type === 'string'
                              ? '选项' + (options.length + 1)
                              : current.type === 'boolean'
                                ? false
                                : options.length,
                          title: '新选项',
                        },
                      ],
                    };
                    delete next.enum;
                    replace(next);
                  }}
                >
                  添加选项
                </Button>
              </div>
            )}
            <Checkbox
              checked={Object.hasOwn(current, 'default')}
              onChange={(e) =>
                update('default', e.target.checked ? schemaDefaults(current) : undefined)
              }
            >
              设置公开默认值
            </Checkbox>
            {Object.hasOwn(current, 'default') && (
              <Field
                schema={{ ...current, title: '公开默认值', readOnly: false }}
                value={current.default}
                label="公开默认值"
                change={(v: any) => update('default', v)}
              />
            )}
            {key !== undefined && (
              <Button danger disabled={disabled || dirty} onClick={remove}>
                移除此字段
              </Button>
            )}
          </Card>
        </div>
      </ConfigProvider>
      {preview && (
        <Card title="使用者表单预览">
          <Field schema={schema} value={previewValue} change={setPreviewValue} label="预览" />
          <p>仅预览字段，不保存使用者输入或调用模型。</p>
        </Card>
      )}
      <Collapse
        items={[
          {
            key: 'advanced',
            label: '高级Schema（可选）',
            children: (
              <div className="author-stack">
                <Input.TextArea
                  aria-label="高级Schema JSON"
                  value={raw ?? JSON.stringify(schema, null, 2)}
                  autoSize={{ minRows: 8, maxRows: 22 }}
                  disabled={disabled || validating}
                  onChange={(e) => setRaw(e.target.value)}
                />
                <div className="author-actions">
                  <Button
                    disabled={disabled || validating || !rawDirty}
                    onClick={() => {
                      try {
                        const v = JSON.parse(raw!);
                        if (!v || typeof v !== 'object' || Array.isArray(v))
                          throw Error('Schema须为对象');
                        void check(v, form, () => {
                          change(v);
                          setRaw(undefined);
                          setPath([]);
                          setKeyDraft('');
                          setError('');
                        });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Schema无效，输入保留');
                      }
                    }}
                  >
                    应用Schema
                  </Button>
                  <Button
                    disabled={disabled || validating || !rawDirty}
                    onClick={() => setRaw(undefined)}
                  >
                    取消高级编辑
                  </Button>
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
