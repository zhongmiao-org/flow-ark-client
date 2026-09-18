import { useEffect, useState } from 'react';
import { Globe, Eye, EyeOff } from 'lucide-react';
const api = (method: string, args?: unknown) => window.flowark.request(method, args);
export default function EmbeddedBrowserPanel({
  enabled,
  action,
}: {
  enabled: boolean;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
}) {
  const [status, setStatus] = useState({ started: false, visible: false, url: '' });
  useEffect(() => {
    let live = true;
    const refresh = () =>
      api('browser.embedded.status')
        .then((s) => {
          if (live) setStatus(s);
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="panel embedded-panel">
      <div className="section-row">
        <div className="row">
          <Globe size={22} />
          <h2>FlowArk 内置浏览器</h2>
          <span className="badge">{enabled ? '已启用' : '可选'}</span>
        </div>
        {!enabled ? (
          <button
            className="primary"
            onClick={() =>
              action(
                () => api('browser.embedded.enable'),
                '已启用，请在流程的本机资源中选择内置浏览器',
              )
            }
          >
            启用内置浏览器
          </button>
        ) : (
          <div className="row">
            <button
              disabled={!status.started}
              onClick={() =>
                action(async () =>
                  setStatus(await api('browser.embedded.visibility', { visible: true })),
                )
              }
            >
              <Eye size={15} />
              显示网页
            </button>
            <button
              disabled={!status.started}
              onClick={() =>
                action(async () =>
                  setStatus(await api('browser.embedded.visibility', { visible: false })),
                )
              }
            >
              <EyeOff size={15} />
              收起网页
            </button>
          </div>
        )}
      </div>
      <p>
        在 FlowArk
        专用窗口中操作网页。最小化或收起工作台后，任务继续执行；需要登录或验证码时，再显示网页处理。
      </p>
      <div className="note">
        <b>
          {status.started
            ? status.visible
              ? '网页窗口已显示'
              : '会话在后台运行'
            : '等待流程打开网页'}
        </b>
        <span className="embedded-url">
          {status.url || '在流程「参数与本机资源」中选择 FlowArk 内置浏览器，然后运行或逐步调试。'}
        </span>
      </div>
      <small className="muted">
        使用独立登录会话。电脑休眠、应用退出会停止任务；最小化不会阻止系统休眠。
      </small>
    </section>
  );
}
