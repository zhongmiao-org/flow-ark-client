import type { MouseInputEvent, WebContents } from 'electron';
import type { ElementTarget, PickerState } from '../shared/element-picker';
import { describeElement } from './element-description';
import { embeddedPointTarget, type PointIdentity, type PointHit } from './embedded-point-target';
type Send = (method: string, params?: any, session?: string) => Promise<any>;
type Frame = { id: string; parent?: string; session?: string; context?: number };
const highlight = {
  showInfo: true,
  contentColor: { r: 43, g: 133, b: 116, a: 0.23 },
  borderColor: { r: 43, g: 133, b: 116, a: 1 },
};
export class EmbeddedPicker {
  private state?: PickerState;
  private selectedIdentity?: { state: PickerState; point: PointIdentity };
  identity(requestId: string) {
    const selected = this.selectedIdentity;
    if (
      !selected ||
      selected.state !== this.state ||
      this.state.phase !== 'selected' ||
      this.state.requestId !== requestId
    )
      throw new Error('没有此请求的已选网页目标，请重新选取');
    return { ...selected.point };
  }
  private timer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();
  private selecting?: PickerState;
  private processing: Promise<void> = Promise.resolve();
  private pointAbort?: () => void;
  private selectionSequence = 0;
  private pointMove?: { state: PickerState; x: number; y: number };
  private pressed = new Set<string | undefined>();
  private serialize(task: () => Promise<void>) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }
  constructor(
    private contents: WebContents,
    private send: Send,
    private sessions: Map<string, string>,
    private validate: (
      selector: string,
      path: string[],
      expected?: PointIdentity,
    ) => Promise<ElementTarget>,
    private coordinates: (mouse: MouseInputEvent) => { x: number; y: number },
  ) {
    contents.debugger.on('message', (_event, method, params, session) => {
      const state = this.state;
      if (state?.phase !== 'picking') return;
      if (method === 'Overlay.inspectModeCanceled' && this.selecting !== state) {
        void this.cancel(state.requestId);
      } else if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
        void this.serialize(async () => {
          if (this.state === state && this.selecting !== state) await this.enable(params.sessionId);
        }).catch(() => {});
      }
    });
    contents.on('before-mouse-event', (event, mouse) => {
      // Inspect mode only consumes a mouse-down after a hover. A stationary click
      // must never reach the page, including its release after selection finishes.
      if (mouse.type === 'mouseUp' && this.pressed.delete(mouse.button)) {
        event.preventDefault();
        return;
      }
      const state = this.state;
      if (state?.phase !== 'picking') {
        // The release may have happened outside this view while it was hidden.
        // A new ordinary press starts a fresh gesture and must not lose its release.
        if (mouse.type === 'mouseDown') this.pressed.delete(mouse.button);
        return;
      }
      if (mouse.type === 'mouseDown') {
        event.preventDefault();
        this.pressed.add(mouse.button);
        if (mouse.button === 'left' && this.selecting !== state) {
          const point = this.coordinates(mouse);
          this.pointMove = { state, ...point };
          this.processing = this.select(state, (signal, send) =>
            this.pointTarget(
              state,
              point.x / contents.getZoomFactor(),
              point.y / contents.getZoomFactor(),
              signal,
              send,
            ),
          );
        }
      } else if (
        mouse.type === 'mouseUp' ||
        (mouse.type === 'mouseMove' &&
          this.selecting === state &&
          !(
            this.pointMove?.state === state &&
            Math.abs(this.coordinates(mouse).x - this.pointMove.x) < 1 &&
            Math.abs(this.coordinates(mouse).y - this.pointMove.y) < 1
          ))
      ) {
        event.preventDefault();
      }
    });
    contents.on('did-start-navigation', (_event, _url, inPlace) => {
      if (!inPlace) void this.cancel().catch(() => {});
    });
  }
  status(requestId: string): PickerState {
    return this.state?.requestId === requestId ? this.state : { requestId, phase: 'cancelled' };
  }
  private async enable(session?: string) {
    await this.send('DOM.enable', {}, session);
    await this.send('Overlay.enable', {}, session);
    await this.send(
      'Overlay.setInspectMode',
      { mode: 'searchForNode', highlightConfig: highlight },
      session,
    );
  }
  private async clear() {
    await Promise.all(
      [undefined, ...new Set(this.sessions.values())].map(async (session) => {
        await this.send('Overlay.setInspectMode', { mode: 'none' }, session).catch(() => {});
        await this.send('Overlay.hideHighlight', {}, session).catch(() => {});
        await this.send('Overlay.disable', {}, session).catch(() => {});
      }),
    );
  }
  async cancel(requestId?: string) {
    if (requestId && this.state?.requestId !== requestId) return true;
    this.selectedIdentity = undefined;
    const cancelled: PickerState = { requestId: this.state?.requestId ?? '', phase: 'cancelled' };
    this.state = cancelled;
    this.pointAbort?.();
    clearTimeout(this.timer);
    const processing = this.processing;
    await this.serialize(async () => {
      if (this.state === cancelled) await this.clear();
    });
    await processing;
    return true;
  }
  async start(requestId: string) {
    this.selectedIdentity = undefined;
    this.pointAbort?.();
    clearTimeout(this.timer);
    const state: PickerState = { requestId, phase: 'picking' };
    this.state = state;
    await this.processing;
    await this.serialize(async () => {
      if (this.state !== state) return;
      try {
        await this.clear();
        if (this.state !== state) return;
        await Promise.all(
          [undefined, ...new Set(this.sessions.values())].map((session) => this.enable(session)),
        );
        if (this.state !== state) {
          await this.clear();
          return;
        }
        this.timer = setTimeout(() => {
          void this.cancel(requestId);
        }, 120000);
        this.timer.unref();
      } catch (e) {
        if (this.state === state) this.state = { requestId, phase: 'error', error: String(e) };
        await this.clear();
      }
    });
    return this.status(requestId);
  }
  private async allFrames(send: Send = this.send) {
    const frames = new Map<string, Frame>();
    const visit = (tree: any, session?: string, parent?: string) => {
      const id = tree.frame.id;
      const previous = frames.get(id);
      const current = {
        id,
        parent: tree.frame.parentId ?? parent ?? previous?.parent,
        session: this.sessions.get(id) ?? session,
      };
      frames.set(id, current);
      for (const child of tree.childFrames ?? []) visit(child, current.session, id);
    };
    const root = await send('Page.getFrameTree');
    visit(root.frameTree);
    for (const session of new Set(this.sessions.values())) {
      const tree = await send('Page.getFrameTree', {}, session);
      visit(tree.frameTree, session);
    }
    return frames;
  }
  private async world(frame: Frame, send: Send = this.send) {
    if (!frame.context)
      frame.context = (
        await send(
          'Page.createIsolatedWorld',
          { frameId: frame.id, worldName: 'flowark-browser-driver', grantUniveralAccess: false },
          frame.session,
        )
      ).executionContextId;
    return frame.context;
  }
  private async inspectNode(
    backendNodeId: number,
    frame: Frame,
    group: string,
    send: Send = this.send,
  ) {
    const { object } = await send(
      'DOM.resolveNode',
      { backendNodeId, executionContextId: await this.world(frame, send), objectGroup: group },
      frame.session,
    );
    const result = await send(
      'Runtime.callFunctionOn',
      {
        objectId: object.objectId,
        functionDeclaration: describeElement.toString(),
        returnByValue: true,
      },
      frame.session,
    );
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description ?? '目标定位失败');
    return result.result.value;
  }
  private async pointTarget(
    state: PickerState,
    x: number,
    y: number,
    signal: AbortSignal,
    send: Send,
  ) {
    await this.serialize(async () => {
      if (this.state !== state) throw new Error('选取已取消');
      await this.clear();
    });
    return embeddedPointTarget(send, this.sessions, { x, y }, signal, () => this.state === state);
  }
  private async select(
    state: PickerState,
    resolve: (
      signal: AbortSignal,
      send: Send,
    ) => Promise<PointIdentity & { verify?: PointHit['verify'] }>,
  ) {
    // Leave inspect mode before inspecting metadata; suppress a second selection event.
    if (this.state !== state || this.selecting === state) return;
    this.selecting = state;
    const pending = state;
    const group = 'flowark-picker:' + ++this.selectionSequence;
    const controller = new AbortController();
    const abort = () => controller.abort(new Error('选取已取消'));
    this.pointAbort = abort;
    const wait = <T>(operation: () => Promise<T>): Promise<T> =>
      new Promise((yes, no) => {
        if (controller.signal.aborted || this.state !== state) {
          no(new Error('选取已取消'));
          return;
        }
        const cancelled = () => {
          controller.signal.removeEventListener('abort', cancelled);
          no(controller.signal.reason);
        };
        controller.signal.addEventListener('abort', cancelled, { once: true });
        Promise.resolve()
          .then(() => {
            controller.signal.throwIfAborted();
            return operation();
          })
          .then((value) => {
            if (this.state !== state) throw new Error('选取已取消');
            return value;
          })
          .then(yes, no)
          .finally(() => controller.signal.removeEventListener('abort', cancelled));
      });
    const send: Send = (method, args, session) => wait(() => this.send(method, args, session));
    clearTimeout(this.timer);
    const timeout = setTimeout(() => {
      if (this.state !== pending) return;
      this.state = {
        requestId: state.requestId,
        phase: 'error',
        error: '目标解析超时，请重新选取',
      };
      controller.abort(new Error('目标解析超时，请重新选取'));
      void this.serialize(() => this.clear());
    }, 15000);
    timeout.unref();
    try {
      const hit = await resolve(controller.signal, send);
      const { backendNodeId, session } = hit;
      await this.serialize(() => this.clear());
      if (this.state !== pending) return;
      const { object } = await send(
        'DOM.resolveNode',
        { backendNodeId, objectGroup: group },
        session,
      );
      const document = await send(
        'Runtime.callFunctionOn',
        {
          objectId: object.objectId,
          functionDeclaration: 'function(){return this.ownerDocument}',
          objectGroup: group,
        },
        session,
      );
      const owner = await send('DOM.describeNode', { objectId: document.result.objectId }, session);
      const frames = await this.allFrames(send);
      let selected: Frame | undefined;
      for (const frame of frames.values()) {
        if (this.state !== pending) return;
        if (frame.session !== session) continue;
        const result = await send(
          'Runtime.evaluate',
          { expression: 'document', contextId: await this.world(frame, send), objectGroup: group },
          frame.session,
        );
        const doc = await send(
          'DOM.describeNode',
          { objectId: result.result.objectId },
          frame.session,
        );
        if (doc.node.backendNodeId === owner.node.backendNodeId) {
          selected = frame;
          break;
        }
      }
      if (!selected) throw new Error('页面框架已变化，请重新选取');
      const target = await this.inspectNode(backendNodeId, selected, group, send);
      const path: string[] = [];
      let child = selected;
      while (child.parent) {
        if (path.length >= 8) throw new Error('框架嵌套超过 8 层');
        const parent = frames.get(child.parent);
        if (!parent) throw new Error('无法定位父框架');
        const owner = await send('DOM.getFrameOwner', { frameId: child.id }, parent.session);
        const described = await this.inspectNode(owner.backendNodeId, parent, group, send);
        path.unshift(described.selector);
        target.structural ||= described.structural;
        child = parent;
      }
      if (this.state !== pending) return;
      await wait(() => this.validate(target.selector, path, { backendNodeId, session }));
      await hit.verify?.();
      if (this.state === pending) {
        this.state = {
          requestId: state.requestId,
          phase: 'selected',
          target: { ...target, framePath: path },
        };
        this.selectedIdentity = { state: this.state, point: { backendNodeId, session } };
      }
    } catch (e) {
      if (this.state === pending) {
        await this.serialize(() => this.clear());
      }
      if (this.state === pending)
        this.state = {
          requestId: state.requestId,
          phase: 'error',
          error: e instanceof Error ? e.message : '拾取失败，请重试',
        };
    } finally {
      clearTimeout(timeout);
      if (this.pointAbort === abort) this.pointAbort = undefined;
      if (this.pointMove?.state === state) this.pointMove = undefined;
      const release = Promise.all(
        [undefined, ...new Set(this.sessions.values())].map((s) =>
          this.send('Runtime.releaseObjectGroup', { objectGroup: group }, s).catch(() => {}),
        ),
      );
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          release,
          new Promise<void>((done) => {
            cleanupTimer = setTimeout(done, 1000);
          }),
        ]);
      } finally {
        clearTimeout(cleanupTimer);
      }
    }
  }
  dispose() {
    this.selectedIdentity = undefined;
    clearTimeout(this.timer);
    this.pointAbort?.();
    if (this.state) this.state = { requestId: this.state.requestId, phase: 'cancelled' };
  }
}
