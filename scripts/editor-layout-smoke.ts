import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFormLab } from './fixtures/platform-page';
import type { Step } from '../src/shared/types';

const data = await mkdtemp('/private/tmp/flowark-editor-layout-');
const lab = await startFormLab();
const app = await electron.launch({
  executablePath: process.env.FLOWARK_TEST_EXECUTABLE || (electronPath as unknown as string),
  args: process.env.FLOWARK_TEST_EXECUTABLE ? [] : [resolve('.')],
  env: { ...process.env, FLOWARK_DATA_DIR: data },
});
const evidence: any = {
  passed: false,
  data,
  layouts: [],
  fixtures: [],
  injections: [
    'flow.save seeds isolated saved fixtures; native form input uses Electron input events',
  ],
};
try {
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => !!(window as any).flowark);
  evidence.version = await app.evaluate(({ app }) => app.getVersion());
  const state = () => page.evaluate(() => (window as any).flowark.request('bootstrap'));
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const focusSelected = button('聚焦所选步骤');
  const sizes = [
    [1040, 700],
    [1200, 800],
    [1380, 900],
  ];
  let session: { id: number; origin: number } | undefined;
  let projection:
    | { stepIds: string[]; nodes: number; edges: number; routedEdges: number }
    | undefined;
  const inspect = () =>
    page.evaluate(() => {
      const rectangles = Object.fromEntries(
        ['.canvas', 'main', '.inspector', '.node-library', '.browser-viewport'].map((selector) => {
          const e = document.querySelector(selector) as HTMLElement;
          if (!e) return [selector, null];
          const r = e.getBoundingClientRect();
          return [
            selector,
            {
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
              clientWidth: e.clientWidth,
              scrollWidth: e.scrollWidth,
              scrollLeft: e.scrollLeft,
            },
          ];
        }),
      );
      return {
        canvas: rectangles['.canvas'],
        main: rectangles.main,
        inspector: rectangles['.inspector'],
        library: rectangles['.node-library'],
        browser: rectangles['.browser-viewport'],
        zoom: new DOMMatrixReadOnly(
          getComputedStyle(document.querySelector('.react-flow__viewport')!).transform,
        ).a,
        nodes: Array.from(document.querySelectorAll('.flow-shape')).map((e) => {
          const r = e.getBoundingClientRect();
          return {
            id: e.closest('.react-flow__node')!.getAttribute('data-id'),
            stepId: e.getAttribute('data-step-id'),
            shape: e.getAttribute('data-shape'),
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        }),
        edges: Array.from(document.querySelectorAll('.react-flow__edge-path')).map((e) => {
          const r = e.getBoundingClientRect();
          return {
            id: e.closest('.react-flow__edge')!.getAttribute('data-id'),
            routed: e.closest('.react-flow__edge')!.classList.contains('react-flow__edge-routed'),
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        }),
        labels: Array.from(
          document.querySelectorAll('.react-flow__edge-textwrapper, .flow-route-label'),
        ).map((e) => {
          const r = e.getBoundingClientRect();
          return {
            id: e.textContent?.trim(),
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        }),
      };
    });
  const wait = async (check: () => Promise<void>) => {
    const deadline = Date.now() + 8000;
    for (;;) {
      try {
        await check();
        return;
      } catch (e) {
        if (Date.now() >= deadline) throw e;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  };
  const layout = async (name: string, selected?: string) => {
    await wait(async () => {
      const s = await inspect();
      assert.ok(s.canvas && s.main && s.inspector && s.library, `${name}: editor mounted`);
      assert.ok(s.main.scrollWidth <= s.main.clientWidth + 1, `${name}: horizontal overflow`);
      assert.equal(s.main.scrollLeft, 0, `${name}: main must not scroll sideways`);
      assert.ok(s.inspector.right <= s.main.right + 1, `${name}: inspector clipped`);
      assert.ok(s.canvas.width >= 250, `${name}: usable canvas width`);
      if (projection) {
        assert.deepEqual(
          s.nodes.flatMap((n) => (n.stepId ? [n.stepId] : [])).sort(),
          [...projection.stepIds].sort(),
          `${name}: every execution step rendered`,
        );
        assert.equal(s.nodes.length, projection.nodes, `${name}: auxiliary nodes rendered`);
        assert.equal(s.edges.length, projection.edges, `${name}: every edge rendered`);
        assert.equal(
          s.edges.filter((e) => e.routed).length,
          projection.routedEdges,
          `${name}: loop return and completion edges rendered`,
        );
      }
      assert.ok(
        s.nodes.some((n) => n.id === '@start'),
        `${name}: start rendered`,
      );
      assert.ok(
        s.nodes.some((n) => n.id === '@end'),
        `${name}: end rendered`,
      );
      const nodes = selected ? s.nodes.filter((n) => n.id === selected) : s.nodes;
      assert.ok(nodes.length > 0);
      // SVG return paths and HTML/SVG edge labels can extend beyond node bounds.
      const scene = selected ? nodes : [...nodes, ...s.edges, ...s.labels];
      for (const node of scene) {
        assert.ok(
          node.x >= s.canvas.x - 1 && node.right <= s.canvas.right + 1,
          `${name}: ${node.id} clipped horizontally`,
        );
        assert.ok(
          node.y >= s.canvas.y - 1 && node.bottom <= s.canvas.bottom + 1,
          `${name}: ${node.id} clipped vertically`,
        );
      }
      if (s.browser) {
        const native = await app.evaluate(async ({ BrowserWindow }) => {
          const view = BrowserWindow.getAllWindows()[0].contentView.children[0] as any;
          const wc = view.webContents;
          return {
            visible: view.getVisible(),
            bounds: view.getBounds(),
            id: wc.id,
            ...(await wc.executeJavaScript(`({width:innerWidth, origin:performance.timeOrigin,
              value:document.querySelector('#full-name')?.value,
              desktop:matchMedia('(min-width: 1600px)').matches})`)),
          };
        });
        assert.equal(native.visible, true);
        for (const key of ['x', 'y', 'width', 'height'] as const)
          assert.ok(
            Math.abs(native.bounds[key] - s.browser[key]) <= 1,
            `${name}: native page bounds ${key}`,
          );
        if (session) {
          assert.equal(native.id, session.id, `${name}: same embedded WebContents`);
          assert.equal(native.origin, session.origin, `${name}: no webpage reload`);
          assert.equal(native.value, '布局保留测试', `${name}: webpage input retained`);
          assert.ok(Math.abs(native.width - 1920) <= 1, `${name}: 1920 CSS pixel webpage`);
          assert.equal(native.desktop, true, `${name}: desktop media query`);
        }
      }
    });
    evidence.layouts.push({ name, ...(await inspect()) });
  };
  const resize = (width: number, height: number) =>
    app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setSize(size.width, size.height);
      },
      { width, height },
    );
  const open = () => page.getByRole('button', { name: '打开网页面板', exact: true }).click();
  const close = () => page.getByRole('button', { name: '关闭网页面板', exact: true }).click();

  await resize(1380, 900);
  await page.getByRole('button', { name: '新建流程', exact: true }).click();
  await layout('closed');
  assert.equal(await focusSelected.isDisabled(), true, 'focus requires a selected step');
  await open();
  await layout('open-without-selection');
  await page.getByLabel('网页地址', { exact: true }).fill(lab.url);
  await page.getByRole('button', { name: '访问网页', exact: true }).click();
  await wait(async () => {
    assert.equal(
      await app.evaluate(async ({ BrowserWindow }) => {
        const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
        return wc.executeJavaScript("!!document.querySelector('#full-name')");
      }),
      true,
    );
  });
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const view = win.contentView.children[0] as any;
    const wc = view.webContents;
    const target = await wc.executeJavaScript(`(() => {
      const field = document.querySelector('#full-name');
      field.scrollIntoView({block:'center'});
      const r = field.getBoundingClientRect();
      return {x:r.x+r.width/2, y:r.y+r.height/2, width:innerWidth};
    })()`);
    const bounds = view.getBounds(),
      origin = win.getContentBounds();
    const scale = bounds.width / target.width;
    const x = Math.round(target.x * scale),
      y = Math.round(target.y * scale);
    const point = {
      x,
      y,
      globalX: origin.x + bounds.x + x,
      globalY: origin.y + bounds.y + y,
      button: 'left' as const,
      clickCount: 1,
    };
    wc.sendInputEvent({ type: 'mouseDown', ...point });
    wc.sendInputEvent({ type: 'mouseUp', ...point });
  });
  await wait(async () => {
    assert.equal(
      await app.evaluate(async ({ BrowserWindow }) => {
        const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
        return wc.executeJavaScript('document.activeElement.id');
      }),
      'full-name',
      'native click focuses the form field before typing',
    );
  });
  const entered = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    await wc.insertText('布局保留测试');
    return {
      id: wc.id,
      origin: await wc.executeJavaScript('performance.timeOrigin'),
      value: await wc.executeJavaScript("document.querySelector('#full-name').value"),
    };
  });
  assert.equal(entered.value, '布局保留测试', 'native text input completed before layout checks');
  session = { id: entered.id, origin: entered.origin };
  await close();
  await layout('closed-again');
  await page.getByRole('button', { name: '添加 填写内容', exact: true }).click();
  await page.locator('#browser-selector').fill('#full-name');
  await page.getByLabel('填写内容', { exact: true }).fill('未保存的配置');
  const selected = (await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'))!;
  await open();
  await layout('selected-open', selected);
  for (const [width, height] of sizes) {
    await resize(width, height);
    await layout(`${width}x${height}`, selected);
    assert.equal(await page.getByLabel('填写内容', { exact: true }).inputValue(), '未保存的配置');
    await close();
    await layout(`${width}x${height}-closed`, selected);
    await open();
    await layout(`${width}x${height}-reopened`, selected);
  }
  // Editing parameters must not reset a manually adjusted viewport.
  await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  await page.waitForTimeout(350);
  const transform = () => page.locator('.react-flow__viewport').getAttribute('style');
  const before = await transform();
  await page.getByLabel('填写内容', { exact: true }).fill('保留手动缩放');
  await page.waitForTimeout(350);
  assert.equal(await transform(), before);
  const retained = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    return {
      id: wc.id,
      origin: await wc.executeJavaScript('performance.timeOrigin'),
      value: await wc.executeJavaScript("document.querySelector('#full-name').value"),
    };
  });
  assert.deepEqual(retained, { ...session, value: '布局保留测试' });
  assert.equal((await state()).runs.length, 0);
  assert.equal(lab.state.attempts, 0);
  assert.deepEqual(errors, []);
  await resize(1040, 700);
  await layout('final-minimum', selected);
  // The horizontal library remains operable without scrolling the whole editor.
  await page.getByLabel('搜索动作', { exact: true }).fill('条件');
  await page.getByRole('button', { name: '添加 条件分支', exact: true }).click();
  assert.equal(await page.locator('.flow-shape[data-shape="decision"]').count(), 1);
  const condition = (await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'))!;
  await page.getByLabel('动作添加位置', { exact: true }).selectOption(condition + ':then');
  await page.getByRole('button', { name: '添加 条件分支', exact: true }).click();
  assert.equal(await page.locator('.flow-shape[data-shape="decision"]').count(), 2);
  // The following fixtures use the public save IPC only to prepare isolated data.
  // All selection, viewport changes and subsequent draft edits use ordinary UI input.
  const seed = (await state()).flows[0];
  const values = (prefix: string, length: number): Step[] =>
    Array.from({ length }, (_, i) => ({
      id: `${prefix}_${i}`,
      type: 'value',
      version: 1,
      value: i,
    }));
  const browserStep = (id: string, value: string): Step => ({
    id,
    type: 'browser',
    version: 3,
    operation: 'fill',
    selector: '#full-name',
    framePath: [],
    value,
  });
  const branch = (id: string, yes: Step[], no: Step[]): Step => ({
    id,
    type: 'condition',
    version: 1,
    actual: true,
    operator: 'equals',
    expected: true,
    then: yes,
    else: no,
  });
  const loop = (id: string, body: Step[]): Step => ({
    id,
    type: 'loop',
    version: 1,
    items: [1, 2],
    body,
  });
  const longSteps = [...values('value', 80), browserStep('long_target', '长流程保留')];
  const nestedSteps = [
    ...values('nested_head', 40),
    branch(
      'outer_condition',
      [
        loop('outer_loop', [
          ...values('outer_body', 15),
          branch(
            'inner_condition',
            [loop('inner_loop', values('deep_body', 20))],
            values('inner_else', 10),
          ),
          ...values('outer_tail', 5),
        ]),
      ],
      [...values('outer_else', 35), branch('empty_condition', [], []), loop('empty_loop', [])],
    ),
    ...values('nested_tail', 10),
    browserStep('nested_target', '嵌套流程保留'),
  ];
  const shortSteps = [...values('short_value', 2), browserStep('short_target', '短流程保留')];
  const fixtures = [
    { id: 'layout_long', name: '长流程布局', steps: longSteps },
    { id: 'layout_nested', name: '嵌套长流程布局', steps: nestedSteps },
    { id: 'layout_short', name: '短流程布局', steps: shortSteps },
  ];
  for (const fixture of fixtures) {
    await page.evaluate(
      ({ flow, bindings }) => (window as any).flowark.request('flow.save', { flow, bindings }),
      { flow: { ...seed.flow, ...fixture }, bindings: { ...seed.bindings, browserId: 'embedded' } },
    );
  }
  const describe = (steps: Step[]) => {
    const stepIds: string[] = [];
    let auxiliary = 2,
      containers = 0,
      loops = 0;
    const visit = (items: Step[]) => {
      for (const step of items) {
        stepIds.push(step.id);
        if (step.type === 'condition') {
          containers++;
          auxiliary++;
          for (const children of [step.then, step.else]) {
            if (!children.length) auxiliary++;
            visit(children);
          }
        } else if (step.type === 'loop') {
          containers++;
          loops++;
          auxiliary++;
          if (!step.body.length) auxiliary++;
          visit(step.body);
        }
      }
    };
    visit(steps);
    return {
      stepIds,
      nodes: stepIds.length + auxiliary,
      edges: stepIds.length + auxiliary - 1 + containers,
      routedEdges: loops * 2,
    };
  };
  const editFixture = async (fixture: (typeof fixtures)[number]) => {
    await button('我的流程').click();
    await button(`编辑 ${fixture.name}`).click();
    projection = describe(fixture.steps);
    await wait(async () => {
      assert.equal(await page.locator('.flow-shape.is-selected').count(), 0);
      assert.equal(
        await focusSelected.isDisabled(),
        true,
        `${fixture.name}: focus disabled without selection`,
      );
    });
  };
  const selection = async () => {
    const selectedNode = page.locator('.flow-shape.is-selected');
    return (await selectedNode.count()) ? selectedNode.getAttribute('data-step-id') : null;
  };
  const fit = async (name: string) => {
    const selectedBefore = await selection();
    await button('Fit View').click();
    await layout(name);
    assert.equal(await selection(), selectedBefore, `${name}: full view preserves selection`);
  };
  const focus = async (name: string, id: string) => {
    assert.equal(await focusSelected.isDisabled(), false);
    await focusSelected.click();
    await layout(name, id);
    assert.equal(await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'), id);
    const s = await inspect();
    const target = s.nodes.find((node) => node.id === id)!;
    assert.ok(
      target.width >= 150 && target.height >= 45,
      `${name}: focus restores a readable node`,
    );
  };
  const selectVisible = async (id: string) => {
    // Full views can be only a few pixels per node. Zoom with the actual control,
    // then use React Flow's existing keyboard-focus auto-pan before a normal click.
    for (let clicks = 0; (await inspect()).zoom < 0.4; clicks++) {
      assert.ok(clicks < 32, 'Zoom In must make the graph readable');
      await button('Zoom In').click();
      await page.waitForTimeout(250);
    }
    await page.keyboard.press('Tab');
    const target = page.locator(`.react-flow__node[data-id="${id}"]`);
    await target.focus();
    await layout(`${id}-keyboard-focus`, id);
    await target.click();
    await wait(async () =>
      assert.equal(await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'), id),
    );
  };
  const allSizes = async (prefix: string, id?: string) => {
    for (const [width, height] of sizes) {
      await resize(width, height);
      await layout(`${prefix}-${width}x${height}-open`, id);
      if (id) await fit(`${prefix}-${width}x${height}-open-full`);
      await close();
      await layout(`${prefix}-${width}x${height}-closed`, id);
      if (id) await fit(`${prefix}-${width}x${height}-closed-full`);
      await open();
      await layout(`${prefix}-${width}x${height}-reopened`, id);
      if (id) {
        await fit(`${prefix}-${width}x${height}-reopened-full`);
        await focus(`${prefix}-${width}x${height}-focus`, id);
      }
    }
  };
  const keepManualViewport = async (id: string, nextValue: string) => {
    await focus(`${id}-before-manual-pan`, id);
    await button('Zoom Out').click();
    await page.waitForTimeout(350);
    const beforePan = await transform();
    const start = await page.evaluate(() => {
      const canvas = document.querySelector('.canvas')!.getBoundingClientRect();
      // Find actual background pixels; do not drag nodes, controls or edge labels.
      for (const fy of [0.7, 0.5, 0.3])
        for (const fx of [0.15, 0.75, 0.45]) {
          const x = canvas.x + canvas.width * fx,
            y = canvas.y + canvas.height * fy;
          if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane'))
            return { x, y };
        }
      throw new Error('No canvas background available for a normal pan');
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 30, start.y + 20, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const manual = await transform();
    assert.notEqual(manual, beforePan, 'real background drag changes the viewport');
    await page.getByLabel('填写内容', { exact: true }).fill(nextValue);
    await page.waitForTimeout(450);
    assert.equal(await transform(), manual, 'parameter input preserves manual pan and zoom');
    assert.equal(await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'), id);
    evidence.manualViewport = [...(evidence.manualViewport ?? []), { id, beforePan, manual }];
  };

  await editFixture(fixtures[0]);
  await layout('long-full-minimum');
  assert.equal(projection!.stepIds.length, 81);
  evidence.fixtures.push({ name: 'long', ...projection });
  await allSizes('long-unselected');
  await fit('long-explicit-full');
  await selectVisible('long_target');
  await focus('long-selected-focus', 'long_target');
  assert.equal(await page.getByLabel('填写内容', { exact: true }).inputValue(), '长流程保留');
  await allSizes('long-selected', 'long_target');
  await keepManualViewport('long_target', '长流程手动视口保留');
  await fit('long-full-after-parameter-edit');
  assert.equal(
    await page.getByLabel('填写内容', { exact: true }).inputValue(),
    '长流程手动视口保留',
  );
  await focus('long-focus-after-full', 'long_target');
  await button('复制节点').click();
  const copied = (await page.locator('.flow-shape.is-selected').getAttribute('data-step-id'))!;
  projection = {
    ...describe(longSteps),
    stepIds: [...describe(longSteps).stepIds, copied],
    nodes: 84,
    edges: 83,
  };
  await layout('long-structure-added-full');
  assert.equal(
    await page.getByLabel('填写内容', { exact: true }).inputValue(),
    '长流程手动视口保留',
  );
  await button('撤销编辑').click();
  projection = describe(longSteps);
  await layout('long-structure-undo-full');

  await resize(1040, 700);
  await editFixture(fixtures[1]);
  await layout('nested-first-full-minimum');
  assert.ok(projection!.stepIds.length > 100, 'second fixture exceeds 100 execution steps');
  assert.equal(projection!.routedEdges, 6, 'three real loop return/completion pairs');
  assert.equal(await page.locator('.flow-shape[data-shape="empty"]').count(), 3);
  assert.equal(await page.locator('.flow-route-label').filter({ hasText: '下一项' }).count(), 3);
  assert.equal(await page.locator('.flow-route-label').filter({ hasText: '完成' }).count(), 3);
  evidence.fixtures.push({ name: 'nested', ...projection });
  await allSizes('nested-unselected');
  await selectVisible('nested_target');
  await allSizes('nested-selected', 'nested_target');
  await keepManualViewport('nested_target', '嵌套流程手动视口保留');
  await fit('nested-full-after-parameter-edit');
  await focus('nested-focus-after-full', 'nested_target');

  // A large subtree changes the projection extent when duplicated and removed.
  await selectVisible('outer_condition');
  await button('复制节点').click();
  const duplicatedCondition = (await page
    .locator('.flow-shape.is-selected')
    .getAttribute('data-step-id'))!;
  await page.locator('.node-advanced summary').click();
  const copiedBranch = JSON.parse(
    await page.locator('.node-advanced textarea').inputValue(),
  ) as Step;
  assert.equal(copiedBranch.id, duplicatedCondition);
  const expandedNested = [...nestedSteps.slice(0, 41), copiedBranch, ...nestedSteps.slice(41)];
  projection = describe(expandedNested);
  await layout('nested-structure-copy-full');
  await button('撤销编辑').click();
  projection = describe(nestedSteps);
  await layout('nested-structure-undo-full');

  await resize(1040, 700);
  await editFixture(fixtures[2]);
  await layout('short-after-nested-full');
  const shortView = await inspect();
  assert.ok(shortView.zoom > 0.3, 'short flow does not retain the tiny long-flow zoom');
  assert.equal(shortView.nodes.length, 5);
  assert.equal(shortView.edges.length, 4);
  assert.equal(shortView.labels.length, 0, 'old branch labels removed');
  evidence.fixtures.push({ name: 'short', ...projection });
  await selectVisible('short_target');
  await focus('short-selected-focus', 'short_target');
  await fit('short-explicit-full');
  await focus('short-final-focus', 'short_target');
  const final = await state();
  for (const fixture of fixtures) {
    const saved = final.flows.find((record: any) => record.flow.id === fixture.id);
    assert.deepEqual(
      saved.flow.steps,
      fixture.steps,
      `${fixture.name}: viewport and unsaved edits never save the fixture`,
    );
  }
  assert.equal(final.runs.length, 0, 'no accidental Run');
  assert.equal(lab.state.attempts, 0, 'no accidental form submission');
  assert.equal(lab.state.accepted.length, 0);
  assert.equal(lab.state.rejected, 0);
  assert.deepEqual(errors, []);
  evidence.selected = selected;
  evidence.condition = condition;
  await mkdir('test-results', { recursive: true });
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    await wc.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
  });
  const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'),
  );
  await writeFile('test-results/editor-layout.png', Buffer.from(screenshot, 'base64'));
  // The workbench capture does not include the child WebContents surface.
  const webpage = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = (BrowserWindow.getAllWindows()[0].contentView.children[0] as any).webContents;
    const image = await wc.capturePage();
    const bitmap = image.toBitmap();
    let painted = 0;
    for (let i = 0; i < bitmap.length; i += 4)
      if (bitmap[i] < 240 || bitmap[i + 1] < 240 || bitmap[i + 2] < 240) painted++;
    return { png: image.toPNG().toString('base64'), painted };
  });
  assert.ok(webpage.painted > 1000, 'native webpage is not blank');
  await writeFile('test-results/editor-layout-page.png', Buffer.from(webpage.png, 'base64'));
  evidence.painted = webpage.painted;
  evidence.passed = true;
  console.log(
    JSON.stringify({
      passed: true,
      version: evidence.version,
      layouts: evidence.layouts.length,
      data,
    }),
  );
} finally {
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/editor-layout.json', JSON.stringify(evidence, null, 2));
  await app.close();
  await lab.close();
}
