import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from 'antd';
import { useAppearance } from './appearance';
import './markdown.css';

/** Presentation only: the original message remains the persisted source. */
function markDiagrams() {
  return (tree: any) => {
    let count = 0;
    const visit = (node: any) => {
      if (node.type === 'code' && node.lang?.toLowerCase() === 'mermaid') {
        node.data ??= {};
        node.data.hProperties ??= {};
        node.data.hProperties['data-mermaid-index'] = count++;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
function CopyContent({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState('');
  const currentText = useRef(text);
  currentText.current = text;
  useEffect(() => setStatus(''), [text]);
  return (
    <span className="markdown-copy">
      <Button
        onClick={() => {
          void window.flowark
            .request('clipboard.copy', { value: text })
            .then(() => {
              if (currentText.current === text) setStatus('已复制');
            })
            .catch(() => {
              if (currentText.current === text) setStatus('复制失败，请手动选择内容');
            });
        }}
      >
        {label}
      </Button>
      {status && <span role="status">{status}</span>}
    </span>
  );
}
function CodeBlock({
  source,
  language,
  note,
}: {
  source: string;
  language: string;
  note?: string;
}) {
  return (
    <div className="markdown-code-block">
      <strong>{note || language || '代码'}</strong>
      <pre tabIndex={0} aria-label={language ? `${language} 源码` : '代码源码'}>
        <code>{source}</code>
      </pre>
      <CopyContent text={source} label={language === 'mermaid' ? '复制源码' : '复制代码'} />
    </div>
  );
}
type Drawing = { key: string; url?: string; error?: string };
function MermaidBlock({ source, partial }: { source: string; partial: boolean }) {
  const { resolved } = useAppearance();
  const key = resolved + '\0' + source;
  const [drawing, setDrawing] = useState<Drawing>();
  const [viewSource, setViewSource] = useState(false);
  useEffect(() => {
    if (partial || source.length > 16000) return;
    let current = true;
    void import('./mermaid-renderer')
      .then(({ drawMermaid }) => drawMermaid(source, resolved, () => current))
      .then((url) => {
        if (current && url) setDrawing({ key, url });
      })
      .catch(() => {
        if (current) setDrawing({ key, error: '图表暂时无法显示，已保留源码' });
      });
    return () => {
      current = false;
    };
  }, [key, source, resolved, partial]);
  if (partial)
    return <CodeBlock source={source} language="mermaid" note="图表生成中，完成后显示" />;
  if (source.length > 16000)
    return <CodeBlock source={source} language="mermaid" note="图表超过本地绘制上限，已保留源码" />;
  const displayed = drawing?.key === key ? drawing : undefined;
  if (!displayed?.url)
    return (
      <CodeBlock source={source} language="mermaid" note={displayed?.error || '正在绘制图表…'} />
    );
  return (
    <figure className="markdown-mermaid">
      <figcaption>Mermaid</figcaption>
      {viewSource ? (
        <pre tabIndex={0} aria-label="mermaid 源码">
          <code>{source}</code>
        </pre>
      ) : (
        <div className="markdown-diagram-scroll" tabIndex={0} aria-label="Mermaid 图表区域">
          <img src={displayed.url} alt="Mermaid 图表；可查看下方源码" />
        </div>
      )}
      <div className="markdown-diagram-actions">
        <Button onClick={() => setViewSource((value) => !value)}>
          {viewSource ? '显示图表' : '查看源码'}
        </Button>
        {viewSource && <CopyContent text={source} label="复制源码" />}
      </div>
    </figure>
  );
}
function MarkdownBody({ text, partial = false }: { text: string; partial?: boolean }) {
  const components = useMemo(
    () => ({
      pre: ({ node, children }: any) => {
        const code = node?.children?.find(
          (child: any) => child.type === 'element' && child.tagName === 'code',
        );
        if (!code) return <pre tabIndex={0}>{children}</pre>;
        const source = code.children
          .filter((child: any) => child.type === 'text')
          .map((child: any) => child.value)
          .join('');
        const names = code.properties?.className || [];
        const language =
          names
            .find((name: string) => name.startsWith('language-'))
            ?.slice(9)
            .toLowerCase() || '';
        if (language === 'mermaid') {
          if (Number(code.properties?.['data-mermaid-index']) >= 8)
            return (
              <CodeBlock
                source={source}
                language={language}
                note="图表数量超过本条展示上限，保留源码"
              />
            );
          return <MermaidBlock source={source} partial={partial} />;
        }
        return <CodeBlock source={source} language={language} />;
      },
      table: ({ children }: any) => (
        <div
          className="markdown-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Markdown 表格"
        >
          <table>{children}</table>
        </div>
      ),
      a: ({ href, children }: any) =>
        href && /^(https?:\/\/|mailto:)/i.test(href) ? (
          <span className="markdown-link">
            {children} <CopyContent text={href} label="复制链接" />
          </span>
        ) : (
          <span>{children}</span>
        ),
      img: ({ alt }: any) => (
        <span className="markdown-image-label">图片：{alt || '未提供说明'}</span>
      ),
    }),
    [partial],
  );
  return (
    <div className="markdown-content">
      {text.length > 100000 ? (
        <pre tabIndex={0}>{text}</pre>
      ) : (
        <Markdown skipHtml remarkPlugins={[remarkGfm, markDiagrams]} components={components}>
          {text}
        </Markdown>
      )}
    </div>
  );
}
export default memo(MarkdownBody);
