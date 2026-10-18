import { Alert, Button, Card, Drawer } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import AuthorSchemaEditor from './AuthorSchemaEditor';
import { checkAIOutputSchema, type AIOutputSchema } from './ai-output-schema';
import './editor-workspace-dialog.css';
import './workflow-value-composer.css';
import './template-author.css';

export default function AIOutputSchemaWorkspace({
  nodeId,
  schema,
  apply,
  close,
}: {
  nodeId: string;
  schema: AIOutputSchema;
  apply: (schema: AIOutputSchema) => void;
  close: () => void;
}) {
  const titleId = useId();
  const [original] = useState(() => ({ nodeId, schema: JSON.stringify(schema) }));
  const [draft, setDraft] = useState(() => structuredClone(schema));
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef(document.activeElement as HTMLElement | null);
  const generation = useRef(0);
  const latest = useRef({ nodeId, schema, apply });
  latest.current = { nodeId, schema, apply };
  const stale = nodeId !== original.nodeId || JSON.stringify(schema) !== original.schema;
  const changed = pending || JSON.stringify(draft) !== original.schema;
  let invalid = '';
  try {
    checkAIOutputSchema(draft);
  } catch (reason) {
    invalid = reason instanceof Error ? reason.message : '输出结构无效，当前编辑保留。';
  }
  useEffect(
    () => () => {
      generation.current++;
      const element = origin.current;
      requestAnimationFrame(() => {
        if (element?.isConnected) element.focus({ preventScroll: true });
      });
    },
    [],
  );
  const exit = () => {
    if (busy) {
      generation.current++;
      setBusy(false);
    }
    if (changed) setLeaving(true);
    else close();
  };
  async function applyDraft() {
    if (busy || pending || stale) return;
    const operation = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const candidate = structuredClone(draft);
      checkAIOutputSchema(candidate);
      await window.flowark.request('author.schema.check', { schema: candidate, form: false });
      if (generation.current !== operation) return;
      if (
        latest.current.nodeId !== original.nodeId ||
        JSON.stringify(latest.current.schema) !== original.schema
      )
        throw Error('原节点输出结构已变化，本次编辑保留，不覆盖最新内容。');
      latest.current.apply(candidate);
      close();
    } catch (reason) {
      if (generation.current === operation)
        setError(reason instanceof Error ? reason.message : '输出结构未应用，当前编辑保留。');
    } finally {
      if (generation.current === operation) setBusy(false);
    }
  }
  return (
    <Drawer
      open
      size="calc(100vw - var(--fa-workspace-navigation-width))"
      closable={false}
      mask={{ closable: false }}
      push={false}
      focusable={{ focusTriggerAfterClose: false, trap: true }}
      rootClassName="editor-workspace-overlay ai-output-schema-overlay"
      className="editor-workspace-dialog"
      aria-labelledby={titleId}
      afterOpenChange={(open) => open && heading.current?.focus()}
      onClose={exit}
    >
      <div className="workflow-value-toolbar">
        <Button onClick={exit}>← 返回 AI 步骤配置</Button>
        <span>AI 输出格式 / 结构编辑</span>
      </div>
      <section className="workflow-value-page" aria-label="AI 输出结构">
        <header>
          <h2 ref={heading} id={titleId} tabIndex={-1}>
            AI 输出结构
          </h2>
          <p>通过字段树维护对象、数组项、可选值和约束；应用到本节点后再保存流程。</p>
        </header>
        <div className="workflow-value-overview">
          <Card title="本节点输出格式">
            <p>根结构为对象。常用嵌套结构无需编写 JSON。</p>
            <p>结构不是流程变量；本地引用及其他未编辑规则保持。</p>
            <p>打开、编辑和校验不调用模型、不读取 Key、不创建运行。</p>
          </Card>
          <Card title="应用范围">
            <p>
              {stale
                ? '原节点结构已变化，当前编辑保留。'
                : pending
                  ? '字段键或高级编辑尚未完成，请先应用或取消。'
                  : '未应用到节点，当前流程草稿保持。'}
            </p>
            <div className="skill-actions">
              <Button
                type="primary"
                disabled={busy || pending || stale || !!invalid}
                loading={busy}
                onClick={() => void applyDraft()}
              >
                应用输出结构
              </Button>
              <Button onClick={exit}>取消编辑</Button>
            </div>
          </Card>
        </div>
        {stale && (
          <Alert type="warning" title="原节点结构已变化，禁止覆盖最新结构；取消后可重新打开。" />
        )}
        {invalid && <Alert type="error" title={invalid} role="alert" />}
        {error && <Alert type="error" title={error} role="alert" />}
        {leaving && (
          <Alert
            type="warning"
            title="本次输出结构编辑尚未应用"
            description="放弃仅关闭本次编辑，原节点保持。"
            action={
              <div className="skill-actions">
                <Button onClick={() => setLeaving(false)}>继续编辑</Button>
                <Button onClick={close}>放弃本次编辑</Button>
              </div>
            }
          />
        )}
        <AuthorSchemaEditor
          schema={draft}
          change={(value) => {
            setDraft(value);
            setError('');
          }}
          disabled={busy}
          pending={setPending}
          label="AI 输出结构"
          form={false}
          rootObject
          plainOptions
        />
        <p className="json-data-help">
          默认值仅描述格式，不代替模型返回。高级 Schema 可选；结构校验不代表实际模型结果已通过。
        </p>
      </section>
    </Drawer>
  );
}
