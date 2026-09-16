import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/host/store';
import { RecruitingCoordinator } from '../src/recruiting/coordinator';
import {
  RecruitingActions,
  authorizationHash,
  type Proposal,
  type PreparedAction,
} from '../src/recruiting/actions';
import { defaultPolicy, validateRecruitingPolicy } from '../src/recruiting/policy';
import { defaultJobFilter, jobFilterDecision } from '../src/recruiting/job-filter';
import { policyOf } from '../src/host/configuration';
import type { RecruitingSiteAdapter, Conversation } from '../src/recruiting/sites';
import type { JobSnapshot, Policy, AIRequest, AIResult } from '../src/shared/types';

const observedAt = '2026-09-16T02:00:00.000Z';
const pageJob = (): JobSnapshot => ({
  title: 'TypeScript 开发',
  company: '虚构科技',
  city: '深圳',
  workMode: 'hybrid',
  salary: { minimum: 20000, maximum: 30000, currency: 'CNY', period: 'month' },
  source: 'fixture://job-1',
  observedAt,
});
function policy(platform: Policy['platform'] = 'boss'): Policy {
  return {
    ...defaultPolicy(platform),
    account: 'fictional',
    resumeVersion: 'resume-v1',
    allowedTargets: ['job-1'],
    startHour: 0,
    endHour: 24,
    jobFilter: {
      cities: ['深圳'],
      includedCompanies: ['虚构'],
      excludedKeywords: ['外包'],
      workModes: ['hybrid'],
      salary: { enabled: true, minimumMonthly: 20000, maximumMonthly: 30000, currency: 'CNY' },
    },
    facts: [{ id: 'skill', text: '我有三年 TypeScript 开发经验。' }],
    ownWechat: 'fictional_wx',
    ownPhone: 'fictional_phone',
  };
}
const proposal = (platform: Policy['platform'] = 'boss'): Proposal => ({
  platform,
  account: 'fictional',
  target: 'job-1',
  job: 'TypeScript 开发',
  company: '虚构科技',
  contact: '虚构联系人',
  kind: 'reply',
  content: '我有三年 TypeScript 开发经验。',
  contextHash: 'context-1',
  resumeVersion: 'resume-v1',
  eventId: 'peer-message-1',
  jobSnapshot: pageJob(),
});

test('job filters intersect independent groups and require the complete advertised monthly range', () => {
  const p = proposal();
  const rules = policy();
  assert.equal(jobFilterDecision(p, rules), undefined);
  const changes: Array<[Partial<JobSnapshot>, RegExp]> = [
    [{ city: '上海' }, /城市不在/],
    [{ city: null }, /未明确城市/],
    [{ workMode: 'remote' }, /工作方式不在/],
    [{ workMode: null }, /未明确工作方式/],
    [{ salary: null }, /不自动换算/],
    [{ salary: { ...pageJob().salary!, minimum: 19000, maximum: 25000 } }, /下限低于/],
    [{ salary: { ...pageJob().salary!, maximum: 31000 } }, /上限超过/],
    [{ salary: { ...pageJob().salary!, period: 'year' } }, /不自动换算/],
    [
      { salary: { ...pageJob().salary!, period: 'hour', minimum: 24.5, maximum: 30.5 } },
      /不自动换算/,
    ],
    [{ salary: { ...pageJob().salary!, currency: 'USD' } }, /不自动换算/],
    [{ salary: { ...pageJob().salary!, minimum: 0 } }, /区间无效/],
    [{ salary: { ...pageJob().salary!, minimum: 40000 } }, /区间无效/],
    [{ title: 'Java 开发' }, /列表与详情/],
    [{ company: '另一个公司' }, /列表与详情/],
    [{ source: '' }, /格式无效/],
    [{ source: '   ' }, /来源或观察时间/],
    [{ observedAt: 'yesterday' }, /来源或观察时间/],
  ];
  for (const [change, reason] of changes)
    assert.match(
      jobFilterDecision({ ...p, jobSnapshot: { ...pageJob(), ...change } }, rules) ?? '',
      reason,
      JSON.stringify(change),
    );
  assert.match(
    jobFilterDecision({ ...p, jobSnapshot: undefined }, rules) ?? '',
    /缺少当前岗位详情/,
  );
  assert.match(jobFilterDecision(p, { ...rules, excludedCompanies: ['虚构'] }) ?? '', /排除名单/);
  assert.match(jobFilterDecision(p, { ...rules, keywords: ['Java'] }) ?? '', /不匹配/);
  assert.match(
    jobFilterDecision(p, {
      ...rules,
      jobFilter: { ...rules.jobFilter!, includedCompanies: ['其他'] },
    }) ?? '',
    /公司不在/,
  );
  assert.match(
    jobFilterDecision(p, {
      ...rules,
      jobFilter: { ...rules.jobFilter!, excludedKeywords: ['ＴＹＰＥＳＣＲＩＰＴ'] },
    }) ?? '',
    /排除词/,
  );
  assert.match(
    jobFilterDecision(p, { ...rules, jobFilter: { ...rules.jobFilter!, cities: ['深圳市'] } }) ??
      '',
    /城市不在/,
    'do not infer city aliases',
  );
  for (const workMode of ['onsite', 'hybrid', 'remote'] as const)
    assert.equal(
      jobFilterDecision(
        { ...p, jobSnapshot: { ...pageJob(), workMode } },
        { ...rules, jobFilter: { ...rules.jobFilter!, workModes: [workMode] } },
      ),
      undefined,
    );
  rules.jobFilter!.salary.maximumMonthly = 0;
  assert.equal(
    jobFilterDecision(
      { ...p, jobSnapshot: { ...pageJob(), salary: { ...pageJob().salary!, maximum: 90000 } } },
      rules,
    ),
    undefined,
  );
});

test('invalid salary bounds and blank/duplicate filters cannot be saved; legacy policies retain their scope', () => {
  const rules = policy();
  for (const salary of [
    { ...rules.jobFilter!.salary, minimumMonthly: 40000 },
    { ...rules.jobFilter!.salary, minimumMonthly: 0, maximumMonthly: 0 },
  ])
    assert.throws(
      () =>
        policyOf({
          files: {},
          credentials: [],
          policy: { ...rules, jobFilter: { ...rules.jobFilter!, salary } },
        }),
      /月薪下限|至少填写/,
    );
  for (const cities of [[' '], ['深圳', ' 深圳 ']])
    assert.throws(
      () => validateRecruitingPolicy({ ...rules, jobFilter: { ...rules.jobFilter, cities } }),
      /空格|重复/,
    );
  const legacy = { ...rules };
  delete legacy.jobFilter;
  validateRecruitingPolicy(legacy);
  const p = { ...proposal(), jobSnapshot: undefined };
  assert.equal(jobFilterDecision(p, legacy), undefined);
  assert.equal(jobFilterDecision(p, { ...legacy, jobFilter: defaultJobFilter() }), undefined);
  assert.match(
    jobFilterDecision(p, { ...legacy, keywords: ['typescript'] }) ?? '',
    /不匹配/,
    'legacy keyword matching remains case sensitive',
  );
});

async function fixture(platform: Policy['platform'] = 'boss') {
  const root = await mkdtemp(join(tmpdir(), 'flowark-job-filter-'));
  const store = new Store(join(root, 'store.sqlite'), randomBytes(32));
  const service = new RecruitingCoordinator(store);
  const rules = policy(platform);
  const state = {
    ai: 0,
    sent: 0,
    reads: 0,
    page: pageJob() as JobSnapshot | undefined,
    secondRead: undefined as ((job: JobSnapshot) => void) | undefined,
    kind: 'reply' as Proposal['kind'],
    lastSubmitted: undefined as Proposal | undefined,
  };
  const site: RecruitingSiteAdapter = {
    platform,
    probe: async () => ({ verified: true, account: rules.account }),
    opportunities: async () => [
      {
        ...proposal(platform),
        kind: state.kind,
        sharedValue: state.kind.includes('Wechat')
          ? rules.ownWechat
          : state.kind.includes('Phone')
            ? rules.ownPhone
            : undefined,
      },
    ],
    read: async (): Promise<Conversation> => {
      state.reads++;
      if (state.reads === 2 && state.page && state.secondRead) state.secondRead(state.page);
      const current = state.page && {
        ...structuredClone(state.page),
        observedAt: new Date(Date.parse(observedAt) + state.reads * 1000).toISOString(),
      };
      return {
        account: rules.account,
        target: 'job-1',
        contextHash: 'context-1',
        eventId: 'peer-message-1',
        resumeVersion: rules.resumeVersion,
        conversation: [{ role: 'peer', text: '请介绍开发经验' }],
        replied: false,
        jobSnapshot: current,
      };
    },
    submit: async (p) => {
      state.sent++;
      state.lastSubmitted = p;
      assert.equal(store.list<PreparedAction>('action')[0].state, 'SUBMITTING');
      return { state: 'CONFIRMED', evidence: 'fixture-receipt' };
    },
    contacts: async () => [],
  };
  const draft = async (input: AIRequest): Promise<AIResult> => {
    state.ai++;
    if (state.page) assert.equal(JSON.parse(input.job).city, state.page.city);
    return {
      provider: input.provider,
      model: input.model,
      contextHash: input.contextHash,
      resumeVersion: input.resumeVersion,
      requestId: 'fixture',
      usage: null,
      draft: {
        body: rules.facts[0].text,
        factIds: ['skill'],
        claims: [{ text: rules.facts[0].text, factId: 'skill' }],
        containsContact: false,
        containsCommitment: false,
        needsHuman: [],
      },
    };
  };
  return {
    state,
    store,
    service,
    rules,
    run: () =>
      service.run({
        flowId: 'filter-test',
        policy: rules,
        currentPolicy: () => rules,
        site,
        draft,
        signal: new AbortController().signal,
        limit: 1,
      }),
    close: async () => {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('both sites reject mismatches and unknown detail before AI or any of the seven outbound actions', async () => {
  for (const platform of ['boss', 'zhaopin'] as const) {
    const f = await fixture(platform);
    try {
      for (const kind of Object.keys(f.rules.actions) as Proposal['kind'][]) {
        f.state.kind = kind;
        f.rules.actions[kind] = 'auto';
        f.state.page = { ...pageJob(), city: '上海' };
        assert.equal((await f.run()).blocked, 1);
        f.state.page = undefined; // List hints still include a valid snapshot and must not substitute.
        assert.equal((await f.run()).blocked, 1);
      }
      assert.equal(f.state.ai, 0);
      assert.equal(f.state.sent, 0);
      f.state.page = { ...pageJob(), city: { malformed: 'data' } as any };
      assert.equal((await f.run()).blocked, 1);
      assert.equal(
        f.store.list<any>('attention').at(-1).detail.jobSnapshot,
        null,
        'invalid structured evidence must not be forwarded as display data',
      );
      f.state.page = undefined;
      assert.equal(f.store.list('action').length, 0);
      const attentionCount = f.store.list('attention').length;
      await f.run();
      assert.equal(
        f.store.list('attention').length,
        attentionCount,
        'same missing fields do not generate repeated reminders',
      );
      f.rules.jobFilter = defaultJobFilter();
      f.rules.keywords = ['Java'];
      f.state.kind = 'reply';
      await f.run();
      assert.equal(f.state.ai, 0, 'legacy keyword mismatch is also rejected before drafting');
    } finally {
      await f.close();
    }
  }
});

test('both sites allow eligible applications and selected resumes without replaying after a filter change', async () => {
  for (const platform of ['boss', 'zhaopin'] as const) {
    for (const kind of ['apply', 'resume'] as const) {
      const f = await fixture(platform);
      try {
        f.state.kind = kind;
        f.rules.actions[kind] = 'auto';
        assert.equal((await f.run()).submitted, 1);
        assert.equal(f.state.lastSubmitted!.resumeVersion, 'resume-v1');
        f.state.page!.salary!.maximum = 29000;
        assert.equal((await f.run()).submitted, 0);
        assert.equal(f.state.ai, 0);
        assert.equal(f.state.sent, 1);
      } finally {
        await f.close();
      }
    }
  }
});

test('both sites retain confirmation across observation timestamps and never repeat completed actions', async () => {
  for (const platform of ['boss', 'zhaopin'] as const) {
    const f = await fixture(platform);
    try {
      assert.equal((await f.run()).waiting, 1);
      const a = f.store.list<PreparedAction>('action')[0];
      f.service.actions.confirm(a.id, f.rules, a.policyHash);
      assert.equal((await f.run()).submitted, 1);
      assert.notEqual(f.state.lastSubmitted!.jobSnapshot!.observedAt, a.jobSnapshot!.observedAt);
      await f.run();
      assert.equal(f.state.ai, 1);
      assert.equal(f.state.sent, 1);
      assert.deepEqual(f.state.lastSubmitted!.jobSnapshot!.salary, pageJob().salary);
    } finally {
      await f.close();
    }
  }
});

test('changing job evidence after confirmation or between rereads invalidates the old authorization', async () => {
  for (const platform of ['boss', 'zhaopin'] as const) {
    const f = await fixture(platform);
    try {
      await f.run();
      const old = f.store.list<PreparedAction>('action')[0];
      f.service.actions.confirm(old.id, f.rules, old.policyHash);
      f.state.page!.salary!.maximum = 29000; // Still within allowed scope, but a changed confirmed context.
      assert.equal((await f.run()).waiting, 1);
      const updated = f.store.list<PreparedAction>('action')[0];
      assert.notEqual(updated.policyHash, old.policyHash);
      assert.equal(updated.confirmedHash, undefined);
      assert.equal(f.state.ai, 2, 'changed job evidence invalidates cached drafts');
      f.service.actions.confirm(updated.id, f.rules, updated.policyHash);
      f.state.reads = 0;
      f.state.secondRead = (job) => {
        job.workMode = 'remote';
      };
      assert.equal((await f.run()).blocked, 1);
      assert.equal(f.state.sent, 0);
      const blocked = f.store.list<PreparedAction>('action')[0];
      assert.equal(blocked.state, 'BLOCKED');
      assert.equal(blocked.confirmedHash, undefined);
      assert.match(blocked.reason ?? '', /工作方式/);
    } finally {
      await f.close();
    }
  }
});

test('action submit independently checks job facts, source changes and stale confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowark-filter-actions-'));
  const store = new Store(join(root, 'store.sqlite'), randomBytes(32));
  const actions = new RecruitingActions(store);
  const rules = policy();
  const p = proposal();
  let sent = 0;
  try {
    const action = actions.prepare(p, rules);
    actions.confirm(action.id, rules, action.policyHash);
    assert.equal(
      authorizationHash(p, rules),
      authorizationHash(
        { ...p, jobSnapshot: { ...pageJob(), observedAt: '2026-09-16T03:00:00Z' } },
        rules,
      ),
    );
    for (const change of [{ city: '上海' }, { source: 'fixture://different-source' }]) {
      const current = actions.prepare(p, rules);
      if (current.state === 'PENDING_CONFIRMATION')
        actions.confirm(current.id, rules, current.policyHash);
      assert.equal(store.get<PreparedAction>('action', action.id)!.state, 'READY');
      await assert.rejects(
        actions.submit(
          action.id,
          { ...p, jobSnapshot: { ...pageJob(), ...change } },
          rules,
          async () => {
            sent++;
            return { state: 'CONFIRMED', evidence: 'fixture' };
          },
        ),
      );
    }
    assert.equal(sent, 0);
    const renewed = actions.prepare(p, rules);
    assert.equal(renewed.state, 'PENDING_CONFIRMATION');
    assert.equal(renewed.confirmedHash, undefined);
    rules.actions.reply = 'auto';
    rules.startHour = 9;
    rules.endHour = 21;
    const beforeHours = actions.prepare(p, rules, new Date('2026-09-16T00:00:00Z'));
    assert.equal(beforeHours.state, 'BLOCKED');
    assert.equal(
      actions.prepare(p, rules, new Date('2026-09-16T04:00:00Z')).state,
      'READY',
      'unsent temporary blocks are reevaluated without retrying an attempted action',
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
