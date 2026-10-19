/** Synthetic author/package format fixtures; no browser, actual template or Store access. */
import { readFileSync } from 'node:fs';
import { validateAuthorDefinition } from './template-authoring';
import { validatePackage, manifestDigest, sha256 } from './package-format';
const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const capability = 'browser-target-input-v1';
const base = () => ({
  nodes: [{ id: 'target', type: 'browser', version: 8, operation: 'read', selector: { $ref: 'params.selector' }, value: null, framePath: [] }],
  flowCapabilities: ['browser', capability], entryCapabilities: [] as string[], formalEntryCapabilities: null as string[] | null,
  resources: [{ id: 'web', name: '所选浏览器', kind: 'browser', access: 'use', required: true }], resourceIds: ['web'], actionIds: ['change-ui'],
  actions: [{ id: 'change-ui', name: '改变网页界面', description: '规范格式资料；不是动作执行授权', default: 'deny' }], wrapLoop: false,
});
const inputSchema = { type: 'object', properties: { selector: { type: 'string', minLength: 1 } }, required: ['selector'], additionalProperties: false };
function flow(d: ReturnType<typeof base>) {
  return { formatVersion: '1.0', id: 'target-input', name: '格式资料', description: '不执行网页', parameters: { selector: '' },
    requiredCapabilities: d.flowCapabilities, steps: d.wrapLoop ? [{ id: 'loop', type: 'loop', version: 1, items: [0], body: d.nodes }] : d.nodes };
}
function author(d: ReturnType<typeof base>) {
  const value = read('example.author-definition.json'); value.metadata.id = 'target-input-fixture';
  value.entries = [{ id: 'entry', name: '格式入口', flow: flow(d), inputSchema, resultSchema: {}, schedulable: false,
    capabilities: d.entryCapabilities, resourceIds: d.resourceIds, actionIds: d.actionIds, promptBindings: [] }];
  value.resources = d.resources; value.actions = d.actions; value.prompts = []; value.assets = []; value.dependencies = [];
  return value;
}
function packed(d: ReturnType<typeof base>) {
  const files = new Map<string, Buffer>(); const put = (path: string, value: unknown) => files.set(path, Buffer.from(JSON.stringify(value)));
  put('schemas/config.json', { type: 'object', properties: {}, additionalProperties: false });
  put('schemas/state.json', { type: 'object', properties: {}, additionalProperties: false });
  put('schemas/input.json', inputSchema); put('schemas/result.json', {}); put('flows/entry.json', flow(d));
  const manifest: any = { packageFormat: '2.0', id: 'target-input-fixture', name: '规范格式资料', description: '', version: '1.0.0',
    author: 'Synthetic', source: 'local', minimumClientVersion: '0.3.0', sdkVersion: '1.0', configurationSchema: 'schemas/config.json', stateSchema: 'schemas/state.json',
    entries: [{ id: 'entry', name: '格式入口', flow: 'flows/entry.json', inputSchema: 'schemas/input.json', resultSchema: 'schemas/result.json', schedulable: false,
      capabilities: d.formalEntryCapabilities ?? [...new Set([...d.flowCapabilities, ...d.entryCapabilities])], resources: d.resourceIds, actions: d.actionIds }],
    resources: d.resources, actions: d.actions, scripts: [], dependencies: [], files: [...files].map(([path, body]) => ({ path, size: body.length, sha256: sha256(body) })) };
  manifest.contentDigest = manifestDigest(manifest); put('manifest.json', manifest); return files;
}
let checks = 0;
const fixtures = read('browser-target-declarations.cases.json');
for (const fixture of fixtures) {
  const d: any = base();
  for (const change of fixture.changes) {
    const path = change.path.split('/').slice(1); let target = d;
    for (const key of path.slice(0, -1)) { if (!Object.hasOwn(target, key)) throw Error('Invalid fixture path'); target = target[key]; }
    target[path.at(-1)!] = change.value;
  }
  for (const [kind, check] of [['author', () => validateAuthorDefinition(author(d))], ['package', () => validatePackage(packed(d))]] as const) {
    let accepted = true, error: unknown;
    try { check(); } catch (cause) { accepted = false; error = cause; }
    if (accepted !== fixture.valid[kind]) throw Error(fixture.id + ': ' + kind + ' format mismatch, actual=' + accepted + ', cause=' + String(error));
    checks++;
  }
}
console.log(JSON.stringify({ scope: 'synthetic author/package declarations only', fixtures: fixtures.length, checks }));
