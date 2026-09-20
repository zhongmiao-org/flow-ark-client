import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/core/engine';
import {
  presentRun,
  formatRunDuration,
  type RunPresentationInput,
} from '../src/shared/run-presentation';
import type { Event, ExecutionObservation, Flow, Json, Run, Step } from '../src/shared/types';

const time = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
const at = (seconds: number) => Date.parse(time(seconds));
const run = (extra: Partial<Run> = {}): Run => ({
  id: 'run-observation',
  flowId: 'flow',
  versionId: 'immutable-version',
  name: '虚构演示',
  state: 'RUNNING',
  source: 'manual',
  createdAt: time(0),
  updatedAt: time(10),
  business: 'fixture',
  ...extra,
});
const flow = (steps: Step[]): Flow => ({
  formatVersion: '1.0',
  id: 'flow',
  name: '固定快照',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps,
});
const script: Step = {
  id: 'work',
  name: '生成虚构回执',
  type: 'script',
  version: 1,
  language: 'js',
  code: 'export default () => null',
  input: null,
  dependencies: [],
};
const active = (
  runId = 'run-observation',
  phase: 'executing' | 'closing' = 'executing',
): ExecutionObservation => ({
  observedAt: time(20),
  active: { runId, phase },
});
const event = (
  sequence: number,
  type: string,
  nodeInstance: string,
  data: any,
  seconds = 10 + sequence,
): Event => ({
  runId: 'run-observation',
  sequence,
  time: time(seconds),
  type,
  nodeInstance,
  data,
});
const started = () => [
  event(1, 'state', '', { state: 'QUEUED' }, 0),
  event(2, 'state', '', { state: 'RUNNING' }, 10),
  event(3, 'node-start', 'work', { type: 'script' }, 11),
];
const input = (extra: Partial<RunPresentationInput> = {}): RunPresentationInput => ({
  run: run(),
  events: started(),
  snapshot: flow([script]),
  execution: active(),
  ...extra,
});

test('no-report script uses immutable names and live total elapsed, excluding queue time without inventing quantity', () => {
  const source = input();
  const first = presentRun(source, at(20));
  assert.deepEqual(first.step, {
    kind: 'current',
    label: '当前步骤：生成虚构回执',
    instance: 'work',
    nodeId: 'work',
    name: '生成虚构回执',
    type: 'script',
  });
  assert.equal(first.activity, 'active');
  assert.equal(first.elapsed.kind, 'live');
  assert.equal(first.elapsed.milliseconds, 10000);
  assert.match(first.elapsed.note, /包含暂停和人工等待，不含排队/);
  assert.deepEqual(first.progress, { kind: 'none', label: '未报告数量' });
  assert.equal(presentRun(source, at(23)).elapsed.milliseconds, 13000);
  assert.equal(first.output.available, false);
});

test('real engine nested condition/loop events select the innermost open instance and never reuse another iteration report', async () => {
  const snapshot = flow([
    {
      id: 'choose',
      name: '选择分支',
      type: 'condition',
      version: 1,
      actual: true,
      operator: 'equals',
      expected: true,
      else: [{ id: 'unused', name: '未执行分支', type: 'value', version: 1, value: false }],
      then: [
        {
          id: 'outer',
          name: '外层循环',
          type: 'loop',
          version: 1,
          items: [0, 1],
          body: [
            {
              id: 'inner',
              name: '内层循环',
              type: 'loop',
              version: 1,
              items: ['a', 'b'],
              body: [script],
            },
          ],
        },
      ],
    },
  ]);
  const events = started().slice(0, 2);
  const locations: string[] = [];
  const emit = (type: string, instance: string, data: any) => {
    events.push(event(events.length + 1, type, instance, data));
  };
  await execute(
    snapshot,
    {},
    {
      signal: new AbortController().signal,
      boundary: async () => {},
      human: async () => true,
      emit: async (type, instance, data) => {
        emit(type, instance, data);
      },
      perform: async (_node, _resolved, instance) => {
        locations.push(instance);
        const view = () => presentRun(input({ snapshot, events }), at(100));
        assert.equal(view().step.instance, instance);
        assert.equal(view().step.name, '生成虚构回执');
        assert.equal(view().step.kind, 'current');
        assert.equal(view().progress.kind, 'none');
        emit('progress', instance, { completed: 2, total: 5 });
        assert.equal(view().progress.label, '脚本报告 2 / 5');
        assert.equal(view().progress.instance, instance);
        return { receipt: 'fictional' };
      },
    },
  );
  assert.deepEqual(locations, [
    'choose/outer[0]/inner[0]/work',
    'choose/outer[0]/inner[1]/work',
    'choose/outer[1]/inner[0]/work',
    'choose/outer[1]/inner[1]/work',
  ]);
  const between = presentRun(input({ snapshot, events }), at(100));
  assert.equal(between.step.kind, 'pending');
  assert.equal(between.step.label, '等待下一条步骤记录');
  assert.equal(between.closing, false);
  assert.equal(between.progress.kind, 'none');
  assert.ok(!events.some((item) => item.nodeInstance.includes('unused')));
});

test('ordered starts and exact ends preserve the open parent, ignore other runs, and do not mutate supplied history', () => {
  const snapshot = flow([
    { id: 'loop', name: '批次', type: 'loop', version: 1, items: [0], body: [script] },
  ]);
  const events = [
    event(6, 'node-end', 'loop[0]/work', { completed: true }),
    event(4, 'node-start', 'loop', { type: 'loop' }),
    event(5, 'node-start', 'loop[0]/work', { type: 'script' }),
    { ...event(7, 'node-start', 'foreign/child', {}), runId: 'another-run' },
  ];
  const before = structuredClone(events);
  const view = presentRun(input({ snapshot, events }), at(100));
  assert.equal(view.step.instance, 'loop');
  assert.equal(view.step.name, '批次');
  assert.deepEqual(events, before);
  assert.equal(view.progress.kind, 'none');
});

test('progress uses the latest valid current-instance count and leaves invalid reports untouched', () => {
  const events = started();
  const append = (data: any, instance = 'work') =>
    events.push(event(events.length + 1, 'progress', instance, data));
  append({ completed: 1, total: 5 });
  append({ completed: 2, total: 5 });
  for (const data of [
    { completed: -1, total: 5 },
    { completed: NaN },
    { completed: Infinity },
    { completed: '3', total: 5 },
    { completed: 6, total: 5 },
    { completed: 1, total: -1 },
    { completed: 1, total: Infinity },
    { completed: 1, total: null },
    { completed: 1, total: '5' },
  ])
    append(data);
  append({ completed: 999, total: 1000 }, 'other');
  const before = structuredClone(events);
  assert.equal(presentRun(input({ events }), at(100)).progress.label, '脚本报告 2 / 5');
  assert.deepEqual(events, before);
  append({ completed: 0, total: 0 });
  assert.equal(presentRun(input({ events }), at(100)).progress.label, '脚本报告 0 / 0');
  append({ completed: 2.5 });
  const view = presentRun(input({ events }), at(100));
  assert.equal(view.progress.label, '已处理 2.5');
  assert.equal(view.progress.total, undefined);
  assert.ok(!view.progress.label.includes('%'));
  assert.equal(
    presentRun(
      input({ events: [...started(), event(4, 'progress', 'work', { completed: -1 })] }),
      at(100),
    ).progress.kind,
    'none',
  );
});

test('new node-start does not reuse reports from an earlier completed occurrence of the same exact path', () => {
  const events = [
    ...started(),
    event(4, 'progress', 'work', { completed: 2 }),
    event(5, 'node-end', 'work', {}),
    event(6, 'node-start', 'work', { type: 'script' }),
  ];
  assert.equal(presentRun(input({ events }), at(100)).progress.kind, 'none');
});

test('pause identifies the pending boundary from the snapshot, rejects old pauses, and counts human wait in total elapsed', () => {
  const snapshot = flow([
    { id: 'loop', name: '批次', type: 'loop', version: 1, items: [0, 1], body: [script] },
  ]);
  const events = [
    ...started().slice(0, 2),
    event(3, 'node-start', 'loop', { type: 'loop' }),
    event(4, 'state', '', { state: 'PAUSED' }, 15),
    event(5, 'debug-pause', 'loop[1]/work', { nodeName: '不使用事件名称替代快照' }, 16),
  ];
  const paused = presentRun(input({ run: run({ state: 'PAUSED' }), snapshot, events }), at(30));
  assert.equal(paused.step.kind, 'paused');
  assert.equal(paused.step.instance, 'loop[1]/work');
  assert.equal(paused.step.label, '下一步：生成虚构回执');
  assert.equal(paused.progress.kind, 'none');
  assert.equal(paused.elapsed.milliseconds, 20000);
  events.push(
    event(6, 'state', '', { state: 'RUNNING' }, 31),
    event(7, 'node-start', 'loop[1]/work', { type: 'script' }, 32),
    event(8, 'state', '', { state: 'PAUSED' }, 33),
  );
  const pendingPause = presentRun(
    input({ run: run({ state: 'PAUSED' }), snapshot, events }),
    at(35),
  );
  assert.equal(pendingPause.step.kind, 'unknown');
  assert.equal(pendingPause.step.instance, undefined);
  const human: Step = {
    id: 'approve',
    name: '确认虚构表单',
    type: 'human',
    version: 1,
    message: '请确认',
  };
  const waiting = presentRun(
    input({
      run: run({ state: 'WAITING_INPUT' }),
      snapshot: flow([human]),
      events: [
        ...started().slice(0, 2),
        event(3, 'node-start', 'approve', { type: 'human' }, 12),
        event(4, 'state', '', { state: 'WAITING_INPUT' }, 13),
      ],
    }),
    at(30),
  );
  assert.equal(waiting.step.kind, 'waiting');
  assert.equal(waiting.step.label, '等待人工：确认虚构表单');
  assert.equal(waiting.elapsed.milliseconds, 20000);
});

test('only the matching host closing observation means closing; absent or different owners never imply active execution', () => {
  const closing = presentRun(input({ execution: active('run-observation', 'closing') }), at(20));
  assert.equal(closing.closing, true);
  assert.equal(closing.step.kind, 'last');
  assert.match(closing.statusNote!, /正在收尾/);
  assert.equal(closing.elapsed.kind, 'live');
  const unknown = presentRun(input({ execution: undefined }), at(100));
  assert.equal(unknown.activity, 'unknown');
  assert.equal(unknown.step.kind, 'last');
  assert.equal(unknown.elapsed.kind, 'recorded');
  assert.equal(unknown.elapsed.milliseconds, 1000);
  assert.match(unknown.statusNote!, /实时状态未知/);
  for (const execution of [
    active('other-run', 'closing'),
    { observedAt: time(20), active: null },
  ]) {
    const inactive = presentRun(input({ execution, fault: 'SQLITE_FULL' }), at(100));
    assert.equal(inactive.activity, 'inactive');
    assert.equal(inactive.closing, false);
    assert.equal(inactive.step.kind, 'last');
    assert.equal(inactive.elapsed.milliseconds, 1000);
    assert.match(inactive.statusNote!, /最后成功保存/);
    assert.ok(!inactive.statusNote!.includes('所有进程已停止'));
  }
  const stale = presentRun(input({ execution: { observedAt: time(20), active: null } }), at(100));
  assert.match(stale.statusNote!, /最后保存状态/);
  const stillOwned = presentRun(input({ fault: 'SQLITE_FULL' }), at(100));
  assert.equal(stillOwned.activity, 'active');
  assert.equal(stillOwned.step.kind, 'last');
  assert.equal(stillOwned.elapsed.kind, 'live');
  assert.match(stillOwned.statusNote!, /当前执行和最终结果请核对/);
  const stalePause = presentRun(
    input({
      run: run({ state: 'PAUSED' }),
      fault: 'SQLITE_FULL',
      events: [
        ...started(),
        event(4, 'state', '', { state: 'PAUSED' }),
        event(5, 'debug-pause', 'another-step', {}),
      ],
    }),
    at(100),
  );
  assert.equal(stalePause.step.kind, 'last');
  assert.equal(stalePause.step.instance, 'work');
  assert.equal(stalePause.progress.kind, 'none');
});

test('saved terminal time is fixed independently of another current run or later unrelated history', () => {
  for (const state of ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'] as const) {
    const events = [
      ...started(),
      event(4, 'state', '', { state }, 20),
      event(5, 'log', '', { message: '后续检查' }, 50),
    ];
    const source = input({
      run: run({ state, updatedAt: time(50) }),
      events,
      execution: active('other-run'),
    });
    const first = presentRun(source, at(60));
    assert.equal(first.elapsed.kind, 'final');
    assert.equal(first.elapsed.milliseconds, 10000);
    assert.equal(first.step.kind, 'last');
    assert.deepEqual(presentRun(source, at(100)).elapsed, first.elapsed);
    assert.equal(first.progress.kind, 'none');
  }
});

test('restart recovery timestamp is not actual execution end and missing terminal events remain uncertain', () => {
  const events = [
    ...started(),
    event(4, 'log', 'work', { message: '最后记录' }, 15),
    event(5, 'state', '', { state: 'INTERRUPTED', reason: 'host-restarted' }, 3600),
  ];
  const recovered = presentRun(
    input({
      run: run({ state: 'INTERRUPTED', updatedAt: time(3600) }),
      events,
      execution: { observedAt: time(3700), active: null },
    }),
    at(4000),
  );
  assert.equal(recovered.elapsed.kind, 'recorded');
  assert.equal(recovered.elapsed.milliseconds, 5000);
  assert.match(recovered.elapsed.note, /实际结束时间和最终结果待核对/);
  assert.equal(recovered.step.kind, 'last');
  const missing = presentRun(
    input({ run: run({ state: 'SUCCEEDED', updatedAt: time(300) }), events: started() }),
    at(400),
  );
  assert.equal(missing.elapsed.kind, 'recorded');
  assert.equal(missing.elapsed.milliseconds, 1000);
});

test('missing or backwards times are never substituted with queue time or negative elapsed', () => {
  for (const source of [
    input({ events: [] }),
    input({ events: [event(1, 'state', '', { state: 'QUEUED' }, 0)] }),
    input({
      events: started().map((item) => (item.sequence === 2 ? { ...item, time: '' } : item)),
    }),
    input({ events: [...started(), event(4, 'log', '', {}, 5)] }),
    input({ events: [...started(), { ...event(4, 'log', '', {}), time: 'not-a-date' }] }),
    input({
      run: run({ state: 'SUCCEEDED' }),
      events: [...started(), event(4, 'state', '', { state: 'SUCCEEDED' }, 5)],
    }),
  ]) {
    const result = presentRun(source, at(100));
    assert.equal(result.elapsed.kind, 'unknown');
    assert.equal(result.elapsed.milliseconds, null);
  }
  assert.equal(presentRun(input(), at(5)).elapsed.kind, 'unknown');
  assert.equal(presentRun(input(), NaN).elapsed.kind, 'unknown');
  assert.equal(formatRunDuration(-1), '时长不可确定');
  assert.equal(formatRunDuration(Infinity), '时长不可确定');
  assert.equal(formatRunDuration(0), '0秒');
  assert.equal(formatRunDuration(62000), '1分 2秒');
  assert.equal(formatRunDuration(3661000), '1小时 1分 1秒');
});

test('old missing snapshots or invalid instance paths cannot invent a name from another snapshot branch', () => {
  assert.equal(presentRun(input({ snapshot: undefined }), at(20)).step.name, undefined);
  assert.match(presentRun(input({ snapshot: undefined }), at(20)).step.label, /名称未记录/);
  const invalid = presentRun(
    input({
      events: [
        ...started().slice(0, 2),
        event(3, 'node-start', 'missing/work', { type: 'script' }),
      ],
    }),
    at(20),
  );
  assert.equal(invalid.step.name, undefined);
  assert.equal(invalid.step.nodeId, 'work');
  const empty = presentRun(input({ events: [] }), at(20));
  assert.equal(empty.step.kind, 'pending');
  assert.equal(empty.step.instance, undefined);
});

test('ordinary saved outputs preserve all empty values; bounded preview expands to exact saved JSON without modifying output', () => {
  for (const output of [null, false, 0, '', {}, []] satisfies Json[]) {
    const view = presentRun(input({ run: run({ state: 'SUCCEEDED' }), output }), at(20));
    assert.equal(view.output.available, true);
    assert.equal(view.output.full, JSON.stringify(output, null, 2));
    assert.equal(view.output.preview, view.output.full);
    assert.equal(view.output.truncated, false);
    assert.deepEqual(JSON.parse(view.output.full), output);
  }
  assert.equal(presentRun(input(), at(20)).output.available, false);
  const output = {
    receipts: Array.from({ length: 500 }, (_, index) => ({
      index,
      result: 'fictional receipt',
      secret: '[REDACTED]',
    })),
  };
  const before = structuredClone(output);
  const view = presentRun(input({ run: run({ state: 'SUCCEEDED' }), output }), at(20));
  assert.equal(view.output.truncated, true);
  assert.equal(view.output.preview.length, 8192);
  assert.equal(view.output.characters, view.output.full.length);
  assert.ok(view.output.characters > view.output.preview.length);
  assert.equal(view.output.preview, view.output.full.slice(0, 8192));
  assert.deepEqual(JSON.parse(view.output.full), output);
  assert.deepEqual(output, before);
});
