import type {
  BrowserRenderedFieldsResult,
  BrowserScopedRenderedFieldsResult,
} from '../shared/contracts.generated';
import type { ResolvedBrowserFieldsNode } from '../shared/browser-fields';
import type {
  RenderingDiagnosticData,
  RenderingLocation,
  AncestorSpaceFailure,
  AncestorSpaceRule,
} from '../shared/browser-rendering-diagnostics';

type Input = {
  selector: string;
  framePath: string[];
  url: string;
  fields: ResolvedBrowserFieldsNode['fields'];
  diagnosticsOnly?: false;
  renderPolicy?: 'bounded-rendered-text-v1' | 'bounded-rendered-text-v2';
};
type DiagnosticInput = Omit<Input, 'diagnosticsOnly'> & {
  diagnosticsOnly: true;
  diagnosticTarget: Element;
  diagnosticSelector: string;
  diagnosticDetails?: 'ancestor-space-checks-v1';
};
export function readBrowserRenderedFields(input: DiagnosticInput): RenderingDiagnosticData;
export function readBrowserRenderedFields(
  input: Input,
): BrowserRenderedFieldsResult | BrowserScopedRenderedFieldsResult;
/** Serialized into one document. Synchronous, closure-free, read-only and fail-closed. */
export function readBrowserRenderedFields(
  input: Input | DiagnosticInput,
): BrowserRenderedFieldsResult | BrowserScopedRenderedFieldsResult | RenderingDiagnosticData {
  const encoder = new TextEncoder();
  const check = (value: string, limit: number) => {
    const bytes = encoder.encode(value);
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== value)
      throw Error('关联正文含无效Unicode');
    if (bytes.length > limit) throw Error('关联正文结果超限，整次采集未采用');
  };
  let elements = 0,
    nodes = 0;
  const scoped = input.renderPolicy === 'bounded-rendered-text-v2';
  const explainSpace =
    scoped && input.diagnosticsOnly && input.diagnosticDetails === 'ancestor-space-checks-v1';
  let ignoredAncestorSpaces = 0;
  const nonPaintingSpace = (
    style: CSSStyleDeclaration,
    failed?: (failure: AncestorSpaceFailure) => void,
  ) => {
    const exact = {
      position: 'static',
      float: 'none',
      'z-index': 'auto',
      'background-image': 'none',
      'border-image-source': 'none',
      'outline-style': 'none',
      'box-shadow': 'none',
      'text-shadow': 'none',
      'text-decoration-line': 'none',
      'text-emphasis-style': 'none',
      '-webkit-text-stroke-width': '0px',
      filter: 'none',
      'backdrop-filter': 'none',
      transform: 'none',
      perspective: 'none',
      clip: 'auto',
      'clip-path': 'none',
      'mask-image': 'none',
      '-webkit-mask-box-image-source': 'none',
      opacity: '1',
      'mix-blend-mode': 'normal',
      visibility: 'visible',
      'content-visibility': 'visible',
      'animation-name': 'none',
      contain: 'none',
      'overflow-x': 'visible',
      'overflow-y': 'visible',
      '-webkit-box-reflect': 'none',
      rotate: 'none',
      scale: 'none',
      translate: 'none',
      zoom: '1',
    } satisfies Partial<Record<AncestorSpaceRule, string>>;
    const check = (rule: AncestorSpaceRule, observed: string | string[], passes: boolean) => {
      if (!passes && failed)
        failed({
          rule,
          state: (Array.isArray(observed) ? observed.some((v) => !v) : !observed)
            ? 'unavailable'
            : 'mismatch',
        });
      return passes;
    };
    const checks = (Object.entries(exact) as [AncestorSpaceRule, string][]).map(
      ([rule, expected]) =>
        () => {
          const value = style.getPropertyValue(rule);
          return check(rule, value, value === expected);
        },
    );
    checks.push(
      () => {
        const v = style.display;
        return check('display', v, ['block', 'inline', 'table'].includes(v));
      },
      () => {
        const v = style.whiteSpace;
        return check('white-space', v, ['normal', 'nowrap'].includes(v));
      },
      () => {
        const v = style.backgroundColor;
        return check('background-color', v, ['transparent', 'rgba(0, 0, 0, 0)'].includes(v));
      },
      () => {
        const v = ['top', 'right', 'bottom', 'left'].map((side) =>
          style.getPropertyValue('border-' + side + '-width'),
        );
        return check(
          'border-width',
          v,
          v.every((w) => w === '0px'),
        );
      },
      () => {
        const v = style.transitionDuration;
        return check('transition-duration', v, !!v && v.split(',').every((d) => d.trim() === '0s'));
      },
    );
    let passes = true;
    for (const evaluate of checks) {
      if (!evaluate()) {
        passes = false;
        if (!failed) return false;
      }
    }
    return passes;
  };
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
  const locations: RenderingLocation[] = [];
  let truncated = false;
  const inspect = (target: Element): Issue[] => {
    const issues = new Set<Issue>();
    const positions = new Map<Element, Pick<RenderingLocation, 'scope' | 'depth' | 'scanIndex'>>();
    const report = (
      issue: Issue,
      element?: Element,
      pseudo: RenderingLocation['pseudo'] = null,
      contentKind: RenderingLocation['contentKind'] = null,
      ancestorSpace: RenderingLocation['ancestorSpace'] = null,
    ) => {
      issues.add(issue);
      if (!input.diagnosticsOnly) return;
      if (locations.length >= 32) {
        truncated = true;
        return;
      }
      const position = element && positions.get(element);
      const tag = element?.localName;
      const known =
        !!position && !!tag && tag.length <= 100 && /^[a-zA-Z][a-zA-Z0-9:_-]*$/.test(tag);
      locations.push({
        issue,
        ...(known ? position : { scope: 'unavailable' as const, depth: null, scanIndex: null }),
        tag: known ? tag : null,
        pseudo,
        contentKind,
        ...(explainSpace
          ? {
              ancestorSpace:
                known && position && ['ancestor', 'frame-ancestor'].includes(position.scope)
                  ? ancestorSpace
                  : null,
            }
          : {}),
      });
    };
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
          if (input.diagnosticsOnly)
            positions.set(current, {
              scope:
                current === target
                  ? 'target'
                  : current.ownerDocument === document
                    ? 'ancestor'
                    : 'frame-ancestor',
              depth: ancestors.length,
              scanIndex: nodes,
            });
          ancestors.push(current);
          current = current.parentElement;
        }
        if (doc.defaultView === doc.defaultView?.top) break;
        const owner = doc.defaultView?.frameElement;
        if (!owner) {
          report('unsupported-layout');
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
      report('unsupported-layout');
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
        report('unsupported-layout', element);
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
        report(descendant ? 'hidden-descendant' : 'hidden-target', element);
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
        report('unsupported-layout', element);
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
        report('line-clamp', element);
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
        report('overflow-clip', element);
      if (
        element.shadowRoot ||
        element.localName.includes('-') ||
        element.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
        (/^(iframe|canvas|img|picture|video|audio|object|embed|input|textarea|select|button|meter|progress)$/.test(
          element.localName,
        ) &&
          (element.ownerDocument === document || element.localName !== 'iframe'))
      ) {
        report('embedded-content', element);
        return false;
      }
      for (const pseudo of ['::before', '::after']) {
        const pseudoStyle = win.getComputedStyle(element, pseudo);
        const content = pseudoStyle.content;
        if (content && !['none', 'normal', '""', "''"].includes(content)) {
          const whitespace = /^(?:"[\t\n\f\r ]*"|'[\t\n\f\r ]*')$/.test(content);
          const ancestor = scoped && !descendant && element !== target;
          const detailed = explainSpace && ancestor && whitespace;
          const failures: AncestorSpaceFailure[] = [];
          const ordinary = /^(?:" +"|' +')$/.test(content);
          const allowed =
            ancestor &&
            ordinary &&
            nonPaintingSpace(
              pseudoStyle,
              detailed ? (failure) => failures.push(failure) : undefined,
            );
          if (allowed) ignoredAncestorSpaces++;
          else {
            if (detailed && !ordinary) failures.push({ rule: 'ordinary-space', state: 'mismatch' });
            report(
              'generated-content',
              element,
              pseudo === '::before' ? 'before' : 'after',
              whitespace ? 'whitespace-string' : 'other-generated',
              detailed ? { failures: failures.slice(0, 8), more: failures.length > 8 } : null,
            );
          }
        }
      }
      return true;
    };
    for (const ancestor of ancestors)
      if (!inspectElement(ancestor, false, true)) return order.filter((v) => issues.has(v));
    if (!target.getClientRects().length) {
      report('hidden-target', target);
      return order.filter((v) => issues.has(v));
    }
    const walk = (node: Node, depth: number) => {
      visit(node);
      if (input.diagnosticsOnly && node.nodeType === 1)
        positions.set(node as Element, { scope: 'descendant', depth, scanIndex: nodes });
      if (node.nodeType === 1 && !inspectElement(node as Element, true, true)) return;
      for (let child = node.firstChild; child; child = child.nextSibling) walk(child, depth + 1);
    };
    for (let child = target.firstChild; child; child = child.nextSibling) walk(child, 1);
    return order.filter((v) => issues.has(v));
  };
  // Editor-only inspection exits before any field text or attribute is read.
  if (input.diagnosticsOnly) {
    const matches = roots[0].querySelectorAll(input.diagnosticSelector);
    if (matches.length !== 1 || matches[0] !== input.diagnosticTarget)
      throw Error('诊断目标不唯一或已被替换，请重新检查');
    const issues = inspect(matches[0]);
    return {
      policy: scoped ? 'bounded-rendered-text-v2' : 'bounded-rendered-text-v1',
      issues,
      locations,
      truncated,
      scannedElements: elements,
      scannedNodes: nodes,
      ...(scoped ? { ignoredAncestorSpaces } : {}),
      ...(explainSpace ? { details: 'ancestor-space-checks-v1' as const } : {}),
    } as RenderingDiagnosticData;
  }
  const fields = input.fields.map((f) => {
    const priorIgnored = ignoredAncestorSpaces;
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
    return {
      ...f,
      count,
      issues,
      status,
      value,
      ...(scoped ? { ignoredAncestorSpaces: ignoredAncestorSpaces - priorIgnored } : {}),
    };
  });
  const result = {
    version: scoped ? 3 : 2,
    operation: 'collect',
    renderPolicy: scoped ? 'bounded-rendered-text-v2' : 'bounded-rendered-text-v1',
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
  } as BrowserRenderedFieldsResult | BrowserScopedRenderedFieldsResult;
  check(result.url, 16384);
  check(result.documentUrl, 16384);
  check(JSON.stringify(result), 131072);
  return result;
}
