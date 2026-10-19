import ActionButton from './ActionButton';
import { Alert, Button, Card, Checkbox, Input } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
type MorePage = 'menu' | 'scripts' | 'copy' | 'history';

export default function EditorMorePage(props: Props) {
  const { active, record, saved, busy } = props;
  const [page, setPage] = useState<MorePage>('menu');
  const [filterOpen, setFilterOpen] = useState(false);
  const [name, setName] = useState(() => `${record.flow.name} · 副本`.slice(0, 100));
  const [reviewedSource, setReviewedSource] = useState<string>();
  const copySource = JSON.stringify({
    flow: record.flow,
    configuration: record.bindings.configuration,
  });
  const reviewed = reviewedSource === copySource;
  const [receipt, setReceipt] = useState<FlowRecord>();
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(false);
  const locked = useRef(false);
  const copyId = useRef(crypto.randomUUID());
  const root = useRef<HTMLElement>(null);
  const menuOrigin = useRef<{ page: MorePage; scroll: number } | undefined>(undefined);
  const restoreMenu = useRef(false);
  const previousPage = useRef<MorePage>('menu');
  const heading = useRef<HTMLHeadingElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const copyError = useRef<HTMLDivElement>(null);
  const unavailable = busy || copying;
  const scripts = flatten(record.flow.steps).filter((step) => step.type === 'script');
  const openPage = (next: Exclude<MorePage, 'menu'>) => {
    menuOrigin.current = { page: next, scroll: root.current?.closest('main')?.scrollTop ?? 0 };
    setPage(next);
  };
  const returnMenu = () => {
    restoreMenu.current = true;
    setPage('menu');
  };
  useLayoutEffect(() => {
    if (!active) return;
    const main = root.current?.closest('main');
    let restoreFrame: number | undefined;
    if (page === 'menu' && restoreMenu.current) {
      restoreMenu.current = false;
      restoreFrame = requestAnimationFrame(() => {
        main?.scrollTo({ top: menuOrigin.current?.scroll ?? 0 });
        const target = root.current?.querySelector<HTMLElement>(
          `[data-more-page="${menuOrigin.current?.page}"]`,
        );
        (target ?? heading.current)?.focus({ preventScroll: true });
      });
    } else {
      if (page !== previousPage.current) main?.scrollTo({ top: 0 });
      const target = page === 'copy' && receipt ? receiptHeading.current : heading.current;
      target?.focus({ preventScroll: true });
      if (page === 'copy' && receipt) target?.scrollIntoView({ block: 'nearest' });
    }
    previousPage.current = page;
    return () => {
      if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
    };
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
        else returnMenu();
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
      ref={root}
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
          <Button disabled={unavailable || undefined} onClick={returnMenu}>
            返回更多操作
          </Button>
        )}
      </div>
      {page === 'menu' && (
        <div className="editor-more-card editor-more-menu">
          <Card>
            <h2>
              {record.flow.name} · {saved ? '已保存' : '有未保存修改'}
            </h2>
            <div className="editor-more-actions">
              <Button disabled={busy || undefined} onClick={props.exportZip}>
                导出 ZIP
              </Button>
              <ActionButton
                hint="查看当前流程的固定版本与历史记录"
                aria-label="版本与历史"
                data-more-page="history"
                disabled={busy || undefined}
                onClick={() => openPage('history')}
              >
                版本与历史
              </ActionButton>
              <ActionButton
                hint="复制为独立新任务；不会创建运行或计划"
                aria-label="复制为新任务"
                data-more-page="copy"
                disabled={busy || undefined}
                onClick={() => openPage('copy')}
              >
                创建副本
              </ActionButton>
              <ActionButton
                hint="选择并编辑当前流程的脚本步骤"
                aria-label="编辑脚本"
                data-more-page="scripts"
                disabled={busy || undefined}
                onClick={() =>
                  scripts.length === 1 ? props.script(scripts[0].id) : openPage('scripts')
                }
              >
                编辑脚本
              </ActionButton>
              <ActionButton
                hint="打开长流程大纲并定位具体步骤"
                aria-label="长流程大纲"
                disabled={busy || undefined}
                onClick={props.outline}
              >
                流程大纲
              </ActionButton>
              <Button disabled={busy || undefined} onClick={props.back}>
                返回任务
              </Button>
            </div>
            <Alert
              className="editor-more-menu-note"
              type="info"
              title="保存状态常驻任务顶部。显示网页只有一个入口，不在工具栏与属性区重复放置。"
            />
          </Card>
        </div>
      )}
      {page === 'scripts' && (
        <div className="editor-more-card">
          <Card>
            <p>选择当前流程中的脚本步骤，打开完整编辑器。修改仍保留在当前草稿中。</p>
            {scripts.length ? (
              <div className="editor-more-actions">
                {scripts.map((step) => (
                  <Button
                    key={step.id}
                    disabled={busy || undefined}
                    onClick={() => props.script(step.id)}
                  >
                    <span>{step.name || '脚本步骤'}</span>
                    <small>
                      第 {flatten(record.flow.steps).indexOf(step) + 1} 步 ·{' '}
                      {step.type === 'script' ? step.language : ''}
                    </small>
                  </Button>
                ))}
              </div>
            ) : (
              <Alert
                type="info"
                showIcon
                title="当前流程没有脚本步骤。返回编排页，从动作库添加脚本后即可编辑。"
              />
            )}
            <Button disabled={busy || undefined} onClick={props.back}>
              返回任务
            </Button>
          </Card>
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
          <Card>
            {receipt ? (
              <>
                <h2 ref={receiptHeading} tabIndex={-1}>
                  新流程已创建
                </h2>
                <Alert
                  type="success"
                  showIcon
                  role="status"
                  title={`${receipt.flow.name} 已保存。原流程及其未保存编辑仍保留。`}
                />
                <Alert
                  type="info"
                  showIcon
                  title="新流程需要重新选择本机资源、凭据与授权。复制没有创建运行或计划。"
                />
                <Button
                  htmlType="button"
                  disabled={busy || undefined}
                  type="primary"
                  onClick={() => props.openCopy(receipt)}
                >
                  打开新流程
                </Button>
              </>
            ) : (
              <>
                <label>
                  新流程名称
                  <Input
                    value={name}
                    maxLength={100}
                    required
                    disabled={unavailable || undefined}
                    onChange={(event) => {
                      setName(event.target.value);
                      setError('');
                    }}
                  />
                </label>
                <p>复制当前草稿的全部步骤、参数和配置值{saved ? '。' : '，包括尚未保存的修改。'}</p>
                <Alert
                  type="info"
                  showIcon
                  title="副本是独立本地流程，不是模板实例。"
                  description="不复制凭据、本机路径绑定、浏览器与工具目标、动作授权、计划或运行历史；步骤中的字面量、脚本与参数内容会保留。"
                />
                <Checkbox
                  checked={reviewed}
                  disabled={unavailable || undefined}
                  aria-describedby={reviewedSource && !reviewed ? 'copy-source-changed' : undefined}
                  onChange={(event) => {
                    setReviewedSource(event.target.checked ? copySource : undefined);
                    setError('');
                  }}
                >
                  我已核对要保留的内容，创建后重新绑定资源
                </Checkbox>
                {reviewedSource && !reviewed && (
                  <Alert
                    id="copy-source-changed"
                    type="warning"
                    showIcon
                    role="status"
                    title="草稿已更新，请重新核对要保留的内容后再创建副本。"
                  />
                )}
                <Button
                  htmlType="submit"
                  type="primary"
                  loading={copying}
                  disabled={unavailable || !reviewed || !name.trim() || undefined}
                >
                  {copying ? '正在创建…' : error ? '重新创建独立副本' : '创建独立副本'}
                </Button>
              </>
            )}
            {error && (
              <div ref={copyError} tabIndex={-1} role="alert">
                <Alert type="error" showIcon role="presentation" title={error} />
              </div>
            )}
          </Card>
        </form>
      )}
      <div hidden={page !== 'history'}>
        <Alert
          className="editor-more-history-note"
          type="info"
          showIcon
          title="这里只显示本流程的运行。每次运行使用固定版本；保存草稿不会改写既有运行。未运行的草稿不等同于执行版本。"
        />
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
