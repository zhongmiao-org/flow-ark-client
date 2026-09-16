import { useEffect, useState } from 'react';
import type { FramePath } from '../shared/contracts.generated';
import type { Step } from '../shared/types';

type BrowserNode = Extract<Step, { type: 'browser' }>;
export default function BrowserNodeConfiguration({
  node,
  change,
}: {
  node: BrowserNode;
  change: (node: BrowserNode) => void;
}) {
  const path: FramePath = node.version === 2 ? node.framePath : [];
  const pathKey = JSON.stringify(path);
  const [frames, setFrames] = useState(path.join('\n'));
  const parseFrames = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  useEffect(() => {
    if (JSON.stringify(parseFrames(frames)) !== pathKey) setFrames(path.join('\n'));
  }, [pathKey]);
  const topLevel = ['navigate', 'screenshot'].includes(node.operation);
  return (
    <section aria-label="浏览器节点配置">
      <label htmlFor="browser-operation">操作</label>
      <select
        id="browser-operation"
        value={node.operation}
        onChange={(e) => {
          const operation = e.target.value as BrowserNode['operation'];
          const nextPath: FramePath = ['navigate', 'screenshot'].includes(operation) ? [] : path;
          change({ ...node, version: 2, operation, framePath: nextPath });
        }}
      >
        {Object.entries({
          navigate: '打开网页',
          read: '读取文字',
          click: '点击元素',
          fill: '填写内容',
          wait: '等待可见',
          upload: '选择上传文件',
          screenshot: '页面截图',
          download: '点击并下载',
        }).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor="browser-selector">目标元素选择器</label>
      <input
        id="browser-selector"
        disabled={topLevel}
        value={node.selector}
        placeholder="#submit"
        onChange={(e) => change({ ...node, selector: e.target.value })}
      />
      <label htmlFor="browser-frame-path">iframe 路径</label>
      <textarea
        id="browser-frame-path"
        value={frames}
        disabled={topLevel}
        rows={3}
        aria-describedby="browser-frame-help"
        placeholder={'iframe#outer\niframe[name="content"]'}
        onChange={(e) => {
          setFrames(e.target.value);
          change({ ...node, version: 2, framePath: parseFrames(e.target.value) as FramePath });
        }}
      />
      <p id="browser-frame-help" className="note">
        {topLevel
          ? '打开网页和页面截图作用于顶层页面。'
          : '留空表示顶层页面。每行一个 CSS 选择器，从外到内，最多 8 层；每层必须唯一匹配。'}
      </p>
    </section>
  );
}
