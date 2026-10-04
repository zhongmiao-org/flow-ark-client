import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { PlanningTask, TaskDetail } from '../shared/planning';
import { sameWebPage, type TaskWebPreview } from '../shared/task-web-target';
import DesktopTaskPlan from './DesktopTaskPlan';
import TaskTargetConnections from './TaskTargetConnections';
import ElementPicker from './ElementPicker';
import type { ElementTarget } from '../shared/element-picker';
import {
  DesktopWindowList,
  DesktopWindowCapabilities,
  useDesktopWindows,
} from './TaskDesktopWindows';
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
export default function TaskWebTargetPage({
  adopted,
  adoptionUnavailable,
  phaseChanged,
  active = true,
  task,
  initialUrl,
  initialTab,
  selected,
  back,
  backLabel = '返回描述与资料',
  showBrowser,
  inspectBrowser,
  changed,
  openTools,
}: {
  adopted: (detail: TaskDetail) => void;
  adoptionUnavailable?: string;
  phaseChanged: (phase: 'window' | 'window-ready' | 'plan' | 'changes') => void;
  active?: boolean;
  task: PlanningTask;
  initialUrl?: string;
  initialTab?: 'web' | 'window';
  selected: (next: TaskDetail) => void;
  back: () => void;
  backLabel?: string;
  showBrowser: () => void;
  inspectBrowser: () => void;
  changed: () => Promise<void>;
  openTools: () => void;
}) {
  const [preview, setPreview] = useState<TaskWebPreview>({ ready: false });
  const [elementCandidate, setElementCandidate] = useState<ElementTarget>();
  const [tab, setTab] = useState<'web' | 'window' | 'tools'>(
    initialTab ?? (task.toolTargets?.length ? 'tools' : 'web'),
  );
  const [desktopPlan, setDesktopPlan] = useState(false);
  const [toolDetails, setToolDetails] = useState<HTMLDivElement | null>(null);
  useEffect(() => () => phaseChanged('window'), [phaseChanged]);
  const tabId = useId();
  const desktop = useDesktopWindows(active && tab === 'window', `${task.id}:${task.revision}`);
  useEffect(() => {
    if (!desktopPlan)
      phaseChanged(
        tab === 'window' && desktop.selected && !desktop.expired ? 'window-ready' : 'window',
      );
  }, [desktopPlan, phaseChanged, tab, desktop.selected, desktop.expired]);
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
  const [webAction, setWebAction] = useState<'open' | 'refresh' | 'select' | 'clear'>();
  const [checkingWeb, setCheckingWeb] = useState(true);
  const [invalidUrl, setInvalidUrl] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const webHeading = useRef<HTMLHeadingElement>(null);
  const previewReason = useRef<HTMLParagraphElement>(null);
  const operationError = useRef<HTMLDivElement>(null);
  const focusPreview = useRef(false);
  const connectionsButton = useRef<HTMLButtonElement>(null);
  const returningConnections = useRef(false);
  useLayoutEffect(() => {
    if (active && returningConnections.current) {
      returningConnections.current = false;
      connectionsButton.current?.scrollIntoView({ block: 'nearest' });
      connectionsButton.current?.focus({ preventScroll: true });
    }
  }, [active]);
  useLayoutEffect(() => {
    if (!active || tab !== 'web' || busy) return;
    if (error) (invalidUrl ? urlInput : operationError).current?.focus();
  }, [active, tab, busy, error, invalidUrl]);
  useLayoutEffect(() => {
    if (!active || tab !== 'web' || busy || error) return;
    if (focusPreview.current && !checkingWeb) {
      focusPreview.current = false;
      const target = preview.ready ? webHeading.current : previewReason.current;
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus({ preventScroll: true });
    }
  }, [active, tab, busy, error, invalidUrl, checkingWeb, preview]);
  const epoch = useRef(0),
    locked = useRef(false);
  const mounted = useRef(true);
  const scopeKey = `${active}:${tab}:${task.id}:${task.revision}`;
  const scope = useRef({ key: scopeKey });
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const identity = { id: task.id, revision: task.revision };
  const refresh = async () => {
    const ticket = ++epoch.current;
    let next: TaskWebPreview;
    try {
      next = await api('task.web.preview', identity);
    } catch (e) {
      next = { ready: false, reason: (e as Error).message };
    }
    if (ticket === epoch.current) {
      setPreview(next);
      setCheckingWeb(false);
    }
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
      } finally {
        pending = false;
      }
    };
    setPreview({ ready: false });
    setCheckingWeb(true);
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      live = false;
      epoch.current++;
      clearInterval(timer);
    };
  }, [active, task.id, task.revision, tab]);
  const act = async (
    operation: (isCurrent: () => boolean) => Promise<void>,
    action: 'open' | 'refresh' | 'select' | 'clear',
    propagate = false,
  ) => {
    if (locked.current) {
      if (propagate) throw new Error('正在确认网页，请稍后重新选择。');
      return;
    }
    const owner = scope.current;
    const isCurrent = () => mounted.current && scope.current === owner;
    locked.current = true;
    epoch.current++;
    setBusy(true);
    setWebAction(action);
    setError('');
    setInvalidUrl(false);
    try {
      await operation(isCurrent);
    } catch (e) {
      if (propagate) throw e;
      if (isCurrent()) {
        setError((e as Error).message);
        if (action === 'open') setCheckingWeb(false);
      }
    } finally {
      locked.current = false;
      if (isCurrent() && action === 'refresh') focusPreview.current = true;
      if (mounted.current) {
        setWebAction(undefined);
        setBusy(false);
      }
    }
  };
  const current = preview.page;
  const pageSource = useRef('');
  if (current) pageSource.current = JSON.stringify(current);
  const savedCurrent = current && task.webTarget && sameWebPage(current, task.webTarget.page);
  const webReady = preview.ready && !!preview.page && !!preview.token;
  const openUrl = () => {
    if (locked.current) return;
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      setInvalidUrl(true);
      setError('请输入完整的 HTTP(S) 网页地址，例如 https://example.com');
      urlInput.current?.focus();
      return;
    }
    void act(async (isCurrent) => {
      setPreview({ ready: false });
      setCheckingWeb(true);
      await api('browser.embedded.enable');
      if (!isCurrent()) return;
      await api('browser.embedded.navigate', { url: parsed.href });
      await changed();
      if (!isCurrent()) return;
      showBrowser();
      await refresh();
    }, 'open');
  };
  const recheckWeb = () =>
    void act(async () => {
      setPreview((current) => ({ ...current, ready: false, token: undefined }));
      setCheckingWeb(true);
      await refresh();
    }, 'refresh');
  const selectElement = (pickRequestId: string) =>
    act(
      async (isCurrent) => {
        const picked: TaskWebPreview = await api('task.web.preview', {
          ...identity,
          pickRequestId,
        });
        if (!isCurrent()) throw new Error('已离开当前任务对象，请重新选择。');
        if (!picked.ready || !picked.token || !picked.element)
          throw new Error(picked.reason || '未取得可确认的网页元素，请重新选择。');
        const next: TaskDetail = await api('task.web.select', {
          ...identity,
          pickRequestId,
          token: picked.token,
        });
        if (isCurrent()) selected(next);
      },
      'select',
      true,
    );
  if (desktopPlan && desktop.selected && desktop.preview?.status === 'ready')
    return (
      <DesktopTaskPlan
        adopted={adopted}
        adoptionUnavailable={adoptionUnavailable}
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
    <section
      className="task-web-target"
      aria-label="选择任务对象"
      aria-busy={busy || (tab === 'web' && checkingWeb)}
    >
      {error && (
        <div
          className="alert error"
          role="alert"
          id="task-web-error"
          ref={operationError}
          tabIndex={-1}
        >
          {error}
        </div>
      )}
      <div className={`task-web-columns${tab === 'window' ? ' is-desktop' : ''}`}>
        <section className="ai-task-card">
          <div
            className="task-web-tabs"
            role="tablist"
            aria-label="对象类型"
            hidden={tab === 'window' && !!desktop.selected && !desktop.expired}
          >
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
              <button disabled={busy} onClick={inspectBrowser}>
                扩大查看
              </button>
            </div>
            {task.webTarget && (
              <p className="ai-task-note" role="status">
                {savedCurrent
                  ? task.webTarget.element
                    ? `上次选择的元素：${task.webTarget.element.target.label || task.webTarget.element.target.tag}。可重新选取元素或改用整个网页。`
                    : '已保存此网页选择；执行前仍会再次核对。'
                  : '上次选择的网页已变化或尚未打开，请重新检查并确认。'}
              </p>
            )}
            <div className="task-web-object">
              <h2>其他网页</h2>
              <p>输入网址，打开后检查 FlowArk 的当前网页。</p>
            </div>
            <form
              className="task-target-address-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy && url.trim()) openUrl();
              }}
            >
              <label htmlFor="task-target-url">网页地址</label>
              <input
                id="task-target-url"
                ref={urlInput}
                aria-invalid={invalidUrl}
                aria-describedby={invalidUrl ? 'task-web-error' : undefined}
                type="url"
                value={url}
                maxLength={8192}
                placeholder="https://example.com"
                disabled={busy}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (invalidUrl) {
                    setInvalidUrl(false);
                    setError('');
                  }
                }}
              />
              <div className="ai-task-actions">
                <button disabled={busy || !url.trim()} type="submit">
                  {webAction === 'open' ? '正在打开网页…' : '打开此网页'}
                </button>
                <button type="button" disabled={busy} onClick={recheckWeb}>
                  {webAction === 'refresh' ? '正在重新检查…' : '重新检查网页'}
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
            <DesktopWindowList state={desktop} compactSelected />
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
              detailsContainer={toolDetails}
            />
          </div>
        </section>
        <section className="ai-task-card">
          <div ref={setToolDetails} className="task-tools-detail-slot" hidden={tab !== 'tools'} />
          {tab === 'window' ? (
            <DesktopWindowCapabilities
              state={desktop}
              back={back}
              backLabel={backLabel}
              chooseWeb={() => setTab('web')}
              plan={() => setDesktopPlan(true)}
            />
          ) : tab === 'tools' ? (
            <>
              <button disabled={busy} onClick={back}>
                {backLabel}
              </button>
            </>
          ) : (
            <>
              <h2 ref={webHeading} tabIndex={-1}>
                当前将操作的对象
              </h2>
              <div className="task-web-object">
                <h2>
                  {current?.title || '等待选择网页'}
                  {elementCandidate && ` · ${elementCandidate.label || elementCandidate.tag}`}
                </h2>
                <p>本机内置浏览器 / 同一受控会话</p>
                {elementCandidate && (
                  <p>
                    待确认 · {/^h[1-6]$/.test(elementCandidate.tag) ? '页面标题' : '网页元素'} ·{' '}
                    {elementCandidate.framePath.length
                      ? `${elementCandidate.framePath.length} 层框架`
                      : '主页面'}
                  </p>
                )}
                <p className="task-web-url">{current?.url}</p>
              </div>
              <h2>{webReady ? '本次可用能力' : '网页就绪后可用'}</h2>
              {[
                elementCandidate ? '读取已选元素文字' : '读取页面文字',
                '定位页面元素',
                '新建本地输出文件',
              ].map((label) => (
                <label className="ai-task-checkbox" key={label}>
                  <input type="checkbox" checked={webReady} disabled />
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
                上下文。选取具体元素后，还会包含它的名称与定位信息，并限定只读取该元素；发送前仍可完整核对。
              </p>
              {!webReady && (
                <p
                  className="ai-task-note ai-task-failure"
                  role="status"
                  ref={previewReason}
                  tabIndex={-1}
                >
                  {checkingWeb
                    ? '正在检查当前网页…'
                    : preview.reason || '尚未取得可确认的网页，请重新检查。'}
                </p>
              )}
              <ElementPicker
                purpose="task"
                active={active && tab === 'web'}
                disabled={busy || !webReady}
                selector={task.webTarget?.element?.target.selector ?? ''}
                framePath={task.webTarget?.element?.target.framePath ?? []}
                pickLabel={
                  task.webTarget?.element || elementCandidate ? '重新选择页面元素' : '选择页面元素'
                }
                confirmBeforeApply
                allowInspect={false}
                onInspect={() => {}}
                onSelect={(_, requestId) => selectElement(requestId)}
                onCandidateChange={setElementCandidate}
                sourceKey={pageSource.current}
              />
              <div className="ai-task-actions task-web-selection-actions">
                {!elementCandidate && (
                  <button
                    className="primary"
                    disabled={busy || !webReady}
                    onClick={() =>
                      void act(async (isCurrent) => {
                        const next = await api('task.web.select', {
                          ...identity,
                          token: preview.token,
                        });
                        if (isCurrent()) selected(next);
                      }, 'select')
                    }
                  >
                    {webAction === 'select'
                      ? '正在确认…'
                      : task.webTarget?.element
                        ? '改用整个网页'
                        : '使用整个网页'}
                  </button>
                )}
                <button
                  ref={connectionsButton}
                  disabled={busy}
                  onClick={() => {
                    returningConnections.current = true;
                    openTools();
                  }}
                >
                  连接其他应用
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
                    void act(async (isCurrent) => {
                      const next = await api('task.web.clear', identity);
                      if (isCurrent()) selected(next);
                    }, 'clear')
                  }
                >
                  {webAction === 'clear' ? '正在移除…' : '移除网页目标'}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
