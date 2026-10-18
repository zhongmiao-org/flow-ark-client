import {
  validateSkillUpdateApplication,
  validateSkillUpdateDetail,
} from '../../contracts/skill-update-application';
import { walk } from '../core/validate';
import {
  createSkillUpdateBundle,
  validateSkillUpdateBundle,
  validateSkillUpdateInput,
  skillUpdateInfo,
  skillUpdateUnchanged,
  createReview,
  projectApplication,
  matchCommittedReceipt,
  mergeSkillUpdateEvidence,
} from '../../contracts/skill-update-review';
import type {
  SkillUpdateBundle,
  SkillUpdateOrigin,
  SkillUpdateInfo,
  SkillUpdateReview,
  SkillUpdateApply,
  SkillUpdateReceipt,
  SkillUpdateProposalOutput,
  SkillUpdateApplication,
} from '../shared/contracts.generated';
import { randomBytes } from 'node:crypto';
import {
  skillTrialPreview,
  skillTrialDigest,
  validateSkillTrialStatus,
} from '../../contracts/skill-trial';
import type { SkillTrialSource, SkillTrialPreview, SkillTrialStatus } from '../shared/skill-trial';
import type { Store } from './store';
import type { FlowRecord } from '../shared/types';
import { canonical, digest, now, uid } from '../shared/utils';
import {
  skillBytes,
  skillKey,
  assertSkillDraft,
  assertSkillRef,
  assertSkillProposal,
  assertSkillVersion,
  skillBinding,
  type SkillNode,
  type SkillVersionRef,
  type SkillDraft,
  type SkillVersion,
  type SkillProposalSnapshot,
  type SkillManifest,
  type SkillProposeOutput,
} from '../shared/skill';
import {
  workspace,
  readSkillFiles,
  writeSkillFiles,
  observeSkill,
  byteDigest,
  type Workspace,
} from './skill-files';
type ApplyJournal = {
  input: SkillUpdateApply;
  confirmationSha256: string;
  epoch: string;
  status: 'pending' | 'applied' | 'rejected';
};
type Saved = { workspace: Workspace; snapshot: SkillProposalSnapshot; baseObservation?: string };
type Registered = {
  id: string;
  workspace: Workspace;
  version: SkillVersion;
  sourceFlowId: string;
  sourceNodeId: string;
};
type Operation = {
  id: string;
  proposalId: string;
  revision: number;
  token: string;
  manifest: SkillManifest;
  draft: SkillDraft;
  workspace: Workspace;
  baseObservation: string | null;
  state: 'publishing' | 'unknown' | 'confirmed' | 'failed';
};
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const headKey = (w: Workspace, key: string) => digest({ workspace: w, key });
const versionKey = (w: Workspace, ref: SkillVersionRef) => digest({ workspace: w, ref });
export class Skills {
  private queues = new Map<string, Promise<unknown>>();
  private jobs = new Set<Promise<unknown>>();
  private previews = new Map<
    string,
    {
      id: string;
      revision: number;
      draftHash: string;
      baseObservation: string | null;
      workspace: Workspace;
      expires: number;
    }
  >();
  private updateEpoch = randomBytes(16).toString('hex');
  private updateReviews = new Map<string, SkillUpdateReview>();
  private closed = false;
  constructor(
    private store: Store,
    private deps: {
      available: () => void;
      notify: () => Promise<unknown>;
      verifyConversation?: (evidence: unknown, current: boolean) => void;
      verifyDocument?: (evidence: unknown, current: boolean, runId?: string) => void;
      updated?: (ref: SkillVersionRef) => Promise<unknown>;
    },
  ) {
    for (const saved of store.list<Saved>('skill-proposal'))
      if (saved.snapshot.status === 'publishing') {
        saved.snapshot.status = 'unknown';
        saved.snapshot.error = '上次保存已中断，请核对同一操作；未自动重新写出。';
        saved.snapshot.revision++;
        this.persist(saved);
        const op = store.get<Operation>('skill-operation', saved.snapshot.publication!.requestId);
        if (op) {
          op.state = 'unknown';
          store.put('skill-operation', op.id, op);
        }
      }
  }
  private available() {
    if (this.closed) throw Error('Skill保存服务正在退出');
    this.deps.available();
  }
  private async exclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.queues.set(key, next);
    this.jobs.add(next);
    try {
      return await next;
    } finally {
      this.jobs.delete(next);
      if (this.queues.get(key) === next) this.queues.delete(key);
    }
  }
  private get(id: string, revision?: number) {
    const v = this.store.get<Saved>('skill-proposal', id);
    if (!v) throw Error('Skill草稿不存在');
    assertSkillProposal(v.snapshot);
    if (revision !== undefined && v.snapshot.revision !== revision)
      throw Error('Skill草稿已变化，当前输入保留；请重新读取后继续');
    return v;
  }
  private verifyEvidence(draft: SkillDraft, current = true) {
    for (const e of draft.evidence)
      if (
        e.kind === 'conversation' ||
        e.kind === 'conversation-checkpoint' ||
        e.kind === 'source-reduction'
      ) {
        if (!this.deps.verifyConversation) throw Error('会话来源核对不可用，草稿未确认');
        this.deps.verifyConversation(e, current);
      }
  }
  private updateBundle(saved: Saved): SkillUpdateBundle | null {
    const row = this.store.get<{
      workspace: Workspace;
      bundle: SkillUpdateBundle;
      fingerprint: string;
    }>('skill-update-bundle', saved.snapshot.id);
    if (!row) return null;
    const b = validateSkillUpdateBundle(row.bundle) as SkillUpdateBundle,
      s = saved.snapshot;
    const original = this.store.get<FlowRecord>('snapshot', b.origin.runId);
    const node = original && walk(original.flow.steps).find((n) => n.id === b.origin.nodeId);
    if (node?.type !== 'skill' || node.version !== 2 || node.binding !== b.workspaceBinding)
      throw Error('更新节点与原快照不一致');
    const parent = this.registered(saved.workspace, b.base).version;
    assertSkillVersion(parent);
    if (
      !same(row.workspace, saved.workspace) ||
      row.fingerprint !== s.sourceFingerprint ||
      b.proposalId !== s.id ||
      b.workspaceBinding !== s.workspaceBinding ||
      b.base.key !== s.key ||
      b.origin.flowId !== s.sourceFlowId ||
      b.origin.nodeId !== s.sourceNodeId ||
      !original ||
      original.id !== b.origin.flowId ||
      digest(original) !== b.origin.executionVersionId ||
      !same(b.baseline, this.content(parent)) ||
      !same(b.baselineEvidence, parent.evidence)
    )
      throw Error('更新建议的基线、工作区或原运行登记不可核验');
    return b;
  }
  private content(d: SkillDraft | SkillVersion) {
    return { title: d.title, markdown: d.markdown, data: d.data };
  }
  private verifyProposalEvidence(saved: Saved, draft = saved.snapshot.draft, current = true) {
    const b = this.updateBundle(saved);
    if (!b) {
      this.verifyEvidence(draft, current);
      return;
    }
    if (!saved.snapshot.base || saved.snapshot.base.key !== b.base.key)
      throw Error('更新建议必须核对同一键的准确发布父版本');
    const parent = this.registered(saved.workspace, saved.snapshot.base).version;
    const inherited = new Set([...b.baselineEvidence, ...parent.evidence].map((e) => digest(e)));
    for (const evidence of draft.evidence) {
      const isCurrent = current && !inherited.has(digest(evidence));
      if (evidence.kind === 'document') {
        if (!this.deps.verifyDocument) throw Error('资料来源登记核对不可用');
        this.deps.verifyDocument(evidence, isCurrent, isCurrent ? b.origin.runId : undefined);
      } else if (evidence.kind !== 'manual') {
        if (!this.deps.verifyConversation) throw Error('会话来源登记核对不可用');
        this.deps.verifyConversation(evidence, isCurrent);
      }
    }
  }
  updateInfo(id: string, revision: number): SkillUpdateInfo | null {
    this.available();
    const saved = this.get(id, revision),
      b = this.updateBundle(saved);
    return b ? skillUpdateInfo(b, revision) : null;
  }
  async proposeUpdate(
    record: FlowRecord,
    node: Extract<SkillNode, { version: 2 }>,
    path: string,
    input: unknown,
    origin: SkillUpdateOrigin,
    check: () => void,
  ): Promise<SkillUpdateProposalOutput> {
    this.available();
    const actual = this.store.get<FlowRecord>('snapshot', origin.runId);
    if (
      !actual ||
      !same(actual, record) ||
      origin.flowId !== record.id ||
      origin.nodeId !== node.id ||
      origin.executionVersionId !== digest(actual) ||
      !walk(actual.flow.steps).some((n) => same(n, node))
    )
      throw Error('更新提案须来自实际固定运行的准确节点');
    validateSkillUpdateInput(input);
    const candidate = input as SkillDraft & { base: SkillVersionRef };
    const draft: SkillDraft = {
      title: candidate.title,
      markdown: candidate.markdown,
      data: candidate.data,
      evidence: candidate.evidence,
    };
    assertSkillDraft(draft);
    const w = await workspace(path),
      base = candidate.base;
    const fingerprint = digest({
      update: 1,
      workspace: w,
      flow: record.id,
      node: node.id,
      nodeInstance: origin.nodeInstance,
      execution: origin.executionVersionId,
      base,
      draft,
    });
    return this.exclusive(headKey(w, base.key), async () => {
      this.available();
      check();
      const old = this.store.get<{ id: string }>('skill-update-index', fingerprint);
      if (old) {
        const existing = this.get(old.id),
          b = this.updateBundle(existing);
        if (
          !b ||
          !same(existing.workspace, w) ||
          !same(b.base, base) ||
          !same(b.suggestion, draft) ||
          ['unknown', 'discarded', 'publishing'].includes(existing.snapshot.status)
        )
          throw Error('原更新提案需要本人核对，未创建替代身份或重置手工内容');
        const s = existing.snapshot;
        return s.status === 'confirmed'
          ? {
              version: 1,
              status: 'confirmed',
              base,
              proposalId: s.id,
              revision: s.revision,
              ref: s.confirmed!,
            }
          : { version: 1, status: 'pending', base, proposalId: s.id, revision: s.revision };
      }
      const parent = await this.read(w.path, base);
      this.available();
      check();
      if (!same(await workspace(w.path), w) || !same(this.head(w, base.key), base))
        throw Error('父版本或工作区已变化，请重新核对');
      const timestamp = now(),
        proposalId = 'sp_' + randomBytes(16).toString('hex');
      const b = createSkillUpdateBundle({
        version: 1,
        proposalId,
        workspaceBinding: node.binding,
        origin,
        base,
        baseline: this.content(parent),
        baselineEvidence: parent.evidence,
        suggestion: draft,
        createdAt: timestamp,
      }) as SkillUpdateBundle;
      const saved: Saved = {
        workspace: w,
        snapshot: {
          version: 1,
          id: proposalId,
          revision: 1,
          key: base.key,
          workspaceBinding: node.binding,
          sourceFlowId: record.id,
          sourceNodeId: node.id,
          sourceFingerprint: fingerprint,
          base,
          status: 'draft',
          draft: { ...this.content(parent), evidence: parent.evidence },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };
      const verifyCandidate = () => {
        const historical = new Set(parent.evidence.map((e) => digest(e)));
        for (const e of draft.evidence) {
          const current = !historical.has(digest(e));
          if (e.kind === 'document') {
            if (!this.deps.verifyDocument) throw Error('资料来源核对不可用');
            this.deps.verifyDocument(e, current, current ? origin.runId : undefined);
          } else if (e.kind !== 'manual') {
            if (!this.deps.verifyConversation) throw Error('会话来源核对不可用');
            this.deps.verifyConversation(e, current);
          }
        }
      };
      verifyCandidate();
      const observation = await this.baseline(saved);
      this.available();
      check();
      if (!same(await workspace(w.path), w)) throw Error('工作区身份已变化');
      verifyCandidate();
      if (skillUpdateUnchanged(b.baseline, draft)) return { version: 1, status: 'unchanged', base };
      if (this.store.count('skill-proposal') >= 1000) throw Error('Skill草稿已达到本机上限');
      this.store.tx(() => {
        this.available();
        check();
        if (!same(this.head(w, base.key), base)) throw Error('确认头已变化');
        verifyCandidate();
        this.store.put('skill-update-bundle', proposalId, { workspace: w, bundle: b, fingerprint });
        this.persist(saved, true);
        this.store.put('skill-update-index', fingerprint, { id: proposalId });
      });
      void this.deps.notify().catch(() => {});
      return { version: 1, status: 'pending', base, proposalId, revision: 1 };
    });
  }
  private async updateContext(saved: Saved) {
    const s = saved.snapshot,
      b = this.updateBundle(saved);
    if (!b || !s.base || ['publishing', 'unknown', 'confirmed', 'discarded'].includes(s.status))
      throw Error('当前提案不能应用建议，请核对原操作或父版本');
    const revision = s.revision;
    if (!same(await workspace(saved.workspace.path), saved.workspace))
      throw Error('Skill工作区身份已变化');
    const observation = await this.baseline(saved);
    this.available();
    const latest = this.get(s.id, revision);
    this.verifyProposalEvidence(latest);
    this.verifyProposalEvidence(latest, b.suggestion);
    if (!same(latest.snapshot, s)) throw Error('草稿已变化，请重新核对');
    return {
      proposalId: s.id,
      revision,
      epoch: this.updateEpoch,
      base: b.base,
      publishBase: s.base,
      bundleSha256: b.sha256,
      baseline: b.baseline,
      current: this.content(s.draft),
      suggested: this.content(b.suggestion),
      sourceSha256: digest({
        baselineEvidence: b.baselineEvidence,
        suggestionEvidence: b.suggestion.evidence,
        currentEvidence: s.draft.evidence,
      }),
      workspaceRevision: digest({
        workspace: saved.workspace,
        head: this.head(saved.workspace, s.key),
        publishBase: s.base,
        observation,
      }),
    };
  }
  async reviewUpdate(id: string, revision: number): Promise<SkillUpdateReview> {
    this.available();
    const initial = this.get(id, revision);
    return this.exclusive(headKey(initial.workspace, initial.snapshot.key), async () => {
      this.noPendingApplication(id);
      const saved = this.get(id, revision),
        context = await this.updateContext(saved);
      const time = Date.now(),
        review = createReview(
          context,
          'sur_' + randomBytes(16).toString('hex'),
          new Date(time).toISOString(),
          new Date(time + 300000).toISOString(),
        ) as SkillUpdateReview;
      let bytes = 0;
      for (const [key, value] of this.updateReviews) {
        if (Date.parse(value.expiresAt) <= time) this.updateReviews.delete(key);
        else bytes += skillBytes(value);
      }
      if (this.updateReviews.size >= 64 || bytes + skillBytes(review) > 32 * 1048576)
        throw Error('待核对建议已达读取上限，请稍后重新核对');
      this.updateReviews.set(review.reviewId, structuredClone(review));
      return review;
    });
  }
  private application(id: string): SkillUpdateApplication | null {
    const last = this.store.get<{ key: string }>('skill-update-last', id);
    if (!last) return null;
    const row = this.store.get<ApplyJournal>('skill-update-request', last.key);
    if (!row || row.input.proposalId !== id || row.confirmationSha256 !== digest(row.input))
      throw Error('原应用请求登记不可核验');
    const receipt =
      this.store.get<{ receipt: SkillUpdateReceipt }>('skill-update-apply', last.key)?.receipt ??
      null;
    const state = receipt ? 'applied' : row.status;
    if (state === 'applied' && !receipt) throw Error('应用状态缺少真实提交回执');
    return validateSkillUpdateApplication({
      status: state,
      input: row.input,
      receipt,
    }) as SkillUpdateApplication;
  }
  private noPendingApplication(id: string) {
    if (this.application(id)?.status === 'pending')
      throw Error('原应用请求尚待核对，请先核对同一请求；不能开始新确认');
  }
  async applyUpdate(input: SkillUpdateApply): Promise<SkillUpdateReceipt> {
    validateSkillUpdateApplication({ status: 'pending', input, receipt: null });
    this.available();
    const initial = this.get(input.proposalId),
      key = digest({ proposalId: input.proposalId, requestId: input.requestId });
    return this.exclusive(headKey(initial.workspace, initial.snapshot.key), async () => {
      this.available();
      const prior = this.store.get<{ receipt: SkillUpdateReceipt }>('skill-update-apply', key);
      if (prior) return matchCommittedReceipt(input, prior.receipt) as SkillUpdateReceipt;
      let row = this.store.get<ApplyJournal>('skill-update-request', key);
      if (row && row.confirmationSha256 !== digest(input))
        throw Error('原应用请求身份已使用，不能更换内容');
      if (
        row &&
        (row.input.proposalId !== input.proposalId ||
          digest(row.input) !== row.confirmationSha256 ||
          !['pending', 'rejected'].includes(row.status))
      )
        throw Error('原应用状态与可信回执不一致，停止新应用');
      if (row?.status === 'rejected')
        throw Error('原应用请求已经核对为未提交，请重新核对建议；不重放旧请求');
      if (!row) {
        this.noPendingApplication(input.proposalId);
        if (this.store.count('skill-update-request') >= 10000)
          throw Error('更新请求记录已达到本机上限');
        this.get(input.proposalId, input.revision);
        row = {
          input: structuredClone(input),
          confirmationSha256: digest(input),
          epoch: this.updateEpoch,
          status: 'pending',
        };
        this.store.tx(() => {
          this.store.put('skill-update-request', key, row);
          this.store.put('skill-update-last', input.proposalId, { key });
        });
      }
      try {
        const review = this.updateReviews.get(input.reviewId);
        if (!review || row.epoch !== this.updateEpoch) throw Error('原核对已过期或重启');
        const saved = this.get(input.proposalId, input.revision),
          context = await this.updateContext(saved);
        const projected = projectApplication(input, review, context, Date.now()),
          b = this.updateBundle(saved)!;
        if (projected.changed) {
          saved.snapshot.draft = {
            ...projected.content,
            evidence: mergeSkillUpdateEvidence(
              saved.snapshot.draft.evidence,
              b.suggestion.evidence,
            ),
          };
          assertSkillDraft(saved.snapshot.draft);
          saved.snapshot.revision = projected.receipt.revisionAfter;
          saved.snapshot.status = 'draft';
          delete saved.snapshot.error;
        }
        this.store.tx(() => {
          this.available();
          this.get(input.proposalId, input.revision);
          this.verifyProposalEvidence(saved);
          this.verifyProposalEvidence(saved, b.suggestion);
          if (projected.changed) this.persist(saved, true);
          this.store.put('skill-update-apply', key, { receipt: projected.receipt });
          this.store.put('skill-update-request', key, { ...row!, status: 'applied' });
        });
        if (projected.changed)
          for (const [token, p] of this.previews)
            if (p.id === input.proposalId) this.previews.delete(token);
        return projected.receipt as SkillUpdateReceipt;
      } catch (error) {
        if (this.store.fault) throw Error('本地存储无法核验，原应用请求保持待核对；没有自动重试');
        const committed = this.store.get<{ receipt: SkillUpdateReceipt }>(
          'skill-update-apply',
          key,
        );
        if (committed) return matchCommittedReceipt(input, committed.receipt) as SkillUpdateReceipt;
        this.store.put('skill-update-request', key, { ...row!, status: 'rejected' });
        throw Error(
          '已核对原请求未提交；请重新核对建议。' + (error instanceof Error ? error.message : ''),
        );
      }
    });
  }
  trialUnchanged(source: SkillTrialSource) {
    this.available();
    this.noPendingApplication(source.proposalId);
    const s = this.get(source.proposalId).snapshot;
    this.verifyProposalEvidence(this.get(s.id), s.draft);
    if (
      !['draft', 'failed', 'conflict'].includes(s.status) ||
      s.revision !== source.revision ||
      skillTrialDigest(s.key, s.base, s.draft) !== source.sha256
    )
      throw Error('试聊采用的草稿已变化或不可用，请返回当前草稿重新建立；未调用模型');
  }
  async trialPreview(id: string, revision: number): Promise<SkillTrialPreview> {
    this.available();
    const saved = this.get(id, revision);
    const preview = skillTrialPreview(saved.snapshot) as SkillTrialPreview;
    const current = await workspace(saved.workspace.path);
    this.available();
    if (!same(current, saved.workspace)) throw Error('Skill工作区身份已变化，请先核对');
    this.get(id, revision);
    this.trialUnchanged(preview.source);
    return structuredClone(preview);
  }
  async trialInput(source: SkillTrialSource) {
    const preview = await this.trialPreview(source.proposalId, source.revision);
    if (!same(source, preview.source)) throw Error('试聊来源与当前核对草稿不一致');
    const s = this.get(source.proposalId, source.revision).snapshot;
    return { preview, flowId: s.sourceFlowId, nodeId: s.sourceNodeId };
  }
  async trialStatus(source: SkillTrialSource): Promise<SkillTrialStatus> {
    this.available();
    let saved: Saved;
    try {
      saved = this.get(source.proposalId);
    } catch {
      return validateSkillTrialStatus({
        version: 1,
        source,
        current: null,
        usable: false,
        reason: 'unavailable',
        message: '原草稿不可用；旧历史保留，停止新请求。',
      });
    }
    let validWorkspace = false;
    try {
      validWorkspace = same(await workspace(saved.workspace.path), saved.workspace);
    } catch {}
    this.available();
    const latest = this.get(source.proposalId);
    const s = latest.snapshot;
    let validSource = true;
    try {
      this.verifyProposalEvidence(this.get(s.id), s.draft);
    } catch {
      validSource = false;
    }
    if (!validSource)
      return validateSkillTrialStatus({
        version: 1,
        source,
        current: null,
        usable: false,
        reason: 'unavailable',
        message: '确认来源已被新内容取代；旧试聊保留，请先核对当前来源。',
      });
    const current = {
      revision: s.revision,
      sha256: skillTrialDigest(s.key, s.base, s.draft),
      status: s.status,
    };
    const reason = !['draft', 'failed', 'conflict'].includes(s.status)
      ? 'blocked'
      : current.revision !== source.revision || current.sha256 !== source.sha256
        ? 'changed'
        : !validWorkspace || !same(latest.workspace, saved.workspace)
          ? 'workspace'
          : 'ready';
    const messages = {
      ready: '',
      blocked: '草稿或确认来源已变化、发布或待核对，旧试聊停止新请求。',
      changed: '草稿已修改；旧历史保留，请返回当前草稿重新建立。',
      workspace: '原工作区不可用或身份已变化，请先核对。',
    };
    return validateSkillTrialStatus({
      version: 1,
      source,
      current,
      usable: reason === 'ready',
      reason,
      message: messages[reason],
    });
  }
  private attention(s: SkillProposalSnapshot) {
    const a = this.store.attention(
      'confirmation',
      s.draft.title,
      {
        skillProposalId: s.id,
        message: '核对Skill正文、数据与来源后，明确确认保存。',
        status: s.status,
      },
      'skill:' + s.id,
    );
    this.store.put('attention', a.id, {
      ...a,
      read: s.status === 'confirmed' || s.status === 'discarded',
      detail: { ...a.detail, status: s.status },
    });
  }
  private persist(saved: Saved, inside = false) {
    const s = saved.snapshot;
    if (s.revision >= Number.MAX_SAFE_INTEGER - 1) throw Error('Skill草稿修订超过范围');
    s.updatedAt = now();
    assertSkillProposal(s);
    const write = () => {
      this.store.put('skill-proposal', s.id, saved);
      this.attention(s);
    };
    if (inside) write();
    else this.store.tx(write);
    return structuredClone(s);
  }
  private head(w: Workspace, key: string) {
    return this.store.get<{ ref: SkillVersionRef }>('skill-head', headKey(w, key))?.ref ?? null;
  }
  private registered(w: Workspace, ref: SkillVersionRef) {
    assertSkillRef(ref);
    const r = this.store.get<Registered>('skill-version', versionKey(w, ref));
    if (!r || !same(r.version.ref, ref) || !same(r.workspace, w))
      throw Error('Skill版本尚未在本机核对登记');
    return r;
  }
  detail(id: string) {
    const s = this.get(id);
    return validateSkillUpdateDetail({
      proposal: structuredClone(s.snapshot),
      workspace: s.workspace.path,
      application: this.application(id),
    });
  }
  list() {
    return this.store
      .list<Registered>('skill-version')
      .slice(-1000)
      .map((r) => ({
        id: r.id,
        title: r.version.title,
        ref: r.version.ref,
        parent: r.version.parent,
        confirmedAt: r.version.confirmedAt,
        workspace: r.workspace.path,
        binding: { path: r.workspace.path, skill: r.version.ref },
      }));
  }
  async read(path: string, ref: SkillVersionRef) {
    this.available();
    const w = await workspace(path),
      r = this.registered(w, ref);
    const actual = await readSkillFiles(w, ref);
    this.available();
    if (!same(actual, r.version)) throw Error('Skill文件与本机确认记录不匹配');
    return actual;
  }
  async snapshot(record: FlowRecord, fixed?: Record<string, SkillVersion>) {
    const results: Record<string, SkillVersion> = {};
    let total = 0;
    const visit = (steps: FlowRecord['flow']['steps']) =>
      steps.flatMap((n): SkillNode[] =>
        n.type === 'skill'
          ? [n]
          : n.type === 'condition'
            ? [...visit(n.then), ...visit(n.else)]
            : n.type === 'loop'
              ? visit(n.body)
              : [],
      );
    for (const n of visit(record.flow.steps)) {
      if (n.operation !== 'read') continue;
      const binding = skillBinding(record.bindings, n.binding);
      const v = await this.read(binding.path, binding.skill);
      if (fixed && (!fixed[n.id] || !same(fixed[n.id], v)))
        throw Error('固定Skill快照与所选资源不匹配');
      total += skillBytes(v);
      if (total > 8 * 1048576) throw Error('本次运行的Skill快照合计超过8MiB');
      results[n.id] = fixed?.[n.id] ?? v;
    }
    return results;
  }
  async propose(
    record: FlowRecord,
    node: SkillNode,
    path: string,
    input: any,
    check: () => void,
  ): Promise<SkillProposeOutput> {
    this.available();
    const w = await workspace(path);
    const key = skillKey(input.key);
    const draft = {
      title: input.title,
      markdown: input.markdown,
      data: input.data,
      evidence: input.evidence,
    };
    assertSkillDraft(draft);
    const base = input.base;
    if (base !== null) assertSkillRef(base);
    if (base && base.key !== key) throw Error('Skill基线不属于当前键');
    const fingerprint = digest({ key, draft, base });
    const index = digest({ flow: record.id, node: node.id, workspace: w, key, fingerprint });
    return this.exclusive(headKey(w, key), async () => {
      this.available();
      check();
      this.verifyEvidence(draft);
      const old = this.store.get<{ id: string }>('skill-index', index);
      if (old) return this.output(this.get(old.id).snapshot);
      if (this.store.count('skill-proposal') >= 1000) throw Error('Skill草稿已达到本机上限');
      const s: SkillProposalSnapshot = {
        version: 1,
        id: 'sp_' + randomBytes(16).toString('hex'),
        revision: 1,
        key,
        workspaceBinding: node.binding,
        sourceFlowId: record.id,
        sourceNodeId: node.id,
        sourceFingerprint: fingerprint,
        base,
        status: 'draft',
        draft,
        createdAt: now(),
        updatedAt: now(),
      };
      const saved: Saved = { workspace: w, snapshot: s };
      check();
      this.store.tx(() => {
        this.persist(saved, true);
        this.store.put('skill-index', index, { id: s.id });
      });
      void this.deps.notify().catch(() => {});
      return this.output(s);
    });
  }
  private output(s: SkillProposalSnapshot): SkillProposeOutput {
    return {
      proposalId: s.id,
      revision: s.revision,
      status: s.status === 'confirmed' ? 'confirmed' : 'pending',
      ref: s.status === 'confirmed' ? s.confirmed! : null,
    };
  }
  save(id: string, revision: number, draft: unknown) {
    this.available();
    this.noPendingApplication(id);
    assertSkillDraft(draft);
    const saved = this.get(id, revision);
    this.verifyProposalEvidence(saved, draft, false);
    if (
      this.updateBundle(saved) &&
      saved.snapshot.draft.evidence.some((e) => !draft.evidence.some((x) => same(e, x)))
    )
      throw Error('本次更新保留既有来源；不能通过普通草稿编辑删除来源记录');
    if (['publishing', 'unknown', 'confirmed', 'discarded'].includes(saved.snapshot.status))
      throw Error('此Skill草稿正在保存、待核对或已经确认，请先核对状态');
    saved.snapshot.draft = structuredClone(draft);
    saved.snapshot.status = 'draft';
    delete saved.snapshot.error;
    try {
      this.verifyProposalEvidence(saved, draft);
    } catch (e) {
      saved.snapshot.status = 'conflict';
      saved.snapshot.error =
        e instanceof Error ? e.message : '确认来源已变化；手工内容已保存，请核对新来源。';
    }
    saved.snapshot.revision++;
    return this.persist(saved);
  }
  async base(id: string) {
    const saved = this.get(id),
      s = saved.snapshot;
    const head = this.head(saved.workspace, s.key);
    const base = s.base ? this.registered(saved.workspace, s.base).version : null;
    const current = head ? this.registered(saved.workspace, head).version : null;
    const observed = head ? await observeSkill(saved.workspace, head) : null;
    return {
      base,
      current,
      head,
      observation: observed?.fingerprint ?? null,
      external: observed?.draft ?? null,
    };
  }
  private async baseline(saved: Saved) {
    const s = saved.snapshot;
    const head = this.head(saved.workspace, s.key);
    if (!same(head, s.base)) throw Error('Skill已有新的确认版本，请查看差异并重新核对基线');
    if (!s.base) return null;
    this.registered(saved.workspace, s.base);
    const observation = await observeSkill(saved.workspace, s.base);
    if (saved.baseObservation) {
      if (observation.fingerprint !== saved.baseObservation)
        throw Error('基线文件再次变化，请重新核对');
    } else await this.read(saved.workspace.path, s.base);
    return observation.fingerprint;
  }
  async preview(id: string, revision: number) {
    this.available();
    const saved = this.get(id, revision);
    this.noPendingApplication(id);
    if (['publishing', 'unknown', 'confirmed', 'discarded'].includes(saved.snapshot.status))
      throw Error('当前Skill状态不可确认，请先核对已有操作');
    const current = await workspace(saved.workspace.path);
    if (!same(current, saved.workspace)) throw Error('Skill工作区身份已变化');
    if (
      this.updateBundle(saved) &&
      saved.snapshot.base &&
      same(
        this.content(saved.snapshot.draft),
        this.content(this.registered(saved.workspace, saved.snapshot.base).version),
      )
    )
      throw Error('当前内容与已确认版本相同；请先逐项采纳建议或编辑草稿，不创建重复版本');
    let observation: string | null;
    try {
      observation = await this.baseline(saved);
    } catch (e) {
      const latest = this.get(id, revision);
      latest.snapshot.status = 'conflict';
      latest.snapshot.error = e instanceof Error ? e.message : 'Skill基线不一致';
      latest.snapshot.revision++;
      this.persist(latest);
      throw e;
    }
    this.available();
    this.get(id, revision);
    this.verifyProposalEvidence(saved);
    for (const [key, value] of this.previews)
      if (value.expires < Date.now()) this.previews.delete(key);
    if (this.previews.size >= 1000) throw Error('待核对确认过多，请稍后重试');
    const token = randomBytes(32).toString('hex');
    this.previews.set(token, {
      id,
      revision,
      draftHash: digest(saved.snapshot.draft),
      baseObservation: observation,
      workspace: saved.workspace,
      expires: Date.now() + 300000,
    });
    return {
      token,
      revision,
      workspace: saved.workspace.path,
      base: saved.snapshot.base,
      draftSha256: digest(saved.snapshot.draft),
    };
  }
  async confirm(args: { id: string; revision: number; token: string; requestId: string }) {
    this.available();
    const initial = this.get(args.id);
    return this.exclusive(headKey(initial.workspace, initial.snapshot.key), async () => {
      this.available();
      if (this.store.get('skill-unstarted-revocation', args.requestId))
        throw Error('原确认请求已撤销，请重新核对草稿');
      const prior = this.store.get<Operation>('skill-operation', args.requestId);
      if (prior) {
        if (
          prior.proposalId !== args.id ||
          prior.revision !== args.revision ||
          prior.token !== args.token
        )
          throw Error('确认请求身份已使用，不能更换内容或目标');
        return this.get(args.id).snapshot;
      }
      this.noPendingApplication(args.id);
      const saved = this.get(args.id, args.revision),
        s = saved.snapshot,
        p = this.previews.get(args.token);
      if (
        !p ||
        p.id !== s.id ||
        p.revision !== s.revision ||
        p.expires < Date.now() ||
        p.draftHash !== digest(s.draft) ||
        !same(p.workspace, saved.workspace) ||
        ['publishing', 'unknown', 'confirmed', 'discarded'].includes(s.status)
      )
        throw Error('Skill确认已失效，请保留草稿并重新核对');
      const observation = await this.baseline(saved);
      this.get(args.id, args.revision);
      this.verifyProposalEvidence(this.get(s.id), s.draft);
      if (observation !== p.baseObservation) throw Error('确认期间基线已变化');
      this.available();
      if (this.store.count('skill-operation') >= 10000) throw Error('Skill确认操作已达到本机上限');
      const markdown = Buffer.from(s.draft.markdown),
        data = Buffer.from(canonical({ data: s.draft.data, evidence: s.draft.evidence }));
      const manifest: SkillManifest = {
        version: 1,
        key: s.key,
        versionId: 'sv_' + randomBytes(16).toString('hex'),
        operationId: args.requestId,
        title: s.draft.title,
        parent: s.base,
        confirmedAt: now(),
        files: [
          { path: 'SKILL.md', byteLength: markdown.length, sha256: byteDigest(markdown) },
          { path: 'data.json', byteLength: data.length, sha256: byteDigest(data) },
        ],
      };
      const candidate: SkillVersion = {
        version: 1,
        ref: { key: s.key, versionId: manifest.versionId, sha256: digest(manifest) },
        parent: s.base,
        confirmedAt: manifest.confirmedAt,
        ...s.draft,
      };
      assertSkillVersion(candidate);
      const op: Operation = {
        id: args.requestId,
        proposalId: s.id,
        revision: s.revision,
        token: args.token,
        manifest,
        draft: structuredClone(s.draft),
        workspace: saved.workspace,
        baseObservation: observation,
        state: 'publishing',
      };
      s.status = 'publishing';
      delete s.error;
      s.publication = { requestId: op.id, versionId: manifest.versionId, draftSha256: p.draftHash };
      s.revision++;
      this.store.tx(() => {
        this.store.put('skill-operation', op.id, op);
        this.persist(saved, true);
      });
      this.previews.delete(args.token);
      try {
        const result = await writeSkillFiles(saved.workspace, manifest, op.draft, () =>
          this.available(),
        );
        await this.baseline(saved);
        this.verifyProposalEvidence(saved, op.draft);
        this.available();
        const latest = this.get(s.id);
        if (
          latest.snapshot.publication?.requestId !== op.id ||
          latest.snapshot.status !== 'publishing'
        )
          throw Error('Skill保存操作已失效');
        return this.register(latest, op, result);
      } catch {
        if (this.closed || this.store.fault) return structuredClone(s);
        const latest = this.get(s.id);
        latest.snapshot.status = 'unknown';
        latest.snapshot.error = '本次保存未取得完整确认回执；请核对同一操作，未自动重试。';
        latest.snapshot.revision++;
        op.state = 'unknown';
        this.store.tx(() => {
          this.store.put('skill-operation', op.id, op);
          this.persist(latest, true);
        });
        return structuredClone(latest.snapshot);
      }
    });
  }
  async cancelUnstarted(id: string, requestId: string) {
    this.available();
    const initial = this.get(id);
    return this.exclusive(headKey(initial.workspace, initial.snapshot.key), async () => {
      this.available();
      const saved = this.get(id),
        operation = this.store.get<Operation>('skill-operation', requestId);
      if (operation) {
        if (operation.proposalId !== id) throw Error('请求不属于此草稿');
        return { cancelled: false, proposal: saved.snapshot };
      }
      const old = this.store.get<{ proposalId: string }>('skill-unstarted-revocation', requestId);
      if (old && old.proposalId !== id) throw Error('请求身份已使用');
      if (!old && this.store.count('skill-unstarted-revocation') >= 10000)
        throw Error('未开始确认的撤销记录已达到上限');
      this.store.put('skill-unstarted-revocation', requestId, { proposalId: id });
      return { cancelled: true, proposal: saved.snapshot };
    });
  }
  private register(saved: Saved, op: Operation, version: SkillVersion) {
    const s = saved.snapshot;
    const id = versionKey(saved.workspace, version.ref);
    const record: Registered = {
      id,
      workspace: saved.workspace,
      version,
      sourceFlowId: s.sourceFlowId,
      sourceNodeId: s.sourceNodeId,
    };
    s.status = 'confirmed';
    s.confirmed = version.ref;
    delete s.error;
    s.revision++;
    op.state = 'confirmed';
    const notificationId = this.store.get('skill-update-bundle', s.id)
      ? digest({ version: version.ref, workspace: saved.workspace })
      : null;
    const notifyNew =
      !!notificationId && !this.store.get('skill-update-notification', notificationId);
    this.store.tx(() => {
      this.store.put('skill-version', id, record);
      this.store.put('skill-head', headKey(saved.workspace, s.key), { ref: version.ref });
      this.store.put('skill-operation', op.id, op);
      this.persist(saved, true);
      if (notifyNew) {
        this.store.put('skill-update-notification', notificationId!, {
          ref: version.ref,
          status: 'pending',
        });
        this.store.attention(
          'confirmation',
          'Skill新版本已保存',
          {
            skillProposalId: s.id,
            version: version.ref,
            message: '已写出并登记新版本；原流程绑定保持，请明确选择新版。',
          },
          'skill-updated:' + notificationId,
        );
      }
    });
    if (notifyNew && this.deps.updated)
      void Promise.resolve()
        .then(() => this.deps.updated!(version.ref))
        .then(() => {
          if (!this.closed && !this.store.fault)
            this.store.put('skill-update-notification', notificationId!, {
              ref: version.ref,
              status: 'reported',
            });
        })
        .catch(() => {});
    return structuredClone(s);
  }
  async inspect(id: string, requestId: string) {
    this.available();
    const initial = this.get(id);
    return this.exclusive(headKey(initial.workspace, initial.snapshot.key), async () => {
      this.available();
      const saved = this.get(id),
        s = saved.snapshot,
        op = this.store.get<Operation>('skill-operation', requestId);
      if (!op || op.proposalId !== id || s.publication?.requestId !== requestId)
        throw Error('待核对操作与草稿不匹配');
      if (s.status === 'confirmed') return s;
      if (s.status !== 'unknown') throw Error('当前没有结果未知的保存');
      let version: SkillVersion;
      try {
        version = await readSkillFiles(op.workspace, {
          key: op.manifest.key,
          versionId: op.manifest.versionId,
          sha256: digest(op.manifest),
        });
      } catch {
        this.available();
        s.status = 'failed';
        s.error = '未核对到完整版本，草稿与原现场保留。再次确认会使用新的操作和新目录。';
        s.revision++;
        op.state = 'failed';
        this.store.tx(() => {
          this.store.put('skill-operation', op.id, op);
          this.persist(saved, true);
        });
        return s;
      }
      try {
        await this.baseline(saved);
        this.verifyProposalEvidence(saved, op.draft);
      } catch {
        s.status = 'conflict';
        s.error = '完整文件保留，但当前确认基线或来源已变化；本次未登记，请核对差异后另建新版本。';
        s.revision++;
        op.state = 'failed';
        this.store.tx(() => {
          this.store.put('skill-operation', op.id, op);
          this.persist(saved, true);
        });
        return s;
      }
      this.available();
      if (
        !same(
          {
            title: version.title,
            markdown: version.markdown,
            data: version.data,
            evidence: version.evidence,
          },
          op.draft,
        )
      )
        throw Error('磁盘结果与原确认草稿不匹配');
      return this.register(saved, op, version);
    });
  }
  async rebase(args: {
    id: string;
    revision: number;
    head: SkillVersionRef | null;
    observation: string | null;
    adoptExternal: boolean;
  }) {
    this.available();
    const saved = this.get(args.id);
    return this.exclusive(headKey(saved.workspace, saved.snapshot.key), async () => {
      this.noPendingApplication(args.id);
      const latest = this.get(args.id, args.revision),
        s = latest.snapshot;
      if (['publishing', 'unknown', 'confirmed', 'discarded'].includes(s.status))
        throw Error('此草稿不可修改基线');
      const current = await this.base(args.id);
      this.available();
      this.get(args.id, args.revision);
      if (!same(current.head, args.head) || current.observation !== args.observation)
        throw Error('核对内容已变化，请重新查看完整差异');
      if (args.adoptExternal) {
        if (!current.external) throw Error('未读取到可核对外部正文，当前输入保留');
        s.draft = current.external;
      }
      if (this.updateBundle(latest)) {
        if (!current.head || current.head.key !== s.key)
          throw Error('更新提案需要同键的准确父版本');
        const before = this.get(args.id, args.revision).snapshot.draft.evidence;
        s.draft.evidence = mergeSkillUpdateEvidence(before, s.draft.evidence);
        s.draft.evidence = mergeSkillUpdateEvidence(
          s.draft.evidence,
          current.current?.evidence ?? [],
        );
        assertSkillDraft(s.draft);
      }
      s.base = current.head;
      latest.baseObservation = current.observation ?? undefined;
      s.status = 'draft';
      delete s.error;
      s.revision++;
      return this.persist(latest);
    });
  }
  fork(id: string) {
    this.available();
    const original = this.store.get<Registered>('skill-version', id);
    if (!original) throw Error('确认版本不存在');
    if (this.store.count('skill-proposal') >= 1000) throw Error('Skill草稿已达到本机上限');
    const v = original.version;
    const s: SkillProposalSnapshot = {
      version: 1,
      id: 'sp_' + randomBytes(16).toString('hex'),
      revision: 1,
      key: v.ref.key,
      workspaceBinding: 'workspace',
      sourceFlowId: original.sourceFlowId,
      sourceNodeId: original.sourceNodeId,
      sourceFingerprint: digest({ fork: id, nonce: uid() }),
      base: v.ref,
      status: 'draft',
      draft: { title: v.title, markdown: v.markdown, data: v.data, evidence: v.evidence },
      createdAt: now(),
      updatedAt: now(),
    };
    return this.persist({ workspace: original.workspace, snapshot: s });
  }
  async relocate(id: string, path: string) {
    this.available();
    const old = this.store.get<Registered>('skill-version', id);
    if (!old) throw Error('原确认版本不存在');
    const w = await workspace(path);
    const actual = await readSkillFiles(w, old.version.ref);
    if (!same(actual, old.version)) throw Error('新位置与原确认版本不一致');
    this.available();
    const record = { ...old, id: versionKey(w, actual.ref), workspace: w };
    this.store.tx(() => {
      this.store.put('skill-version', record.id, record);
      const head = this.head(w, actual.ref.key);
      if (!head) this.store.put('skill-head', headKey(w, actual.ref.key), { ref: actual.ref });
    });
    return record.id;
  }
  async stop() {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise((r) => {
      timer = setTimeout(r, 2000);
    });
    try {
      await Promise.race([Promise.allSettled([...this.jobs]), deadline]);
    } finally {
      clearTimeout(timer!);
    }
    for (const saved of this.store.list<Saved>('skill-proposal'))
      if (saved.snapshot.status === 'publishing') {
        saved.snapshot.status = 'unknown';
        saved.snapshot.error = '应用退出前保存未完成核对；重开后请检查原操作。';
        saved.snapshot.revision++;
        this.persist(saved);
      }
    this.closed = true;
  }
}
