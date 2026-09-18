import type { WebContents } from 'electron';
import type { ElementTarget, PickerState } from '../shared/element-picker';
import { describeElement } from './element-description';
type Send = (method: string, params?: any, session?: string) => Promise<any>;
type Frame = { id: string; parent?: string; session?: string; context?: number };
const highlight = {
  showInfo: true,
  contentColor: { r: 43, g: 133, b: 116, a: 0.23 },
  borderColor: { r: 43, g: 133, b: 116, a: 1 },
};
export class EmbeddedPicker {
  private state?: PickerState;
  private timer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();
  private selecting?: PickerState;
  private processing: Promise<void> = Promise.resolve();
  private serialize(task: () => Promise<void>) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }
  constructor(
    private contents: WebContents,
    private send: Send,
    private sessions: Map<string, string>,
    private validate: (selector: string, path: string[]) => Promise<ElementTarget>,
  ) {
    contents.debugger.on('message', (_event, method, params, session) => {
      const state = this.state;
      if (state?.phase !== 'picking') return;
      if (method === 'Overlay.inspectNodeRequested' && this.selecting !== state) {
        this.processing = this.select(state, params.backendNodeId, session || undefined);
      } else if (method === 'Overlay.inspectModeCanceled' && this.selecting !== state) {
        void this.cancel(state.requestId);
      } else if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
        void this.serialize(async () => {
          if (this.state === state && this.selecting !== state) await this.enable(params.sessionId);
        }).catch(() => {});
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
    const cancelled: PickerState = { requestId: this.state?.requestId ?? '', phase: 'cancelled' };
    this.state = cancelled;
    clearTimeout(this.timer);
    const processing = this.processing;
    await this.serialize(async () => {
      if (this.state === cancelled) await this.clear();
    });
    await processing;
    return true;
  }
  async start(requestId: string) {
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
  private async allFrames() {
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
    const root = await this.send('Page.getFrameTree');
    visit(root.frameTree);
    for (const session of new Set(this.sessions.values())) {
      const tree = await this.send('Page.getFrameTree', {}, session);
      visit(tree.frameTree, session);
    }
    return frames;
  }
  private async world(frame: Frame) {
    if (!frame.context)
      frame.context = (
        await this.send(
          'Page.createIsolatedWorld',
          { frameId: frame.id, worldName: 'flowark-browser-driver', grantUniveralAccess: false },
          frame.session,
        )
      ).executionContextId;
    return frame.context;
  }
  private async inspectNode(backendNodeId: number, frame: Frame, group: string) {
    const { object } = await this.send(
      'DOM.resolveNode',
      { backendNodeId, executionContextId: await this.world(frame), objectGroup: group },
      frame.session,
    );
    const result = await this.send(
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
  private async select(state: PickerState, backendNodeId: number, session?: string) {
    // Leave inspect mode before inspecting metadata; suppress a second selection event.
    if (this.state !== state || this.selecting === state) return;
    this.selecting = state;
    const pending = state;
    const group = 'flowark-picker:' + state.requestId;
    clearTimeout(this.timer);
    const timeout = setTimeout(() => {
      if (this.state !== pending) return;
      this.state = {
        requestId: state.requestId,
        phase: 'error',
        error: '目标解析超时，请重新选取',
      };
      void this.serialize(() => this.clear());
    }, 15000);
    timeout.unref();
    try {
      await this.serialize(() => this.clear());
      if (this.state !== pending) return;
      const { object } = await this.send(
        'DOM.resolveNode',
        { backendNodeId, objectGroup: group },
        session,
      );
      const document = await this.send(
        'Runtime.callFunctionOn',
        {
          objectId: object.objectId,
          functionDeclaration: 'function(){return this.ownerDocument}',
          objectGroup: group,
        },
        session,
      );
      const owner = await this.send(
        'DOM.describeNode',
        { objectId: document.result.objectId },
        session,
      );
      const frames = await this.allFrames();
      let selected: Frame | undefined;
      for (const frame of frames.values()) {
        if (this.state !== pending) return;
        if (frame.session !== session) continue;
        const result = await this.send(
          'Runtime.evaluate',
          { expression: 'document', contextId: await this.world(frame), objectGroup: group },
          frame.session,
        );
        const doc = await this.send(
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
      const target = await this.inspectNode(backendNodeId, selected, group);
      const path: string[] = [];
      let child = selected;
      while (child.parent) {
        if (path.length >= 8) throw new Error('框架嵌套超过 8 层');
        const parent = frames.get(child.parent);
        if (!parent) throw new Error('无法定位父框架');
        const owner = await this.send('DOM.getFrameOwner', { frameId: child.id }, parent.session);
        const described = await this.inspectNode(owner.backendNodeId, parent, group);
        path.unshift(described.selector);
        target.structural ||= described.structural;
        child = parent;
      }
      if (this.state !== pending) return;
      await this.validate(target.selector, path);
      if (this.state === pending)
        this.state = {
          requestId: state.requestId,
          phase: 'selected',
          target: { ...target, framePath: path },
        };
    } catch (e) {
      if (this.state === pending)
        this.state = {
          requestId: state.requestId,
          phase: 'error',
          error: e instanceof Error ? e.message : '拾取失败，请重试',
        };
    } finally {
      clearTimeout(timeout);
      await Promise.all(
        [undefined, ...new Set(this.sessions.values())].map((s) =>
          this.send('Runtime.releaseObjectGroup', { objectGroup: group }, s).catch(() => {}),
        ),
      );
    }
  }
  dispose() {
    clearTimeout(this.timer);
    if (this.state) this.state = { requestId: this.state.requestId, phase: 'cancelled' };
  }
}
