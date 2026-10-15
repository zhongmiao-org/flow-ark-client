import type { Store } from './store';
import type { FlowRecord, Run, PreparedScripts } from '../shared/types';
import { assertDocumentResult } from '../shared/document';
import { assertSkillVersion, skillBytes } from '../shared/skill';
import { digest } from '../shared/utils';
import { walk } from '../core/validate';
export type TypedResultMeta = {
  id: string;
  nodeId: string;
  nodeInstance: string;
  type: 'document' | 'skill';
  label: string;
  bytes: number;
  sha256: string;
};
export class TypedResults {
  constructor(private store: Store) {}
  save(
    runId: string,
    nodeId: string,
    nodeInstance: string,
    type: TypedResultMeta['type'],
    value: unknown,
  ) {
    if (typeof nodeInstance !== 'string' || !nodeInstance || nodeInstance.length > 4000)
      throw Error('结构化结果步骤身份无效');
    if (type === 'document') assertDocumentResult(value);
    else assertSkillVersion(value);
    const snapshot = this.store.get<FlowRecord>('snapshot', runId);
    const node = snapshot && walk(snapshot.flow.steps).find((n) => n.id === nodeId);
    if (!node || node.type !== type) throw Error('结构化结果不属于当前快照');
    const id = digest({ runId, nodeId, nodeInstance, type }),
      sha256 = digest(value),
      bytes = skillBytes(value);
    const entries = this.list(runId),
      old = entries.find((e) => e.id === id);
    if (old) {
      if (old.sha256 !== sha256) throw Error('同一步骤结果身份已使用');
      return;
    }
    if (
      entries.length >= 1000 ||
      entries.reduce((sum, e) => sum + e.bytes, 0) + bytes > 8 * 1048576
    )
      throw Error('本次结构化结果超过1000项或8MiB，未截断采用');
    const meta: TypedResultMeta = {
      id,
      nodeId,
      nodeInstance,
      type,
      label: typeof node.name === 'string' ? node.name : node.id,
      bytes,
      sha256,
    };
    this.store.tx(() => {
      this.store.put('typed-run-result', id, { runId, meta, value });
      this.store.put('typed-run-index', runId, { entries: [...entries, meta] });
    });
  }
  list(runId: string): TypedResultMeta[] {
    return this.store.get<{ entries: TypedResultMeta[] }>('typed-run-index', runId)?.entries ?? [];
  }
  read(runId: string, id: string) {
    const run = this.store.get<Run>('run', runId),
      r = this.store.get<{ runId: string; meta: TypedResultMeta; value: unknown }>(
        'typed-run-result',
        id,
      );
    if (
      run?.state !== 'SUCCEEDED' ||
      !r ||
      r.runId !== runId ||
      !this.list(runId).some((e) => e.id === id)
    )
      throw Error('完整结构化结果尚不可采用');
    if (digest(r.value) !== r.meta.sha256) throw Error('结构化结果摘要不一致');
    if (r.meta.type === 'document') assertDocumentResult(r.value);
    else {
      assertSkillVersion(r.value);
      const snapshot = this.store.get<FlowRecord & PreparedScripts>('snapshot', runId);
      if (digest(snapshot?.skillSnapshots?.[r.meta.nodeId]) !== digest(r.value))
        throw Error('Skill结果与运行快照不一致');
    }
    return { type: r.meta.type, value: r.value, nodeInstance: r.meta.nodeInstance };
  }
}
