import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Globe, X, ArrowRight, RefreshCw } from 'lucide-react';
import './browser-observation.css';
import { desktopViewportWidth } from '../shared/browser-viewport';
import { useBrowserFocus } from './BrowserFocusContext';
import type { FocusedTarget } from '../shared/browser-observation';
const api = (method: string, args?: unknown) => window.flowark.request(method, args);
const browserErrorMessage = (reason: unknown) =>
  (reason instanceof Error ? reason.message : String(reason)).replace(
    /^Error invoking remote method 'flowark:request': (?:Error: )?/,
    '',
  );
export default function BrowserSidebar({
  close,
  running,
  obscured,
  editing = false,
  onPick,
  onLocate,
  observationRequest,
  observationOriginLabel,
  returnFromObservation,
}: {
  observationRequest?: string;
  observationOriginLabel?: string;
  returnFromObservation?: () => void;
  editing?: boolean;
  onPick?: () => void;
  onLocate?: () => void;
  close: () => void;
  running: boolean;
  obscured: boolean;
}) {
  const addressId = useId();
  const browserFocus = useBrowserFocus();
  const focusEntry = browserFocus?.entry;
  const focusCurrent = useRef(focusEntry);
  focusCurrent.current = focusEntry;
  const [focusView, setFocusView] = useState(true);
  const [focusReady, setFocusReady] = useState(false);
  const [focusError, setFocusError] = useState('');
  const [focusPending, setFocusPending] = useState(false);
  useEffect(() => {
    setFocusView(true);
    setFocusReady(false);
    setFocusError('');
  }, [focusEntry?.requestId]);
  const targetView = !!focusEntry && focusView;
  const [sessionOpen, setSessionOpen] = useState(false);
  const [statusKnown, setStatusKnown] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [rereading, setRereading] = useState(false);
  const rereadStatus = useRef<(() => Promise<void>) | undefined>(undefined);
  const statusSummary = useRef<HTMLDivElement>(null);
  const statusFailure = useRef<HTMLDivElement>(null);
  const operationError = useRef<HTMLDivElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const [invalidAddress, setInvalidAddress] = useState(false);
  const feedbackFocus = useRef<
    { origin: Element | null; target: 'status' | 'status-error' | 'error' } | undefined
  >(undefined);
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const [panelExpanded, setExpanded] = useState(false);
  const expanded = !!focusEntry || !!observationRequest || panelExpanded;
  const focusTag = focusEntry?.target.tag;
  const focusKind = /^h[1-6]$/.test(focusTag ?? '')
    ? '文字标题'
    : (
        {
          input: '输入控件',
          textarea: '多行输入框',
          button: '按钮',
          a: '链接',
          select: '下拉选择框',
          img: '图片',
          table: '表格',
        } as Record<string, string>
      )[focusTag ?? ''] || '网页元素';
  const observationTitle = targetView
    ? focusKind === '文字标题'
      ? '聚焦页面标题'
      : '聚焦选中目标'
    : observationRequest || focusEntry
      ? '网页总览'
      : '扩大查看网页';

  const [observing, setObserving] = useState(false);
  const observationBusy = useRef(false);
  const statusRevision = useRef(0);
  const restoreFocus = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(() => !!document.querySelector('dialog[open]'));
  const hidden = obscured || dialogOpen;
  useEffect(() => {
    const sync = () => setDialogOpen(!!document.querySelector('dialog[open]'));
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    sync();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!expanded || hidden || !panel.current) return;
    const saved: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = panel.current;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          saved.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      if (parent === document.body) break;
      branch = parent;
    }
    returnButton.current?.focus({ preventScroll: true });
    return () => {
      for (const item of saved) item.element.inert = item.inert;
    };
  }, [expanded, hidden]);
  useEffect(() => {
    if (!expanded && restoreFocus.current) {
      restoreFocus.current = false;
      expandButton.current?.focus({ preventScroll: true });
    }
  }, [expanded]);
  const restorePanel = () => {
    if (focusEntry) {
      browserFocus!.close(focusEntry.requestId);
      return;
    }
    if (observationRequest && returnFromObservation) {
      returnFromObservation();
      return;
    }
    restoreFocus.current = true;
    setExpanded(false);
  };
  const [status, setStatus] = useState<{
    started: boolean;
    url: string;
    title: string;
    blocked?: string;
    loading?: boolean;
    observation?: {
      mode: 'overview' | 'readable';
      busy: boolean;
      percentage?: number;
      error?: string;
    };
  }>({ started: false, url: '', title: '' });
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigating = useRef(false);
  const focused = useRef(false);
  const addressEdited = useRef(false);
  const obscuredRef = useRef(hidden);
  const enabled = useRef(false);
  obscuredRef.current = hidden;
  useLayoutEffect(() => {
    const feedback = feedbackFocus.current;
    if (!feedback) return;
    feedbackFocus.current = undefined;
    if (
      hidden ||
      (document.activeElement !== feedback.origin && document.activeElement !== document.body)
    )
      return;
    const target =
      feedback.target === 'error'
        ? operationError.current
        : feedback.target === 'status-error'
          ? statusFailure.current
          : (statusSummary.current ?? returnButton.current ?? expandButton.current);
    target?.focus({ preventScroll: true });
  });
  useEffect(() => {
    let live = true;
    const bounds = () => {
      const r = viewport.current?.getBoundingClientRect();
      if (r)
        void api('browser.embedded.viewport', {
          x: Math.max(0, Math.round(r.x)),
          y: Math.max(0, Math.round(r.y)),
          width: Math.round(r.width),
          height: Math.round(r.height),
        }).catch(() => {});
    };
    let refreshing: Promise<boolean> | undefined;
    const readStatus = async () => {
      const revision = statusRevision.current;
      try {
        const s = await api('browser.embedded.status');
        if (live && revision === statusRevision.current) {
          setStatus(s);
          setStatusKnown(true);
          setStatusError('');
          if (!focused.current && !addressEdited.current)
            setAddress(s.url === 'about:blank' ? '' : s.url);
        }
        return true;
      } catch (e) {
        if (live && revision === statusRevision.current) {
          setStatusKnown(false);
          setStatusError(browserErrorMessage(e));
        }
        return false;
      }
    };
    const refresh = async (manual = false) => {
      if (!live || observationBusy.current || navigating.current || (!manual && refreshing)) return;
      const revision = statusRevision.current;
      const origin = document.activeElement;
      if (manual) setRereading(true);
      const pending = (refreshing ??= readStatus());
      const succeeded = await pending;
      if (refreshing === pending) refreshing = undefined;
      if (manual && live) {
        if (revision === statusRevision.current)
          feedbackFocus.current = { origin, target: succeeded ? 'status' : 'status-error' };
        setRereading(false);
      }
    };
    rereadStatus.current = () => refresh(true);
    void (async () => {
      try {
        await api('browser.embedded.enable');
        if (!live) return;
        enabled.current = true;
        bounds();
        await api('browser.embedded.visibility', { visible: !obscuredRef.current });
        if (!live) return;
        await refresh();
      } catch (e) {
        if (live) setError(browserErrorMessage(e));
      }
    })();
    const observer = new ResizeObserver(bounds);
    if (viewport.current) observer.observe(viewport.current);
    window.addEventListener('resize', bounds);
    const timer = setInterval(() => void refresh(), 750);
    return () => {
      live = false;
      statusRevision.current++;
      rereadStatus.current = undefined;
      feedbackFocus.current = undefined;
      enabled.current = false;
      clearInterval(timer);
      observer.disconnect();
      window.removeEventListener('resize', bounds);
      void api('browser.embedded.visibility', { visible: false }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (enabled.current)
      void api('browser.embedded.visibility', { visible: !hidden }).catch((error) =>
        setError(browserErrorMessage(error)),
      );
  }, [hidden]);
  useLayoutEffect(() => {
    const r = viewport.current?.getBoundingClientRect();
    if (r)
      void api('browser.embedded.viewport', {
        x: Math.max(0, Math.round(r.x)),
        y: Math.max(0, Math.round(r.y)),
        width: Math.round(r.width),
        height: Math.round(r.height),
      }).catch(() => {});
    // Alerts can move the fixed-height focus card without resizing its viewport.
  }, [
    error,
    focusError,
    statusError,
    status.blocked,
    status.observation?.error,
    status.observation?.busy,
    observing,
    focusPending,
  ]);
  const closePanel = () => {
    if (focusEntry) {
      browserFocus!.close(focusEntry.requestId);
      return;
    }
    if (observationRequest && returnFromObservation) {
      returnFromObservation();
      return;
    }
    close();
    requestAnimationFrame(() => {
      const toggle = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[aria-label="打开网页面板"], [data-browser-toggle]',
        ),
      ).find((element) => element.getClientRects().length > 0);
      toggle?.focus({ preventScroll: true });
    });
  };
  const navigate = async (url = address) => {
    if (navigating.current || observationBusy.current || hidden || running) return;
    let destination: string;
    try {
      const input = url.trim();
      if (!input) throw new Error();
      const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : 'https://' + input);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      destination = parsed.href;
    } catch {
      setInvalidAddress(true);
      setError('请输入有效的 HTTP(S) 网页地址');
      addressInput.current?.focus();
      return;
    }
    navigating.current = true;
    const revision = ++statusRevision.current;
    const origin = document.activeElement;
    setLoading(true);
    setInvalidAddress(false);
    setError('');
    try {
      await api('browser.embedded.navigate', { url: destination });
      if (revision !== statusRevision.current) return;
      addressEdited.current = false;
      setAddress(destination);
      try {
        const next = await api('browser.embedded.status');
        if (revision !== statusRevision.current) return;
        setStatus(next);
        setStatusKnown(true);
        setStatusError('');
        feedbackFocus.current = { origin, target: 'status' };
      } catch (reason) {
        if (revision !== statusRevision.current) return;
        setStatusKnown(false);
        setStatusError(browserErrorMessage(reason));
        feedbackFocus.current = { origin, target: 'status-error' };
      }
    } catch (e) {
      if (revision === statusRevision.current) {
        setError(browserErrorMessage(e));
        feedbackFocus.current = { origin, target: 'error' };
      }
    } finally {
      navigating.current = false;
      if (revision === statusRevision.current) setLoading(false);
    }
  };
  const changeObservation = async (mode: 'overview' | 'readable') => {
    if (observationBusy.current) return;
    observationBusy.current = true;
    const revision = ++statusRevision.current;
    const origin = document.activeElement;
    setObserving(true);
    setError('');
    setInvalidAddress(false);
    try {
      const next = await api('browser.embedded.observation', { mode });
      if (revision === statusRevision.current) {
        setStatus(next);
        setStatusKnown(true);
        setStatusError('');
        feedbackFocus.current = { origin, target: 'status' };
      }
    } catch (error) {
      if (revision === statusRevision.current) {
        setError(browserErrorMessage(error));
        feedbackFocus.current = { origin, target: 'error' };
        setStatus((previous) => ({
          ...previous,
          observation: previous.observation
            ? {
                ...previous.observation,
                busy: false,
                percentage: undefined,
                error: browserErrorMessage(error),
              }
            : undefined,
        }));
      }
    } finally {
      observationBusy.current = false;
      if (revision === statusRevision.current) setObserving(false);
    }
  };
  const observation = status.observation;
  const adjusting = observing || focusPending || !!observation?.busy;
  const confirmed =
    statusKnown && !adjusting && !observation?.error && observation?.percentage !== undefined;
  const scaleLabel = adjusting
    ? '正在调整网页显示…'
    : !confirmed
      ? '显示比例尚未确认'
      : `${observation.mode === 'readable' ? '清晰查看' : '适应全部'} ${Math.round(observation.percentage!)}%`;
  const observationDisabled =
    running ||
    loading ||
    hidden ||
    adjusting ||
    !statusKnown ||
    !status.started ||
    status.loading ||
    !!status.blocked ||
    !/^https?:\/\//.test(status.url);
  useEffect(() => {
    if (!focusEntry || !targetView || hidden) return;
    const selected = focusEntry;
    let live = true;
    const revision = ++statusRevision.current;
    observationBusy.current = true;
    setFocusPending(true);
    setFocusReady(false);
    setFocusError('');
    const frame = requestAnimationFrame(
      () =>
        void (async () => {
          try {
            const r = viewport.current!.getBoundingClientRect();
            await api('browser.embedded.viewport', {
              x: Math.max(0, Math.round(r.x)),
              y: Math.max(0, Math.round(r.y)),
              width: Math.round(r.width),
              height: Math.round(r.height),
            });
            if (!live || focusCurrent.current !== selected) return;
            const result: FocusedTarget = await api('browser.embedded.pick.focus', {
              requestId: selected.requestId,
              action: 'show',
            });
            if (!live || focusCurrent.current !== selected) return;
            if (
              result.requestId !== selected.requestId ||
              Math.abs((result.percentage ?? 0) - 100) > 1
            )
              throw new Error('目标查看比例尚未确认，请返回后重新聚焦');
            setFocusReady(true);
          } catch (reason) {
            if (live) setFocusError(browserErrorMessage(reason));
          } finally {
            if (live) setFocusPending(false);
            if (revision === statusRevision.current) observationBusy.current = false;
          }
        })(),
    );
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observationBusy.current = false;
      setFocusPending(false);
    };
  }, [focusEntry, targetView, hidden]);
  const confirmFocus = async () => {
    const selected = focusEntry;
    if (!selected || !focusReady || observationDisabled || focusPending || hidden) return;
    setFocusPending(true);
    setFocusError('');
    try {
      const result: FocusedTarget = await api('browser.embedded.pick.focus', {
        requestId: selected.requestId,
        action: 'confirm',
      });
      if (focusCurrent.current !== selected) return;
      if (result.requestId !== selected.requestId || !(await selected.apply(result.target)))
        throw new Error('来源已变化，请返回后重新选取');
      browserFocus!.close(selected.requestId);
    } catch (reason) {
      if (focusCurrent.current === selected) {
        setFocusReady(false);
        setFocusError(browserErrorMessage(reason));
      }
    } finally {
      if (focusCurrent.current === selected) setFocusPending(false);
    }
  };
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className={`browser-sidebar browser-observation${editing ? ' browser-editor-panel' : ''}${expanded ? ' browser-observation-expanded' : ''}${targetView ? ' browser-target-focus' : ''}`}
      role={expanded && !hidden ? 'dialog' : undefined}
      aria-modal={expanded && !hidden ? true : undefined}
      aria-label={targetView ? '聚焦选中目标' : expanded ? '全宽网页查看' : '内置网页面板'}
      onKeyDown={(event) => {
        if (!expanded || hidden) return;
        if (
          event.key === 'Escape' ||
          (event.altKey && event.key === 'ArrowLeft') ||
          (event.metaKey && event.key === '[')
        ) {
          if (
            (event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]') &&
            event.key !== 'Escape'
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          restorePanel();
        }
        if (event.key === 'Tab') {
          const controls = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]',
            ) ?? [],
          ).filter(
            (control) =>
              control.tabIndex >= 0 &&
              control.getClientRects().length > 0 &&
              !control.closest('[hidden],[inert]'),
          );
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className={`browser-observation-header${expanded ? ' topbar' : ''}`}>
        {expanded ? (
          <>
            <button ref={returnButton} onClick={restorePanel}>
              {focusEntry
                ? '← 返回'
                : observationRequest
                  ? `← 返回${observationOriginLabel ?? '选择对象'}`
                  : '← 返回右侧面板'}
            </button>
            <nav className="breadcrumbs" aria-label="当前位置">
              <a
                href="#browser-panel"
                onClick={(event) => {
                  event.preventDefault();
                  restorePanel();
                }}
              >
                {focusEntry
                  ? '选择操作对象'
                  : observationRequest
                    ? (observationOriginLabel ?? '选择操作对象')
                    : '内置网页'}
              </a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{observationTitle}</span>
            </nav>
          </>
        ) : (
          <div>
            {!editing && <Globe size={18} />}
            <strong>{editing ? '内置网页' : '内置浏览器'}</strong>
            {editing ? (
              <button
                className="primary browser-pick-current"
                disabled={!onPick || running || !statusKnown || !!status.blocked}
                onClick={onPick}
                title={onPick ? '为当前步骤拾取网页目标' : '先选择需要网页目标的步骤'}
              >
                拾取元素
              </button>
            ) : (
              <span className="badge">
                {!statusKnown
                  ? '会话状态未知'
                  : status.blocked
                    ? '网页已停止'
                    : running
                      ? '任务执行中'
                      : `桌面宽度 ${desktopViewportWidth}`}
              </span>
            )}
          </div>
        )}
        <div className="browser-observation-actions" hidden={targetView}>
          {!expanded && (
            <button ref={expandButton} onClick={() => setExpanded(true)}>
              扩大查看
            </button>
          )}
          <button
            title={observationRequest ? '退出网页总览' : '关闭网页面板'}
            aria-label={observationRequest ? '退出网页总览' : '关闭网页面板'}
            onClick={closePanel}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="browser-observation-workspace">
        {expanded && (
          <div className="browser-observation-heading">
            <h1>{observationTitle}</h1>
            <p>
              {targetView ? (
                focusError || observation?.error ? (
                  '暂时无法确认当前目标'
                ) : focusReady ? (
                  '100% 阅读 · 只平移观察窗口，执行坐标保持不变'
                ) : (
                  '正在核对原字号目标与网页身份'
                )
              ) : (
                <>
                  网页布局宽度保持 {desktopViewportWidth} CSS px ·{' '}
                  {confirmed && observation.mode === 'readable'
                    ? '当前按原字号查看局部，可平移至其他区域'
                    : '适应全部查看整体，清晰查看核对文字和目标'}
                </>
              )}
            </p>
          </div>
        )}
        {targetView ? (
          <div className="browser-observation-modes browser-focus-actions">
            <button
              disabled={focusPending}
              onClick={() => {
                setFocusView(false);
                void changeObservation('overview');
              }}
            >
              返回总览
            </button>
            <button
              className="primary"
              disabled={!focusReady || !!focusError || !!observation?.error || observationDisabled}
              onClick={() => void confirmFocus()}
            >
              {focusPending ? '正在核对目标…' : '确认这个目标'}
            </button>
            <button onClick={restorePanel}>返回目标选择</button>
          </div>
        ) : (
          expanded && (
            <div className="browser-observation-modes" aria-label="网页查看模式">
              <button
                disabled={observationDisabled}
                aria-pressed={confirmed && observation.mode === 'readable'}
                onClick={() => void changeObservation('readable')}
              >
                100% · 清晰查看
              </button>
              <button
                disabled={observationDisabled}
                aria-pressed={confirmed && observation.mode === 'overview'}
                onClick={() => void changeObservation('overview')}
              >
                适应全部
              </button>
              {focusEntry && (
                <button disabled={observationDisabled} onClick={() => setFocusView(true)}>
                  聚焦选中目标
                </button>
              )}
            </div>
          )
        )}
        {!targetView && (!editing || expanded) && (
          <div
            className="browser-observation-summary"
            role="status"
            ref={statusSummary}
            tabIndex={-1}
          >
            <span>{scaleLabel}</span>
            <span>网页布局保持 {desktopViewportWidth} CSS px</span>
          </div>
        )}
        {!targetView && (
          <form
            className="browser-address"
            onSubmit={(e) => {
              e.preventDefault();
              void navigate();
            }}
          >
            {editing && <label htmlFor={addressId}>网址</label>}
            <input
              id={addressId}
              ref={addressInput}
              aria-label="网页地址"
              aria-invalid={invalidAddress}
              aria-describedby={invalidAddress ? `${addressId}-error` : undefined}
              placeholder="输入网址，打开网页"
              value={address}
              disabled={running || loading || adjusting || !statusKnown || !!status.blocked}
              onFocus={() => {
                focused.current = true;
              }}
              onBlur={() => {
                focused.current = false;
              }}
              onChange={(e) => {
                addressEdited.current = true;
                if (invalidAddress) {
                  setInvalidAddress(false);
                  setError('');
                }
                setAddress(e.target.value);
              }}
            />
            <button
              type="submit"
              disabled={
                running || loading || adjusting || !statusKnown || !!status.blocked || !address
              }
              title="访问网页"
              aria-label="访问网页"
            >
              <ArrowRight size={17} />
            </button>
            <button
              type="button"
              disabled={
                running ||
                loading ||
                adjusting ||
                !statusKnown ||
                !!status.blocked ||
                !status.url ||
                status.url === 'about:blank'
              }
              onClick={() => navigate(status.url)}
              title="重新加载"
              aria-label="重新加载"
            >
              <RefreshCw size={15} />
            </button>
          </form>
        )}
        {editing && !expanded && (
          <p className="browser-pick-guidance">拾取只定位目标，不触发网页点击或提交。</p>
        )}
        {statusError && (
          <div
            className="browser-error browser-status-error"
            role="alert"
            ref={statusFailure}
            tabIndex={-1}
          >
            <p>网页会话状态未取得：{statusError}</p>
            <button
              disabled={rereading || loading || adjusting}
              onClick={() => void rereadStatus.current?.()}
            >
              {rereading ? '正在读取…' : '重新读取会话'}
            </button>
          </div>
        )}
        {statusKnown && status.blocked && (
          <div className="browser-error" role="alert">
            {status.blocked}
          </div>
        )}
        {!adjusting && observation?.error && !error && (
          <div className="browser-error" role="alert">
            {observation.error}
          </div>
        )}
        {error && (
          <div
            className="browser-error"
            role="alert"
            id={`${addressId}-error`}
            ref={operationError}
            tabIndex={-1}
          >
            {error}
            <button
              onClick={() => {
                setError('');
                setInvalidAddress(false);
                (addressInput.current ?? returnButton.current)?.focus({ preventScroll: true });
              }}
            >
              关闭
            </button>
          </div>
        )}
        {targetView && focusError && (
          <div className="browser-error" role="alert">
            {focusError}
          </div>
        )}
        <div className={`browser-page-area${targetView ? ' browser-focus-card' : ''}`}>
          <div className="browser-viewport" ref={viewport} data-testid="browser-viewport" />
          {targetView && (
            <>
              <p className="browser-focus-caption" role="status">
                {focusPending
                  ? '正在核对选中目标；核对成功后才能确认。'
                  : focusReady && !focusError && !observation?.error
                    ? '这是当前选中目标的原字号预览，已核对唯一匹配。'
                    : '目标尚未通过核对，请返回后重新选取。'}
              </p>
              <div className="browser-focus-target">
                <span>目标类型：{focusKind}</span>
                <span
                  className="browser-focus-page"
                  title={focusEntry.page.title || focusEntry.page.url}
                >
                  页面：{focusEntry.page.title || focusEntry.page.url}
                </span>
                <span>滚动与缩放不改变目标的页面坐标。</span>
              </div>
            </>
          )}
        </div>
        {editing && !expanded && (
          <div className="browser-editor-scale">
            桌面布局宽度 {desktopViewportWidth} CSS px · {scaleLabel}
          </div>
        )}
        {editing && !targetView && (
          <div className="browser-session-disclosure">
            <button aria-expanded={sessionOpen} onClick={() => setSessionOpen(!sessionOpen)}>
              查看定位与会话状态
            </button>
            {sessionOpen && (
              <section aria-label="定位与会话状态" className="browser-session-details">
                <dl>
                  <div>
                    <dt>会话</dt>
                    <dd>
                      {!statusKnown
                        ? '状态未取得'
                        : status.blocked
                          ? '网页已停止'
                          : running
                            ? '任务执行中'
                            : status.started
                              ? '网页会话已打开'
                              : '尚未打开网页'}
                    </dd>
                  </div>
                  <div>
                    <dt>网页</dt>
                    <dd>
                      {statusKnown
                        ? status.title || status.url || '尚无网页地址'
                        : '等待重新取得当前状态'}
                    </dd>
                  </div>
                  <div>
                    <dt>操作</dt>
                    <dd>
                      {running
                        ? '任务执行中，暂停手动导航和拾取'
                        : '拾取后需要确认目标；不会自动执行步骤'}
                    </dd>
                  </div>
                </dl>
                {onLocate ? (
                  <button
                    onClick={() => {
                      if (expanded) {
                        restorePanel();
                        requestAnimationFrame(() => onLocate());
                      } else onLocate();
                    }}
                  >
                    查看当前步骤定位
                  </button>
                ) : (
                  <p>在画布中选择需要网页目标的步骤后查看定位。</p>
                )}
              </section>
            )}
          </div>
        )}
        <footer>
          {targetView ? (
            <span>
              定位来自选择的真实元素；无法唯一匹配时不允许确认。返回选择来源时保留草稿与同一网页会话。
            </span>
          ) : (
            <>
              {statusKnown && status.started && !status.blocked && <span className="local-dot" />}
              {!statusKnown
                ? '正在等待网页会话状态'
                : status.blocked
                  ? '请完整退出并重开应用后核对结果'
                  : loading
                    ? '正在打开网页…'
                    : status.started
                      ? status.title ||
                        (status.url === 'about:blank'
                          ? '在上方输入网址，或运行浏览器流程'
                          : '网页已就绪')
                      : '运行流程或输入网址打开网页'}
              {!status.blocked && (
                <span>
                  {expanded
                    ? '这里只改变查看区域，不重排网页。macOS 清晰查看时，点入网页后按 ⌥⌘ 和方向键平移；滚轮上下查看。切换比例后请重新核对目标。'
                    : '收起面板后任务继续'}
                </span>
              )}
            </>
          )}
        </footer>
      </div>
    </aside>
  );
}
