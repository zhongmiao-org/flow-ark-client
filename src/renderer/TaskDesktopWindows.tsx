import { useEffect, useRef } from 'react';
import useDesktopWindows from './useDesktopWindows';
import DesktopSelectionPreview from './DesktopSelectionPreview';
import './task-desktop-windows.css';
export { useDesktopWindows };

type DesktopState = ReturnType<typeof useDesktopWindows>;

export function DesktopWindowList({
  state,
  compactSelected = false,
}: {
  state: DesktopState;
  compactSelected?: boolean;
}) {
  const { snapshot, selected, loading, error, notice } = state;
  const ready = compactSelected && !!selected && !state.expired;
  const title = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selected) title.current?.focus();
    else if (previous.current) list.current?.querySelector('button')?.focus();
    previous.current = selected?.id;
  }, [selected?.id]);
  return (
    <div className={`task-desktop-list${ready ? ' is-selected' : ''}`}>
      {!ready && (
        <div className="task-target-section-heading">
          <h2>文本编辑的窗口</h2>
          <button onClick={() => void state.refresh()} disabled={loading || state.settingsPending}>
            {loading ? '正在检查…' : '重新检查'}
          </button>
        </div>
      )}
      {!selected && (
        <p className="ai-task-note">查看已打开的 TextEdit 窗口。选择后可核对窗口信息和可用能力。</p>
      )}
      {loading && <p role="status">正在检查系统权限与窗口…</p>}
      {error && (
        <p className="ai-task-note ai-task-failure" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ai-task-note" role="status">
          {notice}
        </p>
      )}
      {snapshot?.availability === 'available' && (
        <>
          {selected ? (
            <>
              <div className="task-web-object task-desktop-identity task-web-current">
                <h3 ref={title} tabIndex={-1}>
                  文本编辑 · {selected.title || '未命名窗口'}
                </h3>
                <p>窗口状态：{selected.minimized ? '已最小化' : '未最小化'} · 来自本次检查</p>
                <p>任务状态：尚未绑定窗口 · 未授权修改</p>
              </div>
              <div className="task-web-object task-desktop-account">
                <h3>工作区与账号</h3>
                <p>本机 TextEdit · 只在明确点击后读取选中段落</p>
                <p>未读取其他段落或文件路径；账号与文档归属尚未核对</p>
              </div>
              <div className="ai-task-actions">
                <button className="task-desktop-change" onClick={() => state.select(undefined)}>
                  更换窗口
                </button>
                {ready && (
                  <button
                    disabled={loading || state.settingsPending}
                    onClick={() => void state.refresh()}
                  >
                    重新检查
                  </button>
                )}
              </div>
            </>
          ) : snapshot.windows.length ? (
            <div
              className="task-desktop-window-list"
              ref={list}
              role="group"
              aria-label="已发现的 TextEdit 窗口"
            >
              {snapshot.windows.map((window, index) => (
                <button
                  className="task-target-connection"
                  key={window.id}
                  disabled={state.expired}
                  onClick={() => state.select(window.id)}
                >
                  <strong>{window.title || '未命名窗口'}</strong>
                  <span>
                    文本编辑 · 窗口 {index + 1} · {window.minimized ? '已最小化' : '未最小化'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="task-target-empty" role="status">
              <h3>没有发现可显示的窗口</h3>
              <p>请在文本编辑中打开文档，然后重新检查。</p>
            </div>
          )}
          {snapshot.truncated && (
            <p className="ai-task-note" role="status">
              清单可能不完整：部分窗口未能读取，或已达到本次显示上限。
            </p>
          )}
          {!ready && (
            <p className="task-desktop-observed">
              检查时间：{new Date(snapshot.observedAt).toLocaleTimeString('zh-CN')} · 本次观察
            </p>
          )}
        </>
      )}
      {snapshot?.availability === 'permission-required' && (
        <div className="task-target-empty">
          <h3>尚需辅助功能权限</h3>
          <p>
            系统尚未允许本机助手识别应用窗口。先查看右侧授权说明，再由你决定是否在系统设置中开启。
          </p>
        </div>
      )}
      {snapshot?.availability === 'unsupported' && (
        <div className="task-target-empty">
          <h3>当前系统暂不支持应用窗口</h3>
          <p>应用窗口发现当前仅接入 macOS 的文本编辑。你可以继续使用网页或已连接工具。</p>
        </div>
      )}
      {snapshot?.availability === 'unavailable' && (
        <div className="task-target-empty" role="status">
          <h3>暂时无法取得窗口</h3>
          <p>{snapshot.reason || '请检查文本编辑是否可以正常响应，再重新检查。'}</p>
        </div>
      )}
      <p className="ai-task-note">
        窗口关闭、内容或选区变化后需要重新核对。刷新会清除本次查看选择，不会自动选择同名窗口。
      </p>
      {ready && snapshot && (
        <details className="task-desktop-observed">
          <summary>窗口检查记录</summary>
          <p>检查时间：{new Date(snapshot.observedAt).toLocaleTimeString('zh-CN')} · 本次观察</p>
        </details>
      )}
    </div>
  );
}

export function DesktopWindowCapabilities({
  state,
  back,
  chooseWeb,
  backLabel = '返回描述与资料',
  plan,
}: {
  state: DesktopState;
  back: () => void;
  backLabel?: string;
  chooseWeb: () => void;
  plan: () => void;
}) {
  const { snapshot, loading } = state;
  const permission =
    state.expired || loading || state.settingsPending ? undefined : snapshot?.accessibility;
  return (
    <div className="task-desktop-capabilities">
      <h2>支持哪些操作</h2>
      {[
        {
          label: '识别应用窗口信息',
          checked: !state.expired && snapshot?.availability === 'available',
        },
        {
          label: '读取选中段落 · 点击后核对',
          checked: !state.expired && state.preview?.status === 'ready',
        },
        { label: '编辑选中段落并回读 · 需在试运行前核对能力与授权', checked: false },
        { label: '发送邮件 / 后台操作其他窗口 · 不支持', checked: false },
      ].map(({ label, checked }) => (
        <label className="ai-task-checkbox" key={label}>
          <input type="checkbox" checked={checked} disabled />
          {label}
        </label>
      ))}
      <div
        className={`task-desktop-permission ${permission === 'granted' ? 'is-ready' : permission === 'not-granted' ? 'is-warning' : ''}`}
        role="status"
      >
        <h3>
          {loading
            ? '正在检查系统权限'
            : permission === 'granted'
              ? '系统权限已就绪'
              : permission === 'not-granted'
                ? '尚需系统授权'
                : '系统权限尚未核对'}
        </h3>
        <p>
          {permission === 'granted'
            ? '辅助功能已授予本机助手；读取段落仍需明确点击，文档修改尚未授权。'
            : permission === 'not-granted'
              ? '辅助功能权限未授予，当前不能识别或操作窗口。系统授权须由你在设置中决定。'
              : '取得权限状态后才能判断窗口发现是否可用。'}
        </p>
      </div>
      <DesktopSelectionPreview state={state} plan={plan} />
      {snapshot?.platform === 'macos' && (
        <details className="task-desktop-permission-settings" open={permission !== 'granted'}>
          <summary>系统权限与重新检查</summary>
          <p>打开系统设置会清除这次窗口选择和选区预览。返回后重新检查，再选择任务对象。</p>
          <button
            disabled={state.settingsPending || loading}
            onClick={() => void state.openSettings()}
          >
            {state.settingsPending ? '正在打开…' : '查看系统辅助功能设置'}
          </button>
        </details>
      )}
      {!state.selected && (
        <p className="ai-task-note">
          选择窗口并读取段落后可生成改动预览；保存方案后，还需重新绑定原选区并确认试运行。
        </p>
      )}
      <div className="ai-task-actions">
        <button onClick={chooseWeb}>改用网页目标</button>
        <button onClick={back}>{backLabel}</button>
      </div>
    </div>
  );
}
