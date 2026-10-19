/** Self-contained for execution in the selected website document, never the renderer. */
export function browserTargetDOM(input: {
  selector: string;
  mode: 'bind' | 'check' | 'read';
  expected?: Element;
}): Element | { visible: boolean; text?: string } | null {
  const roots: (Document | ShadowRoot)[] = [document],
    found: Element[] = [];
  for (const root of roots) {
    found.push(...root.querySelectorAll(input.selector));
    for (const element of root.querySelectorAll('*'))
      if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  if (found.length > 1) throw Error('网页目标匹配多个元素，未选择第一个');
  if (input.mode === 'bind') return found[0] ?? null;
  const element = input.expected;
  if (!element || !element.isConnected || found[0] !== element)
    throw Error('本次绑定的网页目标已离开或被替换，未重新定位');
  const rect = element.getBoundingClientRect(),
    style = getComputedStyle(element);
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    style.display !== 'none';
  if (!visible || input.mode !== 'read') return { visible };
  const text = (element as HTMLElement).innerText;
  if (typeof text !== 'string') throw Error('该目标不支持可见文字读取');
  return { visible, text };
}

/** A trusted press must still hit the same unique element after browser actionability waits. */
export function browserTargetPointerGuard(input: { selector: string; element: Element }) {
  const state = { pressed: false, blocked: false };
  const listener = (event: Event) => {
    if (!event.isTrusted) return;
    const roots: (Document | ShadowRoot)[] = [document],
      found: Element[] = [];
    for (const root of roots) {
      found.push(...root.querySelectorAll(input.selector));
      for (const element of root.querySelectorAll('*'))
        if (element.shadowRoot) roots.push(element.shadowRoot);
    }
    const target = input.element;
    if (
      found.length !== 1 ||
      found[0] !== target ||
      !target.isConnected ||
      target.matches(':disabled') ||
      !event.composedPath().includes(target)
    ) {
      state.blocked = true;
      event.preventDefault();
      event.stopImmediatePropagation();
    } else if (event.type === 'mousedown') state.pressed = true;
  };
  const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  for (const type of types) window.addEventListener(type, listener, true);
  return {
    read: () => ({ ...state }),
    dispose: () => {
      for (const type of types) window.removeEventListener(type, listener, true);
    },
  };
}
