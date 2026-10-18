import { randomBytes } from 'node:crypto';
import type { Store } from './store';
import { EntryResults, extractLabels, type ReuseCapture } from './entry-results';
import type { Bindings, FlowRecord, PreparedScripts } from '../shared/types';
import type {
  RunResultTarget as Target,
  RunResultOwner as Owner,
  RunResultResource as Resource,
  RunResultReference as Ref,
  RunResultProof as Proof,
  RunResultIndex as Index,
  RunResultCursor as Cursor,
  RunResultRead as Read,
  RunResultPreparedSources,
  RunResultPreviewAvailable as Preview,
  RunResultSaveChoices as SaveChoices,
} from '../shared/contracts.generated';
import {
  canonical,
  digest,
  bytes,
  verifyReference,
  verifyRead,
  verifyProof,
  verifyResponse,
  verifyPrepared,
} from '../../contracts/run-result-binding.mjs';
import { credentialPolicy } from '../../contracts/run-result-credentials.mjs';
import { validateData } from '../../contracts/package-format';
import { validateObject, walk } from '../core/validate';

export type ResultOwnerContext = {
  target: Target;
  owner: Owner;
  fingerprint: string;
  resources: NonNullable<Bindings['resources']>;
  declarations: Resource[];
  assertCurrent: () => void;
};
type Lease = {
  id: string;
  kind: 'cursor' | 'preview' | 'choice';
  fingerprint: string;
  target: Target;
  binding: string;
  expires: number;
  expiresAt: string;
  cursor?: Cursor;
  ref?: Ref;
  proofSha256?: string;
  readStamp?: string;
  reviewId?: string;
};
const allowedReasons = new Set([
  'source-unavailable',
  'source-not-succeeded',
  'reuse-unavailable',
  'schema-invalid',
  'result-invalid',
  'read-limit',
  'privacy-unavailable',
  'changed-during-read',
  'storage-unavailable',
]);
const shape = (name: string, value: unknown) => {
  try {
    validateObject(name, value);
  } catch {
    throw Error('result-invalid');
  }
};
const tuple = (run: ReuseCapture['run']) => ({
  id: run.id,
  flowId: run.flowId,
  versionId: run.versionId,
});
const equal = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);
const scope = (owner: Owner) => 'run-result-index:' + digest(owner);
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** All data and permits stay in the host. No arbitrary history API for models or scripts. */
export class RunResultSources {
  private leases = new Map<string, Lease>();
  constructor(
    private store: Store,
    private entries: EntryResults,
    private deps: {
      available: () => void;
      resolve: (target: Target) => Promise<ResultOwnerContext>;
      clock?: () => number;
    },
  ) {}
  private clock() {
    return this.deps.clock?.() ?? performance.now();
  }
  private ownerFor(source: Ref['source']): Owner {
    return source.kind === 'template'
      ? {
          kind: 'instance',
          id: source.instanceId,
          packageKey: source.packageKey,
          packageDigest: source.packageDigest,
        }
      : { kind: 'author-draft', id: source.draftId };
  }
  /** Only called synchronously by the original Run's finalizer with its final known secrets. */
  capture({ run, snapshot, saved, sourceRecord, known }: ReuseCapture) {
    if (this.store.fault || run.state !== 'SUCCEEDED' || !saved.present) return;
    const policy = credentialPolicy(known),
      source = structuredClone(saved.source);
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== 'string') continue;
      const protectedValue = policy.text(value);
      if (key === 'entryName') {
        if (!protectedValue.length) return;
        (source as any)[key] = protectedValue;
      } else if (protectedValue !== value) return;
    }
    const identity = tuple(run);
    for (const value of Object.values(identity)) if (policy.text(value) !== value) return;
    const owner = this.ownerFor(source),
      kind = scope(owner);
    if (this.store.get('run-result-reuse', run.id) || this.store.get(kind, run.id)) return;
    const indexBase = {
      version: 1 as const,
      finalized: true as const,
      owner,
      run: { ...identity, state: 'SUCCEEDED' as const },
      entryId: source.entryId,
      entryName: source.kind === 'template' ? source.entryName : policy.text(source.entryId),
    };
    let proof: Proof;
    try {
      const filtered = policy.value(saved.value);
      validateData(saved.schema, filtered.value); // The original complete value was already validated.
      const ref: Ref = {
        version: 1,
        run: identity,
        source,
        policy: 'credential-redacted-v1',
        dataSha256: filtered.dataSha256,
        dataBytes: filtered.dataBytes,
      };
      const labels = extractLabels(saved.schema, saved.value, filtered.value, [], policy.text);
      const body = {
        version: 1 as const,
        policy: 'credential-redacted-v1' as const,
        finalized: true as const,
        finalSecretsComplete: true as const,
        run: identity,
        owner,
        ref,
        snapshotSha256: digest(snapshot),
        sourceRecordSha256: digest(sourceRecord),
        originalValueSha256: digest(saved.value),
        originalSourceSha256: digest(saved.source),
        value: filtered.value as Proof['value'],
        dataChanged: filtered.dataChanged,
        ...labels,
      };
      proof = { ...body, proofSha256: digest(body) };
      shape('RunResultProof', proof);
      verifyProof(proof, owner, {
        id: 'capture',
        kind: 'run-result',
        access: 'read',
        sourceEntries: [source.entryId],
      });
    } catch {
      const index: Index = { ...indexBase, status: 'unavailable', reason: 'privacy-unavailable' };
      shape('RunResultIndex', index);
      this.store.tx(() => {
        if (!this.store.get(kind, run.id) && !this.store.get('run-result-reuse', run.id))
          this.store.put(kind, run.id, index);
      });
      return;
    }
    const index: Index = { ...indexBase, status: 'candidate', ref: proof.ref };
    shape('RunResultIndex', index);
    this.store.tx(() => {
      if (this.store.get(kind, run.id) || this.store.get('run-result-reuse', run.id)) return;
      this.store.put('run-result-reuse', run.id, proof);
      this.store.put(kind, run.id, index);
    });
  }
  private async context(target: Target, binding: string) {
    this.deps.available();
    const context = await this.deps.resolve(target);
    context.assertCurrent();
    if (!equal(context.target, target)) throw Error('目标已变化，请重新读取后选择；原绑定保留');
    const resource = context.declarations.find((r) => r.id === binding);
    if (!resource) throw Error('目标没有声明此只读结果资源');
    shape('RunResultResource', resource);
    return { ...context, resource };
  }
  private prune() {
    const now = this.clock();
    for (const [id, lease] of this.leases) if (lease.expires <= now) this.leases.delete(id);
  }
  private permit(
    context: ResultOwnerContext,
    binding: string,
    kind: Lease['kind'],
    extra: Partial<Lease>,
  ): Lease {
    this.prune();
    if (this.leases.size >= 512) throw Error('结果选择数量达到上限，请稍后重新核对');
    const id = randomBytes(32).toString('hex');
    const lease: Lease = {
      ...structuredClone(extra),
      id,
      kind,
      target: structuredClone(context.target),
      binding,
      fingerprint: context.fingerprint,
      expires: this.clock() + 600000,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    };
    this.leases.set(id, lease);
    return lease;
  }
  private granted(id: string, context: ResultOwnerContext, binding: string, kind: Lease['kind']) {
    this.prune();
    const lease = this.leases.get(id);
    if (
      !lease ||
      lease.kind !== kind ||
      lease.binding !== binding ||
      lease.fingerprint !== context.fingerprint ||
      !equal(lease.target, context.target)
    )
      throw Error('结果核对已过期或目标已变化，请重新预览；原绑定保留');
    return lease;
  }
  private async load(
    context: ResultOwnerContext & { resource: Resource },
    runId: string,
    expected?: Ref,
  ) {
    const kind = scope(context.owner),
      index = this.store.get<Index>(kind, runId);
    // Scope filtering precedes all full-source I/O and disclosure, even when an ID is guessed.
    if (
      !index ||
      !equal(index.owner, context.owner) ||
      !context.resource.sourceEntries.includes(index.entryId)
    )
      throw Error('source-unavailable');
    shape('RunResultIndex', index);
    if (index.status !== 'candidate') throw Error(index.reason);
    const proof = this.store.get<Proof>('run-result-reuse', runId);
    if (!proof) throw Error('reuse-unavailable');
    if (bytes(proof) > 524288) throw Error('read-limit');
    shape('RunResultProof', proof);
    verifyProof(proof, context.owner, context.resource);
    if (!equal(proof.ref, index.ref) || (expected && !equal(expected, proof.ref)))
      throw Error('reuse-unavailable');
    const fixed = await this.entries.fixedForReuse(runId);
    const immutable = (s: Ref['source']) => {
      const copy = { ...s } as any;
      delete copy.entryName;
      return copy;
    };
    if (
      proof.snapshotSha256 !== digest(fixed.snapshot) ||
      proof.sourceRecordSha256 !== digest(fixed.sourceRecord) ||
      proof.originalValueSha256 !== digest(fixed.saved.value) ||
      proof.originalSourceSha256 !== digest(fixed.saved.source) ||
      !equal(proof.run, tuple(fixed.run)) ||
      !equal(immutable(proof.ref.source), immutable(fixed.saved.source))
    )
      throw Error('reuse-unavailable');
    validateData(fixed.saved.schema, proof.value);
    const assertCurrent = () => {
      this.deps.available();
      fixed.assertCurrent();
      context.assertCurrent();
      if (
        !equal(proof, this.store.get('run-result-reuse', runId)) ||
        !equal(index, this.store.get(kind, runId))
      )
        throw Error('changed-during-read');
    };
    assertCurrent();
    return { proof, position: this.store.position(kind, runId), assertCurrent };
  }
  private protectedResponse<T extends object>(
    body: T,
    context: ResultOwnerContext,
    binding: string,
  ) {
    const response = { ...structuredClone(body), readStamp: digest(body) };
    verifyResponse(response, { target: context.target, binding });
    return response;
  }
  async list(target: Target, binding: string, query: string, cursor: Cursor | null) {
    if (Buffer.byteLength(query, 'utf8') > 800) throw Error('结果搜索文字超限');
    const context = await this.context(target, binding),
      kind = scope(context.owner);
    const upper = this.store.lastPosition(kind);
    let ceiling = upper,
      before = upper + 1;
    if (cursor) {
      const lease = this.granted(cursor.cursorId, context, binding, 'cursor');
      if (
        !equal(cursor, lease.cursor) ||
        cursor.targetSha256 !== context.fingerprint ||
        cursor.querySha256 !== digest(query) ||
        cursor.ceiling > upper ||
        cursor.before > cursor.ceiling + 1
      )
        throw Error('结果目录位置已变化，请重新搜索');
      ceiling = cursor.ceiling;
      before = cursor.before;
    }
    const rows = this.store.page<Index>(kind, ceiling, before, 20);
    const choices = rows
      .filter(({ value: row }) => {
        shape('RunResultIndex', row);
        return (
          equal(row.owner, context.owner) &&
          context.resource.sourceEntries.includes(row.entryId) &&
          [row.entryName, row.entryId, row.run.id].some((s) =>
            asciiLower(s).includes(asciiLower(query)),
          )
        );
      })
      .map(({ value: row }) => ({
        run: row.run,
        entryId: row.entryId,
        entryName: row.entryName,
        status: row.status,
        ...(row.status === 'unavailable' ? { reason: row.reason } : {}),
      }));
    context.assertCurrent();
    if (cursor) this.leases.delete(cursor.cursorId);
    let next: Cursor | null = null;
    if (rows.length === 20) {
      const lease = this.permit(context, binding, 'cursor', {});
      next = {
        version: 1,
        targetSha256: context.fingerprint,
        binding,
        querySha256: digest(query),
        ceiling,
        before: rows.at(-1)!.position,
        cursorId: lease.id,
      };
      lease.cursor = structuredClone(next);
    }
    const response = { target, binding, targetSha256: context.fingerprint, choices, next };
    shape('RunResultListResponse', response);
    verifyResponse(response, { target, binding, query });
    return response;
  }
  private failure(error: unknown, context: ResultOwnerContext, binding: string) {
    const code = error instanceof Error ? ((error as any).reason ?? error.message) : '';
    const reason = allowedReasons.has(code)
      ? code
      : this.store.fault
        ? 'storage-unavailable'
        : 'source-unavailable';
    return this.protectedResponse(
      { target: context.target, binding, status: 'unavailable' as const, reason },
      context,
      binding,
    );
  }
  async preview(target: Target, binding: string, runId: string) {
    const context = await this.context(target, binding);
    try {
      const loaded = await this.load(context, runId),
        p = loaded.proof;
      const lease = this.permit(context, binding, 'preview', {
        ref: p.ref,
        proofSha256: p.proofSha256,
      });
      const response: Preview = this.protectedResponse(
        {
          target,
          binding,
          status: 'available' as const,
          ref: p.ref,
          value: p.value,
          dataChanged: p.dataChanged,
          schemaValidation: 'passed' as const,
          labels: p.labels,
          labelsComplete: p.labelsComplete,
          reviewId: lease.id,
          expiresAt: lease.expiresAt,
        },
        context,
        binding,
      );
      lease.readStamp = response.readStamp;
      shape('RunResultPreviewResponse', response);
      loaded.assertCurrent();
      return response;
    } catch (e) {
      return this.failure(e, context, binding);
    }
  }
  async select(target: Target, binding: string, reviewId: string, readStamp: string) {
    const context = await this.context(target, binding),
      review = this.granted(reviewId, context, binding, 'preview');
    if (review.readStamp !== readStamp) throw Error('本次预览已变化，请重新核对');
    const loaded = await this.load(context, review.ref!.run.id, review.ref);
    this.granted(reviewId, context, binding, 'preview');
    if (loaded.proof.proofSha256 !== review.proofSha256) throw Error('本次来源已变化，请重新预览');
    const choice = this.permit(context, binding, 'choice', {
      ref: review.ref,
      proofSha256: review.proofSha256,
      reviewId,
      readStamp,
    });
    const response = this.protectedResponse(
      {
        target,
        binding,
        status: 'selected' as const,
        ref: review.ref!,
        choiceId: choice.id,
        expiresAt: choice.expiresAt,
      },
      context,
      binding,
    );
    shape('RunResultSelectResponse', response);
    loaded.assertCurrent();
    return response;
  }
  async inspect(target: Target, binding: string) {
    const context = await this.context(target, binding),
      saved = context.resources[binding];
    if (!saved)
      return this.protectedResponse(
        { target, binding, status: 'unbound' as const },
        context,
        binding,
      );
    try {
      const ref = this.binding(saved),
        loaded = await this.load(context, ref.run.id, ref),
        p = loaded.proof;
      const response = this.protectedResponse(
        {
          target,
          binding,
          status: 'available' as const,
          ref,
          value: p.value,
          dataChanged: p.dataChanged,
          schemaValidation: 'passed' as const,
          labels: p.labels,
          labelsComplete: p.labelsComplete,
        },
        context,
        binding,
      );
      shape('RunResultInspectResponse', response);
      loaded.assertCurrent();
      return response;
    } catch (e) {
      return this.failure(e, context, binding);
    }
  }
  binding(value: NonNullable<Bindings['resources']>[string]): Ref {
    shape('RunResultBinding', value);
    return value.result!;
  }
  /** Inside the existing synchronous save CAS transaction; grants never become stored bindings. */
  assertChanges(
    context: ResultOwnerContext,
    next: NonNullable<Bindings['resources']>,
    choices: SaveChoices = {},
  ) {
    context.assertCurrent();
    shape('RunResultSaveChoices', choices);
    for (const [binding, value] of Object.entries(next)) {
      if (!value.result) continue;
      const resource = context.declarations.find((r) => r.id === binding);
      if (!resource) throw Error('目标没有声明对应的结果资源');
      const ref = this.binding(value);
      verifyReference(ref, context.owner, resource);
      const proof = this.store.get<Proof>('run-result-reuse', ref.run.id);
      if (!proof) throw Error('结果副本已不可核验，原绑定保留');
      shape('RunResultProof', proof);
      verifyProof(proof, context.owner, resource);
      if (!equal(proof.ref, ref)) throw Error('结果引用已变化，原绑定保留');
      if (equal(context.resources[binding], value)) continue;
      const lease = this.granted(choices[binding], context, binding, 'choice');
      if (!equal(lease.ref, ref) || lease.proofSha256 !== proof.proofSha256)
        throw Error('结果来源未由本目标核对');
    }
  }
  consumeChoices(choices: SaveChoices = {}) {
    for (const id of Object.values(choices)) this.leases.delete(id);
  }
  async prepareChanges(
    target: Target,
    next: NonNullable<Bindings['resources']>,
    choices: SaveChoices = {},
  ) {
    this.deps.available();
    const context = await this.deps.resolve(target),
      checks: (() => void)[] = [];
    for (const [binding, value] of Object.entries(next)) {
      if (!value.result) continue;
      const scoped = await this.context(target, binding),
        ref = this.binding(value);
      const loaded = await this.load(scoped, ref.run.id, ref);
      checks.push(loaded.assertCurrent);
    }
    return () => {
      for (const check of checks) check();
      this.assertChanges(context, next, choices);
    };
  }
  async prepareTarget(record: FlowRecord, target: Target): Promise<RunResultPreparedSources> {
    const prepared: RunResultPreparedSources = {};
    for (const node of walk(record.flow.steps).filter((n) => n.type === 'run-result')) {
      const context = await this.context(target, node.binding);
      const slot = record.bindings.resources?.[node.binding];
      if (!slot || !equal(slot, context.resources[node.binding]))
        throw Error('结果绑定已撤回或变化，请重新核对');
      const ref = this.binding(slot),
        loaded = await this.load(context, ref.run.id, ref);
      prepared[node.binding] = {
        binding: node.binding,
        ref,
        owner: context.owner,
        proofSha256: loaded.proof.proofSha256,
        registeredPosition: loaded.position,
      };
    }
    return prepared;
  }
  async perform(
    snapshot: FlowRecord & Partial<PreparedScripts>,
    target: Target,
    binding: string,
    runId: string,
    active: () => void,
  ): Promise<Read> {
    active();
    const fixed = snapshot.resultSources?.[binding];
    if (!fixed) throw Error('运行没有固定的结果来源，未自动回填');
    verifyPrepared({ [binding]: fixed }, runId);
    const context = await this.context(target, binding);
    if (
      !equal(context.resources[binding], { result: fixed.ref }) ||
      !equal(context.owner, fixed.owner)
    )
      throw Error('结果绑定已撤回或变化，已停止新读取');
    const loaded = await this.load(context, fixed.ref.run.id, fixed.ref),
      p = loaded.proof;
    if (p.proofSha256 !== fixed.proofSha256 || loaded.position !== fixed.registeredPosition)
      throw Error('运行固定来源已变化，未换用新结果');
    active();
    loaded.assertCurrent();
    const result: Read = {
      version: 1,
      operation: 'read',
      binding,
      ref: p.ref,
      value: p.value,
      dataChanged: p.dataChanged,
      schemaValidation: 'passed',
      labels: p.labels,
      labelsComplete: p.labelsComplete,
    };
    shape('RunResultRead', result);
    verifyRead(result, context.owner, context.resource);
    return result;
  }
}
