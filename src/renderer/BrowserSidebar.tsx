import { useEffect, useRef, useState } from 'react';
import { Globe, X, ArrowRight, RefreshCw } from 'lucide-react';
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
  const obscuredRef = useRef(obscured);
  const enabled = useRef(false);
  obscuredRef.current = obscured;
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
    const refresh = async () => {
      try {
        const s = await api('browser.embedded.status');
        if (live) {
          setStatus(s);
          if (!focused.current) setAddress(s.url === 'about:blank' ? '' : s.url);
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
      void api('browser.embedded.visibility', { visible: !obscured }).catch((error) =>
        setError(String(error)),
      );
  }, [obscured]);
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
  const navigate = async (url = address) => {
    setLoading(true);
    setError('');
    try {
      await api('browser.embedded.navigate', {
        url: /^https?:\/\//.test(url) ? url : 'https://' + url,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <aside className="browser-sidebar" aria-label="内置网页面板">
      <header>
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
        <button title="关闭网页面板" aria-label="关闭网页面板" onClick={close}>
          <X size={17} />
        </button>
      </header>
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
          onChange={(e) => setAddress(e.target.value)}
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
    </aside>
  );
}
