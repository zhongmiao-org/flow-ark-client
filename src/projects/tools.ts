import { buildProject, snapshotProject, projectInfo, projectFromZip, packageProject, configurationForProject } from './project';
import { ProjectDiagnostic } from './configuration';
import { desktopProjectRequest } from './connection';
import { updateProjectFiles, createProject } from './project';
import schema from '../../contracts/p1.schema.json';
import projectManifestSchema from '../../contracts/local-project-v1.schema.json';
import { scriptSdk } from './sdk';

export const projectGuide = `# FlowArk project v1
Use flowark.project.json to declare metadata, entries, resources, actions, environment and publicFiles.
Each entry binds graph: flows/<id>.mmd, nodes: nodes/<id>.json, inputSchema and resultSchema.
Mermaid subset: flowchart TD/TB/LR; ID["label"]; A --> B. No arbitrary executable directives or implicit cycles.
Conditional nodes have explicit subgraph ID__then["then"] and ID__else["else"]. Loop nodes have ID__body["body"].
Use ID -->|then/else/body| FIRST_CHILD for nonempty branches. next edges within each block form exactly one chain.
Node JSON is {"ID":{"node":{"id":"ID","type":"value","version":1,"value":42}}}.
Script bindings use {"node":{"id":"ID","type":"script","version":1,"language":"ts","input":{}},"script":"scripts/work.ts"}; export default async ctx => ...
Do not put then/else/body arrays in node JSON: Mermaid owns structure. Existing SDK and node schema remain normative.
Public immutable constants: config/constants.json, scripts read ctx.constants; node values may use {"$constant":"key.path"}.
Defaults: config/defaults.json, validated against schemas/configuration.json at run preparation.
Development profiles: .flowark/profiles/<name>.json; optional root .env.local only when a profile is explicitly selected.
Only declared non-secret env variables are read; mappings specify variable, field and exact type.
Order: defaults < instance < selected profile JSON < declared env < explicit development overrides. input is separate.
Resource binding values are objects, e.g. resources: {output: {path: "/absolute/chosen/directory"}}, never plain path strings. Read flowark_runtime_instance for exact revision before configure. Grants are deny/confirm/auto, never allow.
Credentials never belong in JSON/env. Use protected resource references. No configuration grants action permissions.
Public package uses only publicFiles; excludes .flowark, real env, credentials, bindings and run history.
First inspect project capabilities, then read relevant schema/SDK resources; do not guess a node format.
Validate and build before request-run. Changes never alter an active run. Unknown external effects must not be retried.
Static compilation is not business acceptance. Package only a checked immutable revision and verify ZIP re-import.
`;
export const projectTools = [
  { name: 'flowark_project_init', description: 'Create a new source project with Mermaid, bindings, schemas, constants/defaults and README. Destination must be new; never overwrites.', inputSchema: { type: 'object', additionalProperties: false, required: ['destination', 'id', 'name'], properties: { destination: { type: 'string' }, id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,99}$' }, name: { type: 'string', minLength: 1, maxLength: 200 } } } },
  { name: 'flowark_node_schema', description: 'Read the actual installed node schema. Select a node type before generating code; do not guess fields.', inputSchema: { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { type: 'string', maxLength: 100 } } } },
  { name: 'flowark_project_help', description: 'Read installed project format, configuration rules and available actions before writing a project.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'flowark_project_open', description: 'Read declared files, revisions and entries of a local project. Does not execute scripts.', inputSchema: { type: 'object', additionalProperties: false, required: ['root'], properties: { root: { type: 'string' } } } },
  { name: 'flowark_project_read', description: 'Read one declared public file from a fixed project revision.', inputSchema: { type: 'object', additionalProperties: false, required: ['root', 'path', 'revision'], properties: { root: { type: 'string' }, path: { type: 'string' }, revision: { type: 'string' } } } },
  { name: 'flowark_project_validate', description: 'Compile Mermaid bindings, scripts, schemas and complete package without executing project scripts. Returns exact diagnostics.', inputSchema: { type: 'object', additionalProperties: false, required: ['root'], properties: { root: { type: 'string' }, revision: { type: 'string' } } } },
  { name: 'flowark_project_configuration', description: 'Resolve and validate configuration layers. Selecting a profile explicitly enables that project root env. Never reads system env.', inputSchema: { type: 'object', additionalProperties: false, required: ['root'], properties: { root: { type: 'string' }, profile: { type: 'string' }, instance: { type: 'object' }, overrides: { type: 'object' } } } },
  { name: 'flowark_project_from_zip', description: 'Convert one exact standard ZIP into a new local source project. Never reads private instances or overwrites an existing directory.', inputSchema: { type: 'object', additionalProperties: false, required: ['zip', 'destination'], properties: { zip: { type: 'string' }, destination: { type: 'string' } } } },
  { name: 'flowark_project_package', description: 'Build a fixed project revision and write a new complete ZIP. Refuses existing output files. Does not run the workflow.', inputSchema: { type: 'object', additionalProperties: false, required: ['root', 'destination', 'revision'], properties: { root: { type: 'string' }, destination: { type: 'string' }, revision: { type: 'string' } } } },
  { name: 'flowark_project_write', description: 'Apply a checked batch of public source changes at the exact revision. Conflicts never overwrite external edits; incomplete writes block compilation until recovery.', inputSchema: { type: 'object', additionalProperties: false, required: ['root', 'revision', 'changes'], properties: { root: { type: 'string' }, revision: { type: 'string' }, changes: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } } } } },
  { name: 'flowark_runtime_configure', description: 'Propose instance configuration, input values and resource/grant bindings. Exact instance revision required. Native user review is mandatory; protected resources remain host-validated. Only instance values persist. Use profile/overrides/input on preview/run for a single immutable development snapshot.', inputSchema: { type: 'object', additionalProperties: false, required: ['root', 'revision'], properties: { root: { type: 'string' }, revision: { type: 'string' }, configuration: { type: 'object' }, resources: { type: 'object', additionalProperties: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, browserId: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, skill: { type: 'object' }, source: { type: 'object' }, result: { type: 'object' } } } }, grants: { type: 'object', additionalProperties: { enum: ['deny', 'confirm', 'auto'] } }, inputs: { type: 'object' } } } },
  ...(['history', 'prepare', 'instance', 'preview', 'run', 'status', 'control'] as const).map(operation => ({
    name: 'flowark_runtime_' + operation,
    description: ({ history: 'List the latest 100 run identities belonging to this paired project, without executing or replaying anything.', prepare: 'Build the fixed revision and create or reuse a desktop debugging instance; never starts a run.', instance: 'Read this paired project debugging instance only.', preview: 'Read the exact normal runtime review. Does not execute.', run: 'Request execution through the normal host. The user must approve the desktop review dialog; tool calls cannot self-approve.', status: 'Read an existing run owned by this project.', control: 'Pause, resume, step or cancel an owned run. Never creates a replacement run.' })[operation],
    inputSchema: { type: 'object', additionalProperties: false, required: ['root', ...(operation === 'prepare' ? ['revision'] : ['preview', 'run'].includes(operation) ? ['entryId'] : ['status', 'control'].includes(operation) ? ['runId'] : []), ...(operation === 'run' ? ['requestId'] : []), ...(operation === 'control' ? ['action'] : [])],
      properties: { root: { type: 'string' }, ...operation === 'prepare' ? { revision: { type: 'string' }, isolate: { type: 'boolean' } } : {},
        ...['preview', 'run'].includes(operation) ? { entryId: { type: 'string' }, debug: { type: 'boolean' }, profile: { type: 'string' }, overrides: { type: 'object' }, input: { type: 'object' } } : {},
        ...operation === 'run' ? { requestId: { type: 'string', pattern: '^[a-fA-F0-9-]{36}$' } } : {},
        ...['status', 'control'].includes(operation) ? { runId: { type: 'string' } } : {},
        ...operation === 'control' ? { action: { enum: ['pause', 'resume', 'step', 'cancel'] } } : {} } },
  })),
] as const;
export async function callProjectTool(name: string, args: any): Promise<any> {
  if (name.startsWith('flowark_runtime_')) {
    const methods: Record<string, string> = { history: 'project.run.history', configure: 'project.configure', prepare: 'project.prepare', instance: 'project.instance', preview: 'project.run.preview', run: 'project.run.request', status: 'project.run.status', control: 'project.run.control' };
    const method = methods[name.slice('flowark_runtime_'.length)];
    if (!method) throw new ProjectDiagnostic('unknown-tool', '未知运行工具');
    const { root, ...input } = args; return desktopProjectRequest(root, method, input);
  }
  switch (name) {
    case 'flowark_project_init': return createProject(args.destination, args.id, args.name);
    case 'flowark_node_schema': {
      const definitions: any = schema.$defs, types: any[] = definitions.Node.anyOf ?? definitions.Node.oneOf ?? [];
      const found = types.filter(s => s.properties?.type?.const === args.type);
      if (!found.length) throw new ProjectDiagnostic('unknown-node', '节点类型不存在：' + args.type);
      const dependencyDefinitions: Record<string, unknown> = {};
      const collect = (value: any) => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.$ref === 'string' && value.$ref.startsWith('#/$defs/')) {
          const key = value.$ref.slice(8);
          if (!Object.hasOwn(dependencyDefinitions, key) && definitions[key]) {
            dependencyDefinitions[key] = definitions[key]; collect(definitions[key]);
          }
        }
        for (const child of Object.values(value)) collect(child);
      };
      found.forEach(collect);
      return { type: args.type, definitions: found, dependencyDefinitions, references: ['flowark://project/v1/node-schema'], version: 'installed' };
    }
    case 'flowark_project_help': return { version: 1, guide: projectGuide, implemented: projectTools.map(t => t.name),
      manifestSchema: projectManifestSchema, scriptSdk, runtime: 'paired-desktop-required', note: 'Offline project tools do not grant runtime or resource access.' };
    case 'flowark_project_open': return projectInfo(args.root);
    case 'flowark_project_read': {
      const snapshot = await snapshotProject(args.root);
      if (snapshot.revision !== args.revision) throw new ProjectDiagnostic('project-conflict', '工程变化，请先读取新修订');
      const content = snapshot.files.get(args.path);
      if (!content) throw new ProjectDiagnostic('project-unlisted-file', '只允许读取清单中公开文件', args.path);
      if (content.length > 256 * 1024) throw new ProjectDiagnostic('project-read-limit', '单次文本读取超过256KiB', args.path);
      return { revision: snapshot.revision, path: args.path, text: new TextDecoder('utf8', { fatal: true }).decode(content) };
    }
    case 'flowark_project_validate': {
      const { snapshot, pkg } = await buildProject(args.root, args.revision);
      return { valid: true, revision: snapshot.revision, entries: pkg.manifest.entries.map(e => e.id), contentDigest: pkg.manifest.contentDigest,
        scriptsExecuted: false, runtimeAccepted: false };
    }
    case 'flowark_project_configuration': return configurationForProject(args.root, args);
    case 'flowark_project_write': return updateProjectFiles(args.root, args.revision, args.changes);
    case 'flowark_project_from_zip': return projectFromZip(args.zip, args.destination);
    case 'flowark_project_package': return packageProject(args.root, args.destination, args.revision);
    default: throw new ProjectDiagnostic('unknown-tool', '未知工程工具：' + name);
  }
}
