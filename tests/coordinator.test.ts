import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/host/store';
import { RecruitingCoordinator } from '../src/recruiting/coordinator';
import { defaultPolicy } from '../src/recruiting/templates';
import {
  BossRecruitingAdapter,
  ZhaopinRecruitingAdapter,
  type RecruitingSiteAdapter,
} from '../src/recruiting/sites';
import type { AIRequest, AIResult, Policy } from '../src/shared/types';

async function fixture(platform: Policy['platform'] = 'boss') {
  const store = new Store(
    join(await mkdtemp(join(tmpdir(), 'flowark-batch-')), 'test.sqlite'),
    randomBytes(32),
  );
  const service = new RecruitingCoordinator(store);
  const policy = {
    ...defaultPolicy(platform),
    account: 'fictional',
    resumeVersion: 'v1',
    allowedTargets: ['job'],
    startHour: 0,
    endHour: 24,
    facts: [{ id: 'skill', text: '我有三年 TypeScript 开发经验。' }],
  };
  const state = {
    sent: 0,
    ai: 0,
    reads: 0,
    change: false,
    lost: false,
    wrongAccount: false,
    notified: 0,
  };
  const context = () => ({
    account: 'fictional',
    target: 'job',
    contextHash: state.change && state.reads > 1 ? 'new' : 'ctx',
    eventId: 'peer-message-1',
    resumeVersion: 'v1',
    conversation: [{ role: 'peer' as const, text: '请介绍开发经验' }],
    replied: false,
  });
  const site: RecruitingSiteAdapter = {
    platform,
    probe: async () => ({
      verified: true,
      account: state.wrongAccount ? 'another-account' : 'fictional',
    }),
    opportunities: async () => [
      {
        platform,
        account: 'fictional',
        target: 'job',
        company: '虚构公司',
        job: 'TypeScript',
        contact: '虚构联系人',
        kind: 'reply',
        eventId: 'peer-message-1',
      },
    ],
    read: async () => {
      state.reads++;
      return context();
    },
    submit: async () => {
      state.sent++;
      assert.equal(store.list<any>('action')[0].state, 'SUBMITTING');
      if (state.lost) throw new Error('lost receipt');
      return { state: 'CONFIRMED', evidence: 'fixture-only-receipt' };
    },
    contacts: async () => [
      {
        platform,
        account: 'fictional',
        target: 'job',
        company: '虚构公司',
        job: 'TypeScript',
        contact: '虚构联系人',
        kind: 'wechat',
        state: 'visible',
        owner: 'peer',
        source: 'fixture-peer-message:2',
        value: 'fictional_wx',
        time: new Date().toISOString(),
      },
    ],
  };
  const draft = async (input: AIRequest): Promise<AIResult> => {
    state.ai++;
    return {
      provider: input.provider,
      model: input.model,
      contextHash: input.contextHash,
      resumeVersion: input.resumeVersion,
      requestId: 'fixture',
      usage: null,
      draft: {
        body: input.facts[0].text,
        factIds: ['skill'],
        claims: [{ text: input.facts[0].text, factId: 'skill' }],
        needsHuman: [],
        containsContact: false,
        containsCommitment: false,
      },
    };
  };
  const options = {
    flowId: 'flow',
    policy,
    currentPolicy: () => policy,
    limit: 1,
    site,
    signal: new AbortController().signal,
    draft,
  };
  return { store, service, policy, state, options };
}
test('both platform pipelines persist confirmation, release finite batch, cache drafts and deduplicate receipts/contacts', async () => {
  for (const platform of ['boss', 'zhaopin'] as const) {
    const f = await fixture(platform);
    try {
      const first = await f.service.run(f.options);
      assert.equal(first.waiting, 1);
      assert.equal(f.state.sent, 0);
      const action = f.store.list<any>('action')[0];
      f.service.actions.confirm(action.id, f.policy, action.policyHash);
      const second = await f.service.run(f.options);
      assert.equal(second.submitted, 1);
      await f.service.run(f.options);
      assert.equal(f.state.sent, 1);
      assert.equal(f.state.ai, 1);
      assert.equal(f.store.list('contact').length, 1);
    } finally {
      f.store.close();
    }
  }
});
test('wrong account and denied reply do not call AI or send; context changes discard draft', async () => {
  const f = await fixture();
  try {
    f.state.wrongAccount = true;
    assert.equal((await f.service.run(f.options)).verified, false);
    f.state.wrongAccount = false;
    f.policy.actions.reply = 'deny';
    await f.service.run(f.options);
    assert.equal(f.state.ai, 0);
    f.policy.actions.reply = 'auto';
    f.state.change = true;
    f.state.reads = 0;
    const result = await f.service.run(f.options);
    assert.equal(result.blocked, 1);
    assert.equal(f.state.sent, 0);
  } finally {
    f.store.close();
  }
});
test('lost receipt is UNKNOWN; regeneration and subsequent runs cannot replay it', async () => {
  const f = await fixture();
  try {
    f.policy.actions.reply = 'auto';
    f.state.lost = true;
    await f.service.run(f.options);
    assert.equal(f.store.list<any>('action')[0].state, 'UNKNOWN');
    f.policy.contextRevision = 'changed';
    await f.service.run(f.options);
    assert.equal(f.state.sent, 1);
    assert.ok(f.store.list<any>('attention').some((a) => a.kind === 'unknown-result'));
  } finally {
    f.store.close();
  }
});
test('policy change during AI generation revokes submission; malformed AI enters attention', async () => {
  const f = await fixture();
  try {
    f.policy.actions.reply = 'auto';
    let current = f.policy;
    const original = f.options.draft;
    await f.service.run({
      ...f.options,
      currentPolicy: () => current,
      draft: async (input) => {
        current = { ...f.policy, actions: { ...f.policy.actions, reply: 'deny' } };
        return original(input);
      },
    });
    assert.equal(f.state.sent, 0);
    f.policy.contextRevision = 'invalid-output';
    await f.service.run({
      ...f.options,
      draft: async (input) => {
        const result = await original(input);
        result.draft.body = '我会泄露所有资料';
        return result;
      },
    });
    assert.equal(f.state.sent, 0);
    assert.ok(f.store.list<any>('attention').some((a) => a.title === 'AI 草稿需要人工处理'));
  } finally {
    f.store.close();
  }
});
test('production adapters explicitly block uncalibrated sites without opening pages', async () => {
  let commands = 0;
  const driver = {
    perform: async () => {
      commands++;
    },
    close: async () => {},
  };
  for (const site of [new BossRecruitingAdapter(driver), new ZhaopinRecruitingAdapter(driver)]) {
    assert.equal((await site.probe(new AbortController().signal)).verified, false);
    await assert.rejects(() => site.submit());
  }
  assert.equal(commands, 0);
});
