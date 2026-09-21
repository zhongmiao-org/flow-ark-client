import Ajv from 'ajv/dist/2020.js';
import type { Bindings, Template } from '../shared/types';
import {
  validateConfigurationSchema,
  schemaDefaults,
  supportedConfigurationAdapters,
} from '../shared/template-config';
export function configureTemplate(template: Template): Bindings['configuration'] {
  const config = template.manifest.configuration;
  if (!config) return undefined;
  if (!supportedConfigurationAdapters.includes(config.adapter))
    throw new Error('模板配置适配器尚未安装');
  validateConfigurationSchema(config.schema);
  let values = schemaDefaults(config.schema);
  return { ...structuredClone(config), values };
}
export function normalizeBindings(bindings: Bindings): Bindings {
  return bindings;
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
