import test from 'node:test';
import assert from 'node:assert/strict';
import { taskRunPresentation } from '../src/renderer/task-run-presentation';
import { validateIPC } from '../src/shared/ipc';
import { redactArtifactText } from '../src/shared/utils';
const fixture = (): any => ({
  run: { id: 'r', state: 'SUCCEEDED' },
  execution: { active: null },
  snapshot: {
    steps: [
      { id: 'loop', type: 'loop', body: [{ id: 'a', type: 'value', value: 1 }] },
      {
        id: 'branch',
        type: 'condition',
        then: [{ id: 'yes', type: 'value' }],
        else: [{ id: 'no', type: 'file' }],
      },
    ],
  },
  events: [
    ['node-start', 'loop'],
    ['node-start', 'loop[0]/a'],
    ['node-end', 'loop[0]/a'],
    ['node-start', 'loop[1]/a'],
    ['node-end', 'loop[1]/a'],
    ['node-end', 'loop'],
    ['node-start', 'branch'],
    ['node-start', 'branch/yes'],
    ['node-end', 'branch/yes'],
    ['node-end', 'branch'],
  ].map(([type, nodeInstance], sequence) => ({
    runId: 'r',
    sequence,
    type,
    nodeInstance,
    data: { completed: type === 'node-end' },
    time: '2026-09-21T00:00:00Z',
  })),
  artifacts: [],
});
test('task outcome counts real instances, preserves unselected branches, and ignores another Run', () => {
  const d = fixture();
  d.events.push({
    runId: 'other',
    sequence: 99,
    type: 'node-end',
    nodeInstance: 'no',
    data: { completed: true },
  });
  const v = taskRunPresentation(d);
  assert.equal(v.success, true);
  assert.equal(v.completed.length, 5);
  assert.deepEqual(
    v.unvisited.map((r) => r.nodeId),
    ['no'],
  );
  assert.equal(v.operations.length, 0);
  assert.ok(!v.summary.includes('全部'));
});
test('fault, lost ownership and closing cannot appear as confirmed completion; file counts use verified copies', () => {
  const d = fixture();
  d.artifacts = [
    { artifactId: 'a', runId: 'r', integrity: 'verified', available: true },
    { artifactId: 'b', runId: 'r', integrity: 'changed', available: false },
    { artifactId: 'c', runId: 'other', integrity: 'verified', available: true },
  ];
  assert.equal(taskRunPresentation(d).verified.length, 1);
  assert.equal(taskRunPresentation({ ...d, fault: 'store unavailable' }).success, false);
  assert.equal(
    taskRunPresentation({ ...d, execution: { active: { runId: 'r', phase: 'closing' } } }).mode,
    'closing',
  );
  d.run.state = 'RUNNING';
  assert.equal(taskRunPresentation(d).mode, 'unknown');
  d.run.state = 'FAILED';
  assert.equal(taskRunPresentation(d).mode, 'stopped');
});
test('preview accepts only an artifact identity and masks text before Unicode-safe truncation', () => {
  assert.deepEqual(validateIPC('artifact.preview', { id: 'a' }), { id: 'a' });
  for (const args of [
    { path: '/private/file' },
    { id: 'a', path: '/private/file' },
    { id: '' },
    { id: 'a', redactionSecrets: [] },
  ])
    assert.throws(() => validateIPC('artifact.preview', args));
  const v = redactArtifactText('token ' + 'opaque-private-value' + ' 😀'.repeat(40000), [
    'opaque-private-value',
  ]);
  assert.ok(!v.text.includes('opaque-private-value'));
  assert.equal(v.truncated, true);
  assert.equal([...v.text].length, 65536);
  assert.ok(!/[\uD800-\uDBFF]$/.test(v.text));
  assert.ok(!redactArtifactText('Bearer abcdef sk-secret-key').text.includes('abcdef'));
});
