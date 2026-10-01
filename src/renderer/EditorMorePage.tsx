import { useEffect, useRef, useState } from 'react';
import type { FlowRecord } from '../shared/types';
import { flatten } from './flow-editing';
import RunHistory from './RunHistory';
import './editor-more.css';

type Props = {
  active: boolean;
  record: FlowRecord;
  saved: boolean;
  busy: boolean;
  back: () => void;
  exportZip: () => void;
  outline: () => void;
  script: (id: string) => void;
  openRun: (detail: unknown) => void;
  copy: (name: string, id: string) => Promise<FlowRecord>;
  openCopy: (record: FlowRecord) => void;
};

export default function EditorMorePage(props: Props) {
  const { active, record, saved, busy } = props;
  const [page, setPage] = useState<'menu' | 'scripts' | 'copy' | 'history'>('menu');
  const [filterOpen, setFilterOpen] = useState(false);
  const [name, setName] = useState(() => `${record.flow.name} · 副本`.slice(0, 100));
  const [reviewed, setReviewed] = useState(false);
  const [receipt, setReceipt] = useState<FlowRecord>();
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(false);
  const locked = useRef(false);
  const copyId = useRef(crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const copyError = useRef<HTMLParagraphElement>(null);
  const unavailable = busy || copying;
  const scripts = flatten(record.flow.steps).filter((step) => step.type === 'script');
  useEffect(() => {
    if (active) {
      const target = page === 'copy' && receipt ? receiptHeading.current : heading.current;
      target?.focus({ preventScroll: true });
    }
  }, [active, page, receipt]);
  useEffect(() => {
    if (active && page === 'copy' && error && !unavailable) copyError.current?.focus();
  }, [active, page, error, unavailable]);
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!unavailable && !locked.current) {
        if (page === 'menu') props.back();
        else if (page === 'history' && filterOpen) setFilterOpen(false);
        else setPage('menu');
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [active, unavailable, page, filterOpen, props.back]);
  const title =
    page === 'menu'
      ? '任务的更多操作'
      : page === 'scripts'
        ? '选择要编辑的脚本'
        : page === 'copy'
          ? '复制为新任务'
          : '版本与运行历史';
  return (
    <section
      className="page editor-more-page"
      style={active ? undefined : { display: 'none' }}
      aria-label="编排更多操作"
    >
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p>
            {page === 'menu' ? '试运行 / 运行保持为主要操作，低频操作收纳于此。' : record.flow.name}
          </p>
        </div>
        {page !== 'menu' && (
          <button disabled={unavailable} onClick={() => setPage('menu')}>
            返回更多操作
          </button>
        )}
      </div>
      {page === 'menu' && (
        <div className="editor-more-card editor-more-menu">
          <h2>
            {record.flow.name} · {saved ? '已保存' : '有未保存修改'}
          </h2>
          <div className="editor-more-actions">
            <button disabled={busy} onClick={props.exportZip}>
              导出 ZIP
            </button>
            <button disabled={busy} onClick={() => setPage('history')}>
              版本与历史
            </button>
            <button disabled={busy} onClick={() => setPage('copy')}>
              复制为新任务
            </button>
            <button
              disabled={busy}
              onClick={() =>
                scripts.length === 1 ? props.script(scripts[0].id) : setPage('scripts')
              }
            >
              编辑脚本
            </button>
            <button disabled={busy} onClick={props.outline}>
              长流程大纲
            </button>
            <button disabled={busy} onClick={props.back}>
              返回任务
            </button>
          </div>
          <p className="note">
            保存状态常驻任务顶部。显示网页只有一个入口，不在工具栏与属性区重复放置。
          </p>
        </div>
      )}
      {page === 'scripts' && (
        <div className="editor-more-card">
          <p>选择当前流程中的脚本步骤，打开完整编辑器。修改仍保留在当前草稿中。</p>
          {scripts.length ? (
            <div className="editor-more-actions">
              {scripts.map((step) => (
                <button key={step.id} disabled={busy} onClick={() => props.script(step.id)}>
                  <span>{step.name || '脚本步骤'}</span>
                  <small>
                    {step.id} · {step.type === 'script' ? step.language : ''}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <p className="note">当前流程没有脚本步骤。返回编排页，从动作库添加脚本后即可编辑。</p>
          )}
          <button disabled={busy} onClick={props.back}>
            返回任务
          </button>
        </div>
      )}
      {page === 'copy' && (
        <form
          className="editor-more-card"
          aria-busy={copying}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!reviewed || !name.trim() || locked.current || busy || receipt) return;
            locked.current = true;
            setCopying(true);
            setError('');
            try {
              setReceipt(await props.copy(name.trim(), copyId.current));
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '复制未完成，请稍后重试');
            } finally {
              locked.current = false;
              setCopying(false);
            }
          }}
        >
          {receipt ? (
            <>
              <h2 ref={receiptHeading} tabIndex={-1}>
                新流程已创建
              </h2>
              <p role="status">{receipt.flow.name} 已保存。原流程及其未保存编辑仍保留。</p>
              <p className="note">
                新流程需要重新选择本机资源、凭据与授权。复制没有创建运行或计划。
              </p>
              <button
                type="button"
                disabled={busy}
                className="primary"
                onClick={() => props.openCopy(receipt)}
              >
                打开新流程
              </button>
            </>
          ) : (
            <>
              <label>
                新流程名称
                <input
                  value={name}
                  maxLength={100}
                  required
                  disabled={unavailable}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <p>复制当前草稿的全部步骤、参数和配置值{saved ? '。' : '，包括尚未保存的修改。'}</p>
              <p className="note">
                副本是独立本地流程，不是模板实例。不复制凭据、本机路径绑定、浏览器与工具目标、动作授权、计划或运行历史；步骤中的字面量、脚本与参数内容会保留。
              </p>
              <label className="editor-copy-consent">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={unavailable}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                我已核对要保留的内容，创建后重新绑定资源
              </label>
              <button className="primary" disabled={unavailable || !reviewed || !name.trim()}>
                {copying ? '正在创建…' : '创建独立副本'}
              </button>
            </>
          )}
          {error && (
            <p ref={copyError} tabIndex={-1} role="alert" className="field-error">
              {error}
            </p>
          )}
        </form>
      )}
      <div hidden={page !== 'history'}>
        <p className="note">
          这里只显示本流程的运行。每次运行使用固定版本；保存草稿不会改写既有运行。未运行的草稿不等同于执行版本。
        </p>
        <RunHistory
          visible={active && page === 'history'}
          flows={[record]}
          scope={{ id: record.id, name: record.flow.name }}
          open={props.openRun}
          filterOpen={filterOpen}
          setFilterOpen={setFilterOpen}
          setPage={ignorePage}
        />
      </div>
    </section>
  );
}

function ignorePage() {}
