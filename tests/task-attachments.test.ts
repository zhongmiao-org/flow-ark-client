import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/host/store';
import { Planning } from '../src/host/planning';
import { TaskAttachments } from '../src/host/task-attachments';
import { imageInfo } from '../src/host/attachment-file';
import { validateIPC } from '../src/shared/ipc';
import { ATTACHMENT_PREFIX, type PlanningImageV1 } from '../src/shared/task-attachments';
import type { PlanningInput, PlanningResult, TaskDetail } from '../src/shared/planning';
import { generatePlan } from '../src/ai/planning';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=';
const identity = (d: TaskDetail) => ({ id: d.task.id, revision: d.task.revision });
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const result = (input: PlanningInput): PlanningResult => ({
  formatVersion: '1.0',
  kind: 'clarify',
  summary: '请核对',
  questions: [{ id: 'q', prompt: '保存在哪里？', options: [] }],
  limitations: [],
  flow: null,
});
async function wait(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(check());
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowark-attachments-'));
  const text = join(root, '资料.txt'),
    picture = join(root, '截图.png');
  await writeFile(text, '明确选择的文本\n第二行');
  await writeFile(picture, Buffer.from(png, 'base64'));
  const key = randomBytes(32);
  let store = new Store(join(root, 'store.sqlite'), Buffer.from(key));
  const native = {
    choose: async (_kind: 'file' | 'image'): Promise<string | null> => text,
    decodeImage: async (_data: string) => true,
  };
  let attachments = new TaskAttachments(store, native);
  const received: { input: PlanningInput; images: PlanningImageV1[] }[] = [];
  const deps = {
    attachments,
    key: async () => 'fictional-secret',
    assertAvailable() {
      if (store.fault) throw new Error(store.fault);
    },
    generate: (async (input, _p, _m, _k, _s, _f, images = []) => {
      received.push({ input, images });
      return result(input);
    }) as typeof generatePlan,
    save: () => {
      throw new Error('test does not adopt');
    },
  };
  let planning = new Planning(store, deps);
  const call = (method: string, args: unknown = {}): Promise<any> => planning.request(method, args);
  let d: TaskDetail = await call('task.create');
  d = await call('task.save', {
    ...identity(d),
    description: '理解已选资料',
    context: [],
    answers: {},
  });
  t.after(async () => {
    planning.cancelAll();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    text,
    picture,
    native,
    deps,
    received,
    d,
    call,
    get store() {
      return store;
    },
    get planning() {
      return planning;
    },
    choose: (d: TaskDetail, kind = 'file'): Promise<TaskDetail> =>
      call('task.attachment.choose', { ...identity(d), kind }),
    async generate(d: TaskDetail) {
      await call('task.generate', {
        ...identity(d),
        provider: 'deepseek',
        model: 'fixture',
        reviewed: true,
      });
      await wait(() => planning.detail(d.task.id).task.status !== 'generating');
      return planning.detail(d.task.id);
    },
    reopen() {
      store.close();
      store = new Store(join(root, 'store.sqlite'), Buffer.from(key));
      attachments = new TaskAttachments(store, native);
      deps.attachments = attachments;
      planning = new Planning(store, deps);
    },
  };
}

test('attachment IPC cannot inject file paths, bytes or reserved model sources', () => {
  const args = { id: 'task', revision: 1, kind: 'image' };
  assert.deepEqual(validateIPC('task.attachment.choose', args), args);
  for (const extra of [
    { path: '/private/unselected' },
    { data: png },
    { mimeType: 'image/png' },
    { kind: 'screen' },
  ])
    assert.throws(() => validateIPC('task.attachment.choose', { ...args, ...extra }));
  assert.throws(() => validateIPC('task.attachment.file', { kind: 'file' }));
  assert.throws(() => validateIPC('task.attachment.image.validate', { data: png }));
  assert.throws(() =>
    validateIPC('task.save', {
      id: 'task',
      revision: 1,
      description: '',
      context: [{ id: ATTACHMENT_PREFIX + 'fake', label: 'fake', kind: 'image', text: '' }],
      answers: {},
    }),
  );
});

test('cancel writes nothing; imported content remains a verified encrypted copy after source changes and reopen', async (t) => {
  const f = await fixture(t);
  f.native.choose = async () => null;
  assert.deepEqual(await f.choose(f.d), f.d);
  assert.equal(f.store.list('task-attachment').length, 0);
  f.native.choose = async () => f.text;
  const d = await f.choose(f.d),
    a = d.task.attachments![0];
  assert.equal(d.task.revision, f.d.task.revision + 1);
  assert.ok(!JSON.stringify(d).includes(f.root));
  assert.ok(!JSON.stringify(d).includes('第二行'));
  await writeFile(f.text, 'changed');
  f.reopen();
  const preview = await f.call('task.attachment.preview', { ...identity(d), attachmentId: a.id });
  assert.equal(preview.text, '明确选择的文本\n第二行');
  await rm(f.text);
  await f.generate(d);
  assert.equal(f.received[0].input.context![0]!.text, preview.text);
  assert.equal(f.received[0].input.context![0]!.kind, 'file');
  assert.ok(!JSON.stringify(f.received).includes(f.root));
  const bytes = await readFile(join(f.root, 'store.sqlite'));
  assert.ok(!bytes.includes(Buffer.from('第二行')));
});

test('selected images use real bytes, native decoding and independent metadata, not base64 in text JSON', async (t) => {
  const f = await fixture(t);
  f.native.choose = async () => f.picture;
  let calls = 0;
  f.native.decodeImage = async (data) => {
    calls++;
    assert.equal(data, png);
    return true;
  };
  const d = await f.choose(f.d, 'image');
  assert.equal(calls, 1);
  assert.equal(d.task.attachments![0].width, 1);
  await f.generate(d);
  assert.equal(f.received[0].images[0].data, png);
  assert.ok(!JSON.stringify(f.received[0].input).includes(png));
  assert.equal(f.received[0].input.context![0]!.kind, 'image');
  f.native.decodeImage = async () => false;
  await assert.rejects(f.choose(f.planning.detail(d.task.id), 'image'), /解码/);
  assert.equal(f.store.list('task-attachment').length, 1);
});

test('unsafe, unsupported, oversized and invalid content cannot become selected attachments', async (t) => {
  const f = await fixture(t);
  const link = join(f.root, 'link.txt');
  await symlink(f.text, link);
  const dir = join(f.root, 'directory.txt');
  await mkdir(dir);
  for (const path of [link, dir, join(f.root, 'missing.txt')]) {
    f.native.choose = async () => path;
    await assert.rejects(f.choose(f.d));
  }
  for (const [name, bytes] of [
    ['invalid.txt', Buffer.from([0xff, 0xfe])],
    ['binary.txt', Buffer.from([0])],
    ['large.txt', Buffer.alloc(200 * 1024 + 1, 97)],
    ['length.txt', Buffer.alloc(50001, 97)],
    ['fake.png', Buffer.from('not png')],
    ['other.pdf', Buffer.from('document')],
  ] as const) {
    const path = join(f.root, name);
    await writeFile(path, bytes);
    f.native.choose = async () => path;
    await assert.rejects(f.choose(f.d));
  }
  const bomb = Buffer.from(png, 'base64');
  bomb.writeUInt32BE(65535, 16);
  assert.throws(() => imageInfo(bomb), /尺寸/);
  assert.equal(f.store.list('task-attachment').length, 0);
  assert.deepEqual(f.planning.detail(f.d.task.id), f.d);
});

test('late picker replies lose CAS after editing, cancellation and simultaneous imports', async (t) => {
  const f = await fixture(t);
  for (const action of ['save', 'cancel', 'all']) {
    const gate = deferred<string | null>();
    f.native.choose = () => gate.promise;
    const d = f.planning.detail(f.d.task.id),
      pending = f.choose(d);
    if (action === 'save')
      await f.call('task.save', {
        ...identity(d),
        description: 'changed',
        context: [],
        answers: {},
      });
    else if (action === 'cancel') await f.call('task.cancel', { id: d.task.id });
    else f.planning.cancelAll();
    gate.resolve(f.text);
    await assert.rejects(pending, /变化|取消/);
  }
  f.native.choose = async () => f.text;
  const d = f.planning.detail(f.d.task.id);
  const settled = await Promise.allSettled([f.choose(d), f.choose(d)]);
  assert.equal(settled.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(f.store.list('task-attachment').length, 1);
});

test('failed task persistence rolls back attachment insertion; task ownership and tamper checks remain enforceable', async (t) => {
  const f = await fixture(t);
  const original = f.store.put.bind(f.store);
  f.store.put = (kind, id, value) => {
    if (kind === 'ai-task') throw new Error('fixture write failure');
    original(kind, id, value);
  };
  await assert.rejects(f.choose(f.d), /fixture write/);
  assert.equal(f.store.list('task-attachment').length, 0);
  f.store.put = original;
  const d = await f.choose(f.d),
    a = d.task.attachments![0];
  const other: TaskDetail = await f.call('task.create');
  for (const method of ['task.attachment.preview', 'task.attachment.remove'])
    await assert.rejects(f.call(method, { ...identity(other), attachmentId: a.id }), /属于|不存在/);
  const record = f.store.get<any>('task-attachment', a.id);
  original('task-attachment', a.id, { ...record, body: 'tampered' });
  await assert.rejects(
    f.call('task.attachment.preview', { ...identity(d), attachmentId: a.id }),
    /完整性/,
  );
  await assert.rejects(f.generate(d), /完整性/);
  const cleared: TaskDetail = await f.call('task.attachment.remove', {
    ...identity(d),
    attachmentId: a.id,
  });
  assert.equal(cleared.task.attachments!.length, 0);
  assert.equal(await readFile(f.text, 'utf8'), '明确选择的文本\n第二行');
});

test('attachment budgets include all selected context and removing a file aborts a pending model result', async (t) => {
  const f = await fixture(t);
  const full: TaskDetail = await f.call('task.save', {
    ...identity(f.d),
    description: 'full',
    answers: {},
    context: Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      kind: 'text',
      label: 'text',
      text: '',
    })),
  });
  await assert.rejects(f.choose(full), /20/);
  let d: TaskDetail = await f.call('task.save', {
    ...identity(full),
    description: 'images',
    context: [],
    answers: {},
  });
  f.native.choose = async () => f.picture;
  for (let i = 0; i < 4; i++) d = await f.choose(d, 'image');
  await assert.rejects(f.choose(d, 'image'), /四张/);
  const gate = deferred<PlanningResult>();
  let signal: AbortSignal | undefined;
  f.deps.generate = async (_i, _p, _m, _k, s) => {
    signal = s;
    return gate.promise;
  };
  await f.call('task.generate', {
    ...identity(d),
    provider: 'deepseek',
    model: 'fixture',
    reviewed: true,
  });
  await wait(() => !!signal);
  d = await f.call('task.attachment.remove', {
    ...identity(d),
    attachmentId: d.task.attachments![0].id,
  });
  assert.equal(signal!.aborted, true);
  gate.resolve(result({} as PlanningInput));
  await new Promise((r) => setImmediate(r));
  assert.equal(f.planning.detail(d.task.id).task.status, 'draft');
  assert.equal(f.planning.detail(d.task.id).proposal, undefined);
});

test('both provider protocols contain matching real image blocks and retain structured output and cancellation', async () => {
  const example = JSON.parse(await readFile('contracts/example.planning.json', 'utf8'));
  for (const provider of ['deepseek', 'openai-codex'] as const) {
    const abort = new AbortController();
    const fake = (async (_url: any, options: any) => {
      const body = JSON.parse(options.body);
      const parts = provider === 'deepseek' ? body.messages[1].content : body.input[0].content;
      assert.equal(parts.length, 3);
      assert.ok(parts[0].text.includes(example.request.description));
      assert.equal(
        provider === 'deepseek' ? parts[2].image_url.url : parts[2].image_url,
        `data:image/png;base64,${png}`,
      );
      if (provider === 'openai-codex') {
        assert.equal(body.store, false);
        assert.equal(body.text.format.type, 'json_schema');
      }
      assert.equal(options.signal.aborted, false);
      const content = JSON.stringify({ resultJson: JSON.stringify(example.result) });
      return new Response(
        JSON.stringify(
          provider === 'deepseek'
            ? { choices: [{ finish_reason: 'stop', message: { content } }] }
            : {
                status: 'completed',
                output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }],
              },
        ),
      );
    }) as typeof fetch;
    assert.deepEqual(
      await generatePlan(example.request, provider, 'fixture', 'key', abort.signal, fake, [
        { id: 'image', name: '截图.png', mimeType: 'image/png', data: png, width: 1, height: 1 },
      ]),
      example.result,
    );
  }
});

test('an import completing after its deadline cannot write, and a new attachment cancels credential-waiting generation', async (t) => {
  const f = await fixture(t),
    clock = Date.now;
  const gate = deferred<string | null>();
  f.native.choose = () => gate.promise;
  const pending = f.choose(f.d);
  Date.now = () => clock() + 65000;
  try {
    gate.resolve(f.text);
    await assert.rejects(pending, /超时/);
  } finally {
    Date.now = clock;
  }
  assert.equal(f.store.list('task-attachment').length, 0);
  const key = deferred<string>();
  f.deps.key = () => key.promise;
  await f.call('task.generate', {
    ...identity(f.d),
    provider: 'deepseek',
    model: 'fixture',
    reviewed: true,
  });
  f.native.choose = async () => f.text;
  const d = await f.choose(f.planning.detail(f.d.task.id));
  key.resolve('fixture-key');
  await new Promise((r) => setImmediate(r));
  assert.equal(f.received.length, 0);
  assert.equal(d.task.status, 'draft');
});

test('combined text and binary budgets reject the additional copy without partial persistence', async (t) => {
  const f = await fixture(t);
  const large = Buffer.alloc(4 * 1024 * 1024);
  Buffer.from(png, 'base64').copy(large);
  await writeFile(f.picture, large);
  f.native.choose = async () => f.picture;
  let d = f.d;
  for (let i = 0; i < 3; i++) d = await f.choose(d, 'image');
  await assert.rejects(f.choose(d, 'image'), /12 MiB/);
  assert.equal(f.store.list('task-attachment').length, 3);
  const full = await f
    .call('task.save', {
      ...identity(d),
      description: 'text budget',
      context: Array.from({ length: 4 }, (_, i) => ({
        id: `text${i}`,
        kind: 'text',
        label: 'text',
        text: 'x'.repeat(49900),
      })),
      answers: {},
    })
    .catch((e: Error) => e);
  // Image metadata is counted with text; 200000 user characters alone must fail.
  await assert.rejects(
    f.call('task.save', {
      ...identity(d),
      description: 'text budget',
      context: Array.from({ length: 4 }, (_, i) => ({
        id: `text${i}`,
        kind: 'text',
        label: 'text',
        text: 'x'.repeat(50000),
      })),
      answers: {},
    }),
  );
  assert.ok(full instanceof Error, 'image metadata must consume the remaining text budget');
  assert.match(full.message, /文本上限/);
});
