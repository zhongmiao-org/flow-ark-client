import test from 'node:test';
import assert from 'node:assert/strict';
import {
  editScriptPackage,
  scriptInputPreview,
  scriptOutputs,
  type ScriptNode,
} from '../src/renderer/script-editor';
import type { FlowRecord, Step } from '../src/shared/types';

const script: ScriptNode = {
  id: 'script',
  type: 'script',
  version: 1,
  language: 'ts',
  code: 'export default async (ctx) => ctx.input;',
  input: {},
  dependencies: [{ name: 'local-helper', version: '1.0.0' }],
};
const record: FlowRecord = {
  id: 'flow',
  updatedAt: 'today',
  flow: {
    id: 'flow',
    formatVersion: '1.0',
    name: 'test',
    description: '',
    parameters: {},
    requiredCapabilities: ['script'],
    steps: [script, { ...script, id: 'other' }],
  },
  bindings: {
    files: { work: '/kept' },
    credentials: ['kept'],
    scriptPackages: { 'local-helper': { path: '/fixture', version: '1.0.0' } },
  },
};
test('isolated script package edits retain other nodes and shared bindings; reject version conflicts', () => {
  const next = editScriptPackage(record, script, 'local-helper');
  assert.deepEqual((next.flow.steps[0] as ScriptNode).dependencies, []);
  assert.deepEqual(next.bindings, record.bindings);
  assert.equal((record.flow.steps[0] as ScriptNode).dependencies.length, 1);
  const last = editScriptPackage(next, next.flow.steps[1] as ScriptNode, 'local-helper');
  assert.deepEqual(last.bindings.scriptPackages, {});
  assert.deepEqual(last.bindings.files, { work: '/kept' });
  assert.throws(
    () =>
      editScriptPackage(record, script, 'local-helper', {
        name: 'local-helper',
        version: '2.0.0',
        path: '/two',
      }),
    /不同版本/,
  );
  const bound = editScriptPackage(next, next.flow.steps[0] as ScriptNode, 'local-helper', {
    name: 'local-helper',
    version: '1.0.0',
    path: '/new',
  });
  assert.equal(bound.bindings.scriptPackages?.['local-helper'].path, '/new');
});
test('input previews resolve only draft literals and params, never invent runtime outputs or loop items', () => {
  assert.deepEqual(
    scriptInputPreview({ rows: { $ref: 'params.rows' }, value: false }, { rows: [0, null] }),
    { available: true, value: { rows: [0, null], value: false } },
  );
  for (const path of ['steps.other', 'item.name', 'params.constructor', 'params.absent'])
    assert.equal(scriptInputPreview({ $ref: path }, {}).available, false);
});
test('script history keeps actual nested iterations, false and null; omits unvisited branches and missing output', () => {
  const steps: Step[] = [
    {
      id: 'loop',
      type: 'loop',
      version: 1,
      items: [1, 2],
      body: [
        {
          id: 'choice',
          type: 'condition',
          version: 1,
          actual: true,
          operator: 'equals',
          expected: true,
          then: [script],
          else: [{ ...script, id: 'unused' }],
        },
      ],
    },
  ];
  const output = { loop: [{ choice: { script: null } }, { choice: { script: false } }] };
  assert.deepEqual(scriptOutputs(steps, output, 'script'), [
    { instance: 'loop[0]/choice/script', value: null },
    { instance: 'loop[1]/choice/script', value: false },
  ]);
  assert.deepEqual(scriptOutputs(steps, output, 'unused'), []);
  assert.deepEqual(scriptOutputs(steps, undefined, 'script'), []);
});
