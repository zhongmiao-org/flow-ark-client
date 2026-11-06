import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import { callProjectTool, projectGuide, projectTools } from './tools';
import { ProjectDiagnostic } from './configuration';
import schema from '../../contracts/p1.schema.json';
import projectSchema from '../../contracts/local-project-v1.schema.json';
import { scriptSdk } from './sdk';
import { realpath, lstat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';

const ajv = new Ajv({ strict: false });
const validators = new Map(projectTools.map(t => [t.name, ajv.compile(t.inputSchema)]));
async function invoke(name: string, args: unknown) {
  const validate = validators.get(name as any);
  if (!validate) throw new ProjectDiagnostic('unknown-tool', '未知工程工具');
  if (!validate(args)) throw new ProjectDiagnostic('tool-arguments', ajv.errorsText(validate.errors));
  return callProjectTool(name, args);
}
const diagnostic = (error: unknown) => error instanceof ProjectDiagnostic ? error.toJSON() :
  { code: 'project-error', message: error instanceof Error ? error.message : String(error) };
const resources = [{ uri: 'flowark://project/v1/guide', name: 'FlowArk project v1', description: 'Installed engineering, Mermaid, configuration and package guide', mimeType: 'text/markdown' }];
resources.push({ uri: 'flowark://project/v1/node-schema', name: 'FlowArk installed node schema', description: 'Normative schema and local definitions; use node_schema tool for one type', mimeType: 'application/json' });
resources.push({ uri: 'flowark://project/v1/manifest-schema', name: 'FlowArk project manifest schema', description: 'Installed project manifest JSON Schema', mimeType: 'application/json' });
resources.push({ uri: 'flowark://project/v1/script-sdk', name: 'FlowArk script SDK', description: 'Installed worker context declarations and permission boundary', mimeType: 'text/typescript' });
const resourceText = new Map([[resources[0].uri, projectGuide], [resources[1].uri, JSON.stringify(schema)], [resources[2].uri, JSON.stringify(projectSchema)], [resources[3].uri, scriptSdk]]);
const prompts = [{ name: 'flowark_create_project', description: 'Create and validate a FlowArk project; request execution only after review', arguments: [{ name: 'task', description: 'User task and confirmed constraints', required: true }] },
  { name: 'flowark_package_project', description: 'Validate exact source revision, package public files, restore into a new directory and compare revisions; never claim business acceptance from compilation', arguments: [{ name: 'root', description: 'Authorized local project', required: true }] },
  { name: 'flowark_repair_project', description: 'Read exact revision and diagnostics, repair only relevant files, validate without replaying unknown effects', arguments: [{ name: 'root', description: 'Authorized local project directory', required: true }] }];
export async function runMcp() {
  if (!process.argv[3]) throw new ProjectDiagnostic('mcp-workspace-required', '用法：flowark-project mcp <用户批准的工作目录>');
  const workspace = await realpath(process.argv[3]);
  async function authorize(path: string) {
    let target = resolve(path), suffix: string[] = [];
    while (true) {
      try { target = await realpath(target); break; } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
        const parent = dirname(target); if (parent === target) throw error;
        suffix.unshift(target.slice(parent.length + 1)); target = parent;
      }
    }
    target = resolve(target, ...suffix);
    const rel = relative(workspace, target);
    if (rel.startsWith('..') || rel.startsWith('/')) throw new ProjectDiagnostic('mcp-workspace', '路径不在启动时批准的工作目录内');
  }
  let buffered = '', queue = Promise.resolve(), initialized = false, pending = 0;
  const cancelled = new Set<string>();
  const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
  async function request(m: any) {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return;
    if (m.id === undefined) return;
    try {
      let result: any;
      if (m.method === 'initialize') {
        if (!['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(m.params?.protocolVersion))
          throw new ProjectDiagnostic('mcp-version', 'Unsupported MCP protocol version');
        initialized = true;
        result = { protocolVersion: m.params.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'flowark-project', version: '1.0.0' }, instructions: 'Read flowark_project_help before writing a project. Runtime access requires separate desktop pairing and review.' };
      } else if (m.method === 'ping') result = {};
      else if (!initialized) throw new ProjectDiagnostic('mcp-uninitialized', 'Initialize first');
      else if (m.method === 'tools/list') result = { tools: projectTools };
      else if (m.method === 'tools/call') {
        try { const args = m.params?.arguments ?? {}; for (const key of ['root', 'destination', 'zip']) if (args[key] !== undefined) await authorize(args[key]);
          const value = await invoke(m.params?.name, args); result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: { result: value }, isError: false }; }
        catch (error) { result = { content: [{ type: 'text', text: JSON.stringify(diagnostic(error)) }], isError: true }; }
      } else if (m.method === 'resources/list') result = { resources };
      else if (m.method === 'resources/read') {
        const resource = resources.find(r => r.uri === m.params?.uri);
        if (!resource) throw new ProjectDiagnostic('resource-not-found', 'Unknown resource');
        result = { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resourceText.get(resource.uri) }] };
      } else if (m.method === 'prompts/list') result = { prompts };
      else if (m.method === 'prompts/get') {
        if (!prompts.some(p => p.name === m.params?.name)) throw new ProjectDiagnostic('prompt-not-found', 'Unknown prompt');
        result = { messages: [{ role: 'user', content: { type: 'text', text: projectGuide + '\nRequest: ' + JSON.stringify(m.params?.arguments ?? {}) } }] };
      } else { send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } }); return; }
      send({ jsonrpc: '2.0', id: m.id, result });
    } catch (error) { send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: JSON.stringify(diagnostic(error)) } }); }
  }
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffered += chunk;
    if (Buffer.byteLength(buffered) > 2 * 1024 * 1024) { process.stderr.write('MCP input exceeds 2MiB\n'); process.exit(1); }
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      let message: any;
      try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      if (message?.method === 'notifications/cancelled') {
        if (cancelled.size < 64) cancelled.add(String(message.params?.requestId));
        continue;
      }
      if (pending >= 32) { send({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32000, message: 'Too many pending requests; retry after completion' } }); continue; }
      pending++;
      queue = queue.then(async () => {
        try {
          if (cancelled.delete(String(message?.id))) { send({ jsonrpc: '2.0', id: message.id, error: { code: -32800, message: 'Cancelled before execution' } }); return; }
          await request(message);
        } finally { pending--; }
      });
    }
  });
  process.stdin.on('end', () => { void queue.then(() => { process.exitCode = 0; }); });
}
async function main() {
  const [command = 'help', inputPath] = process.argv.slice(2);
  if (command === 'mcp') { await runMcp(); return; }
  if (command === 'help') { process.stdout.write(projectGuide); return; }
  const names: Record<string, string> = { init: 'init', open: 'open', read: 'read', write: 'write', validate: 'validate', build: 'validate', configuration: 'configuration', 'from-zip': 'from_zip', package: 'package' };
  const runtimeName = ['history', 'configure', 'prepare', 'instance', 'preview', 'run', 'status', 'control'].includes(command) ? 'flowark_runtime_' + command : undefined;
  if ((!names[command] && !runtimeName) || !inputPath) throw new ProjectDiagnostic('cli-arguments', '用法：flowark-project <init|open|read|write|validate|build|configuration|from-zip|package|history|configure|prepare|instance|preview|run|status|control> <request.json>，或 mcp <工作目录>');
  const bytes = await readFile(inputPath);
  if (bytes.length > 2 * 1024 * 1024) throw new ProjectDiagnostic('cli-request-size', '请求超过2MiB');
  const value = await invoke(runtimeName ?? 'flowark_project_' + names[command], JSON.parse(bytes.toString('utf8')));
  process.stdout.write(JSON.stringify({ ok: true, result: value }) + '\n');
}
void main().catch(error => { process.stdout.write(JSON.stringify({ ok: false, error: diagnostic(error) }) + '\n'); process.exitCode = 1; });
