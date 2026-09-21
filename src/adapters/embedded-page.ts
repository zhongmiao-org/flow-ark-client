import type { MouseInputEvent, WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { BrowserCommand } from '../shared/types';
import { commandBudget } from './browser-scope';
import { framePathOf, validateFormCommand, formKeys } from '../core/browser-command';
import { EmbeddedPicker } from './embedded-picker';
import { describeElement } from './element-description';
import type { ElementTarget } from '../shared/element-picker';
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
  constructor(
    readonly contents: WebContents,
    coordinates: (mouse: MouseInputEvent) => { x: number; y: number },
  ) {
    contents.debugger.attach('1.3');
    this.picker = new EmbeddedPicker(
      contents,
      (m, p, s) => this.send(m, p, s),
      this.frames,
      (selector, path) => this.inspectTarget(selector, path, false),
      coordinates,
    );
    contents.debugger.on('message', (_event, method, params) => {
      if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
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
          if (session === params.sessionId) this.frames.delete(id);
      }
    });
    contents.once('destroyed', () => this.abort.abort(new Error('网页会话已关闭')));
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
  private async scope(path: string[], remaining: () => number) {
    const { frameTree } = await this.send('Page.getFrameTree');
    let scope = await this.world(frameTree.frame.id);
    for (const selector of path) {
      const parent = scope;
      const element = await this.element(scope, selector, remaining);
      try {
        const box = await this.call(
          scope,
          element,
          `function() { this.scrollIntoView({block:'center',inline:'center',behavior:'instant'}); const r=this.getBoundingClientRect(); return {x:r.x+this.clientLeft,y:r.y+this.clientTop}; }`,
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
  private async visible(scope: Scope, objectId: string, remaining: () => number, enabled = false) {
    while (true) {
      remaining();
      const box = await this.call(
        scope,
        objectId,
        `function(enabled) {
        if (!this.isConnected) throw new Error('目标元素已离开页面');
        this.scrollIntoView({block:'center', inline:'center', behavior:'instant'});
        const r=this.getBoundingClientRect(), s=getComputedStyle(this);
        if (!r.width || !r.height || s.visibility==='hidden' || s.display==='none' || (enabled && this.matches(':disabled'))) return null;
        const x=r.x+r.width/2,y=r.y+r.height/2;
        return {x,y};
      }`,
        enabled,
      );
      if (box) return box;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining())));
    }
  }
  private async pointerGuard(scope: Scope, objectId: string) {
    const result = await this.send(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration: `function() {
        const target=this, state={hovered:false,pressed:false,blocked:false};
        const listen=e=>{
          if(!e.isTrusted) return;
          const hit=target.isConnected && !target.matches(':disabled') && e.composedPath().includes(target);
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
    return { x, y };
  }
  private async click(scope: Scope, objectId: string, remaining: () => number) {
    await this.visible(scope, objectId, remaining, true);
    const guard = await this.pointerGuard(scope, objectId);
    let navigated = false;
    const navigation = () => {
      navigated = true;
    };
    this.contents.on('did-start-navigation', navigation);
    try {
      let point: { x: number; y: number };
      for (;;) {
        remaining();
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
      remaining = commandBudget(command.timeoutMs);
    this.abort.signal.throwIfAborted();
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
  async inspectTarget(selector: string, path: string[], highlight = true): Promise<ElementTarget> {
    const scope = await this.scope(path, commandBudget(3000));
    const element = await this.element(scope, selector, commandBudget(3000));
    try {
      await this.visible(scope, element, commandBudget(3000));
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
    this.picker.dispose();
    this.abort.abort(new Error('网页会话已关闭'));
  }
}
