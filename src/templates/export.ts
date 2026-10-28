import { resolveParameterSources } from '../shared/parameter-sources';
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
import { declareNativeBoundaries, parameterSchema } from './export-boundaries';
import { validateConfigurationSchema } from '../shared/template-config';
import type { Flow, Json } from '../shared/types';
/** A local fork contains definitions only. Source values and author identity are not inherited. */
export async function exportDefinition(
  flow: Flow,
  configuration?: any,
  source?: PackageData,
  entryId?: string,
  identity = 'local-' + randomUUID(),
): Promise<PackageData> {
  const f = structuredClone(validateFlow(flow));
  delete f.sourceTemplate;
  if (
    walk(f.steps).some((n) => 'instructions' in n && n.instructions.startsWith('@author:prompt/'))
  )
    throw Error('作者提示词标记须在模板制作工作区编译后导出');
  // Sources need their declared object/array paths even after user values are cleared.
  // Only neutral values and the same schema-visible shape travel in a definition ZIP.
  const neutral = (value: Json): Json =>
    Array.isArray(value)
      ? value.map(neutral)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, neutral(child)]))
        : typeof value === 'string'
          ? ''
          : typeof value === 'number'
            ? 0
            : typeof value === 'boolean'
              ? false
              : null;
  f.parameters = Object.fromEntries(
    Object.entries(f.parameters).map(([key, value]) => [
      key,
      f.parameterSources ? neutral(value) : null,
    ]),
  );
  const files = source ? new Map(source.files) : new Map<string, Buffer>();
  files.delete('manifest.json');
  // A normal flow fork edits literal instructions independently of the author registry.
  files.delete('assets/template-author.json');
  const json = (path: string, value: any) => files.set(path, Buffer.from(canonical(value)));
  const m: Manifest = source
    ? structuredClone(source.manifest)
    : {
        packageFormat: '2.0',
        id: identity,
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
  if (!/^local-[a-z0-9-]+$/.test(identity)) throw new Error('本地模板身份无效');
  m.id = identity;
  m.version = '1.0.0';
  m.author = 'local';
  m.source = 'local';
  m.name = f.name;
  if (!source) {
    json(m.configurationSchema, configuration?.schema ?? { type: 'object', properties: {} });
    json(m.stateSchema, { type: 'object' });
    json('schemas/input.json', parameterSchema(resolveParameterSources(flow)));
    json('schemas/result.json', {});
  }
  if (configuration) {
    validateConfigurationSchema(configuration.schema);
    json(m.configurationSchema, configuration.schema);
  }
  const entry = m.entries.find((e) => e.id === entryId) ?? m.entries[0];
  declareNativeBoundaries(f, m, entry.id);
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
  if (!files.get('README.md')?.toString('utf8').trim())
    files.set(
      'README.md',
      Buffer.from(
        `# ${f.name}\n\n${f.description ?? ''}\n\n` +
          '## 导入与运行\n\n' +
          '在模板库导入此完整 ZIP，核对入口、资源和动作后创建自己的实例。无需解包或复制额外脚本。\n\n' +
          '通过参数与资源页面填写自己的参数、选择本机目录、浏览器或 AI 服务，并单独确认当前入口的动作权限。' +
          '公开包不携带凭据、绑定、运行历史或既有授权，所有写动作默认禁止。\n\n' +
          '按入口步骤运行，在运行详情核对实际结果。失败、取消或结果未知时先核对原记录，不能凭运行结束推断外部动作成功。\n\n' +
          '## 编辑与更新\n\n' +
          '从模板制作工作区复制准确版本后继续维护并导出新版本；已有实例和运行快照保持固定。\n',
      ),
    );
  m.files = [...files]
    .map(([path, b]) => ({ path, size: b.length, sha256: sha256(b) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  m.contentDigest = manifestDigest(m);
  json('manifest.json', m);
  return validatePackage(files);
}
