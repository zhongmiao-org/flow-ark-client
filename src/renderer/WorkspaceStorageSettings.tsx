import { Alert, Button, Checkbox, Descriptions, Space } from 'antd';
import { useEffect, useState } from 'react';
import type { WorkspaceStorageReview } from '../host/workspace-storage';

type Status = {
  mode: 'encrypted' | 'workspace-json-v1';
  path: string;
  retainedPath: string;
  candidatePath?: string;
  candidate?: WorkspaceStorageReview;
  stopped: boolean;
  busy: boolean;
};
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);

export default function WorkspaceStorageSettings({ disabled = false }: { disabled?: boolean }) {
  const [status, setStatus] = useState<Status>();
  const [working, setWorking] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''),
    [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void api('workspace.storage.status').then(
      (value) => {
        if (live) setStatus(value);
      },
      (cause) => {
        if (live) setError(String(cause.message ?? cause));
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const perform = async (enable: boolean) => {
    setWorking(true);
    setError('');
    try {
      if (enable) {
        if (!confirmed || !status?.candidate) return;
        await api('workspace.storage.enable', {
          stamp: status.candidate.stamp,
          ordinaryReadable: true,
        });
        setEnabled(true);
      } else {
        setConfirmed(false);
        await api('workspace.storage.preview');
      }
      setStatus(await api('workspace.storage.status'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      try {
        setStatus(await api('workspace.storage.status'));
      } catch {
        /* Keep the last actual preview; a failed read never enables it. */
      }
      setConfirmed(false);
    } finally {
      setWorking(false);
    }
  };
  const blocked = disabled || working || status?.busy || status?.stopped;
  return (
    <div className="local-storage-location">
      <h3>工作区存储方式</h3>
      <p>
        {status
          ? status.mode === 'workspace-json-v1'
            ? '当前：普通工作区'
            : '当前：加密工作区'
          : '正在读取存储方式…'}
      </p>
      <p>
        普通流程资料在本机磁盘可读；API Key
        与工具凭据仍由系统保护，实际使用时可能需要授权。原加密库保留。
      </p>
      {error && <Alert type="error" title={error} showIcon />}
      {(enabled || status?.stopped) && (
        <Alert
          type={enabled ? 'success' : 'warning'}
          showIcon
          title={
            enabled
              ? '普通工作区已启用，请完整退出并重开 FlowArk'
              : '本地宿主已停止，请完整退出并重开后核对存储方式'
          }
          description="当前会话不再运行或写入；启用后新进度不能通过删除清单切回旧加密基线。"
        />
      )}
      {status?.mode === 'encrypted' && !enabled && (
        <>
          <p>
            请先核对脚本、日志和自由文本中自行粘贴的秘密。字段扫描不证明资料不含秘密；预览只创建独立副本，不切换工作区。
          </p>
          <Button
            loading={working}
            disabled={!!blocked || !status}
            onClick={() => void perform(false)}
          >
            预览普通工作区
          </Button>
          {status.candidate && (
            <Space direction="vertical" style={{ width: '100%', marginTop: 12 }}>
              <Descriptions
                column={1}
                size="small"
                items={[
                  {
                    key: 'counts',
                    label: '候选记录',
                    children: `文档 ${status.candidate.counts.documents} 条 · 事件 ${status.candidate.counts.events} 条`,
                  },
                  {
                    key: 'old',
                    label: '保留原库',
                    children: (
                      <span style={{ overflowWrap: 'anywhere' }}>{status.retainedPath}</span>
                    ),
                  },
                  {
                    key: 'new',
                    label: '普通副本',
                    children: (
                      <span style={{ overflowWrap: 'anywhere' }}>{status.candidatePath}</span>
                    ),
                  },
                  {
                    key: 'source',
                    label: '来源摘要',
                    children: (
                      <code style={{ overflowWrap: 'anywhere' }}>
                        {status.candidate.sourceFingerprint}
                      </code>
                    ),
                  },
                  {
                    key: 'target',
                    label: '副本摘要',
                    children: (
                      <code style={{ overflowWrap: 'anywhere' }}>
                        {status.candidate.candidateFingerprint}
                      </code>
                    ),
                  },
                ]}
              />
              <Checkbox
                disabled={!!blocked}
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              >
                我已核对普通资料范围，理解其在本机磁盘可读；凭据仍受系统保护，原加密库保留。
              </Checkbox>
              <p>
                启用先停止本地宿主，重新核对来源与副本；内容变化即拒绝。完成后需完整退出并重开。
              </p>
              <Button
                type="primary"
                disabled={!!blocked || !confirmed}
                onClick={() => void perform(true)}
              >
                启用并等待重开
              </Button>
            </Space>
          )}
        </>
      )}
      {status?.mode === 'workspace-json-v1' && !enabled && (
        <p>普通工作区已启用，未重复迁移。原加密库只作为启用时的恢复基线保留。</p>
      )}
    </div>
  );
}
