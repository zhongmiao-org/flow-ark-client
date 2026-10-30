import { randomUUID } from 'node:crypto';
import type { Attention } from '../shared/types';
import type {
  AttentionAction,
  AttentionBatchPreview,
  AttentionBatchResult,
} from '../shared/attention-management';
import { Store } from './store';

/** Reminder state only: never touches requests, runs, intent ledgers or dedupe keys. */
export class AttentionManagement {
  private previews = new Map<string, { action: AttentionAction; ids: string[]; expires: number }>();
  constructor(
    private store: Store,
    private waiting: (id: string) => boolean,
  ) {}
  trash() {
    return this.store
      .list<Attention>('attention')
      .filter((a) => a.deletedAt)
      .reverse();
  }
  read(id: string) {
    const item = this.store.get<Attention>('attention', id);
    if (this.waiting(id)) throw new Error('此请求正在等待回答，不能用已读代替回应');
    if (item && !item.deletedAt && !item.read)
      this.store.put('attention', id, { ...item, read: true });
    return true;
  }
  preview(action: AttentionAction, ids?: string[]): AttentionBatchPreview {
    const time = Date.now();
    for (const [token, p] of this.previews) if (p.expires < time) this.previews.delete(token);
    if (this.previews.size >= 20) throw new Error('批量预览过多，请稍后重试');
    if (action !== 'read' && !ids?.length) throw new Error('请先选择提醒');
    // This is the complete workspace snapshot, independent of renderer search and pagination.
    const targets =
      action === 'read'
        ? this.store
            .list<Attention>('attention')
            .filter((a) => !a.deletedAt && !a.read)
            .map((a) => a.id)
        : [...new Set(ids)];
    const token = randomUUID(),
      expires = time + 10 * 60 * 1000;
    this.previews.set(token, { action, ids: targets, expires });
    return {
      token,
      action,
      targetCount: targets.length,
      skippedCount: targets.filter((id) => this.waiting(id)).length,
      expiresAt: new Date(expires).toISOString(),
    };
  }
  apply(token: string): AttentionBatchResult {
    const receipt = this.store.get<AttentionBatchResult>('attention-batch', token);
    if (receipt) return receipt;
    const preview = this.previews.get(token);
    if (!preview || preview.expires < Date.now()) throw new Error('批量预览已过期，请重新核对');
    const result = { changed: 0, skipped: 0, unchanged: 0 };
    this.store.tx(() => {
      for (const id of preview.ids) {
        const a = this.store.get<Attention>('attention', id);
        if (!a) {
          result.unchanged++;
          continue;
        }
        if (this.waiting(id)) {
          result.skipped++;
          continue;
        }
        if (preview.action === 'trash' && !a.deletedAt) {
          this.store.put('attention', id, { ...a, deletedAt: new Date().toISOString() });
        } else if (preview.action === 'restore' && a.deletedAt) {
          const { deletedAt: _, ...restored } = a;
          this.store.put('attention', id, restored);
        } else if (preview.action === 'read' && !a.deletedAt && !a.read) {
          this.store.put('attention', id, { ...a, read: true });
        } else {
          result.unchanged++;
          continue;
        }
        result.changed++;
      }
      this.store.put('attention-batch', token, result);
    });
    this.previews.delete(token);
    return result;
  }
}
