import { recordTime } from './readable-labels';
import { Card, Button, Collapse, Dropdown, Descriptions } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { FlowRecord, Step } from '../shared/types';
import { presentRun } from './run-presentation';
import { runDisplayLabels } from '../shared/run-history';
import { nodeReferenceValues } from '../shared/flow-references';
import { buildDiagram } from './flow-diagram';
import DiagramCanvas from './DiagramCanvas';
import { kinds } from './node-kinds';
import { runTimeline } from './run-timeline';
import { branchCount, flowOutline, outlineMatches, revealOutline, stepTitle } from './flow-outline';
import { useOutlineRun } from './use-outline-run';
import OutlineStepSearch from './OutlineStepSearch';
export type OutlineLocation = {
  mode: 'draft' | 'run';
  view: 'list' | 'graph';
  runSelected: string;
  runId?: string;
  collapsed: { draft: Set<string>; run: Set<string> };
  query: string;
  scroll: { draft: number; run: number };
};
const format = (value: unknown) => {
  const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '未设置');
  return text.length > 65536 ? text.slice(0, 65536) + '\n…仅显示前 65536 个字符' : text;
};
export default function FlowOutlineWorkspace({
  visible,
  record,
  selected,
  select,
  edit,
  editAI,
  activeRunId,
  saved,
  save,
  saveBusy,
  showRun,
  memory,
  more,
}: {
  visible: boolean;
  record: FlowRecord;
  selected: string;
  select: (id: string) => void;
  edit: (id: string) => void;
  editAI: (id: string) => void;
  activeRunId?: string;
  saved: boolean;
  more?: () => void;
  save: () => void;
  saveBusy: boolean;
  showRun: (detail: any) => void;
  memory: MutableRefObject<Map<string, OutlineLocation>>;
}) {
  const origin = memory.current.get(record.id);
  const [mode, setMode] = useState<'draft' | 'run'>(origin?.mode ?? 'draft');
  const [view, setView] = useState<'list' | 'graph'>(origin?.view ?? 'list');
  const [runSelected, setRunSelected] = useState(origin?.runSelected ?? '');
  const [collapsed, setCollapsed] = useState(
    origin?.collapsed ?? { draft: new Set<string>(), run: new Set<string>() },
  );
  const [query, setQuery] = useState(origin?.query ?? '');
  const [focusRequest, setFocusRequest] = useState(0);
  const root = useRef<HTMLElement>(null),
    list = useRef<HTMLDivElement>(null),
    menuTrigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const observation = useOutlineRun(visible, record.id, activeRunId);
  const detail = observation.detail;
  const runView = observation.observed ? presentRun(observation.observed, Date.now()) : undefined;
  const current =
    runView &&
    observation.fresh &&
    runView.activity === 'active' &&
    !runView.closing &&
    ['current', 'paused', 'waiting'].includes(runView.step.kind)
      ? runView.step
      : undefined;
  const flow = mode === 'run' ? detail?.snapshot : record.flow;
  const model = useMemo(() => flowOutline(flow?.steps ?? []), [flow?.steps]);
  const selectedId = model.byId.has(mode === 'run' ? runSelected : selected)
    ? mode === 'run'
      ? runSelected
      : selected
    : (model.entries[0]?.step.id ?? '');
  const entry = model.byId.get(selectedId);
  const chosenGroup = entry?.group;
  const matches = outlineMatches(model.entries, query);
  const rows = observation.observed ? runTimeline(observation.observed) : [];
  const { nodes, edges } = useMemo(
    () => buildDiagram(flow?.steps ?? [], selectedId),
    [flow?.steps, selectedId],
  );
  const pendingFocus = useRef<string | undefined>(undefined);
  const runIdentity = useRef(origin?.runId),
    scroll = useRef(origin?.scroll ?? { draft: 0, run: 0 }),
    restored = useRef<'draft' | 'run' | undefined>(undefined),
    lastSelection = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!detail || runIdentity.current === detail.run.id) return;
    runIdentity.current = detail.run.id;
    setRunSelected('');
    setCollapsed((old) => ({ ...old, run: new Set() }));
    scroll.current.run = 0;
    if (mode === 'run') restored.current = undefined;
  }, [detail?.run.id]);
  useLayoutEffect(() => {
    memory.current.set(record.id, {
      mode,
      view,
      runSelected,
      collapsed,
      query,
      runId: detail?.run.id ?? runIdentity.current,
      scroll: scroll.current,
    });
  }, [record.id, memory, mode, view, runSelected, collapsed, query, detail?.run.id]);
  useLayoutEffect(() => {
    if (!visible) {
      lastSelection.current = undefined;
      return;
    }
    if (!entry) return;
    const identity = `${mode}:${selectedId}:${entry.group}:${entry.ancestors.join('/')}`;
    if (lastSelection.current === identity) return;
    lastSelection.current = identity;
    // The editor may select or move a step while this workspace is hidden.
    // Derive its group from the current tree and reveal only its own ancestors.
    if (entry.ancestors.some((key) => collapsed[mode].has(key)))
      setCollapsed((old) => ({ ...old, [mode]: revealOutline(entry, old[mode]).collapsed }));
    if (
      document.activeElement === document.body ||
      list.current?.contains(document.activeElement)
    ) {
      pendingFocus.current = selectedId;
      setFocusRequest((n) => n + 1);
    }
  }, [visible, mode, selectedId, entry?.group, entry?.ancestors.join('\n')]);
  useLayoutEffect(() => {
    if (!visible || view !== 'list') {
      restored.current = undefined;
      return;
    }
    if (flow && list.current && restored.current !== mode) {
      list.current.scrollTop = scroll.current[mode];
      restored.current = mode;
    }
  }, [visible, flow?.id, mode, view, mode === 'run' ? detail?.run.id : undefined]);
  useLayoutEffect(() => {
    if (!visible || !pendingFocus.current) return;
    const id = pendingFocus.current;
    const target = [
      ...(list.current?.querySelectorAll<HTMLElement>('[data-outline-step]') ?? []),
    ].find((element) => element.dataset.outlineStep === id);
    if (target && view === 'list') {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      pendingFocus.current = undefined;
    }
  }, [visible, selectedId, chosenGroup, collapsed, view, focusRequest, mode]);
  const choose = (id: string, nextMode = mode) => {
    const nextModel =
      nextMode === mode
        ? model
        : flowOutline(nextMode === 'run' ? (detail?.snapshot?.steps ?? []) : record.flow.steps);
    const next = nextModel.byId.get(id);
    if (!next) return;
    const revealed = revealOutline(next, collapsed[nextMode]);
    if (nextMode === 'draft') select(id);
    else setRunSelected(id);
    setMode(nextMode);
    setCollapsed((old) => ({ ...old, [nextMode]: revealed.collapsed }));
    pendingFocus.current = id;
    setFocusRequest((n) => n + 1);
  };
  const switchSource = (nextMode: 'draft' | 'run') => {
    if (nextMode === mode) return;
    const nextModel = flowOutline(
      nextMode === 'run' ? (detail?.snapshot?.steps ?? []) : record.flow.steps,
    );
    const remembered = nextMode === 'run' ? runSelected : selected;
    const id = nextModel.byId.has(remembered)
      ? remembered
      : nextModel.byId.has(selectedId)
        ? selectedId
        : nextModel.entries[0]?.step.id;
    if (id) choose(id, nextMode);
    else setMode(nextMode);
  };
  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) menuTrigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);
  const toggle = (key: string) =>
    setCollapsed((old) => {
      const next = new Set(old[mode]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...old, [mode]: next };
    });
  function branch(children: Step[], owner: string, name: string, label: string) {
    const key = owner + ':' + name,
      closed = collapsed[mode].has(key);
    return (
      <div className="outline-branch" key={key}>
        <Button
          type="text"
          size="small"
          className="outline-branch-toggle"
          aria-expanded={!closed}
          onClick={() => toggle(key)}
        >
          {closed ? '展开' : '收起'}
          {label} · {branchCount(children)} 步
        </Button>
        {!closed &&
          (children.length ? (
            block(children)
          ) : (
            <p className="outline-empty-branch">没有子步骤，继续后续流程。</p>
          ))}
      </div>
    );
  }
  function block(steps: Step[]) {
    return steps.map((step) => {
      const item = model.byId.get(step.id)!;
      const live = mode === 'run' && current?.nodeId === step.id;
      return (
        <div key={step.id} className="outline-step-block">
          <Button
            className={'outline-step' + (live ? ' is-current' : '')}
            color={selectedId === step.id || live ? 'primary' : 'default'}
            variant="filled"
            data-outline-step={step.id}
            aria-pressed={selectedId === step.id}
            aria-current={live ? 'step' : undefined}
            onClick={() => choose(step.id)}
          >
            <span>{String(item.ordinal).padStart(2, '0')}</span>
            <strong>{stepTitle(step)}</strong>
            {live && (
              <small>
                ←{' '}
                {current.kind === 'paused'
                  ? '下一步'
                  : current.kind === 'waiting'
                    ? '等待人工'
                    : '当前执行'}
              </small>
            )}
          </Button>
          {step.type === 'condition' && (
            <div className="outline-branches">
              {branch(step.then, step.id, 'then', '成立分支')}
              {branch(step.else, step.id, 'else', '否则分支')}
            </div>
          )}
          {step.type === 'loop' && (
            <div className="outline-branches">
              {branch(step.body, step.id, 'body', '串行循环体')}
            </div>
          )}
        </div>
      );
    });
  }
  const selectedRows = mode === 'run' ? rows.filter((row) => row.nodeId === selectedId) : [];
  const fields: Record<string, string> = {
    input: '输入',
    value: '数据',
    items: '循环集合',
    actual: '判断值',
    expected: '比较值',
    binding: '目录绑定',
    name: '文件名',
    sheet: '工作表',
    selector: '网页目标',
    framePath: '框架路径',
    timeoutMs: '超时（毫秒）',
    url: '地址',
  };
  return (
    <section className="flow-outline-page" hidden={!visible} ref={root} aria-label="长流程工作区">
      <header className="outline-heading">
        <h1>{model.entries.length} 步任务，也能找到当前一步</h1>
        <p>
          步骤大纲、搜索定位和分支折叠 · {saved ? '草稿已保存' : '草稿有未保存修改'}
          {detail && <span>{' · 按启动时保存的方案执行'}</span>}
        </p>
      </header>
      <div className="outline-toolbar">
        <OutlineStepSearch query={query} change={setQuery} matches={matches} choose={choose} />
        <Button
          type="primary"
          disabled={!current?.nodeId || undefined}
          onClick={() => {
            if (current?.nodeId) choose(current.nodeId, 'run');
          }}
        >
          聚焦当前执行
        </Button>
        <Button
          onClick={() => {
            setView(view === 'list' ? 'graph' : 'list');
            setFocusRequest((n) => n + 1);
            pendingFocus.current = selectedId;
          }}
        >
          {view === 'list' ? '展开流程图' : '返回步骤清单'}
        </Button>
        <Dropdown
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={['click']}
          autoFocus
          menu={{
            items: [
              { key: 'expand', label: '展开全部分支' },
              { key: 'collapse', label: '收起全部分支' },
              {
                key: 'save',
                label: saveBusy ? '正在保存…' : saved ? '草稿已保存' : '保存草稿',
                disabled: saveBusy || saved,
              },
              ...(more ? [{ key: 'more', label: '任务的更多操作', disabled: saveBusy }] : []),
            ],
            onClick: ({ key }) => {
              closeMenu(key !== 'more');
              if (key === 'expand') setCollapsed((old) => ({ ...old, [mode]: new Set() }));
              if (key === 'collapse')
                setCollapsed((old) => ({
                  ...old,
                  [mode]: new Set(
                    model.entries.flatMap((item) =>
                      item.step.type === 'condition'
                        ? [item.step.id + ':then', item.step.id + ':else']
                        : item.step.type === 'loop'
                          ? [item.step.id + ':body']
                          : [],
                    ),
                  ),
                }));
              if (key === 'save') save();
              if (key === 'more') more?.();
            },
            onBlur: (event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
            },
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeMenu(true);
              }
            },
          }}
        >
          <Button
            ref={menuTrigger}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
          >
            更多 ···
          </Button>
        </Dropdown>
      </div>
      <div className="outline-columns">
        <aside className="outline-groups" aria-label="步骤大纲">
          <Card className="outline-card">
            <h2>步骤大纲 · {model.entries.length} 步</h2>
            {model.groups.map((item) => (
              <Button
                key={item.id}
                color={chosenGroup === item.id ? 'primary' : 'default'}
                variant={chosenGroup === item.id ? 'filled' : 'outlined'}
                className="outline-group"
                aria-pressed={chosenGroup === item.id}
                onClick={() => choose(item.steps[0].id)}
              >
                <strong>
                  {String(item.start).padStart(2, '0')}–{String(item.end).padStart(2, '0')}{' '}
                  {item.title}
                </strong>
                <span>
                  {mode === 'run' &&
                  current?.nodeId &&
                  model.byId.get(current.nodeId)?.group === item.id
                    ? '当前执行在这里'
                    : '展开查看子步骤'}
                </span>
              </Button>
            ))}
            {!model.entries.length && (
              <p>{mode === 'run' ? '尚未取得运行快照。' : '还没有步骤，可返回编排添加。'}</p>
            )}
          </Card>
        </aside>
        <section className="outline-center" aria-label="大纲步骤清单">
          <Card className="outline-card">
            <h2>
              {entry
                ? `${mode === 'run' && current?.nodeId === selectedId ? (current.kind === 'paused' ? '下一步' : '当前') : '已选'}：第 ${entry.ordinal} / ${model.entries.length} 步 · ${stepTitle(entry.step)}`
                : '选择一个步骤'}
            </h2>
            <div className="outline-source" aria-label="大纲数据来源">
              <Button
                size="small"
                color={mode === 'draft' ? 'primary' : 'default'}
                variant={mode === 'draft' ? 'filled' : 'outlined'}
                aria-pressed={mode === 'draft'}
                onClick={() => switchSource('draft')}
              >
                编辑中的草稿
              </Button>
              <Button
                size="small"
                color={mode === 'run' ? 'primary' : 'default'}
                variant={mode === 'run' ? 'filled' : 'outlined'}
                aria-pressed={mode === 'run'}
                disabled={!detail?.snapshot || undefined}
                onClick={() => switchSource('run')}
              >
                运行快照 · 只读
              </Button>
              <p>
                {observation.reason ??
                  (detail
                    ? `${runDisplayLabels[detail.run.state]} · ${recordTime(detail.run.createdAt)}`
                    : '尚无运行记录')}
                {detail &&
                  JSON.stringify(record.flow) !== JSON.stringify(detail.snapshot) &&
                  ' · 草稿与固定版本不同，编辑只影响下一次运行。'}
              </p>
            </div>
            <p className="outline-definition-note">
              编号对应定义顺序；条件只执行选定分支，循环可多次执行。
            </p>
            <div
              className="outline-step-list"
              ref={list}
              hidden={view !== 'list'}
              onScroll={(event) => {
                if (!visible || view !== 'list' || restored.current !== mode) return;
                scroll.current[mode] = event.currentTarget.scrollTop;
                const location = memory.current.get(record.id);
                if (location) location.scroll[mode] = scroll.current[mode];
              }}
            >
              {model.groups.map((item) => (
                <div key={item.id}>
                  {chosenGroup === item.id ? (
                    block(item.steps)
                  ) : (
                    <Button
                      color="default"
                      variant="filled"
                      className="outline-collapsed-group"
                      onClick={() => choose(item.steps[0].id)}
                    >
                      {item.start}–{item.end} {item.title}（已折叠）
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="outline-diagram" hidden={view !== 'graph'}>
              <DiagramCanvas
                nodes={nodes}
                edges={edges}
                selected={selectedId}
                select={(id) => choose(id)}
                active={visible && view === 'graph'}
                focusRequest={focusRequest}
              />
            </div>
          </Card>
        </section>
        <aside className="outline-inspector" aria-label="大纲当前步骤">
          <Card className="outline-card">
            <h2>当前步骤</h2>
            {entry ? (
              <>
                <h3>
                  {entry.ordinal} · {stepTitle(entry.step)}
                </h3>
                <p>
                  {kinds[entry.step.type].label} · {entry.step.id}
                </p>
                <p>
                  {mode === 'run'
                    ? '以下属于固定运行快照，保持只读。'
                    : '以下属于当前草稿，保存不会改写已有运行。'}
                </p>
                <Descriptions
                  column={1}
                  layout="vertical"
                  size="small"
                  items={Object.entries(nodeReferenceValues(entry.step))
                    .filter(
                      ([key]) =>
                        fields[key] &&
                        (key !== 'name' || ['file', 'excel'].includes(entry.step.type)),
                    )
                    .map(([key, value]) => ({
                      key,
                      label: fields[key],
                      children: (
                        <span className="outline-value-preview">
                          {format(value).slice(0, 180)}
                          {format(value).length > 180 ? '…' : ''}
                        </span>
                      ),
                    }))}
                />
                <div onKeyDown={activateCollapseWithSpace}>
                  <Collapse
                    size="small"
                    items={[
                      {
                        key: 'configuration',
                        label: '完整步骤配置',
                        forceRender: true,
                        children: <pre>{format(nodeReferenceValues(entry.step))}</pre>,
                      },
                    ]}
                  />
                </div>
                {mode === 'draft' ? (
                  <>
                    <Button onClick={() => edit(entry.step.id)}>编辑步骤配置</Button>
                    <Button
                      data-ai-edit-step
                      disabled={!saved || undefined}
                      onClick={() => editAI(entry.step.id)}
                    >
                      AI 只修改这一步
                    </Button>
                    {!saved && <p>先保存草稿，再使用 AI 修改。</p>}
                  </>
                ) : (
                  <>
                    {selectedRows.map((row) => (
                      <div className="outline-instance" key={row.instance}>
                        <strong>{row.label}</strong>
                        <code>{row.instance}</code>
                      </div>
                    ))}
                    <Button onClick={() => detail && showRun(detail)}>查看此运行详情</Button>
                    <Button
                      disabled={
                        !record.flow.steps.length ||
                        !flowOutline(record.flow.steps).byId.has(entry.step.id) ||
                        undefined
                      }
                      onClick={() => choose(entry.step.id, 'draft')}
                    >
                      定位草稿中的同一步
                    </Button>
                  </>
                )}
              </>
            ) : (
              <p>选择步骤后查看配置及来源。</p>
            )}
          </Card>
        </aside>
      </div>
    </section>
  );
}
