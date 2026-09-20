import { useEffect, useState } from 'react';
import type { FramePath } from '../shared/contracts.generated';
import type { Step } from '../shared/types';
import ElementPicker from './ElementPicker';
import type { ElementTarget } from '../shared/element-picker';
import { formKeys } from '../core/browser-command';
import { browserActions } from './browser-actions';
import ValueField from './ValueField';
import type { ReferenceChoice } from './value-references';

type BrowserNode = Extract<Step, { type: 'browser' }>;
export default function BrowserNodeConfiguration({
  node,
  change,
  choices,
}: {
  node: BrowserNode;
  choices: ReferenceChoice[];
  change: (node: BrowserNode) => void;
}) {
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
      target &&
      (target.selector !== node.selector || JSON.stringify(target.framePath) !== pathKey)
    )
      setTarget(null);
  }, [node.selector, pathKey]);
  const topLevel = ['navigate', 'screenshot'].includes(node.operation);
  return (
    <section aria-label="浏览器节点配置">
      <label htmlFor="browser-operation">操作</label>
      <select
        id="browser-operation"
        value={node.operation}
        onChange={(e) => {
          const operation = e.target.value as BrowserNode['operation'];
          const nextPath: FramePath = ['navigate', 'screenshot'].includes(operation) ? [] : path;
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
      {node.operation === 'navigate' && (
        <ValueField
          label="网页地址"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={''}
        >
          {typeof node.value === 'string' ? (
            <>
              <label htmlFor="browser-url">网页地址</label>
              <input
                id="browser-url"
                type="url"
                value={typeof node.value === 'string' ? node.value : ''}
                placeholder="http://127.0.0.1:4178"
                onChange={(e) => change({ ...node, value: e.target.value })}
              />
            </>
          ) : undefined}
        </ValueField>
      )}
      {!topLevel && (
        <>
          <label>目标元素</label>
          <ElementPicker
            key={node.operation}
            selector={node.selector}
            framePath={path}
            onInspect={setTarget}
            onSelect={(picked) => {
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
          {target && (
            <div className="picked-target">
              <strong>{target.label}</strong>
              <span>
                {target.tag}
                {target.inputType ? ' · ' + target.inputType : ''} ·{' '}
                {target.framePath.length ? target.framePath.length + ' 层框架' : '当前页面'}
              </span>
              {target.structural && <p>使用结构定位，页面布局变化后请重新验证。</p>}
            </div>
          )}
          <details className="locator-details" open={!node.selector}>
            <summary>定位信息 · 高级编辑</summary>
            <label htmlFor="browser-selector">目标元素选择器</label>
            <input
              id="browser-selector"
              disabled={topLevel}
              value={node.selector}
              placeholder="#submit"
              onChange={(e) => change({ ...node, selector: e.target.value })}
            />
            <label htmlFor="browser-frame-path">iframe 路径</label>
            <textarea
              id="browser-frame-path"
              value={frames}
              disabled={topLevel}
              rows={3}
              aria-describedby="browser-frame-help"
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
            <p id="browser-frame-help" className="note">
              {topLevel
                ? '打开网页和页面截图作用于顶层页面。'
                : '留空表示顶层页面。每行一个 CSS 选择器，从外到内，最多 8 层；每层必须唯一匹配。'}
            </p>
          </details>
        </>
      )}
      {node.operation === 'fill' && (
        <ValueField
          label="填写内容"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={''}
        >
          {typeof node.value === 'string' ? (
            <>
              <label htmlFor="browser-content">填写内容</label>
              <textarea
                id="browser-content"
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
          label="目标状态"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={true}
        >
          {typeof node.value === 'boolean' ? (
            <>
              <label htmlFor="browser-checked">目标状态</label>
              <select
                id="browser-checked"
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
                  <label htmlFor="browser-known-options">网页中的选项</label>
                  <select
                    id="browser-known-options"
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
              <label htmlFor="browser-select-mode">选择方式</label>
              <select
                id="browser-select-mode"
                value={Array.isArray(node.value) ? 'multiple' : 'single'}
                onChange={(e) =>
                  change({ ...node, value: e.target.value === 'multiple' ? [] : '' })
                }
              >
                <option value="single">单个选项值</option>
                <option value="multiple">多个选项值</option>
              </select>
              <label htmlFor="browser-options">选项值</label>
              {Array.isArray(node.value) ? (
                <textarea
                  id="browser-options"
                  value={node.value.join('\n')}
                  placeholder="每行一个值；留空清空多选"
                  onChange={(e) =>
                    change({ ...node, value: e.target.value ? e.target.value.split('\n') : [] })
                  }
                />
              ) : (
                <input
                  id="browser-options"
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
          label="按键"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={'Tab'}
        >
          {typeof node.value === 'string' ? (
            <>
              <label htmlFor="browser-key">按键</label>
              <select
                id="browser-key"
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
              <label htmlFor="browser-file-binding">文件目录绑定</label>
              <input
                id="browser-file-binding"
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
              <label htmlFor="browser-file-name">目录内文件名</label>
              <input
                id="browser-file-name"
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
          label="下载产物文件名"
          value={node.value}
          change={(value) => change({ ...node, value })}
          choices={choices}
          defaultValue={'download.bin'}
        >
          {typeof node.value === 'string' ? (
            <>
              <label htmlFor="browser-download-name">下载产物文件名</label>
              <input
                id="browser-download-name"
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
