import { Input } from 'antd';
import { useId } from 'react';
import type { DocumentNode } from '../shared/document';
import type { ReferenceChoice } from './value-references';
import ValueField from './ValueField';
import './ai-node.css';
export default function DocumentNodeConfiguration({
  node,
  choices,
  change,
}: {
  node: DocumentNode;
  choices: ReferenceChoice[];
  change: (n: DocumentNode) => void;
}) {
  const id = useId();
  return (
    <section className="node-configuration ai-node-configuration" aria-label="解析资料配置">
      <h4>解析资料</h4>
      <p>只解析明确文件的本机文本，不调用模型。请在“参数与资源”为逻辑目录绑定资料所在目录。</p>
      <label
        htmlFor={id}
        data-value-invalid={!/^[a-z][a-z0-9-]{0,99}$/.test(node.binding) ? 'true' : undefined}
      >
        逻辑目录
        <Input
          id={id}
          value={node.binding}
          onChange={(e) => change({ ...node, binding: e.target.value })}
        />
      </label>
      <ValueField
        label="相对文件名"
        value={node.file}
        choices={choices}
        change={(file) => change({ ...node, file })}
      />
      <p>
        支持UTF-8文本、PDF和DOCX。文件限8MiB，最多100页、1000单元、50000字符；超限整次停止，不静默截断。
      </p>
      <p>
        输出
        source、units、text、status、warnings；PDF以页、DOCX正文以段落、文本以行定位。先判断status并核对缺口，再明确选择供AI采用的内容。
      </p>
      <p>不自动OCR、不识别图片、不保留原排版，不执行宏或读取远程资源；解析成功不等于事实确认。</p>
    </section>
  );
}
