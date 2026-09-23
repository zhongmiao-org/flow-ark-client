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
        这是流程中保存的文字，尚未修改文档。请从原任务进入试运行检查，重新选择窗口与原选区，核对后授权本次单次修改。
      </p>
      <details>
        <summary>查看目标引用</summary>
        <p>{node.target}</p>
      </details>
    </section>
  );
}
