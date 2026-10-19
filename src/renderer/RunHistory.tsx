import { runRecordLabel } from './readable-labels';
import { runStateColors } from './theme';
import { Select, Button, Input, Table, Tag, Badge, Collapse, Card, Modal, Alert, Flex } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  historyTimeRange,
  runSource,
  runSourceLabels,
  runDisplayLabels as runStateLabels,
  type RunListPage,
  type RunListQuery,
} from '../shared/run-history';
import { formatRunDuration } from './run-presentation';
import type { FlowRecord } from '../shared/types';

const api = (method: string, args: any) => window.flowark.request(method, args);
export default function RunHistory({
  visible,
  open,
  filterOpen,
  setFilterOpen,
  setPage,
  flows,
  scope,
}: {
  visible: boolean;
  open: (detail: any) => void;
  filterOpen: boolean;
  setFilterOpen: (open: boolean) => void;
  setPage: (page: number) => void;
  flows: FlowRecord[];
  scope?: { id: string; name: string };
}) {
  const [query, setQuery] = useState<RunListQuery>(() => ({
    limit: 6,
    ...historyTimeRange(scope ? null : 7),
  }));
  const [range, setRange] = useState(scope ? 'all' : '7');
  const [extraFiltersOpen, setExtraFiltersOpen] = useState(false);
  const [draft, setDraft] = useState({
    query: '',
    state: '',
    source: '',
    flowId: '',
    range: '7',
    limit: 6,
  });
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageRequest, setPageRequest] = useState<{
    cursors: (string | undefined)[];
    direction: '下一页' | '上一页';
    attempt: number;
    error?: string;
  } | null>(null);
  const pageOrigin = useRef<{ element: HTMLElement | null; scroll: number } | null>(null);
  const pageCompletion = useRef<'success' | 'cancel' | null>(null);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<RunListPage | null>(null);
  const [error, setError] = useState('');
  const [openError, setOpenError] = useState<{ id: string; message: string } | null>(null);
  const errorPanel = useRef<HTMLParagraphElement>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const generation = useRef(0),
    shown = useRef(visible);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const appliedFilters = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const filterReturn = useRef<{
    trigger: 'flow' | 'source';
    scroll: number;
    applied: boolean;
  } | null>(null);
  const restore = useRef<{ id: string; scroll: number } | null>(null);
  const pageArrival = useRef(false);
  const pageSummaryId = useId();
  shown.current = visible && !filterOpen;
  const cursor = cursors[cursors.length - 1];
  const selectedFlowId = scope?.id ?? query.flowId;
  const selectedFlowName =
    scope?.name ?? flows.find((flow) => flow.id === selectedFlowId)?.flow.name;
  const additionalFilters = [
    query.query && `搜索：${query.query}`,
    selectedFlowId && `${scope ? '当前流程' : '流程'}：${selectedFlowName || selectedFlowId}`,
    query.source && `触发来源：${runSourceLabels[query.source]}`,
  ].filter(Boolean);
  const canClearFilters = !!(
    query.query ||
    query.state ||
    query.source ||
    (!scope && query.flowId) ||
    range !== 'all'
  );
  useEffect(() => setPage(cursors.length), [cursors.length, setPage]);
  const resetView = () => {
    generation.current++;
    setPageRequest(null);
    setData(null);
    setLoading(true);
    setError('');
    setOpenError(null);
  };
  const latest = () => {
    pageArrival.current = true;
    resetView();
    setQuery((current) => ({
      ...current,
      ...historyTimeRange(range === 'all' ? null : Number(range)),
    }));
    setCursors([undefined]);
    setRevision((r) => r + 1);
  };
  const filter = (next: RunListQuery) => {
    resetView();
    setQuery(next);
    setCursors([undefined]);
  };
  const editFilters = (trigger: 'flow' | 'source') => {
    filterReturn.current = {
      trigger,
      scroll: root.current?.closest('main')?.scrollTop ?? 0,
      applied: false,
    };
    setDraft({
      query: query.query ?? '',
      state: query.state ?? '',
      source: query.source ?? '',
      flowId: scope?.id ?? query.flowId ?? '',
      range,
      limit: query.limit ?? 6,
    });
    setExtraFiltersOpen(!!selectedFlowId || query.limit !== 6);
    setFilterOpen(true);
  };
  useEffect(() => {
    if (!visible) return;
    if (filterOpen) {
      root.current?.closest('main')?.scrollTo({ top: 0 });
      search.current?.focus({ preventScroll: true });
      return;
    }
    const saved = filterReturn.current;
    if (!saved) return;
    const target = !saved.applied
      ? (root.current?.querySelector<HTMLElement>(`[data-history-filter="${saved.trigger}"]`) ??
        (scope ? appliedFilters.current : heading.current))
      : scope
        ? appliedFilters.current
        : heading.current;
    target?.focus({ preventScroll: true });
    root.current?.closest('main')?.scrollTo({ top: saved.applied ? 0 : saved.scroll });
    filterReturn.current = null;
  }, [visible, filterOpen]);
  useEffect(() => {
    const id = ++generation.current;
    if (!visible || filterOpen || pageRequest) return;
    let live = true,
      pending = false,
      failed = false;
    setError('');
    setLoading(true);
    setOpening(null);
    const refresh = async () => {
      if (pending || failed) return;
      pending = true;
      try {
        const result = await api('run.list', {
          ...query,
          ...(cursor ? { cursor } : {}),
          ...(scope ? { flowId: scope.id } : {}),
        });
        if (live && generation.current === id) {
          setData(result);
          setError('');
        }
      } catch (e: any) {
        failed = true;
        if (live && generation.current === id) setError(e.message);
      } finally {
        pending = false;
        if (live && generation.current === id) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      live = false;
      if (generation.current === id) generation.current++;
      clearInterval(timer);
    };
  }, [query, cursor, revision, visible, filterOpen, scope?.id, pageRequest]);
  useEffect(() => {
    if (!pageRequest || pageRequest.error || !visible || filterOpen) return;
    const id = ++generation.current;
    let live = true;
    const target = pageRequest.cursors.at(-1);
    void api('run.list', {
      ...query,
      ...(target ? { cursor: target } : {}),
      ...(scope ? { flowId: scope.id } : {}),
    }).then(
      (result: RunListPage) => {
        if (!live || generation.current !== id || !shown.current) return;
        pageCompletion.current = 'success';
        setData(result);
        setCursors(pageRequest.cursors);
        setPageRequest(null);
        setLoading(false);
      },
      (failure: unknown) => {
        if (!live || generation.current !== id || !shown.current) return;
        setPageRequest({
          ...pageRequest,
          error: failure instanceof Error ? failure.message : '暂时无法读取运行记录',
        });
      },
    );
    return () => {
      live = false;
      if (generation.current === id) generation.current++;
    };
  }, [pageRequest, query, visible, filterOpen, scope?.id]);
  useEffect(() => {
    if (!visible || filterOpen) {
      setPageRequest(null);
      pageOrigin.current = null;
    }
  }, [visible, filterOpen, scope?.id]);
  const requestPage = (next: (string | undefined)[], direction: '下一页' | '上一页') => {
    generation.current++;
    pageCompletion.current = null;
    pageOrigin.current = {
      element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      scroll: root.current?.closest('main')?.scrollTop ?? 0,
    };
    setOpening(null);
    setOpenError(null);
    setPageRequest({ cursors: next, direction, attempt: 0 });
  };
  const cancelPage = () => {
    generation.current++;
    setPageRequest(null);
    pageCompletion.current = 'cancel';
  };
  const finishPage = () => {
    const completion = pageCompletion.current;
    const saved = pageOrigin.current;
    pageCompletion.current = null;
    pageOrigin.current = null;
    if (!shown.current || !completion) return;
    if (completion === 'success') {
      (scope ? appliedFilters.current : heading.current)?.focus({ preventScroll: true });
      root.current?.closest('main')?.scrollTo({ top: 0 });
    } else if (saved) {
      root.current?.closest('main')?.scrollTo({ top: saved.scroll });
      saved.element?.focus({ preventScroll: true });
    }
  };
  useEffect(() => {
    if (!visible || filterOpen || loading || !data || !restore.current) return;
    const saved = restore.current;
    const frame = requestAnimationFrame(() => {
      const button = [
        ...(root.current?.querySelectorAll<HTMLButtonElement>('[data-run-id]') ?? []),
      ].find((e) => e.dataset.runId === saved.id);
      root.current?.closest('main')?.scrollTo({ top: saved.scroll });
      (button ?? (scope ? appliedFilters.current : heading.current))?.focus();
      restore.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, filterOpen, loading, data]);
  useEffect(() => {
    if (visible && !filterOpen && (error || openError)) errorPanel.current?.focus();
  }, [visible, filterOpen, error, openError]);
  useEffect(() => {
    if (!pageArrival.current || !visible || filterOpen || loading || error || !data) return;
    pageArrival.current = false;
    (scope ? appliedFilters.current : heading.current)?.focus({ preventScroll: true });
    root.current?.closest('main')?.scrollTo({ top: 0 });
  }, [visible, filterOpen, loading, error, data]);
  const inspect = async (id: string) => {
    const current = generation.current;
    setOpening(id);
    setOpenError(null);
    try {
      const detail = await api('run.detail', { id });
      if (shown.current && current === generation.current) {
        if (!detail?.run) throw new Error('这条运行记录已不存在，请返回列表。');
        if (detail.run.id !== id)
          throw new Error('返回的运行记录与所选记录不一致，请重新打开详情。');
        restore.current = { id, scroll: root.current?.closest('main')?.scrollTop ?? 0 };
        open(detail);
      }
    } catch (e: any) {
      if (shown.current && current === generation.current) setOpenError({ id, message: e.message });
    } finally {
      if (current === generation.current) setOpening(null);
    }
  };
  const stateSelect = (value: string, onChange: (state: string) => void) => (
    <Select<string>
      aria-label="运行状态筛选"
      value={value}
      onChange={(value) => onChange(value)}
      options={[
        { value: '', label: '全部状态' },
        ...Object.entries(runStateLabels).map(([value, label]) => ({ value: value, label: label })),
      ]}
    />
  );
  const rangeSelect = (value: string, onChange: (days: string) => void) => (
    <Select<string>
      aria-label="运行时间范围"
      value={value}
      onChange={(value) => onChange(value)}
      options={[
        { value: 'all', label: '全部时间' },
        { value: '1', label: '今天' },
        { value: '7', label: '最近 7 天' },
        { value: '30', label: '最近 30 天' },
      ]}
    />
  );
  return (
    <div
      ref={root}
      className={`run-history${filterOpen ? ' is-filtering' : ''}`}
      style={visible ? undefined : { display: 'none' }}
    >
      <div className="runs-heading">
        <h1 ref={heading} tabIndex={-1} aria-describedby={filterOpen ? undefined : pageSummaryId}>
          {filterOpen ? '筛选运行记录' : '运行记录'}
        </h1>
        <p>
          {filterOpen
            ? '筛选与翻页保留当前位置；返回详情后保留条件。'
            : '每一次执行，都有清楚的过程与结果。'}
        </p>
      </div>
      {filterOpen ? (
        <form
          className="history-filter-form"
          aria-label="筛选运行记录"
          onSubmit={(e) => {
            e.preventDefault();
            if (filterReturn.current) filterReturn.current.applied = true;
            setRange(draft.range);
            filter({
              limit: draft.limit,
              query: draft.query.trim() || undefined,
              state: (draft.state || undefined) as RunListQuery['state'],
              source: (draft.source || undefined) as RunListQuery['source'],
              flowId: draft.flowId || undefined,
              ...historyTimeRange(draft.range === 'all' ? null : Number(draft.range)),
            });
            setFilterOpen(false);
          }}
        >
          <Card className="history-filter-panel" styles={{ body: { padding: 28 } }}>
            <div className="history-primary-filters">
              <label>
                搜索流程或运行编号
                <Input
                  ref={(instance) => {
                    search.current = instance?.input ?? null;
                  }}
                  aria-label="搜索运行记录"
                  maxLength={200}
                  placeholder="流程名称、运行或流程 ID"
                  value={draft.query}
                  onChange={(e) => setDraft({ ...draft, query: e.target.value })}
                />
              </label>
              <label>
                状态{stateSelect(draft.state, (state) => setDraft({ ...draft, state }))}
              </label>
              <label>
                触发来源
                <Select<string>
                  aria-label="运行来源筛选"
                  value={draft.source}
                  onChange={(value) => setDraft({ ...draft, source: value })}
                  options={[
                    { value: '', label: '全部来源' },
                    ...Object.entries(runSourceLabels).map(([value, label]) => ({
                      value: value,
                      label: label,
                    })),
                  ]}
                />
              </label>
              <label>
                时间范围{rangeSelect(draft.range, (range) => setDraft({ ...draft, range }))}
              </label>
            </div>
            <div className="history-filter-actions">
              <Button type="primary" htmlType="submit">
                应用筛选
              </Button>
              <Button
                htmlType="button"
                onClick={() => {
                  setDraft({
                    query: '',
                    state: '',
                    source: '',
                    flowId: scope?.id ?? '',
                    range: 'all',
                    limit: 6,
                  });
                }}
              >
                清空条件
              </Button>
              <Button htmlType="button" onClick={() => setFilterOpen(false)}>
                取消
              </Button>
            </div>
            <Collapse
              className="history-extra-filters"
              size="small"
              activeKey={extraFiltersOpen ? ['extra'] : []}
              onChange={(keys) => setExtraFiltersOpen(keys.includes('extra'))}
              items={[
                {
                  key: 'extra',
                  label: '更多条件 · 流程与每页条数',
                  onKeyDown: activateCollapseWithSpace,
                  forceRender: true,
                  children: (
                    <div className="history-extra-fields">
                      <label>
                        流程
                        <Select<string>
                          aria-label="运行流程筛选"
                          disabled={!!scope || undefined}
                          value={draft.flowId}
                          onChange={(value) => setDraft({ ...draft, flowId: value })}
                          options={[
                            { value: '', label: '所有流程' },
                            ...(draft.flowId && !flows.some((flow) => flow.id === draft.flowId)
                              ? [
                                  {
                                    value: draft.flowId,
                                    label:
                                      scope?.id === draft.flowId
                                        ? scope.name
                                        : '当前筛选的流程（不在本地清单）',
                                  },
                                ]
                              : []),
                            ...flows.map((flow) => ({ value: flow.id, label: flow.flow.name })),
                          ]}
                        />
                      </label>
                      <label>
                        每页
                        <Select<string>
                          aria-label="每页运行条数"
                          value={String(draft.limit)}
                          onChange={(value) => setDraft({ ...draft, limit: Number(value) })}
                          options={[
                            ...[6, 25, 50, 100].map((n) => ({
                              value: String(n),
                              label: <>{n} 条</>,
                            })),
                          ]}
                        />
                      </label>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </form>
      ) : (
        <>
          <div className="history-filters">
            {stateSelect(query.state ?? '', (state) =>
              filter({ ...query, state: (state || undefined) as RunListQuery['state'] }),
            )}
            {rangeSelect(range, (days) => {
              setRange(days);
              filter({ ...query, ...historyTimeRange(days === 'all' ? null : Number(days)) });
            })}
            <Button data-history-filter="flow" onClick={() => editFilters('flow')}>
              {scope
                ? '筛选当前流程'
                : query.query || query.flowId || query.source
                  ? '已设置筛选'
                  : '所有流程'}
            </Button>
            <span aria-live="polite">
              {data
                ? `共 ${data.matchedCount} 条记录`
                : loading
                  ? '正在读取运行记录…'
                  : '运行记录暂不可用'}
            </span>
          </div>
          {(error || openError) && (
            <p ref={errorPanel} tabIndex={-1} className="field-error history-error" role="alert">
              <span>{error || openError?.message}</span>
              {error ? (
                <Button onClick={() => setRevision((value) => value + 1)}>重试读取</Button>
              ) : (
                <Button
                  disabled={!!opening || undefined}
                  onClick={() => openError && void inspect(openError.id)}
                >
                  重试打开详情
                </Button>
              )}
            </p>
          )}
          {!!additionalFilters.length && (
            <div
              ref={appliedFilters}
              className="history-applied-filters"
              tabIndex={-1}
              aria-label="已应用的运行筛选"
              aria-describedby={pageSummaryId}
            >
              <p>{additionalFilters.join(' · ')}</p>
              {canClearFilters && (
                <Button
                  htmlType="button"
                  onClick={() => {
                    pageArrival.current = true;
                    setRange('all');
                    filter({ limit: query.limit });
                  }}
                >
                  {scope ? '清除筛选，保留当前流程' : '清除筛选'}
                </Button>
              )}
            </div>
          )}
          <Card className="table-wrap" styles={{ body: { padding: 0 } }} aria-busy={loading}>
            <Table<RunListPage['runs'][number]>
              aria-label="运行记录"
              rowKey="id"
              pagination={false}
              scroll={{ x: 760 }}
              dataSource={data?.runs ?? []}
              onRow={(run) => ({ 'aria-label': runRecordLabel(run) })}
              locale={{
                emptyText: (
                  <p className="history-empty" role="status">
                    {!data
                      ? loading
                        ? '正在读取运行记录…'
                        : '运行记录暂不可用，请重试读取。'
                      : cursors.length > 1
                        ? '当前页已没有记录，请返回上一页或查看最新。'
                        : data.totalCount
                          ? '没有符合筛选条件的运行记录。'
                          : '还没有运行记录。运行一个流程后，可在这里查看。'}
                  </p>
                ),
              }}
              columns={[
                {
                  key: 'flow',
                  title: '流程',
                  width: '30%',
                  render: (_, run) => (
                    <div className="history-run-source">
                      <b>{run.name}</b>
                      {scope && <small className="history-version">按启动时保存的方案执行</small>}
                    </div>
                  ),
                },
                {
                  key: 'state',
                  title: '状态',
                  width: '13.72%',
                  render: (_, run) => (
                    <Tag
                      className="run-state-tag"
                      variant="filled"
                      color={runStateColors[run.state]}
                      icon={<Badge status={runStateColors[run.state]} />}
                    >
                      {runStateLabels[run.state]}
                    </Tag>
                  ),
                },
                {
                  key: 'source',
                  title: '触发方式',
                  width: '13.02%',
                  render: (_, run) => runSourceLabels[runSource(run)] ?? run.source,
                },
                {
                  key: 'time',
                  title: '开始时间',
                  width: '17.01%',
                  render: (_, run) => (
                    <RunStartTime
                      value={data?.elapsed[run.id]?.startedAt}
                      queued={run.state === 'QUEUED'}
                    />
                  ),
                },
                {
                  key: 'duration',
                  title: '耗时',
                  width: '8.07%',
                  render: (_, run) => {
                    const elapsed = data?.elapsed[run.id];
                    return elapsed?.milliseconds == null ? (
                      '待核对'
                    ) : (
                      <div className="history-duration-cell">
                        <span title={formatRunDuration(elapsed.milliseconds)}>
                          {compactDuration(elapsed.milliseconds)}
                        </span>
                        {elapsed.kind === 'recorded' && <small>已记录</small>}
                      </div>
                    );
                  },
                },
                {
                  key: 'open',
                  title: <span className="sr-only">操作</span>,
                  width: '18.18%',
                  render: (_, run) => (
                    <Button
                      type="text"
                      className="history-open"
                      aria-label={`查看 ${runRecordLabel(run)}`}
                      title={`查看 ${runRecordLabel(run)}`}
                      data-run-id={run.id}
                      disabled={!!opening}
                      onClick={() => void inspect(run.id)}
                    >
                      {opening === run.id ? '…' : <ChevronRight size={18} />}
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
          <Modal
            open={!!pageRequest}
            title={`${pageRequest?.direction ?? '下一页'}${pageRequest?.error ? '加载失败' : '加载中'}`}
            width={620}
            centered
            closable={false}
            maskClosable={false}
            focusTriggerAfterClose={false}
            afterClose={finishPage}
            onCancel={cancelPage}
            footer={
              <Flex gap={8} wrap>
                {pageRequest?.error && (
                  <Button
                    type="primary"
                    onClick={() => {
                      generation.current++;
                      setPageRequest((current) =>
                        current
                          ? { ...current, error: undefined, attempt: current.attempt + 1 }
                          : null,
                      );
                    }}
                  >
                    重试同一页
                  </Button>
                )}
                <Button onClick={cancelPage}>取消并留在原页</Button>
              </Flex>
            }
          >
            <Alert
              showIcon
              type={pageRequest?.error ? 'error' : 'info'}
              title={pageRequest?.error ? `${pageRequest.direction}加载失败` : '正在读取目标页'}
              description={
                pageRequest?.error
                  ? `原页数据、页码、筛选与滚动保持。重试只加载同一目标页，取消留在原页。${pageRequest.error}`
                  : '成功后才切换页码。取消保留原页，迟到结果不会覆盖当前列表。'
              }
            />
          </Modal>
          <div className="history-pagination">
            <span id={pageSummaryId} aria-live="polite">
              {data
                ? `显示 ${data.runs.length ? (cursors.length - 1) * (query.limit ?? 6) + 1 : 0}–${data.runs.length ? (cursors.length - 1) * (query.limit ?? 6) + data.runs.length : 0} 条，共 ${data.matchedCount} 条`
                : loading
                  ? '读取中…'
                  : '读取失败'}{' '}
              · <span>第 {cursors.length} 页</span>
            </span>
            <div className="history-page-actions">
              <Button
                disabled={loading || cursors.length < 2 || undefined}
                onClick={() => requestPage(cursors.slice(0, -1), '上一页')}
              >
                上一页
              </Button>
              <Button
                disabled={loading || !!error || !data?.nextCursor || undefined}
                onClick={() => {
                  if (data?.nextCursor) {
                    requestPage([...cursors, data.nextCursor], '下一页');
                  }
                }}
              >
                下一页
              </Button>
              <Button data-history-filter="source" onClick={() => editFilters('source')}>
                触发来源筛选
              </Button>
              <Button className="history-refresh" onClick={latest}>
                查看最新
              </Button>
            </div>
            {!!data?.newerCount && <small>新增 {data.newerCount} 条记录，可查看最新</small>}
          </div>
        </>
      )}
    </div>
  );
}

function compactDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return formatRunDuration(milliseconds);
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return minutes < 60
    ? `${pad(minutes)}:${pad(seconds % 60)}`
    : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
}

function RunStartTime({ value, queued }: { value?: string | null; queued: boolean }) {
  if (!value) return queued ? '尚未开始' : '待核对';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '待核对';
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const day =
    date.toDateString() === now.toDateString()
      ? '今天'
      : date.toDateString() === yesterday.toDateString()
        ? '昨天'
        : date.toLocaleDateString('zh-CN', {
            ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
            month: '2-digit',
            day: '2-digit',
          });
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>
      {day}{' '}
      {date.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}
    </time>
  );
}
