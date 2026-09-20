import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, symlink, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticUploadFields, uploadSource, uploadText } from '../src/shared/upload-source';
import { fileBindingNames } from '../src/renderer/file-bindings';
import { scopedTarget, uploadPath } from '../src/adapters/files';
import type { Step } from '../src/shared/types';
const ref = ($ref: string) => ({ $ref });

test('upload sources resolve only static parameter values and preserve opaque parameter objects', () => {
  const parameters = { source: { binding: 'work', name: 'future.txt' }, folder: 'reports' };
  const whole = staticUploadFields(ref('params.source'), parameters)!;
  assert.deepEqual(whole, {
    binding: { known: true, value: 'work' },
    name: { known: true, value: 'future.txt' },
  });
  const partial = staticUploadFields(
    { binding: ref('params.folder'), name: ref('steps.generated') },
    parameters,
  )!;
  assert.equal(partial.binding.known && partial.binding.value, 'reports');
  assert.equal(partial.name.known, false);
  assert.equal(staticUploadFields(ref('steps.generated'), parameters), undefined);
  assert.throws(() => staticUploadFields(ref('params.missing'), parameters), /不存在/);
  assert.throws(() => staticUploadFields(ref('params.toString'), parameters), /不存在/);
  const opaque = staticUploadFields(ref('params.source'), {
    source: { binding: ref('params.folder'), name: 'x' },
    folder: 'work',
  })!;
  assert.ok(opaque.binding.known);
  const opaqueBinding = opaque.binding.value;
  assert.throws(() => uploadText(opaqueBinding, 'binding'), /非空文本/);
  for (const value of [
    null,
    [],
    'file',
    {},
    { binding: 'work' },
    { binding: '', name: 'x' },
    { binding: 'work', name: 7 },
    { binding: 'work', name: '' },
  ])
    assert.throws(() => uploadSource(value));
  assert.deepEqual(uploadSource(parameters.source), parameters.source);
});

test('binding picker discovers whole and partial parameter upload bindings without requiring completed filenames', () => {
  const steps = [
    {
      type: 'loop',
      body: [
        { type: 'browser', operation: 'upload', value: ref('params.source') },
        {
          type: 'browser',
          operation: 'upload',
          value: { binding: ref('params.folder'), name: '' },
        },
        { type: 'browser', operation: 'upload', value: ref('steps.dynamic') },
        { type: 'browser', operation: 'upload', value: ref('params.missing') },
      ],
    },
  ] as Step[];
  assert.deepEqual(
    fileBindingNames(
      steps,
      { saved: '/not-read' },
      { source: { binding: 'work', name: 'x' }, folder: 'reports' },
    ),
    ['workspace', 'saved', 'work', 'reports'],
  );
});

test('upload boundary checks regular readable files and symlink scope, while lexical preflight permits future files', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowark-upload-path-')));
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'flowark-upload-outside-')));
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  assert.equal(scopedTarget(root, 'future.txt'), join(root, 'future.txt'));
  assert.throws(() => scopedTarget(root, '../escape.txt'), /已绑定目录/);
  await assert.rejects(uploadPath(root, 'future.txt'), /文件不存在/);
  await mkdir(join(root, 'directory'));
  await assert.rejects(uploadPath(root, 'directory'), /普通文件/);
  await writeFile(join(outside, 'outside.txt'), 'outside');
  await symlink(join(outside, 'outside.txt'), join(root, 'escape.txt'));
  await assert.rejects(uploadPath(root, 'escape.txt'), /授权目录/);
  await writeFile(join(root, 'future.txt'), 'generated');
  await symlink(join(root, 'future.txt'), join(root, 'inside.txt'));
  assert.equal(await uploadPath(root, 'inside.txt'), join(root, 'future.txt'));
  if (process.geteuid?.() !== 0) {
    await chmod(join(root, 'future.txt'), 0);
    try {
      await assert.rejects(uploadPath(root, 'future.txt'), { code: 'EACCES' });
    } finally {
      await chmod(join(root, 'future.txt'), 0o600);
    }
  }
});
