import type { Store } from './store';
import type { PackageLibrary } from '../templates/archive';
import type { AuthorSdk } from './author-sdk';
import type { FlowRecord, PreparedScripts, Run } from '../shared/types';
import type {
  EntryResultResponse as EntryResultView,
  EntryResultSource,
  EntryResultLabel,
} from '../shared/contracts.generated';
import { executionVersion } from './run-rerun';
import { validateObject, validateFlow } from '../core/validate';
import { validateAuthorSdkContext, validateAuthorSdkResult } from '../../contracts/author-sdk';
import { packagePath, validateData, assertSchema, sha256 } from '../../contracts/package-format';
import {
  canonical,
  digest,
  bytes,
  assertWireBudget,
  seal,
  verify,
} from '../../contracts/entry-result-view.mjs';
import { redact } from '../shared/utils';

type Snapshot = FlowRecord & Partial<PreparedScripts>;
type Reason = Extract<EntryResultView, { viewStatus: 'unavailable' }>['reason'];
type Saved = { source: EntryResultSource; schema: unknown; value: unknown; present: boolean };
type Projection = {
  version: 1;
  policy: 'host-redacted-v1';
  finalized: true;
  run: { id: string; flowId: string; versionId: string };
  snapshotSha256: string;
  originalSourceSha256: string;
  originalValueSha256: string;
  source: EntryResultSource;
  present: boolean;
  value: unknown;
  displayChanged: boolean;
  labels: EntryResultLabel[];
  labelsComplete: boolean;
  integrity: string;
};
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
class Unavailable extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}
const refuse = (reason: Reason): never => {
  throw new Unavailable(reason);
};
const fingerprint = (v: unknown) => sha256(JSON.stringify(v) ?? 'undefined');
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');

/** Run-scoped historical reads. Never consults current instance settings or credentials. */
export class EntryResults {
  constructor(
    private store: Store,
    private library: Pick<PackageLibrary, 'load'>,
    private author: Pick<AuthorSdk, 'prepare'>,
  ) {}

  private records(runId: string) {
    return {
      run: this.store.get<Run>('run', runId),
      snapshot: this.store.get<Snapshot>('snapshot', runId),
      formal: this.store.get('template-result', runId),
      author: this.store.get('author-sdk-result', runId),
      projection: this.store.get<Projection>('entry-result-display', runId),
    };
  }
  private changed(runId: string, before: ReturnType<EntryResults['records']>) {
    try {
      return fingerprint(before) !== fingerprint(this.records(runId));
    } catch {
      return refuse('storage-unavailable');
    }
  }
  private tuple(run: Run) {
    const value = { id: run.id, flowId: run.flowId, versionId: run.versionId, state: run.state };
    try {
      validateObject('EntryResultRun', value);
    } catch {
      throw Error('此运行记录不可读取');
    }
    return value;
  }
  private owner(run: Run, s: Snapshot | undefined) {
    if (!s) return refuse('snapshot-missing');
    try {
      validateFlow(s.flow);
      if (
        s.id !== run.flowId ||
        s.flow.id !== run.flowId ||
        executionVersion(s, s as FlowRecord & PreparedScripts) !== run.versionId
      )
        return refuse('snapshot-mismatch');
    } catch {
      return refuse('snapshot-mismatch');
    }
    const formal = Boolean(s.bindings?.template),
      author = Boolean(s.authorSdk);
    if (formal && author) return refuse('owner-conflict');
    if (!author && s.templateData?.owner.kind === 'author-checkout')
      return refuse('owner-unavailable');
    return formal ? 'template' : author ? 'author-checkout' : 'ordinary';
  }
  private async saved(
    run: Run,
    s: Snapshot,
    r: ReturnType<EntryResults['records']>,
  ): Promise<Saved> {
    if (s.bindings.template) {
      const ref = s.bindings.template;
      let pkg;
      try {
        pkg = await this.library.load(ref.packageKey, ref.entryId);
      } catch (e: any) {
        return refuse(
          e?.code === 'ENTRY_RESULT_LIMIT'
            ? 'read-limit'
            : e?.code === 'ENOENT'
              ? 'package-missing'
              : 'package-mismatch',
        );
      }
      if (
        pkg.manifest.contentDigest !== ref.digest ||
        `${pkg.manifest.id}@${pkg.manifest.version}` !== ref.packageKey
      )
        return refuse('package-mismatch');
      const entry = pkg.manifest.entries.find((e) => e.id === ref.entryId);
      if (!entry) return refuse('entry-missing');
      try {
        if (!packagePath(entry.resultSchema).startsWith('schemas/'))
          return refuse('schema-invalid');
      } catch {
        return refuse('schema-invalid');
      }
      const b = pkg.files.get(entry.resultSchema);
      if (!b) return refuse('schema-missing');
      if (b.length > 65536) return refuse('read-limit');
      let schema;
      try {
        schema = JSON.parse(b.toString('utf8'));
        assertSchema(schema);
      } catch {
        return refuse('schema-invalid');
      }
      const source: EntryResultSource = {
        kind: 'template',
        instanceId: ref.instanceId,
        templateId: pkg.manifest.id,
        templateVersion: pkg.manifest.version,
        packageKey: ref.packageKey,
        packageDigest: ref.digest,
        entryId: entry.id,
        entryName: entry.name,
        schemaPath: entry.resultSchema,
        schemaSha256: sha256(b),
      };
      return { source, schema, value: r.formal, present: r.formal !== undefined };
    }
    const context = s.authorSdk!;
    try {
      if (bytes(context.resultSchema) > 65536) return refuse('read-limit');
    } catch (e) {
      if (e instanceof Unavailable) throw e;
      return refuse('read-limit');
    }
    try {
      validateAuthorSdkContext(context);
    } catch {
      return refuse('owner-unavailable');
    }
    if (context.owner.flowId !== run.flowId) return refuse('snapshot-mismatch');
    const source: EntryResultSource = {
      ...context.owner,
      kind: 'author-checkout',
      contextId: context.id,
      definitionSha256: context.definitionSha256,
      schemaSha256: digest(context.resultSchema),
    };
    // owner.kind is already the same discriminant; no current checkout lookup on reads.
    if (r.author !== undefined) {
      try {
        if (bytes(r.author.value) > 196608) return refuse('read-limit');
      } catch (e) {
        if (e instanceof Unavailable) throw e;
        return refuse('read-limit');
      }
      try {
        validateAuthorSdkResult(r.author, context, run.id);
      } catch {
        return refuse('result-invalid');
      }
    }
    return {
      source,
      schema: context.resultSchema,
      value: r.author?.value,
      present: r.author !== undefined,
    };
  }
  private checkValue(saved: Saved) {
    try {
      if (bytes(saved.value) > 196608) return refuse('read-limit');
    } catch (e) {
      if (e instanceof Unavailable) throw e;
      return refuse('read-limit');
    }
    try {
      validateData(saved.schema, saved.value);
    } catch {
      return refuse('result-invalid');
    }
  }
  private response(run: Run, body: object): EntryResultView {
    try {
      const view = seal({ formatVersion: '1.0', run: this.tuple(run), ...body });
      assertWireBudget(view);
      validateObject('EntryResultView', view);
      verify(view, this.tuple(run));
      return view as EntryResultView;
    } catch {
      return refuse('read-limit');
    }
  }
  /** Called only by the original Run finalizer before its authorized secrets are discarded. */
  async finalize(runId: string, secrets: () => string[]) {
    try {
      if (this.store.fault) return;
      const before = this.records(runId),
        run = before.run;
      if (!run || !terminal.has(run.state) || this.owner(run, before.snapshot) === 'ordinary')
        return;
      const snapshot = before.snapshot!;
      if (snapshot.authorSdk) this.author.prepare(snapshot); // Current registration required at capture, never borrowed later.
      const saved = await this.saved(run, snapshot, before);
      if (saved.present) this.checkValue(saved);
      // No await after final secret snapshot: later secrets cannot overtake this projection.
      const known = [...secrets()];
      const source = structuredClone(saved.source);
      for (const [key, value] of Object.entries(source)) {
        if (key === 'entryName') {
          (source as any)[key] = redact(value, known);
          continue;
        }
        if (typeof value === 'string' && redact(value, known) !== value) return;
      }
      for (const value of Object.values(this.tuple(run)))
        if (redact(value, known) !== value) return;
      const value = saved.present ? redact(saved.value, known) : null;
      const labels = extractLabels(saved.schema, saved.value, value, known);
      const body = {
        version: 1 as const,
        policy: 'host-redacted-v1' as const,
        finalized: true as const,
        run: { id: run.id, flowId: run.flowId, versionId: run.versionId },
        snapshotSha256: fingerprint(snapshot),
        originalSourceSha256: digest(saved.source),
        originalValueSha256: digest(saved.present ? saved.value : null),
        source,
        present: saved.present,
        value,
        displayChanged: saved.present && canonical(value) !== canonical(saved.value),
        ...labels,
      };
      const p: Projection = { ...body, integrity: digest(body) };
      if (saved.present)
        this.available(run, p); // Enforce complete response budgets before registration.
      else this.response(run, { viewStatus: 'missing', source });
      if (this.store.fault || fingerprint(before) !== fingerprint(this.records(runId))) return;
      this.store.put('entry-result-display', runId, p);
    } catch {
      // Preserve original Run/result; a missing finalized projection is explicitly unavailable.
      // Never persist original exceptions, Schema fragments or secret lists.
    }
  }
  private available(run: Run, p: Projection) {
    const body = {
      viewStatus: 'available',
      source: p.source,
      completion: run.state === 'SUCCEEDED' ? 'run-succeeded' : 'saved-only',
      sourceValidation: 'passed',
      privacy: p.policy,
      displayChanged: p.displayChanged,
      value: p.value,
      valueSha256: digest(p.value),
      valueBytes: bytes(p.value),
      labels: [...p.labels],
      labelsComplete: p.labelsComplete,
    };
    while (true) {
      try {
        return this.response(run, body);
      } catch (e) {
        if (!(e instanceof Unavailable) || !body.labels.length) throw e;
        body.labels.pop();
        body.labelsComplete = false;
      }
    }
  }
  async read(runId: string): Promise<EntryResultView> {
    let run: Run | undefined;
    try {
      run = this.store.get<Run>('run', runId);
    } catch {
      throw Error('此运行记录不可读取');
    }
    if (!run || run.id !== runId) throw Error('此运行记录不可读取');
    this.tuple(run);
    let before: ReturnType<EntryResults['records']> | undefined;
    try {
      if (this.store.fault) return refuse('storage-unavailable');
      try {
        before = this.records(runId);
      } catch {
        return refuse('storage-unavailable');
      }
      const kind = this.owner(run, before.snapshot);
      if (kind === 'ordinary') return this.response(run, { viewStatus: 'not-applicable' });
      if (!terminal.has(run.state)) return this.response(run, { viewStatus: 'pending' });
      const saved = await this.saved(run, before.snapshot!, before);
      let result: EntryResultView;
      {
        if (saved.present) this.checkValue(saved);
        const p = before.projection;
        if (!p || p.version !== 1 || p.finalized !== true || p.policy !== 'host-redacted-v1')
          return refuse('privacy-unavailable');
        const { integrity, ...body } = p;
        if (
          integrity !== digest(body) ||
          p.snapshotSha256 !== fingerprint(before.snapshot) ||
          p.originalSourceSha256 !== digest(saved.source) ||
          p.present !== saved.present ||
          p.originalValueSha256 !== digest(saved.present ? saved.value : null) ||
          canonical(p.run) !==
            canonical({ id: run.id, flowId: run.flowId, versionId: run.versionId })
        )
          return refuse('privacy-unavailable');
        const immutable = (source: EntryResultSource) => {
          const copy = { ...source } as Record<string, unknown>;
          delete copy.entryName;
          return copy;
        };
        if (canonical(immutable(p.source)) !== canonical(immutable(saved.source)))
          return refuse('privacy-unavailable');
        result = saved.present
          ? this.available(run, p)
          : this.response(run, { viewStatus: 'missing', source: p.source });
      }
      if (this.store.fault) return refuse('storage-unavailable');
      if (this.changed(runId, before)) return refuse('changed-during-read');
      return result;
    } catch (e) {
      // Failed asynchronous source reads must also report changes instead of mixing epochs.
      let reason: Reason = e instanceof Unavailable ? e.reason : 'owner-unavailable';
      try {
        if (before && this.changed(runId, before)) reason = 'changed-during-read';
      } catch {
        reason = 'storage-unavailable';
      }
      if (this.store.fault) reason = 'storage-unavailable';
      return this.response(run, { viewStatus: 'unavailable', reason });
    }
  }
}

function extractLabels(schema: any, original: any, display: any, secrets: string[]) {
  const labels: EntryResultLabel[] = [];
  let labelsComplete = true,
    count = 0;
  const visit = (
    definition: any,
    raw: any,
    value: any,
    path: string,
    depth: number,
    refs: Set<string>,
  ) => {
    if (++count > 5000 || depth > 40 || path.length > 2048) {
      labelsComplete = false;
      return;
    }
    if (!definition || typeof definition !== 'object') return;
    let d = definition;
    if (d.$ref) {
      if (typeof d.$ref !== 'string' || !d.$ref.startsWith('#/') || refs.has(d.$ref)) {
        labelsComplete = false;
        return;
      }
      const next = new Set(refs).add(d.$ref);
      let target = schema;
      for (const part of d.$ref.slice(2).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        if (!target || !Object.hasOwn(target, key)) {
          labelsComplete = false;
          return;
        }
        target = target[key];
      }
      // Ref siblings can change interpretation; do not invent merged annotations.
      if (Object.keys(d).some((k) => k !== '$ref')) {
        labelsComplete = false;
        return;
      }
      visit(target, raw, value, path, depth + 1, next);
      return;
    }
    if (
      [
        'allOf',
        'anyOf',
        'oneOf',
        'if',
        'then',
        'else',
        'not',
        '$dynamicRef',
        'dependentSchemas',
        'patternProperties',
        'prefixItems',
      ].some((k) => k in d)
    ) {
      labelsComplete = false;
      return;
    }
    if (typeof d.title === 'string' && d.title.length) {
      const label = redact(d.title, secrets),
        description =
          typeof d.description === 'string' ? redact(d.description, secrets) : undefined;
      if (
        label.length <= 120 &&
        (!description || description.length <= 500) &&
        labels.length < 256 &&
        redact(path, secrets) === path
      )
        labels.push({ path, label, ...(description ? { description } : {}) });
      else labelsComplete = false;
    }
    if (Array.isArray(raw) && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++)
        visit(d.items, raw[i], value[i], `${path}/${i}`, depth + 1, new Set(refs));
    } else if (
      raw &&
      value &&
      typeof raw === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(raw, key) || redact(key, secrets) !== key) {
          labelsComplete = false;
          continue;
        }
        visit(
          d.properties?.[key],
          raw[key],
          value[key],
          `${path}/${pointer(key)}`,
          depth + 1,
          new Set(refs),
        );
      }
    }
  };
  visit(schema, original, display, '', 0, new Set());
  return { labels, labelsComplete };
}
