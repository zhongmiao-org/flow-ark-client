import TechnicalDetails from './TechnicalDetails';
import type { Flow } from '../shared/types';
import { runInstancePresenter } from './run-instance-presentation';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space } from 'antd';
import { assertDataReceipt, type DataReceipt } from '../shared/template-data';
import ContextResultView from './ContextResultView';
import './template-data.css';
type Operation = { nodeInstance: string; receipt: DataReceipt };
const pageSize = 10;
const labels = {
  prepared: '结果待核对',
  unknown: '结果待核对',
  written: '已提交',
  conflict: '修订冲突',
  cancelled: '未提交',
};
export default function RunContextOperations({
  runId,
  runState,
  snapshot,
}: {
  runId: string;
  runState: string;
  snapshot?: Flow;
}) {
  const [open, setOpen] = useState(false),
    [ops, setOps] = useState<Operation[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [inspecting, setInspecting] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string | null>(null);
  const sectionId = useId(),
    epoch = useRef(0),
    mounted = useRef(true),
    inspectLock = useRef<string | null>(null),
    pageOrigin = useRef<HTMLElement | null>(null),
    previousPage = useRef<HTMLButtonElement>(null),
    nextPage = useRef<HTMLButtonElement>(null),
    pagePosition = useRef<HTMLSpanElement>(null),
    owner = useRef(runId),
    expanded = useRef(open);
  owner.current = runId;
  expanded.current = open;
  useLayoutEffect(() => {
    const origin = pageOrigin.current;
    pageOrigin.current = null;
    if (!origin) return;
    const other = origin === nextPage.current ? previousPage.current : nextPage.current;
    const target =
      origin.isConnected && !origin.hasAttribute('disabled')
        ? origin
        : other && !other.disabled
          ? other
          : pagePosition.current;
    target?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const request = ++epoch.current;
    const current = () =>
      live &&
      mounted.current &&
      owner.current === runId &&
      expanded.current &&
      epoch.current === request;
    setLoading(true);
    setError('');
    void window.flowark
      .request('context.operations', { runId })
      .then((value: unknown) => {
        if (!current()) return;
        if (!Array.isArray(value)) throw Error('状态回执列表格式无效');
        for (const op of value) {
          if (!op || typeof op.nodeInstance !== 'string' || !op.nodeInstance)
            throw Error('状态回执缺少步骤来源');
          assertDataReceipt(op.receipt);
        }
        const list: Operation[] = [...value].sort(
          (a, b) =>
            Date.parse(a.receipt.createdAt) - Date.parse(b.receipt.createdAt) ||
            a.receipt.operationId.localeCompare(b.receipt.operationId),
        );
        setOps(list);
        setPage((n) => Math.min(n, Math.max(0, Math.ceil(list.length / pageSize) - 1)));
        setSelected((id) => (list.some((op) => op.receipt.operationId === id) ? id : null));
      })
      .catch((e) => {
        if (current()) setError(e instanceof Error ? e.message : '状态回执读取失败');
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open, runId, runState, revision]);
  const close = () => {
    epoch.current++;
    setOpen(false);
    setOps([]);
    setSelected(null);
    setPage(0);
    setError('');
    setLoading(false);
  };
  const inspect = async (op: Operation) => {
    if (inspectLock.current) return;
    const operationId = op.receipt.operationId,
      request = epoch.current;
    inspectLock.current = operationId;
    setInspecting(operationId);
    setError('');
    try {
      const receipt = await window.flowark.request('context.inspect', {
        runId,
        operationId,
      });
      assertDataReceipt(receipt);
      if (receipt.operationId !== operationId) throw Error('核对回执与所选原操作不一致');
      if (!mounted.current || owner.current !== runId || !expanded.current) return;
      if (request === epoch.current)
        setOps((list) =>
          list.map((o) => (o.receipt.operationId === operationId ? { ...o, receipt } : o)),
        );
      else setRevision((v) => v + 1);
    } catch (e) {
      if (mounted.current && owner.current === runId && request === epoch.current)
        setError(e instanceof Error ? e.message : '核对失败，原记录保留');
    } finally {
      if (inspectLock.current === operationId) inspectLock.current = null;
      if (mounted.current && owner.current === runId) setInspecting(null);
    }
  };
  const start = page * pageSize,
    lastPage = Math.max(0, Math.ceil(ops.length / pageSize) - 1),
    presenter = runInstancePresenter(snapshot);
  return (
    <section aria-label="状态写入回执" className="context-operations">
      <h3>状态写入回执</h3>
      <p>
        运行状态与状态提交分别记录。已提交的状态不会因运行取消而撤销；核对只读取原操作，不重新写入。
      </p>
      <Button
        aria-expanded={open}
        aria-controls={sectionId}
        onClick={open ? close : () => setOpen(true)}
      >
        {open ? '收起回执' : '查看状态写入回执'}
      </Button>
      {open && (
        <div id={sectionId}>
          {loading && <p role="status">正在读取本次运行的回执…</p>}
          {error && (
            <Alert
              type="error"
              title={error}
              action={
                <Button loading={loading} onClick={() => setRevision((v) => v + 1)}>
                  重新读取回执
                </Button>
              }
            />
          )}
          {!loading && !error && !ops.length && <p role="status">本次运行没有状态写入回执。</p>}
          {ops.length > 0 && (
            <>
              <p role="status">
                共 {ops.length} 条，当前第 {start + 1}—{Math.min(start + pageSize, ops.length)} 条。
                完整状态默认收起，查看不会重新提交。
              </p>
              <Space wrap>
                <Button
                  ref={previousPage}
                  disabled={page === 0}
                  onClick={(event) => {
                    pageOrigin.current = event.currentTarget;
                    setPage((n) => Math.max(0, n - 1));
                    setSelected(null);
                  }}
                >
                  上一页回执
                </Button>
                <span ref={pagePosition} tabIndex={-1}>
                  第 {page + 1} / {lastPage + 1} 页
                </span>
                <Button
                  ref={nextPage}
                  disabled={page >= lastPage}
                  onClick={(event) => {
                    pageOrigin.current = event.currentTarget;
                    setPage((n) => Math.min(lastPage, n + 1));
                    setSelected(null);
                  }}
                >
                  下一页回执
                </Button>
                <Button loading={loading} onClick={() => setRevision((v) => v + 1)}>
                  重新读取回执
                </Button>
              </Space>
              {ops.slice(start, start + pageSize).map((op) => {
                const step = presenter(op.nodeInstance) ?? '步骤位置待核对',
                  detailOpen = selected === op.receipt.operationId;
                return (
                  <Card key={op.receipt.operationId} size="small" title={labels[op.receipt.status]}>
                    <Descriptions
                      column={1}
                      items={[
                        { key: 'node', label: '步骤', children: step },
                        ...(op.receipt.status === 'written'
                          ? [
                              {
                                key: 'rev',
                                label: '提交修订',
                                children: `${op.receipt.result.previousRevision} → ${op.receipt.result.revision}`,
                              },
                            ]
                          : 'currentRevision' in op.receipt
                            ? [
                                {
                                  key: 'rev',
                                  label: '当前修订',
                                  children: String(op.receipt.currentRevision),
                                },
                              ]
                            : []),
                      ]}
                    />
                    <TechnicalDetails
                      items={[
                        { label: '步骤实例路径', value: op.nodeInstance },
                        { label: '操作 ID', value: op.receipt.operationId },
                      ]}
                    />
                    {'error' in op.receipt && op.receipt.error && (
                      <Alert
                        type={op.receipt.status === 'cancelled' ? 'info' : 'warning'}
                        title={op.receipt.error}
                      />
                    )}
                    {op.receipt.status === 'written' && (
                      <>
                        <Button
                          aria-expanded={detailOpen}
                          aria-label={`${detailOpen ? '收起完整状态' : '查看本条完整状态'}：${step}`}
                          onClick={() => setSelected(detailOpen ? null : op.receipt.operationId)}
                        >
                          {detailOpen ? '收起完整状态' : '查看本条完整状态'}
                        </Button>
                        {detailOpen && (
                          <ContextResultView
                            key={`${op.receipt.operationId}:${op.receipt.updatedAt}`}
                            value={op.receipt.result}
                          />
                        )}
                      </>
                    )}
                    {['prepared', 'unknown'].includes(op.receipt.status) && (
                      <Button
                        loading={inspecting === op.receipt.operationId}
                        disabled={inspecting !== null && inspecting !== op.receipt.operationId}
                        onClick={() => void inspect(op)}
                      >
                        核对原操作
                      </Button>
                    )}
                  </Card>
                );
              })}
            </>
          )}
        </div>
      )}
    </section>
  );
}
