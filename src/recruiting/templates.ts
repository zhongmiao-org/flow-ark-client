import type { Flow, Template } from '../shared/types';
import { digest, uid } from '../shared/utils';
import { validateFlow, validateObject, walk } from '../core/validate';
import { recruitingConfigurationSchema } from './template-schema';
import {
  validateConfigurationSchema,
  supportedConfigurationAdapters,
} from '../shared/template-config';
export { defaultPolicy } from './policy';
export function templateDigest(flow: Flow, configuration?: Template['manifest']['configuration']) {
  return digest(configuration ? { flow, configuration } : flow);
}
export function packageFlow(
  flow: Flow,
  source = 'local',
  configuration?: Template['manifest']['configuration'],
): Template {
  return {
    manifest: {
      id: flow.id,
      version: '1.1.0',
      source,
      digest: templateDigest(flow, configuration),
      ...(configuration ? { configuration } : {}),
      formatVersion: '1.0',
      parametersSchema: { type: 'object' },
      requiredCapabilities: flow.requiredCapabilities,
      scripts: walk(flow.steps)
        .filter((n) => n.type === 'script')
        .map((n) => n.id),
      dependencies: [],
    },
    flow,
  };
}
export const templates: Template[] = (['boss', 'zhaopin'] as const).map((platform) => {
  const flow: Flow = {
    id: platform + '-resume-apply',
    formatVersion: '1.0',
    name: platform === 'boss' ? 'BOSS 直聘投递简历' : '智联招聘投递简历',
    description: '有限批次检查职位与会话；按独立动作权限执行，取得微信号后建立本地待办。',
    parameters: {},
    requiredCapabilities: ['browser', 'recruiting', platform],
    steps: [
      {
        id: 'recruiting_batch',
        type: 'recruiting',
        version: 1,
        platform,
        batchLimit: 5,
      },
    ],
  };
  return packageFlow(flow, 'flowark-builtin', {
    adapter: 'recruiting-policy-v1',
    schema: recruitingConfigurationSchema(platform),
  });
});
export function validateTemplate(value: unknown): Template {
  const p = validateObject<Template>('TemplatePackage', value);
  validateFlow(p.flow);
  if (p.manifest.digest !== templateDigest(p.flow, p.manifest.configuration))
    throw new Error('模板内容摘要不匹配');
  if (p.manifest.configuration) {
    if (!supportedConfigurationAdapters.includes(p.manifest.configuration.adapter))
      throw new Error('模板配置适配器尚未安装');
    validateConfigurationSchema(p.manifest.configuration.schema);
  }
  if (p.manifest.dependencies.length) throw new Error('模板依赖不可用，不会自动安装');
  if (
    JSON.stringify(p.manifest.requiredCapabilities) !== JSON.stringify(p.flow.requiredCapabilities)
  )
    throw new Error('模板能力声明与流程不一致');
  return p;
}
export function instantiate(value: Template): Flow {
  const p = validateTemplate(value);
  return {
    ...structuredClone(p.flow),
    id: uid(),
    sourceTemplate: {
      id: p.manifest.id,
      version: p.manifest.version,
      digest: p.manifest.digest,
    },
  };
}
