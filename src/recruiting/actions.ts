import type { Policy, Action, Contact } from '../shared/types';
import { Store } from '../host/store';
import { digest, now } from '../shared/utils';
export type Proposal = {
  platform: 'boss' | 'zhaopin';
  account: string;
  target: string;
  company: string;
  job: string;
  contact: string;
  kind: Action['kind'];
  content: string;
  contextHash: string;
  resumeVersion: string;
  sharedValue?: string;
  eventId: string;
};
export type PreparedAction = Proposal & {
  id: string;
  policyHash: string;
  state: Action['state'];
  reason?: string;
  createdAt: string;
  confirmedHash?: string;
  evidence?: string;
  flowId?: string;
  submittedAt?: string;
};
export function authorizationHash(p: Proposal, policy: Policy) {
  return digest({ p, policy });
}
export function policyDecision(
  p: Proposal,
  policy: Policy,
  count: number,
  time = new Date(),
): string | undefined {
  if (p.platform !== policy.platform || p.account !== policy.account) return '账号或平台不匹配';
  if (p.resumeVersion !== policy.resumeVersion) return '简历版本已经改变';
  if (!policy.allowedTargets.includes(p.target)) return '目标超出配置范围';
  if (policy.excludedCompanies.some((x) => p.company.includes(x))) return '公司在排除名单';
  if (policy.keywords.length && !policy.keywords.some((x) => p.job.includes(x)))
    return '职位不匹配筛选条件';
  if (policy.actions[p.kind] === 'deny') return '此类动作已禁止';
  const hour = Number(
    new Intl.DateTimeFormat('en', {
      timeZone: policy.timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(time),
  );
  if (hour < policy.startHour || hour >= policy.endHour) return '不在配置执行时段';
  if (count >= policy.dailyLimit) return '达到每日动作上限';
  if (
    (p.kind === 'requestWechat' || p.kind === 'acceptWechat') &&
    (!policy.ownWechat || p.sharedValue !== policy.ownWechat)
  )
    return '微信分享内容无法与授权核对';
  if (
    (p.kind === 'requestPhone' || p.kind === 'acceptPhone') &&
    (!policy.ownPhone || p.sharedValue !== policy.ownPhone)
  )
    return '手机号分享内容无法与授权核对';
  if (!p.contextHash || !p.eventId || !p.content) return '动作内容或上下文证据不完整';
}
export class RecruitingActions {
  constructor(
    private store: Store,
    private notify: () => Promise<any> = async () => {},
  ) {}
  private count(p: Proposal, policy: Policy, time: Date) {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: policy.timezone,
    }).format(time);
    return this.store.list<PreparedAction>('action').filter(
      (a) =>
        a.platform === p.platform &&
        a.account === p.account &&
        ['SUBMITTING', 'CONFIRMED', 'WAITING_PEER', 'UNKNOWN'].includes(a.state) &&
        new Intl.DateTimeFormat('en-CA', {
          timeZone: policy.timezone,
        }).format(new Date(a.submittedAt ?? a.createdAt)) === date,
    ).length;
  }
  prepare(p: Proposal, policy: Policy, time = new Date(), flowId?: string): PreparedAction {
    const id = digest({
      platform: p.platform,
      account: p.account,
      target: p.target,
      kind: p.kind,
      eventId:
        p.kind === 'apply' ? 'application' : p.kind === 'resume' ? p.resumeVersion : p.eventId,
    });
    const old = this.store.get<PreparedAction>('action', id);
    // Regenerated text or changed permissions cannot make an already attempted
    // external operation into a new send. Unsent revisions lose confirmation.
    if (
      old &&
      (['SUBMITTING', 'CONFIRMED', 'WAITING_PEER', 'UNKNOWN', 'FAILED'].includes(old.state) ||
        old.policyHash === authorizationHash(p, policy))
    )
      return old;
    const reason = policyDecision(p, policy, this.count(p, policy, time), time);
    const state = reason
      ? 'BLOCKED'
      : policy.actions[p.kind] === 'auto'
        ? 'READY'
        : 'PENDING_CONFIRMATION';
    const a: PreparedAction = {
      ...p,
      id,
      policyHash: authorizationHash(p, policy),
      state,
      reason,
      createdAt: time.toISOString(),
      ...(flowId ? { flowId } : {}),
    };
    this.store.tx(() => {
      if (old) this.store.put('action-revision', old.id + ':' + old.policyHash, old);
      this.store.put('action', id, a);
      if (state === 'PENDING_CONFIRMATION' || state === 'BLOCKED')
        this.store.attention(
          'confirmation',
          '招聘动作需要处理',
          {
            actionId: id,
            proposal: p,
            reason: reason ?? '请确认具体目标、内容和暴露的信息',
          },
          'action:' + id + ':' + a.policyHash,
        );
    });
    return a;
  }
  confirm(id: string, policy: Policy, expectedHash?: string) {
    const a = this.store.get<PreparedAction>('action', id);
    if (!a || a.state !== 'PENDING_CONFIRMATION') throw new Error('动作当前不可确认');
    if (expectedHash && expectedHash !== a.policyHash)
      throw new Error('待办内容已更新，请重新查看');
    const p = proposalOf(a);
    if (authorizationHash(p, policy) !== a.policyHash) throw new Error('配置已变化，确认失效');
    this.store.put('action', id, {
      ...a,
      confirmedHash: a.policyHash,
      state: 'READY',
    });
  }
  async submit(
    id: string,
    current: Proposal,
    policy: Policy,
    perform: () => Promise<{
      state: 'CONFIRMED' | 'WAITING_PEER' | 'FAILED';
      evidence: string;
    }>,
    time = new Date(),
  ) {
    const a = this.store.get<PreparedAction>('action', id);
    if (!a || a.state !== 'READY') throw new Error('动作不可再次提交');
    const reason = policyDecision(current, policy, this.count(current, policy, time), time);
    if (
      reason ||
      authorizationHash(current, policy) !== a.policyHash ||
      (policy.actions[a.kind] === 'confirm' && a.confirmedHash !== a.policyHash)
    ) {
      this.store.put('action', id, {
        ...a,
        state: 'BLOCKED',
        reason: reason ?? '目标、内容、上下文或授权已变化',
      });
      throw new Error(reason ?? '动作确认已过期');
    }
    const submitting = { ...a, submittedAt: time.toISOString() };
    this.store.put('action', id, { ...submitting, state: 'SUBMITTING' }); // Durable reservation precedes any external operation.
    try {
      const result = await perform();
      if (!result.evidence) throw new Error('缺少页面回读证据');
      this.store.put('action', id, { ...submitting, ...result });
      return result;
    } catch (e) {
      this.store.tx(() => {
        this.store.put('action', id, {
          ...submitting,
          state: 'UNKNOWN',
          evidence: '提交中断或无法核对',
        });
        this.store.attention(
          'unknown-result',
          '外发结果待核对',
          { actionId: id, target: a.target, kind: a.kind },
          'unknown:' + id,
        );
      });
      throw e;
    }
  }
  recordContact(c: Contact) {
    const valid =
      c.owner === 'peer' &&
      c.state === 'visible' &&
      Boolean(c.source) &&
      Boolean(c.contact) &&
      !/[＊*•]/.test(c.value) &&
      (c.kind === 'wechat'
        ? /^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/.test(c.value)
        : /^\+?\d[\d -]{5,18}$/.test(c.value));
    if (!valid)
      return this.store.attention(
        'limitation',
        '联系方式需要人工查看',
        { platform: c.platform, target: c.target, source: c.source },
        digest({
          platform: c.platform,
          account: c.account,
          target: c.target,
          kind: c.kind,
          source: c.source,
        }),
      );
    const id = digest({
      platform: c.platform,
      account: c.account,
      contact: c.contact,
      kind: c.kind,
      value: c.value,
    });
    if (this.store.get('contact', id)) return this.store.get('contact', id);
    this.store.tx(() => {
      this.store.put('contact', id, c);
      this.store.attention(
        'contact',
        c.kind === 'wechat' ? '已取得对方微信号' : '已取得对方手机号',
        c,
        'contact:' + id,
      );
    });
    void this.notify().catch(() => {});
    return c;
  }
}
function proposalOf(a: PreparedAction): Proposal {
  const {
    platform,
    account,
    target,
    company,
    job,
    contact,
    kind,
    content,
    contextHash,
    resumeVersion,
    sharedValue,
    eventId,
  } = a;
  return {
    platform,
    account,
    target,
    company,
    job,
    contact,
    kind,
    content,
    contextHash,
    resumeVersion,
    ...(sharedValue === undefined ? {} : { sharedValue }),
    eventId,
  };
}
