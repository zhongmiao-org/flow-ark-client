import TechnicalDetails from './TechnicalDetails';
import type { Flow } from '../shared/types';
import { runInstancePresenter } from './run-instance-presentation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions } from 'antd';
import { assertDataReceipt, type DataReceipt } from '../shared/template-data';
import ContextResultView from './ContextResultView';
import './template-data.css';
type Operation = { nodeInstance: string; receipt: DataReceipt };
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
  const [ops, setOps] = useState<Operation[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setOps([]);
    setError('');
    void window.flowark
      .request('context.operations', { runId })
      .then((value: Operation[]) => {
        for (const op of value) assertDataReceipt(op.receipt);
        if (live) setOps(value);
      })
      .catch((e) => {
        if (live) setError(e.message ?? '状态回执读取失败');
      });
    return () => {
      live = false;
    };
  }, [runId, runState, revision]);
  const inspect = async (op: Operation) => {
    setBusy(true);
    setError('');
    try {
      const receipt = await window.flowark.request('context.inspect', {
        runId,
        operationId: op.receipt.operationId,
      });
      assertDataReceipt(receipt);
      setOps((list) =>
        list.map((o) => (o.receipt.operationId === receipt.operationId ? { ...o, receipt } : o)),
      );
    } catch (e: any) {
      setError(e.message ?? '核对失败，原记录保留');
    } finally {
      setBusy(false);
    }
  };
  if (!ops.length && !error) return null;
  return (
    <section aria-label="状态写入回执" className="context-operations">
      <h3>状态写入回执</h3>
      <p>
        运行状态与状态提交分别记录。已提交的状态不会因运行取消而撤销；核对只读取原操作，不重新写入。
      </p>
      {error && (
        <Alert
          type="error"
          title={error}
          action={
            <Button disabled={busy} onClick={() => setRevision((v) => v + 1)}>
              重新读取回执
            </Button>
          }
        />
      )}
      {ops.map((op) => (
        <Card key={op.receipt.operationId} title={labels[op.receipt.status]}>
          <Descriptions
            column={1}
            items={[
              {
                key: 'node',
                label: '步骤',
                children: runInstancePresenter(snapshot)(op.nodeInstance) ?? '步骤位置待核对',
              },

              ...('currentRevision' in op.receipt
                ? [{ key: 'rev', label: '当前修订', children: String(op.receipt.currentRevision) }]
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
          {op.receipt.status === 'written' && <ContextResultView value={op.receipt.result} />}
          {['prepared', 'unknown'].includes(op.receipt.status) && (
            <Button loading={busy} onClick={() => void inspect(op)}>
              核对原操作
            </Button>
          )}
        </Card>
      ))}
    </section>
  );
}
