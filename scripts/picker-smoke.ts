import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { embeddedHarness } from './fixtures/embedded-harness';
import { startFrameFixture } from './fixtures/frames';
import type { ElementTarget, PickerState } from '../src/shared/element-picker';
const data = await mkdtemp('/private/tmp/flowark-picker-');
const lab = await startFrameFixture({ crossSite: true });
const h = await embeddedHarness(data);
const evidence: any = { passed: false, data, checks: [] };
try {
  await h.start();
  await h.system('browser.embedded.viewport', { x: 0, y: 0, width: 1100, height: 800 });
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await h.visibility(true);
  await h.perform({ operation: 'navigate', value: lab.url });
  assert.ok(
    await h.app.evaluate(() => (globalThis as any).embeddedFixture.page.frames.size > 0),
    '跨站 iframe 应由独立目标会话承载',
  );
  evidence.crossSite = true;
  const clickTarget = async (selector: string, path: string[] = []) =>
    h.app.evaluate(
      async (_electron, { selector, path }) => {
        const fixture = (globalThis as any).embeddedFixture,
          page = fixture.page;
        const scope = await page.scope(path, () => 5000);
        const object = await page.element(scope, selector, () => 5000);
        let point = await page.call(
          scope,
          object,
          'function(){this.scrollIntoView({block:"center"}); const r=this.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}',
        );
        for (const parent of scope.ancestors) {
          const offset = await page.evaluate(
            parent.scope,
            `(()=>{const e=document.querySelector(${JSON.stringify(parent.selector)}),r=e.getBoundingClientRect();return {x:r.x+e.clientLeft,y:r.y+e.clientTop}})()`,
          );
          point.x += offset.x;
          point.y += offset.y;
        }
        point.x = Math.round(point.x);
        point.y = Math.round(point.y);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await page.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          ...point,
          button: 'left',
          clickCount: 1,
        });
        await page.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          ...point,
          button: 'left',
          clickCount: 1,
        });
        await page.send('Runtime.releaseObject', { objectId: object }, scope.session);
      },
      { selector, path },
    );
  const selected = async (requestId: string): Promise<ElementTarget> => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const state: PickerState = await h.system('browser.embedded.pick.status', { requestId });
      if (state.phase === 'selected') return state.target!;
      if (state.phase !== 'picking') throw new Error(JSON.stringify(state));
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('拾取超时：' + requestId);
  };
  for (const [name, selector, path] of [
    ['top', '#name', []],
    ['nested', '#name', ['#outer', '#inner']],
    ['button', '#action', ['#outer', '#inner']],
  ] as [string, string, string[]][]) {
    await h.system('browser.embedded.pick.start', { requestId: name });
    await clickTarget(selector, path);
    const target = await selected(name);
    assert.equal(target.selector, selector);
    assert.deepEqual(target.framePath, path);
    assert.equal(lab.state.clicks.length, 0);
    if (name !== 'button') {
      await h.perform({
        operation: 'fill',
        selector: target.selector,
        framePath: target.framePath,
        value: 'picked-' + name,
      });
      assert.equal(
        await h.perform({ operation: 'inputValue', selector, framePath: path, value: null }),
        'picked-' + name,
      );
    }
    evidence.checks.push({ name, target });
  }
  await h.app.evaluate(async () => {
    await (globalThis as any).embeddedFixture.view.webContents.executeJavaScript(`(() => {
      const section=document.createElement('section'); section.id='picker-fixtures';
      section.innerHTML='<label for="picker-password">测试密码</label><input id="picker-password" type="password" value="fictional-secret"><input id="odd:id[1]" aria-label="特殊字符"><div><input class="structural"><input class="structural"></div><div id="shadow-one"></div><label>可读选项<select id="picker-options" multiple><option value="a">甲</option><option value="b" disabled>乙</option></select></label>';
      document.body.append(section);
      document.querySelector('#shadow-one').attachShadow({mode:'open'}).innerHTML='<input id="shadow-input" aria-label="影子输入">';
    })()`);
  });
  for (const [name, selector] of [
    ['password', '#picker-password'],
    ['escape-css', '[id="odd:id[1]"]'],
    ['structure', '.structural:nth-of-type(2)'],
    ['shadow', '#shadow-input'],
    ['options', '#picker-options'],
  ]) {
    await h.system('browser.embedded.pick.start', { requestId: name });
    await clickTarget(selector);
    const target = await selected(name);
    assert.ok(!JSON.stringify(target).includes('fictional-secret'));
    const verified = await h.system('browser.embedded.pick.validate', {
      selector: target.selector,
      framePath: target.framePath,
    });
    assert.equal(verified.label, target.label);
    if (name === 'structure') assert.equal(target.structural, true);
    if (name === 'options') {
      assert.equal(target.label, '可读选项');
      assert.equal(target.multiple, true);
      assert.deepEqual(target.options, [
        { value: 'a', label: '甲', disabled: false },
        { value: 'b', label: '乙', disabled: true },
      ]);
    }
    evidence.checks.push({ name, target });
  }
  await assert.rejects(
    h.system('browser.embedded.pick.validate', { selector: 'iframe.duplicate', framePath: [] }),
    /多个元素/,
  );
  await h.system('browser.embedded.pick.start', { requestId: 'escape' });
  await h.app.evaluate(() => {
    const wc = (globalThis as any).embeddedFixture.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    (await h.system('browser.embedded.pick.status', { requestId: 'escape' })).phase,
    'cancelled',
  );
  await h.system('browser.embedded.pick.start', { requestId: 'old' });
  await h.system('browser.embedded.pick.start', { requestId: 'new' });
  await h.system('browser.embedded.pick.cancel', { requestId: 'old' });
  assert.equal(
    (await h.system('browser.embedded.pick.status', { requestId: 'new' })).phase,
    'picking',
  );
  await h.visibility(false);
  assert.equal(
    (await h.system('browser.embedded.pick.status', { requestId: 'new' })).phase,
    'cancelled',
  );
  await h.visibility(true);
  await h.system('browser.embedded.pick.start', { requestId: 'execute' });
  await h.perform({ operation: 'click', selector: '#action', framePath: ['#outer', '#inner'] });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(lab.state.clicks, ['first']);
  assert.equal(
    (await h.system('browser.embedded.pick.status', { requestId: 'execute' })).phase,
    'cancelled',
  );
  evidence.passed = true;
  console.log(JSON.stringify(evidence));
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/picker.json', JSON.stringify(evidence, null, 2));
  await h.shutdown();
  await lab.close();
}
