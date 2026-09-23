import { useEffect, useId, useRef, useState } from 'react';
import type { PlanningTask, TaskDetail } from '../shared/planning';
import { sameWebPage, type TaskWebPreview } from '../shared/task-web-target';
import { toolsNotExecutable } from '../shared/task-mcp-targets';
import DesktopTaskPlan from './DesktopTaskPlan';
import TaskTargetConnections from './TaskTargetConnections';
import {
  DesktopWindowList,
  DesktopWindowCapabilities,
  useDesktopWindows,
} from './TaskDesktopWindows';
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
export default function TaskWebTargetPage({
  phaseChanged,
  active = true,
  task,
  initialUrl,
  initialTab,
  selected,
  back,
  showBrowser,
  changed,
  openTools,
}: {
  phaseChanged: (phase: 'window' | 'plan' | 'changes') => void;
  active?: boolean;
  task: PlanningTask;
  initialUrl?: string;
  initialTab?: 'web' | 'window';
  selected: (next: TaskDetail) => void;
  back: () => void;
  showBrowser: () => void;
  changed: () => Promise<void>;
  openTools: () => void;
}) {
  const [preview, setPreview] = useState<TaskWebPreview>({ ready: false });
  const [tab, setTab] = useState<'web' | 'window' | 'tools'>(
    initialTab ?? (task.toolTargets?.length ? 'tools' : 'web'),
  );
  const [desktopPlan, setDesktopPlan] = useState(false);
  useEffect(() => {
    if (!desktopPlan) phaseChanged('window');
  }, [desktopPlan, phaseChanged]);
  useEffect(() => () => phaseChanged('window'), [phaseChanged]);
  const tabId = useId();
  const desktop = useDesktopWindows(active && tab === 'window', `${task.id}:${task.revision}`);
  useEffect(() => {
    setDesktopPlan(false);
  }, [desktop.preview?.status === 'ready' ? desktop.preview.previewId : undefined]);
  const tabs = [
    { id: 'web', label: '网页' },
    { id: 'window', label: '应用窗口' },
    { id: 'tools', label: '已连接工具' },
  ] as const;
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
    if (!active || tab !== 'web') return;
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
  }, [active, task.id, task.revision, tab]);
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
  const openUrl = () =>
    void act(async () => {
      const parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('请输入 HTTP(S) 网页地址');
      setPreview({ ready: false });
      await api('browser.embedded.enable');
      await api('browser.embedded.navigate', { url: parsed.href });
      await changed();
      showBrowser();
      await refresh();
    });
  if (desktopPlan && desktop.selected && desktop.preview?.status === 'ready')
    return (
      <DesktopTaskPlan
        phaseChanged={phaseChanged}
        key={desktop.preview.previewId}
        task={task}
        selection={desktop.preview}
        target={desktop.selected}
        back={() => setDesktopPlan(false)}
        editDescription={back}
      />
    );
  return (
    <section className="task-web-target" aria-label="选择任务对象">
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className={`task-web-columns${tab === 'window' ? ' is-desktop' : ''}`}>
        <section className="ai-task-card">
          <div className="task-web-tabs" role="tablist" aria-label="对象类型">
            {tabs.map((item, index) => (
              <button
                key={item.id}
                id={`${tabId}-${item.id}`}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`${tabId}-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                disabled={busy}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % tabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? tabs.length - 1
                            : -1;
                  if (next < 0 || busy) return;
                  event.preventDefault();
                  setTab(tabs[next].id);
                  document.getElementById(`${tabId}-${tabs[next].id}`)?.focus();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div
            className="task-target-tab-panel"
            role="tabpanel"
            id={`${tabId}-panel-web`}
            aria-labelledby={`${tabId}-web`}
            hidden={tab !== 'web'}
          >
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
            <form
              className="task-target-address-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy && url.trim()) openUrl();
              }}
            >
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
                <button disabled={busy || !url.trim()} type="submit">
                  {busy ? '正在处理…' : '打开此网页'}
                </button>
                <button type="button" disabled={busy} onClick={() => void act(refresh)}>
                  重新检查网页
                </button>
              </div>
            </form>
            <p className="ai-task-note">切换目标后重新核对方案与能力，不沿用旧对象的执行授权。</p>
          </div>
          <div
            className="task-target-tab-panel"
            role="tabpanel"
            id={`${tabId}-panel-window`}
            aria-labelledby={`${tabId}-window`}
            hidden={tab !== 'window'}
          >
            <DesktopWindowList state={desktop} />
          </div>
          <div
            className="task-target-tab-panel"
            role="tabpanel"
            id={`${tabId}-panel-tools`}
            aria-labelledby={`${tabId}-tools`}
            hidden={tab !== 'tools'}
          >
            <TaskTargetConnections
              active={active && tab === 'tools'}
              task={task}
              manage={openTools}
              selected={selected}
              pending={setBusy}
            />
          </div>
        </section>
        <section className="ai-task-card">
          {tab === 'window' ? (
            <DesktopWindowCapabilities
              state={desktop}
              back={back}
              chooseWeb={() => setTab('web')}
              plan={() => setDesktopPlan(true)}
            />
          ) : tab === 'tools' ? (
            <>
              <h2>任务工具选择</h2>
              <p>在左侧选择连接和本次需要的工具，核对后保存到任务。</p>
              <p className="ai-task-note">{toolsNotExecutable}</p>
              <p>账号：未核对 · 工作区：未核对 · 系统权限：未核对</p>
              <p>当前网页和资料继续保留；工具选择不会授予网页写入权限。</p>
              <button disabled={busy} onClick={back}>
                返回描述与资料
              </button>
            </>
          ) : (
            <>
              <h2>{tab === 'web' ? '当前将操作的对象' : '已保留的网页选择'}</h2>
              <div className="task-web-object">
                <h2>{current?.title || '等待选择网页'}</h2>
                <p>本机内置浏览器 / 同一受控会话</p>
                <p className="task-web-url">{current?.url}</p>
              </div>
              <h2>{tab === 'web' ? '本次可用能力' : '已选网页的能力'}</h2>
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
                {tab === 'web' ? (
                  <button
                    className="primary"
                    disabled={busy || !preview.ready || !preview.token}
                    onClick={() =>
                      void act(async () => {
                        const next = await api('task.web.select', {
                          ...identity,
                          token: preview.token,
                        });
                        selected(next);
                      })
                    }
                  >
                    {busy ? '正在确认…' : '使用这个目标'}
                  </button>
                ) : (
                  <button className="primary" disabled={busy} onClick={() => setTab('web')}>
                    返回网页选择
                  </button>
                )}
                <button disabled={busy} onClick={back}>
                  返回描述与资料
                </button>
              </div>
              {tab !== 'web' && (
                <p className="ai-task-note" role="status">
                  右侧保留当前网页信息。返回“网页”后可确认，浏览连接不会更改已选对象。
                </p>
              )}
              {task.webTarget && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => selected(await api('task.web.clear', identity)))
                  }
                >
                  移除网页目标
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
