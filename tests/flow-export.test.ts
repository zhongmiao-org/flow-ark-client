import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Runtime } from '../src/host/runtime';
import { validateIPC } from '../src/shared/ipc';
import { templateContentLimit } from '../src/shared/flow-export';
import { templates, packageFlow, validateTemplate } from '../src/recruiting/templates';
import type { Flow, FlowRecord, Template } from '../src/shared/types';

const flow: Flow = {
  id: 'export_fixture',
  formatVersion: '1.0',
  name: '虚构导出流程',
  description: '',
  parameters: { privateValue: 'FICTIONAL_PRIVATE_PARAMETER' },
  requiredCapabilities: ['value'],
  steps: [{ id: 'value', type: 'value', version: 1, value: 'FICTIONAL_PRIVATE_LITERAL' }],
};
const configuration = {
  adapter: 'flow-parameters-v1',
  schema: {
    type: 'object',
    properties: { privateValue: { type: 'string', default: 'public default' } },
    required: ['privateValue'],
    additionalProperties: false,
  },
};
async function fixture(run: (runtime: Runtime, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'flowark-export-'));
  const runtime = new Runtime(
    directory,
    resolve('dist'),
    process.execPath,
    randomBytes(32),
    async (method) => {
      if (method === 'credentials.list') return ['fictional-credential'];
      throw new Error('Export must not call system capabilities: ' + method);
    },
  );
  try {
    await run(runtime, directory);
  } finally {
    await runtime.shutdown();
    runtime.store.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const request = (f = flow) => ({ flow: f, reviewed: true as const });
const exported = async (runtime: Runtime, input: unknown): Promise<Template> =>
  validateTemplate(JSON.parse(await runtime.request('flow.export', input)));

test('export uses the submitted draft without saving bindings, versions, schedules or runs', async () => {
  await fixture(async (runtime, directory) => {
    const saved = runtime.saveFlow(flow, {
      files: { privateDirectory: directory },
      credentials: ['fictional-credential'],
      scriptPackages: { 'fictional-package': { path: directory, version: '1.0.0' } },
      configuration: { ...configuration, values: { privateValue: 'FICTIONAL_PRIVATE_PARAMETER' } },
    });
    const plan = await runtime.request('schedule.save', {
      flowId: saved.id,
      intervalMinutes: 60,
      timezone: 'UTC',
    });
    await runtime.request('schedule.toggle', { id: plan.id, enabled: false });
    const kinds = ['flow', 'version', 'schedule', 'run', 'snapshot', 'action', 'attention'];
    const before = kinds.map((kind) => runtime.store.list(kind));
    const draft = structuredClone(saved.flow);
    draft.steps = [{ id: 'value', type: 'value', version: 1, value: 'REDACTED' }];
    const payload = { ...request(draft), configuration };
    const original = structuredClone(payload);
    const result = await exported(runtime, payload);
    assert.equal((result.flow.steps[0] as any).value, 'REDACTED');
    assert.deepEqual(result.flow.parameters, { privateValue: null });
    assert.deepEqual(payload, original);
    assert.deepEqual(result.manifest.configuration, configuration);
    for (const excluded of [
      'FICTIONAL_PRIVATE_',
      directory,
      'fictional-credential',
      'scriptPackages',
    ])
      assert.ok(!JSON.stringify(result).includes(excluded), excluded);
    assert.deepEqual(
      kinds.map((kind) => runtime.store.list(kind)),
      before,
    );

    const repeat = await exported(runtime, payload);
    assert.equal(repeat.manifest.version, result.manifest.version);
    assert.equal(result.manifest.version, '0.0.0-local.sha256-' + result.manifest.digest);
    const parameterChange = structuredClone(draft);
    parameterChange.parameters.privateValue = 'ANOTHER_PRIVATE_PARAMETER';
    assert.equal(
      (await exported(runtime, { ...request(parameterChange), configuration })).manifest.version,
      result.manifest.version,
    );
    const changed = structuredClone(draft);
    changed.steps = [{ id: 'value', type: 'value', version: 1, value: 'changed' }];
    assert.notEqual(
      (await exported(runtime, { ...request(changed), configuration })).manifest.version,
      result.manifest.version,
    );
    const changedSchema = {
      ...configuration,
      schema: { ...configuration.schema, title: 'Changed form' },
    };
    assert.notEqual(
      (await exported(runtime, { ...request(draft), configuration: changedSchema })).manifest
        .version,
      result.manifest.version,
    );
    assert.deepEqual(
      kinds.map((kind) => runtime.store.list(kind)),
      before,
    );

    const imported: FlowRecord = await runtime.request('flow.import', {
      content: JSON.stringify(result),
    });
    assert.notEqual(imported.id, saved.id);
    assert.equal(imported.flow.sourceTemplate?.version, result.manifest.version);
    assert.deepEqual(imported.bindings.files, {});
    assert.deepEqual(imported.bindings.credentials, []);
    assert.equal(imported.bindings.scriptPackages, undefined);
    assert.deepEqual(imported.bindings.configuration?.values, { privateValue: 'public default' });
    assert.deepEqual(runtime.store.get('flow', saved.id), saved);
    assert.deepEqual(
      kinds.slice(1).map((kind) => runtime.store.list(kind)),
      before.slice(1),
    );
  });
});

test('host export rejects stale ID requests, local fields and invalid definitions', async () => {
  await fixture(async (runtime) => {
    const invalid = [
      { id: flow.id, reviewed: true },
      { ...request(), bindings: { files: { work: '/fictional/private' }, credentials: [] } },
      { ...request(), configuration: { ...configuration, values: { privateValue: 'private' } } },
      { ...request(), reviewed: false },
    ];
    for (const input of invalid) {
      assert.throws(() => validateIPC('flow.export', input));
      await assert.rejects(runtime.request('flow.export', input));
    }
    for (const input of [
      request({ ...flow, requiredCapabilities: ['future-capability'] }),
      request({
        ...flow,
        steps: [{ id: 'value', type: 'value', version: 1, value: { $ref: 'params.missing' } }],
      }),
      { ...request(), configuration: { ...configuration, adapter: 'unknown-adapter' } },
      {
        ...request(),
        configuration: {
          adapter: configuration.adapter,
          schema: { $ref: 'https://example.invalid/schema' },
        },
      },
    ])
      await assert.rejects(runtime.request('flow.export', input));
    assert.equal(runtime.store.list('run').length, 0);
    assert.equal(runtime.store.list('version').length, 0);
  });
});

test('export checks the formatted content against the same import size limit', async () => {
  await fixture(async (runtime) => {
    const huge = request({ ...flow, parameters: { tooLarge: 'x'.repeat(templateContentLimit) } });
    await assert.rejects(runtime.request('flow.export', huge), /2 MiB/);
    const expanded = request({
      ...flow,
      steps: [
        {
          id: 'value',
          type: 'value',
          version: 1,
          value: Array.from({ length: 25000 }, () => ({ a: null, b: null, c: null })),
        },
      ],
    });
    assert.ok(JSON.stringify(expanded).length < templateContentLimit);
    await assert.rejects(runtime.request('flow.export', expanded), /导出模板超过 2 MiB/);
  });
});

test('explicit built-in versions and old local packages remain independently importable without executing scripts', async () => {
  await fixture(async (runtime) => {
    assert.ok(templates.every((template) => template.manifest.version === '1.2.0'));
    const old = packageFlow(
      {
        ...flow,
        steps: [
          {
            id: 'script',
            type: 'script',
            version: 1,
            language: 'js',
            input: null,
            dependencies: [],
            code: 'export default async () => { throw new Error("MUST_NOT_EXECUTE"); };',
          },
        ],
      },
      'local',
      undefined,
      '1.1.0',
    );
    const first = await runtime.request('flow.import', { content: JSON.stringify(old) });
    const second = await runtime.request('flow.import', { content: JSON.stringify(old) });
    assert.notEqual(first.id, second.id);
    assert.equal(first.flow.sourceTemplate.version, '1.1.0');
    assert.equal(second.flow.sourceTemplate.digest, old.manifest.digest);
    assert.equal(runtime.store.list('run').length, 0);
    assert.equal(runtime.store.list('version').length, 0);
    assert.equal(runtime.store.list('schedule').length, 0);
  });
});
