import { resolve, sep } from 'node:path';
import { ArtifactDirectory } from '../adapters/artifact-directory';
import type { ArtifactCleanupPreview, ArtifactCleanupRecord } from '../shared/artifact-cleanup';
import type { Run } from '../shared/types';
import { digest, errorText, now } from '../shared/utils';
import { Store } from './store';

export class ArtifactCleanup {
  private clearing = new Set<string>();
  private directories: ArtifactDirectory;
  constructor(
    root: string,
    private store: Store,
    private busy: (runId: string) => boolean,
  ) {
    this.directories = new ArtifactDirectory(root);
    for (const record of store.list<ArtifactCleanupRecord>('artifact-cleanup')) {
      if (record.state === 'pending')
        store.tx(() =>
          store.put('artifact-cleanup', record.runId, {
            ...record,
            state: 'interrupted',
            error: '上次清理中断，请重新预览剩余产物；未自动继续删除',
          }),
        );
    }
  }
  status(id: string): ArtifactCleanupRecord | undefined {
    const record = this.store.get<ArtifactCleanupRecord>('artifact-cleanup', id);
    return record?.state === 'pending' && !this.clearing.has(id)
      ? { ...record, state: 'failed', error: this.store.fault ?? '清理未完成，请重新预览剩余产物' }
      : record;
  }
  private ready(id: string) {
    if (this.store.fault) throw new Error(this.store.fault);
    const run = this.store.get<Run>('run', id);
    if (!run) throw new Error('运行不存在');
    if (!['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state))
      throw new Error('运行尚未结束，不能清理产物');
    if (this.busy(id)) throw new Error('运行仍在收尾，请稍后清理产物');
    return run;
  }
  private async prepare(id: string) {
    const run = this.ready(id);
    const scanned = await this.directories.scan(id);
    this.ready(id);
    const inside = (a: any) =>
      typeof a.path === 'string' && resolve(a.path).startsWith(scanned.path + sep);
    const all = this.store.list<any>('artifact');
    if (all.some((a) => a.runId !== id && !a.clearedAt && inside(a)))
      throw new Error('其他运行仍引用此目录中的产物，已阻止清理');
    const artifacts = all.filter((a) => a.runId === id);
    const owned = artifacts.filter((a) => !a.clearedAt && inside(a));
    const previousCleanup = this.store.get<ArtifactCleanupRecord>('artifact-cleanup', id);
    const token = digest({ run, artifacts, directory: scanned.signature, previousCleanup });
    const preview: ArtifactCleanupPreview = {
      runId: id,
      token,
      count: scanned.files.length,
      bytes: scanned.bytes,
      files: scanned.files.slice(0, 100),
      omitted: Math.max(0, scanned.files.length - 100),
      indexedCount: owned.length,
      externalCount: artifacts.filter((a) => !a.clearedAt && !inside(a)).length,
      previousCleanup,
    };
    return { scanned, owned, preview };
  }
  async preview(id: string) {
    if (this.clearing.has(id)) throw new Error('此运行正在清理产物');
    const prepared = await this.prepare(id);
    if (this.clearing.has(id)) throw new Error('此运行正在清理产物');
    return prepared.preview;
  }
  async clear(id: string, token: string, reviewed: boolean) {
    if (reviewed !== true) throw new Error('请先核对结果并确认清理范围');
    if (this.clearing.has(id)) throw new Error('此运行正在清理产物');
    this.clearing.add(id);
    try {
      const { scanned, owned, preview } = await this.prepare(id);
      if (preview.token !== token) throw new Error('清理预览已过期，请重新预览');
      const record: ArtifactCleanupRecord = {
        runId: id,
        token,
        state: 'pending',
        startedAt: now(),
        count: preview.count,
        bytes: preview.bytes,
      };
      this.store.tx(() => this.store.put('artifact-cleanup', id, record));
      try {
        await this.directories.remove(id, scanned.signature);
        const completed: ArtifactCleanupRecord = {
          ...record,
          state: 'completed',
          finishedAt: now(),
        };
        this.store.tx(() => {
          for (const artifact of owned)
            this.store.put('artifact', artifact.artifactId, {
              ...artifact,
              clearedAt: completed.finishedAt,
            });
          this.store.put('artifact-cleanup', id, completed);
          this.store.event(id, 'artifact', '', {
            action: 'cleanup',
            count: record.count,
            bytes: record.bytes,
          });
        });
        return completed;
      } catch (error) {
        if (!this.store.fault) {
          this.store.tx(() =>
            this.store.put('artifact-cleanup', id, {
              ...record,
              state: 'failed',
              error: errorText(error),
            }),
          );
        }
        throw new Error('清理未完成：' + errorText(error));
      }
    } finally {
      this.clearing.delete(id);
    }
  }
}
