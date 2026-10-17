import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import { semanticColors } from './appearance-tokens';

let queue: Promise<unknown> = Promise.resolve();
let serial = 0;
/** Mermaid uses global configuration and a temporary DOM; serialize each draw. */
export function drawMermaid(source: string, mode: 'light' | 'dark', current: () => boolean) {
  const task = queue.then(async () => {
    if (!current()) return;
    if (
      source.length > 16000 ||
      /%%\{|^\s*---(?:\r?\n|$)|\b(?:https?|file|javascript|data):|<\s*(?:img|image|iframe)\b/im.test(
        source,
      )
    )
      throw Error('图表配置或大小超出本地展示范围');
    const c = semanticColors[mode];
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 16000,
      maxEdges: 300,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: 'base',
      themeVariables: {
        darkMode: mode === 'dark',
        fontFamily: 'Noto Sans SC Variable, sans-serif',
        fontSize: '14px',
        background: c['--fa-bg-surface'],
        mainBkg: c['--fa-bg-surface'],
        primaryColor: c['--fa-bg-subtle'],
        primaryTextColor: c['--fa-text-primary'],
        primaryBorderColor: c['--fa-border-control'],
        secondaryColor: c['--fa-action-subtle'],
        tertiaryColor: c['--fa-bg-canvas'],
        lineColor: c['--fa-text-secondary'],
        textColor: c['--fa-text-primary'],
        edgeLabelBackground: c['--fa-bg-surface'],
        actorBkg: c['--fa-bg-subtle'],
        actorBorder: c['--fa-border-control'],
        actorTextColor: c['--fa-text-primary'],
        signalColor: c['--fa-text-secondary'],
        signalTextColor: c['--fa-text-primary'],
      },
    });
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-mermaid-render-host', '');
    Object.assign(host.style, {
      position: 'absolute',
      left: '-100000px',
      width: '1200px',
      pointerEvents: 'none',
    });
    document.body.appendChild(host);
    try {
      const { svg } = await mermaid.render(`flowark-mermaid-${++serial}`, source, host);
      if (!current()) return;
      const clean = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: [
          'script',
          'foreignObject',
          'image',
          'a',
          'iframe',
          'animate',
          'animateMotion',
          'animateTransform',
          'set',
        ],
        FORBID_ATTR: ['href', 'xlink:href'],
      });
      if (clean.length > 2 * 1024 * 1024) throw Error('图表内容超过展示范围');
      const document = new DOMParser().parseFromString(clean, 'image/svg+xml');
      const root = document.documentElement;
      const bounds = root
        .getAttribute('viewBox')
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        root.localName !== 'svg' ||
        document.querySelector('parsererror') ||
        !bounds ||
        bounds.length !== 4 ||
        !bounds.every(Number.isFinite) ||
        bounds[2] <= 0 ||
        bounds[3] <= 0 ||
        bounds[2] > 12000 ||
        bounds[3] > 12000
      )
        throw Error('图表没有有效尺寸');
      // Standalone SVG images otherwise default to 300px wide. Preserve the
      // actual viewBox dimensions so diagram text remains readable.
      root.setAttribute('width', String(bounds[2]));
      root.setAttribute('height', String(bounds[3]));
      root.removeAttribute('style');
      return (
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(new XMLSerializer().serializeToString(root))
      );
    } finally {
      host.remove();
    }
  });
  queue = task.catch(() => {});
  return task;
}
