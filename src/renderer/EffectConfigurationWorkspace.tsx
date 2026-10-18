import { Drawer } from 'antd';
import { useEffect, useId, useRef } from 'react';
import type { FlowRecord } from '../shared/types';
import type { EffectNode } from '../shared/effect-node';
import { effectOperations } from '../shared/effect-node';
import { referenceChoices } from './value-references';
import EffectNodeConfiguration from './EffectNodeConfiguration';
import EditorWorkspaceToolbar from './EditorWorkspaceToolbar';
import './editor-workspace-dialog.css';
import './resource-workspace.css';

export default function EffectConfigurationWorkspace({
  record,
  node,
  change,
  guard,
  close,
  showBrowser,
}: {
  record: FlowRecord;
  node: EffectNode;
  change: (node: EffectNode) => void;
  guard: () => boolean;
  close: () => void;
  showBrowser: () => void;
}) {
  const id = useId(),
    heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const trigger = origin.current;
    return () => {
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, []);
  const finish = () => {
    if (guard()) close();
  };
  return (
    <Drawer
      open
      size="calc(100vw - var(--fa-workspace-navigation-width))"
      closable={false}
      mask={{ closable: false }}
      push={false}
      focusable={{ focusTriggerAfterClose: false, trap: true }}
      rootClassName="editor-workspace-overlay"
      className="editor-workspace-dialog resource-workspace"
      aria-labelledby={id}
      onClose={finish}
      afterOpenChange={(opened) => {
        if (opened) heading.current?.focus();
      }}
    >
      <EditorWorkspaceToolbar
        current="操作记录配置"
        back={finish}
        showBrowser={() => {
          if (guard()) showBrowser();
        }}
      />
      <div className="resource-workspace-page">
        <header>
          <h1 id={id} ref={heading} tabIndex={-1}>
            操作记录 / {effectOperations[node.operation]}
          </h1>
          <p>在此配置声明动作、完整回执和核对内容。返回编排页后保存流程。</p>
        </header>
        <EffectNodeConfiguration
          node={node}
          record={record}
          choices={referenceChoices(record.flow, node.id)}
          change={change}
          guard={guard}
        />
      </div>
    </Drawer>
  );
}
