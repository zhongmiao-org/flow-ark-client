import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { embeddedHarness } from './fixtures/embedded-harness';

const data = await mkdtemp('/private/tmp/flowark-pointer-');
const hits: string[] = [];
const server = createServer((request, response) => {
  const url = new URL(request.url!, 'http://fixture');
  if (url.pathname === '/hit') {
    hits.push(url.searchParams.get('target')!);
    response.end('recorded');
    return;
  }
  response.setHeader('Content-Type', 'text/html;charset=utf-8');
  const port = (server.address() as { port: number }).port;
  if (url.pathname === '/inner') {
    response.end(`<!doctype html><style>body{font:16px sans-serif;margin:0;height:800px}
      button,input{font:16px sans-serif;display:block;margin:20px;width:180px;height:36px}</style>
      <button id="action">虚构操作</button><input id="field" aria-label="虚构字段">
      <script>window.events=[];for(const t of ['mousedown','mouseup','click'])document.addEventListener(t,e=>events.push({type:t,target:e.target.id,trusted:e.isTrusted}),true);
      document.querySelector('#action').onclick=()=>fetch('/hit?target=action');</script>`);
    return;
  }
  if (url.pathname === '/outer') {
    response.end(`<!doctype html><style>body{margin:0;height:1800px}iframe{position:absolute;left:140px;top:950px;width:350px;height:240px}</style>
      <iframe id="inner" src="http://127.0.0.1:${port}/inner"></iframe>`);
    return;
  }
  response.end(`<!doctype html><title>FlowArk 虚构框架测试</title>
    <style>html{scroll-behavior:smooth}body{margin:0;width:1920px;height:3000px;font:16px sans-serif}
    iframe{position:absolute;left:1200px;top:1900px;width:600px;height:460px;border:3px solid #315ef5}</style>
    <h1>框架滚动与点击测试</h1><iframe id="outer" src="http://localhost:${port}/outer"></iframe>`);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
const harness = await embeddedHarness(data);
const evidence: any = { passed: false, closed: false, data, checks: [] };
const framePath = ['#outer', '#inner'];
const wait = async (condition: () => Promise<boolean>) => {
  const deadline = Date.now() + 5000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('框架点击结果未在期限内出现');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const reset = async () => {
  await harness.close();
  await harness.start();
  await harness.perform({ operation: 'navigate', value: url });
  await wait(() =>
    harness.app.evaluate(() => {
      const resource = (globalThis as any).embeddedFixture.resource;
      return (
        resource.contents.mainFrame.framesInSubtree.length === 3 && resource.page.frames.size > 0
      );
    }),
  );
};
const inner = (expression: string) =>
  harness.app.evaluate(async (_electron, expression) => {
    const contents = (globalThis as any).embeddedFixture.resource.contents;
    const frame = contents.mainFrame.framesInSubtree.find((frame: any) =>
      frame.url.endsWith('/inner'),
    );
    return frame.executeJavaScript(expression);
  }, expression);

try {
  await harness.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setTitle('FlowArk 框架输入隔离测试（自动退出）');
  });
  for (const mode of ['visible-scaled', 'hidden', 'minimized', 'native-100-percent']) {
    await reset();
    await harness.app.evaluate(({ BrowserWindow }, mode) => {
      const fixture = (globalThis as any).embeddedFixture;
      const window = BrowserWindow.getAllWindows()[0];
      window.restore();
      window.show();
      if (mode === 'minimized') window.minimize();
      if (mode === 'hidden') window.hide();
      if (mode === 'native-100-percent') {
        fixture.resource.view.setBounds({ x: 0, y: 0, width: 1920, height: 1080 });
        fixture.resource.contents.setZoomFactor(1);
      }
    }, mode);
    if (mode !== 'native-100-percent') await harness.visibility(mode === 'visible-scaled');
    const count = hits.length;
    await harness.perform({ operation: 'click', selector: '#action', framePath, timeoutMs: 5000 });
    await wait(async () => hits.length === count + 1);
    assert.equal(hits.at(-1), 'action');
    const events = await inner('window.events');
    assert.deepEqual(events, [
      { type: 'mousedown', target: 'action', trusted: true },
      { type: 'mouseup', target: 'action', trusted: true },
      { type: 'click', target: 'action', trusted: true },
    ]);
    await harness.perform({ operation: 'click', selector: '#field', framePath, timeoutMs: 5000 });
    assert.equal(await inner('document.activeElement.id'), 'field');
    await harness.perform({ operation: 'fill', selector: '#field', framePath, value: mode });
    assert.equal(await inner('document.querySelector("#field").value'), mode);
    evidence.checks.push({ name: mode, clicks: hits.length - count, events });
  }

  await reset();
  await inner(`document.querySelector('#action').addEventListener('mousemove',function(){
    this.style.transform='translateX(40px)';
  },{once:true})`);
  const beforeMove = hits.length;
  await harness.perform({ operation: 'click', selector: '#action', framePath, timeoutMs: 5000 });
  await wait(async () => hits.length === beforeMove + 1);
  assert.deepEqual(
    (await inner('window.events')).map((event: any) => event.target),
    ['action', 'action', 'action'],
  );
  evidence.checks.push({ name: 'hover-layout-change-remeasured-with-one-click' });

  await reset();
  await inner(`document.querySelector('#action').onclick=()=>{location.href='/inner?finished=1'}`);
  await harness.perform({ operation: 'click', selector: '#action', framePath, timeoutMs: 5000 });
  await wait(() =>
    harness.app.evaluate(() =>
      (globalThis as any).embeddedFixture.resource.contents.mainFrame.framesInSubtree.some(
        (frame: any) => frame.url.endsWith('/inner?finished=1'),
      ),
    ),
  );
  assert.equal(hits.length, beforeMove + 1);
  evidence.checks.push({ name: 'click-navigation-does-not-replay-or-require-old-context' });

  await reset();
  await inner(
    `window.addEventListener('mousedown',()=>document.querySelector('#action')?.remove(),{capture:true,once:true})`,
  );
  await assert.rejects(
    harness.perform({ operation: 'click', selector: '#action', framePath, timeoutMs: 3000 }),
    /目标发生变化/,
  );
  assert.equal(hits.length, beforeMove + 1);
  evidence.checks.push({ name: 'target-removed-on-press-is-not-retried' });

  // A parent overlay must not receive a click meant for a child frame.
  await reset();
  await harness.app.evaluate(async () => {
    await (globalThis as any).embeddedFixture.resource.contents.executeJavaScript(`
      const overlay=document.createElement('button');overlay.id='overlay';overlay.textContent='遮挡';
      overlay.style.cssText='position:fixed;inset:0;z-index:1000';
      overlay.onclick=()=>fetch('/hit?target=overlay');document.body.append(overlay);
    `);
  });
  const beforeBlocked = hits.length;
  await assert.rejects(
    harness.perform({ operation: 'click', selector: '#action', framePath, timeoutMs: 3000 }),
    /遮挡/,
  );
  assert.equal(hits.length, beforeBlocked);
  evidence.checks.push({ name: 'ancestor-overlay-rejected-before-press' });

  // Missing input routing evidence must fail before any mouse press, not fall
  // through after a sleep or retry an unknown external action.
  await reset();
  await harness.app.evaluate(async () => {
    const contents = (globalThis as any).embeddedFixture.resource.contents;
    const send = contents.debugger.sendCommand.bind(contents.debugger);
    contents.debugger.sendCommand = (method: string, args: any, session: any) =>
      method === 'Input.dispatchMouseEvent' && args.type === 'mouseMoved'
        ? contents.mainFrame.framesInSubtree
            .find((frame: any) => frame.url.endsWith('/inner'))
            .executeJavaScript(
              `document.querySelector('#action').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,composed:true}))`,
            )
            .then(() => ({}))
        : send(method, args, session);
  });
  const timeoutAt = Date.now();
  await assert.rejects(
    harness.perform({ operation: 'click', selector: '#action', framePath, timeoutMs: 1000 }),
    /超时/,
  );
  assert.ok(Date.now() - timeoutAt < 3000);
  assert.equal(hits.length, beforeBlocked);
  evidence.checks.push({ name: 'synthetic-hover-cannot-bypass-input-routing-timeout' });

  await reset();
  await harness.app.evaluate(async () => {
    const contents = (globalThis as any).embeddedFixture.resource.contents;
    const send = contents.debugger.sendCommand.bind(contents.debugger);
    contents.debugger.sendCommand = (method: string, args: any, session: any) =>
      method === 'Input.dispatchMouseEvent' && args.type === 'mouseMoved'
        ? Promise.resolve({})
        : send(method, args, session);
  });
  const pending = assert.rejects(
    harness.perform({ operation: 'click', selector: '#action', framePath, timeoutMs: 5000 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  await harness.close();
  await pending;
  assert.equal(hits.length, beforeBlocked);
  evidence.checks.push({ name: 'close-during-input-routing-does-not-click' });
  evidence.passed = true;
} finally {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      harness.shutdown(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('测试实例未按时退出')), 10000);
      }),
    ]);
    evidence.closed = true;
  } catch (error) {
    harness.app.process().kill('SIGKILL');
    evidence.cleanupError = String(error);
    evidence.passed = false;
    throw error;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/embedded-pointer.json', JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  }
}
