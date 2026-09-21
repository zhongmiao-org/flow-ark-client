import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { FlowRecord, Step } from '../shared/types';
import { presentRun } from '../shared/run-presentation';
import { runDisplayLabels } from '../shared/run-history';
import { nodeReferenceValues } from '../shared/flow-references';
import { buildDiagram } from './flow-diagram';
import DiagramCanvas from './DiagramCanvas';
import { kinds } from './node-kinds';
import { runTimeline } from './run-timeline';
import { branchCount, flowOutline, outlineMatches, revealOutline, stepTitle } from './flow-outline';
import { useOutlineRun } from './use-outline-run';
export type OutlineLocation = {
  mode: 'draft' | 'run';
  view: 'list' | 'graph';
  runSelected: string;
  runId?: string;
  group: { draft: string; run: string };
  collapsed: { draft: Set<string>; run: Set<string> };
  query: string;
  scroll: number;
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
  showRun,
  memory,
}: {
  visible: boolean;
  record: FlowRecord;
  selected: string;
  select: (id: string) => void;
  edit: (id: string) => void;
  editAI: (id: string) => void;
  activeRunId?: string;
  saved: boolean;
  save: () => void;
  showRun: (detail: any) => void;
  memory: MutableRefObject<Map<string, OutlineLocation>>;
}) {
  const origin = memory.current.get(record.id);
  const [mode, setMode] = useState<'draft' | 'run'>(origin?.mode ?? 'draft');
  const [view, setView] = useState<'list' | 'graph'>(origin?.view ?? 'list');
  const [runSelected, setRunSelected] = useState(origin?.runSelected ?? '');
  const [group, setGroup] = useState(origin?.group ?? { draft: '', run: '' });
  const [collapsed, setCollapsed] = useState(
    origin?.collapsed ?? { draft: new Set<string>(), run: new Set<string>() },
  );
  const [query, setQuery] = useState(origin?.query ?? ''),
    [searching, setSearching] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const root = useRef<HTMLElement>(null),
    list = useRef<HTMLDivElement>(null);
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
  const chosenGroup = model.groups.some((item) => item.id === group[mode])
    ? group[mode]
    : entry?.group;
  const matches = outlineMatches(model.entries, query);
  const rows = observation.observed ? runTimeline(observation.observed) : [];
  const { nodes, edges } = useMemo(
    () => buildDiagram(flow?.steps ?? [], selectedId),
    [flow?.steps, selectedId],
  );
  const pendingFocus = useRef<string | undefined>(undefined);
  const runIdentity = useRef(origin?.runId),
    scroll = useRef(origin?.scroll ?? 0),
    restored = useRef(false);
  useEffect(() => {
    if (!detail || runIdentity.current === detail.run.id) return;
    runIdentity.current = detail.run.id;
    setRunSelected('');
    setGroup((old) => ({ ...old, run: '' }));
    setCollapsed((old) => ({ ...old, run: new Set() }));
  }, [detail?.run.id]);
  useLayoutEffect(() => {
    memory.current.set(record.id, {
      mode,
      view,
      runSelected,
      group,
      collapsed,
      query,
      runId: detail?.run.id ?? runIdentity.current,
      scroll: scroll.current,
    });
  }, [record.id, memory, mode, view, runSelected, group, collapsed, query, detail?.run.id]);
  useLayoutEffect(() => {
    if (!visible) {
      restored.current = false;
      return;
    }
    if (flow && list.current && !restored.current) {
      list.current.scrollTop = scroll.current;
      restored.current = true;
    }
  }, [visible, flow?.id]);
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
    setGroup((old) => ({ ...old, [nextMode]: revealed.group }));
    setCollapsed((old) => ({ ...old, [nextMode]: revealed.collapsed }));
    setSearching(false);
    pendingFocus.current = id;
    setFocusRequest((n) => n + 1);
  };
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
        <button
          className="outline-branch-toggle"
          aria-expanded={!closed}
          onClick={() => toggle(key)}
        >
          {closed ? '展开' : '收起'}
          {label} · {branchCount(children)} 步
        </button>
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
          <button
            className={'outline-step' + (live ? ' is-current' : '')}
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
          </button>
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
          {detail && (
            <span title={detail.run.versionId}>
              {` · 运行固定版本 ${detail.run.versionId.slice(0, 8)}`}
            </span>
          )}
        </p>
      </header>
      <div className="outline-toolbar">
        <div className="outline-search">
          <label htmlFor="outline-search">搜索步骤</label>
          <input
            id="outline-search"
            value={query}
            placeholder="名称、步骤编号或动作类型"
            autoComplete="off"
            onFocus={() => setSearching(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearching(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearching(false);
              if (event.key === 'Enter' && matches[0]) {
                event.preventDefault();
                choose(matches[0].step.id);
              }
            }}
          />
          {query && <span role="status">找到 {matches.length} 个步骤</span>}
          {query && searching && (
            <div className="outline-search-results" aria-label="步骤搜索结果">
              {matches.map((item) => (
                <button key={item.step.id} onClick={() => choose(item.step.id)}>
                  {item.ordinal} · {stepTitle(item.step)}
                  <small>{item.step.id}</small>
                </button>
              ))}
              {!matches.length && <p>没有匹配的步骤。</p>}
            </div>
          )}
        </div>
        <button
          className="primary"
          disabled={!current?.nodeId}
          onClick={() => {
            if (current?.nodeId) choose(current.nodeId, 'run');
          }}
        >
          聚焦当前执行
        </button>
        <button
          onClick={() => {
            setView(view === 'list' ? 'graph' : 'list');
            setFocusRequest((n) => n + 1);
            pendingFocus.current = selectedId;
          }}
        >
          {view === 'list' ? '展开流程图' : '返回步骤清单'}
        </button>
        <details className="outline-more">
          <summary>更多 ···</summary>
          <div>
            <button onClick={() => setCollapsed((old) => ({ ...old, [mode]: new Set() }))}>
              展开全部分支
            </button>
            <button
              onClick={() =>
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
                }))
              }
            >
              收起全部分支
            </button>
            <button onClick={save}>保存草稿</button>
          </div>
        </details>
      </div>
      <div className="outline-columns">
        <aside className="outline-groups ai-task-card" aria-label="步骤大纲">
          <h2>步骤大纲 · {model.entries.length} 步</h2>
          {model.groups.map((item) => (
            <button
              key={item.id}
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
            </button>
          ))}
          {!model.entries.length && (
            <p>{mode === 'run' ? '尚未取得运行快照。' : '还没有步骤，可返回编排添加。'}</p>
          )}
        </aside>
        <section className="outline-center ai-task-card" aria-label="大纲步骤清单">
          <h2>
            {entry
              ? `${mode === 'run' && current?.nodeId === selectedId ? (current.kind === 'paused' ? '下一步' : '当前') : '已选'}：第 ${entry.ordinal} / ${model.entries.length} 步 · ${stepTitle(entry.step)}`
              : '选择一个步骤'}
          </h2>
          <div className="outline-source" aria-label="大纲数据来源">
            <button aria-pressed={mode === 'draft'} onClick={() => setMode('draft')}>
              编辑中的草稿
            </button>
            <button
              aria-pressed={mode === 'run'}
              disabled={!detail?.snapshot}
              onClick={() => setMode('run')}
            >
              运行快照 · 只读
            </button>
            <p>
              {observation.reason ??
                (detail
                  ? `${runDisplayLabels[detail.run.state]} · ${detail.run.id}`
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
              scroll.current = event.currentTarget.scrollTop;
              const location = memory.current.get(record.id);
              if (location) location.scroll = scroll.current;
            }}
          >
            {model.groups.map((item) => (
              <div key={item.id}>
                {chosenGroup === item.id ? (
                  block(item.steps)
                ) : (
                  <button
                    className="outline-collapsed-group"
                    onClick={() => choose(item.steps[0].id)}
                  >
                    {item.start}–{item.end} {item.title}（已折叠）
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="outline-diagram" hidden={view !== 'graph'}>
            <DiagramCanvas
              nodes={nodes}
              edges={edges}
              selected={selectedId}
              select={choose}
              active={visible && view === 'graph'}
              focusRequest={focusRequest}
            />
          </div>
        </section>
        <aside className="outline-inspector ai-task-card" aria-label="大纲当前步骤">
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
              <dl>
                {Object.entries(nodeReferenceValues(entry.step))
                  .filter(
                    ([key]) =>
                      fields[key] &&
                      (key !== 'name' || ['file', 'excel'].includes(entry.step.type)),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{fields[key]}</dt>
                      <dd>
                        {format(value).slice(0, 180)}
                        {format(value).length > 180 ? '…' : ''}
                      </dd>
                    </div>
                  ))}
              </dl>
              <details>
                <summary>完整步骤配置</summary>
                <pre>{format(nodeReferenceValues(entry.step))}</pre>
              </details>
              {mode === 'draft' ? (
                <>
                  <button onClick={() => edit(entry.step.id)}>编辑步骤配置</button>
                  <button data-ai-edit-step disabled={!saved} onClick={() => editAI(entry.step.id)}>
                    AI 只修改这一步
                  </button>
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
                  <button onClick={() => detail && showRun(detail)}>查看此运行详情</button>
                  <button
                    disabled={
                      !record.flow.steps.length ||
                      !flowOutline(record.flow.steps).byId.has(entry.step.id)
                    }
                    onClick={() => choose(entry.step.id, 'draft')}
                  >
                    定位草稿中的同一步
                  </button>
                </>
              )}
            </>
          ) : (
            <p>选择步骤后查看配置及来源。</p>
          )}
        </aside>
      </div>
    </section>
  );
}
