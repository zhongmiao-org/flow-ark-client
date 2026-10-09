import { Button, Checkbox } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import type { FlowRecord } from '../shared/types';
import { flatten } from './flow-editing';
import './export-review.css';

export type ExportSource =
  | {
      kind: 'draft';
      flow: FlowRecord['flow'];
      configuration?: { adapter: string; schema: unknown };
      saved: boolean;
    }
  | {
      kind: 'template';
      key: string;
      name: string;
      version: string;
      entries: string[];
      returnLabel?: string;
    };

export function captureDraftExport(record: FlowRecord, saved: boolean): ExportSource {
  const configuration = record.bindings.configuration;
  return structuredClone({
    kind: 'draft',
    flow: record.flow,
    saved,
    ...(configuration
      ? { configuration: { adapter: configuration.adapter, schema: configuration.schema } }
      : {}),
  });
}

export default function ExportReviewDialog({
  source,
  close,
  importZip,
}: {
  source: ExportSource;
  close: () => void;
  importZip: () => Promise<boolean>;
}) {
  const titleId = useId(),
    descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<'export' | 'import'>();
  const [stage, setStage] = useState<'review' | 'done'>('review');
  const [error, setError] = useState<{ operation: 'export' | 'import'; message: string }>();
  const [notice, setNotice] = useState('');
  const draft = source.kind === 'draft';
  const name = draft ? source.flow.name : source.name;
  const templateReturnLabel = source.kind === 'template' ? (source.returnLabel ?? '模板详情') : '';
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (stage === 'done') heading.current?.focus();
  }, [stage]);
  useEffect(() => {
    if (!busy && (error || notice)) feedback.current?.focus();
  }, [busy, error, notice]);
  const fail = (reason: unknown) =>
    (reason instanceof Error ? reason.message : '导出未完成，请核对来源后重试').replace(
      /^Error invoking remote method 'flowark:request': (?:Error: )?/,
      '',
    );
  const run = async (operation: 'export' | 'import') => {
    if (locked.current || (operation === 'export' && !reviewed)) return;
    locked.current = true;
    setBusy(operation);
    setError(undefined);
    setNotice('');
    try {
      if (operation === 'import') {
        if (await importZip()) close();
        else setNotice('已取消选择文件，导出的 ZIP 保持不变。');
        return;
      }
      const result = await window.flowark.request(
        draft ? 'flow.export' : 'template.export',
        draft
          ? {
              flow: source.flow,
              ...(source.configuration ? { configuration: source.configuration } : {}),
              reviewed: true,
            }
          : { key: source.key },
      );
      if (result === true) setStage('done');
      else if (result === false) setNotice('已取消保存，本次没有导出文件。');
      else setError({ operation, message: '未取得明确的导出结果，请先检查你选择的保存位置。' });
    } catch (reason) {
      setError({ operation, message: fail(reason) });
    } finally {
      locked.current = false;
      setBusy(undefined);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="export-review-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked.current) close();
      }}
    >
      <header className="export-review-heading">
        <div>
          <span className="export-review-kicker">标准模板 ZIP</span>
          <h1 id={titleId} ref={heading} tabIndex={-1}>
            {stage === 'done' ? '导出已完成' : draft ? '导出当前草稿' : '导出模板原定义'}
          </h1>
          <p id={descriptionId}>
            {stage === 'done'
              ? '文件已保存到你选择的位置，获取文件本身不产生执行授权。'
              : draft
                ? '生成独立本地身份，保留此刻的流程定义。'
                : '保留原模板身份与版本，实例内容保持不变。'}
          </p>
        </div>
        <Button
          htmlType="button"
          disabled={!!busy || undefined}
          onClick={close}
          aria-label="关闭导出核对"
        >
          关闭
        </Button>
      </header>
      {error && (
        <div className="export-review-message error" role="alert" ref={feedback} tabIndex={-1}>
          <strong>{error.operation === 'import' ? 'ZIP 导入检查未完成' : '导出未完成'}</strong>
          <p>{error.message}</p>
          <p>
            {error.operation === 'import'
              ? '已导出的文件保持不变。请重新选择完整的标准模板 ZIP，再检查并安装。'
              : '保留当前来源；请核对资源声明、脚本依赖或保存位置后，再明确重试。'}
          </p>
        </div>
      )}
      {notice && (
        <div className="export-review-message" role="status" ref={feedback} tabIndex={-1}>
          {notice}
        </div>
      )}
      {stage === 'done' ? (
        <section className="export-review-success">
          <span className="export-review-badge success">已保存 · 标准 ZIP</span>
          <h2>{name}</h2>
          {!draft && <p className="export-review-identity">原模板版本 · {source.key}</p>}
          <p>
            {draft
              ? '重新导入后创建新实例，填写参数、绑定本机资源并确认动作权限。'
              : '重新导入仍遵守同版本完整性和引用保护规则，不覆盖现有实例。'}
          </p>
          <p>导入验证会让你选择 ZIP 文件，安装和执行仍需明确操作。</p>
          <div className="export-review-actions">
            <Button
              type="primary"
              disabled={!!busy || undefined}
              onClick={() => void run('import')}
            >
              {busy === 'import'
                ? '正在选择并检查 ZIP…'
                : error?.operation === 'import'
                  ? '重新选择 ZIP 进行导入验证'
                  : '选择 ZIP 进行导入验证'}
            </Button>
            <Button disabled={!!busy || undefined} onClick={close}>
              {draft ? '返回流程编排' : `返回${templateReturnLabel}`}
            </Button>
          </div>
        </section>
      ) : (
        <>
          <div className="export-review-layout">
            <section className="export-review-card">
              <span className="export-review-badge">{draft ? '当前草稿快照' : '模板原定义'}</span>
              <h2>{name}</h2>
              <dl>
                <div>
                  <dt>身份与版本</dt>
                  <dd>{draft ? '生成新的本地模板身份 · 1.0.0' : source.key}</dd>
                </div>
                {draft ? (
                  <>
                    <div>
                      <dt>草稿状态</dt>
                      <dd>
                        {source.saved ? '打开核对页时已保存' : '含未保存修改；导出不会保存本地草稿'}
                      </dd>
                    </div>
                    <div>
                      <dt>步骤</dt>
                      <dd>{flatten(source.flow.steps).length} 个步骤，包含分支与循环内部步骤</dd>
                    </div>
                    <div>
                      <dt>参数结构</dt>
                      <dd>
                        {Object.keys(source.flow.parameters ?? {}).length} 个参数；实际值会清空
                      </dd>
                    </div>
                  </>
                ) : (
                  <div>
                    <dt>操作入口</dt>
                    <dd>{source.entries.join('、') || '未声明入口'}</dd>
                  </div>
                )}
              </dl>
              <h3>会包含</h3>
              <ul>
                <li>流程或模板定义、参数结构与逻辑资源声明</li>
                <li>节点字面量、脚本代码及配置定义</li>
                {!draft && <li>原模板包中声明的资源与入口</li>}
              </ul>
              <p className="export-review-muted">
                {draft
                  ? '导出内容固定为打开此页时的编辑状态。'
                  : '只导出原始模板定义，不把本地实例重新打包。'}
              </p>
            </section>
            <aside className="export-review-card">
              <h2>不会包含</h2>
              <ul>
                <li>运行参数值与实例配置值</li>
                <li>本机路径、浏览器绑定、登录态和凭据</li>
                <li>实例动作授权、运行历史及运行产物</li>
              </ul>
              <div className="export-review-message warning">
                <strong>请检查定义里的实际内容</strong>
                <p>
                  字面量、代码或配置定义可能含有手写的个人数据、路径或密钥。自动排除绑定不能替代逐项核对。
                </p>
              </div>
              <p className="export-review-muted">
                {draft
                  ? '资源声明无法确定或依赖不完整时，宿主会阻止生成包并说明原因。'
                  : '现有实例、计划与运行继续使用原来的版本和快照。'}
              </p>
            </aside>
          </div>
          <footer className="export-review-footer">
            <Checkbox
              autoFocus
              checked={reviewed}
              disabled={!!busy || undefined}
              onChange={(event) => setReviewed(event.target.checked)}
              className="export-review-check"
            >
              我已核对字面量、脚本和配置定义，确认可以导出
            </Checkbox>
            <div className="export-review-actions">
              <Button
                type="primary"
                disabled={!!busy || !reviewed || undefined}
                onClick={() => void run('export')}
              >
                {busy === 'export'
                  ? '正在选择位置并导出…'
                  : error
                    ? '重新确认并导出'
                    : '确认导出 ZIP'}
              </Button>
              <Button disabled={!!busy || undefined} onClick={close}>
                {draft ? '取消，返回编辑' : `取消，返回${templateReturnLabel}`}
              </Button>
            </div>
          </footer>
        </>
      )}
    </dialog>
  );
}
