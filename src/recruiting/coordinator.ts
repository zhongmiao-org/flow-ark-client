import { validateDraft } from './ai';
import { RecruitingActions, recruitingActionId, type Proposal } from './actions';
import type { RecruitingSiteAdapter } from './sites';
import type { Policy, AIRequest, AIResult } from '../shared/types';
import { Store } from '../host/store';
import { digest, errorText } from '../shared/utils';
import { jobContent, jobFilterDecision, jobSnapshotProblem } from './job-filter';

/** Host-only finite batch. Waiting for confirmation or peers never holds a Run. */
export class RecruitingCoordinator {
  readonly actions: RecruitingActions;
  constructor(
    private store: Store,
    notify: () => Promise<any> = async () => {},
  ) {
    this.actions = new RecruitingActions(store, notify);
  }
  async run(options: {
    flowId: string;
    policy: Policy;
    currentPolicy: () => Policy | undefined;
    limit: number;
    site: RecruitingSiteAdapter;
    signal: AbortSignal;
    draft: (input: AIRequest, signal: AbortSignal) => Promise<AIResult>;
  }) {
    const { policy, site, signal } = options;
    const count = { processed: 0, submitted: 0, waiting: 0, blocked: 0, verified: false };
    const attention = (
      kind: string,
      reason: string,
      target = '',
      extra: Record<string, any> = {},
    ) => {
      this.store.attention(
        kind,
        reason,
        { platform: site.platform, target, ...extra },
        digest({
          kind,
          reason,
          target,
          platform: site.platform,
          account: policy.account,
          ...extra,
          ...(extra.jobSnapshot ? { jobSnapshot: jobContent(extra.jobSnapshot) } : {}),
        }),
      );
    };
    const assertPolicy = () => {
      signal.throwIfAborted();
      const current = options.currentPolicy();
      if (!current || digest(current) !== digest(policy))
        throw new Error('运行期间招聘配置已变化，本批次停止；请按新配置重新运行');
    };
    assertPolicy();
    const probe = await site.probe(signal);
    if (!probe.verified) {
      attention('limitation', probe.reason ?? '招聘网页尚未验证');
      return count;
    }
    if (site.platform !== policy.platform || probe.account !== policy.account) {
      attention('login', '当前网页账号与配置不一致');
      return count;
    }
    count.verified = true;
    const candidates = (
      await site.opportunities(policy, Math.min(options.limit, policy.batchLimit), signal)
    ).slice(0, Math.min(options.limit, policy.batchLimit));
    for (const candidate of candidates) {
      assertPolicy();
      if (
        candidate.platform !== policy.platform ||
        candidate.account !== policy.account ||
        !policy.allowedTargets.includes(candidate.target)
      ) {
        attention('limitation', '网页目标超出授权范围', candidate.target);
        count.blocked++;
        continue;
      }
      try {
        const context = await site.read(candidate.target, signal);
        if (
          context.account !== policy.account ||
          context.target !== candidate.target ||
          context.resumeVersion !== policy.resumeVersion
        )
          throw new Error('当前账号、目标或选定简历与配置不一致');
        for (const contact of await site.contacts(candidate.target, signal)) {
          if (
            contact.platform === policy.platform &&
            contact.account === policy.account &&
            contact.target === candidate.target
          )
            this.actions.recordContact(contact);
        }
        if (candidate.kind === 'reply' && context.replied) continue;
        if (policy.actions[candidate.kind] === 'deny') {
          count.blocked++;
          continue;
        }
        // Only the current detail page can satisfy an active filter; list hints
        // are never substituted for a missing detail snapshot.
        const observed = { ...candidate, jobSnapshot: context.jobSnapshot };
        const filterReason = jobFilterDecision(observed, policy);
        if (filterReason) {
          this.actions.invalidate(
            recruitingActionId({
              ...candidate,
              resumeVersion: policy.resumeVersion,
              eventId: context.eventId,
            }),
            filterReason,
          );
          attention(
            'limitation',
            '岗位筛选需要核对：' + candidate.company + ' · ' + candidate.job,
            candidate.target,
            {
              reason: filterReason,
              jobSnapshot:
                context.jobSnapshot && !jobSnapshotProblem(context.jobSnapshot)
                  ? context.jobSnapshot
                  : null,
              company: candidate.company,
              job: candidate.job,
            },
          );
          count.blocked++;
          continue;
        }
        let content = candidate.content ?? '';
        if (candidate.kind === 'reply') {
          const input: AIRequest = {
            provider: policy.provider,
            model: policy.model,
            facts: policy.facts,
            job: context.jobSnapshot
              ? JSON.stringify(jobContent(context.jobSnapshot))
              : candidate.job,
            conversation: context.conversation,
            contextHash: context.contextHash,
            resumeVersion: policy.resumeVersion,
          };
          const key = digest({
            platform: policy.platform,
            account: policy.account,
            target: candidate.target,
            input,
            contextRevision: policy.contextRevision,
          });
          let result = this.store.get<AIResult>('draft', key);
          if (!result) {
            result = await options.draft(input, signal);
            this.store.put('draft', key, result);
          }
          const reasons = validateDraft(result, input);
          if (reasons.length) {
            attention('confirmation', 'AI 草稿需要人工处理', candidate.target, {
              reasons,
              draft: result.draft.body,
            });
            count.blocked++;
            continue;
          }
          content = result.draft.body;
        }
        const proposal: Proposal = {
          ...observed,
          content,
          contextHash: context.contextHash,
          resumeVersion: policy.resumeVersion,
          eventId: context.eventId,
        };
        assertPolicy();
        const prepared = this.actions.prepare(proposal, policy, new Date(), options.flowId);
        count.processed++;
        if (prepared.state !== 'READY') {
          if (['PENDING_CONFIRMATION', 'WAITING_PEER'].includes(prepared.state)) count.waiting++;
          else if (prepared.state === 'BLOCKED') count.blocked++;
          continue;
        }
        const latest = await site.read(candidate.target, signal);
        assertPolicy();
        const currentProposal = { ...proposal, jobSnapshot: latest.jobSnapshot };
        const latestFilterReason = jobFilterDecision(currentProposal, policy);
        if (
          latestFilterReason ||
          digest(jobContent(latest.jobSnapshot)) !== digest(jobContent(proposal.jobSnapshot))
        ) {
          this.actions.invalidate(
            prepared.id,
            latestFilterReason ?? '岗位信息已变化，未发送旧内容',
          );
          count.blocked++;
          continue;
        }
        if (
          latest.account !== policy.account ||
          latest.target !== candidate.target ||
          latest.resumeVersion !== policy.resumeVersion ||
          latest.contextHash !== context.contextHash ||
          latest.eventId !== context.eventId ||
          (candidate.kind === 'reply' && latest.replied)
        ) {
          this.actions.invalidate(prepared.id, '会话已经变化，未发送旧内容');
          count.blocked++;
          continue;
        }
        const result = await this.actions.submit(prepared.id, currentProposal, policy, () =>
          site.submit(currentProposal, signal),
        );
        count.submitted++;
        if (result.state === 'WAITING_PEER') count.waiting++;
        for (const contact of await site.contacts(candidate.target, signal)) {
          if (
            contact.platform === policy.platform &&
            contact.account === policy.account &&
            contact.target === candidate.target
          )
            this.actions.recordContact(contact);
        }
      } catch (error) {
        if (signal.aborted) throw error;
        attention('limitation', '本轮动作已停止，请核对', candidate.target, {
          reason: errorText(error),
        });
        count.blocked++;
        // A changed login, missing entry or lost receipt ends this finite batch.
        break;
      }
    }
    return count;
  }
}
