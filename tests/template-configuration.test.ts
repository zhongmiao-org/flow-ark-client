import test from 'node:test';
import assert from 'node:assert/strict';
import {
  packageFlow,
  validateTemplate,
  templateDigest,
  instantiate,
} from '../src/templates/flow';
import {
  configureTemplate,
  validateConfiguration,
  normalizeBindings,
} from '../src/host/configuration';
import { validateConfigurationSchema } from '../src/shared/template-config';
import example from '../contracts/example.flow.json';
import type { Flow } from '../src/shared/types';

test('template package owns form schema; generic non-recruiting configuration uses the same boundary', () => {
  const configuration = {
    adapter: 'flow-parameters-v1',
    schema: {
      type: 'object',
      title: '导出选项',
      properties: { filename: { type: 'string', title: '文件名', default: 'report.xlsx' } },
      required: ['filename'],
      additionalProperties: false,
    },
  };
  const template = packageFlow(example as Flow, 'fictional-test', configuration);
  const binding = configureTemplate(validateTemplate(template));
  assert.deepEqual(binding?.values, { filename: 'report.xlsx' });
  validateConfiguration({ files: {}, credentials: [], configuration: binding });
  assert.ok(!JSON.stringify(template).includes('recruiting'));
  const tampered = structuredClone(template);
  (tampered.manifest.configuration!.schema as any).title = 'tampered';
  assert.throws(() => validateTemplate(tampered), /摘要/);
});
test('remote refs and unknown executable form adapters cannot be imported', () => {
  assert.throws(() =>
    validateConfigurationSchema({ type: 'object', $ref: 'https://example.invalid/schema' }),
  );
  const template = packageFlow(example as Flow, 'fictional', {
    adapter: 'download-and-execute',
    schema: { type: 'object' },
  });
  assert.throws(() => validateTemplate(template), /未安装/);
});
