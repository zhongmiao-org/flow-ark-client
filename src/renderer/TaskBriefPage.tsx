import { Alert, Collapse, ConfigProvider, Button, Input, Tag } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { PlanningContext, PlanningTask } from '../shared/planning';
import { IMAGE_TOTAL_BYTES } from '../shared/task-attachments';
import TaskAttachmentFeedback, { type AttachmentFeedback } from './TaskAttachmentFeedback';

export default function TaskBriefPage({
  task,
  description,
  context,
  busy,
  dirty,
  changeDescription,
  changeContext,
  choose,
  remove,
  preview,
  attachmentFeedback,
  retryAttachment,
  target,
  understand,
  controls,
}: {
  task: PlanningTask;
  description: string;
  context: PlanningContext[];
  busy: boolean;
  dirty: boolean;
  changeDescription: (value: string) => void;
  changeContext: (value: PlanningContext[]) => void;
  choose: (kind: 'file' | 'image') => void;
  remove: (id: string) => void;
  preview: (id: string) => void;
  attachmentFeedback?: AttachmentFeedback;
  retryAttachment: () => void;
  target: () => void;
  understand: () => void;
  controls: ReactNode;
}) {
  const [expandedContext, setExpandedContext] = useState<string[]>([]);
  const contextNames = useRef(new Map<string, HTMLInputElement>());
  const contextSummaries = useRef(new Map<string, HTMLElement>());
  const addTextButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ id?: string; target: 'name' | 'summary' | 'add' } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const element =
      pending.target === 'add'
        ? addTextButton.current
        : pending.target === 'name'
          ? contextNames.current.get(pending.id!)
          : contextSummaries.current.get(pending.id!);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
    if (pending.target === 'name') (element as HTMLInputElement).select();
  }, [context]);
  function addText() {
    const id = crypto.randomUUID();
    setExpandedContext((current) => [...current, id]);
    pendingFocus.current = { id, target: 'name' };
    changeContext([...context, { id, kind: 'text', label: '补充资料', text: '' }]);
  }
  function removeText(id: string, index: number) {
    const remaining = context.filter((entry) => entry.id !== id);
    const next = remaining[Math.min(index, remaining.length - 1)];
    pendingFocus.current = next ? { id: next.id, target: 'summary' } : { target: 'add' };
    setExpandedContext((current) => current.filter((entry) => entry !== id));
    changeContext(remaining);
  }
  const count =
    context.length +
    (task.attachments?.length ?? 0) +
    (task.toolTargets?.length ?? 0) +
    Number(!!task.webTarget) +
    Number(!!task.outputTarget);
  const images = (task.attachments ?? []).filter((entry) => entry.kind === 'image');
  const imageBytes = images.reduce((total, image) => total + image.size, 0);
  const imageSize =
    imageBytes < 0.01 * 1024 * 1024 ? '不足 0.01' : (imageBytes / (1024 * 1024)).toFixed(2);
  const imageLimit = images.length >= 4 || imageBytes >= IMAGE_TOTAL_BYTES;
  const rowFeedback =
    !!attachmentFeedback?.attachmentId &&
    task.attachments?.some((item) => item.id === attachmentFeedback.attachmentId);
  const pendingAction =
    attachmentFeedback?.status === 'pending' ? attachmentFeedback.action : undefined;
  return (
    <div className="ai-task-columns task-brief-columns">
      <section className="ai-task-card task-brief-input">
        <label htmlFor="task-description">你的需求</label>
        <Input.TextArea
          id="task-description"
          disabled={busy || undefined}
          value={description}
          maxLength={20000}
          onChange={(e) => changeDescription(e.target.value)}
        />
        <div className="task-brief-add">
          <Button disabled={busy || count >= 20 || undefined} onClick={() => choose('file')}>
            {pendingAction === 'file' ? '正在选择…' : '附加文件'}
          </Button>
          <Button disabled={busy || undefined} aria-label="网页链接与对象" onClick={target}>
            网页链接
          </Button>
          <Button
            disabled={busy || count >= 20 || imageLimit || undefined}
            onClick={() => choose('image')}
          >
            {pendingAction === 'image' ? '正在选择…' : '目标截图'}
          </Button>
        </div>
        {attachmentFeedback && !rowFeedback && (
          <TaskAttachmentFeedback
            feedback={attachmentFeedback}
            busy={busy}
            retry={retryAttachment}
          />
        )}
        <section className="task-brief-context" aria-label="已选上下文">
          <h2>已选上下文 · {count} 项</h2>
          <p className="task-context-budget" role="status">
            全部资料 {count} / 20 项 · 图片 {images.length} / 4 张
            {images.length > 0 && ` · ${imageSize} / 12 MiB`}
          </p>
          {(count >= 20 || imageLimit) && (
            <Alert
              type="warning"
              showIcon
              role="status"
              title={
                count >= 20
                  ? '资料数量已达上限，请先移除不需要的资料、输出或工具选择。'
                  : '图片数量或总大小已达上限，请先移除不需要的图片。其他文本资料仍可添加。'
              }
            />
          )}
          {!count && <p>选择需要的资料；支持 UTF-8 文本、PNG / JPEG 图片。</p>}
          {task.webTarget && (
            <div aria-label="已选网页来源">
              <p>{task.webTarget.page.title || '未命名网页'} · 只读 · 账号未核对</p>
              {task.webTarget.element && (
                <p>
                  仅此元素：
                  {task.webTarget.element.target.label || task.webTarget.element.target.tag}
                </p>
              )}
              <Button disabled={busy || undefined} onClick={target}>
                查看或更换网页目标
              </Button>
            </div>
          )}
          {task.attachments?.map((a) => (
            <div key={a.id} className="task-brief-attachment-item">
              <div className="task-brief-attachment">
                <span>
                  {a.name}
                  <small>
                    {a.kind === 'image' ? `${a.width} × ${a.height} · 目标说明图片` : '文本副本'} ·{' '}
                    {Math.ceil(a.size / 1024)} KiB
                  </small>
                </span>
                <Button
                  disabled={busy || undefined}
                  onClick={() => preview(a.id)}
                  aria-label={`预览 ${a.name}`}
                >
                  {pendingAction === 'preview' && attachmentFeedback?.attachmentId === a.id
                    ? '读取中…'
                    : '预览'}
                </Button>
                <Button
                  disabled={busy || undefined}
                  onClick={() => remove(a.id)}
                  aria-label={`移除附件 ${a.name}`}
                >
                  {pendingAction === 'remove' && attachmentFeedback?.attachmentId === a.id
                    ? '移除中…'
                    : '移除'}
                </Button>
              </div>
              {attachmentFeedback?.attachmentId === a.id &&
                attachmentFeedback.status !== 'success' && (
                  <TaskAttachmentFeedback
                    feedback={attachmentFeedback}
                    busy={busy}
                    retry={retryAttachment}
                  />
                )}
            </div>
          ))}
          {task.outputTarget && <p>任务输出 / {task.outputTarget.name} · 路径留在本机</p>}
          {!!task.toolTargets?.length && (
            <div className="task-brief-tool-context" aria-label="已选工具资料">
              {task.toolTargets.map((tool) => (
                <p key={tool.selectionId}>
                  {tool.displayName} · {tool.tools.length} 项工具定义
                </p>
              ))}
              <small>每个连接计为一项资料；选择工具不会授予执行权限。</small>
            </div>
          )}
          {context.map((c, index) => (
            <Collapse
              className="task-brief-text-context"
              key={c.id}
              activeKey={expandedContext.includes(c.id) ? [c.id] : []}
              onChange={(keys) => {
                const open = keys.includes(c.id);
                setExpandedContext((current) =>
                  current.includes(c.id) === open
                    ? current
                    : open
                      ? [...current, c.id]
                      : current.filter((id) => id !== c.id),
                );
              }}
              ref={(element) => {
                const header = element?.querySelector<HTMLElement>(
                  '[role="button"][aria-expanded]',
                );
                if (header) contextSummaries.current.set(c.id, header);
                else contextSummaries.current.delete(c.id);
              }}
              items={[
                {
                  key: c.id,
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  label: (
                    <div className="task-brief-text-label">
                      <span>{c.label.trim() || `未命名资料 ${index + 1}`}</span>
                      <small>
                        {c.text.length.toLocaleString('zh-CN')} 字符 ·{' '}
                        {expandedContext.includes(c.id) ? '收起编辑' : '展开编辑'}
                      </small>
                      {!expandedContext.includes(c.id) && (
                        <span className="task-brief-text-summary">
                          {c.text.trim().slice(0, 120) || '尚未填写内容'}
                        </span>
                      )}
                    </div>
                  ),
                  children: (
                    <ConfigProvider componentDisabled={busy || undefined}>
                      <fieldset className="ai-task-context" disabled={busy}>
                        <label>
                          资料名称
                          <Input
                            ref={(instance) => {
                              const element = instance?.input ?? null;
                              if (element) contextNames.current.set(c.id, element);
                              else contextNames.current.delete(c.id);
                            }}
                            aria-label={`资料 ${index + 1} 名称`}
                            value={c.label}
                            maxLength={200}
                            onChange={(e) =>
                              changeContext(
                                context.map((entry) =>
                                  entry.id === c.id ? { ...entry, label: e.target.value } : entry,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          资料内容
                          <Input.TextArea
                            aria-label={`资料 ${index + 1} 内容`}
                            value={c.text}
                            maxLength={50000}
                            onChange={(e) =>
                              changeContext(
                                context.map((entry) =>
                                  entry.id === c.id ? { ...entry, text: e.target.value } : entry,
                                ),
                              )
                            }
                          />
                        </label>
                        <Button onClick={() => removeText(c.id, index)}>
                          移除资料 {index + 1}
                        </Button>
                      </fieldset>
                    </ConfigProvider>
                  ),
                },
              ]}
            />
          ))}
          <Button ref={addTextButton} disabled={busy || count >= 20 || undefined} onClick={addText}>
            附加文本资料
          </Button>
        </section>
        <p className="task-brief-disclosure">
          本次只发送你核对的描述、资料、图片和相关能力说明。未选择的窗口与文件不会加入。
        </p>
        <Collapse
          className="task-brief-format"
          items={[
            {
              key: 'format',
              label: '资料格式与副本说明',
              forceRender: true,
              onKeyDown: activateCollapseWithSpace,
              children: (
                <p>
                  文本支持 UTF-8，单项最多 200 KiB / 50000 字符；PNG / JPEG 单张最多 4 MiB。
                  截图入口选择已有图片，不会自动截取屏幕。副本保存在任务中，原文件变化后需移除重选。
                </p>
              ),
            },
          ]}
        />
        {controls}
        <div className="ai-task-actions">
          <Button disabled={busy || undefined} onClick={understand}>
            理解与输出位置
          </Button>
          <Tag color={dirty ? 'warning' : 'success'} role="status">
            {dirty ? '有未保存修改' : '草稿已保存'}
          </Tag>
        </div>
      </section>
      <section className="ai-task-card task-brief-explainer">
        <h2>任务会怎样完成？</h2>
        <div>
          <h3>先理解，再执行</h3>
          <p>AI 会先给出操作对象、输入、修改范围和结果。</p>
        </div>
        <div>
          <h3>先展示方案</h3>
          <p>你可以改步骤，也可以切换到流程图。</p>
        </div>
        <div>
          <h3>执行前再次检查</h3>
          <p>选对目标与权限后，由你点击试运行。</p>
        </div>
        <Alert
          type="info"
          showIcon
          role="status"
          title="选择附件只供 AI 理解；生成与采纳不会执行任务。"
        />
      </section>
    </div>
  );
}
