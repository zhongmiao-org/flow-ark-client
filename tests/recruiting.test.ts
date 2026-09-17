import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/host/store';
import { defaultPolicy } from '../src/recruiting/templates';
import { RecruitingActions, policyDecision, type Proposal } from '../src/recruiting/actions';
const time = new Date('2026-09-16T04:00:00Z');
const p: Proposal = {
  platform: 'boss',
  account: 'fictional-account',
  target: 'job-1',
  company: '虚构公司',
  job: 'TypeScript 开发',
  contact: '虚构联系人',
  kind: 'reply',
  content: '您好',
  contextHash: 'ctx-1',
  resumeVersion: 'v1',
  eventId: 'message-1',
};
const policy = () => ({
  ...defaultPolicy('boss'),
  account: p.account,
  resumeVersion: 'v1',
  allowedTargets: ['job-1'],
  startHour: 0,
  endHour: 24,
});
async function setup() {
  const s = new Store(
    join(await mkdtemp(join(tmpdir(), 'flowark-actions-')), 'test.sqlite'),
    randomBytes(32),
  );
  return { s, service: new RecruitingActions(s) };
}
test('seven action modes enforce deny and contact ownership independently', () => {
  const rules = policy();
  for (const kind of Object.keys(rules.actions)) {
    const current = { ...p, kind: kind as any, sharedValue: 'owned-value' };
    rules.actions[kind as keyof typeof rules.actions] = 'deny';
    assert.equal(policyDecision(current, rules, 0, time), '此类动作已禁止');
    rules.actions[kind as keyof typeof rules.actions] = 'auto';
  }
  assert.ok(
    policyDecision({ ...p, kind: 'acceptWechat', sharedValue: 'unapproved' }, rules, 0, time),
  );
  assert.ok(policyDecision({ ...p, target: 'other' }, rules, 0, time));
  assert.ok(policyDecision({ ...p, account: 'other' }, rules, 0, time));
});
test('explicit confirmation is bound to concrete context and latest policy', async () => {
  const { s, service } = await setup();
  const rules = policy();
  const a = service.prepare(p, rules, time);
  assert.equal(a.state, 'PENDING_CONFIRMATION');
  service.confirm(a.id, rules);
  let sent = 0;
  await assert.rejects(() =>
    service.submit(
      a.id,
      { ...p, contextHash: 'new-message' },
      rules,
      async () => {
        sent++;
        return { state: 'CONFIRMED', evidence: 'fictional-receipt' };
      },
      time,
    ),
  );
  assert.equal(sent, 0);
  s.close();
});
test('durable submission and unknown result cannot be replayed across runs', async () => {
  const { s, service } = await setup();
  const rules = policy();
  rules.actions.reply = 'auto';
  const a = service.prepare(p, rules, time);
  let count = 0;
  await assert.rejects(() =>
    service.submit(
      a.id,
      p,
      rules,
      async () => {
        assert.equal(s.get('action', a.id).state, 'SUBMITTING');
        count++;
        throw new Error('receipt lost');
      },
      time,
    ),
  );
  assert.equal(service.prepare(p, rules, time).state, 'UNKNOWN');
  await assert.rejects(() =>
    service.submit(
      a.id,
      p,
      rules,
      async () => {
        count++;
        return { state: 'CONFIRMED', evidence: 'x' };
      },
      time,
    ),
  );
  assert.equal(count, 1);
  assert.equal(s.list('attention').length, 1);
  s.close();
});
test('actual contact reminders persist and deduplicate even if notification fails', async () => {
  const { s } = await setup();
  let notifications = 0;
  const service = new RecruitingActions(s, async () => {
    notifications++;
    throw new Error('notifications disabled');
  });
  const c = {
    platform: 'boss' as const,
    account: p.account,
    target: p.target,
    company: p.company,
    job: p.job,
    contact: p.contact,
    kind: 'wechat' as const,
    state: 'visible' as const,
    value: 'fictional_wx',
    source: 'visible-peer-message:2',
    owner: 'peer' as const,
    time: time.toISOString(),
  };
  service.recordContact(c);
  service.recordContact(c);
  service.recordContact({ ...c, target: 'another-job' });
  assert.equal(s.list('contact').length, 1);
  assert.equal(s.list('attention').length, 1);
  assert.equal(notifications, 1);
  service.recordContact({ ...c, value: '***' });
  assert.equal(s.list('contact').length, 1);
  s.close();
});
