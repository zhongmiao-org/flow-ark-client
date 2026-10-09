import type { Store } from './store';
import type { PlanningTask } from '../shared/planning';
import {
  attachmentContext,
  IMAGE_TOTAL_BYTES,
  type TaskAttachment,
  type PlanningImageV1,
  type AttachmentPreview,
} from '../shared/task-attachments';
import {
  attachmentHash,
  decodeAttachmentText,
  imageInfo,
  readAttachmentFile,
} from './attachment-file';
import { canonical, now, uid } from '../shared/utils';

type SavedAttachment = TaskAttachment & { body: string };
export class TaskAttachments {
  constructor(
    private store: Store,
    private deps: {
      choose: (kind: 'file' | 'image') => Promise<string | null>;
      decodeImage: (data: string) => Promise<boolean>;
    },
  ) {}
  async choose(task: PlanningTask, kind: 'file' | 'image'): Promise<SavedAttachment | null> {
    const path = await this.deps.choose(kind);
    if (path === null) return null;
    try {
      const selected = await readAttachmentFile(path, kind);
      if (selected.kind === 'image' && !(await this.deps.decodeImage(selected.body)))
        throw new Error('图片无法完整解码');
      return { ...selected, version: 1, id: uid(), taskId: task.id, selectedAt: now() };
    } catch (error) {
      // Native filesystem errors contain absolute paths; keep them inside Host.
      if (error && typeof error === 'object' && 'code' in error)
        throw new Error('所选附件无法读取，请重新选择普通文件');
      throw error;
    }
  }
  metadata(record: SavedAttachment): TaskAttachment {
    const { body: _, ...metadata } = record;
    return metadata;
  }
  save(record: SavedAttachment) {
    this.store.put('task-attachment', record.id, record);
  }
  remove(id: string) {
    this.store.remove('task-attachment', id);
  }
  private record(task: PlanningTask, id: string): SavedAttachment {
    const meta = task.attachments?.find((a) => a.id === id);
    const record = this.store.get<SavedAttachment>('task-attachment', id);
    if (
      !meta ||
      !record ||
      record.taskId !== task.id ||
      canonical(meta) !== canonical(this.metadata(record))
    )
      throw new Error('附件不存在或不属于当前任务，请移除并重新选择');
    const bytes = Buffer.from(record.body, record.kind === 'image' ? 'base64' : 'utf8');
    if (bytes.length !== record.size || attachmentHash(bytes) !== record.sha256)
      throw new Error('附件副本完整性检查失败，请移除并重新选择');
    if (record.kind === 'image') {
      const info = imageInfo(bytes);
      if (
        info.mimeType !== record.mimeType ||
        info.width !== record.width ||
        info.height !== record.height ||
        bytes.toString('base64') !== record.body
      )
        throw new Error('图片副本内容无效');
    } else decodeAttachmentText(bytes);
    return record;
  }
  snapshot(task: PlanningTask, pending?: SavedAttachment) {
    const records = (task.attachments ?? []).map((a) => this.record(task, a.id));
    if (pending) records.push(pending);
    const pictures = records.filter((a) => a.kind === 'image');
    if (pictures.length > 4 || pictures.reduce((n, a) => n + a.size, 0) > IMAGE_TOTAL_BYTES)
      throw new Error('每个任务最多四张图片，图片总量最多 12 MiB');
    return {
      context: records.map((a) => attachmentContext(a, a.body)),
      images: pictures.map((a) => ({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        width: a.width!,
        height: a.height!,
        data: a.body,
      })) as PlanningImageV1[],
    };
  }
  preview(task: PlanningTask, id: string): AttachmentPreview {
    const a = this.record(task, id);
    return {
      name: a.name,
      kind: a.kind,
      ...(a.kind === 'text'
        ? { text: a.body }
        : { dataUrl: `data:${a.mimeType};base64,${a.body}` }),
    };
  }
}
