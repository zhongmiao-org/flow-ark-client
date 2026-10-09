import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedPointTarget } from '../src/adapters/embedded-point-target';
import { unprojectQuad } from '../src/adapters/point-quad';

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
test('quad mapping preserves rotated, reflected and perspective coordinates; rejects invalid geometry', () => {
  const rotate = [10, 20, 10, 120, -40, 120, -40, 20];
  const p = unprojectQuad(rotate, -5, 45)!;
  close(p.u, 0.25);
  close(p.v, 0.3);
  const reflected = unprojectQuad([100, 0, 0, 0, 0, 100, 100, 100], 80, 30)!;
  close(reflected.u, 0.2);
  close(reflected.v, 0.3);
  // Independent projective function: x=(100u+10)/(1+.5v), y=(80v+20)/(1+.5v).
  const perspective = [10, 20, 110, 20, 110 / 1.5, 100 / 1.5, 10 / 1.5, 100 / 1.5];
  const projected = unprojectQuad(perspective, 50 / 1.3, 68 / 1.3)!;
  close(projected.u, 0.4);
  close(projected.v, 0.6);
  assert.equal(unprojectQuad(rotate, 50, 50), undefined);
  for (const q of [
    [0, 0, 1, 0, 2, 0, 3, 0],
    [0, 0, 10, 10, 0, 10, 10, 0],
    [NaN, 0, 10, 0, 10, 10, 0, 10],
  ])
    assert.throws(() => unprojectQuad(q, 1, 1));
});

function fixture() {
  const sessions = new Map([['child', 's-child']]);
  const view = (x = 0, y = 0, scale = 1, width = 1000, height = 800) => ({
    x,
    y,
    scale,
    width,
    height,
    visibleWidth: width / scale,
    visibleHeight: height / scale,
  });
  const views: Record<string, ReturnType<typeof view>> = {
    root: view(100, 200, 2),
    child: view(0, 30, 1, 200, 100),
  };
  let leaf = 2,
    move = 0,
    loader = 'doc-root';
  const calls: { method: string; args: any; session?: string }[] = [];
  const send = async (method: string, args: any = {}, session?: string): Promise<any> => {
    calls.push({ method, args, session });
    const frame = session ? 'child' : 'root';
    if (method === 'Page.getFrameTree')
      return {
        frameTree: { frame: { id: frame, loaderId: frame === 'root' ? loader : 'doc-child' } },
      };
    if (method === 'Page.createIsolatedWorld')
      return { executionContextId: frame === 'root' ? 1 : 2 };
    if (method === 'Runtime.evaluate') return { result: { value: views[frame] } };
    if (method === 'DOM.getNodeForLocation') {
      if (!session) {
        assert.deepEqual(args, { x: 150, y: 260 });
        return { backendNodeId: 1, frameId: 'root' };
      }
      assert.deepEqual(args, { x: 100, y: 80 });
      return { backendNodeId: leaf, frameId: 'child' };
    }
    if (method === 'DOM.describeNode')
      return {
        node:
          args.backendNodeId === 1
            ? { localName: 'iframe', frameId: 'child' }
            : { localName: 'input' },
      };
    if (method === 'DOM.getBoxModel')
      return {
        model: {
          content:
            args.backendNodeId === 1
              ? [0, 10, 100, 10, 100, 110, 0, 110]
              : [90 + move, 40, 110 + move, 40, 110 + move, 60, 90 + move, 60],
        },
      };
    throw Error('Unexpected or mutating command ' + method);
  };
  return {
    send,
    sessions,
    calls,
    views,
    setLeaf: (id: number) => {
      leaf = id;
    },
    move: () => {
      move++;
    },
    navigate: () => {
      loader = 'new-document';
    },
  };
}

test('document hit maps root visual zoom and child scrolling without any input command', async () => {
  const f = fixture();
  const hit = await embeddedPointTarget(
    f.send,
    f.sessions,
    { x: 100, y: 120 },
    new AbortController().signal,
    () => true,
  );
  assert.equal(hit.backendNodeId, 2);
  assert.equal(hit.session, 's-child');
  await hit.verify();
  assert.ok(f.calls.every((c) => !c.method.startsWith('Input.')));
});
for (const change of ['node', 'geometry', 'document', 'session'] as const)
  test(`verification rejects changed ${change}`, async () => {
    const f = fixture();
    const hit = await embeddedPointTarget(
      f.send,
      f.sessions,
      { x: 100, y: 120 },
      new AbortController().signal,
      () => true,
    );
    if (change === 'node') f.setLeaf(3);
    if (change === 'geometry') f.move();
    if (change === 'document') f.navigate();
    if (change === 'session') f.sessions.set('child', 'replacement');
    await assert.rejects(hit.verify(), /变化/);
  });

test('out of visible content fails before requesting a DOM hit', async () => {
  const f = fixture();
  await assert.rejects(
    embeddedPointTarget(
      f.send,
      f.sessions,
      { x: -1, y: 20 },
      new AbortController().signal,
      () => true,
    ),
    /可见/,
  );
  assert.equal(
    f.calls.some((c) => c.method === 'DOM.getNodeForLocation'),
    false,
  );
});

test('cancellation releases a pending read and observes its late rejection', async () => {
  const controller = new AbortController();
  let entered!: () => void, reject!: (reason: Error) => void;
  const began = new Promise<void>((done) => {
    entered = done;
  });
  const pending = embeddedPointTarget(
    async () => {
      entered();
      return new Promise((_, no) => {
        reject = no;
      });
    },
    new Map(),
    { x: 1, y: 1 },
    controller.signal,
    () => true,
  );
  await began;
  controller.abort(new Error('cancelled by user'));
  await assert.rejects(pending, /cancelled by user/);
  reject(new Error('late transport failure'));
  await new Promise((done) => setImmediate(done));
});

test('a stalled read has a finite deadline and cannot yield a later target', async () => {
  let resolve!: (value: any) => void;
  const pending = embeddedPointTarget(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
    new Map(),
    { x: 1, y: 1 },
    new AbortController().signal,
    () => true,
    20,
  );
  await assert.rejects(pending, /超时/);
  resolve({});
  await new Promise((done) => setImmediate(done));
});
