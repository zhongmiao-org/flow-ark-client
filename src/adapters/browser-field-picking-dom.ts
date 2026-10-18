/** Runs synchronously in the selected website's isolated world. No closure or DOM writes. */
export type FieldsPickDOMInput = {
  rootSelector: string | null;
  /** Null generates a locator; a string verifies the exact configured locator. */
  selector: string | null;
};
export type FieldsPickDOMDescription = {
  selector: string;
  globalSelector: string;
  label: string;
  tag: string;
  structural: boolean;
};
export function describeFieldsPick(
  this: Element,
  input: FieldsPickDOMInput,
): FieldsPickDOMDescription {
  const target = this;
  if (!(target instanceof Element) || !target.isConnected)
    throw Error('所选元素已离开页面，请重新选取');
  if (target.ownerDocument !== document || target.getRootNode() !== document)
    throw Error('关联字段仅支持当前文档中的元素，不支持 Shadow DOM');
  let calls = 0;
  const query = (parent: Document | Element, css: string) => {
    if (++calls > 128) throw Error('定位生成超过查询预算，请选择更明确的目标');
    if (!css.trim() || css.length > 2000) throw Error('定位须为 1 至 2000 字符');
    return parent.querySelectorAll(css);
  };
  let parent: Document | Element = document;
  if (input.rootSelector !== null) {
    const roots = query(document, input.rootSelector);
    if (roots.length !== 1) throw Error('采集根元素须唯一匹配，实际匹配 ' + roots.length + ' 项');
    parent = roots[0];
    if (parent === target || !parent.contains(target))
      throw Error('字段目标必须是原根元素的严格后代，请在根内部重新选取');
  }
  const unique = (scope: Document | Element, css: string) => {
    const matches = query(scope, css);
    return matches.length === 1 && matches[0] === target;
  };
  const generate = (scope: Document | Element) => {
    const candidates: string[] = [];
    if (target.id) candidates.push('#' + CSS.escape(target.id));
    for (const name of ['data-testid', 'data-test', 'name', 'aria-label', 'placeholder']) {
      const value = target.getAttribute(name);
      if (value && value.length <= 1000)
        candidates.push(`${target.localName}[${name}="${CSS.escape(value)}"]`);
    }
    for (const css of candidates) {
      if (css.length <= 2000 && unique(scope, css)) return { css, structural: false };
    }
    let element: Element | null = target;
    let css = '';
    for (let depth = 0; element && element !== scope; depth++) {
      if (depth >= 64) throw Error('定位生成超过 64 层祖先，请选择更明确的目标');
      let position = 1;
      // Count by native :nth-of-type semantics, without enumerating sibling lists.
      // A document with enormous sibling lists is rejected rather than scanned indefinitely.
      let siblings = 0;
      for (
        let previous = element.previousElementSibling;
        previous;
        previous = previous.previousElementSibling
      ) {
        if (++siblings > 2000) throw Error('定位生成的同级元素超过预算');
        if (previous.localName === element.localName) position++;
      }
      const part = element.localName + ':nth-of-type(' + position + ')';
      css = part + (css ? ' > ' + css : '');
      if (css.length > 2000) throw Error('定位生成超过 2000 字符');
      if (unique(scope, css)) return { css, structural: true };
      element = element.parentElement;
    }
    throw Error('无法生成唯一定位，请重新选择目标或手动核对定位');
  };
  const described =
    input.selector === null ? generate(parent) : { css: input.selector, structural: false };
  if (!unique(parent, described.css)) throw Error('定位不再唯一指向原目标，请重新选取');
  const global = parent === document ? described : generate(document);
  if (!unique(document, global.css)) throw Error('目标的文档定位已变化，请重新选取');
  const label = (target.getAttribute('aria-label') || target.id || target.localName)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return {
    selector: described.css,
    globalSelector: global.css,
    tag: target.localName.slice(0, 100),
    label,
    structural: described.structural || global.structural,
  };
}
