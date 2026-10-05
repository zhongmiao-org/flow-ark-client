import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import type { FramePath } from '../shared/contracts.generated';
import type { Step } from '../shared/types';
import ElementPicker, { type ElementPickerControls } from './ElementPicker';
import type { ElementTarget } from '../shared/element-picker';
import { formKeys } from '../core/browser-command';
import { browserActions } from './browser-actions';
import ValueField from './ValueField';
import type { ReferenceChoice } from './value-references';
import './node-configuration.css';

type BrowserNode = Extract<Step, { type: 'browser' }>;
export default function BrowserNodeConfiguration({
  node,
  change,
  choices,
  fieldsOnly = false,
  compact = false,
  active = true,
  blockingRunId,
  onViewRun,
  readInspector,
  pickerControls,
}: {
  pickerControls?: Ref<ElementPickerControls>;
  readInspector?: { output: ReactNode; timing: ReactNode };
  fieldsOnly?: boolean;
  compact?: boolean;
  active?: boolean;
  blockingRunId?: string;
  onViewRun?: (detail: any, trigger?: HTMLElement) => void;
  node: BrowserNode;
  choices: ReferenceChoice[];
  change: (node: BrowserNode) => void;
}) {
  const instanceId = useId();
  const locator = useRef<HTMLDetailsElement>(null);
  const selectorInput = useRef<HTMLInputElement>(null);
  const fieldId = fieldsOnly ? instanceId + '-' : '';
  const [inspected, setInspected] = useState(false);
  const [target, setTarget] = useState<ElementTarget | null>(null);
  const path: FramePath =
    node.version >= 2 ? (node as Extract<BrowserNode, { version: 2 | 3 }>).framePath : [];
  const pathKey = JSON.stringify(path);
  const [frames, setFrames] = useState(path.join('\n'));
  const parseFrames = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  useEffect(() => {
    if (JSON.stringify(parseFrames(frames)) !== pathKey) setFrames(path.join('\n'));
  }, [pathKey]);
  useEffect(() => {
    if (
      !active ||
      (target &&
        (target.selector !== node.selector || JSON.stringify(target.framePath) !== pathKey))
    ) {
      setTarget(null);
      setInspected(false);
    }
  }, [node.selector, pathKey, active]);
  const observedTarget =
    active && target?.selector === node.selector && JSON.stringify(target.framePath) === pathKey
      ? target
      : null;
  const topLevel = ['navigate', 'screenshot'].includes(node.operation);
  const picker = (
    <Fragment key="picker">
      <ElementPicker
        key={`${node.id}:${node.operation}`}
        controls={pickerControls}
        confirmBeforeApply
        pickLabel={readInspector ? (node.selector ? '重新拾取目标' : '拾取目标') : undefined}
        active={active}
        blockingRunId={blockingRunId}
        onViewRun={onViewRun}
        selector={node.selector}
        framePath={path}
        onStart={() => setTarget(null)}
        onInspect={(picked) => {
          setTarget(picked);
          setInspected(true);
        }}
        onAdjust={() => {
          if (locator.current) locator.current.open = true;
          selectorInput.current?.focus();
        }}
        onSelect={(picked) => {
          setInspected(false);
          setTarget(picked);
          change({
            ...node,
            version: node.version === 3 ? 3 : 2,
            selector: picked.selector,
            framePath: picked.framePath,
            ...(!node.name
              ? {
                  name:
                    ({
                      navigate: '打开',
                      screenshot: '截图',
                      fill: '填写',
                      check: '勾选',
                      select: '选择',
                      click: '点击',
                      read: '读取',
                      wait: '等待',
                      inputValue: '读取',
                      upload: '上传到',
                      download: '下载',
                      press: '按键',
                    }[node.operation] ?? '') +
                    ' ' +
                    picked.label,
                }
              : {}),
          } as BrowserNode);
        }}
      />
      {observedTarget && !inspected && !compact && !readInspector && (
        <div className="picked-target">
          <strong>{observedTarget.label}</strong>
          <span>
            {observedTarget.tag}
            {observedTarget.inputType ? ' · ' + observedTarget.inputType : ''} ·{' '}
            {observedTarget.framePath.length
              ? observedTarget.framePath.length + ' 层框架'
              : '当前页面'}
          </span>
          {observedTarget.structural && <p>使用结构定位，页面布局变化后请重新验证。</p>}
        </div>
      )}
    </Fragment>
  );
  const locatorEditor = (
    <details key="locator" ref={locator} className="locator-details" open={!node.selector}>
      <summary>
        {readInspector ? (compact ? '高级定位' : '高级定位与超时') : '定位信息 · 高级编辑'}
      </summary>
      <label htmlFor={fieldId + 'browser-selector'}>目标元素选择器</label>
      <input
        ref={selectorInput}
        id={fieldId + 'browser-selector'}
        disabled={topLevel}
        value={node.selector}
        placeholder="#submit"
        onChange={(e) => change({ ...node, selector: e.target.value })}
      />
      <label htmlFor={fieldId + 'browser-frame-path'}>iframe 路径</label>
      <textarea
        id={fieldId + 'browser-frame-path'}
        value={frames}
        disabled={topLevel}
        rows={3}
        aria-describedby={fieldId + 'browser-frame-help'}
        placeholder={'iframe#outer\niframe[name="content"]'}
        onChange={(e) => {
          setFrames(e.target.value);
          change({
            ...node,
            version: node.version === 3 ? 3 : 2,
            framePath: parseFrames(e.target.value) as FramePath,
          } as BrowserNode);
        }}
      />
      <p id={fieldId + 'browser-frame-help'} className="note">
        {topLevel
          ? '打开网页和页面截图作用于顶层页面。'
          : '留空表示顶层页面。每行一个 CSS 选择器，从外到内，最多 8 层；每层必须唯一匹配。'}
      </p>
    </details>
  );
  const inspectorOutput = readInspector ? (
    <Fragment key="output">{readInspector.output}</Fragment>
  ) : null;
  const inspectorTiming = readInspector ? (
    <div key="timing" className="read-step-timing">
      {readInspector.timing}
    </div>
  ) : null;
  return (
    <section className="node-configuration" aria-label="浏览器节点配置">
      {!fieldsOnly && !compact && !readInspector && (
        <>
          <header>
            <h4>网页动作</h4>
          </header>
          <label htmlFor={fieldId + 'browser-operation'}>操作</label>
          <select
            id={fieldId + 'browser-operation'}
            value={node.operation}
            onChange={(e) => {
              const operation = e.target.value as BrowserNode['operation'];
              const nextPath: FramePath = ['navigate', 'screenshot'].includes(operation)
                ? []
                : path;
              const value = structuredClone(browserActions[operation].value);
              const version =
                node.version === 3 || ['select', 'check', 'inputValue', 'press'].includes(operation)
                  ? 3
                  : 2;
              change({ ...node, version, operation, value, framePath: nextPath } as BrowserNode);
            }}
          >
            {Object.entries(browserActions).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="node-operation-description">
            {browserActions[node.operation].detail}
            。切换动作会恢复该动作的默认输入，可通过草稿撤销恢复。
          </p>
        </>
      )}
      {node.operation === 'navigate' && (
        <ValueField
          compactReference={fieldsOnly}
          label="网页地址"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={''}
        >
          {typeof node.value === 'string' ? (
            <>
              <label htmlFor={fieldId + 'browser-url'}>网页地址</label>
              <input
                id={fieldId + 'browser-url'}
                type="url"
                value={typeof node.value === 'string' ? node.value : ''}
                placeholder="http://127.0.0.1:4178"
                onChange={(e) => change({ ...node, value: e.target.value })}
              />
            </>
          ) : undefined}
        </ValueField>
      )}
      {!fieldsOnly && !topLevel && (
        <>
          <label>目标元素</label>
          {(compact || readInspector) && (
            <div className="node-target-summary">
              <p
                className="compact-target-selector"
                title={
                  observedTarget
                    ? `${observedTarget.label || observedTarget.tag}\n${[...path, node.selector].join(' → ')}`
                    : node.selector
                }
              >
                {observedTarget
                  ? observedTarget.label || observedTarget.tag
                  : readInspector && node.selector === 'title'
                    ? '页面标题 · title'
                    : node.selector || '尚未选择目标元素'}
              </p>
              {observedTarget && (
                <div className="node-target-observation">
                  <p>
                    {observedTarget.tag} · {path.length ? `${path.length} 层框架` : '主页面'} ·{' '}
                    {inspected ? '最近验证唯一匹配' : '已应用目标'}
                  </p>
                  {observedTarget.structural && <p>使用结构定位，页面布局变化后请重新验证。</p>}
                </div>
              )}
            </div>
          )}
          {compact && readInspector
            ? [inspectorTiming, picker, inspectorOutput, locatorEditor]
            : [picker, inspectorOutput, locatorEditor, inspectorTiming]}
        </>
      )}
      {node.operation === 'fill' && (
        <ValueField
          compactReference={fieldsOnly}
          label="填写内容"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={''}
        >
          {typeof node.value === 'string' ? (
            <>
              <label htmlFor={fieldId + 'browser-content'}>填写内容</label>
              <textarea
                id={fieldId + 'browser-content'}
                value={typeof node.value === 'string' ? node.value : ''}
                placeholder="输入要填写的内容"
                onChange={(e) => change({ ...node, value: e.target.value })}
              />
            </>
          ) : undefined}
        </ValueField>
      )}
      {node.operation === 'check' && (
        <ValueField
          compactReference={fieldsOnly}
          label="目标状态"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={true}
        >
          {typeof node.value === 'boolean' ? (
            <>
              <label htmlFor={fieldId + 'browser-checked'}>目标状态</label>
              <select
                id={fieldId + 'browser-checked'}
                value={String(node.value)}
                onChange={(e) => change({ ...node, value: e.target.value === 'true' })}
              >
                <option value="true">选中</option>
                <option value="false">取消勾选（仅复选框）</option>
              </select>
            </>
          ) : undefined}
        </ValueField>
      )}
      {node.operation === 'select' && (
        <ValueField
          compactReference={fieldsOnly}
          label="选项值"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={''}
        >
          {typeof node.value === 'string' ||
          (Array.isArray(node.value) && node.value.every((item) => typeof item === 'string')) ? (
            <>
              {target?.options.length ? (
                <>
                  <label htmlFor={fieldId + 'browser-known-options'}>网页中的选项</label>
                  <select
                    id={fieldId + 'browser-known-options'}
                    multiple={target.multiple}
                    size={target.multiple ? Math.min(5, target.options.length) : undefined}
                    value={
                      target.multiple
                        ? Array.isArray(node.value)
                          ? node.value.map(String)
                          : typeof node.value === 'string'
                            ? [node.value]
                            : []
                        : typeof node.value === 'string'
                          ? node.value
                          : ''
                    }
                    onChange={(e) =>
                      change({
                        ...node,
                        value: target.multiple
                          ? Array.from(e.target.selectedOptions).map((o) => o.value)
                          : e.target.value,
                      })
                    }
                  >
                    {!target.multiple && (
                      <option value="" disabled>
                        选择网页选项
                      </option>
                    )}
                    {target.options.map((o, i) => (
                      <option key={i} value={o.value} disabled={o.disabled}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
              <label htmlFor={fieldId + 'browser-select-mode'}>选择方式</label>
              <select
                id={fieldId + 'browser-select-mode'}
                value={Array.isArray(node.value) ? 'multiple' : 'single'}
                onChange={(e) =>
                  change({ ...node, value: e.target.value === 'multiple' ? [] : '' })
                }
              >
                <option value="single">单个选项值</option>
                <option value="multiple">多个选项值</option>
              </select>
              <label htmlFor={fieldId + 'browser-options'}>选项值</label>
              {Array.isArray(node.value) ? (
                <textarea
                  id={fieldId + 'browser-options'}
                  value={node.value.join('\n')}
                  placeholder="每行一个值；留空清空多选"
                  onChange={(e) =>
                    change({ ...node, value: e.target.value ? e.target.value.split('\n') : [] })
                  }
                />
              ) : (
                <input
                  id={fieldId + 'browser-options'}
                  value={typeof node.value === 'string' ? node.value : ''}
                  onChange={(e) => change({ ...node, value: e.target.value })}
                />
              )}
            </>
          ) : undefined}
        </ValueField>
      )}
      {node.operation === 'press' && (
        <ValueField
          compactReference={fieldsOnly}
          label="按键"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={'Tab'}
        >
          {typeof node.value === 'string' ? (
            <>
              <label htmlFor={fieldId + 'browser-key'}>按键</label>
              <select
                id={fieldId + 'browser-key'}
                value={String(node.value)}
                onChange={(e) => change({ ...node, value: e.target.value })}
              >
                {formKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </>
          ) : undefined}
        </ValueField>
      )}
      {node.operation === 'upload' && (
        <ValueField
          compactReference={fieldsOnly}
          label="上传文件"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={{ binding: 'workspace', name: '' }}
        >
          {!!node.value &&
          typeof node.value === 'object' &&
          !Array.isArray(node.value) &&
          'binding' in node.value &&
          'name' in node.value &&
          typeof node.value.binding === 'string' &&
          typeof node.value.name === 'string' ? (
            <>
              <label htmlFor={fieldId + 'browser-file-binding'}>文件目录绑定</label>
              <input
                id={fieldId + 'browser-file-binding'}
                value={
                  typeof node.value === 'object' && node.value && 'binding' in node.value
                    ? String(node.value.binding)
                    : ''
                }
                onChange={(e) =>
                  change({
                    ...node,
                    value: {
                      binding: e.target.value,
                      name:
                        typeof node.value === 'object' && node.value && 'name' in node.value
                          ? node.value.name
                          : '',
                    },
                  })
                }
              />
              <label htmlFor={fieldId + 'browser-file-name'}>目录内文件名</label>
              <input
                id={fieldId + 'browser-file-name'}
                placeholder="sample.txt"
                value={
                  typeof node.value === 'object' && node.value && 'name' in node.value
                    ? String(node.value.name)
                    : ''
                }
                onChange={(e) =>
                  change({
                    ...node,
                    value: {
                      binding:
                        typeof node.value === 'object' && node.value && 'binding' in node.value
                          ? node.value.binding
                          : 'workspace',
                      name: e.target.value,
                    },
                  })
                }
              />
              <p className="note">在“参数与绑定”中选择此绑定对应的本机目录。</p>
            </>
          ) : undefined}
        </ValueField>
      )}
      {node.operation === 'download' && (
        <ValueField
          compactReference={fieldsOnly}
          label="下载产物文件名"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={'download.bin'}
        >
          {typeof node.value === 'string' ? (
            <>
              <label htmlFor={fieldId + 'browser-download-name'}>下载产物文件名</label>
              <input
                id={fieldId + 'browser-download-name'}
                value={typeof node.value === 'string' ? node.value : ''}
                onChange={(e) => change({ ...node, value: e.target.value })}
              />
            </>
          ) : undefined}
        </ValueField>
      )}
      {node.operation === 'inputValue' && (
        <p className="note">读取控件当前实际填写的值，可供后续节点引用或断言。</p>
      )}
    </section>
  );
}
