import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { embeddedHarness } from './fixtures/embedded-harness';
import { startFormLab } from './fixtures/platform-page';

const data = await mkdtemp('/private/tmp/flowark-native-close-');
const lab = await startFormLab();
const h = await embeddedHarness(data);
const evidence: any = { passed: false, data, checks: [] };
const wait = async (predicate: () => Promise<boolean>, label: string) => {
  const deadline = Date.now() + 12000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('等待超时：' + label);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const observe = (promise: Promise<any>) =>
  promise.then(
    (result) => ({ ok: true as const, result }),
    (error) => ({ ok: false as const, error: String(error) }),
  );
const native = (name: string) =>
  h.app.evaluate((_electron, name) => {
    const state = (globalThis as any).nativeCloseTest;
    const record = state.records[name];
    return {
      destroyed: record.wc.isDestroyed(),
      events: record.events,
      closeCalls: record.closeCalls,
      resourceId: record.resourceId,
    };
  }, name);
const remember = (name: string) =>
  h.app.evaluate((_electron, name) => {
    const g = globalThis as any,
      resource = g.embeddedFixture.resource;
    const record = {
      wc: resource.view.webContents,
      view: resource.view,
      resourceId: resource.id,
      events: 0,
      closeCalls: 0,
    };
    record.wc.once('destroyed', () => record.events++);
    g.nativeCloseTest.records[name] = record;
  }, name);
const delayClose = async (name: string) => {
  await remember(name);
  await h.app.evaluate((_electron, name) => {
    const state = (globalThis as any).nativeCloseTest;
    const record = state.records[name],
      wc = record.wc;
    const original = wc.close.bind(wc);
    // Return from close without calling native close yet. No destroyed event is forged.
    wc.close = (options: any) => {
      record.closeCalls++;
      record.release = () => {
        wc.close = original;
        original(options);
      };
    };
  }, name);
};
const releaseClose = (name: string) =>
  h.app.evaluate((_electron, name) => {
    (globalThis as any).nativeCloseTest.records[name].release();
  }, name);
const startGate = (kind: 'load' | 'initialize') =>
  h.app.evaluate(({ BrowserWindow }, kind) => {
    const g = globalThis as any,
      state = g.nativeCloseTest;
    state.gate = undefined;
    const parent = BrowserWindow.getAllWindows()[0].contentView;
    const add = parent.addChildView;
    parent.addChildView = function (view: any, ...args: any[]) {
      parent.addChildView = add;
      Reflect.apply(add, parent, [view, ...args]);
      const wc = view.webContents;
      const gate: any = { wc, view, entered: false, events: 0 };
      wc.once('destroyed', () => gate.events++);
      state.gate = gate;
      if (kind === 'load') {
        const original = wc.loadURL;
        wc.loadURL = async function (...args: any[]) {
          wc.loadURL = original;
          const result = await Reflect.apply(original, wc, args);
          gate.entered = true;
          await new Promise<void>((release) => (gate.release = release));
          return result;
        };
      } else {
        const original = wc.debugger.sendCommand;
        wc.debugger.sendCommand = async function (method: string, ...args: any[]) {
          const result = await Reflect.apply(original, wc.debugger, [method, ...args]);
          if (method === 'Page.enable' && !gate.entered) {
            wc.debugger.sendCommand = original;
            gate.entered = true;
            await new Promise<void>((release) => (gate.release = release));
          }
          return result;
        };
      }
    };
  }, kind);

try {
  await h.app.evaluate(() => {
    const g = globalThis as any;
    g.nativeCloseTest = { records: {}, errors: [] };
    process.on('unhandledRejection', (error) => g.nativeCloseTest.errors.push(String(error)));
    process.on('uncaughtException', (error) => g.nativeCloseTest.errors.push(String(error)));
  });
  await h.system('browser.embedded.viewport', { x: 0, y: 0, width: 1100, height: 800 });
  const first = await h.start();
  assert.equal(first.state, 'ready');
  assert.equal(typeof first.resourceId, 'string');
  await h.perform({ operation: 'navigate', value: lab.url });
  await h.perform({ operation: 'fill', selector: '#full-name', value: 'fictional retained page' });
  assert.deepEqual(await h.system('browser.embedded.start', { token: first.token }), first);
  assert.equal(
    await h.perform({ operation: 'inputValue', selector: '#full-name', value: null }),
    'fictional retained page',
  );
  evidence.checks.push('healthy-same-token-reuses-native-page-and-input');

  await delayClose('delayed');
  const pending = observe(h.system('browser.embedded.close', first));
  await wait(async () => (await native('delayed')).closeCalls === 1, 'native close request');
  const before = await native('delayed');
  assert.equal(before.destroyed, false);
  assert.equal(before.events, 0);
  await assert.rejects(h.system('browser.embedded.start', { token: randomUUID() }), /关闭|回收/);
  await assert.rejects(h.system('browser.embedded.navigate', { url: lab.url }), /关闭|回收/);
  await assert.rejects(h.system('browser.embedded.visibility', { visible: true }), /关闭|回收/);
  await releaseClose('delayed');
  const closed = await pending;
  if (!closed.ok) throw new Error(closed.error);
  assert.equal(closed.result.state, 'closed');
  assert.equal(closed.result.token, first.token);
  assert.equal(closed.result.resourceId, first.resourceId);
  assert.deepEqual(await native('delayed'), {
    destroyed: true,
    events: 1,
    closeCalls: 1,
    resourceId: first.resourceId,
  });
  evidence.checks.push({ name: 'close-return-is-not-destruction', before, receipt: closed.result });

  const second = await h.start();
  assert.notEqual(second.resourceId, first.resourceId);
  await h.perform({ operation: 'navigate', value: lab.url });
  await h.perform({ operation: 'fill', selector: '#full-name', value: 'new generation' });
  await remember('second');
  assert.deepEqual(await h.system('browser.embedded.close', first), closed.result);
  await assert.rejects(h.system('browser.embedded.start', { token: first.token }), /租约已结束/);
  await assert.rejects(
    h.system('browser.embedded.perform', {
      token: first.token,
      command: { operation: 'url', value: null },
    }),
    /失效|不可用/,
  );
  const unknown = await h.system('browser.embedded.close', {
    token: randomUUID(),
    resourceId: randomUUID(),
  });
  assert.equal(unknown.state, 'unknown');
  assert.equal((await native('second')).destroyed, false);
  assert.equal((await h.status()).blocked, undefined);
  assert.equal(
    await h.perform({ operation: 'inputValue', selector: '#full-name', value: null }),
    'new generation',
  );
  evidence.checks.push('closed-receipt-and-retired-token-cannot-affect-new-generation');

  await h.app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as any,
      record = g.nativeCloseTest.records.second;
    const parent = BrowserWindow.getAllWindows()[0].contentView,
      original = parent.removeChildView;
    parent.removeChildView = function (view: any) {
      if (view === record.view) {
        parent.removeChildView = original;
        throw new Error('injected detach failure');
      }
      return Reflect.apply(original, parent, [view]);
    };
  });
  const detached = await h.system('browser.embedded.close', second);
  assert.equal(detached.state, 'closed');
  assert.match(detached.warnings.join(), /injected detach failure/);
  assert.equal((await native('second')).destroyed, true);
  assert.equal((await native('second')).events, 1);
  assert.equal((await h.status()).blocked, undefined);
  evidence.checks.push({ name: 'detach-failure-still-closes-real-webcontents', receipt: detached });

  const flush = await h.start();
  await remember('flush');
  await h.app.evaluate(() => {
    const g = globalThis as any,
      cookies = g.embeddedFixture.resource.view.webContents.session.cookies;
    const original = cookies.flushStore;
    g.nativeCloseTest.restoreFlush = () => (cookies.flushStore = original);
    cookies.flushStore = async () => {
      throw new Error('injected cookie flush failure');
    };
  });
  const flushed = await h.system('browser.embedded.close', flush);
  await h.app.evaluate(() => (globalThis as any).nativeCloseTest.restoreFlush());
  assert.equal(flushed.state, 'closed');
  assert.match(flushed.warnings.join(), /injected cookie flush failure/);
  assert.equal((await native('flush')).destroyed, true);
  assert.equal((await h.status()).blocked, undefined);
  const afterFlush = await h.start();
  await h.perform({ operation: 'navigate', value: lab.url });
  assert.equal((await h.status()).url, new URL(lab.url).href);
  await h.system('browser.embedded.close', afterFlush);
  evidence.checks.push({
    name: 'flush-warning-does-not-deny-native-destruction-or-reuse',
    receipt: flushed,
  });

  // A closing preview has no token. A racing start must not claim it or rewrite its receipt.
  await h.visibility(true);
  await delayClose('preview');
  const previewClose = observe(h.system('browser.embedded.close'));
  await wait(async () => (await native('preview')).closeCalls === 1, 'preview close request');
  await assert.rejects(h.system('browser.embedded.start', { token: randomUUID() }), /关闭|回收/);
  assert.equal(
    await h.app.evaluate(() => (globalThis as any).embeddedFixture.resource.token),
    undefined,
  );
  await releaseClose('preview');
  const previewReceipt = await previewClose;
  if (!previewReceipt.ok) throw new Error(previewReceipt.error);
  assert.equal(previewReceipt.result.state, 'closed');
  assert.equal(previewReceipt.result.token, undefined);
  assert.equal((await native('preview')).destroyed, true);
  evidence.checks.push('closing-preview-cannot-be-claimed-by-new-token');

  for (const kind of ['load', 'initialize'] as const) {
    await startGate(kind);
    const token = randomUUID();
    let startOutcome: Awaited<ReturnType<typeof observe>> | undefined;
    evidence.startGates ??= {};
    evidence.startGates[kind] = { pending: true };
    const starting = observe(h.system('browser.embedded.start', { token })).then((outcome) => {
      startOutcome = outcome;
      evidence.startGates[kind] = outcome;
      return outcome;
    });
    await wait(async () => {
      if (startOutcome)
        throw new Error(`${kind} 启动在进入 gate 前已结束：${JSON.stringify(startOutcome)}`);
      return h.app.evaluate(() => !!(globalThis as any).nativeCloseTest.gate?.entered);
    }, kind + ' gate');
    const startingIdentity = await h.app.evaluate(() => {
      const resource = (globalThis as any).embeddedFixture.resource;
      return { token: resource.token, resourceId: resource.id };
    });
    assert.equal(startingIdentity.token, token);
    const receipt = await h.system('browser.embedded.close', { token });
    assert.equal(receipt.state, 'closed');
    assert.equal(receipt.resourceId, startingIdentity.resourceId);
    assert.equal(
      await h.app.evaluate(() => (globalThis as any).nativeCloseTest.gate.wc.isDestroyed()),
      true,
    );
    const replacement = await h.start();
    await h.perform({ operation: 'navigate', value: lab.url });
    await h.perform({ operation: 'fill', selector: '#full-name', value: kind + ' replacement' });
    await h.app.evaluate(() => (globalThis as any).nativeCloseTest.gate.release());
    const oldResult = await starting;
    assert.equal(oldResult.ok, false, 'late initialization must reject');
    assert.equal(
      (await h.system('browser.embedded.start', { token: replacement.token })).resourceId,
      replacement.resourceId,
    );
    assert.equal(
      await h.perform({ operation: 'inputValue', selector: '#full-name', value: null }),
      kind + ' replacement',
    );
    assert.equal(
      (await h.system('browser.embedded.close', startingIdentity)).resourceId,
      startingIdentity.resourceId,
    );
    assert.equal(
      await h.app.evaluate(() =>
        (globalThis as any).embeddedFixture.resource.view.webContents.isDestroyed(),
      ),
      false,
    );
    await h.system('browser.embedded.close', replacement);
    evidence.checks.push({
      name: kind + '-cancel-does-not-resurrect-or-clear-replacement',
      receipt,
    });
  }

  // Last: an unleased preview cannot notify an owner, so the separate cleanup-failure path is required.
  await h.visibility(true);
  await remember('failed-preview');
  await h.app.evaluate(() => {
    const g = globalThis as any,
      record = g.nativeCloseTest.records['failed-preview'];
    const original = record.wc.close.bind(record.wc);
    record.release = () => {
      record.wc.close = original;
      original({ waitForBeforeUnload: false });
    };
    record.wc.close = () => {
      record.closeCalls++;
      throw new Error('injected native close failure');
    };
  });
  const failed = await h.system('browser.embedded.close');
  assert.equal(failed.state, 'unknown');
  assert.equal(failed.token, undefined);
  assert.equal((await native('failed-preview')).destroyed, false);
  const failureNotices = await h.app.evaluate(() => (globalThis as any).embeddedCleanupFailures);
  assert.equal(failureNotices.length, 1);
  assert.equal(failureNotices[0].resourceId, failed.resourceId);
  assert.equal(failureNotices[0].token, undefined);
  assert.match((await h.status()).blocked, /退出.*重新打开/);
  await assert.rejects(h.system('browser.embedded.start', { token: randomUUID() }), /回收未确认/);
  await assert.rejects(h.system('browser.embedded.navigate', { url: lab.url }), /回收未确认/);
  await assert.rejects(h.visibility(true), /回收未确认/);
  await h.visibility(false);
  await releaseClose('failed-preview');
  await wait(async () => (await native('failed-preview')).destroyed, 'late native destruction');
  assert.match((await h.status()).blocked, /回收未确认/);
  assert.deepEqual(await h.system('browser.embedded.close'), failed);
  assert.equal((await h.app.evaluate(() => (globalThis as any).embeddedCleanupFailures)).length, 1);
  await assert.rejects(h.system('browser.embedded.start', { token: randomUUID() }), /回收未确认/);
  evidence.checks.push({
    name: 'unleased-preview-unknown-notifies-once-and-stays-blocked-after-late-destroy',
    receipt: failed,
  });
  assert.deepEqual(await h.app.evaluate(() => (globalThis as any).nativeCloseTest.errors), []);
  assert.equal(lab.state.attempts, 0);
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error);
  evidence.diagnostics = await h.app
    .evaluate(() => {
      const g = globalThis as any;
      return {
        status: g.embeddedFixture.status(),
        errors: g.nativeCloseTest.errors,
        cleanupFailures: g.embeddedCleanupFailures,
        lost: g.lostNotice,
        phase: g.embeddedFixture.resource?.phase,
        gate: g.nativeCloseTest.gate
          ? {
              entered: g.nativeCloseTest.gate.entered,
              destroyed: g.nativeCloseTest.gate.wc.isDestroyed(),
              events: g.nativeCloseTest.gate.events,
            }
          : undefined,
      };
    })
    .catch((failure) => ({ error: String(failure) }));
  throw error;
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/embedded-close-lifecycle.json', JSON.stringify(evidence, null, 2));
  await h.shutdown();
  await lab.close();
  console.log(JSON.stringify(evidence));
}
