import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resourceOperation,
  columnName,
  cellKey,
  mapKey,
  renameEntry,
  isMatrix,
  matrixColumns,
  setCell,
  addColumn,
  removeColumn,
} from '../src/renderer/resource-form-model';
import type { Json, Step } from '../src/shared/types';

test('映射名称拒绝大小写重复和非法地址，重命名保留顺序与原值', () => {
  const headers = { 'Content-Type': 'application/json', 'X-Test': { $ref: 'params.test' } };
  assert.throws(() => mapKey('headers', 'content-type', headers), /重复/);
  for (const name of ['bad name', 'line\n', 'colon:', 'constructor', ''])
    assert.throws(() => mapKey('headers', name, headers));
  const renamed = renameEntry(headers, 'X-Test', 'X-Trace', 'headers');
  assert.deepEqual(renamed, {
    'Content-Type': 'application/json',
    'X-Trace': { $ref: 'params.test' },
  });
  assert.deepEqual(Object.keys(headers), ['Content-Type', 'X-Test']);
  assert.equal(cellKey('xfd1048576'), 'XFD1048576');
  for (const key of ['XFE1', 'A1048577', 'A0', 'A01', '1A', ' A1'])
    assert.throws(() => cellKey(key));
  assert.throws(() => mapKey('cells', 'a1', { A1: 42 }), /重复/);
  assert.equal(mapKey('cells', 'b2', { A1: 42 }), 'B2');
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(16383), 'XFD');
});
test('矩阵编辑与增删保留未显示行列、引用与类型，不修改原输入', () => {
  const rows: Json[][] = Array.from({ length: 25 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => `${r}:${c}`),
  );
  rows[24][8] = { $ref: 'params.last' };
  rows[15][5] = false;
  rows[16][7] = 42;
  const snapshot = structuredClone(rows);
  const edited = setCell(rows, 10, 6, { formula: '1+2', result: 3 });
  assert.deepEqual(edited[24][8], { $ref: 'params.last' });
  assert.equal(edited[15][5], false);
  assert.equal(edited[16][7], 42);
  assert.deepEqual(rows, snapshot);
  const enlarged = addColumn(edited);
  assert.equal(matrixColumns(enlarged), 10);
  assert.ok(enlarged.every((row) => row[9] === null));
  assert.deepEqual(removeColumn(enlarged, 9), edited);
  const ragged: Json[][] = [[1], [2, 3]];
  assert.deepEqual(setCell(ragged, 0, 1, 'x'), [
    [1, 'x'],
    [2, 3],
  ]);
  assert.deepEqual(ragged, [[1], [2, 3]]);
  assert.ok(isMatrix([]));
  assert.ok(!isMatrix([{ x: 1 }]));
  assert.ok(!isMatrix({ $ref: 'params.rows' }));
  assert.throws(() => setCell(rows, 25, 0, 'bad'));
});
test('文件和 Excel 操作转换使用既有版本，保留目录与超时并清理旧字段', () => {
  const original: Extract<Step, { type: 'file' }> = {
    id: 'file',
    type: 'file',
    version: 1,
    operation: 'write',
    binding: 'work',
    name: { $ref: 'params.name' },
    content: 'keep',
    timeoutMs: 1234,
  };
  const archive = resourceOperation(original, 'archive');
  assert.deepEqual(archive, {
    id: 'file',
    type: 'file',
    version: 2,
    operation: 'archive',
    binding: 'work',
    timeoutMs: 1234,
    name: 'archive.zip',
    files: ['result.txt'],
  });
  const copied = resourceOperation(archive, 'copy');
  assert.equal(copied.version, 1);
  assert.ok('content' in copied);
  assert.ok(!('files' in copied));
  assert.equal(original.content, 'keep');
  const excel = resourceOperation(
    {
      id: 'book',
      type: 'excel',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'a.xlsx',
      rows: [],
    },
    'fill',
  );
  assert.equal(excel.version, 2);
  assert.ok('cells' in excel);
  assert.ok(!('rows' in excel));
  const read = resourceOperation(excel, 'read');
  assert.equal(read.version, 1);
  assert.ok('rows' in read);
  assert.ok(!('templateName' in read));
  assert.throws(() => resourceOperation(original, 'fill'));
  assert.throws(() => resourceOperation(excel, 'archive'));
});
