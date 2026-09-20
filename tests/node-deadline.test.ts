import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { execute, type Execution } from '../src/core/engine';
import { NodeDeadline } from '../src/core/node-deadline';
import { RunControl } from '../src/core/run-control';
import type { Flow, Step } from '../src/shared/types';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function busy(ms: number) {
  const until = performance.now() + ms;
  while (performance.now() < until) {}
}
const flow = (steps: Step[]): Flow => ({
  id: 'deadlines',
  formatVersion: '1.0',
  name: '虚构期限验证',
  description: '',
  parameters: {},
  requiredCapabilities: [],
  steps,
});
const human = (id = 'wait', timeoutMs?: number): Step => ({
  id,
  type: 'human',
  version: 1,
  message: 'fixture',
  ...(timeoutMs ? { timeoutMs } : {}),
});
const operation = (id = 'work', timeoutMs?: number): Step => ({
  id,
  type: 'http',
  version: 1,
  method: 'GET',
  url: 'http://127.0.0.1/unused',
  headers: {},
  body: null,
  ...(timeoutMs ? { timeoutMs } : {}),
});
const branch = (body: Step[], timeoutMs?: number): Step => ({
  id: 'branch',
  type: 'condition',
  version: 1,
  actual: true,
  operator: 'equals',
  expected: true,
  then: body,
  else: [],
  ...(timeoutMs ? { timeoutMs } : {}),
});
const never: Step = { id: 'never', type: 'value', version: 1, value: 'must-not-run' };
function fixture(overrides: Partial<Execution> = {}) {
  const abort = new AbortController();
  const events: { type: string; instance: string }[] = [];
  const ctx: Execution = {
    signal: abort.signal,
    boundary: async () => {},
    emit: async (type, instance) => {
      events.push({ type, instance });
    },
    human: async () => ({ confirmed: true }),
    perform: async () => null,
    ...overrides,
  };
  return { abort, events, ctx };
}

test('explicit human timeout stops a delayed continuation and leaves no successful or later node', async () => {
  let returned = false;
  let signal!: AbortSignal;
  const f = fixture({
    human: async (_message, current) => {
      signal = current;
      await delay(230);
      returned = true;
      return true;
    },
  });
  await assert.rejects(execute(flow([human('wait', 100), never]), {}, f.ctx), /wait（100 毫秒）/);
  assert.equal(signal.aborted, true);
  await delay(170);
  assert.equal(returned, true, 'exercise the continuation after the race has rejected');
  assert.deepEqual(f.events, [{ type: 'node-start', instance: 'wait' }]);
  assert.equal(getEventListeners(f.abort.signal, 'abort').length, 0);
});

test('unconfigured human and containers retain unlimited waiting rather than a new default', async () => {
  const f = fixture({
    human: async () => {
      await delay(160);
      return 'confirmed';
    },
  });
  const output = await execute(flow([branch([human()])]), {}, f.ctx);
  assert.equal(output.branch.wait, 'confirmed');
  assert.ok(f.events.some((event) => event.type === 'node-end' && event.instance === 'branch'));
});

test('completed node is not retroactively timed out by a slow node-end acknowledgement', async () => {
  const f = fixture();
  const record = f.ctx.emit;
  f.ctx.emit = async (type, instance, data) => {
    await record(type, instance, data);
    if (type === 'node-end') await delay(170);
  };
  const output = await execute(
    flow([{ id: 'value', type: 'value', version: 1, timeoutMs: 100, value: true }]),
    {},
    f.ctx,
  );
  assert.equal(output.value, true);
  assert.deepEqual(f.events, [
    { type: 'node-start', instance: 'value' },
    { type: 'node-end', instance: 'value' },
  ]);
});

test('parent still covers child event persistence without declaring the parent complete', async () => {
  const f = fixture();
  const record = f.ctx.emit;
  f.ctx.emit = async (type, instance, data) => {
    await record(type, instance, data);
    if (type === 'node-end') await delay(170);
  };
  await assert.rejects(
    execute(
      flow([
        branch([{ id: 'value', type: 'value', version: 1, timeoutMs: 100, value: true }], 100),
        never,
      ]),
      {},
      f.ctx,
    ),
    /branch（100 毫秒）/,
  );
  await delay(100);
  assert.deepEqual(f.events, [
    { type: 'node-start', instance: 'branch' },
    { type: 'node-start', instance: 'branch/value' },
    { type: 'node-end', instance: 'branch/value' },
  ]);
});

test('loop budget includes all iterations and ignores late child completion', async () => {
  const calls: string[] = [];
  const f = fixture({
    perform: async (_node, _value, instance) => {
      calls.push(instance);
      await delay(250);
      return true;
    },
  });
  const loop: Step = {
    id: 'loop',
    type: 'loop',
    version: 1,
    items: [1, 2, 3],
    timeoutMs: 400,
    body: [operation('work', 1000)],
  };
  await assert.rejects(execute(flow([loop, never]), {}, f.ctx), /loop（400 毫秒）/);
  await delay(180);
  assert.deepEqual(calls, ['loop[0]/work', 'loop[1]/work']);
  assert.deepEqual(
    f.events.filter((event) => event.type === 'node-end'),
    [{ type: 'node-end', instance: 'loop[0]/work' }],
  );
  assert.ok(!f.events.some((event) => event.instance === 'never'));
});

test('earliest ancestor or child deadline owns the error even when synchronous work blocks all timers', async () => {
  for (const [parent, child, expected] of [
    [100, 200, /节点超时：branch（100 毫秒）/],
    [200, 100, /节点超时：branch\/work（100 毫秒）/],
  ] as const) {
    const f = fixture({
      perform: async () => {
        busy(260);
        return true;
      },
    });
    await assert.rejects(
      execute(flow([branch([operation('work', child)], parent), never]), {}, f.ctx),
      expected,
    );
    assert.ok(!f.events.some((event) => event.type === 'node-end' || event.instance === 'never'));
    assert.equal(getEventListeners(f.abort.signal, 'abort').length, 0);
  }
});

test('value and assertion CPU work is checked after returning, without claiming hard realtime', async () => {
  for (const type of ['value', 'assert'] as const) {
    const node: Step =
      type === 'value'
        ? { id: 'cpu', type, version: 1, timeoutMs: 100, value: 1 }
        : {
            id: 'cpu',
            type,
            version: 1,
            timeoutMs: 100,
            actual: 1,
            operator: 'equals',
            expected: 1,
          };
    // A getter only injects deterministic CPU cost into value resolution in this core test.
    // Imported JSON never contains executable getters.
    Object.defineProperty(node, type === 'value' ? 'value' : 'actual', {
      enumerable: true,
      get: () => {
        busy(130);
        return 1;
      },
    });
    const f = fixture();
    await assert.rejects(execute(flow([node, never]), {}, f.ctx), /cpu（100 毫秒）/);
    assert.deepEqual(f.events, [{ type: 'node-start', instance: 'cpu' }]);
  }
});

test('node budget starts after its own debug gate and persisted node-start', async () => {
  const abort = new AbortController();
  const states: string[] = [];
  const gate = new RunControl(true, abort.signal, async (state) => {
    states.push(state);
  });
  const events: string[] = [];
  const execution = execute(
    flow([human('wait', 100)]),
    {},
    {
      signal: abort.signal,
      boundary: (instance, node, signal) =>
        gate.boundary({ nodeInstance: instance, nodeName: node.id }, signal),
      emit: async (type) => {
        if (type === 'node-start') await delay(130);
        events.push(type);
      },
      human: (_message, signal) => gate.human('fixture', signal),
      perform: async () => null,
    },
  );
  const result = execution.then(
    () => undefined,
    (error) => error,
  );
  await delay(160);
  assert.deepEqual(states, ['PAUSED']);
  assert.deepEqual(events, []);
  gate.control('step');
  const error = await result;
  assert.match(String(error), /wait（100 毫秒）/);
  assert.deepEqual(events, ['node-start']);
  assert.deepEqual(states, ['PAUSED', 'RUNNING', 'WAITING_INPUT']);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('parent budget expires during the next debug gate and never starts that child', async () => {
  const abort = new AbortController();
  const states: string[] = [];
  const gate = new RunControl(true, abort.signal, async (state) => {
    states.push(state);
    if (states.length === 1) gate.control('step');
  });
  const f = fixture({
    signal: abort.signal,
    boundary: (instance, node, signal) =>
      gate.boundary({ nodeInstance: instance, nodeName: node.id }, signal),
  });
  await assert.rejects(execute(flow([branch([never], 100)]), {}, f.ctx), /branch（100 毫秒）/);
  assert.deepEqual(states, ['PAUSED', 'RUNNING', 'PAUSED']);
  assert.deepEqual(f.events, [{ type: 'node-start', instance: 'branch' }]);
  gate.control('resume');
  await delay(20);
  assert.equal(states.length, 3, 'expired waiter must not publish RUNNING later');
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('external cancellation is retained when it and a synchronous timeout have both occurred', async () => {
  const f = fixture();
  f.ctx.perform = async () => {
    busy(130);
    f.abort.abort(new Error('explicit cancellation'));
    return true;
  };
  await assert.rejects(
    execute(flow([operation('work', 100), never]), {}, f.ctx),
    /explicit cancellation/,
  );
  assert.ok(!f.events.some((event) => event.type === 'node-end' || event.instance === 'never'));
});

test('deadline disposal clears completed timers and parent listeners', async () => {
  const abort = new AbortController();
  const root = new NodeDeadline(abort.signal);
  const scopes: NodeDeadline[] = [];
  try {
    for (let i = 0; i < 100; i++) {
      const scope = new NodeDeadline(root, 'completed', 100);
      scopes.push(scope);
      assert.equal(await scope.run(() => true), true);
      scope.dispose();
      assert.equal(getEventListeners(root.signal, 'abort').length, 0);
      assert.equal(getEventListeners(scope.signal, 'abort').length, 0);
    }
    await delay(130);
    assert.ok(scopes.every((scope) => !scope.signal.aborted));
  } finally {
    root.dispose();
  }
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});

test('control wait cancellation cleans up even while publishing its state is still pending', async () => {
  const abort = new AbortController();
  const node = new AbortController();
  const states: string[] = [];
  let finish!: () => void;
  const publishing = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const gate = new RunControl(false, abort.signal, async (state) => {
    states.push(state);
    if (state === 'WAITING_INPUT') await publishing;
  });
  const result = gate.human('fixture', node.signal);
  node.abort(new Error('fixture deadline'));
  await assert.rejects(result, /fixture deadline/);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  assert.equal(getEventListeners(node.signal, 'abort').length, 0);
  finish();
  gate.control('resume');
  await delay(20);
  assert.deepEqual(states, ['WAITING_INPUT']);
});

test('control cancellation also releases listeners while publishing RUNNING is pending', async () => {
  const abort = new AbortController();
  const node = new AbortController();
  let ready!: () => void;
  const publishingRunning = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let finish!: () => void;
  const acknowledgement = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const states: string[] = [];
  const gate = new RunControl(false, abort.signal, async (state) => {
    states.push(state);
    if (state === 'WAITING_INPUT') gate.control('resume');
    if (state === 'RUNNING') {
      ready();
      await acknowledgement;
    }
  });
  const result = gate.human('fixture', node.signal);
  await publishingRunning;
  node.abort(new Error('expired during RUNNING publication'));
  await assert.rejects(result, /expired during RUNNING publication/);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  assert.equal(getEventListeners(node.signal, 'abort').length, 0);
  finish();
  gate.control('resume');
  await delay(20);
  assert.deepEqual(states, ['WAITING_INPUT', 'RUNNING']);
});
