import test from 'node:test';
import assert from 'node:assert/strict';
import { fileBindingNames } from '../src/renderer/file-bindings';
import type { Step } from '../src/shared/types';
test('file binding names include nested files, Excel and literal browser uploads without dropping saved names', () => {
  const steps = [
    {
      type: 'condition',
      then: [
        {
          type: 'loop',
          body: [
            { type: 'file', binding: 'work' },
            { type: 'excel', binding: 'reports' },
            {
              type: 'browser',
              operation: 'upload',
              value: { binding: 'attachments', name: 'sample.txt' },
            },
            { type: 'browser', operation: 'upload', value: { $ref: 'steps.dynamic' } },
          ],
        },
      ],
      else: [{ type: 'file', binding: 'work' }],
    },
  ] as Step[];
  assert.deepEqual(fileBindingNames(steps, { scripts: '/not-read', work: '/kept' }), [
    'workspace',
    'scripts',
    'work',
    'reports',
    'attachments',
  ]);
});
