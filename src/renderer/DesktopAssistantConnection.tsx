import { useState } from 'react';
import useDesktopWindows from './useDesktopWindows';

export default function DesktopAssistantConnection({
  active,
  choose,
  back,
}: {
  active: boolean;
  choose: () => void;
  back: () => void;
}) {
  const state = useDesktopWindows(active, 'tools-assistant', false);
  const { snapshot, loading, settingsPending, expired, error, notice } = state;
  const [settingsChanged, setSettingsChanged] = useState(false);
  const available =
    !loading && !expired && !settingsChanged && snapshot?.availability === 'available';
  const hasWindows = available && snapshot.windows.length > 0;
  const failed = !!error && !snapshot;
  const permission = !expired && !loading && !settingsChanged ? snapshot?.accessibility : undefined;
  const heading = loading
    ? '正在检查权限与窗口'
    : settingsChanged
      ? '请重新检查权限与窗口'
      : expired
        ? '这次检查已失效'
        : failed
          ? '本次检查未完成'
          : snapshot?.availability === 'permission-required'
            ? '尚需辅助功能权限'
            : snapshot?.availability === 'unsupported'
              ? '当前系统暂不支持'
              : snapshot?.availability === 'unavailable'
                ? '本机助手暂不可用'
                : available
                  ? hasWindows
                    ? '窗口发现可用'
                    : '尚未发现应用窗口'
                  : '等待只读检查';
  const detail = settingsChanged
    ? '系统权限需要重新核对。完成调整后回到这里重新检查，再选择应用窗口。'
    : expired
      ? '窗口观察已到期。重新检查后，再选择本次任务的窗口；不会自动恢复或重放操作。'
      : snapshot?.availability === 'permission-required'
        ? '辅助功能权限尚未授予本机助手。请在系统设置中核对 FlowArk 的权限，再回到这里检查。'
        : snapshot?.availability === 'unsupported'
          ? '应用窗口当前接入 macOS 的文本编辑。你仍可以使用内置网页、文件或已连接工具。'
          : snapshot?.availability === 'unavailable'
            ? snapshot.reason || '未能取得应用窗口，请检查文本编辑是否正常响应后重试。'
            : available
              ? snapshot.windows.length
                ? `本次发现 ${snapshot.windows.length} 个 TextEdit 窗口。下一步选择具体窗口，再决定是否读取选中段落。`
                : '系统权限已就绪，但没有发现 TextEdit 窗口。请在文本编辑中打开文档，然后重新检查。'
              : '点击下方按钮后检查系统权限和 TextEdit 窗口信息，不读取正文，也不修改文档。';
  const stage =
    settingsChanged || snapshot?.availability === 'permission-required'
      ? 2
      : loading || snapshot
        ? 3
        : 1;
  return (
    <>
      <ol className="tool-assistant-steps sr-only" aria-label="连接步骤">
        {['核对来源', '系统权限', '只读检查'].map((label, index) => (
          <li key={label} aria-current={stage === index + 1 ? 'step' : undefined}>
            <span aria-hidden="true">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="tool-columns tool-assistant-columns">
        <section className="ai-task-card" aria-labelledby="assistant-source-title">
          <h2 id="assistant-source-title">来源与运行方式</h2>
          <div className="tool-definition tool-assistant-source">
            <h3>FlowArk 本机应用助手</h3>
            <p>随客户端提供，在这台 Mac 上运行，无需安装其他连接程序。</p>
          </div>
          <dl className="tool-assistant-facts">
            <div>
              <dt>工作区</dt>
              <dd>本机桌面 · TextEdit（文本编辑）</dd>
            </div>
            <div>
              <dt>账号</dt>
              <dd>此助手不连接云端账号；文档归属需在任务中核对</dd>
            </div>
            <div>
              <dt>操作范围</dt>
              <dd>本次任务明确选择的窗口与原选区</dd>
            </div>
          </dl>
          <h2>可使用的能力</h2>
          <ul className="tool-assistant-capabilities">
            <li>
              <h3>发现目标</h3>
              <p>只读检查 TextEdit 窗口的标题与状态，用于选择操作对象。</p>
            </li>
            <li>
              <h3>读取选中段落</h3>
              <p>选择窗口并明确点击后预览原选区，再决定是否用于生成方案。</p>
            </li>
            <li>
              <h3>替换选区并回读</h3>
              <p>核对原窗口、选区与可写能力；确认本次试运行后才执行。</p>
            </li>
          </ul>
          <p className="ai-task-note">不支持后台读取所有窗口、任意点击应用或发送邮件。</p>
        </section>
        <section className="ai-task-card" aria-labelledby="assistant-check-title">
          <h2 id="assistant-check-title">授权与检查</h2>
          <div
            className={`tool-assistant-result${hasWindows ? ' is-available' : expired || failed || snapshot ? ' is-warning' : ''}`}
            role="status"
            aria-live="polite"
          >
            <span
              className={`tool-status${hasWindows ? ' success' : expired || failed || snapshot ? ' warning' : ''}`}
            >
              {heading}
            </span>
            <p>
              {loading
                ? '正在进行只读检查，离开页面不会创建任务或修改文档。'
                : failed
                  ? error
                  : detail}
            </p>
          </div>
          {error && snapshot && (
            <p className="ai-task-note ai-task-failure" role="alert">
              {error}
            </p>
          )}
          <div className="tool-assistant-actions">
            {hasWindows && (
              <button className="primary" disabled={settingsPending} onClick={choose}>
                选择应用窗口
              </button>
            )}
            {snapshot?.platform === 'macos' && (
              <button
                className={
                  snapshot.availability === 'permission-required' && !settingsChanged
                    ? 'primary'
                    : undefined
                }
                disabled={loading || settingsPending}
                onClick={() => {
                  setSettingsChanged(true);
                  void state.openSettings();
                }}
              >
                {settingsPending ? '正在打开系统设置…' : '查看系统辅助功能设置'}
              </button>
            )}
            <button
              className={
                hasWindows || (!settingsChanged && snapshot?.availability === 'permission-required')
                  ? undefined
                  : 'primary'
              }
              disabled={loading || settingsPending}
              onClick={() => {
                setSettingsChanged(false);
                void state.refresh();
              }}
            >
              {loading
                ? '正在检查…'
                : snapshot || error || expired
                  ? '重新检查权限与窗口'
                  : '检查权限与窗口'}
            </button>
            <button onClick={back}>返回应用与工具</button>
          </div>
          <details className="tool-assistant-records">
            <summary>权限与检查记录</summary>
            <dl className="tool-assistant-facts">
              <div>
                <dt>系统权限</dt>
                <dd>
                  {permission === 'granted'
                    ? '本次检查已授予'
                    : permission === 'not-granted'
                      ? '尚未授予'
                      : '尚未核对'}
                </dd>
              </div>
              <div>
                <dt>本次任务授权</dt>
                <dd>尚未选择窗口，未授予读取或修改授权</dd>
              </div>
              <div>
                <dt>最近检查</dt>
                <dd>
                  {snapshot ? new Date(snapshot.observedAt).toLocaleString('zh-CN') : '尚未检查'}
                </dd>
              </div>
            </dl>
            {available && snapshot.truncated && (
              <p className="ai-task-note">
                部分窗口未能读取，或已达到显示上限；请在选择时核对实际窗口。
              </p>
            )}
            {snapshot?.expiresAt && !expired && !loading && !settingsChanged && (
              <p className="tool-disclaimer">
                本次观察有效至 {new Date(snapshot.expiresAt).toLocaleTimeString('zh-CN')}
                ，选择对象时会重新检查。
              </p>
            )}
            {notice && !expired && (
              <p className="ai-task-note" role="status">
                {notice}
              </p>
            )}
          </details>
          <p className="ai-task-note">
            系统权限与每次任务授权分别核对。此页不会启动任务，检查通过也不代表文档可修改；窗口、选区与读写能力在使用前再次检查。
          </p>
        </section>
      </div>
    </>
  );
}
