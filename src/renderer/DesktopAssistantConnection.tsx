import { Alert, Badge, Button, Tag, type AlertRef } from 'antd';
import { useEffect, useRef, useState } from 'react';
import useDesktopWindows from './useDesktopWindows';

export type AssistantPhase = 'setup' | 'connected' | 'recovery';

export default function DesktopAssistantConnection({
  active,
  choose,
  back,
  onPhase,
}: {
  active: boolean;
  choose: () => void;
  back: () => void;
  onPhase: (phase: AssistantPhase) => void;
}) {
  const state = useDesktopWindows(active, 'tools-assistant', false);
  const { snapshot, loading, settingsPending, expired, error, notice } = state;
  const [settingsChanged, setSettingsChanged] = useState(false);
  const result = useRef<HTMLDivElement>(null);
  const operationError = useRef<AlertRef>(null);
  const operationOrigin = useRef<Element | null | undefined>(undefined);
  useEffect(() => {
    if (!active) {
      operationOrigin.current = undefined;
      return;
    }
    if (loading || settingsPending || operationOrigin.current === undefined) return;
    const origin = operationOrigin.current;
    operationOrigin.current = undefined;
    if (document.activeElement === origin || document.activeElement === document.body) {
      const target = operationError.current?.nativeElement ?? result.current;
      if (target) {
        target.tabIndex = -1;
        target.focus();
      }
    }
  }, [active, loading, settingsPending, snapshot, error]);
  const available =
    !loading && !expired && !settingsChanged && snapshot?.availability === 'available';
  const hasWindows = available && snapshot.windows.length > 0;
  const [hadWindows, setHadWindows] = useState(false);
  useEffect(() => {
    if (!active) {
      setHadWindows(false);
      setSettingsChanged(false);
    } else if (hasWindows) setHadWindows(true);
  }, [active, hasWindows]);
  const phase: AssistantPhase = hasWindows ? 'connected' : hadWindows ? 'recovery' : 'setup';
  useEffect(() => onPhase(phase), [onPhase, phase]);
  const managed = phase !== 'setup';
  const failed = !!error && !snapshot;
  const permission = !expired && !loading && !settingsChanged ? snapshot?.accessibility : undefined;
  const heading = settingsPending
    ? '正在打开系统设置'
    : loading
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
                  ? permission === 'granted'
                    ? '暂时无法读取应用窗口'
                    : '本机助手暂不可用'
                  : available
                    ? hasWindows
                      ? '窗口检查通过'
                      : snapshot.truncated
                        ? '暂未取得可显示的窗口'
                        : '尚未发现应用窗口'
                    : '等待只读检查';
  const detail = settingsChanged
    ? settingsPending
      ? '正在请求打开系统设置，不会替你更改辅助功能权限。'
      : error
        ? '系统权限仍需重新核对。请按下方提示手动打开设置，完成调整后再检查。'
        : notice || '系统权限需要重新核对。完成调整后回到这里重新检查，再选择应用窗口。'
    : expired
      ? '窗口观察已到期。重新检查后，再选择本次任务的窗口；不会自动恢复或重放操作。'
      : snapshot?.availability === 'permission-required'
        ? '辅助功能权限尚未授予本机助手。请在系统设置中核对 FlowArk 的权限，再回到这里检查。'
        : snapshot?.availability === 'unsupported'
          ? '应用窗口当前接入 macOS 的文本编辑。你仍可以使用内置网页、文件或已连接工具。'
          : snapshot?.availability === 'unavailable'
            ? permission === 'granted'
              ? '本次检查已确认辅助功能权限。请先回到文本编辑，确认文档窗口可以正常响应，再重新检查窗口信息。'
              : snapshot.reason || '未能取得应用窗口，请检查文本编辑是否正常响应后重试。'
            : available
              ? snapshot.windows.length
                ? `本次发现 ${snapshot.windows.length} 个 TextEdit 窗口。下一步选择具体窗口，再决定是否读取选中段落。`
                : snapshot.truncated
                  ? '系统权限已就绪，但本次未取得完整窗口清单。请确认文本编辑中的文档可用后重新检查。'
                  : '系统权限已就绪，但没有发现 TextEdit 窗口。请在文本编辑中打开文档，然后重新检查。'
              : '点击下方按钮后检查系统权限和 TextEdit 窗口信息，不读取正文，也不修改文档。';
  const stage =
    settingsChanged || snapshot?.availability === 'permission-required'
      ? 2
      : loading || snapshot || failed
        ? 3
        : 1;
  const source = (
    <>
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
    </>
  );
  const capabilities = (
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
  );
  const records = (
    <>
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
            {snapshot
              ? new Date(snapshot.observedAt).toLocaleString('zh-CN')
              : loading
                ? '检查中'
                : error
                  ? '本次检查未完成'
                  : '尚未检查'}
          </dd>
        </div>
      </dl>
      {snapshot?.expiresAt && !expired && !loading && !settingsChanged && (
        <p className="tool-disclaimer">
          本次观察有效至 {new Date(snapshot.expiresAt).toLocaleTimeString('zh-CN')}
          ，选择对象时会重新检查。
        </p>
      )}
      {notice && !expired && <Alert type="info" showIcon role="status" title={notice} />}
    </>
  );
  const statusColor = hasWindows
    ? 'success'
    : expired || failed || snapshot || hadWindows
      ? 'warning'
      : 'default';
  const status = (
    <div
      className="tool-assistant-result"
      ref={result}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      aria-busy={loading || settingsPending}
    >
      <Tag className="run-state-tag" color={statusColor} icon={<Badge status={statusColor} />}>
        {heading}
      </Tag>
      <Alert
        type={
          failed ? 'error' : hasWindows ? 'success' : statusColor === 'warning' ? 'warning' : 'info'
        }
        showIcon
        role="status"
        title={
          loading ? '正在进行只读检查，离开页面不会创建任务或修改文档。' : failed ? error : detail
        }
      />
      {available && snapshot.truncated && hasWindows && (
        <Alert
          type="warning"
          showIcon
          role="status"
          title="清单可能不完整：部分窗口未能读取，或已达到本次显示上限。选择时请核对实际窗口。"
        />
      )}
    </div>
  );
  return (
    <>
      {!managed && (
        <ol className="tool-assistant-steps sr-only" aria-label="连接步骤">
          {['核对来源', '系统权限', '只读检查'].map((label, index) => (
            <li key={label} aria-current={stage === index + 1 ? 'step' : undefined}>
              <span aria-hidden="true">{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      )}
      <div
        className={`tool-columns tool-assistant-columns${managed ? ' tool-assistant-managed' : ''}`}
      >
        <section className="ai-task-card" aria-labelledby="assistant-source-title">
          {managed ? (
            <>
              {status}
              <h2 id="assistant-source-title">
                {hasWindows ? '可使用的能力' : '本次检查与后续使用'}
              </h2>
              {hasWindows ? (
                capabilities
              ) : (
                <>
                  <div className="tool-definition tool-assistant-recovery">
                    <h3>{loading ? '等待检查结果' : '需要重新核对'}</h3>
                    <p>
                      {loading
                        ? '检查完成前不能选择窗口。不会自动读取选区或重试之前的操作。'
                        : '这次观察不能继续用于选择窗口。重新检查通过后，再为任务选择具体窗口和选区。'}
                    </p>
                  </div>
                  <div className="tool-definition tool-assistant-recovery">
                    <h3>已有任务与操作</h3>
                    <p>
                      此页只更新窗口检查状态，不修改已有任务。已完成的操作不会撤销；结果未知的操作需回到原任务核对。
                    </p>
                  </div>
                </>
              )}
              <details className="tool-assistant-records">
                <summary>来源与操作范围</summary>
                {source}
              </details>
              <Alert
                type="info"
                showIcon
                role="status"
                title={
                  hasWindows
                    ? '能力由系统权限和具体窗口共同决定，选择对象后还需核对选区与本次任务授权。'
                    : '重新检查不会恢复、重放或启动任何任务，也不会替已有任务重新授权。'
                }
              />
            </>
          ) : (
            <>
              <h2 id="assistant-source-title">来源与运行方式</h2>
              {source}
              <h2>可使用的能力</h2>
              {capabilities}
              <Alert
                type="info"
                showIcon
                role="status"
                title="不支持后台读取所有窗口、任意点击应用或发送邮件。"
              />
            </>
          )}
        </section>
        <section className="ai-task-card" aria-labelledby="assistant-check-title">
          <h2 id="assistant-check-title">
            {hasWindows ? '连接管理' : managed ? '恢复窗口检查' : '授权与检查'}
          </h2>
          {managed ? (
            <>
              <p>
                {hasWindows
                  ? '本次观察暂时有效，使用前仍会重新检查。'
                  : '完成权限或应用调整后，手动检查以取得新的窗口信息。'}
              </p>
              {records}
            </>
          ) : (
            status
          )}
          {error && snapshot && (
            <Alert type="error" showIcon role="alert" ref={operationError} title={error} />
          )}
          <div className="tool-assistant-actions">
            {hasWindows && (
              <Button type="primary" disabled={settingsPending || undefined} onClick={choose}>
                选择应用窗口
              </Button>
            )}
            <Button
              type={
                hasWindows || (!settingsChanged && snapshot?.availability === 'permission-required')
                  ? 'default'
                  : 'primary'
              }
              disabled={loading || settingsPending || undefined}
              onClick={() => {
                operationOrigin.current = document.activeElement;
                setSettingsChanged(false);
                void state.refresh();
              }}
            >
              {loading
                ? '正在检查…'
                : hadWindows || snapshot || error || expired
                  ? '重新检查权限与窗口'
                  : '检查权限与窗口'}
            </Button>
            {snapshot?.platform === 'macos' && (
              <Button
                type={
                  snapshot.availability === 'permission-required' && !settingsChanged
                    ? 'primary'
                    : 'default'
                }
                disabled={loading || settingsPending || undefined}
                onClick={() => {
                  operationOrigin.current = document.activeElement;
                  setSettingsChanged(true);
                  void state.openSettings();
                }}
              >
                {settingsPending ? '正在打开系统设置…' : '查看系统辅助功能设置'}
              </Button>
            )}
            <Button onClick={back}>返回应用与工具</Button>
          </div>

          {!managed && (
            <details className="tool-assistant-records">
              <summary>权限与检查记录</summary>
              {records}
            </details>
          )}
          <Alert
            type="info"
            showIcon
            role="status"
            title="系统权限与每次任务授权分别核对。此页不会启动任务，检查通过也不代表文档可修改；窗口、选区与读写能力在使用前再次检查。"
          />
        </section>
      </div>
    </>
  );
}
