import {
  constants,
  openSync,
  readSync,
  closeSync,
  fstatSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Store } from './store';
import type { FlowRecord } from '../shared/types';
import { assertDocumentResult, documentName, DOCUMENT_BYTES } from '../shared/document';
import { digest } from '../shared/utils';
import { storedTypedResult } from './result-ledger';

/** Verifies actual registered parse results; current sources additionally retain the same bound file bytes. */
export function verifySkillDocument(store: Store, raw: unknown, current: boolean, runId?: string) {
  const e = raw as any;
  documentName(e?.source?.name);
  const check = (
    id: string,
    expectedRoot?: { path: string; dev: string; ino: string },
  ): boolean => {
    const row = storedTypedResult(store, id);
    if (!row || row.meta?.type !== 'document' || (runId && row.runId !== runId)) return false;
    const index = store.get<any>('typed-run-index', row.runId);
    if (
      !index?.entries.some((x: any) => x.id === id && x.sha256 === row.meta.sha256) ||
      digest(row.value) !== row.meta.sha256
    )
      throw Error('资料解析登记已变化');
    assertDocumentResult(row.value);
    if (digest(row.value.source) !== digest(e.source)) return false;
    if (
      !Array.isArray(e.units) ||
      !e.units.length ||
      e.units.some((n: number) => !row.value.units.some((u: any) => u.index === n))
    )
      throw Error('资料来源单元未在实际解析结果中登记');
    const snapshot = store.get<FlowRecord>('snapshot', row.runId);
    if (!snapshot) throw Error('资料来源的固定运行不可用');
    if (current) {
      if (!runId) throw Error('本次资料须有准确原运行');
      const original = snapshot.bindings.files[e.source.binding],
        latest = store.get<FlowRecord>('flow', snapshot.id);
      if (!original || !latest?.bindings.files[e.source.binding])
        throw Error('本次资料目录绑定已撤销');
      const root = realpathSync(original),
        rootStat = lstatSync(root, { bigint: true });
      if (
        !expectedRoot ||
        expectedRoot.path !== root ||
        expectedRoot.dev !== String(rootStat.dev) ||
        expectedRoot.ino !== String(rootStat.ino)
      )
        throw Error('原资料目录身份不可核验，请通过资料流程重新读取');
      if (realpathSync(latest.bindings.files[e.source.binding]) !== root)
        throw Error('本次资料目录已变化');
      const paths = [root];
      for (const part of e.source.name.split('/')) paths.push(join(paths.at(-1)!, part));
      const identities = paths.map((path) => {
        const s = lstatSync(path, { bigint: true });
        if (s.isSymbolicLink()) throw Error('资料路径已变为链接');
        return { path, dev: s.dev, ino: s.ino };
      });
      const fd = openSync(
        paths.at(-1)!,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = fstatSync(fd, { bigint: true });
        if (
          !before.isFile() ||
          before.size > BigInt(DOCUMENT_BYTES) ||
          before.size !== BigInt(e.source.byteLength)
        )
          throw Error('资料文件大小已变化');
        const hash = createHash('sha256'),
          buffer = Buffer.alloc(65536);
        let position = 0;
        while (position <= DOCUMENT_BYTES) {
          const n = readSync(
            fd,
            buffer,
            0,
            Math.min(buffer.length, DOCUMENT_BYTES + 1 - position),
            position,
          );
          if (!n) break;
          hash.update(buffer.subarray(0, n));
          position += n;
        }
        const after = fstatSync(fd, { bigint: true });
        if (
          position !== e.source.byteLength ||
          hash.digest('hex') !== e.source.sha256 ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs
        )
          throw Error('本次资料已变化，请重新读取');
        for (const expected of identities) {
          const actual = lstatSync(expected.path, { bigint: true });
          if (actual.isSymbolicLink() || actual.dev !== expected.dev || actual.ino !== expected.ino)
            throw Error('资料路径身份已变化');
        }
        if (realpathSync(original) !== root) throw Error('资料目录身份已变化');
      } finally {
        closeSync(fd);
      }
    }
    return true;
  };
  const key = digest(runId ? { runId, source: e.source } : { source: e.source });
  const pointer = store.get<{ id: string; root: { path: string; dev: string; ino: string } }>(
    'document-source-proof',
    key,
  );
  if (pointer && check(pointer.id, pointer.root)) return;
  let inspected = 0;
  const scan = (index: any) => {
    for (const meta of index?.entries ?? []) {
      if (meta.type !== 'document') continue;
      if (++inspected > 1000) throw Error('历史资料检索达到上限，请通过资料流程重新读取');
      if (check(meta.id)) return true;
    }
    return false;
  };
  if (runId) {
    if (scan(store.get('typed-run-index', runId))) return;
  } else {
    const ceiling = store.lastPosition('typed-run-index');
    let before = ceiling + 1,
      visited = 0;
    while (before > 1 && visited < 1000) {
      const rows = store.page<any>('typed-run-index', ceiling, before, 32);
      if (!rows.length) break;
      for (const row of rows) {
        visited++;
        if (scan(row.value)) return;
      }
      before = rows.at(-1)!.position;
    }
  }
  throw Error('未找到可核验的实际资料解析来源，请通过资料流程重新读取');
}
