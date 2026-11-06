import { useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Select, Space, Tag, InputNumber } from 'antd';
const api = (method: string, args: unknown = {}): Promise<any> => window.flowark.request(method, args);
export default function DesktopAutomationPanel({ scopeId, connection }: { scopeId: string; connection?: any }) {
  const [discovery, setDiscovery] = useState<any>(), [selection, setSelection] = useState<string>();
  const [binding, setBinding] = useState<any>(), [images, setImages] = useState(false), [actions, setActions] = useState(false), [reviewed, setReviewed] = useState(false);
  const [requests, setRequests] = useState(20), [minutes, setMinutes] = useState(10), [cost, setCost] = useState(false);
  const [modelLabel, setModelLabel] = useState('当前工程已保存的 AI 服务');
  useEffect(() => { let live = true; if (connection?.provider === 'compatible') { setModelLabel(connection.model + ' · ' + connection.baseUrl); return; } void api('ai.configuration.get', { provider: connection?.provider ?? 'deepseek' }).then(c => { if (live) setModelLabel((c.provider ?? connection?.provider ?? 'deepseek') + ' · ' + c.model); }).catch(() => {}); return () => { live = false; }; }, [connection?.provider, connection?.model, connection?.baseUrl]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const perform = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } };
  useEffect(() => { let live = true; void api('desktop.automation.state', { scopeId }).then(v => { if (live) setBinding(v); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [scopeId]);
  return <Card title="macOS 桌面窗口">
    {error && <Alert type="error" showIcon message={error} />}
    <p>模型：{modelLabel}</p><p>明确选择本次要操作的窗口。系统权限、窗口读取、桌面动作与 AI 费用分别核对。</p>
    <Space wrap><Button disabled={busy || binding?.active} onClick={() => void perform(async () => { setBinding(null); setSelection(undefined); setReviewed(false); setDiscovery(await api('desktop.automation.list')); })}>检查当前应用窗口</Button>
      <Button disabled={busy} onClick={() => void perform(async () => { await api('desktop.automation.settings', { permission: 'accessibility' }); })}>辅助功能权限</Button>
      <Button disabled={busy} onClick={() => void perform(async () => { await api('desktop.automation.settings', { permission: 'screen-recording' }); })}>屏幕录制权限</Button></Space>
    {discovery && <>{discovery.applicationPermissions && <p>主应用权限：辅助功能{discovery.applicationPermissions.accessibility ? '已授权' : '未授权'} · 屏幕录制{discovery.applicationPermissions.screenRecording === 'granted' ? '已授权' : discovery.applicationPermissions.screenRecording}</p>}{discovery.applicationPermissions?.accessibility && discovery.accessibility !== 'granted' && <Alert type="warning" message="主应用与桌面助手权限不一致" description="先核对安装包签名及助手身份；本次不会执行动作，不需要反复切换相同权限开关。" />}<p>桌面助手辅助功能：{discovery.accessibility === 'granted' ? '已授权' : '尚未授权'} · 屏幕录制：{discovery.screenRecording ? '已授权' : '尚未授权'}</p>
      <Select aria-label="本次桌面目标窗口" style={{ width: '100%', marginBottom: 16 }} value={selection} placeholder="选择准确应用和窗口" options={(discovery.windows ?? []).map((w: any) => ({ value: w.id, label: w.application + ' · ' + (w.title || '无标题窗口') + (w.minimized ? '（最小化）' : '') }))} onChange={id => { setSelection(id); setReviewed(false); }} />
      <Space direction="vertical"><Space>共享模型预算<InputNumber aria-label="桌面模型请求预算" min={1} max={100} value={requests} onChange={v => { setRequests(v ?? 20); setCost(false); }} />次<InputNumber aria-label="桌面任务分钟" min={1} max={60} value={minutes} onChange={v => { setMinutes(v ?? 10); setCost(false); }} />分钟</Space><Checkbox checked={cost} onChange={e => setCost(e.target.checked)}>使用当前工程的 AI 配置；规划与视觉共用本批预算。API Key 产生的费用由用户自行承担</Checkbox><Checkbox checked={images} onChange={e => { setImages(e.target.checked); setReviewed(false); }}>允许按需读取这个窗口的截图；仅在另行确认的模型预算内发送给 AI</Checkbox>
        <Checkbox checked={actions} onChange={e => { setActions(e.target.checked); setReviewed(false); }}>允许流程操作这个窗口：点击、输入、滚动、拖动及组合键</Checkbox>
        <Checkbox checked={reviewed} onChange={e => setReviewed(e.target.checked)}>已核对目标与范围；发送、填写或保存须核对实际结果，unknown 不重发</Checkbox>
        <Button type="primary" disabled={busy || !selection || !reviewed || !cost} onClick={() => void perform(async () => { setBinding(await api('desktop.automation.bind', { scopeId, windowId: selection, screenshotAllowed: images, actionsAllowed: actions, maxRequests: requests, durationMs: minutes * 60000, reviewedCost: true, reviewed: true })); })}>绑定本次窗口</Button>
      </Space></>}
    {binding && <div style={{ marginTop: 16 }}><Tag color="blue">{binding.application} · {binding.title}</Tag><p>绑定有效至 {new Date(binding.expiresAt).toLocaleTimeString()}；退出、锁屏或运行收尾后重新绑定，不随 ZIP 导出。</p><Button disabled={busy || binding.active} onClick={() => void perform(async () => { await api('desktop.automation.release', { scopeId }); setBinding(null); })}>解除绑定</Button></div>}
  </Card>;
}
