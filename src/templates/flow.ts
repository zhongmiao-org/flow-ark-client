import type { Flow, Template } from '../shared/types';
import { digest, uid } from '../shared/utils';
import { validateFlow, validateObject, walk } from '../core/validate';
import { declaredDependencies } from '../core/script-dependencies';
import {
  validateConfigurationSchema,
  supportedConfigurationAdapters,
} from '../shared/template-config';
export function templateDigest(flow: Flow, configuration?: Template['manifest']['configuration']) {
  return digest(configuration ? { flow, configuration } : flow);
}
export function packageFlow(
  flow: Flow,
  source = 'local',
  configuration?: Template['manifest']['configuration'],
  version?: string,
): Template {
  const contentDigest = templateDigest(flow, configuration);
  return {
    manifest: {
      id: flow.id,
      version: version ?? '0.0.0-local.sha256-' + contentDigest,
      source,
      digest: contentDigest,
      ...(configuration ? { configuration } : {}),
      formatVersion: '1.0',
      parametersSchema: { type: 'object' },
      requiredCapabilities: flow.requiredCapabilities,
      scripts: walk(flow.steps)
        .filter((n) => n.type === 'script')
        .map((n) => n.id),
      dependencies: declaredDependencies(walk(flow.steps)),
    },
    flow,
  };
}
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
  const sorted = (items: unknown[]) =>
    JSON.stringify([...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const steps = walk(p.flow.steps);
  if (
    sorted(p.manifest.dependencies.map(({ name, version }) => ({ name, version }))) !==
    sorted(declaredDependencies(steps))
  )
    throw new Error('模板依赖声明与脚本不一致');
  if (
    sorted(p.manifest.scripts) !== sorted(steps.filter((n) => n.type === 'script').map((n) => n.id))
  )
    throw new Error('模板脚本清单与流程不一致');
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
