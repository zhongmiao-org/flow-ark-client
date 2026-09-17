import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { fileOperation } from '../src/adapters/files';
import { validateFlow } from '../src/core/validate';
import { validateIPC } from '../src/shared/ipc';
import example from '../contracts/example.flow.json';

const fill = {
  id: 'fill',
  type: 'excel',
  version: 2,
  operation: 'fill',
  binding: 'workspace',
  name: 'filled.xlsx',
  templateName: 'template.xlsx',
  sheet: 'Report',
  cells: { A2: '虚构数据', B2: 42 },
};
const archive = {
  id: 'zip',
  type: 'file',
  version: 2,
  operation: 'archive',
  binding: 'workspace',
  name: 'archive.zip',
  files: ['a.txt', 'nested/b.txt'],
};
async function fixture(t: any) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowark-files-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths: string[] = [];
  return {
    root,
    paths,
    run: (node: any) =>
      fileOperation(node, { files: { workspace: root }, credentials: [] }, async (path) => {
        paths.push(path);
        return { artifactId: 'test', runId: 'run' };
      }),
  };
}
async function template(path: string) {
  const book = new ExcelJS.Workbook();
  const report = book.addWorksheet('Report');
  report.mergeCells('A1:B1');
  report.getCell('A1').value = '保留标题';
  report.getCell('A1').font = { bold: true, color: { argb: 'FF123456' } };
  report.getCell('B2').numFmt = '0.00';
  report.getCell('C2').value = { formula: 'B2*2', result: 0 };
  book.addWorksheet('Untouched').getCell('A1').value = '第二张表';
  await book.xlsx.writeFile(path);
}
test('Excel fill preserves source bytes, styles, merges, formulas and other sheets', async (t) => {
  const { root, run, paths } = await fixture(t);
  await template(join(root, 'template.xlsx'));
  const original = await readFile(join(root, 'template.xlsx'));
  await run({
    ...fill,
    cells: { a2: '虚构数据', B2: 42, D2: { formula: 'B2+1', result: 43 }, A3: true, B3: null },
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(join(root, 'filled.xlsx'));
  const report = book.getWorksheet('Report')!;
  assert.equal(report.getCell('A2').value, '虚构数据');
  assert.equal(report.getCell('B2').value, 42);
  assert.equal(report.getCell('B2').numFmt, '0.00');
  assert.equal(report.getCell('A1').font.bold, true);
  assert.equal(report.getCell('B1').master.address, 'A1');
  assert.equal(report.getCell('C2').formula, 'B2*2');
  assert.equal(report.getCell('D2').result, 43);
  assert.equal(book.getWorksheet('Untouched')!.getCell('A1').value, '第二张表');
  assert.deepEqual(await readFile(join(root, 'template.xlsx')), original);
  assert.deepEqual(paths, [join(root, 'filled.xlsx')]);
});
test('Excel fill rejects invalid cells and never replaces source or previous output on error', async (t) => {
  const { root, run, paths } = await fixture(t);
  await template(join(root, 'template.xlsx'));
  const original = await readFile(join(root, 'template.xlsx'));
  await writeFile(join(root, 'filled.xlsx'), 'previous-output');
  for (const patch of [
    { name: 'template.xlsx' },
    { sheet: 'Missing' },
    { cells: { XFE1: 1 } },
    { cells: { A1048577: 1 } },
    { cells: { A0: 1 } },
    { cells: { A1: 1, a1: 2 } },
    { cells: { A1: { formula: '', result: 1 } } },
    { cells: { A1: { hyperlink: 'file:///etc/hosts' } } },
  ])
    await assert.rejects(run({ ...fill, ...patch }));
  assert.equal(await readFile(join(root, 'filled.xlsx'), 'utf8'), 'previous-output');
  assert.deepEqual(await readFile(join(root, 'template.xlsx')), original);
  assert.equal(paths.length, 0);
  assert.ok(!(await readdir(root)).some((name) => name.startsWith('.flowark-')));
});
test('ZIP archives only explicit inputs with their relative names and content', async (t) => {
  const { root, run, paths } = await fixture(t);
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'a.txt'), 'alpha');
  await writeFile(join(root, 'nested/b.txt'), 'beta');
  await writeFile(join(root, 'not-selected.txt'), 'excluded');
  await run(archive);
  const zip = await JSZip.loadAsync(await readFile(join(root, 'archive.zip')));
  assert.deepEqual(Object.keys(zip.files).sort(), ['a.txt', 'nested/b.txt']);
  assert.equal(await zip.file('nested/b.txt')!.async('string'), 'beta');
  assert.equal(paths.length, 1);
});
test('ZIP rejects traversal, directories, duplicate entries, itself and escaping symlinks without clobbering output', async (t) => {
  const { root, run, paths } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'flowark-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'outside');
  await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));
  await writeFile(join(root, 'a.txt'), 'alpha');
  await mkdir(join(root, 'directory'));
  await writeFile(join(root, 'archive.zip'), 'previous-output');
  for (const files of [
    [],
    ['../a.txt'],
    ['/a.txt'],
    ['C:\\a.txt'],
    ['a.txt', 'a.txt'],
    ['archive.zip'],
    ['link.txt'],
    ['directory'],
    ['a.txt', 'missing.txt'],
    Array(201).fill('a.txt'),
  ])
    await assert.rejects(run({ ...archive, files }));
  assert.equal(await readFile(join(root, 'archive.zip'), 'utf8'), 'previous-output');
  assert.equal(paths.length, 0);
  assert.ok(!(await readdir(root)).some((name) => name.startsWith('.flowark-')));
});
test('new operations require explicit v2 and valid references; artifact IPC accepts only registered IDs', () => {
  validateFlow({ ...example, steps: [fill, archive] });
  for (const node of [
    { ...fill, version: 1 },
    { ...archive, version: 1 },
    { ...archive, files: { $ref: 'steps.future' } },
  ])
    assert.throws(() => validateFlow({ ...example, steps: [node] }));
  assert.deepEqual(validateIPC('artifact.reveal', { id: 'registered' }), { id: 'registered' });
  assert.throws(() => validateIPC('artifact.reveal', { id: 'a', path: '/etc/hosts' }));
  assert.throws(() => validateIPC('artifact.resolve', { id: 'a' }));
});
