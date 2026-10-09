import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import example from '../contracts/example.excel-mapping.json';
import { validateFlow } from '../src/core/validate';
import { fileOperation } from '../src/adapters/files';
import {
  mappedRows,
  mappingPreview,
  ExcelMappingError,
  type MappedExcel,
} from '../src/shared/excel-mapping';
const node = () => structuredClone(example.steps[0]) as MappedExcel;

test('mapped columns preserve sparse positions, null, false, zero and literal dotted keys', () => {
  const n = node();
  n.mappings[0].source = 'literal.dot';
  const input = [
    { 'literal.dot': '=plain text', amount: 0, enabled: false },
    { 'literal.dot': '', amount: null, enabled: true },
  ];
  assert.deepEqual(mappedRows(n, input), [
    ['标题', null, '数量', '启用'],
    ['=plain text', null, 0, false],
    ['', null, null, true],
  ]);
  assert.deepEqual(mappedRows({ ...n, includeHeaders: false }, input), [
    ['=plain text', null, 0, false],
    ['', null, null, true],
  ]);
  const matrix: MappedExcel = {
    ...n,
    mappings: [{ source: '2', column: 'B', header: 'third', type: 'number' as const }],
  };
  assert.deepEqual(mappedRows(matrix, [[null, null, 12]]), [
    [null, 'third'],
    [null, 12],
  ]);
});
test('mapping conflicts identify actual row and field including beyond the preview limit', () => {
  const n = node();
  const good = { title: 'sample', amount: 2, enabled: true };
  for (const bad of [
    { ...good, amount: '2' },
    { ...good, amount: { formula: '1+1' } },
    { ...good, amount: Infinity },
  ]) {
    assert.throws(
      () => mappedRows(n, [good, good, good, bad]),
      (error: unknown) =>
        error instanceof ExcelMappingError &&
        error.row === 3 &&
        error.mapping === 1 &&
        error.field === 'type',
    );
  }
  assert.throws(() => mappedRows(n, [{ title: 'missing' }]), /缺少来源字段/);
  assert.throws(() => mappedRows(n, [null]), /不是记录/);
  assert.throws(() => mappedRows({ ...n, mappings: [n.mappings[0], n.mappings[0]] }, []), /重复/);
  assert.throws(
    () => mappedRows({ ...n, mappings: [{ ...n.mappings[0], column: 'XFE' }] }, []),
    /A～XFD/,
  );
  assert.throws(() => mappedRows({ ...n, sheet: 'History' }, []), /工作表/);
  assert.throws(
    () =>
      mappedRows({ ...n, mappings: [{ ...n.mappings[0], column: 'XFD' }] }, Array(62).fill(good)),
    /一百万/,
  );
});
test('static preview validates all data, leaves runtime references pending and enforces capability declaration', () => {
  const n = node();
  const p = mappingPreview(n, example.parameters);
  assert.equal(p.available, true);
  const pending = mappingPreview({ ...n, rows: { $ref: 'steps.read' } }, {});
  assert.equal(pending.available, false);
  assert.throws(
    () => mappingPreview({ ...n, rows: { $ref: 'params.missing' } }, {}),
    /引用值不存在/,
  );
  assert.throws(
    () => mappingPreview({ ...n, name: '../overwrite.xlsx' }, example.parameters),
    /相对/,
  );
  const bad = structuredClone(example);
  bad.parameters.records.push({ title: 'fourth', amount: 'wrong' as any, enabled: true });
  assert.throws(() => validateFlow(bad), /类型不符/);
  assert.doesNotThrow(() => validateFlow(example));
  assert.throws(() => validateFlow({ ...example, requiredCapabilities: [] }), /声明/);
  assert.deepEqual(example.steps[0].rows, { $ref: 'params.records' });
});
test('real xlsx output matches mapping and never replaces existing files or links', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flowark-mapping-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const n = { ...node(), name: 'new.xlsx', rows: example.parameters.records };
  let artifacts = 0;
  const run = (value: any) =>
    fileOperation(value, { files: { output: root }, credentials: [] }, async (path) => {
      artifacts++;
      return { path };
    });
  await run(n);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(join(root, n.name));
  const sheet = book.getWorksheet('汇总')!;
  assert.equal(sheet.getCell('A2').value, '项目 A');
  assert.equal(sheet.getCell('B2').value, null);
  assert.equal(sheet.getCell('C2').value, 12);
  assert.equal(sheet.getCell('C3').value, null);
  assert.equal(sheet.getCell('D3').value, false);
  const before = await readFile(join(root, n.name));
  await assert.rejects(run(n), /已存在/);
  assert.deepEqual(await readFile(join(root, n.name)), before);
  await symlink(join(root, n.name), join(root, 'link.xlsx'));
  await assert.rejects(run({ ...n, name: 'link.xlsx' }), /已存在/);
  assert.deepEqual(await readFile(join(root, n.name)), before);
  await writeFile(join(root, 'plain.xlsx'), 'keep these bytes');
  await assert.rejects(run({ ...n, name: 'plain.xlsx' }), /已存在/);
  assert.equal(await readFile(join(root, 'plain.xlsx'), 'utf8'), 'keep these bytes');
  assert.equal(artifacts, 1);
  assert.ok(!(await readdir(root)).some((name) => name.startsWith('.flowark-')));
});
test('concurrent new-file commits have one winner and late data conflict leaves no output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'flowark-mapping-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const n = { ...node(), name: 'race.xlsx', rows: example.parameters.records };
  let artifacts = 0;
  const run = (value: any) =>
    fileOperation(value, { files: { output: root }, credentials: [] }, async () => ++artifacts);
  const results = await Promise.allSettled([run(n), run(n)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(artifacts, 1);
  const bad = {
    ...n,
    name: 'invalid.xlsx',
    rows: [...n.rows, ...n.rows, { title: 'bad', amount: 'invalid', enabled: true }],
  };
  await assert.rejects(run(bad), /第 5 行/);
  assert.deepEqual(await readdir(root), ['race.xlsx']);
});
