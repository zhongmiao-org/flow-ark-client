import Ajv from 'ajv/dist/2020.js';
import type { Bindings, Policy, Template } from '../shared/types';
import {
  validateConfigurationSchema,
  schemaDefaults,
  supportedConfigurationAdapters,
} from '../shared/template-config';
import { defaultPolicy, validateRecruitingPolicy } from '../recruiting/policy';
import { recruitingConfigurationSchema } from '../recruiting/template-schema';
export function policyOf(bindings: Bindings): Policy | undefined {
  return bindings.configuration?.adapter === 'recruiting-policy-v1'
    ? validateRecruitingPolicy(bindings.configuration.values)
    : bindings.policy && validateRecruitingPolicy(bindings.policy);
}
export function configureTemplate(template: Template): Bindings['configuration'] {
  const config = template.manifest.configuration;
  if (!config) return undefined;
  if (!supportedConfigurationAdapters.includes(config.adapter))
    throw new Error('模板配置适配器尚未安装');
  validateConfigurationSchema(config.schema);
  let values = schemaDefaults(config.schema);
  if (config.adapter === 'recruiting-policy-v1') {
    const node = template.flow.steps.find((n) => n.type === 'recruiting');
    if (!node || node.type !== 'recruiting') throw new Error('模板缺少对应业务节点');
    // Template defaults never grant permission or seed an account, facts or contact values.
    values = defaultPolicy(node.platform);
    // Older packages retain their original form and policy surface.
    if (!(config.schema as any)?.properties?.jobFilter) delete values.jobFilter;
  }
  return { ...structuredClone(config), values };
}
export function normalizeBindings(bindings: Bindings): Bindings {
  if (!bindings.policy || bindings.configuration) return bindings;
  const { policy, ...rest } = bindings;
  const schema = recruitingConfigurationSchema(policy.platform);
  if (!policy.jobFilter) delete (schema.properties as any).jobFilter;
  return {
    ...rest,
    configuration: {
      adapter: 'recruiting-policy-v1',
      schema,
      values: JSON.parse(JSON.stringify(policy)),
    },
  };
}
export function validateConfiguration(bindings: Bindings) {
  const config = bindings.configuration;
  if (!config) return;
  if (!supportedConfigurationAdapters.includes(config.adapter))
    throw new Error('模板配置适配器尚未安装');
  validateConfigurationSchema(config.schema);
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(config.schema as any);
  if (!validate(config.values))
    throw new Error('实例配置不符合模板定义：' + ajv.errorsText(validate.errors));
}
