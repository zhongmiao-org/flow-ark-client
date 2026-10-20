import { Alert, Button, Collapse, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { Run } from '../shared/types';
import type { EntryResultResponse as Result } from '../shared/contracts.generated';
import CompleteValue from './CompleteValue';
import { activateCollapseWithSpace } from './collapseKeyboard';
import './entry-result-view.css';

const reasons: Record<Extract<Result, { viewStatus: 'unavailable' }>['reason'], string> = {
  'snapshot-missing': '缺少本次运行的固定快照。',
  'snapshot-mismatch': '运行与固定快照不一致。',
  'owner-conflict': '固定来源存在冲突。',
  'owner-unavailable': '固定来源无法核验。',
  'package-missing': '缺少本次运行固定的模板包。',
  'package-mismatch': '固定模板包无法核验。',
  'entry-missing': '固定包中缺少此入口。',
  'schema-missing': '缺少固定的结果定义。',
  'schema-invalid': '固定的结果定义无法核验。',
  'result-invalid': '已保存结果未通过固定定义核验。',
  'read-limit': '结果或定义超过本次只读展示范围。',
  'changed-during-read': '读取期间记录发生变化，请重新读取。',
  'storage-unavailable': '本地存储暂不可用。',
  'privacy-unavailable': '缺少可核验的脱敏显示副本；原记录仍保留。',
};
export default function EntryResultView({ run }: { run: Run }) {
  const [view, setView] = useState<Result>(),
    [error, setError] = useState(false);
  const [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const serial = useRef(0);
  useEffect(() => {
    const request = ++serial.current;
    let live = true;
    setView(undefined);
    setError(false);
    setBusy(true);
    void window.flowark
      .request('run.entryResult', { runId: run.id })
      .then((value: Result) => {
        if (!live || request !== serial.current) return;
        if (
          value?.formatVersion !== '1.0' ||
          value.run.id !== run.id ||
          value.run.flowId !== run.flowId ||
          value.run.versionId !== run.versionId ||
          value.run.state !== run.state
        ) {
          setError(true);
          return;
        }
        setView(value);
      })
      .catch(() => {
        if (live && request === serial.current) setError(true);
      })
      .finally(() => {
        if (live && request === serial.current) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [run.id, run.flowId, run.versionId, run.state, revision]);
  const current =
    view?.run.id === run.id && view.run.versionId === run.versionId && view.run.state === run.state
      ? view
      : undefined;
  const saved = current?.viewStatus === 'available' ? current : undefined;
  const source = current && 'source' in current ? current.source : undefined;
  const failed = saved?.completion === 'saved-only';
  const author = source?.kind === 'author-checkout';
  const title = busy
    ? '正在读取入口结果'
    : error
      ? '入口结果暂不可读取'
      : saved
        ? failed
          ? '失败运行的已保存结果'
          : author
            ? '制作副本的入口结果'
            : '入口结果已保存'
        : current?.viewStatus === 'pending'
          ? '运行中暂不展示'
          : current?.viewStatus === 'missing'
            ? '缺少已保存结果'
            : current?.viewStatus === 'not-applicable'
              ? '此运行没有模板入口结果'
              : '固定来源或结果不可核验';
  return (
    <section className="entry-result-view" aria-label="本Run固定入口结果" aria-busy={busy}>
      <p className="entry-result-eyebrow">
        {failed
          ? '运行未成功结束 · 存在已保存结果'
          : author
            ? '制作副本 · 已保存结果'
            : '本Run固定结果'}
      </p>
      <h3>{title}</h3>
      <p>只读查看本Run已保存的入口结果；不执行流程，不请求模型。</p>
      {busy && <Spin aria-label="正在读取入口结果" />}
      {error && (
        <Alert type="error" showIcon title="读取失败，原记录保留；其他步骤结果仍可查看。" />
      )}
      {current?.viewStatus === 'unavailable' && (
        <Alert
          type="error"
          showIcon
          title={reasons[current.reason]}
          description="不会换用其他版本、补写结果或重新运行。"
        />
      )}
      {current?.viewStatus === 'pending' && (
        <p role="status">运行尚未结束，入口值可能变化；请先查看当前步骤与已保存的步骤输出。</p>
      )}
      {current?.viewStatus === 'missing' && (
        <Alert
          type="warning"
          showIcon
          title="此Run未保存入口整体结果；步骤成功不代表入口已有结果。"
        />
      )}
      {current?.viewStatus === 'not-applicable' && <p>普通运行的步骤与产物继续在下方显示。</p>}
      {source && (
        <p className="entry-result-source">
          {source.kind === 'template'
            ? `模板 v${source.templateVersion} / ${source.entryName}`
            : `编排副本 / 制作修订 ${source.baseRevision}`}
        </p>
      )}
      {saved && (
        <>
          {failed && (
            <Alert
              type="warning"
              showIcon
              title="此值仅表示结果已保存，不代表运行成功或业务完成。"
            />
          )}
          {saved.displayChanged && (
            <Alert type="info" showIcon title="这是经过脱敏或文本裁剪的显示投影，不是资料全文。" />
          )}
          <div className="entry-result-fields">
            {saved.labels.find((item) => item.path === '') && (
              <strong>{saved.labels.find((item) => item.path === '')!.label}</strong>
            )}
            {saved.labels.find((item) => item.path === '')?.description && (
              <p>{saved.labels.find((item) => item.path === '')!.description}</p>
            )}
            <CompleteValue
              value={saved.value}
              labels={saved.labels}
              ariaLabel="已脱敏的入口整体结果"
              description="逐层阅读本Run已保存的脱敏显示值；每页最多200项，长文本可继续阅读。展开不会恢复被裁剪的来源，也不改变保存值；字段说明来自模板，不是事实认证。"
            />
            {!saved.labelsComplete && <p>部分字段注解无法明确解释，已按保存的字段名展示。</p>}
            <p>内容已经宿主脱敏。模板声明不代替实际业务回执。</p>
          </div>
        </>
      )}
      {source && (
        <Collapse
          key={current?.readStamp}
          items={[
            {
              key: 'source',
              label: '查看固定来源与摘要（可选）',
              onKeyDown: activateCollapseWithSpace,
              children: (
                <dl className="entry-result-identity">
                  {Object.entries(source).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                  {saved && (
                    <>
                      <div>
                        <dt>显示值摘要</dt>
                        <dd>{saved.valueSha256}</dd>
                      </div>
                      <div>
                        <dt>显示值字节数</dt>
                        <dd>{saved.valueBytes}</dd>
                      </div>
                    </>
                  )}
                </dl>
              ),
            },
            ...(saved
              ? [
                  {
                    key: 'raw',
                    label: '脱敏入口结果原文（高级，可选）',
                    onKeyDown: activateCollapseWithSpace,
                    children: (
                      <pre tabIndex={0} aria-label="完整脱敏入口结果">
                        {JSON.stringify(saved.value, null, 2)}
                      </pre>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      <Button block loading={busy} disabled={busy} onClick={() => setRevision((v) => v + 1)}>
        重新读取入口结果
      </Button>
      <p className="entry-result-boundary">
        运行终态、保存结果、事实确认与外部动作回执分别核对。查看不授予动作权限。
      </p>
    </section>
  );
}
