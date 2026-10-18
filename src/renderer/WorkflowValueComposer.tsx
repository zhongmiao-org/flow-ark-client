import { Alert, Button, Card, Drawer, Input } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import type { Json } from '../shared/types';
import type { ReferenceChoice } from './value-references';
import JsonTreeEditor from './JsonTreeEditor';
import { checkVisualValue, isJsonContainer, type JsonContainer } from './workflow-value-model';
import './editor-workspace-dialog.css';
import './workflow-value-composer.css';

export default function WorkflowValueComposer({
  label,
  value,
  choices,
  apply,
  close,
}: {
  label: string;
  value: Json;
  choices?: ReferenceChoice[];
  apply: (value: JsonContainer) => void;
  close: () => void;
}) {
  const titleId = useId();
  const [original] = useState(() => JSON.stringify(value));
  const [draft, setDraft] = useState<Json>(() => structuredClone(value));
  const [mode, setMode] = useState<'fields' | 'json'>('fields');
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [rawError, setRawError] = useState('');
  const [pending, setPending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef(document.activeElement as HTMLElement | null);
  const changed = JSON.stringify(draft) !== original || !!rawError || pending;
  const stale = JSON.stringify(value) !== original;
  let visualError = '';
  try {
    checkVisualValue(draft);
  } catch (e) {
    visualError = e instanceof Error ? e.message : '内容无法完整展示，原输入保留。';
  }
  useEffect(
    () => () => {
      const element = origin.current;
      requestAnimationFrame(() => {
        if (element?.isConnected) element.focus({ preventScroll: true });
      });
    },
    [],
  );
  const exit = () => {
    if (changed) setLeaving(true);
    else close();
  };
  const switchMode = (next: 'fields' | 'json') => {
    if (pending || rawError) {
      setError('请先应用或放弃当前字段编辑，并修正高级JSON；当前输入保留。');
      return;
    }
    if (next === 'fields' && visualError) {
      setError(visualError);
      return;
    }
    setError('');
    setMode(next);
    if (next === 'json') setRaw(JSON.stringify(draft, null, 2));
  };
  return (
    <Drawer
      open
      size="calc(100vw - var(--fa-workspace-navigation-width))"
      closable={false}
      mask={{ closable: false }}
      push={false}
      focusable={{ focusTriggerAfterClose: false, trap: true }}
      rootClassName="editor-workspace-overlay workflow-value-overlay"
      className="editor-workspace-dialog"
      aria-labelledby={titleId}
      afterOpenChange={(open) => open && heading.current?.focus()}
      onClose={exit}
    >
      <div className="workflow-value-toolbar">
        <Button onClick={exit} aria-label={'返回原字段 · ' + label}>
          ← 返回原字段
        </Button>
        <span>{label} / 组合字段</span>
      </div>
      <section className="workflow-value-page" aria-label="组合输入字段">
        <header>
          <h2 ref={heading} id={titleId} tabIndex={-1}>
            组合输入字段
          </h2>
          <p>对象字段与数组条目可分别使用固定值或变量。先应用当前字段，再应用整个输入。</p>
        </header>
        <div className="workflow-value-overview">
          <Card title="当前配置字段">
            <p>{label} · 对象 / 数组</p>
            <p>仅编辑当前字段，不创建运行、不读取凭据。</p>
            <p>支持文字、数字、布尔、空值、容器{choices && '和当前作用域变量'}。</p>
          </Card>
          <Card title="应用范围">
            <p>
              {stale
                ? '原输入已在别处变化，当前编辑保留。'
                : pending
                  ? '当前字段有未应用编辑，先应用或放弃。'
                  : '未应用到原字段；当前流程草稿保持。'}
            </p>
            <div className="skill-actions">
              <Button
                type="primary"
                disabled={pending || !!rawError || stale || !!visualError}
                onClick={() => {
                  try {
                    if (!isJsonContainer(draft)) throw Error('根值须保留为对象或数组。');
                    checkVisualValue(draft, choices);
                    apply(structuredClone(draft));
                    close();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '字段未应用，当前编辑保留。');
                  }
                }}
              >
                应用到字段
              </Button>
              <Button onClick={exit}>取消编辑</Button>
            </div>
          </Card>
        </div>
        {stale && <Alert type="warning" title="原输入已变化，整体应用被阻止；不会覆盖最新字段。" />}
        {error && <Alert type="error" title={error} role="alert" />}
        {leaving && (
          <Alert
            type="warning"
            title="本次组合字段编辑尚未应用"
            description="放弃仅关闭本次编辑，原字段保持。"
            action={
              <div className="skill-actions">
                <Button onClick={() => setLeaving(false)}>继续编辑</Button>
                <Button onClick={close}>放弃本次编辑</Button>
              </div>
            }
          />
        )}
        <Card title="对象字段与数组条目">
          <div className="workflow-value-modes" role="group" aria-label="组合字段编辑方式">
            <Button
              type={mode === 'fields' ? 'primary' : 'default'}
              onClick={() => switchMode('fields')}
            >
              字段编辑
            </Button>
            <Button
              type={mode === 'json' ? 'primary' : 'default'}
              onClick={() => switchMode('json')}
            >
              高级 JSON
            </Button>
          </div>
          {mode === 'fields' && !visualError && isJsonContainer(draft) ? (
            <JsonTreeEditor
              value={draft}
              rootLabel={label}
              allowArrayRoot
              choices={choices}
              disabled={false}
              onPendingChange={setPending}
              change={(next) => {
                checkVisualValue(next);
                setDraft(next);
                setError('');
              }}
            />
          ) : mode === 'json' ? (
            <>
              {rawError && <Alert type="error" title={rawError} role="alert" />}
              <label htmlFor={titleId + '-json'}>高级：完整字段值 JSON</label>
              <Input.TextArea
                id={titleId + '-json'}
                value={raw}
                autoSize={{ minRows: 10, maxRows: 24 }}
                aria-invalid={!!rawError}
                onChange={(e) => {
                  setRaw(e.target.value);
                  try {
                    const value = JSON.parse(e.target.value) as Json;
                    if (!isJsonContainer(value)) throw Error('根值须保留为对象或数组。');
                    checkVisualValue(value);
                    setDraft(value);
                    setRawError('');
                    setError('');
                  } catch (e) {
                    setRawError(
                      e instanceof SyntaxError
                        ? 'JSON尚未完整，原输入保留。'
                        : (e as Error).message,
                    );
                  }
                }}
              />
            </>
          ) : (
            <Alert type="error" title={visualError || '根值须保留为对象或数组。'} />
          )}
          <p className="json-data-help">应用到字段后再保存流程；真实运行仍须核对资源与权限。</p>
        </Card>
      </section>
    </Drawer>
  );
}
