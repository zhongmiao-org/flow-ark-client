import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/host/store';
import { Templates } from '../src/templates/service';
import { exportDefinition } from '../src/templates/export';
import { writeArchive } from '../src/templates/archive';
import { canonical, sha256, manifestDigest } from '../contracts/package-format';
import { validateIPC, type TemplateSave } from '../src/shared/ipc';
import { templateSaveRequest, acceptTemplateSave } from '../src/renderer/template-draft';
import type { FlowRecord } from '../src/shared/types';
async function fixture(t: TestContext, longNames = false, unsupportedEntry = false) {
  const dir = await mkdtemp(join(tmpdir(), 'template-editing-'));
  const store = new Store(join(dir, 'state.sqlite'), randomBytes(32));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const service = new Templates(store, dir, '0.3.0');
  const pkg = await exportDefinition(
    {
      id: 'fixture',
      name: 'Fixture',
      description: '',
      formatVersion: '1.0',
      parameters: { text: 'original' },
      requiredCapabilities: ['value'],
      steps: [{ id: 'read', type: 'value', version: 1, value: { $ref: 'params.text' } }],
    } as any,
    {
      schema: {
        type: 'object',
        properties: { shared: { type: 'string', default: 'original' } },
        required: ['shared'],
        additionalProperties: false,
      },
    },
  );
  if (longNames) pkg.manifest.name = 'T'.repeat(200);
  const first = pkg.manifest.entries[0];
  if (longNames) first.name = 'E'.repeat(200);
  pkg.files.set(
    first.inputSchema,
    Buffer.from(
      JSON.stringify({
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      }),
    ),
  );
  const flow = JSON.parse(pkg.files.get(first.flow)!.toString());
  flow.parameters = { text: 'original' };
  pkg.files.set(first.flow, Buffer.from(canonical(flow)));
  pkg.manifest.entries.push({ ...first, id: 'second', name: 'Second' });
  if (unsupportedEntry) {
    const second = pkg.manifest.entries[1];
    second.flow = 'flows/future.json';
    second.capabilities = ['value', 'future-capability'];
    pkg.files.set(
      second.flow,
      Buffer.from(canonical({ ...flow, requiredCapabilities: second.capabilities })),
    );
  }

  pkg.manifest.resources = [
    { id: 'output', name: 'Output', kind: 'directory', access: 'write', required: false },
  ];
  pkg.manifest.actions = [{ id: 'write', name: 'Write', description: 'fixture', default: 'deny' }];
  pkg.manifest.files = [...pkg.files]
    .filter(([p]) => p !== 'manifest.json')
    .map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) }));
  pkg.manifest.contentDigest = manifestDigest(pkg.manifest);
  pkg.files.set('manifest.json', Buffer.from(canonical(pkg.manifest)));
  const zip = join(dir, 'fixture.zip');
  await writeArchive(pkg, zip);
  const installed = await service.install((await service.library.inspect(zip)).token);
  const instance = await service.create(installed.key);
  const detail = await service.detail(instance.id);
  const request = templateSaveRequest(detail, detail, 'all');
  return { dir, store, service, pkg, instance, detail, request };
}
test('template.save is strict, requires a revision and complete fields, and removes unversioned IPC', async (t) => {
  const { request } = await fixture(t);
  assert.deepEqual(validateIPC('template.save', { ...request, name: '  Renamed  ' }), {
    ...request,
    name: 'Renamed',
  });
  for (const field of Object.keys(request)) {
    const bad: any = { ...request };
    delete bad[field];
    assert.throws(() => validateIPC('template.save', bad), field);
  }
  for (const extra of [
    { revision: 'old' },
    { name: ' ' },
    { name: 'x'.repeat(101) },
    { graph: {} },
    { apiKey: 'secret' },
    { inputs: { '': {} } },
    { resources: { output: { key: 'secret' } } },
    { grants: { write: 'yes' } },
  ])
    assert.throws(() => validateIPC('template.save', { ...request, ...extra }));
  for (const method of ['template.configure', 'template.input'])
    assert.throws(() => validateIPC(method, request), /白名单/);
});
test('one save renames all entry flows and atomically updates multiple inputs, preserving steps and other instances', async (t) => {
  const { service, store, instance, request } = await fixture(t);
  const other = await service.create(instance.packageKey);
  const otherBefore = await service.detail(other.id);
  const record = store.get<FlowRecord>('flow', instance.entryFlows.run)!;
  record.flow.steps.push({ id: 'local', type: 'value', version: 1, value: 'local edit' });
  store.put('flow', record.id, record);
  const baseline = await service.detail(instance.id);
  const saved = await service.save({
    ...request,
    revision: baseline.revision,
    name: 'Renamed',
    configuration: { shared: 'new shared' },
    resources: { output: { path: '/fixture/output' } },
    grants: { write: 'auto' },
    inputs: { run: { text: 'one' }, second: { text: 'two' } },
  });
  assert.notEqual(saved.revision, baseline.revision);
  assert.deepEqual(saved, await service.detail(instance.id));
  assert.deepEqual(
    saved.entries.map((e) => e.values),
    [{ text: 'one' }, { text: 'two' }],
  );
  for (const entry of saved.entries) {
    const current = store.get<FlowRecord>('flow', instance.entryFlows[entry.id])!;
    assert.equal(current.flow.name, 'Renamed · ' + entry.name);
    assert.deepEqual(current.bindings.configuration?.values, { shared: 'new shared' });
    assert.equal(current.bindings.grants?.write, 'auto');
  }
  assert.deepEqual(store.get<FlowRecord>('flow', record.id)!.flow.steps, record.flow.steps);
  assert.deepEqual(await service.detail(other.id), otherBefore);
  const next = await service.save({
    ...templateSaveRequest(saved, saved, 'configuration'),
    grants: {},
  });
  assert.equal(next.instance.grants.write, 'deny');
  assert.deepEqual(
    next.entries.map((e) => e.values),
    saved.entries.map((e) => e.values),
  );
  assert.equal(store.list('run').length, 0);
});
test('unknown declarations and invalid schema reject before any partial write', async (t) => {
  const { service, store, instance, request, detail } = await fixture(t);
  for (const patch of [
    { resources: { unknown: {} } },
    { resources: { output: { provider: 'deepseek' } } },
    { grants: { unknown: 'auto' } },
    { inputs: { missing: {} } },
    { inputs: { run: { text: 'valid first' }, second: { text: 3 } } },
    { configuration: { shared: 3 } },
  ]) {
    await assert.rejects(
      service.save({ ...request, name: 'Must not persist', ...patch } as TemplateSave),
    );
    assert.deepEqual(await service.detail(instance.id), detail);
    assert.equal(store.fault, undefined);
  }
});
test('old revisions compete once; losing or replayed requests cannot overwrite and queued arguments are copied', async (t) => {
  const { service, instance, request } = await fixture(t);
  const args = { ...request, configuration: { shared: 'winner' } };
  const first = service.save(args);
  args.configuration.shared = 'mutated by caller';
  const second = service.save({ ...request, configuration: { shared: 'loser' } });
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].status, 'rejected');
  assert.match(String((outcomes[1] as PromiseRejectedResult).reason), /实例已变化/);
  const current = await service.detail(instance.id);
  assert.equal(current.instance.configuration.shared, 'winner');
  await assert.rejects(service.save(request), /实例已变化/); // lost response must not silently replay
  assert.deepEqual(await service.detail(instance.id), current);
});
test('a competing editor write during package load is checked again inside the transaction', async (t) => {
  const { service, store, instance, request } = await fixture(t);
  const load = service.library.load.bind(service.library);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  service.library.load = async (key) => {
    const pkg = await load(key);
    entered();
    await gate;
    return pkg;
  };
  const saving = service.save({ ...request, name: 'Stale name' });
  await started;
  const record = store.get<FlowRecord>('flow', instance.entryFlows.second)!;
  record.flow.parameters = { text: 'editor saved while loading' };
  store.put('flow', record.id, record);
  release();
  await assert.rejects(saving, /实例已变化/);
  assert.equal(store.get('template-instance', instance.id).name, instance.name);
  assert.deepEqual(store.get<FlowRecord>('flow', record.id), record);
  service.library.load = async (key) => {
    const pkg = await load(key);
    const record = store.get<FlowRecord>('flow', instance.entryFlows.run)!;
    record.flow.parameters = { text: 'changed during detail load' };
    store.put('flow', record.id, record);
    return pkg;
  };
  const detail = await service.detail(instance.id);
  service.library.load = load;
  assert.deepEqual(detail, await service.detail(instance.id));
});
test('missing or replaced entry records are never implicitly recreated by a save', async (t) => {
  const { service, store, instance, request, detail } = await fixture(t);
  const id = instance.entryFlows.second;
  const record = store.get<FlowRecord>('flow', id)!;
  store.remove('flow', id);
  const missing = await service.detail(instance.id);
  assert.notEqual(missing.revision, detail.revision);
  await assert.rejects(
    service.save({ ...request, revision: missing.revision }),
    /原入口流程不存在/,
  );
  assert.equal(store.get('flow', id), undefined);
  record.bindings.template!.instanceId = 'someone-else';
  store.put('flow', id, record);
  await assert.rejects(
    service.save({ ...request, revision: (await service.detail(instance.id)).revision }),
    /来源已变化/,
  );
  assert.deepEqual(store.get('template-instance', instance.id), instance);
});
test('revision tracks actual graph and bindings but ignores events and historical snapshots', async (t) => {
  const { service, store, instance, detail } = await fixture(t);
  store.event('unrelated-run', 'test', '', {});
  store.put('snapshot', 'run', { fixture: true });
  store.put('version', 'version', { fixture: true });
  assert.equal((await service.detail(instance.id)).revision, detail.revision);
  let revision = detail.revision;
  for (const mutate of [
    (record: FlowRecord) => {
      record.flow.steps[0] = { id: 'read', type: 'value', version: 1, value: 'edited' };
    },
    (record: FlowRecord) => {
      record.bindings.files.other = '/local/other';
    },
    (record: FlowRecord) => {
      record.flow.name = 'Editor name';
    },
  ]) {
    const record = store.get<FlowRecord>('flow', instance.entryFlows.second)!;
    mutate(record);
    store.put('flow', record.id, record);
    const next = (await service.detail(instance.id)).revision;
    assert.notEqual(next, revision);
    revision = next;
  }
});
test('SQLite failure on the second flow rolls back the instance and first flow as well', async (t) => {
  const { service, store, instance, request, detail } = await fixture(t);
  const flows = store.list('flow');
  (store as any).db.exec(
    `CREATE TEMP TRIGGER fail_second BEFORE UPDATE ON documents WHEN NEW.kind = 'flow' AND NEW.id = '${instance.entryFlows.second}' BEGIN SELECT RAISE(FAIL, 'fixture second flow failure'); END;`,
  );
  await assert.rejects(
    service.save({
      ...request,
      name: 'Partial forbidden',
      configuration: { shared: 'changed' },
      inputs: { run: { text: 'one' }, second: { text: 'two' } },
    }),
    /fixture second flow failure/,
  );
  assert.deepEqual(await service.detail(instance.id), detail);
  assert.deepEqual(store.list('flow'), flows);
  assert.match(store.fault!, /存储写入失败/);
});
test('partial UI saves retain other drafts, save-all combines them and late typing survives the response', async (t) => {
  const { detail, service } = await fixture(t);
  const draft = structuredClone(detail);
  draft.instance.configuration = { shared: 'local config' };
  draft.entries[0].values = { text: 'local first' };
  draft.entries[1].values = { text: 'local second' };
  const inputRequest = templateSaveRequest(draft, detail, 'input', 'run');
  assert.deepEqual(inputRequest.configuration, detail.instance.configuration);
  assert.deepEqual(Object.keys(inputRequest.inputs), ['run']);
  const savedInput = await service.save(inputRequest);
  const afterInput = acceptTemplateSave(draft, draft, savedInput, inputRequest, 'input');
  assert.deepEqual(afterInput.instance.configuration, draft.instance.configuration);
  assert.deepEqual(afterInput.entries[1].values, draft.entries[1].values);
  const all = templateSaveRequest(afterInput, savedInput, 'all');
  assert.deepEqual(all.inputs, { second: { text: 'local second' } });
  assert.deepEqual(all.configuration, { shared: 'local config' });
  const savedAll = await service.save(all);
  const late = structuredClone(afterInput);
  late.entries[1].values = { text: 'typed while saving' };
  const accepted = acceptTemplateSave(late, afterInput, savedAll, all, 'all');
  assert.deepEqual(accepted.entries[1].values, late.entries[1].values);
  assert.equal(accepted.revision, savedAll.revision);
  assert.deepEqual(acceptTemplateSave(afterInput, afterInput, savedAll, all, 'all'), savedAll);
});

test('valid long package and entry labels remain usable within instance and flow name limits', async (t) => {
  const { service, store, instance, request } = await fixture(t, true);
  assert.equal(instance.name.length, 100);
  const saved = await service.save({ ...request, name: 'N'.repeat(100) });
  assert.equal(saved.instance.name.length, 100);
  assert.equal(store.get<FlowRecord>('flow', instance.entryFlows.run)!.flow.name.length, 200);
});

test('an unavailable independent entry does not block creation or configuration and input edits of an available entry', async (t) => {
  const { service, store, instance, request, detail } = await fixture(t, false, true);
  assert.deepEqual(detail.entries[1].unavailable, ['future-capability']);
  const saved = await service.save({
    ...request,
    configuration: { shared: 'changed' },
    inputs: { run: { text: 'usable input' } },
  });
  assert.deepEqual(saved.entries[0].values, { text: 'usable input' });
  assert.deepEqual(saved.entries[1].values, detail.entries[1].values);
  await service.preflight(store.get<FlowRecord>('flow', instance.entryFlows.run)!);
  await assert.rejects(
    service.preflight(store.get<FlowRecord>('flow', instance.entryFlows.second)!),
    /缺少能力/,
  );
});

test('configuration and authorization tabs save only their own fields; leave-all includes both and every changed input', async (t) => {
  const { service, detail } = await fixture(t);
  const draft = structuredClone(detail);
  draft.instance.name = 'Local name';
  draft.instance.configuration = { shared: 'local config' };
  draft.instance.resources = { output: { path: '/local/output' } };
  draft.instance.grants = { write: 'auto' };
  draft.entries[0].values = { text: 'local input' };
  const config = templateSaveRequest(draft, detail, 'configuration');
  assert.deepEqual(config.resources, {});
  assert.equal(config.grants.write, 'deny');
  const savedConfig = await service.save(config);
  const afterConfig = acceptTemplateSave(draft, draft, savedConfig, config, 'configuration');
  assert.equal(afterConfig.instance.grants.write, 'auto');
  assert.deepEqual(afterConfig.entries[0].values, draft.entries[0].values);
  afterConfig.instance.name = 'Still unsaved';
  const resource = templateSaveRequest(afterConfig, savedConfig, 'resources');
  assert.equal(resource.name, 'Local name');
  assert.deepEqual(resource.inputs, {});
  const savedResource = await service.save(resource);
  const afterResource = acceptTemplateSave(
    afterConfig,
    afterConfig,
    savedResource,
    resource,
    'resources',
  );
  assert.equal(afterResource.instance.name, 'Still unsaved');
  const all = templateSaveRequest(afterResource, savedResource, 'all');
  assert.equal(all.name, 'Still unsaved');
  assert.deepEqual(all.inputs, { run: { text: 'local input' } });
});

test('run and plan source IPC accepts only instance, entry and immutable revision', () => {
  const source = { instanceId: 'instance', entryId: 'run', revision: 'a'.repeat(64) };
  for (const [method, args] of [
    ['flow.run', { id: 'flow', debug: true }],
    ['schedule.save', { flowId: 'flow', intervalMinutes: 60, timezone: 'UTC' }],
  ] as const) {
    assert.deepEqual(validateIPC(method, { ...args, templateSource: source }), {
      ...args,
      templateSource: source,
    });
    for (const bad of [
      { ...source, revision: 'old' },
      { ...source, entryId: '' },
      { ...source, inputs: {} },
      { instanceId: 'instance', entryId: 'run' },
    ])
      assert.throws(() => validateIPC(method, { ...args, templateSource: bad }));
  }
});
test('template launch source binds exact current instance, entry and full revision', async (t) => {
  const { service, store, instance, detail, request } = await fixture(t);
  const source = { instanceId: instance.id, entryId: 'run', revision: detail.revision };
  assert.doesNotThrow(() => service.assertSource(instance.entryFlows.run, source));
  assert.throws(() => service.assertSource(instance.entryFlows.second, source), /原入口/);
  const other = await service.create(instance.packageKey);
  assert.throws(() => service.assertSource(other.entryFlows.run, source), /原入口/);
  const next = await service.save({ ...request, name: 'New name' });
  assert.throws(() => service.assertSource(instance.entryFlows.run, source), /实例已变化/);
  const broken = store.get<FlowRecord>('flow', instance.entryFlows.run)!;
  broken.bindings.template!.entryId = 'second';
  store.put('flow', broken.id, broken);
  const corrupt = await service.detail(instance.id);
  assert.throws(
    () => service.assertSource(broken.id, { ...source, revision: corrupt.revision }),
    /原入口/,
  );
  assert.notEqual(next.revision, detail.revision);
});
