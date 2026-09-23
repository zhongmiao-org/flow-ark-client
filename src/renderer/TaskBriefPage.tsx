import type { ReactNode } from 'react';
import type { PlanningContext, PlanningTask } from '../shared/planning';
import { IMAGE_TOTAL_BYTES } from '../shared/task-attachments';

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
  target: () => void;
  understand: () => void;
  controls: ReactNode;
}) {
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
  return (
    <div className="ai-task-columns task-brief-columns">
      <section className="ai-task-card task-brief-input">
        <label htmlFor="task-description">你的需求</label>
        <textarea
          id="task-description"
          disabled={busy}
          value={description}
          maxLength={20000}
          onChange={(e) => changeDescription(e.target.value)}
        />
        <div className="task-brief-add">
          <button disabled={busy || count >= 20} onClick={() => choose('file')}>
            附加文件
          </button>
          <button disabled={busy} aria-label="网页链接与对象" onClick={target}>
            网页链接
          </button>
          <button disabled={busy || count >= 20 || imageLimit} onClick={() => choose('image')}>
            目标截图
          </button>
        </div>
        <section className="task-brief-context" aria-label="已选上下文">
          <h2>已选上下文 · {count} 项</h2>
          <p className="task-context-budget" role="status">
            全部资料 {count} / 20 项 · 图片 {images.length} / 4 张
            {images.length > 0 && ` · ${imageSize} / 12 MiB`}
          </p>
          {(count >= 20 || imageLimit) && (
            <p className="ai-task-note">
              {count >= 20
                ? '资料数量已达上限，请先移除不需要的资料、输出或工具选择。'
                : '图片数量或总大小已达上限，请先移除不需要的图片。其他文本资料仍可添加。'}
            </p>
          )}
          {!count && <p>选择需要的资料；支持 UTF-8 文本、PNG / JPEG 图片。</p>}
          {task.webTarget && (
            <div aria-label="已选网页来源">
              <p>{task.webTarget.page.title || '未命名网页'} · 只读 · 账号未核对</p>
              <button disabled={busy} onClick={target}>
                查看或更换网页目标
              </button>
            </div>
          )}
          {task.attachments?.map((a) => (
            <div key={a.id} className="task-brief-attachment">
              <span>
                {a.name}
                <small>
                  {a.kind === 'image' ? `${a.width} × ${a.height} · 目标说明图片` : '文本副本'} ·{' '}
                  {Math.ceil(a.size / 1024)} KiB
                </small>
              </span>
              <button disabled={busy} onClick={() => preview(a.id)} aria-label={`预览 ${a.name}`}>
                预览
              </button>
              <button
                disabled={busy}
                onClick={() => remove(a.id)}
                aria-label={`移除附件 ${a.name}`}
              >
                移除
              </button>
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
            <fieldset className="ai-task-context" disabled={busy} key={c.id}>
              <label>
                资料名称
                <input
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
                <textarea
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
              <button onClick={() => changeContext(context.filter((entry) => entry.id !== c.id))}>
                移除资料 {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            disabled={busy || count >= 20}
            onClick={() =>
              changeContext([
                ...context,
                { id: crypto.randomUUID(), kind: 'text', label: '补充资料', text: '' },
              ])
            }
          >
            附加文本资料
          </button>
        </section>
        <p className="task-brief-disclosure">
          本次只发送你核对的描述、资料、图片和相关能力说明。未选择的窗口与文件不会加入。
        </p>
        <p className="task-brief-disclosure">
          文本支持 UTF-8，单项最多 200 KiB / 50000 字符；PNG / JPEG 单张最多 4 MiB。
          截图入口选择已有图片，不会自动截取屏幕。副本保存在任务中，原文件变化后需移除重选。
        </p>
        {controls}
        <div className="ai-task-actions">
          <button disabled={busy} onClick={understand}>
            理解与输出位置
          </button>
          <small role="status">{dirty ? '有未保存修改' : '草稿已保存'}</small>
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
        <p className="ai-task-note">选择附件只供 AI 理解；生成与采纳不会执行任务。</p>
      </section>
    </div>
  );
}
