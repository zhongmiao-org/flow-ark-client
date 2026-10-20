/** Fixed bounded operation in the selected document. No template-supplied JavaScript. */
export function browserScrollDOM(input: {
  selector: string;
  expected: Element;
  direction: 'up' | 'down';
  distance: number;
}) {
  const doc = document;
  const parent = (el: Element): Element | null =>
    el.parentElement ??
    (el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : null);
  const unique = () => {
    const roots: (Document | ShadowRoot)[] = [doc],
      found: Element[] = [];
    for (const root of roots) {
      found.push(...root.querySelectorAll(input.selector));
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    if (found.length !== 1 || found[0] !== input.expected || !input.expected.isConnected)
      throw Error('滚动目标已更换或不唯一，未重新定位');
  };
  const chain: Element[] = [];
  for (let el: Element | null = input.expected; el; el = parent(el)) {
    if (chain.length > 64) throw Error('滚动区域超过64层祖先范围');
    if (el.assignedSlot) throw Error('插槽布局的滚动区域尚不支持');
    chain.push(el);
  }
  const inspect = (el: Element) => {
    const s = getComputedStyle(el),
      r = el.getBoundingClientRect();
    if (
      s.display === 'none' ||
      ['hidden', 'collapse'].includes(s.visibility) ||
      Number(s.opacity) === 0 ||
      s.contentVisibility === 'hidden' ||
      r.width <= 0 ||
      r.height <= 0
    )
      throw Error('滚动目标或区域不可见');
    if (
      s.writingMode !== 'horizontal-tb' ||
      s.flexDirection.endsWith('reverse') ||
      s.scrollSnapType !== 'none' ||
      el.getAnimations().some((a) => a.playState === 'running' || a.pending)
    )
      throw Error('当前书写方向、反向布局、滚动吸附或动画不支持固定滚动');
    return s;
  };
  unique();
  const styles = chain.map((el) => inspect(el).overflowY);
  const documentRegion = doc.scrollingElement;
  if (!documentRegion || !chain.includes(documentRegion)) throw Error('无法确定当前文档滚动区域');
  let depth = chain.findIndex(
    (el, i) => el === documentRegion || ['auto', 'scroll', 'overlay'].includes(styles[i]),
  );
  if (depth < 0) depth = chain.indexOf(documentRegion);
  const region = chain[depth];
  const regionKind = region === documentRegion ? 'document' : depth === 0 ? 'target' : 'ancestor';
  const measure = () => ({
    offset: region.scrollTop,
    height: region.scrollHeight,
    viewport: region.clientHeight,
  });
  const before = measure(),
    documentUrl = doc.location.href;
  const finite = (m: ReturnType<typeof measure>) => {
    if (
      ![m.offset, m.height, m.viewport].every((n) => Number.isFinite(n) && n >= 0 && n <= 1e9) ||
      m.viewport <= 0 ||
      m.offset > Math.max(0, m.height - m.viewport) + 1
    )
      throw Error('滚动区域位置或尺寸超出范围');
  };
  const docUrl = new URL(documentUrl);
  if (!['http:', 'https:'].includes(docUrl.protocol) || docUrl.username || docUrl.password)
    throw Error('目标文档地址无效，未滚动');
  finite(before);
  const requested = Math.max(
    0,
    Math.min(
      Math.max(0, before.height - before.viewport),
      before.offset + (input.direction === 'down' ? input.distance : -input.distance),
    ),
  );
  const scroll = Element.prototype.scrollTo as (this: Element, options: ScrollToOptions) => void;
  scroll.call(region, { top: requested, behavior: 'instant' });
  const after = measure();
  unique();
  chain.forEach((el, i) => {
    if (!el.isConnected || (i + 1 < chain.length && parent(el) !== chain[i + 1]))
      throw Error('滚动期间固定区域关系发生变化');
    const s = inspect(el);
    if (s.overflowY !== styles[i]) throw Error('滚动期间区域类型发生变化');
  });
  if (doc.scrollingElement !== documentRegion || doc.location.href !== documentUrl)
    throw Error('滚动期间文档来源发生变化');
  finite(after);
  return {
    documentUrl,
    region: regionKind,
    ancestorDepth: depth,
    offsetBefore: before.offset,
    offsetAfter: after.offset,
    heightBefore: before.height,
    heightAfter: after.height,
    viewportBefore: before.viewport,
    viewportAfter: after.viewport,
    moved: after.offset !== before.offset,
    atStart: after.offset <= 0.5,
    atEnd: after.offset >= Math.max(0, after.height - after.viewport) - 0.5,
  };
}
