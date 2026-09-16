import test from 'node:test';
import assert from 'node:assert/strict';
import { Rpc } from '../src/shared/rpc';

test('RPC closure rejects pending/new calls and ignores late handler replies', async () => {
  const sent: any[] = [];
  let release!: () => void;
  const wait = new Promise<void>(r => { release = r; });
  const rpc = new Rpc(m => sent.push(m), async () => { await wait; return 'late'; });
  const incoming = rpc.receive({ rpc: 'incoming', method: 'work' });
  const outgoing = assert.rejects(rpc.call('pending'), /断开/);
  rpc.close(); release();
  await incoming; await outgoing;
  await assert.rejects(rpc.call('new'), /断开/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'pending');
});
test('a failed reply transport does not trigger a second reply or an unhandled rejection', async () => {
  let attempts = 0;
  const rpc = new Rpc(() => { attempts++; throw new Error('closed pipe'); }, async () => 'result');
  await rpc.receive({ rpc: 'incoming', method: 'work' });
  await rpc.receive({ rpc: 'late', method: 'work' });
  assert.equal(attempts, 1);
  await assert.rejects(rpc.call('after-loss'), /断开/);
});
