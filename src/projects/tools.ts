import { planAuthoring, getAuthoring, codeAuthoring, assembleAuthoring, authoringPlanSchema } from './authoring';
import { readAuthoringSkill } from './authoring-skill';
import { desktopActionReceipt, desktopSelectionResult, effectPrepareInput, effectResolveInput, effectPrepareResult } from '../shared/desktop-sdk-results';
import { desktopSdkSchemaDigest } from './desktop-sdk.generated';
import { z } from 'zod';
import { desktopCommand, desktopSdkRequest, desktopObservation } from '../shared/desktop-automation';
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
Desktop automation uses installed ctx.desktop.observe({screenshot:false}) and ctx.desktop.act({effectId,observationId,effectKey,command}). Declare desktop-automation-v1 in both flow.requiredCapabilities and entry.capabilities. For every desktop act, first use ctx.template.effect.prepare({action,key,description}) under a declared entry action with an explicitly approved grant. Require execute===true and pass its id as effectId; refuse replay. Declare effect capability, declare each action with default deny, and include actionIds in the entry. Resolve the parent effect only after business verification, never from performed alone. Native desktop sub-action receipts supplement the existing business effect ledger. Read-only observe does not require a write effect. ctx.desktop.readSelection({observationId}) copies the current selection from the bound foreground window, returns {version:1,text,source}, preserves the previous local clipboard, and does not send it to a model. Use it for local TSV comparison after selecting a table range through authorized acts. It consumes the observation; read a new observation afterward. Never paste data back as an attempted read. There is no separate executable desktop-node v2 yet: bind JS/TS blocks through Mermaid. The user binds an exact macOS window to the instance in the client; no binding IDs or window identities in public source. ctx.desktop.decide({observationId,instructions,input,schema,useScreenshot}) uses the approved project model and shared budget for AX/visual judgment, returns AIResult.output; it cannot execute actions. It must reference this Run's last observation. Read a new observation before every action, use its element IDs or window-local logical coordinates. AX element bounds and action points use window-local logical points. A screenshot uses image pixels: convert screenshot x by bounds.width/image.width and y by bounds.height/image.height before act. Never add the global window origin to a local action point. Commands: activate, click/doubleClick with elementId or point, input or paste with text (paste temporarily preserves/restores the local clipboard), key with key and modifiers, scroll with point/deltaX/deltaY, drag with from/to. An act receipt performed only means native input, not business success. Use stable semantic effectKey values for sends/writes across reruns; never generate a new key to replay unknown. Stop on not-executed or unknown; inspect records before resuming. Observe/act tools are available only through the normal approved Run, never by direct MCP desktop commands. Excel reading uses the built-in excel node; do not require Python or install dependencies. Never treat pressing Command+S as proof of saving.
Static compilation is not business acceptance. Package only a checked immutable revision and verify ZIP re-import.
`;
export const projectTools = [
  { name: 'flowark_authoring_plan', description: 'Validate and save a private workflow plan before coding. Node steps use installed project node schemas; script steps declare purpose/language/input but no code. Resources/actions are typed and deny by default. Returns draftId/draftRevision. No public files or actions are executed.', inputSchema: {type:'object',additionalProperties:false,required:['root','revision','plan'],properties:{root:{type:'string'},revision:{type:'string',pattern:'^[a-f0-9]{64}$'},previousDraftId:{type:'string',format:'uuid'},plan:z.toJSONSchema(authoringPlanSchema,{io:'input'})}} },
  { name: 'flowark_authoring_get', description: 'Read a saved plan, exact draft revision and code readiness. Supply entryId and nodeId to read one stored script. No model or runtime calls.', inputSchema:{type:'object',additionalProperties:false,required:['root','draftId'],properties:{root:{type:'string'},draftId:{type:'string',format:'uuid'},entryId:{type:'string'},nodeId:{type:'string'}}} },
  { name: 'flowark_authoring_code', description: 'Stage one complete default-exported JS/TS module for one planned script node at exact draft revision. Checks syntax, installed SDK types and default export function shape; does not execute. Invalid code returns precise diagnostics and leaves previous source intact. Reuse the returned draftRevision for the next node.', inputSchema:{type:'object',additionalProperties:false,required:['root','draftId','draftRevision','entryId','nodeId','source'],properties:{root:{type:'string'},draftId:{type:'string',format:'uuid'},draftRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},entryId:{type:'string'},nodeId:{type:'string'},source:{type:'string',minLength:1,maxLength:262144}}} },
  { name: 'flowark_authoring_assemble', description: 'Only after all planned scripts are ready: deterministically emit Mermaid, bindings, script paths, schemas and publicFiles, then compile and atomically update the original project revision. Never executes or grants actions. Conflicts preserve both source and private draft.', inputSchema:{type:'object',additionalProperties:false,required:['root','draftId','draftRevision'],properties:{root:{type:'string'},draftId:{type:'string',format:'uuid'},draftRevision:{type:'string',pattern:'^[a-f0-9]{64}$'}}} },
  { name: 'flowark_project_node_schema', description: 'Read source planning node schemas and source-specific recipes. Use this for authoring_plan. Script nodes declare purpose, never inline code. Conditional/loop children are planning nodes; the assembler emits Mermaid. Runtime node schema is a separate advanced tool.', inputSchema:{type:'object',additionalProperties:false,required:['types'],properties:{types:{type:'array',minItems:1,maxItems:10,items:{type:'string',maxLength:100}}}} },

  { name: 'flowark_project_context', description: 'Read public project text files and installed SDK in one bounded request. No model call, no code execution, no private bindings. Use this instead of reading every file separately.', inputSchema: { type: 'object', additionalProperties: false, required: ['root'], properties: { root: { type: 'string' } } } },
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
    case 'flowark_authoring_plan': return planAuthoring(args.root,args.revision,args.plan,args.previousDraftId);
    case 'flowark_authoring_get': return getAuthoring(args.root,args.draftId,args.entryId,args.nodeId);
    case 'flowark_authoring_code': return codeAuthoring(args.root,args.draftId,args.draftRevision,args.entryId,args.nodeId,args.source);
    case 'flowark_authoring_assemble': return assembleAuthoring(args.root,args.draftId,args.draftRevision);
    case 'flowark_project_node_schema': {
      const defs:any=schema.$defs, variants:any[]=defs.Node.anyOf??defs.Node.oneOf??[];
      const schemas:Record<string,unknown>={},dependencies:Record<string,unknown>={};
      for(const type of args.types){
        const found=variants.filter(v=>v.properties?.type?.const===type).map(v=>{
          const node=structuredClone(v);
          if(type==='script'){delete node.properties.code;node.required=node.required.filter((k:string)=>k!=='code');node.properties.purpose={type:'string',minLength:1,maxLength:4000};node.required.push('purpose');}
          for(const child of ['then','else','body'])if(node.properties?.[child])node.properties[child]={type:'array',items:{type:'object',description:'Another planning node; query its type via flowark_project_node_schema'}};
          return node;
        });
        if(!found.length)throw new ProjectDiagnostic('unknown-node','未知源码规划节点：'+type);
        schemas[type]=found;
        const collect=(value:any)=>{if(!value||typeof value!=='object')return;if(typeof value.$ref==='string'&&value.$ref.startsWith('#/$defs/')){const key=value.$ref.slice(8);if(!dependencies[key]&&defs[key]){dependencies[key]=defs[key];collect(defs[key]);}}for(const v of Object.values(value))collect(v);};found.forEach(collect);
      }
      return {format:'authoring-plan-v1',nodeSchemas:schemas,dependencyDefinitions:dependencies,examples:{excelRead:{id:'readExcel',type:'excel',version:1,operation:'read',binding:'sourceDir',name:'data.xlsx',rows:[]},script:{id:'inspect',type:'script',version:1,language:'ts',input:{rows:{$ref:'steps.readExcel'}},purpose:'Validate rows and report a summary'}},note:'These are plan nodes, not runtime nodes or nodes/*.json. The assembler owns files and bindings; do not include inline code or a desktop-window resource.'};
    }

    case 'flowark_project_context': {
      const snapshot = await snapshotProject(args.root), files: Record<string, string> = {}, omitted: string[] = [];
      let bytes = 0;
      const paths = [...snapshot.files.keys()].sort((a, b) => (a === 'flowark.project.json' ? -1 : b === 'flowark.project.json' ? 1 : a.localeCompare(b)));
      for (const path of paths) {
        if (!/\.(json|mmd|md|js|ts)$/.test(path)) { omitted.push(path); continue; }
        const content = snapshot.files.get(path)!;
        if (bytes + content.length > 64 * 1024) { omitted.push(path); continue; }
        files[path] = new TextDecoder('utf8', { fatal: true }).decode(content); bytes += content.length;
      }
      return { skill: await readAuthoringSkill(), revision: snapshot.revision, files, omitted, bytes, complete: omitted.length === 0, scriptSdk,
        desktop: { commandSchema: z.toJSONSchema(desktopCommand), sdkRequestSchema: z.toJSONSchema(desktopSdkRequest), schemaDigest:desktopSdkSchemaDigest, observationSchema:z.toJSONSchema(desktopObservation), receiptSchema:z.toJSONSchema(desktopActionReceipt), selectionSchema:z.toJSONSchema(desktopSelectionResult), effectPrepareInput:z.toJSONSchema(effectPrepareInput,{io:'input'}), effectResolveInput:z.toJSONSchema(effectResolveInput,{io:'input'}), effectPrepareResult:z.toJSONSchema(effectPrepareResult) }, scriptsExecuted: false };
    }
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
    case 'flowark_project_help': return { skill: await readAuthoringSkill(), version: 1, guide: projectGuide, implemented: projectTools.map(t => t.name),
      manifestSchema: projectManifestSchema, scriptSdk, desktop: { version: 1, capability: 'desktop-automation-v1', commandSchema: z.toJSONSchema(desktopCommand), sdkRequestSchema: z.toJSONSchema(desktopSdkRequest) }, runtime: 'paired-desktop-required', note: 'Offline project tools do not grant runtime or resource access.' };
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

export const projectAITools = projectTools.filter(t => !['flowark_project_write','flowark_node_schema'].includes(t.name));
