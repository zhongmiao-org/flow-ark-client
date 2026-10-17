import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Tag } from 'antd';
import { assertSourceResult } from '../shared/conversation-source';
import {
  verifyArchiveRecord,
  type ConversationArchiveRecord as Row,
} from '../shared/conversation-archive';
import { RecordView } from './ConversationArchivePanel';
import './source.css';
export default function SourceResultView({
  runId,
  nodeId,
  value,
}: {
  runId: string;
  nodeId: string;
  value: any;
}) {
  const [row, setRow] = useState<Row>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setRow(undefined);
    setError('');
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [runId, nodeId, value]);
  assertSourceResult(value);
  const manifest = value.manifest,
    chunk = value.chunk,
    ref = manifest ? value.source : chunk.source;
  const ordinal = chunk?.recordOrdinal ?? 1;
  async function original() {
    const visit = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const r = await verifyArchiveRecord(
        await window.flowark.request('source.runRecord', { runId, nodeId, ordinal }),
        ref.archiveId,
        ordinal,
      );
      if (chunk && r.sha256 !== chunk.recordHash) throw Error('原记录与此片段来源不一致');
      if (manifest && r.previousHash !== manifest.rootHash) throw Error('首记录与固定清单不一致');
      if (visit === generation.current) setRow(r);
    } catch (e) {
      if (visit === generation.current) setError((e as Error).message);
    } finally {
      if (visit === generation.current) setBusy(false);
    }
  }
  return (
    <section className="source-picker" aria-label="完整来源读取结果">
      <h3>{manifest ? '固定来源清单' : '来源片段读取结果'}</h3>
      {manifest ? (
        <>
          <Tag>{value.current ? '读取时来源仍为当前版本' : '读取时原访谈已有新补充'}</Tag>
          <p>
            {manifest.capture.title} · 原访谈{manifest.originRequestCount}次 + 持续
            {manifest.historyCount}次 = {manifest.requestCount}次请求；固定资料
            {manifest.contextCount}份。
          </p>
          <p>
            完成{manifest.completeCount}次，失败{manifest.failedCount}次，取消
            {manifest.cancelledCount}次；原始记录{manifest.recordCount}条。
          </p>
        </>
      ) : (
        <>
          <Tag>{value.done ? '已读到固定终点' : '还有后续来源'}</Tag>
          <p>
            原记录{chunk.recordOrdinal} ·{' '}
            {chunk.recordKind === 'origin'
              ? '原访谈'
              : chunk.recordKind === 'context'
                ? '固定资料与设置'
                : '持续补充'}
          </p>
          <p>
            本片段覆盖第{chunk.byteOffset + 1}–{chunk.byteEnd}字节 / 原记录{chunk.recordBytes}字节；
            {chunk.byteEnd < chunk.recordBytes ? '本记录尚未读完' : '本记录已读完'}。
          </p>
          <p>
            下一位置{value.next ? '已返回，可在后续读取节点中选择引用' : '为空，本片段已到固定终点'}
            。
          </p>
        </>
      )}
      <p>此步骤仅在本机读取来源，未调用模型；读取完成不代表AI已整理或Skill已生成。</p>
      <Button loading={busy} onClick={() => void original()}>
        查看该记录原文
      </Button>
      {error && <Alert type="error" title={error} />}
      {row && (
        <div className="source-original">
          <RecordView row={row} />
        </div>
      )}
      <Collapse
        items={[
          {
            key: 'advanced',
            label: '机器详情（高级，可选）',
            children: <pre className="archive-text">{JSON.stringify(value, null, 2)}</pre>,
          },
        ]}
      />
    </section>
  );
}
