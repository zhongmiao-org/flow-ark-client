import type { MouseInputEvent, WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { BrowserCommand } from '../shared/types';
import { commandBudget } from './browser-scope';
import { framePathOf, validateFormCommand, formKeys } from '../core/browser-command';
import { EmbeddedPicker } from './embedded-picker';
import { describeElement } from './element-description';
import type { PointIdentity } from './embedded-point-target';
import type { ElementTarget } from '../shared/element-picker';
import type { ObservationPan } from '../shared/browser-observation';
import { resolvedBrowserFields, assertBrowserFieldsResult } from '../shared/browser-fields';
import { readBrowserFields } from './browser-fields-dom';
import { readBrowserRenderedFields } from './browser-rendered-fields-dom';
import { browserTargetDOM } from './browser-target-dom';
import { resolvedBrowserTarget, assertBrowserTargetResult } from '../shared/browser-target';
import {
  renderingDiagnosticDataSchema,
  type RenderingInspectionRequest,
} from '../shared/browser-rendering-diagnostics';
import { describeFieldsPick } from './browser-field-picking-dom';
import {
  fieldsPickCandidateSchema,
  type FieldsPickCandidate,
  type FieldsPickRoot,
  type FieldsPickScope,
} from '../shared/browser-field-picking';
export type FieldsRootAnchor = {
  root: FieldsPickRoot;
  point: PointIdentity;
  document: number;
  epoch: number;
};
type Scope = {
  context: number;
  session?: string;
  x: number;
  y: number;
  ancestors: { scope: Scope; selector: string }[];
};
const query = `(selector) => {
  const roots = [document]; const found = [];
  for (const root of roots) { found.push(...root.querySelectorAll(selector)); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot); }
  if (found.length > 1) throw new Error('选择器匹配多个元素');
  return found[0] || null;
}`;
/** CDP transport is restricted to one unprivileged website WebContents, never the workbench. */
export class EmbeddedPage {
  readonly picker: EmbeddedPicker;
  private abort = new AbortController();
  private frames = new Map<string, string>();
  private documentEpoch = 0;
  private targetWatches = new Set<(frameId?: string) => void>();
  private navigationStarted = (details: { isMainFrame: boolean }) => {
    this.documentEpoch++;
    if (details.isMainFrame) this.invalidateTarget();
  };
  constructor(
    readonly contents: WebContents,
    coordinates: (mouse: MouseInputEvent) => { x: number; y: number },
  ) {
    contents.debugger.attach('1.3');
    contents.on('did-start-navigation', this.navigationStarted);
    this.picker = new EmbeddedPicker(
      contents,
      (m, p, s) => this.send(m, p, s),
      this.frames,
      (selector, path, expected) => this.inspectTarget(selector, path, false, expected),
      coordinates,
    );
    contents.debugger.on('message', (_event, method, params) => {
      if (
        [
          'Page.frameRequestedNavigation',
          'Page.frameStartedLoading',
          'Page.frameNavigated',
          'Page.frameDetached',
          'Target.attachedToTarget',
          'Target.detachedFromTarget',
        ].includes(method)
      )
        this.documentEpoch++;
      if (
        [
          'Page.frameRequestedNavigation',
          'Page.frameStartedLoading',
          'Page.frameNavigated',
          'Page.frameDetached',
          'Page.navigatedWithinDocument',
        ].includes(method)
      ) {
        const frameId = params.frameId ?? params.frame?.id;
        if (typeof frameId === 'string') this.invalidateTarget(frameId);
      }
      if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
        this.invalidateTarget(params.targetInfo.targetId);
        this.frames.set(params.targetInfo.targetId, params.sessionId);
        void this.send('Page.enable', {}, params.sessionId).catch(() => {});
        void this.send(
          'Target.setAutoAttach',
          { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
          params.sessionId,
        ).catch(() => {});
      }
      if (method === 'Target.detachedFromTarget') {
        for (const [id, session] of this.frames)
          if (session === params.sessionId) {
            this.invalidateTarget(id);
            this.frames.delete(id);
          }
      }
    });
    contents.once('destroyed', () => this.abort.abort(new Error('网页会话已关闭')));
  }
  private invalidateTarget(frameId?: string) {
    for (const notify of this.targetWatches) notify(frameId);
  }
  private async send(method: string, params: any = {}, session?: string) {
    // Disposal must reject like transport failure so best-effort cleanup can catch it.
    this.abort.signal.throwIfAborted();
    return this.contents.debugger.sendCommand(method, params, session);
  }
  async initialize() {
    await this.send('Page.enable');
    await this.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
  }
  async observationScale(scale: number) {
    this.abort.signal.throwIfAborted();
    await this.contents.setVisualZoomLevelLimits(scale, scale);
    await this.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
    const { cssVisualViewport } = await this.send('Page.getLayoutMetrics');
    if (!cssVisualViewport || Math.abs(cssVisualViewport.scale - scale) > 0.01)
      throw new Error('网页显示比例尚未确认，请重新选择查看模式');
    return this.contents.getZoomFactor() * cssVisualViewport.scale * 100;
  }
  async panObservation(direction: ObservationPan['direction']) {
    const { cssVisualViewport: before } = await this.send('Page.getLayoutMetrics');
    if (!before || before.scale <= 1) throw new Error('请先切换为原字号查看');
    const horizontal = direction === 'left' || direction === 'right';
    const distance = Math.min(300, (horizontal ? before.clientWidth : before.clientHeight) / 2);
    // Gesture coordinates are visible CSS points, without the visual offset.
    // A short touch scroll moves the visual viewport without replaying clicks.
    await this.send('Input.synthesizeScrollGesture', {
      x: before.clientWidth / 2,
      y: Math.min(24, before.clientHeight / 2),
      xDistance: horizontal ? distance * (direction === 'left' ? 1 : -1) : 0,
      yDistance: horizontal ? 0 : distance * (direction === 'up' ? 1 : -1),
      gestureSourceType: 'touch',
      preventFling: true,
      speed: 1200,
    });
    const { cssVisualViewport: after } = await this.send('Page.getLayoutMetrics');
    if (!after || Math.abs(after.scale - before.scale) > 0.01)
      throw new Error('网页显示比例已改变，请重新选择查看模式');
    return this.contents.getZoomFactor() * after.scale * 100;
  }
  private async evaluate(scope: Scope, expression: string, byValue = true) {
    const result = await this.send(
      'Runtime.evaluate',
      {
        expression,
        contextId: scope.context,
        returnByValue: byValue,
        awaitPromise: true,
        userGesture: true,
      },
      scope.session,
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          '网页操作失败',
      );
    return byValue ? result.result.value : result.result;
  }
  private async world(frameId: string, session?: string): Promise<Scope> {
    const result = await this.send(
      'Page.createIsolatedWorld',
      { frameId, worldName: 'flowark-browser-driver', grantUniveralAccess: false },
      session,
    );
    return { context: result.executionContextId, session, x: 0, y: 0, ancestors: [] };
  }
  private async element(scope: Scope, selector: string, remaining: () => number) {
    while (true) {
      remaining();
      this.abort.signal.throwIfAborted();
      const element = await this.evaluate(scope, `(${query})(${JSON.stringify(selector)})`, false);
      if (element.objectId && element.subtype !== 'null') return element.objectId as string;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining())));
    }
  }
  private async call(scope: Scope, objectId: string, fn: string, ...values: any[]) {
    const result = await this.send(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration: fn,
        arguments: values.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      },
      scope.session,
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          '网页操作失败',
      );
    return result.result.value;
  }
  private async scope(path: string[], remaining: () => number, scroll = true) {
    const { frameTree } = await this.send('Page.getFrameTree');
    let scope = await this.world(frameTree.frame.id);
    for (const selector of path) {
      const parent = scope;
      const element = await this.element(scope, selector, remaining);
      try {
        const box = await this.call(
          scope,
          element,
          `function(scroll) { if(scroll) this.scrollIntoView({block:'center',inline:'center',behavior:'instant'}); const r=this.getBoundingClientRect(); return {x:r.x+this.clientLeft,y:r.y+this.clientTop}; }`,
          scroll,
        );
        const { node } = await this.send('DOM.describeNode', { objectId: element }, scope.session);
        if (!node.frameId) throw new Error('目标不是可用框架：' + selector);
        const next = await this.world(node.frameId, this.frames.get(node.frameId) ?? scope.session);
        next.ancestors = [...scope.ancestors, { scope, selector }];
        next.x = scope.x + box.x;
        next.y = scope.y + box.y;
        scope = next;
      } finally {
        await this.send('Runtime.releaseObject', { objectId: element }, parent.session).catch(
          () => {},
        );
      }
    }
    return scope;
  }
  private async visible(
    scope: Scope,
    objectId: string,
    remaining: () => number,
    enabled = false,
    scroll = true,
  ) {
    while (true) {
      remaining();
      const box = await this.call(
        scope,
        objectId,
        `function(enabled, scroll) {
        if (!this.isConnected) throw new Error('目标元素已离开页面');
        if(scroll) this.scrollIntoView({block:'center', inline:'center', behavior:'instant'});
        const r=this.getBoundingClientRect(), s=getComputedStyle(this);
        if (!r.width || !r.height || s.visibility==='hidden' || s.display==='none' || (enabled && this.matches(':disabled'))) return null;
        const x=r.x+r.width/2,y=r.y+r.height/2;
        return {x,y};
      }`,
        enabled,
        scroll,
      );
      if (box) return box;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining())));
    }
  }
  private async pointerGuard(scope: Scope, objectId: string, selector?: string) {
    const result = await this.send(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration: `function() {
        const target=this, state={hovered:false,pressed:false,blocked:false};
        const listen=e=>{
          if(!e.isTrusted) return;
          let unique=true;
          ${selector ? `try { unique=(${browserTargetDOM.toString()})({selector:${JSON.stringify(selector)},expected:target,mode:'check'}).visible; } catch { unique=false; }` : ''}
          const hit=unique && target.isConnected && !target.matches(':disabled') && e.composedPath().includes(target);
          if(e.type==='mousemove') { state.hovered=hit; return; }
          if(!hit) { state.blocked=true; e.preventDefault(); e.stopImmediatePropagation(); }
          else if(e.type==='mousedown') state.pressed=true;
        };
        const types=['mousemove','mousedown','mouseup','click'];
        for(const type of types) window.addEventListener(type,listen,true);
        return {
          reset(){state.hovered=false;},
          read(){return {...state};},
          dispose(){for(const type of types) window.removeEventListener(type,listen,true);}
        };
      }`,
        returnByValue: false,
      },
      scope.session,
    );
    if (result.exceptionDetails || !result.result.objectId) throw new Error('无法核对点击目标');
    return result.result.objectId as string;
  }
  private async pointerPoint(scope: Scope, objectId: string) {
    const box = await this.call(
      scope,
      objectId,
      `function() {
        if (!this.isConnected || this.matches(':disabled')) throw new Error('点击目标已失效');
        const r=this.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
        const hit=this.getRootNode().elementFromPoint(x,y);
        if (!r.width || !r.height || (hit!==this && !this.contains(hit))) throw new Error('点击目标被其他元素遮挡');
        return {x,y};
      }`,
    );
    let x = box.x,
      y = box.y;
    // Child scrolling can move every ancestor viewport; measure after scrollIntoView.
    for (const ancestor of [...scope.ancestors].reverse()) {
      const offset = await this.evaluate(
        ancestor.scope,
        `(() => {
          const el=(${query})(${JSON.stringify(ancestor.selector)}); if(!el) throw new Error('框架已离开页面');
          const r=el.getBoundingClientRect(), x=r.x+el.clientLeft, y=r.y+el.clientTop;
          if(el.getRootNode().elementFromPoint(x+${x},y+${y})!==el) throw new Error('点击框架被其他元素遮挡');
          return {x,y};
        })()`,
      );
      x += offset.x;
      y += offset.y;
    }
    const viewport = await this.evaluate(
      scope.ancestors[0]?.scope ?? scope,
      '({x:visualViewport.offsetLeft,y:visualViewport.offsetTop})',
    );
    // CDP pointer input is in CSS pixels relative to the visual viewport.
    // Rectangles above use the layout viewport; native and visual zoom do not
    // require another multiplication, but observation panning adds this offset.
    return { x: x - viewport.x, y: y - viewport.y };
  }
  private async click(
    scope: Scope,
    objectId: string,
    remaining: () => number,
    beforePress?: () => Promise<void>,
    selector?: string,
  ) {
    await this.visible(scope, objectId, remaining, true);
    const guard = await this.pointerGuard(scope, objectId, selector);
    let navigated = false;
    const navigation = () => {
      navigated = true;
    };
    this.contents.on('did-start-navigation', navigation);
    try {
      let point: { x: number; y: number };
      for (;;) {
        remaining();
        await beforePress?.();
        point = await this.pointerPoint(scope, objectId);
        await this.call(scope, guard, 'function(){this.reset();}');
        // A trusted hover proves that Chromium has routed input into the target
        // frame after scrolling. Unlike rAF, this works in hidden native views.
        // Only moves repeat; a press/release is never retried.
        await this.send('Input.dispatchMouseEvent', { ...point, type: 'mouseMoved' });
        const state = await this.call(scope, guard, 'function(){return this.read();}');
        if (state.hovered) {
          const current = await this.pointerPoint(scope, objectId);
          if (Math.abs(current.x - point.x) < 0.5 && Math.abs(current.y - point.y) < 0.5) break;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(20, remaining())));
      }
      remaining();
      await beforePress?.();
      const input = { ...point, button: 'left', clickCount: 1 };
      await this.send('Input.dispatchMouseEvent', { ...input, type: 'mousePressed' });
      await this.send('Input.dispatchMouseEvent', { ...input, type: 'mouseReleased' });
      let state;
      try {
        state = await this.call(scope, guard, 'function(){return this.read();}');
      } catch (error) {
        if (!navigated) throw error;
      }
      if (state && (state.blocked || !state.pressed))
        throw new Error('点击期间目标发生变化，未确认点击结果');
    } finally {
      this.contents.removeListener('did-start-navigation', navigation);
      await this.call(scope, guard, 'function(){this.dispose();}').catch(() => {});
      await this.send('Runtime.releaseObject', { objectId: guard }, scope.session).catch(() => {});
    }
  }

  async perform(command: BrowserCommand): Promise<any> {
    validateFormCommand(command);
    const path = framePathOf(command),
      remaining = commandBudget(
        command.version === 9 ? Math.min(command.timeoutMs ?? 15000, 15000) : command.timeoutMs,
      );
    this.abort.signal.throwIfAborted();
    if (command.version === 8) return this.target(command, path, remaining);
    if (command.operation === 'collect') return this.collect(command, path, remaining);
    if (command.operation === 'navigate') {
      const url = new URL(String(command.value));
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('只支持 HTTP(S) 网页');
      await this.contents.loadURL(url.href);
      return { url: this.contents.getURL(), title: this.contents.getTitle() };
    }
    if (command.operation === 'url') return this.contents.getURL();
    if (command.operation === 'screenshot') {
      const image = await this.contents.capturePage(undefined, {
        stayHidden: false,
        stayAwake: true,
      });
      this.abort.signal.throwIfAborted();
      if (image.isEmpty()) throw new Error('网页截图为空');
      await writeFile(String(command.value), image.toPNG(), { mode: 0o600 });
      return true;
    }
    const scope = await this.scope(path, remaining),
      selector = command.selector || 'body';
    if (command.operation === 'count')
      return this.evaluate(scope, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
    const element = await this.element(scope, selector, remaining);
    try {
      switch (command.operation) {
        case 'read':
          return this.call(scope, element, 'function(){ return this.innerText; }');
        case 'attribute':
          return this.call(
            scope,
            element,
            'function(name){ return this.getAttribute(name); }',
            String(command.value),
          );
        case 'inputValue':
          return this.call(
            scope,
            element,
            `function(){ if (!['INPUT','TEXTAREA','SELECT'].includes(this.tagName)) throw new Error('目标没有输入值'); return this.value; }`,
          );
        case 'wait':
          await this.visible(scope, element, remaining);
          return true;
        case 'click':
          await this.click(scope, element, remaining);
          return { clicked: true, verified: false };
        case 'check': {
          await this.visible(scope, element, remaining, true);
          const current = await this.call(
            scope,
            element,
            `function(value){ if (this.tagName!=='INPUT' || !['checkbox','radio'].includes(this.type) || (this.type==='radio' && !value)) throw new Error('check 仅支持原生 checkbox 或选中 radio'); return this.checked; }`,
            command.value,
          );
          if (current !== command.value) await this.click(scope, element, remaining);
          const checked = await this.call(scope, element, 'function(){return this.checked;}');
          if (checked !== command.value) throw new Error('勾选结果与目标状态不一致');
          return { checked };
        }
        case 'select': {
          await this.visible(scope, element, remaining, true);
          const values = typeof command.value === 'string' ? [command.value] : command.value;
          while (true) {
            remaining();
            const selected = await this.call(
              scope,
              element,
              `function(values){
              if (this.tagName!=='SELECT') throw new Error('select 仅支持原生下拉框');
              if (!this.multiple && values.length!==1) throw new Error('单选必须指定一个选项');
              const options=[...this.options];
              for (const value of values) { const found=options.filter(o=>o.value===value); if(found.length>1) throw new Error('下拉选项值不唯一'); if(found[0]?.disabled || found[0]?.parentElement?.disabled) throw new Error('下拉选项已禁用'); }
              if (!values.every(v=>options.some(o=>o.value===v))) return null;
              for(const option of options) option.selected=values.includes(option.value);
              this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));
              return [...this.selectedOptions].map(o=>o.value);
            }`,
              values,
            );
            if (selected) {
              if (JSON.stringify([...selected].sort()) !== JSON.stringify([...values].sort()))
                throw new Error('下拉选择结果与目标不一致');
              return selected;
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining())));
          }
        }
        case 'fill': {
          await this.visible(scope, element, remaining, true);
          const native = await this.call(
            scope,
            element,
            `function(value){
            if(this.readOnly) throw new Error('输入框为只读');
            if (this instanceof HTMLInputElement && ['date','time','datetime-local','month','week','color','range'].includes(this.type)) {
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(this,value);
              if(this.value!==value) throw new Error('输入值不符合控件格式');
              this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true})); return false;
            }
            this.focus();
            if(this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) { if(['checkbox','radio','file','button','submit','reset'].includes(this.type)) throw new Error('目标不能填写文本'); this.select(); }
            else if(this.isContentEditable) { const r=document.createRange(); r.selectNodeContents(this); const s=window.getSelection();s.removeAllRanges();s.addRange(r); }
            else throw new Error('目标不是可编辑输入框');
            return true;
          }`,
            String(command.value),
          );
          if (native) await this.send('Input.insertText', { text: String(command.value) });
          return { filled: true };
        }
        case 'press': {
          await this.visible(scope, element, remaining, true);
          await this.call(scope, element, 'function(){this.focus();}');
          const key = command.value as (typeof formKeys)[number];
          const codes: Record<string, number> = {
            ArrowLeft: 37,
            ArrowUp: 38,
            ArrowRight: 39,
            ArrowDown: 40,
            Home: 36,
            End: 35,
            Tab: 9,
            Enter: 13,
            Escape: 27,
            Space: 32,
            Backspace: 8,
            Delete: 46,
          };
          const actual = key === 'Space' ? ' ' : key;
          await this.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: actual,
            code: key,
            windowsVirtualKeyCode: codes[key],
            ...(key === 'Enter' ? { text: '\r' } : key === 'Space' ? { text: ' ' } : {}),
          });
          await this.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: actual,
            code: key,
            windowsVirtualKeyCode: codes[key],
          });
          return { pressed: true };
        }
        case 'upload':
          await this.send(
            'DOM.setFileInputFiles',
            { objectId: element, files: [String(command.value)] },
            scope.session,
          );
          return { selected: true, verified: false };
        default:
          throw new Error('浏览器不支持此操作');
      }
    } finally {
      await this.send('Runtime.releaseObject', { objectId: element }, scope.session).catch(
        () => {},
      );
    }
  }
  private async target(command: BrowserCommand, path: string[], remaining: () => number) {
    const input = resolvedBrowserTarget(command);
    // Observe from command entry, including changes before a child world is created.
    // Only the root document and the frames used by this fixed path can invalidate it.
    const changedFrames = new Set<string>(),
      usedFrames = new Set<string>();
    let rootChanged = false;
    const changed = (frameId?: string) => {
      if (frameId === undefined) rootChanged = true;
      else changedFrames.add(frameId);
    };
    this.targetWatches.add(changed);
    const handles: { scope: Scope; objectId: string }[] = [];
    const chain: { scope: Scope; objectId: string; selector: string }[] = [];
    const verify = () => {
      remaining();
      this.abort.signal.throwIfAborted();
      if (
        this.contents.isDestroyed() ||
        rootChanged ||
        [...usedFrames].some((id) => changedFrames.has(id))
      )
        throw Error('网页或框架在派发前已变化，未重新定位');
    };
    const state = async (item: (typeof chain)[number], read = false) => {
      verify();
      const result = await this.call(
        item.scope,
        item.objectId,
        `function(selector,mode){return (${browserTargetDOM.toString()})({selector,mode,expected:this});}`,
        item.selector,
        read ? 'read' : 'check',
      );
      verify();
      if (!result || typeof result.visible !== 'boolean') throw Error('网页目标状态不可核对');
      return result as { visible: boolean; text?: string };
    };
    const bind = async (scope: Scope, selector: string) => {
      for (;;) {
        verify();
        const object = await this.evaluate(
          scope,
          `(${browserTargetDOM.toString()})(${JSON.stringify({ selector, mode: 'bind' })})`,
          false,
        );
        if (object.objectId && object.subtype !== 'null') {
          const item = { scope, objectId: object.objectId as string, selector };
          handles.push(item);
          return item;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining())));
      }
    };
    const checkChain = async () => {
      for (const item of chain) if (!(await state(item)).visible) throw Error('已绑定框架不再可见');
    };
    const visible = async (item: (typeof chain)[number]) => {
      for (;;) {
        await checkChain();
        if ((await state(item)).visible) return;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining())));
      }
    };
    try {
      verify();
      const { frameTree } = await this.send('Page.getFrameTree');
      usedFrames.add(frameTree.frame.id);
      verify();
      let scope = await this.world(frameTree.frame.id);
      verify();
      for (const selector of path) {
        const item = await bind(scope, selector);
        await visible(item);
        const { node } = await this.send(
          'DOM.describeNode',
          { objectId: item.objectId },
          scope.session,
        );
        verify();
        if (!node.frameId) throw Error('目标不是可用框架');
        usedFrames.add(node.frameId);
        verify();
        const next = await this.world(node.frameId, this.frames.get(node.frameId) ?? scope.session);
        verify();
        next.ancestors = [...scope.ancestors, { scope, selector }];
        chain.push(item);
        scope = next;
      }
      const item = await bind(scope, input.selector);
      await visible(item);
      let result: unknown;
      if (input.operation === 'click') {
        await this.click(
          scope,
          item.objectId,
          remaining,
          async () => {
            await checkChain();
            if (!(await state(item)).visible) throw Error('点击目标不再可见');
          },
          input.selector,
        );
        result = { clicked: true, verified: false };
      } else if (input.operation === 'read') {
        await checkChain();
        const value = await state(item, true);
        if (!value.visible) throw Error('读取目标不再可见');
        result = value.text;
      } else {
        await checkChain();
        if (!(await state(item)).visible) throw Error('等待目标不再可见');
        result = true;
      }
      assertBrowserTargetResult(input.operation, result);
      return result;
    } finally {
      this.targetWatches.delete(changed);
      await Promise.all(
        handles.map(({ scope, objectId }) =>
          this.send('Runtime.releaseObject', { objectId }, scope.session).catch(() => {}),
        ),
      );
    }
  }
  private async collect(command: BrowserCommand, path: string[], remaining: () => number) {
    const node = resolvedBrowserFields({
      id: 'driver',
      type: 'browser',
      version: command.version ?? 5,
      ...(command.version === 9 ? { renderPolicy: command.renderPolicy } : {}),
      operation: 'collect',
      selector: command.selector,
      framePath: path,
      fields: command.fields,
    });
    if (this.contents.isLoading()) throw Error('网页正在加载，关联采集未开始');
    const epoch = this.documentEpoch,
      url = this.contents.getURL();
    const verify = () => {
      remaining();
      this.abort.signal.throwIfAborted();
      if (
        this.documentEpoch !== epoch ||
        this.contents.getURL() !== url ||
        this.contents.isLoading()
      )
        throw Error('采集期间网页或框架发生导航/更换，整次结果未采用');
    };
    const { frameTree } = await this.send('Page.getFrameTree');
    let frameId: string = frameTree.frame.id,
      session: string | undefined;
    let scope = await this.world(frameId, session);
    const chain: { scope: Scope; frameId: string; loaderId: string }[] = [];
    const remember = async () => {
      const { frameTree } = await this.send('Page.getFrameTree', {}, scope.session);
      const find = (tree: any): any =>
        tree.frame.id === frameId ? tree.frame : (tree.childFrames ?? []).map(find).find(Boolean);
      const frame = find(frameTree);
      if (!frame?.loaderId) throw Error('无法核对采集框架文档身份');
      chain.push({ scope, frameId, loaderId: frame.loaderId });
    };
    await remember();
    for (const selector of path) {
      verify();
      const parent = scope;
      const handle = await this.evaluate(
        scope,
        `(()=>{const found=document.querySelectorAll(${JSON.stringify(selector)});if(found.length!==1||found[0].tagName!=='IFRAME')throw Error('采集框架须唯一匹配 iframe');return found[0];})()`,
        false,
      );
      if (!handle.objectId) throw Error('采集框架不可用');
      try {
        const { node: element } = await this.send(
          'DOM.describeNode',
          { objectId: handle.objectId },
          scope.session,
        );
        if (!element.frameId) throw Error('采集框架不可用');
        frameId = element.frameId;
        session = this.frames.get(frameId) ?? scope.session;
        scope = await this.world(frameId, session);
        await remember();
      } finally {
        await this.send(
          'Runtime.releaseObject',
          { objectId: handle.objectId },
          parent.session,
        ).catch(() => {});
      }
    }
    verify();
    const result = await this.evaluate(
      scope,
      `(${(node.version >= 6 ? readBrowserRenderedFields : readBrowserFields).toString()})(${JSON.stringify({ selector: node.selector, fields: node.fields, framePath: path, url, renderPolicy: node.version === 9 ? 'bounded-selection-text-v1' : node.version === 7 ? 'bounded-rendered-text-v2' : 'bounded-rendered-text-v1' })})`,
    );
    for (const prior of chain) {
      const { frameTree } = await this.send('Page.getFrameTree', {}, prior.scope.session);
      const find = (tree: any): any =>
        tree.frame.id === prior.frameId
          ? tree.frame
          : (tree.childFrames ?? []).map(find).find(Boolean);
      if (find(frameTree)?.loaderId !== prior.loaderId)
        throw Error('采集框架文档已更换，整次结果未采用');
      await this.evaluate(prior.scope, 'document.readyState');
    }
    verify();
    assertBrowserFieldsResult(node, result);
    return result;
  }
  private async revealTarget(scope: Scope, element: string) {
    const root = scope.ancestors[0]?.scope ?? scope;
    const viewport = await this.evaluate(
      root,
      '({width:visualViewport.width,height:visualViewport.height})',
    );
    const region = await this.call(
      scope,
      element,
      `function(width, height) {
        const box=this.getBoundingClientRect();
        let content=box;
        if(this.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
          const range=document.createRange(); range.selectNodeContents(this);
          const text=range.getBoundingClientRect();
          if(text.width && text.height) content=text;
        }
        return {
          x:Math.max(0,content.x-box.x), y:Math.max(0,content.y-box.y),
          width:Math.max(1,Math.min(content.width,width-4,innerWidth-4)),
          height:Math.max(1,Math.min(content.height,height-4,innerHeight-4))
        };
      }`,
      viewport.width,
      viewport.height,
    );
    // A wide block's center can be blank at native text size. Ask Chromium to
    // reveal the content region, including its visual viewport and frame chain.
    await this.send(
      'DOM.scrollIntoViewIfNeeded',
      { objectId: element, rect: region },
      scope.session,
    );
    const box = await this.call(
      scope,
      element,
      `function(region) {
        if(!this.isConnected) throw new Error('目标元素已离开页面');
        const r=this.getBoundingClientRect();
        return {x:r.x+region.x,y:r.y+region.y,width:region.width,height:region.height};
      }`,
      region,
    );
    const fits = (bounds: { x: number; y: number; width: number; height: number }) =>
      box.x >= bounds.x - 2 &&
      box.y >= bounds.y - 2 &&
      box.x + box.width <= bounds.x + bounds.width + 2 &&
      box.y + box.height <= bounds.y + bounds.height + 2;
    for (const ancestor of [...scope.ancestors].reverse()) {
      const frame = await this.evaluate(
        ancestor.scope,
        `(() => {
          const el=(${query})(${JSON.stringify(ancestor.selector)});
          if(!el) throw new Error('框架已离开页面');
          const r=el.getBoundingClientRect();
          return {x:r.x+el.clientLeft,y:r.y+el.clientTop,width:el.clientWidth,height:el.clientHeight};
        })()`,
      );
      if (!fits({ x: 0, y: 0, width: frame.width, height: frame.height }))
        throw new Error('目标尚未完整进入框架可见区域，请重新聚焦');
      box.x += frame.x;
      box.y += frame.y;
    }
    const visible = await this.evaluate(
      root,
      '({x:visualViewport.offsetLeft,y:visualViewport.offsetTop,width:visualViewport.width,height:visualViewport.height})',
    );
    if (!fits(visible)) throw new Error('目标尚未进入原字号可见区域，请重新聚焦');
  }
  private async fieldsElement(scope: Scope, selector: string, rootSelector?: string) {
    const value = await this.evaluate(
      scope,
      `(() => {
        let root=document;
        const rootSelector=${JSON.stringify(rootSelector ?? null)};
        if(rootSelector!==null){
          const roots=document.querySelectorAll(rootSelector);
          if(roots.length!==1) throw Error('采集根元素须唯一匹配，实际匹配 '+roots.length+' 项');
          root=roots[0];
        }
        const found=root.querySelectorAll(${JSON.stringify(selector)});
        if(found.length!==1) throw Error('定位须唯一匹配，实际匹配 '+found.length+' 项');
        return found[0];
      })()`,
      false,
    );
    if (!value.objectId) throw Error('目标元素已离开页面');
    return value.objectId as string;
  }
  private async fieldsPoint(scope: Scope, objectId: string): Promise<PointIdentity> {
    const { node } = await this.send('DOM.describeNode', { objectId }, scope.session);
    return { backendNodeId: node.backendNodeId, session: scope.session };
  }
  private async fieldsDocument(scope: Scope) {
    const value = await this.evaluate(scope, 'document', false);
    try {
      const point = await this.fieldsPoint(scope, value.objectId);
      return point.backendNodeId;
    } finally {
      await this.send('Runtime.releaseObject', { objectId: value.objectId }, scope.session).catch(
        () => {},
      );
    }
  }
  private sameFieldsPoint(a: PointIdentity, b: PointIdentity) {
    return a.backendNodeId === b.backendNodeId && a.session === b.session;
  }
  async captureFieldsRoot(root: FieldsPickRoot): Promise<FieldsRootAnchor> {
    const epoch = this.documentEpoch;
    const scope = await this.scope(root.framePath, commandBudget(3000), false);
    const element = await this.fieldsElement(scope, root.selector);
    try {
      const point = await this.fieldsPoint(scope, element);
      const document = await this.fieldsDocument(scope);
      if (epoch !== this.documentEpoch) throw Error('网页或框架已变化，请重新验证根');
      return { root: structuredClone(root), point, document, epoch };
    } finally {
      await this.send('Runtime.releaseObject', { objectId: element }, scope.session).catch(
        () => {},
      );
    }
  }
  async verifyFieldsRoot(anchor: FieldsRootAnchor) {
    if (anchor.epoch !== this.documentEpoch) throw Error('网页或框架已变化，请重新验证根');
    const current = await this.captureFieldsRoot(anchor.root);
    if (
      current.epoch !== anchor.epoch ||
      current.document !== anchor.document ||
      !this.sameFieldsPoint(current.point, anchor.point)
    )
      throw Error('原根元素已被替换，请重新验证根');
  }
  /** Strict Document/Element selectors, exactly as collect uses; never pierces ShadowRoot. */
  async describeFieldsSelection(
    target: ElementTarget,
    expected: PointIdentity,
    picking: FieldsPickScope,
    anchor?: FieldsRootAnchor,
  ): Promise<FieldsPickCandidate> {
    const epoch = this.documentEpoch;
    if (picking.kind === 'field') {
      if (!anchor || JSON.stringify(anchor.root) !== JSON.stringify(picking.root))
        throw Error('根定位来源未固定，请重新选取');
      if (JSON.stringify(target.framePath) !== JSON.stringify(picking.root.framePath))
        throw Error('字段目标不在原根的框架内，请重新选取');
      await this.verifyFieldsRoot(anchor);
    }
    const scope = await this.scope(target.framePath, commandBudget(3000), false);
    const document = await this.fieldsDocument(scope);
    const element = await this.fieldsElement(scope, target.selector);
    try {
      if (!this.sameFieldsPoint(await this.fieldsPoint(scope, element), expected))
        throw Error('原目标已被替换，请重新选取');
      const info = await this.call(scope, element, describeFieldsPick.toString(), {
        rootSelector: picking.kind === 'field' ? picking.root.selector : null,
        selector: picking.kind === 'root' ? target.selector : null,
      });
      const again = await this.fieldsElement(scope, target.selector);
      try {
        if (!this.sameFieldsPoint(await this.fieldsPoint(scope, again), expected))
          throw Error('原目标已被替换，请重新选取');
      } finally {
        await this.send('Runtime.releaseObject', { objectId: again }, scope.session).catch(
          () => {},
        );
      }
      if (picking.kind === 'field') await this.verifyFieldsRoot(anchor!);
      if (epoch !== this.documentEpoch || document !== (await this.fieldsDocument(scope)))
        throw Error('网页或框架已变化，请重新选取');
      return fieldsPickCandidateSchema.parse({
        version: 1,
        kind: picking.kind,
        root:
          picking.kind === 'field'
            ? picking.root
            : { selector: target.selector, framePath: target.framePath },
        field: picking.kind === 'field' ? { selector: info.selector } : null,
        label: info.label,
        tag: info.tag,
        structural: info.structural || target.structural,
      });
    } finally {
      await this.send('Runtime.releaseObject', { objectId: element }, scope.session).catch(
        () => {},
      );
    }
  }
  async validateFieldsTarget(
    picking: FieldsPickScope,
    selector: string,
    path: string[],
  ): Promise<FieldsPickCandidate> {
    const epoch = this.documentEpoch;
    const anchor =
      picking.kind === 'field' ? await this.captureFieldsRoot(picking.root) : undefined;
    if (picking.kind === 'field' && JSON.stringify(path) !== JSON.stringify(picking.root.framePath))
      throw Error('字段验证不能更换根的框架路径');
    const scope = await this.scope(path, commandBudget(3000), false);
    const document = await this.fieldsDocument(scope);
    const element = await this.fieldsElement(
      scope,
      selector,
      picking.kind === 'field' ? picking.root.selector : undefined,
    );
    try {
      const point = await this.fieldsPoint(scope, element);
      const info = await this.call(scope, element, describeFieldsPick.toString(), {
        rootSelector: picking.kind === 'field' ? picking.root.selector : null,
        selector,
      });
      const again = await this.fieldsElement(
        scope,
        selector,
        picking.kind === 'field' ? picking.root.selector : undefined,
      );
      try {
        if (!this.sameFieldsPoint(await this.fieldsPoint(scope, again), point))
          throw Error('验证期间目标已被替换，请重新验证');
      } finally {
        await this.send('Runtime.releaseObject', { objectId: again }, scope.session).catch(
          () => {},
        );
      }
      if (anchor) await this.verifyFieldsRoot(anchor);
      if (epoch !== this.documentEpoch || document !== (await this.fieldsDocument(scope)))
        throw Error('验证期间网页或框架已变化，请重新验证');
      return fieldsPickCandidateSchema.parse({
        version: 1,
        kind: picking.kind,
        root: picking.kind === 'root' ? { selector, framePath: path } : picking.root,
        field: picking.kind === 'field' ? { selector } : null,
        label: info.label,
        tag: info.tag,
        structural: info.structural,
      });
    } finally {
      await this.send('Runtime.releaseObject', { objectId: element }, scope.session).catch(
        () => {},
      );
    }
  }
  async inspectFieldsRendering(request: RenderingInspectionRequest) {
    const epoch = this.documentEpoch;
    const anchor = await this.captureFieldsRoot(request.root);
    const scope = await this.scope(request.root.framePath, commandBudget(3000), false);
    const document = await this.fieldsDocument(scope);
    const element = await this.fieldsElement(scope, request.selector, request.root.selector);
    try {
      const point = await this.fieldsPoint(scope, element);
      const data = renderingDiagnosticDataSchema.parse(
        await this.call(
          scope,
          element,
          `function(input) { return (${readBrowserRenderedFields.toString()})({ ...input, diagnosticsOnly: true, diagnosticTarget: this }); }`,
          {
            selector: request.root.selector,
            diagnosticSelector: request.selector,
            framePath: request.root.framePath,
            fields: [],
            url: '',
            renderPolicy: request.policy ?? 'bounded-rendered-text-v1',
            diagnosticDetails: request.details,
          },
        ),
      );
      const again = await this.fieldsElement(scope, request.selector, request.root.selector);
      try {
        if (!this.sameFieldsPoint(await this.fieldsPoint(scope, again), point))
          throw Error('诊断期间目标已被替换，请重新检查');
      } finally {
        await this.send('Runtime.releaseObject', { objectId: again }, scope.session).catch(
          () => {},
        );
      }
      await this.verifyFieldsRoot(anchor);
      if (epoch !== this.documentEpoch || document !== (await this.fieldsDocument(scope)))
        throw Error('诊断期间网页或框架已变化，请重新检查');
      return data;
    } finally {
      await this.send('Runtime.releaseObject', { objectId: element }, scope.session).catch(
        () => {},
      );
    }
  }
  async inspectTarget(
    selector: string,
    path: string[],
    highlight = true,
    expected?: PointIdentity,
    reveal = false,
  ): Promise<ElementTarget> {
    const scope = await this.scope(path, commandBudget(3000), !expected);
    const element = await this.element(scope, selector, commandBudget(3000));
    try {
      if (expected) {
        const { node } = await this.send('DOM.describeNode', { objectId: element }, scope.session);
        if (node.backendNodeId !== expected.backendNodeId || scope.session !== expected.session)
          throw new Error('目标在选取期间已被替换，请重新选取');
      }
      await this.visible(scope, element, commandBudget(3000), false, !expected);
      if (reveal) await this.revealTarget(scope, element);
      const target = await this.call(scope, element, describeElement.toString(), false);
      if (highlight) {
        await this.send('DOM.enable', {}, scope.session);
        await this.send('Overlay.enable', {}, scope.session);
        await this.send(
          'Overlay.highlightNode',
          {
            objectId: element,
            highlightConfig: { contentColor: { r: 43, g: 133, b: 116, a: 0.23 } },
          },
          scope.session,
        );
        setTimeout(() => {
          void this.send('Overlay.hideHighlight', {}, scope.session).catch(() => {});
        }, 1500).unref();
      }
      return { ...target, selector, framePath: path };
    } finally {
      await this.send('Runtime.releaseObject', { objectId: element }, scope.session).catch(
        () => {},
      );
    }
  }
  stop() {
    this.contents.removeListener('did-start-navigation', this.navigationStarted);
    this.picker.dispose();
    this.abort.abort(new Error('网页会话已关闭'));
  }
}
