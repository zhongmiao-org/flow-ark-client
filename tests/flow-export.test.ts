import test from 'node:test';
import assert from 'node:assert/strict';
import { exportDefinition } from '../src/templates/export';
import { validateIPC } from '../src/shared/ipc';
import { jsonFile } from '../contracts/package-format';
import example from '../contracts/example.flow.json';
import { templateFilename, zipExportPath } from '../src/shared/template-filename';
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
  assert.equal(jsonFile(pkg.files, 'schemas/input.json').properties.secret.type, 'string');
});
test('custom native workflows export required capabilities, portable resources and default-denied writes', async () => {
  const pkg = await exportDefinition({
    ...example,
    parameters: { count: 42, nested: { label: 'private-label' }, rows: [1, 2] },
    steps: [
      {
        id: 'read',
        type: 'file',
        version: 1,
        operation: 'read',
        binding: 'work',
        name: 'input.txt',
        content: null,
      },
      {
        id: 'write',
        type: 'file',
        version: 1,
        operation: 'write',
        binding: 'work',
        name: 'result.txt',
        content: 'fixture',
      },
      {
        id: 'fill',
        type: 'browser',
        version: 3,
        operation: 'fill',
        selector: '#name',
        value: 'fixture',
        framePath: [],
      },
      {
        id: 'upload',
        type: 'browser',
        version: 3,
        operation: 'upload',
        selector: '#file',
        value: { binding: 'work', name: 'input.txt' },
        framePath: [],
      },
    ],
  } as any);
  assert.deepEqual(
    pkg.manifest.resources.map(({ id, kind, access }) => ({ id, kind, access })),
    [
      { id: 'work', kind: 'directory', access: 'readwrite' },
      { id: 'browser', kind: 'browser', access: 'use' },
    ],
  );
  assert.deepEqual(pkg.manifest.entries[0].resources, ['work', 'browser']);
  assert.ok(pkg.manifest.entries[0].capabilities.includes('file'));
  assert.ok(pkg.manifest.entries[0].capabilities.includes('browser'));
  assert.equal(pkg.manifest.actions[0].default, 'deny');
  const schema = jsonFile(pkg.files, 'schemas/input.json');
  assert.equal(schema.properties.count.type, 'number');
  assert.equal(schema.properties.nested.properties.label.type, 'string');
  assert.equal(schema.properties.rows.items.type, 'number');
  assert.ok(![...pkg.files.values()].some((b) => b.includes('private-label')));
});
test('ZIP export names match the manifest identity and omit legacy extensions', () => {
  assert.equal(templateFilename('local-abc', '1.0.0'), 'local-abc-1.0.0.flowark-template.zip');
  assert.equal(zipExportPath('/tmp/custom'), '/tmp/custom.zip');
  assert.equal(zipExportPath('/tmp/custom.zip'), '/tmp/custom.zip');
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
