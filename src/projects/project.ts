import { constants as fsConstants } from 'node:fs';
import { open, lstat, realpath, mkdir, rename, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { build } from 'esbuild';
import { z } from 'zod';
import Ajv from 'ajv/dist/2020.js';
import manifestSchema from '../../contracts/local-project-v1.schema.json';
import { authorFromPackage, compileAuthor, authorInputFlow } from '../templates/author-compiler';
import { archiveBytes, readArchive } from '../templates/archive';
import { assertStandalonePackage } from '../templates/standalone';
import { validatePackage, canonical, manifestDigest, type PackageData } from '../../contracts/package-format';
import type { AuthorDefinition } from '../shared/template-author';
import type { Step, Json } from '../shared/types';
import { validateFlow } from '../core/validate';
import { assertJson, object, ProjectDiagnostic, parseEnvironment, resolveConfiguration } from './configuration';
import { compileGraph, emitGraph } from './graph';
import { checkProjectScripts, ScriptDiagnostics } from './script-check';

const env = z.object({ variable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), field: z.string().min(1),
  type: z.enum(['string', 'number', 'integer', 'boolean', 'json']) }).strict();
export const projectSchema = z.object({
  projectVersion: z.literal(1), metadata: z.record(z.string(), z.unknown()),
  configurationSchema: z.literal('schemas/configuration.json'), stateSchema: z.string(),
  constants: z.literal('config/constants.json'), defaults: z.literal('config/defaults.json'),
  entries: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), name: z.string().min(1),
    graph: z.string(), nodes: z.string(), inputSchema: z.string(), resultSchema: z.string(),
    parameters: z.record(z.string(), z.unknown()).default({}),
    capabilities: z.array(z.string()).default([]), resourceIds: z.array(z.string()).default([]),
    actionIds: z.array(z.string()).default([]), batching: z.unknown().optional(), schedulable: z.boolean().default(false),
  }).strict()).min(1).max(100),
  resources: z.array(z.unknown()).default([]), actions: z.array(z.unknown()).default([]),
  prompts: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() }).strict()).default([]),
  promptBindings: z.record(z.string(), z.array(z.unknown())).default({}),
  dependencies: z.array(z.unknown()).default([]),
  environment: z.array(env).max(100).default([]),
  publicFiles: z.array(z.string()).min(1).max(2000),
}).strict();
export type LocalProjectManifest = z.infer<typeof projectSchema>;
export type ProjectSnapshot = { revision: string; manifest: LocalProjectManifest; files: Map<string, Buffer> };
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const text = (v: Buffer) => new TextDecoder('utf8', { fatal: true }).decode(v);
function pathName(path: string, privateFile = false) {
  if (path.length > 240 || !/^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/.test(path) ||
      path.split('/').some(p => !p || p === '.' || p === '..') ||
      path.split('/').some(p => ['.git', 'node_modules'].includes(p)) ||
      (!privateFile && (path.startsWith('.flowark/') || (/(^|\/)\.env(?:\.|$)/.test(path) && path !== '.env.example'))))
    throw new ProjectDiagnostic('project-path', '无效或非公开工程路径', path);
  return path;
}
async function readFile(root: string, name: string, privateFile = false): Promise<Buffer> {
  pathName(name, privateFile);
  let at = root;
  for (const part of name.split('/')) {
    at = join(at, part);
    if ((await lstat(at)).isSymbolicLink()) throw new ProjectDiagnostic('project-symlink', '工程文件不允许符号链接', name);
  }
  const file = await open(at, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 2 * 1024 * 1024) throw new ProjectDiagnostic('project-file-size', '工程单文件须为不超过2MiB的普通文件', name);
    const data = await file.readFile(), after = await file.stat();
    if (data.length !== before.size || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new ProjectDiagnostic('project-file-changed', '读取期间文件变化，请重新检查', name);
    return data;
  } finally { await file.close(); }
}
function json(bytes: Buffer, name: string): any {
  try { const value = JSON.parse(text(bytes)); assertJson(value); return value; }
  catch (error) { if (error instanceof ProjectDiagnostic) throw error; throw new ProjectDiagnostic('project-json', '无效JSON文件', name); }
}
export async function projectRoot(path: string) {
  const root = await realpath(path), stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProjectDiagnostic('project-root', '请选择真实工程目录');
  return root;
}
export async function snapshotProject(path: string): Promise<ProjectSnapshot> {
  const root = await projectRoot(path);
  try { await lstat(join(root, '.flowark/transaction.json')); throw new ProjectDiagnostic('project-transaction-pending', '工程有未完成写入，请先核对恢复，不采用部分更新'); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  const manifestBytes = await readFile(root, 'flowark.project.json');
  const value = json(manifestBytes, 'flowark.project.json');
  const contract = new Ajv({ strict: false, allErrors: true, logger: false }).compile(manifestSchema);
  if (!contract(value)) throw new ProjectDiagnostic('project-manifest', '工程清单不符合v1契约', 'flowark.project.json');
  const parsed = projectSchema.safeParse(value);
  if (!parsed.success) throw new ProjectDiagnostic('project-manifest', parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('；'), 'flowark.project.json');
  const manifest = parsed.data, files = new Map<string, Buffer>([['flowark.project.json', manifestBytes]]);
  if (new Set(manifest.entries.map(e => e.id)).size !== manifest.entries.length ||
      new Set(manifest.publicFiles.map(p => p.toLowerCase())).size !== manifest.publicFiles.length)
    throw new ProjectDiagnostic('project-duplicate', '入口ID或公开路径重复', 'flowark.project.json');
  let size = manifestBytes.length;
  for (const name of manifest.publicFiles) {
    if (name === 'flowark.project.json') continue;
    const bytes = await readFile(root, name); size += bytes.length;
    if (size > 16 * 1024 * 1024) throw new ProjectDiagnostic('project-size', '工程公开文件累计超过16MiB');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[a-zA-Z0-9]{24,}/.test(bytes.toString('utf8')))
      throw new ProjectDiagnostic('project-secret', '公开文件包含疑似真实密钥，请使用受保护凭据引用', name);
    files.set(name, bytes);
  }
  if (!manifestBytes.equals(await readFile(root, 'flowark.project.json')))
    throw new ProjectDiagnostic('project-changed', '工程清单读取期间变化');
  return { manifest, files, revision: hash(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)).map(([p, b]) => [p, hash(b)]))) };
}
function required(snapshot: ProjectSnapshot, name: string): Buffer {
  const bytes = snapshot.files.get(name);
  if (!bytes) throw new ProjectDiagnostic('project-unlisted-file', '引用文件必须存在且列入publicFiles', name);
  return bytes;
}
function resolveConstants(value: any, constants: Record<string, Json>): any {
  if (Array.isArray(value)) return value.map(v => resolveConstants(v, constants));
  if (!object(value)) return value;
  if (Object.hasOwn(value, '$constant')) {
    if (Object.keys(value).length !== 1 || typeof value.$constant !== 'string') throw new ProjectDiagnostic('constant-reference', '常量引用须为单独的$constant字段');
    let found: any = constants;
    for (const part of value.$constant.split('.')) {
      if (!object(found) || !Object.hasOwn(found, part)) throw new ProjectDiagnostic('constant-missing', '常量不存在', 'config/constants.json', value.$constant);
      found = found[part];
    }
    return structuredClone(found);
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveConstants(v, constants)]));
}
async function wrapScript(snapshot: ProjectSnapshot, path: string, constants: Record<string, Json>) {
  pathName(path); required(snapshot, path);
  const result = await build({
    stdin: { contents: `import main from 'flowark:user-entry';const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};const constants=freeze(${JSON.stringify(constants)});export default ctx=>main(Object.freeze({...ctx,constants}));`, loader: 'js' },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24', charset: 'utf8', minifyWhitespace: true,
    logLevel: 'silent', plugins: [{ name: 'flowark-project-modules', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if (args.path === 'flowark:user-entry') return { path, namespace: 'project' };
        if (isBuiltin(args.path)) return { path: args.path, external: true };
        if (!args.path.startsWith('.')) throw new ProjectDiagnostic('project-dependency', '只允许内置模块或已明确静态打包的工程模块', args.path);
        const file = relative('/project', resolve('/project', dirname(args.importer), args.path)).split(sep).join('/');
        pathName(file);
        const found = [file, file + '.ts', file + '.js', file + '/index.ts', file + '/index.js'].find(p => snapshot.files.has(p));
        if (!found) throw new ProjectDiagnostic('project-module', '找不到已声明工程模块', file);
        return { path: found, namespace: 'project' };
      });
      b.onLoad({ filter: /.*/, namespace: 'project' }, args => ({ contents: text(required(snapshot, args.path)), loader: args.path.endsWith('.ts') ? 'ts' : 'js' }));
    } }],
  });
  if (result.warnings.length) throw new ProjectDiagnostic('project-script', '脚本依赖无法静态确定', path);
  return result.outputFiles[0].text;
}
export async function compileProject(snapshot: ProjectSnapshot): Promise<AuthorDefinition> {
  const m = snapshot.manifest, read = (path: string) => json(required(snapshot, path), path);
  const constants = read(m.constants), defaults = read(m.defaults);
  if (!object(constants) || !object(defaults)) throw new ProjectDiagnostic('project-config-object', '常量与默认配置必须为对象');
  const configurationSchema = read(m.configurationSchema);
  // Public defaults may deliberately leave a required user field empty. Full
  // constraints are enforced by configurationForProject before a run, not export.
  if (!object(configurationSchema) || !object(configurationSchema.properties) ||
      Object.keys(defaults).some(k => !Object.hasOwn(configurationSchema.properties as object, k)))
    throw new ProjectDiagnostic('project-defaults', '公开默认配置包含未声明字段', m.defaults);
  const checkDefaults = (schema: any, value: any, path = '') => {
    const allowed: any = { ...(schema.type ? { type: schema.type } : {}), ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([k, v]: [string, any]) => [k, { type: v.type }]).filter(([, v]: any) => v.type)) } : {}), additionalProperties: schema.additionalProperties };
    if (schema.items) allowed.items = { ...(schema.items.type ? { type: schema.items.type } : {}) };
    if (!new Ajv({ strict: false, logger: false }).compile(allowed)(value)) throw new ProjectDiagnostic('project-default-type', '默认值类型或字段不符', m.defaults, path);
    if (object(value) && schema.properties) for (const [key, child] of Object.entries(value)) if (schema.properties[key]) checkDefaults(schema.properties[key], child, path + '/' + key);
  };
  checkDefaults(configurationSchema, defaults);
  const schemaDefaults = (schema: any, value: any): any => {
    const result = structuredClone(schema);
    if (object(value) && result.properties) for (const key of Object.keys(value)) {
      if (result.properties[key]) result.properties[key] = schemaDefaults(result.properties[key], value[key]);
    }
    result.default = value; return result;
  };
  const scriptEntries: {path:string;entryId:string;nodeId:string}[]=[];
  const entries: AuthorDefinition['entries'] = [];
  for (const entry of m.entries) {
    const bindings = read(entry.nodes);
    if (!object(bindings)) throw new ProjectDiagnostic('node-bindings', '节点绑定必须为对象', entry.nodes);
    const nodes: Record<string, Step> = {};
    for (const [id, value] of Object.entries(bindings)) {
      if (!object(value) || !object(value.node) || Object.keys(value).some(k => !['node', 'script'].includes(k)))
        throw new ProjectDiagnostic('node-binding', '节点绑定须包含node及可选script', entry.nodes, id);
      const node = resolveConstants(value.node, constants);
      if (node.id !== id || node.then !== undefined || node.else !== undefined || node.body !== undefined)
        throw new ProjectDiagnostic('node-binding', '节点ID不一致或结构应由Mermaid定义', entry.nodes, id);
      if (node.type === 'script') {
        if (typeof value.script !== 'string' || node.code !== undefined) throw new ProjectDiagnostic('node-script', '脚本节点只绑定工程script路径', entry.nodes, id);
        scriptEntries.push({path:value.script,entryId:entry.id,nodeId:id});
        node.code = await wrapScript(snapshot, value.script, constants); node.language = 'js';
      } else if (value.script !== undefined) throw new ProjectDiagnostic('node-script', '非脚本节点不能绑定script', entry.nodes, id);
      nodes[id] = node;
    }
    const flow = validateFlow({ formatVersion: '1.0', id: entry.id, name: entry.name, description: '', parameters: entry.parameters,
      requiredCapabilities: entry.capabilities, steps: compileGraph(text(required(snapshot, entry.graph)), nodes, entry.graph) });
    entries.push({ id: entry.id, name: entry.name, schedulable: entry.schedulable,
      flow, inputSchema: read(entry.inputSchema), resultSchema: read(entry.resultSchema),
      capabilities: entry.capabilities, resourceIds: entry.resourceIds, actionIds: entry.actionIds,
      ...(entry.batching ? { batching: entry.batching } : {}),
      promptBindings: m.promptBindings[entry.id] ?? [] } as AuthorDefinition['entries'][number]);
  }
  const typeIssues=await checkProjectScripts(snapshot.files,scriptEntries);if(typeIssues.length)throw new ScriptDiagnostics(typeIssues);
  const consumed = new Set(['flowark.project.json', 'README.md', m.configurationSchema, m.stateSchema, m.constants, m.defaults, '.env.example',
    ...m.entries.flatMap(e => [e.graph, e.nodes, e.inputSchema, e.resultSchema]), ...m.prompts.map(p => p.path)]);
  const assets = [...snapshot.files].filter(([p]) => !consumed.has(p) && !p.startsWith('scripts/')).map(([path, bytes]) => {
    try { return { path, encoding: 'utf8' as const, body: text(bytes) }; }
    catch { return { path, encoding: 'base64' as const, body: bytes.toString('base64') }; }
  });
  // Constants are public immutable input; scripts receive the same fixed values as ctx.constants.
  assets.push({ path: 'assets/project/constants.json', encoding: 'utf8', body: JSON.stringify(constants) });
  const definition = { version: 1, metadata: m.metadata, configurationSchema: schemaDefaults(configurationSchema, defaults),
    stateSchema: read(m.stateSchema), entries, resources: m.resources, actions: m.actions,
    prompts: m.prompts.map(p => ({ id: p.id, name: p.name, body: text(required(snapshot, p.path)) })),
    readme: text(required(snapshot, 'README.md')), assets, dependencies: m.dependencies } as AuthorDefinition;
  // Reuse the normative compiler and full package checks rather than a second runtime.
  await compileAuthor(definition);
  return definition;
}
/** Compile an in-memory draft using the normative compiler; never writes or runs it. */
export async function diagnoseProject(path: string, revision: string, changes: { path: string; content: string }[]) {
  const before = await snapshotProject(path);
  if (before.revision !== revision) throw new ProjectDiagnostic('project-conflict', '工程已变化，请核对磁盘差异');
  const candidate = { ...before, files: new Map(before.files) };
  try {
    for (const change of changes) {
      pathName(change.path);
      if (!before.files.has(change.path)) throw new ProjectDiagnostic('project-unlisted-file', '只检查已声明文件', change.path);
      candidate.files.set(change.path, Buffer.from(change.content));
    }
    candidate.manifest = projectSchema.parse(json(required(candidate, 'flowark.project.json'), 'flowark.project.json'));
    await compileProject(candidate);
    if ((await snapshotProject(path)).revision !== revision) throw new ProjectDiagnostic('project-conflict', '检查期间磁盘变化');
    return { valid: true, revision, draft: changes.length > 0, diagnostics: [] };
  } catch (error: any) {
    if (error.code === 'project-conflict') throw error;
    const diagnostics = error.errors?.map((e: any) => ({ code: 'project-script', message: e.text,
      file: e.location?.file?.replace(/^project:/, ''), line: e.location?.line, column: e.location ? e.location.column + 1 : undefined })) ??
      [{ code: error.code ?? 'project-invalid', message: error.message, file: error.file, field: error.field, line: error.line, column: error.column }];
    for (const d of diagnostics) {
      const entry = candidate.manifest.entries.find(e => [e.graph, e.nodes, e.inputSchema, e.resultSchema].includes(d.file));
      if (entry) d.entryId = entry.id;
      else for (const e of candidate.manifest.entries) {
        try {
          const bindings = json(required(candidate, e.nodes), e.nodes);
          const match = Object.entries(bindings).find(([, value]: [string, any]) => value.script === d.file);
          if (match) { d.entryId = e.id; d.field ??= match[0]; break; }
        } catch { /* Preserve the original diagnostic if an unrelated binding is invalid. */ }
      }
    }
    return { valid: false, revision, draft: changes.length > 0, diagnostics };
  }
}
export async function buildProject(path: string, expectedRevision?: string) {
  const snapshot = await snapshotProject(path);
  if (expectedRevision && snapshot.revision !== expectedRevision) throw new ProjectDiagnostic('project-conflict', '工程已变化，请读取差异，不覆盖');
  const definition = await compileProject(snapshot), pkg = await compileProjectPackage(snapshot, definition);
  await assertStandalonePackage(pkg);
  const after = await snapshotProject(path);
  if (after.revision !== snapshot.revision) throw new ProjectDiagnostic('project-conflict', '构建期间工程变化，未采用');
  return { snapshot, definition, pkg };
}
const sourceIndexPath = 'assets/project-source-v1.json';
export async function compileProjectPackage(snapshot: ProjectSnapshot, definition: AuthorDefinition) {
  const pkg = await compileAuthor(definition), files = new Map(pkg.files);
  if (snapshot.files.has(sourceIndexPath)) throw new ProjectDiagnostic('project-reserved-file', '工程源码索引由编译器生成，不手工维护', sourceIndexPath);
  const records = [...snapshot.files].map(([path, bytes]) => {
    try { return { path, sha256: hash(bytes), text: text(bytes) }; }
    catch {
      if (!files.get(path)?.equals(bytes)) throw new ProjectDiagnostic('project-source-asset', '二进制源码资源未原样进入公开包', path);
      return { path, sha256: hash(bytes), asset: path };
    }
  });
  const source = Buffer.from(JSON.stringify({ version: 1, revision: snapshot.revision, files: records }));
  const index = { version: 1, encoding: 'gzip-base64', sha256: hash(source), body: gzipSync(source).toString('base64') };
  files.set(sourceIndexPath, Buffer.from(JSON.stringify(index)));
  const manifest = structuredClone(pkg.manifest);
  manifest.files = [...files].filter(([path]) => path !== 'manifest.json').map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes) })).sort((a, b) => a.path.localeCompare(b.path));
  manifest.contentDigest = manifestDigest(manifest);
  files.set('manifest.json', Buffer.from(canonical(manifest)));
  return validatePackage(files);
}
async function restoreProjectSource(pkg: PackageData, destination: string) {
  const envelope = json(pkg.files.get(sourceIndexPath)!, sourceIndexPath);
  if (envelope.version !== 1 || envelope.encoding !== 'gzip-base64' || typeof envelope.body !== 'string' || envelope.body.length > 8 * 1024 * 1024)
    throw new ProjectDiagnostic('project-source-index', '公开工程源码索引无效');
  const bytes = gunzipSync(Buffer.from(envelope.body, 'base64'), { maxOutputLength: 16 * 1024 * 1024 });
  if (hash(bytes) !== envelope.sha256) throw new ProjectDiagnostic('project-source-digest', '公开源码摘要不符');
  const source = json(bytes, sourceIndexPath);
  if (source.version !== 1 || !Array.isArray(source.files) || source.files.length > 2001) throw new ProjectDiagnostic('project-source-index', '公开源码文件清单无效');
  const target = resolve(destination), staging = target + '.preparing-' + randomUUID();
  await mkdir(dirname(target), { recursive: true }); await mkdir(staging, { mode: 0o700 });
  try {
    const seen = new Set<string>();
    for (const record of source.files) {
      const name = pathName(record.path);
      if (seen.has(name.toLowerCase())) throw new ProjectDiagnostic('project-source-duplicate', '源码路径重复', name);
      seen.add(name.toLowerCase());
      const data = typeof record.text === 'string' ? Buffer.from(record.text) : record.asset === name ? pkg.files.get(name) : undefined;
      if (!data || hash(data) !== record.sha256) throw new ProjectDiagnostic('project-source-digest', '源码文件摘要不符', name);
      await writeExclusive(join(staging, name), data);
    }
    await writeExclusive(join(staging, '.gitignore'), Buffer.from('.flowark/\n.env\n.env.*\n!.env.example\n'));
    if ((await snapshotProject(staging)).revision !== source.revision) throw new ProjectDiagnostic('project-source-digest', '源码工程修订不符');
    await buildProject(staging);
    try { await lstat(target); throw new ProjectDiagnostic('project-exists', '目标目录已存在，不覆盖'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, target);
    return { root: target, ...await projectInfo(target) };
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
async function writeExclusive(path: string, bytes: Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
export async function projectFromZip(zip: string, destination: string) {
  const pkg = await readArchive(zip);
  if (pkg.files.has(sourceIndexPath)) return restoreProjectSource(pkg, destination);
  const d = await authorFromPackage(pkg, pkg.manifest.id);
  d.metadata = { ...d.metadata, id: pkg.manifest.id, version: pkg.manifest.version, author: pkg.manifest.author };
  const files = new Map<string, Buffer>(), encode = (p: string, v: unknown) => files.set(p, Buffer.from(JSON.stringify(v, null, 2) + '\n'));
  const entries: LocalProjectManifest['entries'] = [];
  for (const e of d.entries) {
    const result = emitGraph(e.flow.steps), bindings: Record<string, unknown> = {};
    for (const [id, original] of Object.entries(result.nodes)) {
      const node = structuredClone(original);
      if (node.type === 'script') {
        const path = `scripts/${e.id}/${id}.${node.language}`;
        files.set(path, Buffer.from(node.code)); delete (node as any).code;
        bindings[id] = { node, script: path };
      } else bindings[id] = { node };
    }
    const graph = `flows/${e.id}.mmd`, nodes = `nodes/${e.id}.json`, inputSchema = `schemas/inputs/${e.id}.json`, resultSchema = `schemas/results/${e.id}.json`;
    files.set(graph, Buffer.from(result.mermaid)); encode(nodes, bindings); encode(inputSchema, e.inputSchema); encode(resultSchema, e.resultSchema);
    entries.push({ id: e.id, name: e.name, graph, nodes, inputSchema, resultSchema, parameters: e.flow.parameters,
      capabilities: e.capabilities, resourceIds: e.resourceIds, actionIds: e.actionIds, schedulable: e.schedulable,
      ...(e.batching ? { batching: e.batching } : {}) });
  }
  for (const asset of d.assets) files.set(asset.path, Buffer.from(asset.body, asset.encoding === 'base64' ? 'base64' : 'utf8'));
  for (const p of d.prompts) files.set('prompts/' + p.id + '.md', Buffer.from(p.body));
  files.set('README.md', Buffer.from(d.readme));
  encode('schemas/configuration.json', d.configurationSchema); encode('schemas/state.json', d.stateSchema);
  encode('config/constants.json', {});
  const defaults = (schema: any): any => Object.hasOwn(schema, 'default') ? schema.default : schema.properties ? Object.fromEntries(Object.entries(schema.properties).filter(([, s]: any) => Object.hasOwn(s, 'default') || s.properties).map(([k, s]) => [k, defaults(s)])) : undefined;
  encode('config/defaults.json', defaults(d.configurationSchema) ?? {});
  const manifest: LocalProjectManifest = { projectVersion: 1, metadata: d.metadata, configurationSchema: 'schemas/configuration.json', stateSchema: 'schemas/state.json',
    constants: 'config/constants.json', defaults: 'config/defaults.json', entries, resources: d.resources, actions: d.actions,
    prompts: d.prompts.map(p => ({ id: p.id, name: p.name, path: 'prompts/' + p.id + '.md' })),
    promptBindings: Object.fromEntries(d.entries.map(e => [e.id, e.promptBindings])), dependencies: d.dependencies, environment: [], publicFiles: [...files.keys()] };
  encode('flowark.project.json', manifest);
  const target = resolve(destination), staging = target + '.preparing-' + randomUUID();
  await mkdir(dirname(target), { recursive: true });
  await mkdir(staging, { recursive: false, mode: 0o700 });
  try {
    for (const [name, bytes] of files) await writeExclusive(join(staging, pathName(name)), bytes);
    await writeExclusive(join(staging, '.gitignore'), Buffer.from('.flowark/\n.env\n.env.*\n!.env.example\n'));
    await buildProject(staging);
    // Destination must be new: do not replace another user's project.
    try { await lstat(target); throw new ProjectDiagnostic('project-exists', '目标目录已存在，不覆盖'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, target);
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
  return { root: target, ...(await projectInfo(target)) };
}
export async function createProject(destination: string, id: string, name: string) {
  if (!/^[a-z][a-z0-9-]{0,99}$/.test(id) || !name.trim() || name.length > 200) throw new ProjectDiagnostic('project-identity', '项目标识或名称无效');
  const schema = { type: 'object', properties: {}, additionalProperties: false };
  const definition: AuthorDefinition = {
    version: 1, metadata: { id, name, version: '1.0.0', author: 'local', source: 'local', description: '本地流程工程', minimumClientVersion: '0.3.1' },
    configurationSchema: schema, stateSchema: schema,
    entries: [{ id: 'main', name: '主流程', schedulable: false, flow: { formatVersion: '1.0', id: 'main', name: '主流程', description: '', parameters: {},
      requiredCapabilities: [], steps: [{ id: 'result', type: 'value', version: 1, name: '处理结果', value: null }] },
      inputSchema: schema, resultSchema: { type: 'object' }, capabilities: [], resourceIds: [], actionIds: [], promptBindings: [] }],
    resources: [], actions: [], prompts: [], assets: [], dependencies: [], readme: '# ' + name + '\n\n本地工程。先编辑和检查，再核对运行；不默认授权写入。\n',
  };
  const pkg = await compileAuthor(definition), directory = await mkdtemp(join(tmpdir(), 'flowark-project-create-'));
  try { const zip = join(directory, 'project.zip'); await writeExclusive(zip, await archiveBytes(pkg)); return await projectFromZip(zip, destination); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
export async function projectInfo(path: string) {
  const snapshot = await snapshotProject(path);
  return { revision: snapshot.revision, metadata: snapshot.manifest.metadata, entries: snapshot.manifest.entries.map(e => ({ id: e.id, name: e.name })), files: [...snapshot.files].map(([path, b]) => ({ path, size: b.length, sha256: hash(b) })) };
}
export async function packageProject(path: string, destination: string, revision?: string) {
  const { snapshot, pkg } = await buildProject(path, revision), bytes = await archiveBytes(pkg);
  if (!destination.endsWith('.zip')) throw new ProjectDiagnostic('package-extension', '输出必须为ZIP');
  await writeExclusive(destination, bytes);
  return { revision: snapshot.revision, path: destination, size: bytes.length, sha256: hash(bytes), contentDigest: pkg.manifest.contentDigest };
}
export async function configurationForProject(path: string, request: { instance?: Json; profile?: string; overrides?: Json }) {
  const root = await projectRoot(path), snapshot = await snapshotProject(root), m = snapshot.manifest;
  let profile: Json | undefined, environment: Json | undefined;
  if (request.profile) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(request.profile)) throw new ProjectDiagnostic('profile-name', '无效开发配置名称');
    profile = json(await readFile(root, '.flowark/profiles/' + request.profile + '.json', true), 'profile');
    try { environment = parseEnvironment(text(await readFile(root, '.env.local', true)), m.environment); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  return { revision: snapshot.revision, value: resolveConfiguration(json(required(snapshot, m.configurationSchema), m.configurationSchema), {
    defaults: json(required(snapshot, m.defaults), m.defaults), instance: request.instance, profile, environment, overrides: request.overrides,
  }), layers: ['defaults', ...(request.instance ? ['instance'] : []), ...(request.profile ? ['profile', 'environment'] : []), ...(request.overrides ? ['overrides'] : [])] };
}

export async function localDirectory(root: string) {
  const path = join(root, '.flowark');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProjectDiagnostic('project-private-path', '本机工程目录不允许符号链接');
  return path;
}
export async function updateProjectFiles(path: string, revision: string, changes: { path: string; content: string }[]) {
  const root = await projectRoot(path), local = await localDirectory(root), lock = join(local, 'write-lock');
  try { await mkdir(lock); } catch { throw new ProjectDiagnostic('project-locked', '已有工程写入正在进行，请先核对'); }
  let committed = false, journalCreated = false;
  const transactionId = randomUUID(), staging = join(local, 'transaction-' + transactionId);
  try {
    const before = await snapshotProject(root);
    if (before.revision !== revision) throw new ProjectDiagnostic('project-conflict', '磁盘与界面修订不一致；请读取差异后合并');
    if (!changes.length || changes.length > 100 || new Set(changes.map(c => c.path.toLowerCase())).size !== changes.length)
      throw new ProjectDiagnostic('project-changes', '每批须为1–100个不重复文件');
    const candidate = { ...before, files: new Map(before.files) };
    for (const change of changes) {
      pathName(change.path);
      if (Buffer.byteLength(change.content) > 2 * 1024 * 1024) throw new ProjectDiagnostic('project-file-size', '修改文件超过2MiB', change.path);
      candidate.files.set(change.path, Buffer.from(change.content));
    }
    candidate.manifest = projectSchema.parse(json(required(candidate, 'flowark.project.json'), 'flowark.project.json'));
    for (const change of changes) if (change.path !== 'flowark.project.json' && !candidate.manifest.publicFiles.includes(change.path))
      throw new ProjectDiagnostic('project-unlisted-file', '修改文件须同时列入publicFiles', change.path);
    for (const name of candidate.manifest.publicFiles) { pathName(name); required(candidate, name); }
    await compileProject(candidate);
    await mkdir(staging, { mode: 0o700 });
    const records: { path: string; before: string | null; after: string }[] = [];
    for (const change of changes) {
      let old: Buffer | undefined;
      try { old = await readFile(root, change.path); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      const bytes = Buffer.from(change.content);
      if (old) await writeExclusive(join(staging, 'before', change.path), old);
      await writeExclusive(join(staging, 'after', change.path), bytes);
      records.push({ path: change.path, before: old ? hash(old) : null, after: hash(bytes) });
    }
    if ((await snapshotProject(root)).revision !== revision) throw new ProjectDiagnostic('project-conflict', '准备写入期间磁盘变化，未覆盖');
    await writeExclusive(join(local, 'transaction.json'), Buffer.from(JSON.stringify({ version: 1, transactionId, revision, records })));
    journalCreated = true;
    for (const record of records) {
      let current: Buffer | undefined;
      try { current = await readFile(root, record.path); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      if ((current ? hash(current) : null) !== record.before) throw new ProjectDiagnostic('project-conflict', '写入前磁盘文件变化，保留事务供核对', record.path);
      await mkdir(dirname(join(root, record.path)), { recursive: true });
      if (!relative(root, await realpath(dirname(join(root, record.path)))).startsWith('..')) {
        await rename(join(staging, 'after', record.path), join(root, record.path));
      } else throw new ProjectDiagnostic('project-path', '写入目录超出工程', record.path);
    }
    for (const record of records) if (hash(await readFile(root, record.path)) !== record.after)
      throw new ProjectDiagnostic('project-write-readback', '文件写后读回不一致，保留事务', record.path);
    await rm(join(local, 'transaction.json')); committed = true;
    return projectInfo(root);
  } finally {
    if (committed || !journalCreated) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
export async function inspectProjectTransaction(path: string) {
  const root = await projectRoot(path);
  const journal = json(await readFile(root, '.flowark/transaction.json', true), 'transaction');
  if (journal.version !== 1 || !/^[a-f0-9-]{36}$/.test(journal.transactionId) || !Array.isArray(journal.records) || journal.records.length > 100)
    throw new ProjectDiagnostic('project-transaction-invalid', '事务记录无法核对');
  return { ...journal, files: await Promise.all(journal.records.map(async (r: any) => {
    pathName(r.path); let current: string | null = null;
    try { current = hash(await readFile(root, r.path)); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    return { path: r.path, status: current === r.after ? 'after' : current === r.before ? 'before' : 'conflict' };
  })) };
}
export async function rollbackProjectTransaction(path: string, transactionId: string) {
  const root = await projectRoot(path), local = await localDirectory(root), lock = join(local, 'write-lock');
  try { await mkdir(lock); } catch { throw new ProjectDiagnostic('project-locked', '已有工程写入正在进行，请先核对'); }
  try {
    const journal = await inspectProjectTransaction(root);
    if (journal.transactionId !== transactionId || journal.files.some((f: any) => f.status === 'conflict'))
      throw new ProjectDiagnostic('project-recovery-conflict', '事务或磁盘变化，不覆盖外部修改');
    const copies = new Map<string, Buffer>();
    for (const record of journal.records) {
      const name = pathName(record.path);
      if (record.before === null) continue;
      const bytes = await readFile(root, '.flowark/transaction-' + transactionId + '/before/' + name, true);
      if (hash(bytes) !== record.before) throw new ProjectDiagnostic('project-recovery-invalid', '恢复副本摘要不一致', name);
      copies.set(name, bytes);
    }
    for (const record of journal.records) {
      const name = pathName(record.path);
      let current: string | null = null;
      try { current = hash(await readFile(root, name)); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      if (current !== record.before && current !== record.after) throw new ProjectDiagnostic('project-recovery-conflict', '恢复前文件变化，未覆盖', name);
      if (current === record.before) continue;
      if (record.before === null) { await rm(join(root, name), { force: true }); continue; }
      const parent = await realpath(dirname(join(root, name)));
      if (relative(root, parent).startsWith('..')) throw new ProjectDiagnostic('project-path', '恢复目录超出工程', name);
      const temp = join(local, 'restore-' + randomUUID());
      await writeExclusive(temp, copies.get(name)!); await rename(temp, join(root, name));
      if (hash(await readFile(root, name)) !== record.before) throw new ProjectDiagnostic('project-write-readback', '恢复读回不一致', name);
    }
    await rm(join(local, 'transaction.json'));
    await rm(join(local, 'transaction-' + transactionId), { recursive: true, force: true });
    return projectInfo(root);
  } finally { await rm(lock, { recursive: true, force: true }); }
}
