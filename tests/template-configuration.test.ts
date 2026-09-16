import test from 'node:test';
import assert from 'node:assert/strict';
import {
  templates,
  packageFlow,
  validateTemplate,
  templateDigest,
  instantiate,
} from '../src/recruiting/templates';
import {
  configureTemplate,
  validateConfiguration,
  normalizeBindings,
} from '../src/host/configuration';
import { defaultPolicy } from '../src/recruiting/policy';
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
test('imported recruiting defaults cannot inherit accounts or automatic sending permission', () => {
  for (const template of templates) {
    const p = structuredClone(template);
    const schema = p.manifest.configuration!.schema as any;
    schema.default = {
      account: 'malicious-default',
      ownWechat: 'fictional',
      actions: { reply: 'auto' },
    };
    p.manifest.digest = templateDigest(p.flow, p.manifest.configuration);
    const binding = configureTemplate(validateTemplate(p))!;
    assert.equal((binding.values as any).account, '');
    assert.equal((binding.values as any).actions.reply, 'confirm');
    assert.equal((binding.values as any).ownWechat, '');
  }
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

test('new job-filter templates preserve old form versions and never seed personal rules', () => {
  for (const template of templates) {
    assert.equal(template.manifest.version, '1.2.0');
    assert.ok(template.flow.requiredCapabilities.includes('recruiting-job-filter-v1'));
    const binding = configureTemplate(template)!;
    assert.deepEqual((binding.values as any).jobFilter.cities, []);
    assert.equal((binding.values as any).jobFilter.salary.enabled, false);
    const old = structuredClone(template);
    old.manifest.version = '1.1.0';
    const schema = old.manifest.configuration!.schema as any;
    delete schema.properties.jobFilter;
    schema.properties.contextRevision = { type: 'string' };
    schema.additionalProperties = false;
    old.flow.requiredCapabilities = old.flow.requiredCapabilities.filter(
      (c) => c !== 'recruiting-job-filter-v1',
    );
    old.manifest.requiredCapabilities = old.flow.requiredCapabilities;
    old.manifest.digest = templateDigest(old.flow, old.manifest.configuration);
    const oldBinding = configureTemplate(validateTemplate(old))!;
    assert.equal((oldBinding.values as any).jobFilter, undefined);
    validateConfiguration({ files: {}, credentials: [], configuration: oldBinding });
    assert.equal(instantiate(old).sourceTemplate?.version, '1.1.0');
    assert.equal(instantiate(template).sourceTemplate?.version, '1.2.0');
    assert.equal((oldBinding.schema as any).properties.jobFilter, undefined);
    const legacyPolicy = defaultPolicy('boss');
    delete legacyPolicy.jobFilter;
    const migrated = normalizeBindings({ files: {}, credentials: [], policy: legacyPolicy });
    assert.equal((migrated.configuration!.schema as any).properties.jobFilter, undefined);
    assert.equal((migrated.configuration!.values as any).jobFilter, undefined);
  }
});
