import { useEffect, useRef, useState } from 'react';
import type { PlanningTask, TaskDetail } from '../shared/planning';
import { sameWebPage, type TaskWebPreview } from '../shared/task-web-target';
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
export default function TaskWebTargetPage({
  task,
  initialUrl,
  selected,
  back,
  showBrowser,
  changed,
}: {
  task: PlanningTask;
  initialUrl?: string;
  selected: (next: TaskDetail) => void;
  back: () => void;
  showBrowser: () => void;
  changed: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<TaskWebPreview>({ ready: false });
  const [url, setUrl] = useState(task.webTarget?.page.url ?? initialUrl ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const epoch = useRef(0),
    locked = useRef(false);
  const identity = { id: task.id, revision: task.revision };
  const refresh = async () => {
    const ticket = ++epoch.current;
    const next = await api('task.web.preview', identity);
    if (ticket === epoch.current) setPreview(next);
  };
  useEffect(() => {
    let live = true,
      pending = false;
    const poll = async () => {
      if (!live || pending || locked.current) return;
      pending = true;
      try {
        await refresh();
      } catch (e) {
        if (live) setPreview({ ready: false, reason: (e as Error).message });
      } finally {
        pending = false;
      }
    };
    setPreview({ ready: false });
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      live = false;
      epoch.current++;
      clearInterval(timer);
    };
  }, [task.id, task.revision]);
  const act = async (operation: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    epoch.current++;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const current = preview.page;
  const savedCurrent = current && task.webTarget && sameWebPage(current, task.webTarget.page);
  return (
    <section className="task-web-target" aria-label="选择网页对象">
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="task-web-columns">
        <section className="ai-task-card">
          <div className="task-web-tabs" aria-label="对象类型">
            <span aria-current="page">网页</span>
            <span aria-disabled="true" title="应用窗口连接尚不可用">
              应用窗口 · 暂不可用
            </span>
            <span aria-disabled="true" title="应用与工具连接尚不可用">
              已连接工具 · 暂不可用
            </span>
          </div>
          <div className="task-web-object task-web-current">
            <h2>{current?.title || (current ? '未命名网页' : '尚未取得网页')}</h2>
            <p>内置浏览器 · 当前标签</p>
            <p>账号：未核对 · 工作区：本机内置浏览器</p>
            <p className="task-web-url">{current?.url}</p>
            <button disabled={busy} onClick={showBrowser}>
              扩大查看
            </button>
          </div>
          {task.webTarget && (
            <p className="ai-task-note" role="status">
              {savedCurrent
                ? '已保存此网页选择；执行前仍会再次核对。'
                : '上次选择的网页已变化或尚未打开，请重新检查并确认。'}
            </p>
          )}
          <div className="task-web-object">
            <h2>其他网页</h2>
            <p>输入网址，打开后检查 FlowArk 的当前网页。</p>
          </div>
          <label htmlFor="task-target-url">网页地址</label>
          <input
            id="task-target-url"
            type="url"
            value={url}
            maxLength={8192}
            placeholder="https://example.com"
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="ai-task-actions">
            <button
              disabled={busy || !url.trim()}
              onClick={() =>
                void act(async () => {
                  const parsed = new URL(url);
                  if (!['http:', 'https:'].includes(parsed.protocol))
                    throw new Error('请输入 HTTP(S) 网页地址');
                  setPreview({ ready: false });
                  await api('browser.embedded.enable');
                  await api('browser.embedded.navigate', { url: parsed.href });
                  await changed();
                  showBrowser();
                  await refresh();
                })
              }
            >
              打开此网页
            </button>
            <button disabled={busy} onClick={() => void act(refresh)}>
              重新检查网页
            </button>
          </div>
          <p className="ai-task-note">切换目标后重新核对方案与能力，不沿用旧对象的执行授权。</p>
        </section>
        <section className="ai-task-card">
          <h2>当前将操作的对象</h2>
          <div className="task-web-object">
            <h2>{current?.title || '等待选择网页'}</h2>
            <p>本机内置浏览器 / 同一受控会话</p>
            <p className="task-web-url">{current?.url}</p>
          </div>
          <h2>本次可用能力</h2>
          {['读取页面文字', '定位页面元素', '新建本地输出文件'].map((label) => (
            <label className="ai-task-checkbox" key={label}>
              <input type="checkbox" checked disabled />
              {label}
            </label>
          ))}
          <label className="ai-task-checkbox">
            <input type="checkbox" checked={false} disabled />
            提交表单或发送消息 · 未授权
          </label>
          <p className="ai-task-note">
            只读选择不会读取账号、Cookie
            或整页内容。确认后仅将显示的网页标题、地址和能力范围加入本次 AI
            上下文；发送前仍可完整核对。
          </p>
          {!preview.ready && (
            <p className="ai-task-note ai-task-failure" role="status">
              {preview.reason || '正在检查当前网页…'}
            </p>
          )}
          <div className="ai-task-actions">
            <button
              className="primary"
              disabled={busy || !preview.ready || !preview.token}
              onClick={() =>
                void act(async () => {
                  const next = await api('task.web.select', { ...identity, token: preview.token });
                  selected(next);
                })
              }
            >
              使用这个目标
            </button>
            <button disabled={busy} onClick={back}>
              返回描述与资料
            </button>
          </div>
          {task.webTarget && (
            <button
              disabled={busy}
              onClick={() => void act(async () => selected(await api('task.web.clear', identity)))}
            >
              移除网页目标
            </button>
          )}
        </section>
      </div>
    </section>
  );
}
