import test from 'node:test';
import assert from 'node:assert/strict';
import { runTimeline } from '../src/renderer/run-timeline';
import type { RunPresentationInput } from '../src/shared/run-presentation';

test('timeline retains actual loop instances and does not mark unvisited branches completed', () => {
  const detail = {
    run: { id: 'run', state: 'SUCCEEDED' },
    snapshot: {
      steps: [
        { id: 'loop', type: 'loop', body: [{ id: 'read', type: 'value', name: '固定快照名称' }] },
        { id: 'untouched', type: 'value' },
      ],
    },
    events: [
      { sequence: 1, type: 'node-start', nodeInstance: 'loop' },
      { sequence: 2, type: 'node-start', nodeInstance: 'loop[0]/read' },
      { sequence: 3, type: 'node-end', nodeInstance: 'loop[0]/read', data: { completed: true } },
      { sequence: 4, type: 'node-start', nodeInstance: 'loop[1]/read' },
      { sequence: 5, type: 'node-end', nodeInstance: 'loop[1]/read', data: { completed: true } },
      { sequence: 6, type: 'node-end', nodeInstance: 'loop', data: { completed: true } },
    ],
    execution: { active: null },
  } as unknown as RunPresentationInput;
  const rows = runTimeline(detail);
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((row) => row.nodeId === 'read').length, 2);
  assert.equal(rows[1].name, '固定快照名称');
  assert.equal(rows.at(-1)?.label, '尚未执行');
  assert.equal(rows[0].label, '已完成');
});

test('stale running records and storage faults do not label unfinished nodes live', () => {
  const detail = {
    run: { id: 'run', state: 'RUNNING' },
    snapshot: { steps: [{ id: 'work', type: 'value' }] },
    events: [{ sequence: 1, type: 'node-start', nodeInstance: 'work', data: {} }],
    execution: { observedAt: new Date().toISOString(), active: null },
  } as unknown as RunPresentationInput;
  assert.equal(runTimeline(detail)[0].label, '未完成 · 待核对');
  detail.execution!.active = { runId: 'run', phase: 'executing' };
  assert.equal(runTimeline(detail)[0].label, '运行中');
  detail.fault = 'storage full';
  assert.equal(runTimeline(detail)[0].label, '未完成 · 待核对');
});
