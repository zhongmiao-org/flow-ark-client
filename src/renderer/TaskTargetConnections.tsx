import { Button, Checkbox, Input, Modal, Flex } from 'antd';
import './antd-layout.css';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ToolConnection } from '../shared/tool-connections';
import type { PlanningTask, TaskDetail } from '../shared/planning';
import { toolsExecutionNotice, type TaskMcpPreview } from '../shared/task-mcp-targets';
import ToolCapabilityReview from './ToolCapabilityReview';
import TaskToolPicker from './TaskToolPicker';
import './task-tool-targets.css';
const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
const statusLabel: Record<ToolConnection['status'], string> = {
  verified: '连接已核对',
  unverified: '需要重新核对',
  disconnected: '已断开',
  failed: '需要重新连接',
};
export default function TaskTargetConnections({
  active,
  task,
  manage,
  selected: apply,
  pending,
  detailsContainer,
}: {
  active: boolean;
  task: PlanningTask;
  manage: () => void;
  selected: (next: TaskDetail) => void;
  pending: (busy: boolean) => void;
  detailsContainer: HTMLElement | null;
}) {
  const [records, setRecords] = useState<ToolConnection[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [query, setQuery] = useState('');
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [choices, setChoices] = useState<
    Record<
      string,
      {
        taskId: string;
        taskRevision: number;
        revision: number;
        digest: string;
        names: string[];
      }
    >
  >({});
  const [refresh, setRefresh] = useState(0);
  const [candidate, setCandidate] = useState<{ preview: TaskMcpPreview; record: ToolConnection }>();
  const [reviewed, setReviewed] = useState(false);
  const [expired, setExpired] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null);
  const errorNotice = useRef<HTMLParagraphElement>(null);
  const focusError = useRef(false);
  const token = useRef<string | undefined>(undefined);
  const epoch = useRef(0),
    locked = useRef(false);
  const titleId = useId();
  const detailsId = useId();
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  const identity = { id: task.id, revision: task.revision };
  useLayoutEffect(() => {
    if (!active || busy || !error || !focusError.current) return;
    focusError.current = false;
    errorNotice.current?.focus();
  }, [active, busy, error]);
  useEffect(() => {
    setSelectedId('');
    setChoices({});
    setQuery('');
  }, [task.id]);
  const cancelCandidate = () => {
    if (token.current)
      void api('task.tools.cancel', { id: task.id, token: token.current }).catch(() => {});
    token.current = undefined;
    setCandidate(undefined);
    setReviewed(false);
  };
  useEffect(() => {
    const ticket = ++epoch.current;
    if (!active) return;
    setLoading(true);
    setListError('');
    setError('');
    focusError.current = false;
    void api('tool.connection.list').then(
      (next: ToolConnection[]) => {
        if (ticket !== epoch.current) return;
        setRecords(next);
        setLoading(false);
      },
      (reason) => {
        if (ticket !== epoch.current) return;
        setListError(reason.message || '连接列表读取失败');
        setLoading(false);
      },
    );
    return () => {
      epoch.current++;
      focusError.current = false;
      if (token.current)
        void api('task.tools.cancel', { id: task.id, token: token.current }).catch(() => {});
      token.current = undefined;
      setCandidate(undefined);
      setReviewed(false);
    };
  }, [active, task.id, task.revision, refresh]);
  useEffect(() => {
    if (!candidate || !active) return;
    setExpired(candidate.preview.expiresAt <= Date.now());
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, candidate.preview.expiresAt - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [candidate, active]);
  const act = async (operation: () => Promise<void>) => {
    if (locked.current) return;
    const ticket = epoch.current;
    locked.current = true;
    setBusy(true);
    pending(true);
    setError('');
    try {
      await operation();
    } catch (reason) {
      if (ticket !== epoch.current) return;
      cancelCandidate();
      focusError.current = true;
      setError(
        (reason instanceof Error ? reason.message : '操作未完成').replace(
          /^Error invoking remote method 'flowark:request': (?:Error: )?/,
          '',
        ),
      );
    } finally {
      locked.current = false;
      setBusy(false);
      pending(false);
    }
  };
  const visible = records.filter((record) =>
    `${record.config.displayName} ${record.config.source}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const record = records.find((item) => item.id === selectedId);
  const saved = task.toolTargets?.find((target) => target.connectionId === selectedId);
  const choice = choices[selectedId];
  const sameTask = choice?.taskId === task.id && choice.taskRevision === task.revision;
  const matchingChoice =
    sameTask && choice.revision === record?.revision && choice.digest === record?.capabilityDigest;
  const matchingSaved =
    saved?.connectionRevision === record?.revision &&
    saved?.capabilityDigest === record?.capabilityDigest;
  const names =
    record?.status === 'verified'
      ? (sameTask
          ? matchingChoice
            ? choice.names
            : []
          : matchingSaved
            ? (saved?.tools.map((tool) => tool.name) ?? [])
            : []
        ).filter((name) => record.tools.some((tool) => tool.name === name))
      : [];
  const selectionChanged = sameTask ? !matchingChoice : !!saved && !matchingSaved;
  const connectionLimit = (task.toolTargets?.length ?? 0) >= 5 && !saved;
  const blocked = loading || !!listError || record?.status !== 'verified' || connectionLimit;
  const choose = (next: ToolConnection, keyboard = false) => {
    cancelCandidate();
    setError('');
    setSelectedId(next.id);
    if (keyboard) requestAnimationFrame(() => detailsHeading.current?.focus());
  };
  const changeNames = (next: string[]) => {
    if (!record || busy || blocked) return;
    setError('');
    setChoices((previous) => ({
      ...previous,
      [record.id]: {
        taskId: task.id,
        taskRevision: task.revision,
        revision: record.revision,
        digest: record.capabilityDigest,
        names: next,
      },
    }));
  };
  return (
    <div className="task-target-connections" aria-busy={loading || busy}>
      <div className="task-target-section-heading">
        <h2>已连接工具</h2>
        <Button
          disabled={loading || busy || undefined}
          onClick={() => setRefresh((value) => value + 1)}
        >
          刷新连接
        </Button>
      </div>
      <p className="ai-task-note">
        选择本次任务需要的工具，再核对来源和完整定义。账号、工作区与系统权限尚未核对。
      </p>
      {error && (
        <p className="alert error" role="alert" ref={errorNotice} tabIndex={-1}>
          {error}
        </p>
      )}
      {listError && (
        <p className="alert error" role="alert">
          {listError}
        </p>
      )}
      {listError && !!records.length && (
        <p className="ai-task-note">
          下方保留上次读取的连接资料。重新加载成功后才能核对并保存新的工具选择。
        </p>
      )}
      {!!task.toolTargets?.length && (
        <section className="task-tools-saved" aria-label="本任务已选工具">
          <h3>已选工具对象</h3>
          {task.toolTargets.map((target) => {
            const current = records.find((record) => record.id === target.connectionId);
            const valid =
              current?.status === 'verified' &&
              current.revision === target.connectionRevision &&
              current.capabilityDigest === target.capabilityDigest;
            return (
              <div className="task-web-object" key={target.selectionId}>
                <strong>
                  {target.displayName} · {target.tools.length} 项
                </strong>
                <p>
                  {loading
                    ? '正在读取连接状态…'
                    : listError
                      ? '连接状态尚未取得'
                      : valid
                        ? '已保存到任务草稿'
                        : '连接已变化或尚未核对，请重新选择'}
                </p>
                <p>{target.tools.map((tool) => tool.title || tool.name).join('、')}</p>
                <Button
                  disabled={busy || loading || undefined}
                  onClick={() =>
                    void act(async () => {
                      const ticket = epoch.current;
                      const next = await api('task.tools.clear', {
                        ...identity,
                        selectionId: target.selectionId,
                      });
                      if (ticket === epoch.current) apply(next);
                    })
                  }
                >
                  移除 {target.displayName} 的任务选择
                </Button>
              </div>
            );
          })}
        </section>
      )}
      {loading ? (
        <p role="status">正在读取你的连接…</p>
      ) : listError && !records.length ? (
        <Button onClick={() => setRefresh((value) => value + 1)}>重新加载</Button>
      ) : !records.length ? (
        <div className="task-target-empty">
          <h3>还没有连接工具</h3>
          <Button type="primary" onClick={manage}>
            连接其他应用
          </Button>
        </div>
      ) : (
        <>
          <label className="task-target-search">
            查找连接
            <Input
              ref={(instance) => {
                search.current = instance?.input ?? null;
              }}
              type="search"
              value={query}
              placeholder="搜索名称或来源"
              onChange={(event) => setQuery(event.target.value)}
              disabled={busy || undefined}
            />
          </label>
          <div className="task-target-connection-list" aria-label="已有连接">
            {visible.map((item) => (
              <Button
                key={item.id}
                className="task-target-connection"
                disabled={busy || loading || undefined}
                aria-pressed={selectedId === item.id}
                aria-controls={detailsId}
                onClick={(event) => choose(item, event.detail === 0)}
              >
                <strong>{item.config.displayName}</strong>
                <span>{item.config.source}</span>
                <span className={`task-target-status is-${item.status}`}>
                  {statusLabel[item.status]} · {item.tools.length} 项能力
                </span>
              </Button>
            ))}
            {!visible.length && (
              <div className="task-target-empty">
                <p>没有找到匹配的连接。</p>
                <Button
                  onClick={() => {
                    setQuery('');
                    search.current?.focus();
                  }}
                >
                  清除搜索
                </Button>
              </div>
            )}
          </div>
          {selectedId && !record && (
            <p className="ai-task-note" role="status">
              之前选择的连接已不在当前列表中，请选择其他连接；已保存的任务选择仍保留在上方。
            </p>
          )}
          <Button disabled={busy || undefined} onClick={manage}>
            连接其他应用
          </Button>
        </>
      )}
      {detailsContainer &&
        createPortal(
          <div id={detailsId} className="task-target-details" aria-label="当前连接与任务能力">
            <h2>当前将操作的对象</h2>
            {!record && (
              <div className="task-target-empty">
                <h3>选择本次任务的工具连接</h3>
                <p>
                  {loading
                    ? '正在读取本机连接…'
                    : selectedId
                      ? '之前的连接已不在列表中，请重新选择。'
                      : '从连接列表选一项，在这里核对身份和本次所需能力。'}
                </p>
                <p>未选择的连接不会加入任务，也不会发送给模型。</p>
              </div>
            )}
            {record && (
              <section
                className="task-web-object task-target-capabilities"
                aria-label="选择任务工具"
              >
                <h3 ref={detailsHeading} tabIndex={-1}>
                  {record.config.displayName}
                </h3>
                <p>
                  {statusLabel[record.status]} ·{' '}
                  {record.config.transport.type === 'stdio' ? '本机程序' : 'HTTP 服务'}
                </p>
                <p>仅选择本次需要的工具（最多 30 项）。服务声明不替代任务授权。</p>
                <dl className="task-tool-identity">
                  <div>
                    <dt>来源</dt>
                    <dd>{record.config.source}</dd>
                  </div>
                  <div>
                    <dt>服务声明</dt>
                    <dd>
                      {record.server
                        ? `${record.server.name} / ${record.server.version}`
                        : '未提供身份'}
                    </dd>
                  </div>
                  <div>
                    <dt>最近核对</dt>
                    <dd>{new Date(record.testedAt).toLocaleString('zh-CN')}</dd>
                  </div>
                  <div>
                    <dt>认证方式</dt>
                    <dd>
                      {record.config.transport.type === 'stdio'
                        ? '本机程序'
                        : record.config.transport.auth === 'oauth'
                          ? 'OAuth 登录'
                          : record.config.transport.auth === 'bearer'
                            ? 'Bearer Token'
                            : '未使用凭据'}
                    </dd>
                  </div>
                </dl>
                {record.oauth && (
                  <p>
                    认证站点：{record.oauth.issuer}
                    <br />
                    授予范围：{record.oauth.scopes.join(' · ') || '未声明具体范围'}
                  </p>
                )}
                <p>账号、工作区与系统权限尚未核对。当前清单不会读取凭据或自动调用工具。</p>
                {selectionChanged && (
                  <p className="ai-task-note" role="status">
                    连接资料或能力已经变化，旧勾选已清除，请按当前定义重新选择。
                  </p>
                )}
                {connectionLimit && (
                  <p className="ai-task-note" role="status">
                    本任务已选择 5 个连接。可以修改已有连接的工具，或先移除一个任务选择。
                  </p>
                )}
                {record.status !== 'verified' && (
                  <p className="ai-task-note" role="status">
                    此连接当前不能用于规划，请先管理连接并重新核对能力。
                  </p>
                )}
                <TaskToolPicker
                  key={`${task.id}:${selectedId}:${record.revision}:${record.capabilityDigest}`}
                  tools={record.tools}
                  names={names}
                  disabled={busy || blocked}
                  change={changeNames}
                />
                <div className="ai-task-actions">
                  <Button
                    type="primary"
                    ref={reviewButton}
                    disabled={busy || blocked || !names.length || undefined}
                    onClick={() =>
                      void act(async () => {
                        const ticket = epoch.current;
                        const preview: TaskMcpPreview = await api('task.tools.preview', {
                          ...identity,
                          connectionId: record.id,
                          connectionRevision: record.revision,
                          toolNames: names,
                        });
                        if (ticket !== epoch.current) {
                          void api('task.tools.cancel', {
                            id: task.id,
                            token: preview.token,
                          }).catch(() => {});
                          return;
                        }
                        token.current = preview.token;
                        setReviewed(false);
                        setCandidate({ preview, record });
                      })
                    }
                  >
                    核对所选工具
                  </Button>
                  <Button disabled={busy || undefined} onClick={manage}>
                    管理连接与能力
                  </Button>
                </div>
              </section>
            )}

            <p className="ai-task-note">{toolsExecutionNotice}</p>
            <p>当前网页和资料继续保留；工具选择不会授予网页写入权限。</p>
          </div>,
          detailsContainer,
        )}
      {candidate && (
        <Modal
          open={active}
          width={800}
          centered
          closable={false}
          mask={{ closable: false }}
          keyboard={!busy}
          footer={null}
          className="flowark-content-modal task-tool-confirm"
          title={
            <h2 id={titleId} ref={heading} tabIndex={-1} style={{ margin: 0, font: 'inherit' }}>
              确认本次工具对象
            </h2>
          }
          aria-labelledby={titleId}
          aria-busy={busy}
          focusable={{ focusTriggerAfterClose: false }}
          onCancel={() => {
            if (!locked.current) {
              cancelCandidate();
              requestAnimationFrame(() => reviewButton.current?.focus());
            }
          }}
          afterOpenChange={(open) => {
            if (open) heading.current?.focus();
          }}
        >
          <p>
            {candidate.preview.target.displayName} · 来源：{candidate.preview.target.source}
          </p>
          <p>
            {candidate.preview.target.transport === 'stdio' ? '本机程序' : 'HTTP 服务'} · 协议{' '}
            {candidate.preview.target.protocolVersion} · 上次核对{' '}
            {new Date(candidate.preview.target.testedAt).toLocaleString()}
          </p>
          <p>账号、工作区、系统权限：尚未核对。读写影响需在可执行方案中确认。</p>
          <p>
            仅把下列 {candidate.preview.target.tools.length}{' '}
            项工具保存到任务草稿；不会连接服务、调用工具或发送给模型。
          </p>
          <ToolCapabilityReview
            current={{ ...candidate.record, tools: candidate.preview.target.tools }}
          />
          <p className="ai-task-note">{toolsExecutionNotice}</p>
          {expired && (
            <p className="field-error" role="alert">
              本次核对已过期，请返回重新选择。
            </p>
          )}
          <Checkbox
            checked={reviewed}
            disabled={busy || expired || undefined}
            onChange={(event) => setReviewed(event.target.checked)}
            className="ai-task-checkbox"
          >
            我已核对来源与本次所选工具
          </Checkbox>
          <Flex gap={12} wrap justify="flex-end" style={{ marginTop: 24 }}>
            <Button
              disabled={busy || undefined}
              onClick={() => {
                cancelCandidate();
                requestAnimationFrame(() => reviewButton.current?.focus());
              }}
            >
              返回重新选择
            </Button>
            <Button
              type="primary"
              disabled={!reviewed || busy || expired || undefined}
              onClick={() =>
                void act(async () => {
                  const ticket = epoch.current;
                  const next = await api('task.tools.select', {
                    ...identity,
                    token: candidate.preview.token,
                  });
                  token.current = undefined;
                  setCandidate(undefined);
                  if (ticket === epoch.current) apply(next);
                })
              }
            >
              {busy ? '正在保存…' : '确认工具对象'}
            </Button>
          </Flex>
        </Modal>
      )}
    </div>
  );
}
