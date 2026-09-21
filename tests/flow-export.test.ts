import test from 'node:test';
import assert from 'node:assert/strict';
import { exportDefinition } from '../src/templates/export';
import { validateIPC } from '../src/shared/ipc';
import { jsonFile } from '../contracts/package-format';
import example from '../contracts/example.flow.json';
test('local export has new identity, no instance parameters, static scripts and never modifies original', async () => {
  const flow: any = {
    ...structuredClone(example),
    parameters: { secret: 'private-data' },
    steps: [
      {
        id: 'code',
        type: 'script',
        version: 1,
        language: 'ts',
        code: 'export default async () => { const n:number=3; return n; }',
        input: null,
        dependencies: [],
      },
    ],
  };
  const before = structuredClone(flow);
  const pkg = await exportDefinition(flow);
  assert.match(pkg.manifest.id, /^local-/);
  assert.deepEqual(jsonFile(pkg.files, 'flows/run.json').parameters, { secret: null });
  assert.ok(pkg.files.get('scripts/local-code.js')?.toString().includes('return n'));
  assert.ok(![...pkg.files.values()].some((b) => b.includes('private-data')));
  assert.deepEqual(flow, before);
  assert.notEqual((await exportDefinition(flow)).manifest.id, pkg.manifest.id);
});
test('renderer cannot choose import/output filesystem paths or grant authority inside export', () => {
  for (const method of ['template.inspect', 'template.install', 'template.export'])
    assert.throws(() => validateIPC(method, { path: '/tmp/x' }));
  assert.throws(() =>
    validateIPC('flow.export', {
      flow: example,
      reviewed: true,
      bindings: { grants: { write: 'auto' } },
    }),
  );
});
