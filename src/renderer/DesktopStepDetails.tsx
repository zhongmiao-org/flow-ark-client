import type { Step } from '../shared/types';
import './desktop-task-plan.css';

export default function DesktopStepDetails({ node }: { node: Extract<Step, { type: 'desktop' }> }) {
  return (
    <section className="desktop-step-details" aria-label="应用选区步骤">
      <h3>替换选中段落并回读</h3>
      <p>仅修改重新核对的原选区，随后按原起点与新文字长度读取，核对是否一致。</p>
      <h4>已保存的替换文字</h4>
      <pre className="desktop-task-text" aria-label="已保存的替换文字">
        {node.text}
      </pre>
      <p>
        这是流程中保存的文字，尚未修改文档。原生窗口需在执行前重新绑定，单次授权和实际写入仍未开放。
      </p>
      <details>
        <summary>查看目标引用</summary>
        <p>{node.target}</p>
      </details>
    </section>
  );
}
