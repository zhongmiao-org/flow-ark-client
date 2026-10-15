import { Input, Select } from 'antd';
import { useId } from 'react';
import type { SkillNode } from '../shared/skill';
import type { Bindings } from '../shared/types';
import type { ReferenceChoice } from './value-references';
import ValueField from './ValueField';
import SkillPicker from './SkillPicker';
import './ai-node.css';
export default function SkillNodeConfiguration({
  node,
  choices,
  bindings,
  change,
  changeBindings,
}: {
  node: SkillNode;
  choices: ReferenceChoice[];
  bindings: Bindings;
  change: (n: SkillNode) => void;
  changeBindings: (b: Bindings) => void;
}) {
  const id = useId();
  return (
    <section className="node-configuration ai-node-configuration" aria-label="Skill工作区配置">
      <h4>Skill工作区</h4>
      <label>
        操作
        <Select
          aria-label="Skill操作"
          value={node.operation}
          options={[
            { value: 'propose', label: '创建待确认草稿' },
            { value: 'read', label: '读取固定确认版本' },
          ]}
          onChange={(operation) =>
            change(
              operation === 'read'
                ? { id: node.id, type: 'skill', version: 1, operation: 'read', binding: 'profile' }
                : {
                    id: node.id,
                    type: 'skill',
                    version: 1,
                    operation: 'propose',
                    binding: 'workspace',
                    key: 'personal-profile',
                    title: '个人Skill',
                    markdown: '',
                    data: {},
                    evidence: [],
                    base: null,
                  },
            )
          }
        />
      </label>
      <label htmlFor={id}>
        {node.operation === 'read' ? '逻辑Skill资源' : '工作区逻辑目录'}
        <Input
          id={id}
          value={node.binding}
          onChange={(e) => change({ ...node, binding: e.target.value })}
        />
      </label>
      {node.operation === 'read' ? (
        <>
          <SkillPicker
            key={node.id + ':' + node.binding}
            disabled={!!bindings.template}
            value={bindings.resources?.[node.binding]}
            change={(binding) => {
              const resources = { ...bindings.resources };
              if (binding) resources[node.binding] = binding;
              else delete resources[node.binding];
              changeBindings({ ...bindings, resources });
            }}
          />
          <p>
            {bindings.template
              ? '在模板实例的资源页选择确认版本。'
              : '选择本机已登记的准确版本；不读取草稿。'}{' '}
            输出ref、markdown、data、evidence与确认时间。
          </p>
        </>
      ) : (
        <>
          {(
            [
              ['Skill键', 'key'],
              ['版本标题', 'title'],
              ['SKILL.md正文', 'markdown'],
              ['结构化内容', 'data'],
              ['来源记录', 'evidence'],
              ['父确认版本', 'base'],
            ] as const
          ).map(([label, key]) => (
            <ValueField
              key={key}
              label={label}
              value={node[key] ?? null}
              choices={choices}
              jsonDefault={key === 'data' ? {} : key === 'evidence' ? [] : undefined}
              change={(value) => change({ ...node, [key]: value })}
            />
          ))}
          <p>
            本节点仅保存待确认草稿，结束本批；请在参数与资源选择读写工作区。用户在“需要我处理”核对后，才写SKILL.md、data.json和清单到新版本目录。
          </p>
          <p>
            编辑与保存不调用模型，不覆盖旧版本。公开导出时正文、数据、来源和基线使用参数或前序引用，固定个人内容会阻止导出。
          </p>
        </>
      )}
    </section>
  );
}
