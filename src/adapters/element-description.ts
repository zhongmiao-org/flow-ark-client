/** Runs in the website's isolated world. Only locator metadata leaves this function. */
export function describeElement(this: Element, generate = true) {
  let el = this;
  if (!(el instanceof Element) || !el.isConnected) throw new Error('目标元素已离开页面');
  if (generate) {
    if (el instanceof HTMLLabelElement && el.control) el = el.control;
    else
      el =
        el.closest(
          'button,a,input,textarea,select,[contenteditable="true"],[role="button"],[role="checkbox"],[role="radio"]',
        ) ?? el;
  }
  const roots: (Document | ShadowRoot)[] = [document];
  for (let i = 0; i < roots.length; i++)
    for (const item of roots[i].querySelectorAll('*'))
      if (item.shadowRoot) roots.push(item.shadowRoot);
  const unique = (selector: string) => {
    if (selector.length > 4000) return false;
    const found = roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
    return found.length === 1 && found[0] === el;
  };
  const tag = el.localName;
  const candidates: string[] = [];
  if (el.id) candidates.push('#' + CSS.escape(el.id));
  for (const attr of ['data-testid', 'data-test', 'name', 'aria-label', 'placeholder']) {
    const value = el.getAttribute(attr);
    if (value && value.length <= 1000) candidates.push(`${tag}[${attr}="${CSS.escape(value)}"]`);
  }
  let selector = generate ? candidates.find(unique) : '',
    structural = false;
  if (generate && !selector) {
    structural = true;
    let node: Element | null = el,
      path = '';
    while (node) {
      const same = Array.from(node.parentElement?.children ?? node.getRootNode().childNodes).filter(
        (child): child is Element =>
          child instanceof Element && child.localName === node!.localName,
      );
      const part =
        node.localName + (same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : '');
      path = part + (path ? ' > ' + path : '');
      if (unique(path)) {
        selector = path;
        break;
      }
      node = node.parentElement;
    }
  }
  if (generate && !selector)
    throw new Error('无法生成唯一定位，请为目标添加稳定属性或手动填写选择器');
  const labels =
    'labels' in el
      ? Array.from((el as HTMLInputElement).labels ?? [])
          .map((l) => {
            const clone = l.cloneNode(true) as Element;
            clone
              .querySelectorAll('input,textarea,select,button,script,style')
              .forEach((e) => e.remove());
            return clone.textContent ?? '';
          })
          .join(' ')
      : '';
  const labelled = (el.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
  const text = ['button', 'a', 'label', 'option'].includes(tag) ? el.textContent : '';
  const label = (
    el.getAttribute('aria-label') ||
    labels ||
    labelled.trim() ||
    el.getAttribute('placeholder') ||
    text ||
    el.getAttribute('name') ||
    el.id ||
    tag
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  const options =
    el instanceof HTMLSelectElement
      ? Array.from(el.options)
          .slice(0, 200)
          .filter((o) => o.value.length <= 1000)
          .map((o) => ({
            value: o.value,
            label: o.label.slice(0, 1000),
            disabled:
              o.disabled ||
              (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled),
          }))
      : [];
  return {
    selector,
    label,
    tag: tag.slice(0, 100),
    inputType: el instanceof HTMLInputElement ? el.type : '',
    multiple: el instanceof HTMLSelectElement && el.multiple,
    structural,
    options,
  };
}
