import { Alert, Button, Input, Select, Tree, type TreeDataNode } from 'antd';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Json } from '../shared/types';
import VariablePicker from './VariablePicker';
import { VariableNavigationContext } from './variable-navigation';
import { referenceOf, type ReferenceChoice } from './value-references';
import { checkVisualReference, type JsonContainer } from './workflow-value-model';
import {
  jsonAt,
  jsonDefault,
  jsonInput,
  jsonKind,
  jsonKindLabel,
  jsonPathLabel,
  jsonRemove,
  jsonRename,
  jsonReplace,
  jsonText,
  type JsonKind,
  type JsonPath,
} from './json-tree-model';
import './json-tree-editor.css';

type FieldKind = JsonKind | 'reference';
type FieldDraft = { name: string; kind: FieldKind; text: string };
const kindLabels = { ...jsonKindLabel, reference: '变量引用' };
const keyOf = (path: JsonPath) => JSON.stringify(path);
export default function JsonTreeEditor({
  value,
  change,
  disabled,
  onPendingChange,
  rootLabel = 'data',
  allowArrayRoot = false,
  choices,
}: {
  value: JsonContainer;
  change: (value: JsonContainer) => void;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
  rootLabel?: string;
  allowArrayRoot?: boolean;
  choices?: ReferenceChoice[];
}) {
  const describe = (value: Json, path: JsonPath): FieldDraft => {
    const ref = choices !== undefined ? referenceOf(value) : undefined;
    return {
      name: String(path.at(-1) ?? rootLabel),
      kind: ref !== undefined ? 'reference' : jsonKind(value),
      text: ref ?? jsonText(value),
    };
  };
  const root = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState(false);
  const [path, setPath] = useState<JsonPath>([]);
  const [base, setBase] = useState(() => describe(value, []));
  const [draft, setDraft] = useState(base);
  const [baseValue, setBaseValue] = useState<Json>(value);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [review, setReview] = useState<'type' | 'remove'>();
  const [expanded, setExpanded] = useState<string[]>(() => {
    const result: string[] = [];
    const visit = (node: Json, path: JsonPath) => {
      if (!node || typeof node !== 'object' || (choices && referenceOf(node) !== undefined)) return;
      result.push(keyOf(path));
      for (const [name, child] of Object.entries(node))
        visit(child, [...path, Array.isArray(node) ? Number(name) : name]);
    };
    visit(value, []);
    return result;
  });
  const pending = JSON.stringify(base) !== JSON.stringify(draft);
  const valueText = JSON.stringify(value),
    previousValue = useRef(valueText);
  const load = (nextPath: JsonPath, next: Json = value) => {
    const current = jsonAt(next, nextPath),
      d = describe(current, nextPath);
    setPath(nextPath);
    setBase(d);
    setDraft(d);
    setBaseValue(current);
    setError('');
    setReview(undefined);
  };
  useLayoutEffect(() => {
    onPendingChange(pending || !!review);
  }, [pending, review, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);
  useLayoutEffect(() => {
    if (previousValue.current === valueText) return;
    previousValue.current = valueText;
    if (pending) return;
    try {
      load(path);
    } catch {
      load([]);
    }
  }, [valueText]);
  const currentPath = rootLabel + jsonPathLabel(path).slice(4);
  const focusEditor = () =>
    root.current
      ?.querySelector<HTMLElement>(
        '.json-current input.ant-input:not(:disabled), .json-current textarea:not(:disabled)',
      )
      ?.focus();
  const canLeave = () => {
    if (!pending && !review) return true;
    setError('请先应用当前字段，或放弃当前编辑。');
    focusEditor();
    return false;
  };
  const treeData = useMemo(() => {
    function node(v: Json, p: JsonPath): TreeDataNode {
      const name = p.length
        ? typeof p.at(-1) === 'number'
          ? '[' + p.at(-1) + ']'
          : String(p.at(-1)) || '（空名称）'
        : rootLabel;
      const kind = describe(v, p).kind;
      const children =
        v && typeof v === 'object' && kind !== 'reference'
          ? Object.entries(v).map(([k, child]) =>
              node(child, [...p, Array.isArray(v) ? Number(k) : k]),
            )
          : undefined;
      return {
        key: keyOf(p),
        title: (
          <span title={rootLabel + jsonPathLabel(p).slice(4)}>
            {name} · {kindLabels[kind]}
          </span>
        ),
        children,
      };
    }
    return [node(value, [])];
  }, [valueText, choices, rootLabel]);
  const commit = (next: Json, nextPath: JsonPath, message: string) => {
    change(next as JsonContainer);
    load(nextPath, next);
    setExpanded((current) => [
      ...new Set([
        ...current,
        ...nextPath.map((_, index) => keyOf(nextPath.slice(0, index + 1))),
        keyOf([]),
      ]),
    ]);
    setNotice(message);
    requestAnimationFrame(() => {
      const target =
        root.current?.querySelector<HTMLElement>(
          '.json-current input.ant-input:not(:disabled), .json-current textarea:not(:disabled)',
        ) ?? root.current?.querySelector<HTMLElement>('.json-field-tree [role="tree"]');
      target?.focus();
    });
  };
  const attempt = (action: () => void) => {
    if (disabled) return;
    try {
      action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '字段未应用，当前输入保留。');
    }
  };
  const current = () => {
    const v = jsonAt(value, path);
    if (JSON.stringify(v) !== JSON.stringify(baseValue))
      throw Error('当前字段内容已变化，请放弃当前编辑后重新核对。');
    return v;
  };
  const apply = (confirmed = false) =>
    attempt(() => {
      const original = current(),
        next =
          draft.kind === 'reference'
            ? { $ref: draft.text }
            : base.kind === 'reference' && draft.kind === 'object'
              ? {}
              : jsonInput(draft.kind, draft.text, original);
      if (draft.kind === 'reference') checkVisualReference(draft.text, choices!);
      if (!path.length && !(allowArrayRoot ? ['object', 'array'] : ['object']).includes(draft.kind))
        throw Error(allowArrayRoot ? '根值必须保留为对象或数组。' : 'data根必须保留为对象。');
      // Check duplicate names before asking to replace a value.
      const result = jsonRename(value, path, draft.name, next);
      if (draft.kind !== base.kind && !confirmed) {
        setReview('type');
        return;
      }
      const nextPath =
        path.length && typeof path.at(-1) === 'string' ? [...path.slice(0, -1), draft.name] : path;
      commit(result, nextPath, '字段已应用到当前草稿。');
    });
  const remove = () =>
    attempt(() => {
      current();
      commit(jsonRemove(value, path), path.slice(0, -1), '字段已从当前草稿移除。');
    });
  const add = () =>
    attempt(() => {
      if (!canLeave()) return;
      const original = current();
      if (Array.isArray(original)) {
        commit(
          jsonReplace(value, path, [...original, '']),
          [...path, original.length],
          '已添加数组条目，请核对当前值。',
        );
      } else if (original && typeof original === 'object') {
        let index = 1;
        while (Object.hasOwn(original, '字段' + index)) index++;
        const name = '字段' + index;
        commit(
          jsonReplace(value, path, Object.fromEntries([...Object.entries(original), [name, '']])),
          [...path, name],
          '已添加字段，请编辑名称和当前值。',
        );
      }
    });
  const move = (delta: number) =>
    attempt(() => {
      if (!canLeave()) return;
      const parentPath = path.slice(0, -1),
        parent = jsonAt(value, parentPath);
      const index = path.at(-1);
      if (!Array.isArray(parent) || typeof index !== 'number') return;
      const target = index + delta;
      if (target < 0 || target >= parent.length) return;
      const next = [...parent];
      [next[index], next[target]] = [next[target], next[index]];
      commit(
        jsonReplace(value, parentPath, next),
        [...parentPath, target],
        '数组顺序已应用到当前草稿。',
      );
    });
  const arrayItem = typeof path.at(-1) === 'number';
  const arrayLength = arrayItem ? (jsonAt(value, path.slice(0, -1)) as Json[]).length : 0;
  return (
    <div
      className="json-tree-editor"
      ref={root}
      data-value-invalid={pending || review ? '请先应用或放弃当前字段编辑。' : undefined}
    >
      <div className="json-tree-columns">
        <div className="json-field-tree" aria-label="结构化字段树">
          <Tree
            treeData={treeData}
            expandedKeys={expanded}
            onExpand={(keys) => setExpanded(keys.map(String))}
            height={320}
            blockNode
            disabled={disabled}
            selectedKeys={[keyOf(path)]}
            onSelect={(keys) => {
              if (!keys.length || !canLeave()) return;
              load(JSON.parse(String(keys[0])));
              setNotice('');
            }}
          />
        </div>
        <section className="json-current" aria-label="当前字段">
          <strong className="json-path">当前字段 · {currentPath}</strong>
          <div className="json-name-type">
            <Input
              aria-label="当前字段名称"
              disabled={disabled || !path.length || arrayItem}
              value={draft.name}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                setError('');
                setReview(undefined);
              }}
            />
            <Select
              aria-label="当前字段类型"
              disabled={disabled || (!path.length && !allowArrayRoot)}
              value={draft.kind}
              options={(Object.entries(kindLabels) as [FieldKind, string][])
                .filter(([kind]) =>
                  !path.length
                    ? ['object', ...(allowArrayRoot ? ['array'] : [])].includes(kind)
                    : kind !== 'reference' || choices !== undefined,
                )
                .map(([value, label]) => ({ value, label }))}
              onChange={(kind) => {
                setDraft({
                  ...draft,
                  kind,
                  text:
                    kind === base.kind
                      ? describe(baseValue, path).text
                      : kind === 'reference'
                        ? ''
                        : jsonText(jsonDefault(kind)),
                });
                setReview(undefined);
                setError('');
              }}
            />
          </div>
          {draft.kind === 'reference' && (
            <>
              <p className="json-path">
                {choices?.find((choice) => choice.path === draft.text)?.label ??
                  (draft.text ? '变量路径 · ' + draft.text : '尚未选择变量')}
              </p>
              <Button disabled={disabled} onClick={() => setPicker(true)}>
                选择 / 更换变量
              </Button>
            </>
          )}
          {(draft.kind === 'string' || draft.kind === 'number') && (
            <Input.TextArea
              aria-label="当前字段值"
              disabled={disabled}
              value={draft.text}
              autoSize={{ minRows: draft.kind === 'string' ? 3 : 1, maxRows: 12 }}
              onChange={(e) => {
                setDraft({ ...draft, text: e.target.value });
                setError('');
                setReview(undefined);
              }}
            />
          )}
          {draft.kind === 'boolean' && (
            <Select
              aria-label="当前字段值"
              value={draft.text}
              disabled={disabled}
              options={[
                { value: 'true', label: 'true · 是' },
                { value: 'false', label: 'false · 否' },
              ]}
              onChange={(text) => {
                setDraft({ ...draft, text });
                setError('');
                setReview(undefined);
              }}
            />
          )}
          {['object', 'array', 'null'].includes(draft.kind) && (
            <p>
              {kindLabels[draft.kind]}
              {draft.kind === base.kind && baseValue && typeof baseValue === 'object'
                ? ` · ${Object.keys(baseValue).length} 个直接子项`
                : ''}
              。在字段树中选择子项继续编辑。
            </p>
          )}
          <div className="skill-actions">
            <Button type="primary" disabled={disabled || !pending} onClick={() => apply()}>
              应用字段
            </Button>
            <Button
              disabled={disabled || (!pending && !review && !error)}
              onClick={() => {
                load(path);
                setNotice('已放弃当前字段的未应用编辑。');
              }}
            >
              放弃当前编辑
            </Button>
          </div>
          <div className="skill-actions">
            {['object', 'array'].includes(base.kind) && (
              <Button disabled={disabled || pending || !!review} onClick={add}>
                添加子项
              </Button>
            )}
            {!!path.length && (
              <Button
                disabled={disabled || pending || !!review}
                onClick={() => setReview('remove')}
              >
                移除字段
              </Button>
            )}
            {arrayItem && (
              <>
                <Button
                  disabled={disabled || pending || !!review || path.at(-1) === 0}
                  onClick={() => move(-1)}
                >
                  向上移动
                </Button>
                <Button
                  disabled={disabled || pending || !!review || path.at(-1) === arrayLength - 1}
                  onClick={() => move(1)}
                >
                  向下移动
                </Button>
              </>
            )}
          </div>
          {error && <Alert type="error" title={error} role="alert" />}
          {review && (
            <Alert
              type="warning"
              title={review === 'type' ? '更换字段类型会替换原值' : '移除字段及其子项'}
              description={
                <div className="json-review">
                  <p className="json-path">
                    {currentPath}{' '}
                    {review === 'type'
                      ? `${kindLabels[base.kind]} → ${kindLabels[draft.kind]}`
                      : ''}
                  </p>
                  <p>
                    当前值
                    {baseValue && typeof baseValue === 'object'
                      ? `及 ${Object.keys(baseValue).length} 个直接子项`
                      : ''}
                    将被{review === 'type' ? '替换' : '移除'}。取消保留当前编辑。
                  </p>
                  <div className="skill-actions">
                    <Button disabled={disabled} onClick={() => setReview(undefined)}>
                      取消
                    </Button>
                    <Button
                      type="primary"
                      disabled={disabled}
                      onClick={() => (review === 'type' ? apply(true) : remove())}
                    >
                      {review === 'type' ? '确认更换类型' : '确认移除'}
                    </Button>
                  </div>
                </div>
              }
            />
          )}
        </section>
      </div>
      {picker && choices && (
        <VariableNavigationContext.Provider value={undefined}>
          <VariablePicker
            label={currentPath}
            choices={choices}
            current={draft.kind === 'reference' ? draft.text : undefined}
            choose={(text) => {
              checkVisualReference(text, choices);
              setDraft({ ...draft, kind: 'reference', text });
              setReview(undefined);
              setError('');
            }}
            fixed={() => {
              setDraft({ ...draft, kind: 'string', text: '' });
              setReview(undefined);
              setError('');
            }}
            close={() => setPicker(false)}
          />
        </VariableNavigationContext.Provider>
      )}
      <p role="status" className="json-editor-status">
        {pending
          ? '有未应用字段编辑；先应用或放弃，再保存整个草稿。'
          : review
            ? '请先核对字段变更范围。'
            : notice}
      </p>
    </div>
  );
}
