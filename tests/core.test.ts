import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/core/engine';
import { validateFlow, validateObject } from '../src/core/validate';
import example from '../contracts/example.flow.json';
import { Store } from '../src/host/store';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { packageFlow, instantiate, validateTemplate } from '../src/templates/flow';
import { validateIPC } from '../src/shared/ipc';
const flow = (steps: any[]) => validateFlow({ ...example, steps });
async function run(f: any) {
  const events: any[] = [];
  const output = await execute(
    f,
    {},
    {
      signal: new AbortController().signal,
      boundary: async () => {},
      emit: async (...e) => {
        events.push(e);
      },
      perform: async () => null,
      human: async () => true,
    },
  );
  return { events, output };
}
test('schema validates published example and rejects unknown versions', () => {
  validateFlow(example);
  assert.throws(() => validateFlow({ ...example, formatVersion: '2.0' }));
  assert.throws(() => validateFlow({ ...example, unknown: 1 }));
});
test('ordered output references and assertions execute', async () => {
  const { output } = await run(validateFlow(example));
  assert.equal(output.verify.verified, true);
});
test('branch merge and serial loop scope, false branch, empty arrays', async () => {
  const f = flow([
    {
      id: 'choose',
      type: 'condition',
      version: 1,
      actual: false,
      operator: 'equals',
      expected: true,
      then: [{ id: 'yes', type: 'value', version: 1, value: 'wrong' }],
      else: [{ id: 'no', type: 'value', version: 1, value: 'right' }],
    },
    {
      id: 'each',
      type: 'loop',
      version: 1,
      items: [2, 4],
      body: [
        {
          id: 'itemResult',
          type: 'value',
          version: 1,
          value: { $ref: 'item' },
        },
      ],
    },
    { id: 'empty', type: 'loop', version: 1, items: [], body: [] },
  ]);
  const { output, events } = await run(f);
  assert.deepEqual(output, {
    choose: { no: 'right' },
    each: [{ itemResult: 2 }, { itemResult: 4 }],
    empty: [],
  });
  assert.ok(events.some((e) => e[1] === 'each[1]/itemResult'));
  assert.ok(!events.some((e) => e[1] === 'choose/yes'));
});
test('forward references, loop leaks and prototype references are blocked before run', () => {
  for (const ref of ['steps.future.x', 'item', 'params.__proto__.x'])
    assert.throws(() => flow([{ id: 'x', type: 'value', version: 1, value: { $ref: ref } }]));
  assert.throws(() =>
    flow([
      {
        id: 'l',
        type: 'loop',
        version: 1,
        items: [],
        body: [{ id: 'inner', type: 'value', version: 1, value: 1 }],
      },
      { id: 'leak', type: 'value', version: 1, value: { $ref: 'steps.inner' } },
    ]),
  );
});
test('cancellation at boundaries cannot execute next step', async () => {
  const abort = new AbortController();
  const f = flow([
    { id: 'a', type: 'value', version: 1, value: 1 },
    { id: 'b', type: 'value', version: 1, value: 2 },
  ]);
  const started: string[] = [];
  await assert.rejects(() =>
    execute(
      f,
      {},
      {
        signal: abort.signal,
        boundary: async () => {},
        emit: async (t, i) => {
          if (t === 'node-start') started.push(i);
          if (t === 'node-end') abort.abort();
        },
        perform: async () => null,
        human: async () => true,
      },
    ),
  );
  assert.deepEqual(started, ['a']);
});
test('templates create isolated drafts and tampering is rejected', () => {
  const a = instantiate(packageFlow(example as any, 'fixture')),
    b = instantiate(packageFlow(example as any, 'fixture'));
  a.name = 'changed';
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.name, b.name);
  assert.equal(b.sourceTemplate?.id, example.id);
  assert.throws(() =>
    validateTemplate({
      ...packageFlow(example as any, 'fixture'),
      flow: { ...example, name: 'tampered' },
    }),
  );
});
test('IPC refuses arbitrary methods, keys and invalid schedule interval', () => {
  assert.throws(() => validateIPC('shell.exec', { command: 'whoami' }));
  assert.throws(() => validateIPC('system.suspend', {}));
  assert.throws(() => validateIPC('browser.embedded.binding', {}));
  assert.throws(() => validateIPC('browser.embedded.perform', { command: {} }));
  assert.throws(() => validateIPC('system.browserLost', {}));
  assert.throws(() => validateIPC('browser.embedded.navigate', { url: 'file:///etc/passwd' }));
  assert.throws(() =>
    validateIPC('browser.embedded.viewport', { x: -1, y: 0, width: 400, height: 400 }),
  );
  assert.throws(() => validateIPC('browser.embedded.enable', { executable: '/tmp/program' }));
  assert.throws(() =>
    validateIPC('browser.embedded.visibility', { visible: true, url: 'file:///etc/passwd' }),
  );
  assert.deepEqual(validateIPC('browser.embedded.visibility', { visible: false }), {
    visible: false,
  });
  assert.throws(() => validateIPC('credentials.get', { id: 'openai-codex' }));
  assert.throws(() => validateIPC('flow.run', { id: 'a', extra: true }));
  assert.throws(() =>
    validateIPC('schedule.save', {
      flowId: 'a',
      intervalMinutes: 0,
      timezone: 'UTC',
    }),
  );
});
test('encrypted SQLite, immutable versions and interrupted recovery without replay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flowark-db-'));
  const path = join(dir, 'test.sqlite');
  const key = randomBytes(32);
  const s = new Store(path, Buffer.from(key));
  s.put('flow', 'f', { secret: 'private-fact-wechat-value' });
  s.put('run', 'r', { id: 'r', state: 'RUNNING' });
  s.put('template-effect', 'a', { id: 'a', state: 'submitting' });
  s.recover();
  assert.equal(s.get('run', 'r').state, 'INTERRUPTED');
  assert.equal(s.get('template-effect', 'a').state, 'unknown');
  assert.equal(s.list('attention').length, 1);
  s.close();
  assert.ok(!(await readFile(path)).includes(Buffer.from('private-fact-wechat-value')));
  const reopened = new Store(path, Buffer.from(key));
  assert.equal(reopened.get('flow', 'f').secret, 'private-fact-wechat-value');
  reopened.close();
  assert.throws(() => new Store(path, randomBytes(32)).get('flow', 'f'));
});
