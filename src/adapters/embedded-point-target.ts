import { unprojectQuad } from './point-quad';

type Send = (method: string, params?: any, session?: string) => Promise<any>;
export type PointIdentity = { backendNodeId: number; session?: string };
export type PointHit = PointIdentity & { verify: () => Promise<void> };
type Viewport = {
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
  visibleWidth: number;
  visibleHeight: number;
};
const changed = () => new Error('网页或目标在选取期间变化，请重新选取');
const viewportExpression = `({x:visualViewport.pageLeft,y:visualViewport.pageTop,
  scale:visualViewport.scale,width:innerWidth,height:innerHeight,
  visibleWidth:visualViewport.width,visibleHeight:visualViewport.height})`;

/** CSS viewport input, before visual zoom. Only reads the website's own CDP sessions. */
export async function embeddedPointTarget(
  send: Send,
  sessions: Map<string, string>,
  point: { x: number; y: number },
  signal: AbortSignal,
  current: () => boolean,
  timeout = 3000,
): Promise<PointHit> {
  const end = Date.now() + timeout;
  const bindings = new Map<string, string>();
  const check = () => {
    signal.throwIfAborted();
    if (!current()) throw changed();
    if (Date.now() >= end) throw new Error('目标命中核对超时，请重新选取');
    for (const [frame, session] of bindings) if (sessions.get(frame) !== session) throw changed();
  };
  const call = async (method: string, params: any = {}, session?: string) => {
    check();
    const result = await new Promise<any>((resolve, reject) => {
      let settled = false;
      const finish = (fn: (value: any) => void, value: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        fn(value);
      };
      const abort = () => finish(reject, signal.reason ?? changed());
      const timer = setTimeout(
        () => finish(reject, new Error('目标命中核对超时，请重新选取')),
        Math.max(1, end - Date.now()),
      );
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      // A late CDP rejection remains observed after timeout/cancellation.
      Promise.resolve()
        .then(() => {
          check();
          return send(method, params, session);
        })
        .then(
          (value) => finish(resolve, value),
          (error) => finish(reject, error),
        );
    });
    check();
    return result;
  };
  const viewport = async (session?: string) => {
    const { frameTree } = await call('Page.getFrameTree', {}, session);
    const frame = frameTree?.frame;
    if (!frame?.id || !frame.loaderId) throw changed();
    const { executionContextId } = await call(
      'Page.createIsolatedWorld',
      {
        frameId: frame.id,
        worldName: 'flowark-point-hit',
        grantUniveralAccess: false,
      },
      session,
    );
    const result = await call(
      'Runtime.evaluate',
      {
        expression: viewportExpression,
        contextId: executionContextId,
        returnByValue: true,
      },
      session,
    );
    const view = result.result?.value as Viewport;
    if (
      result.exceptionDetails ||
      !view ||
      !Object.values(view).every((v) => typeof v === 'number' && Number.isFinite(v)) ||
      !(
        view.scale > 0 &&
        view.width > 0 &&
        view.height > 0 &&
        view.visibleWidth > 0 &&
        view.visibleHeight > 0
      )
    )
      throw changed();
    return { view, frame: { id: frame.id, loaderId: frame.loaderId }, tree: frameTree };
  };
  const owner = (tree: any, id: string): any => {
    if (tree.frame.id === id) return { id, loaderId: tree.frame.loaderId };
    for (const child of tree.childFrames ?? []) {
      const found = owner(child, id);
      if (found) return found;
    }
  };
  const read = async () => {
    const root = await viewport();
    if (
      ![point.x, point.y].every(Number.isFinite) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x / root.view.scale >= root.view.visibleWidth ||
      point.y / root.view.scale >= root.view.visibleHeight
    )
      throw new Error('点击位置不在可见网页内容内');
    let x = point.x / root.view.scale + root.view.x,
      y = point.y / root.view.scale + root.view.y;
    let session: string | undefined,
      meta = root;
    const trail: any[] = [];
    for (let depth = 0; depth <= 8; depth++) {
      const hit = await call(
        'DOM.getNodeForLocation',
        { x: Math.round(x), y: Math.round(y) },
        session,
      );
      const { node } = await call(
        'DOM.describeNode',
        { backendNodeId: hit.backendNodeId },
        session,
      );
      const frame = owner(meta.tree, hit.frameId);
      if (!Number.isInteger(hit.backendNodeId) || hit.backendNodeId <= 0 || !frame?.loaderId)
        throw changed();
      const { model } = await call(
        'DOM.getBoxModel',
        { backendNodeId: hit.backendNodeId },
        session,
      );
      if (
        !Array.isArray(model?.content) ||
        model.content.length !== 8 ||
        !model.content.every(Number.isFinite)
      )
        throw changed();
      trail.push({
        session,
        frame,
        view: meta.view,
        root: meta.frame,
        node: hit.backendNodeId,
        quad: model.content,
      });
      const identity: PointIdentity = { backendNodeId: hit.backendNodeId, session };
      if (!['iframe', 'frame'].includes(node.localName) || !node.frameId)
        return { identity, signature: JSON.stringify(trail) };
      const quad = model.content.map(
        (n: number, i: number) => n + (i % 2 ? meta.view.y : meta.view.x),
      );
      const unit = unprojectQuad(quad, x, y);
      // A frame border belongs to the embedding document, not its child.
      if (!unit) return { identity, signature: JSON.stringify(trail) };
      const childSession = sessions.get(node.frameId);
      if (!childSession || childSession === session)
        throw new Error('网页框架尚未就绪，请重新选取');
      if (depth === 8) throw new Error('框架嵌套超过 8 层');
      bindings.set(node.frameId, childSession);
      const child = await viewport(childSession);
      if (child.frame.id !== node.frameId) throw changed();
      x = unit.u * child.view.width + child.view.x;
      y = unit.v * child.view.height + child.view.y;
      session = childSession;
      meta = child;
    }
    throw changed();
  };
  const first = await read();
  return {
    ...first.identity,
    verify: async () => {
      const last = await read();
      if (last.signature !== first.signature) throw changed();
      check();
    },
  };
}
