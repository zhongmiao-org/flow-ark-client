import { useEffect, useRef, useState } from 'react';
import { Globe, X, ArrowRight, RefreshCw } from 'lucide-react';
import './browser-observation.css';
import { desktopViewportWidth } from '../shared/browser-viewport';
const api = (method: string, args?: unknown) => window.flowark.request(method, args);
export default function BrowserSidebar({
  close,
  running,
  obscured,
}: {
  close: () => void;
  running: boolean;
  obscured: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [scale, setScale] = useState<number>();
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
  useEffect(() => {
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
    restoreFocus.current = true;
    setExpanded(false);
  };
  const [status, setStatus] = useState<{
    started: boolean;
    url: string;
    title: string;
    blocked?: string;
  }>({ started: false, url: '', title: '' });
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const focused = useRef(false);
  const addressEdited = useRef(false);
  const obscuredRef = useRef(hidden);
  const enabled = useRef(false);
  obscuredRef.current = hidden;
  useEffect(() => {
    let live = true;
    const bounds = () => {
      const r = viewport.current?.getBoundingClientRect();
      if (r) setScale(Math.round((r.width / desktopViewportWidth) * 100));
      if (r)
        void api('browser.embedded.viewport', {
          x: Math.max(0, Math.round(r.x)),
          y: Math.max(0, Math.round(r.y)),
          width: Math.round(r.width),
          height: Math.round(r.height),
        }).catch(() => {});
    };
    const refresh = async () => {
      try {
        const s = await api('browser.embedded.status');
        if (live) {
          setStatus(s);
          if (!focused.current && !addressEdited.current)
            setAddress(s.url === 'about:blank' ? '' : s.url);
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    };
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
        if (live) setError(String(e));
      }
    })();
    const observer = new ResizeObserver(bounds);
    if (viewport.current) observer.observe(viewport.current);
    window.addEventListener('resize', bounds);
    const timer = setInterval(refresh, 750);
    return () => {
      live = false;
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
        setError(String(error)),
      );
  }, [hidden]);
  useEffect(() => {
    const r = viewport.current?.getBoundingClientRect();
    if (r)
      void api('browser.embedded.viewport', {
        x: Math.max(0, Math.round(r.x)),
        y: Math.max(0, Math.round(r.y)),
        width: Math.round(r.width),
        height: Math.round(r.height),
      }).catch(() => {});
  }, [error]);
  const closePanel = () => {
    const toggle = document.querySelector<HTMLElement>('[aria-label="收起网页面板"]');
    close();
    requestAnimationFrame(() => {
      if (toggle?.isConnected) toggle.focus({ preventScroll: true });
    });
  };
  const navigate = async (url = address) => {
    setLoading(true);
    setError('');
    try {
      await api('browser.embedded.navigate', {
        url: /^https?:\/\//.test(url) ? url : 'https://' + url,
      });
      addressEdited.current = false;
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <aside
      ref={panel}
      className={`browser-sidebar browser-observation${expanded ? ' browser-observation-expanded' : ''}`}
      role={expanded && !hidden ? 'dialog' : undefined}
      aria-modal={expanded && !hidden ? true : undefined}
      aria-label={expanded ? '全宽网页查看' : '内置网页面板'}
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
              'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
            ) ?? [],
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
              ← 返回右侧面板
            </button>
            <nav className="breadcrumbs" aria-label="当前位置">
              <a
                href="#browser-panel"
                onClick={(event) => {
                  event.preventDefault();
                  restorePanel();
                }}
              >
                内置网页
              </a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">扩大查看网页</span>
            </nav>
          </>
        ) : (
          <div>
            <Globe size={18} />
            <strong>内置浏览器</strong>
            <span className="badge">
              {status.blocked
                ? '网页已停止'
                : running
                  ? '任务执行中'
                  : `桌面宽度 ${desktopViewportWidth}`}
            </span>
          </div>
        )}
        <div className="browser-observation-actions">
          {!expanded && (
            <button ref={expandButton} onClick={() => setExpanded(true)}>
              扩大查看
            </button>
          )}
          <button title="关闭网页面板" aria-label="关闭网页面板" onClick={closePanel}>
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="browser-observation-workspace">
        {expanded && (
          <div className="browser-observation-heading">
            <h1>扩大查看网页</h1>
            <p>网页布局宽度保持 {desktopViewportWidth} CSS px · 当前按可见区域适应宽度</p>
          </div>
        )}
        <div className="browser-observation-summary" role="status">
          <span>
            {expanded ? '全宽总览' : '网页总览'} ·{' '}
            {scale === undefined ? '正在计算显示比例' : `适应宽度 ${scale}%`}
          </span>
          <span>网页布局保持 {desktopViewportWidth} CSS px</span>
        </div>
        <form
          className="browser-address"
          onSubmit={(e) => {
            e.preventDefault();
            void navigate();
          }}
        >
          <input
            aria-label="网页地址"
            placeholder="输入网址，打开网页"
            value={address}
            disabled={running || loading || !!status.blocked}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
            }}
            onChange={(e) => {
              addressEdited.current = true;
              setAddress(e.target.value);
            }}
          />
          <button
            type="submit"
            disabled={running || loading || !!status.blocked || !address}
            title="访问网页"
            aria-label="访问网页"
          >
            <ArrowRight size={17} />
          </button>
          <button
            type="button"
            disabled={
              running || loading || !!status.blocked || !status.url || status.url === 'about:blank'
            }
            onClick={() => navigate(status.url)}
            title="重新加载"
            aria-label="重新加载"
          >
            <RefreshCw size={15} />
          </button>
        </form>
        {status.blocked && (
          <div className="browser-error" role="alert">
            {status.blocked}
          </div>
        )}
        {error && (
          <div className="browser-error" role="alert">
            {error}
            <button onClick={() => setError('')}>关闭</button>
          </div>
        )}
        <div className="browser-viewport" ref={viewport} data-testid="browser-viewport" />
        <footer>
          <span className="local-dot" />
          {status.blocked
            ? '请完整退出并重开应用后核对结果'
            : loading
              ? '正在打开网页…'
              : status.started
                ? status.title ||
                  (status.url === 'about:blank' ? '在上方输入网址，或运行浏览器流程' : '网页已就绪')
                : '运行流程或输入网址打开网页'}
          {!status.blocked && <span>收起面板后任务继续</span>}
        </footer>
      </div>
    </aside>
  );
}
