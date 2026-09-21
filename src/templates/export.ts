import { randomUUID } from 'node:crypto';
import { transform } from 'esbuild';
import {
  canonical,
  manifestDigest,
  sha256,
  validatePackage,
  type PackageData,
  type Manifest,
} from '../../contracts/package-format';
import { validateFlow, walk } from '../core/validate';
import { validateConfigurationSchema } from '../shared/template-config';
import type { Flow } from '../shared/types';
/** A local fork contains definitions only. Source values and author identity are not inherited. */
export async function exportDefinition(
  flow: Flow,
  configuration?: any,
  source?: PackageData,
  entryId?: string,
): Promise<PackageData> {
  const f = structuredClone(validateFlow(flow));
  delete f.sourceTemplate;
  f.parameters = Object.fromEntries(Object.keys(f.parameters).map((k) => [k, null]));
  const files = source ? new Map(source.files) : new Map<string, Buffer>();
  files.delete('manifest.json');
  const json = (path: string, value: any) => files.set(path, Buffer.from(canonical(value)));
  const m: Manifest = source
    ? structuredClone(source.manifest)
    : {
        packageFormat: '2.0',
        id: 'local-' + randomUUID(),
        name: f.name,
        description: f.description ?? '',
        version: '1.0.0',
        author: 'local',
        source: 'local',
        minimumClientVersion: '0.2.0',
        sdkVersion: '1.0',
        configurationSchema: 'schemas/configuration.json',
        stateSchema: 'schemas/state.json',
        entries: [
          {
            id: 'run',
            name: '运行',
            flow: 'flows/run.json',
            inputSchema: 'schemas/input.json',
            resultSchema: 'schemas/result.json',
            schedulable: true,
            capabilities: f.requiredCapabilities,
            resources: [],
            actions: [],
          },
        ],
        resources: [],
        actions: [],
        files: [],
        scripts: [],
        dependencies: [],
        contentDigest: '',
      };
  m.id = 'local-' + randomUUID();
  m.version = '1.0.0';
  m.author = 'local';
  m.source = 'local';
  m.name = f.name;
  if (!source) {
    json(m.configurationSchema, configuration?.schema ?? { type: 'object', properties: {} });
    json(m.stateSchema, { type: 'object' });
    json('schemas/input.json', { type: 'object' });
    json('schemas/result.json', {});
  }
  if (configuration) {
    validateConfigurationSchema(configuration.schema);
    json(m.configurationSchema, configuration.schema);
  }
  const entry = m.entries.find((e) => e.id === entryId) ?? m.entries[0];
  entry.capabilities = [...new Set([...entry.capabilities, ...f.requiredCapabilities])];
  for (const n of walk(f.steps))
    if (n.type === 'script') {
      if (n.dependencies.length) throw new Error('导出前须静态打包脚本依赖');
      const path = 'scripts/local-' + n.id + '.js';
      const code = (
        await transform(n.code, {
          loader: n.language === 'ts' ? 'ts' : 'js',
          format: 'esm',
          target: 'node24',
        })
      ).code;
      files.set(path, Buffer.from(code));
      n.code = '@package:' + path;
      n.language = 'js';
      if (!m.scripts.includes(path)) m.scripts.push(path);
    }
  json(entry.flow, f);
  m.files = [...files]
    .map(([path, b]) => ({ path, size: b.length, sha256: sha256(b) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  m.contentDigest = manifestDigest(m);
  json('manifest.json', m);
  return validatePackage(files);
}
