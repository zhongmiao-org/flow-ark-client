import { transform } from 'esbuild';
import {
  validateAuthorDefinition,
  validateAuthorMetadata,
  AUTHOR_METADATA_PATH,
} from '../../contracts/template-authoring';
import {
  canonical,
  manifestDigest,
  sha256,
  validatePackage,
  materializeFlow,
  jsonFile,
  type PackageData,
  type Manifest,
} from '../../contracts/package-format';
import type { AuthorDefinition, AuthorEntry } from '../shared/template-author';
import { promptMarker } from '../shared/template-author';
import type { Flow, Json } from '../shared/types';
import { validateFlow, walk, capabilities } from '../core/validate';
import { declareNativeBoundaries } from './export-boundaries';
import { schemaDefaults } from '../shared/template-config';
import { assertPortableSourceFlow } from './source-boundaries';

function neutralParameters(parameters: Flow['parameters']): Flow['parameters'] {
  const neutral = (v: Json): Json =>
    Array.isArray(v)
      ? v.map(neutral)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, c]) => [k, neutral(c)]))
        : typeof v === 'string'
          ? ''
          : typeof v === 'number'
            ? 0
            : typeof v === 'boolean'
              ? false
              : null;
  return Object.fromEntries(Object.entries(parameters).map(([k, v]) => [k, neutral(v)]));
}
export function neutralFlow(input: Flow): Flow {
  const f = structuredClone(validateFlow(input));
  delete f.sourceTemplate;
  f.parameters = neutralParameters(f.parameters);
  assertPortableSourceFlow(f);
  return f;
}
export function expandAuthorFlow(d: AuthorDefinition, e: AuthorEntry): Flow {
  const flow = structuredClone(e.flow) as Flow;
  assertPortableSourceFlow(flow);
  for (const binding of e.promptBindings) {
    const node = walk(flow.steps).find((n) => n.id === binding.nodeId),
      p = d.prompts.find((p) => p.id === binding.promptId);
    if (
      !node ||
      !p ||
      !['ai', 'conversation', 'source-reduce'].includes(node.type) ||
      !('instructions' in node)
    )
      throw Error('提示词目标不可用');
    node.instructions = p.body;
  }
  return flow;
}
/** Project public field definitions into an editable/run input shape. Never copy source values. */
export function authorInputFlow(e: AuthorEntry, input: Flow): Flow {
  const flow = structuredClone(input);
  delete flow.sourceTemplate;
  flow.parameters = neutralParameters(flow.parameters);
  const project = (schema: any, shape: Json | undefined): Json => {
    if (Object.hasOwn(schema, 'const')) return structuredClone(schema.const);
    if (Object.hasOwn(schema, 'default')) return structuredClone(schema.default);
    if (schema.type === 'object' || schema.properties) {
      const source = shape && typeof shape === 'object' && !Array.isArray(shape) ? shape : {};
      const result: Record<string, Json> =
        schema.additionalProperties === false ? {} : { ...source };
      for (const [key, child] of Object.entries(schema.properties ?? {}))
        result[key] = project(child, source[key]);
      return result;
    }
    if (schema.type === 'array')
      return Array.isArray(shape) ? shape.map((v) => project(schema.items ?? {}, v)) : [];
    if (!schema.type && !schema.enum && !schema.oneOf && shape !== undefined) return shape;
    return schemaDefaults(schema);
  };
  const schema = e.inputSchema as any;
  if (schema.type && schema.type !== 'object')
    throw Error('入口输入须为对象，才能作为流程参数：' + e.id);
  flow.parameters = project(
    schema.type || schema.properties ? schema : { ...schema, type: 'object' },
    flow.parameters,
  ) as Flow['parameters'];
  return validateFlow(flow);
}
export async function compileAuthor(input: AuthorDefinition): Promise<PackageData> {
  const d = structuredClone(validateAuthorDefinition(input)) as AuthorDefinition;
  if (!d.entries.length) throw Error('请至少添加一个入口后再导出');
  const files = new Map<string, Buffer>(),
    used = new Set<string>();
  const put = (path: string, value: Buffer) => {
    if (used.has(path.toLowerCase())) throw Error('公开文件与生成路径冲突：' + path);
    used.add(path.toLowerCase());
    files.set(path, value);
  };
  const json = (path: string, value: unknown) => put(path, Buffer.from(canonical(value)));
  const m: Manifest = {
    packageFormat: '2.0',
    ...d.metadata,
    sdkVersion: '1.0',
    configurationSchema: 'schemas/configuration.json',
    stateSchema: 'schemas/state.json',
    entries: [],
    resources: structuredClone(d.resources),
    actions: structuredClone(d.actions),
    files: [],
    scripts: [],
    dependencies: structuredClone(d.dependencies),
    contentDigest: '',
  };
  json(m.configurationSchema, d.configurationSchema);
  json(m.stateSchema, d.stateSchema);
  put('README.md', Buffer.from(d.readme));
  const bindings: { entryId: string; nodeId: string; field: 'instructions'; promptId: string }[] =
    [];
  for (const e of d.entries) {
    const flow = authorInputFlow(e, expandAuthorFlow(d, e));
    flow.id = e.id;
    flow.name = e.name;
    const unsupported = [...new Set([...flow.requiredCapabilities, ...e.capabilities])].filter(
      (c) => !capabilities.includes(c),
    );
    if (unsupported.length) throw Error('当前客户端缺少入口能力：' + unsupported.join('、'));
    const entry: Manifest['entries'][number] = {
      id: e.id,
      name: e.name,
      flow: `flows/${e.id}.json`,
      inputSchema: `schemas/entries/${e.id}.input.json`,
      resultSchema: `schemas/entries/${e.id}.result.json`,
      schedulable: e.schedulable,
      capabilities: [...new Set([...flow.requiredCapabilities, ...e.capabilities])],
      resources: [...e.resourceIds],
      actions: [],
    };
    m.entries.push(entry);
    declareNativeBoundaries(flow, m, entry.id);
    entry.actions = [...new Set([...entry.actions, ...e.actionIds])];
    for (const n of walk(flow.steps))
      if (n.type === 'script') {
        if (n.dependencies.length) throw Error('入口脚本依赖须先静态打包：' + e.id + '/' + n.id);
        const path = `scripts/author/${e.id}/${n.id}.js`;
        const code = (
          await transform(n.code, {
            loader: n.language === 'ts' ? 'ts' : 'js',
            format: 'esm',
            target: 'node24',
          })
        ).code;
        put(path, Buffer.from(code));
        m.scripts.push(path);
        n.code = '@package:' + path;
        n.language = 'js';
      }
    json(entry.flow, flow);
    json(entry.inputSchema, e.inputSchema);
    json(entry.resultSchema, e.resultSchema);
    bindings.push(...e.promptBindings.map((b) => ({ entryId: e.id, ...b })));
  }
  for (const p of d.prompts) put(`prompts/${p.id}.md`, Buffer.from(p.body));
  json(AUTHOR_METADATA_PATH, {
    version: 1,
    prompts: d.prompts.map((p) => ({ id: p.id, name: p.name, path: `prompts/${p.id}.md` })),
    bindings,
  });
  for (const a of d.assets) {
    put(a.path, Buffer.from(a.body, a.encoding === 'base64' ? 'base64' : 'utf8'));
    if (a.path.startsWith('scripts/')) {
      await transform(files.get(a.path)!.toString('utf8'), { loader: 'js', format: 'esm' });
      m.scripts.push(a.path);
    }
  }
  m.files = [...files]
    .map(([path, b]) => ({ path, size: b.length, sha256: sha256(b) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  m.contentDigest = manifestDigest(m);
  json('manifest.json', m);
  return validatePackage(files);
}
export function authorFromPackage(pkg: PackageData, identity: string): AuthorDefinition {
  validatePackage(pkg.files);
  validateAuthorMetadata(pkg.files, pkg.manifest);
  const m = pkg.manifest,
    managed = new Set([
      'manifest.json',
      'README.md',
      m.configurationSchema,
      m.stateSchema,
      AUTHOR_METADATA_PATH,
    ]);
  const decode = (bytes: Buffer) =>
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const metadata = pkg.files.has(AUTHOR_METADATA_PATH)
    ? jsonFile(pkg.files, AUTHOR_METADATA_PATH)
    : { prompts: [], bindings: [] };
  const prompts = metadata.prompts.map((p: any) => {
    managed.add(p.path);
    return { id: p.id, name: p.name, body: decode(pkg.files.get(p.path)!) };
  });
  const entries: AuthorEntry[] = m.entries.map((e) => {
    managed.add(e.flow);
    managed.add(e.inputSchema);
    managed.add(e.resultSchema);
    const original = jsonFile(pkg.files, e.flow);
    for (const n of walk(original.steps))
      if (n.type === 'script' && n.code.startsWith('@package:')) managed.add(n.code.slice(9));
    const flow = neutralFlow(materializeFlow(pkg, e.id));
    const promptBindings = metadata.bindings
      .filter((b: any) => b.entryId === e.id)
      .map(({ entryId: _entryId, ...b }: any) => b);
    for (const b of promptBindings) {
      const n = walk(flow.steps).find((n) => n.id === b.nodeId)!;
      if ('instructions' in n) n.instructions = promptMarker(b.promptId);
    }
    return {
      id: e.id,
      name: e.name,
      schedulable: e.schedulable,
      flow: flow as AuthorEntry['flow'],
      inputSchema: jsonFile(pkg.files, e.inputSchema),
      resultSchema: jsonFile(pkg.files, e.resultSchema),
      capabilities: e.capabilities,
      resourceIds: e.resources,
      actionIds: e.actions,
      promptBindings,
    };
  });
  const assets = [...pkg.files]
    .filter(([path]) => !managed.has(path))
    .map(([path, bytes]) => {
      try {
        return { path, encoding: 'utf8' as const, body: decode(bytes) };
      } catch {
        return { path, encoding: 'base64' as const, body: bytes.toString('base64') };
      }
    });
  return validateAuthorDefinition({
    version: 1,
    metadata: {
      id: identity,
      name: m.name,
      description: m.description,
      version: '1.0.0',
      author: 'local',
      source: m.source,
      minimumClientVersion: m.minimumClientVersion,
    },
    configurationSchema: jsonFile(pkg.files, m.configurationSchema),
    stateSchema: jsonFile(pkg.files, m.stateSchema),
    entries,
    resources: m.resources,
    actions: m.actions,
    prompts,
    readme: pkg.files.has('README.md') ? decode(pkg.files.get('README.md')!) : '',
    assets,
    dependencies: m.dependencies,
  }) as AuthorDefinition;
}
