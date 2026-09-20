import test from 'node:test';
import assert from 'node:assert/strict';
import { Rpc } from '../src/shared/rpc';
import { redactedErrorText } from '../src/shared/utils';

test('RPC closure rejects pending/new calls and ignores late handler replies', async () => {
  const sent: any[] = [];
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const rpc = new Rpc(
    (m) => sent.push(m),
    async () => {
      await wait;
      return 'late';
    },
  );
  const incoming = rpc.receive({ rpc: 'incoming', method: 'work' });
  const outgoing = assert.rejects(rpc.call('pending'), /断开/);
  rpc.close();
  release();
  await incoming;
  await outgoing;
  await assert.rejects(rpc.call('new'), /断开/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'pending');
});
test('a failed reply transport does not trigger a second reply or an unhandled rejection', async () => {
  let attempts = 0;
  const rpc = new Rpc(
    () => {
      attempts++;
      throw new Error('closed pipe');
    },
    async () => 'result',
  );
  await rpc.receive({ rpc: 'incoming', method: 'work' });
  await rpc.receive({ rpc: 'late', method: 'work' });
  assert.equal(attempts, 1);
  await assert.rejects(rpc.call('after-loss'), /断开/);
});

test('RPC redacts rejected replies without changing successful credential values', async () => {
  const secret = 'FICT_9c7VyQz6mXr2';
  const sent: any[] = [];
  const rpc = new Rpc(
    (message) => sent.push(message),
    async (method) => {
      if (method === 'credentials.get') return secret;
      throw new Error('拒绝：' + secret + ' sk-fixture 13800138000');
    },
    (error) => redactedErrorText(error, [secret]),
  );
  await rpc.receive({ rpc: 'success', method: 'credentials.get' });
  await rpc.receive({ rpc: 'failure', method: 'validate' });
  assert.equal(sent[0].result, secret);
  assert.equal(sent[0].error, undefined);
  assert.equal(sent[1].result, undefined);
  assert.equal(sent[1].error, '拒绝：[REDACTED] [REDACTED] [PHONE]');
  rpc.close();
});

test('default RPC failures stay rejected for empty and non-Error exceptions', async () => {
  const sent: any[] = [];
  const rpc = new Rpc(
    (message) => sent.push(message),
    async (method) => {
      if (method === 'empty') throw new Error('');
      if (method === 'unknown') throw 'sk-fictional-string';
      throw new Error('不支持 sk-fictional-capability');
    },
  );
  for (const method of ['empty', 'unknown', 'pattern']) await rpc.receive({ rpc: method, method });
  assert.deepEqual(
    sent.map((reply) => reply.error),
    ['请求失败', '请求失败', '不支持 [REDACTED]'],
  );
  assert.ok(sent.every((reply) => !Object.hasOwn(reply, 'result')));
  rpc.close();
});

test('RPC timeout diagnostics use the same error context and still release pending calls', async () => {
  const secret = 'FICT_timeout_7Yz';
  const rpc = new Rpc(
    () => {},
    async () => true,
    (error) => redactedErrorText(error, [secret]),
  );
  await assert.rejects(rpc.call('request-' + secret, {}, 5), (error: Error) => {
    assert.equal(error.message, '进程请求超时：request-[REDACTED]');
    return true;
  });
  rpc.close();
});
