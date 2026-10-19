import { readableReference } from './value-references';
import { Alert, Button, Card, Checkbox, Collapse, Input, Select, Space } from 'antd';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type {
  BrowserRenderedField,
  BrowserSelectionTextField,
  FramePath,
} from '../shared/contracts.generated';
import { assertBrowserFieldsNode, type BrowserFieldsNode } from '../shared/browser-fields';
import type { Json } from '../shared/types';
import type { ReferenceChoice } from './value-references';
import ValueField from './ValueField';
import NodeTiming from './NodeTiming';
import { activateCollapseWithSpace } from './collapseKeyboard';
import './browser-fields.css';
import FieldsElementPicker from './FieldsElementPicker';
type ConfigField = BrowserRenderedField | BrowserSelectionTextField;

export default function BrowserFieldsConfiguration({
  node,
  change,
  choices,
  summaryOnly = false,
  actions,
  pickingReady = true,
}: {
  node: BrowserFieldsNode;
  change: (node: BrowserFieldsNode) => void;
  choices: ReferenceChoice[];
  summaryOnly?: boolean;
  actions?: ReactNode;
  pickingReady?: boolean;
}) {
  const id = useId(),
    root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0),
    [draft, setDraft] = useState<ConfigField>(() => structuredClone(node.fields[0]));
  const [original, setOriginal] = useState(() => JSON.stringify(node.fields[0]));
  const pinned = useRef(JSON.stringify(node.fields));
  const [error, setError] = useState(''),
    [frames, setFrames] = useState(node.framePath.join('\n')),
    [frameError, setFrameError] = useState('');
  useEffect(() => {
    setFrames(node.framePath.join('\n'));
    setFrameError('');
  }, [JSON.stringify(node.framePath)]);
  const list = JSON.stringify(node.fields),
    stale = pinned.current !== list;
  const pending = selected >= node.fields.length || JSON.stringify(draft) !== original;
  let invalid = '';
  try {
    assertBrowserFieldsNode(node);
  } catch (e) {
    invalid = (e as Error).message;
  }
  const focus = () =>
    root.current?.querySelector<HTMLInputElement>('input[data-field-name]')?.focus();
  const load = (index: number, fields: ConfigField[] = node.fields) => {
    const next = Math.max(0, Math.min(index, fields.length - 1));
    pinned.current = JSON.stringify(fields);
    setSelected(next);
    setDraft(structuredClone(fields[next]));
    setOriginal(JSON.stringify(fields[next]));
    setError('');
  };
  const guard = () => {
    if (pending || stale) {
      setError(
        stale ? '字段列表已变化，请放弃当前编辑并重新读取。' : '请先应用或放弃当前字段编辑。',
      );
      focus();
      return false;
    }
    return true;
  };
  const replace = (fields: ConfigField[], index: number) => {
    const next = { ...node, fields };
    assertBrowserFieldsNode(next);
    change(next);
    load(index, fields);
  };
  const switchRule = (selection: boolean) => {
    if (!guard()) return;
    try {
      const { renderPolicy: _oldPolicy, ...base } = { ...node, renderPolicy: undefined };
      const next: unknown = {
        ...base,
        version: selection ? 9 : 7,
        ...(selection ? { renderPolicy: 'bounded-selection-text-v1' } : {}),
        fields: node.fields.map((f) => ({
          ...f,
          operation:
            selection && f.operation === 'rendered-text'
              ? 'selection-text'
              : !selection && f.operation === 'selection-text'
                ? 'rendered-text'
                : f.operation,
        })),
      };
      assertBrowserFieldsNode(next);
      change(next);
      load(selected, next.fields);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const apply = () => {
    if (stale) {
      setError('字段列表已变化，请放弃当前编辑并重新读取。');
      return;
    }
    try {
      const fields = [...node.fields];
      fields[selected] = structuredClone(draft);
      replace(fields, selected);
    } catch (e) {
      setError((e as Error).message);
      focus();
    }
  };
  const add = () => {
    if (!guard() || node.fields.length >= 20) return;
    let i = 1;
    while (node.fields.some((f) => f.key === 'field' + i)) i++;
    setSelected(node.fields.length);
    setDraft({
      key: 'field' + i,
      selector: '',
      operation: 'text',
      attribute: null,
      required: true,
    });
    setOriginal('null');
    setError('');
    requestAnimationFrame(focus);
  };
  const move = (offset: number) => {
    if (!guard()) return;
    const fields = [...node.fields],
      to = selected + offset;
    if (to < 0 || to >= fields.length) return;
    [fields[to], fields[selected]] = [fields[selected], fields[to]];
    replace(fields, to);
  };
  const scalar = (value: Json, update: (value: string | { $ref: string }) => void) => {
    if (
      typeof value === 'string' ||
      (value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 1 &&
        typeof value.$ref === 'string')
    )
      update(value as string | { $ref: string });
    else setError('此字段只接受文字或变量引用。');
  };
  const valueInput = (
    label: string,
    value: string | { $ref: string },
    update: (value: string | { $ref: string }) => void,
    suffix: string,
  ) => (
    <ValueField
      label={label}
      compactReference
      value={value}
      change={(v) => scalar(v, update)}
      choices={choices}
    >
      <label htmlFor={id + suffix}>{label}</label>
      <Input
        id={id + suffix}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => update(e.target.value)}
      />
    </ValueField>
  );
  if (summaryOnly)
    return (
      <section className="browser-fields-summary">
        <p>在唯一根元素内同步读取 {node.fields.length} 个字段。</p>
        <p>
          根定位：
          {typeof node.selector === 'string'
            ? node.selector
            : readableReference(node.selector.$ref, choices)}
        </p>
        <p>在“网页动作配置”中维护字段列表、定位和必填设置。</p>
        {invalid && <p className="field-error">{invalid}</p>}
      </section>
    );
  return (
    <div
      ref={root}
      className="browser-fields-configuration"
      data-value-invalid={
        pending || stale || frameError ? '请先应用或放弃当前关联字段配置' : undefined
      }
    >
      <div className="browser-fields-top">
        <Card>
          <h2>采集范围</h2>
          {valueInput(
            '唯一根元素的 CSS 定位',
            node.selector,
            (selector) => change({ ...node, selector }),
            'root',
          )}
          <label htmlFor={id + 'frames'}>iframe 路径</label>
          <Input.TextArea
            id={id + 'frames'}
            rows={1}
            value={frames}
            status={frameError ? 'error' : undefined}
            aria-invalid={!!frameError}
            placeholder="每行一层；留空表示顶层文档"
            onChange={(e) => {
              const text = e.target.value;
              setFrames(text);
              const path = text
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
              if (path.length > 8 || path.some((s) => s.length > 2000)) {
                setFrameError('框架路径最多 8 层，每层最多 2000 字符。');
                return;
              }
              setFrameError('');
              change({ ...node, framePath: path as FramePath });
            }}
          />
          {frameError && (
            <>
              <p role="alert" className="field-error">
                {frameError}
              </p>
              <Button
                onClick={() => {
                  setFrames(node.framePath.join('\n'));
                  setFrameError('');
                }}
              >
                恢复已应用路径
              </Button>
            </>
          )}
          <p>根元素须唯一；每个框架须唯一匹配 iframe。相对定位仅查询根元素后代。</p>
          <FieldsElementPicker
            scope={{ version: 1, kind: 'root' }}
            selector={typeof node.selector === 'string' ? node.selector : undefined}
            framePath={node.framePath}
            sourceKey={JSON.stringify([
              node.id,
              node.version,
              node.fields,
              selected,
              draft,
              frames,
            ])}
            reason={
              !pickingReady
                ? '工作区正在展开，请稍候再选取。'
                : typeof node.selector !== 'string'
                  ? '当前根使用变量引用；静态拾取不会解析或覆盖该引用。'
                  : frameError || (stale ? '字段列表已变化，请先重新读取。' : undefined)
            }
            beforeStart={guard}
            onApply={(value) => {
              if (value.kind !== 'root' || !guard()) return;
              change({
                ...node,
                selector: value.root.selector,
                framePath: value.root.framePath as FramePath,
              });
            }}
          />
          <p>更换根或框架保留原字段定位，请逐项重新核对。</p>
        </Card>
        <Card>
          <h2>采集方式</h2>
          {node.version === 6 && (
            <Alert
              type="info"
              title="当前采用原正文检查规则"
              description={
                <Space direction="vertical">
                  <span>
                    更新后只核准满足完整条件的无绘制祖先空格；其他生成内容、隐藏或裁切仍阻止采用。仅改当前草稿，保存后用于下次运行。
                  </span>
                  <Button
                    onClick={() => {
                      if (guard()) change({ ...node, version: 7 });
                    }}
                  >
                    更新检查规则
                  </Button>
                </Space>
              }
            />
          )}
          {node.version === 7 && (
            <p>选区正文规则：只排除经核准无绘制的祖先普通空格；候选仍须本人完整阅读核对。</p>
          )}
          {(node.version === 6 || node.version === 7) && (
            <Space direction="vertical">
              <span>
                选区文字候选会单独记录选区外装饰，外部覆盖仍未核验。切换同步更新本步骤已排版正文字段，仅用于新运行；后续引用须重新核对。
              </span>
              <Button
                disabled={!node.fields.some((f) => f.operation === 'rendered-text')}
                onClick={() => switchRule(true)}
              >
                使用选区文字
              </Button>
              {!node.fields.some((f) => f.operation === 'rendered-text') && (
                <span>请先将至少一项字段设为已排版正文，再选择文字来源规则。</span>
              )}
            </Space>
          )}
          {node.version === 9 && (
            <Space direction="vertical">
              <strong>选区文字候选 · 外部覆盖未核验</strong>
              <span>
                选区外祖先装饰可能绘制；候选不证明完整正文或岗位资格。切换规则会同步更新本步骤候选字段，仅用于新运行。
              </span>
              <Button onClick={() => switchRule(false)}>改用已排版正文</Button>
            </Space>
          )}
          <p>
            {node.version === 9
              ? '最多 20 项 · DOM文字 / 原始属性 / 选区文字候选（待核对）'
              : node.version >= 6
                ? '最多 20 项 · DOM文字 / 原始属性 / 已排版正文（待核对）'
                : '最多 20 项 · DOM文字 / 原始属性'}
          </p>
          <p>
            {node.version >= 6
              ? '同一同步 DOM 读取；正文单项 64 KiB，原始字段 8 KiB，总结果 128 KiB。隐藏、裁切或无法判定时不采用正文；不自动展开或滚动。'
              : '同一同步 DOM 读取；单项 8 KiB，总结果 64 KiB。'}
          </p>
          <p>不完整时返回明确状态；导航、框架变化或超限时整次拒绝。</p>
          {actions}
        </Card>
      </div>
      <Card className="browser-fields-editor">
        <h2>关联字段</h2>
        <Space wrap>
          <Button type="primary" disabled={node.fields.length >= 20} onClick={add}>
            添加字段
          </Button>
          <span>{node.fields.length}/20 项</span>
        </Space>
        <div className="browser-fields-grid">
          <nav aria-label="关联字段列表">
            {node.fields.map((f, i) => (
              <Button
                key={i}
                type={i === selected ? 'primary' : 'text'}
                aria-current={i === selected ? 'true' : undefined}
                onClick={() => {
                  if (i !== selected && guard()) load(i);
                }}
              >
                <strong>{f.key}</strong>
                <small>
                  {f.operation === 'text'
                    ? 'DOM文字'
                    : f.operation === 'rendered-text'
                      ? '已排版正文'
                      : f.operation === 'selection-text'
                        ? '选区文字候选'
                        : '属性'}{' '}
                  · {f.required ? '必填' : '可选'}
                </small>
              </Button>
            ))}
            {selected >= node.fields.length && <p>新字段 · 尚未应用</p>}
          </nav>
          <section className="browser-fields-current" aria-label="当前关联字段">
            <div className="browser-fields-name">
              <div>
                <label htmlFor={id + 'name'}>字段名称</label>
                <Input
                  id={id + 'name'}
                  data-field-name
                  value={draft.key}
                  maxLength={64}
                  onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={id + 'operation'}>读取方式</label>
                <Select
                  id={id + 'operation'}
                  value={draft.operation}
                  options={[
                    { value: 'text', label: '文字（textContent）' },
                    { value: 'attribute', label: '原始属性' },
                    ...(node.version === 9
                      ? [{ value: 'selection-text', label: '选区文字候选（待核对）' }]
                      : node.version >= 6
                        ? [{ value: 'rendered-text', label: '已排版正文（待核对）' }]
                        : []),
                  ]}
                  onChange={(operation) =>
                    setDraft({
                      ...draft,
                      operation,
                      attribute: operation === 'attribute' ? 'href' : null,
                    })
                  }
                />
              </div>
            </div>
            {valueInput(
              '相对根元素的 CSS 定位',
              draft.selector,
              (selector) => setDraft({ ...draft, selector }),
              'selector',
            )}
            <FieldsElementPicker
              scope={
                typeof node.selector === 'string'
                  ? {
                      version: 1,
                      kind: 'field',
                      root: { selector: node.selector, framePath: node.framePath },
                    }
                  : undefined
              }
              selector={typeof draft.selector === 'string' ? draft.selector : undefined}
              rendered={draft.operation === 'rendered-text' || draft.operation === 'selection-text'}
              renderPolicy={
                node.version === 9
                  ? 'bounded-selection-text-v1'
                  : node.version === 7
                    ? 'bounded-rendered-text-v2'
                    : 'bounded-rendered-text-v1'
              }
              framePath={node.framePath}
              sourceKey={JSON.stringify([
                node.id,
                node.version,
                node.fields,
                selected,
                draft,
                frames,
              ])}
              reason={
                !pickingReady
                  ? '工作区正在展开，请稍候再选取。'
                  : typeof node.selector !== 'string' || typeof draft.selector !== 'string'
                    ? '根或字段使用变量引用；静态拾取不会解析或覆盖该引用。'
                    : frameError || (stale ? '字段列表已变化，请先重新读取。' : undefined)
              }
              onApply={(value) => {
                if (value.kind !== 'field' || stale) return;
                setDraft({ ...draft, selector: value.field.selector });
              }}
            />
            {draft.operation === 'attribute' &&
              valueInput(
                '属性名',
                draft.attribute ?? '',
                (attribute) => setDraft({ ...draft, attribute }),
                'attribute',
              )}
            <Checkbox
              checked={draft.required}
              onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
            >
              必填字段
            </Checkbox>
            {error && <Alert type="error" role="alert" title={error} />}
            <Space wrap>
              <Button type="primary" onClick={apply} disabled={!pending && !invalid}>
                应用当前字段
              </Button>
              <Button
                disabled={!pending && !stale && !error}
                onClick={() => load(Math.min(selected, node.fields.length - 1))}
              >
                放弃当前编辑并重新读取
              </Button>
            </Space>
            <Space wrap>
              <Button
                disabled={selected <= 0 || selected >= node.fields.length}
                onClick={() => move(-1)}
              >
                上移字段
              </Button>
              <Button disabled={selected >= node.fields.length - 1} onClick={() => move(1)}>
                下移字段
              </Button>
              <Button
                danger
                disabled={
                  node.fields.length <= 1 ||
                  selected >= node.fields.length ||
                  (node.version === 9 &&
                    node.fields[selected]?.operation === 'selection-text' &&
                    node.fields.filter((f) => f.operation === 'selection-text').length === 1)
                }
                onClick={() => {
                  if (!guard()) return;
                  replace(
                    node.fields.filter((_, i) => i !== selected),
                    Math.min(selected, node.fields.length - 2),
                  );
                }}
              >
                移除字段
              </Button>
            </Space>
            <p>字段名须唯一，不使用保留键。必填缺失或为空白、任意字段多匹配时，结果标记不完整。</p>
            {node.version === 9 && (
              <p>
                本步骤须至少保留一项选区文字候选。需要改为普通文字或属性采集时，可先改用已排版正文再调整字段。
              </p>
            )}
          </section>
        </div>
        <p>
          DOM文字读取 textContent；已排版正文须通过有限检查，仍需本人核对完整性。原始属性保留
          null、空文字和相对链接。采集不产生账号验证或动作授权。
        </p>
      </Card>
      <Collapse
        items={[
          {
            key: 'timing',
            label: '节点期限',
            forceRender: true,
            onKeyDown: activateCollapseWithSpace,
            children: (
              <NodeTiming compact node={node} change={(n) => change(n as BrowserFieldsNode)} />
            ),
          },
          {
            key: 'json',
            label: '高级 JSON · 只读配置详情',
            onKeyDown: activateCollapseWithSpace,
            children: <pre>{JSON.stringify(node, null, 2)}</pre>,
          },
        ]}
      />
    </div>
  );
}
