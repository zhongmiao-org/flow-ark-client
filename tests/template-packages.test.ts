import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import {
  canonical,
  manifestDigest,
  sha256,
  validatePackage,
  LIMITS,
} from '../contracts/package-format';
import { PackageLibrary, readArchive, writeArchive } from '../src/templates/archive';
import { exportDefinition } from '../src/templates/export';
import { Store } from '../src/host/store';
import { Templates } from '../src/templates/service';
import example from '../contracts/example.flow.json';
import type { FlowRecord } from '../src/shared/types';
async function fixture(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'template-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pkg = await exportDefinition(example as any);
  pkg.manifest.id = 'fixture';
  return { dir, pkg, library: new PackageLibrary(join(dir, 'library'), '0.2.0') };
}
function seal(pkg: any) {
  pkg.manifest.files = [...pkg.files]
    .filter(([p]) => p !== 'manifest.json')
    .map(([path, b]: any) => ({ path, size: b.length, sha256: sha256(b) }));
  pkg.manifest.contentDigest = manifestDigest(pkg.manifest);
  pkg.files.set('manifest.json', Buffer.from(canonical(pkg.manifest)));
  return pkg;
}
async function raw(path: string, files: Map<string, Buffer>, options: any = {}) {
  const z = new JSZip();
  for (const [p, b] of files) z.file(p, b, { createFolders: false, ...options });
  await writeFile(
    path,
    await z.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE' }),
  );
}
test('fixed preview, deterministic archive, repeat no-op, version conflict, cancel and unsupported client', async (t) => {
  const { dir, pkg, library } = await fixture(t);
  seal(pkg);
  const path = join(dir, 'input.zip');
  await writeArchive(pkg, path);
  await writeArchive(pkg, join(dir, 'same.zip'));
  assert.deepEqual(await readFile(path), await readFile(join(dir, 'same.zip')));
  const preview = await library.inspect(path);
  await writeFile(path, 'replaced');
  const installed = await library.install(preview.token);
  assert.equal(installed.key, 'fixture@1.0.0');
  assert.equal(
    (await library.load(installed.key)).manifest.contentDigest,
    pkg.manifest.contentDigest,
  );
  await writeArchive(pkg, path);
  assert.equal((await library.install((await library.inspect(path)).token)).key, installed.key);
  pkg.manifest.description = 'changed';
  seal(pkg);
  await writeArchive(pkg, path);
  await assert.rejects(library.install((await library.inspect(path)).token), /冲突/);
  const p = await library.inspect(path);
  await library.cancel(p.token);
  await assert.rejects(library.install(p.token), /失效/);
  assert.deepEqual(await readdir(join(dir, 'library', '.staging')), []);
  pkg.manifest.minimumClientVersion = '9.0.0';
  seal(pkg);
  await writeArchive(pkg, path);
  await assert.rejects(library.inspect(path), /更新/);
  await assert.rejects(library.inspect(join(dir, 'old.json')), /旧 JSON/);
});
test('reject tampering, missing resources, invalid remote schemas, unsafe ZIP entries and expansion limits', async (t) => {
  const { dir, pkg } = await fixture(t);
  seal(pkg);
  const path = join(dir, 'input.zip');
  for (const mutate of [
    (f: Map<string, Buffer>) => f.set('assets/extra.txt', Buffer.from('extra')),
    (f: Map<string, Buffer>) => f.delete('flows/run.json'),
    (f: Map<string, Buffer>) => f.set('flows/run.json', Buffer.from('{}')),
    (f: Map<string, Buffer>) => f.set('../escape', Buffer.from('bad')),
    (f: Map<string, Buffer>) => f.set('/absolute', Buffer.from('bad')),
    (f: Map<string, Buffer>) => f.set('assets\\escape', Buffer.from('bad')),
    (f: Map<string, Buffer>) => f.set('SCHEMAS/input.json', Buffer.from('{}')),
    (f: Map<string, Buffer>) => f.set('assets/bomb.txt', Buffer.alloc(LIMITS.file + 1)),
  ]) {
    const f = new Map(pkg.files);
    mutate(f);
    await raw(path, f);
    await assert.rejects(readArchive(path));
  }
  await raw(path, pkg.files, { unixPermissions: 0o120777 });
  await assert.rejects(readArchive(path), /普通文件/);
  pkg.files.set('schemas/input.json', Buffer.from('{"$ref":"https://invalid.test/schema"}'));
  seal(pkg);
  await raw(path, pkg.files);
  await assert.rejects(readArchive(path), /引用/);
});
test('instances share config only internally; entry preflight, deny defaults, fixed versions and reference protection', async (t) => {
  const { dir, pkg } = await fixture(t);
  const store = new Store(join(dir, 'store.sqlite'), randomBytes(32));
  t.after(() => store.close());
  const service = new Templates(store, dir, '0.2.0');
  const first = pkg.manifest.entries[0];
  pkg.manifest.entries.push({
    ...first,
    id: 'network',
    name: 'Network',
    capabilities: ['browser'],
    resources: ['browser'],
    actions: ['write'],
    schedulable: false,
  });
  pkg.manifest.resources = [
    { id: 'browser', name: 'Browser', kind: 'browser', access: 'use', required: true },
  ];
  pkg.manifest.actions = [
    { id: 'write', name: 'Write', description: 'Write external data', default: 'deny' },
  ];
  seal(pkg);
  const path = join(dir, 'input.zip');
  await writeArchive(pkg, path);
  const p = await service.install((await service.library.inspect(path)).token);
  assert.equal(store.list('flow').length, 0);
  const a = await service.create(p.key),
    b = await service.create(p.key);
  assert.notEqual(a.id, b.id);
  assert.equal(a.grants.write, 'deny');
  const local = store.get<FlowRecord>('flow', a.entryFlows.run)!;
  await service.preflight(local);
  const remote = store.get<FlowRecord>('flow', a.entryFlows.network)!;
  await assert.rejects(service.preflight(remote), /授权/);
  await assert.rejects(service.preflight(remote, true), /定时/);
  await assert.rejects(service.remove(p.key), /引用/);
  await service.configure(a.id, {}, {}, { write: 'auto' });
  assert.equal(store.get<any>('flow', a.entryFlows.network).bindings.grants.write, 'auto');
  assert.equal(store.get<any>('flow', b.entryFlows.network).bindings.grants.write, 'deny');
  await assert.rejects(
    service.preflight(store.get<FlowRecord>('flow', a.entryFlows.network)!),
    /绑定/,
  );
  pkg.manifest.version = '2.0.0';
  seal(pkg);
  await writeArchive(pkg, path);
  const p2 = await service.install((await service.library.inspect(path)).token);
  const upgraded = await service.create(p2.key, a.id);
  assert.equal(upgraded.grants.write, 'deny');
  assert.deepEqual(upgraded.resources, {});
  assert.equal(store.get<any>('flow', a.entryFlows.run).bindings.template.packageKey, p.key);
});

test('total expansion, file count and encrypted ZIP are refused; failed database installation removes the package', async (t) => {
  const { dir, pkg } = await fixture(t);
  seal(pkg);
  const path = join(dir, 'limits.zip');
  const many = new Map(pkg.files);
  for (let i = 0; i < 513; i++) many.set('assets/file-' + i, Buffer.alloc(0));
  await raw(path, many);
  await assert.rejects(readArchive(path), /数量/);
  const total = new Map(pkg.files);
  for (let i = 0; i < 11; i++) total.set('assets/big-' + i, Buffer.alloc(LIMITS.file));
  await raw(path, total);
  await assert.rejects(readArchive(path), /实际解压/);
  await writeArchive(pkg, path);
  const encrypted = await readFile(path);
  for (let i = 0; i < encrypted.length - 10; i++) {
    if (encrypted.readUInt32LE(i) === 0x02014b50)
      encrypted.writeUInt16LE(encrypted.readUInt16LE(i + 8) | 1, i + 8);
  }
  await writeFile(path, encrypted);
  await assert.rejects(readArchive(path), /普通文件/);
  await writeArchive(pkg, path);
  const store = new Store(join(dir, 'failure.sqlite'), randomBytes(32));
  t.after(() => store.close());
  const service = new Templates(store, dir, '0.2.0');
  const preview = await service.library.inspect(path);
  (store as any).db.exec('PRAGMA query_only=ON');
  await assert.rejects(service.install(preview.token));
  assert.equal(store.list('template-package').length, 0);
  assert.equal(store.list('flow').length, 0);
  assert.deepEqual(
    (await readdir(join(dir, 'template-packages'))).filter((n) => !n.startsWith('.')),
    [],
  );
});
