/** Synthetic contract-format fixtures only; no application runtime or distributable template. */
import { readFileSync } from 'node:fs';
import { validateAuthorDefinition } from './template-authoring';
import { validatePackage, manifestDigest, sha256 } from './package-format';
import { assertRunResultNode, assertRunResultResources } from './run-result-binding';

const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const capability = 'run-result-read-v1';
const resource = { id: 'previous-result', name: '前次结果', kind: 'run-result', access: 'read', required: true, sourceEntries: ['source'] };
const node = { id: 'read-previous', type: 'run-result', version: 1, name: '读取结果', binding: resource.id, operation: 'read' };
const flow = (id: string, steps: any[], caps: string[]) => ({ formatVersion: '1.0', id, name: id, description: '', parameters: {}, steps, requiredCapabilities: caps });
const entry = (id: string, nodes: any[], caps: string[], resources: string[]) => ({ id, name: id, flow: flow(id, nodes, caps), capabilities: caps, resources, actions: [] });
const definition = () => ({ resources: [structuredClone(resource)], entries: [entry('source', [], [], []), entry('consumer', [structuredClone(node)], [capability], [resource.id])] });
function author(d: any) {
  const base = read('example.author-definition.json');
  base.entries = d.entries.map((e: any) => ({ id: e.id, name: e.name, flow: e.flow,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, resultSchema: {},
    schedulable: false, capabilities: e.capabilities, resourceIds: e.resources, actionIds: e.actions, promptBindings: [] }));
  base.resources = d.resources; base.actions = []; base.prompts = []; base.assets = [];
  return base;
}
function packed(d: any) {
  const files = new Map<string, Buffer>();
  const put = (path: string, value: unknown) => files.set(path, Buffer.from(JSON.stringify(value)));
  put('schemas/config.json', { type: 'object', properties: {}, additionalProperties: false });
  put('schemas/state.json', { type: 'object' });
  put('schemas/input.json', { type: 'object', properties: {}, additionalProperties: false });
  put('schemas/result.json', {});
  for (const e of d.entries) put('flows/' + e.id + '.json', e.flow);
  const manifest: any = { packageFormat: '2.0', id: 'synthetic-result-source', name: '协议资料', description: '', version: '1.0.0',
    author: 'Synthetic', source: 'local', minimumClientVersion: '0.3.0', sdkVersion: '1.0',
    configurationSchema: 'schemas/config.json', stateSchema: 'schemas/state.json',
    entries: d.entries.map((e: any) => ({ ...e, flow: 'flows/' + e.id + '.json', inputSchema: 'schemas/input.json', resultSchema: 'schemas/result.json', schedulable: false })),
    resources: d.resources, actions: [], scripts: [], dependencies: [],
    files: [...files].map(([path, body]) => ({ path, size: body.length, sha256: sha256(body) })) };
  manifest.contentDigest = manifestDigest(manifest); put('manifest.json', manifest);
  return files;
}
const counts = { valid: 0, invalid: 0 };
for (const fixture of read('run-result-declarations.cases.json')) {
  const d = definition();
  for (const change of fixture.changes) {
    const path = change.path.split('/').slice(1);
    let target: any = d;
    for (const key of path.slice(0, -1)) { if (!Object.hasOwn(target, key)) throw Error('fixture path'); target = target[key]; }
    const key = path.at(-1)!;
    if (change.remove) delete target[key]; else target[key] = change.value;
  }
  for (const check of [() => validateAuthorDefinition(author(d)), () => validatePackage(packed(d))]) {
    let success = true;
    try { check(); } catch { success = false; }
    if (success !== fixture.valid) throw Error(fixture.id + ': author/package format mismatch');
  }
  counts[fixture.valid ? 'valid' : 'invalid']++;
}
// Also exercise the direct format entry points used before host dispatch.
assertRunResultResources(definition());
assertRunResultNode(node, [capability], definition(), definition().entries[1]);
console.log(JSON.stringify({ scope: 'synthetic author/package format only', fixtures: counts, checks: (counts.valid + counts.invalid) * 2 + 2 }));
