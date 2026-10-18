import type { BrowserRenderedFieldsResult } from '../shared/contracts.generated';
import type { ResolvedBrowserFieldsNode } from '../shared/browser-fields';

type Input = {
  selector: string;
  framePath: string[];
  url: string;
  fields: ResolvedBrowserFieldsNode['fields'];
};
/** Serialized into one document. Synchronous, closure-free, read-only and fail-closed. */
export function readBrowserRenderedFields(input: Input): BrowserRenderedFieldsResult {
  const encoder = new TextEncoder();
  const check = (value: string, limit: number) => {
    const bytes = encoder.encode(value);
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== value)
      throw Error('关联正文含无效Unicode');
    if (bytes.length > limit) throw Error('关联正文结果超限，整次采集未采用');
  };
  let elements = 0,
    nodes = 0;
  const visit = (node: Node) => {
    if (nodes >= 6000 || (node.nodeType === 1 && elements >= 2000))
      throw Error('正文扫描预算超限，整次采集未采用');
    nodes++;
    if (node.nodeType === 1) elements++;
  };
  const roots = document.querySelectorAll(input.selector);
  if (roots.length !== 1) throw Error('采集根元素须唯一匹配，实际匹配 ' + roots.length + ' 项');
  const order = [
    'hidden-target',
    'hidden-descendant',
    'line-clamp',
    'overflow-clip',
    'unsupported-layout',
    'embedded-content',
    'generated-content',
  ] as const;
  type Issue = (typeof order)[number];
  const inspect = (target: Element): Issue[] => {
    const issues = new Set<Issue>();
    const ancestors: Element[] = [];
    let current: Element | null = target;
    let doc: Document = document;
    const targetRects = new Map<
      Document,
      { left: number; right: number; top: number; bottom: number }
    >();
    let rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> = target.getBoundingClientRect();
    targetRects.set(doc, rect);
    // Same-origin frame ancestors are checked in this same synchronous call.
    try {
      while (true) {
        while (current) {
          if (ancestors.length >= 64) throw Error('正文祖先预算超限，整次采集未采用');
          visit(current);
          ancestors.push(current);
          current = current.parentElement;
        }
        if (doc.defaultView === doc.defaultView?.top) break;
        const owner = doc.defaultView?.frameElement;
        if (!owner) {
          issues.add('unsupported-layout');
          break;
        }
        current = owner;
        doc = owner.ownerDocument;
        const frameBox = owner.getBoundingClientRect();
        rect = {
          left: rect.left + frameBox.left + owner.clientLeft,
          right: rect.right + frameBox.left + owner.clientLeft,
          top: rect.top + frameBox.top + owner.clientTop,
          bottom: rect.bottom + frameBox.top + owner.clientTop,
        };
        targetRects.set(doc, rect);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('预算')) throw error;
      issues.add('unsupported-layout');
    }
    const inspectElement = (element: Element, descendant: boolean, alreadyVisited = false) => {
      if (!alreadyVisited) visit(element);
      const win = element.ownerDocument.defaultView;
      if (
        !win ||
        typeof element.checkVisibility !== 'function' ||
        !element.ownerDocument.fonts ||
        typeof element.getAnimations !== 'function'
      ) {
        issues.add('unsupported-layout');
        return false;
      }
      const style = win.getComputedStyle(element);
      const hidden =
        style.display === 'none' ||
        style.visibility !== 'visible' ||
        Number(style.opacity) === 0 ||
        style.contentVisibility === 'hidden' ||
        !element.checkVisibility({
          contentVisibilityAuto: true,
          opacityProperty: true,
          visibilityProperty: true,
        });
      if (hidden) {
        issues.add(descendant ? 'hidden-descendant' : 'hidden-target');
        return false;
      }
      if (
        style.display === 'contents' ||
        element.ownerDocument.fonts.status !== 'loaded' ||
        (style.clip && style.clip !== 'auto') ||
        style.clipPath !== 'none' ||
        style.maskImage !== 'none' ||
        style.filter !== 'none' ||
        (style.backdropFilter && style.backdropFilter !== 'none') ||
        (style.transform !== 'none' && style.transform !== 'matrix(1, 0, 0, 1, 0, 0)') ||
        style.perspective !== 'none' ||
        /(?:paint|strict|content)/.test(style.contain) ||
        ![0, 1].includes(Number(style.opacity)) ||
        element.getAnimations().some((a) => a.playState === 'running' || a.pending)
      )
        issues.add('unsupported-layout');
      const clamp = style.getPropertyValue('line-clamp');
      const webkitClamp = style.getPropertyValue('-webkit-line-clamp');
      if (
        (clamp && clamp !== 'none' && clamp !== '0') ||
        (webkitClamp &&
          webkitClamp !== 'none' &&
          webkitClamp !== '0' &&
          ['-webkit-box', '-webkit-inline-box', 'flow-root'].includes(style.display) &&
          style.getPropertyValue('-webkit-box-orient') === 'vertical')
      )
        issues.add('line-clamp');
      const box = element.getBoundingClientRect();
      const rect = targetRects.get(element.ownerDocument);
      const clipX = ['hidden', 'clip'].includes(style.overflowX),
        clipY = ['hidden', 'clip'].includes(style.overflowY);
      if (
        (clipX && element.scrollWidth > element.clientWidth) ||
        (clipY && element.scrollHeight > element.clientHeight) ||
        (!descendant &&
          rect &&
          element !== target &&
          ((clipX &&
            (rect.left < box.left + element.clientLeft ||
              rect.right > box.left + element.clientLeft + element.clientWidth)) ||
            (clipY &&
              (rect.top < box.top + element.clientTop ||
                rect.bottom > box.top + element.clientTop + element.clientHeight))))
      )
        issues.add('overflow-clip');
      if (
        element.shadowRoot ||
        element.localName.includes('-') ||
        element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
        (/^(iframe|canvas|img|picture|video|audio|object|embed|input|textarea|select|button|meter|progress)$/.test(
          element.localName,
        ) &&
          (element.ownerDocument === document || element.localName !== 'iframe'))
      ) {
        issues.add('embedded-content');
        return false;
      }
      for (const pseudo of ['::before', '::after']) {
        const content = win.getComputedStyle(element, pseudo).content;
        if (content && !['none', 'normal', '""', "''"].includes(content))
          issues.add('generated-content');
      }
      return true;
    };
    for (const ancestor of ancestors)
      if (!inspectElement(ancestor, false, true)) return order.filter((v) => issues.has(v));
    if (!target.getClientRects().length) {
      issues.add('hidden-target');
      return order.filter((v) => issues.has(v));
    }
    const walk = (node: Node) => {
      visit(node);
      if (node.nodeType === 1 && !inspectElement(node as Element, true, true)) return;
      for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
    };
    for (let child = target.firstChild; child; child = child.nextSibling) walk(child);
    return order.filter((v) => issues.has(v));
  };
  const fields = input.fields.map((f) => {
    const matches = roots[0].querySelectorAll(f.selector),
      count = matches.length;
    const issues = count === 1 && f.operation === 'rendered-text' ? inspect(matches[0]) : [];
    let value: string | null = null;
    if (count === 1 && !issues.length) {
      if (f.operation === 'rendered-text') {
        if (!(matches[0] instanceof HTMLElement)) issues.push('embedded-content');
        else value = matches[0].innerText;
      } else
        value =
          f.operation === 'text'
            ? (matches[0].textContent ?? '')
            : matches[0].getAttribute(f.attribute!);
    }
    if (value !== null) check(value, f.operation === 'rendered-text' ? 65536 : 8192);
    const status =
      count === 0
        ? 'missing'
        : count > 1
          ? 'ambiguous'
          : issues.some((i) => i.startsWith('hidden-'))
            ? 'hidden'
            : issues.some((i) => i === 'line-clamp' || i === 'overflow-clip')
              ? 'clipped'
              : issues.length
                ? 'unsupported'
                : value === null
                  ? 'missing-attribute'
                  : value.trim() === ''
                    ? 'empty'
                    : 'ok';
    return { ...f, count, issues, status, value };
  });
  const result = {
    version: 2,
    operation: 'collect',
    renderPolicy: 'bounded-rendered-text-v1',
    url: input.url,
    documentUrl: location.href,
    selector: input.selector,
    framePath: input.framePath,
    complete: fields.every(
      (f) =>
        !['ambiguous', 'hidden', 'clipped', 'unsupported'].includes(f.status) &&
        (!f.required || f.status === 'ok'),
    ),
    fields,
  } as BrowserRenderedFieldsResult;
  check(result.url, 16384);
  check(result.documentUrl, 16384);
  check(JSON.stringify(result), 131072);
  return result;
}
