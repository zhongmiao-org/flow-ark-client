import ActionButton from './ActionButton';
import { Card, Alert, Drawer, Collapse, Descriptions, Select, Button } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import EditorWorkspaceToolbar from './EditorWorkspaceToolbar';
import type { FlowRecord } from '../shared/types';
import type { ScriptNode } from './script-editor';
import ValueField from './ValueField';
import ScriptPackages, {
  scriptPackageReviewSource,
  type ScriptPackageReview,
} from './ScriptPackages';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { flowOutline } from './flow-outline';
import { taskStepTitle } from './task-step-title';
import { referenceChoices } from './value-references';
import './editor-workspace-dialog.css';
import './resource-workspace.css';
import './script-configuration-workspace.css';

type Props = {
  record: FlowRecord;
  node: ScriptNode;
  change: (node: ScriptNode) => void;
  bind: (info: { name: string; version: string; path: string }) => boolean;
  remove: (name: string) => boolean;
  guard: () => boolean;
  close: () => void;
  openEditor: (preview?: boolean) => void;
  openParameters: () => void;
  showBrowser: () => void;
  error: string;
  clearError: () => void;
};
export default function ScriptConfigurationWorkspace(props: Props) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const origin = useRef(document.activeElement as HTMLElement | null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [packageReview, setPackageReview] = useState<ScriptPackageReview>();
  const currentReview =
    packageReview?.source ===
    scriptPackageReviewSource(props.record.id, props.node, props.record.bindings)
      ? packageReview
      : undefined;
  const ordinal = flowOutline(props.record.flow.steps).byId.get(props.node.id)?.ordinal;
  const template = props.record.bindings.template;
  const resources = Object.entries(props.record.bindings.resources ?? {}).filter(
    ([, resource]) => resource.provider,
  );
  const missing = props.node.dependencies.filter(
    (dep) => !props.record.bindings.scriptPackages?.[dep.name]?.path,
  );
  const mismatched = props.node.dependencies.filter((dep) => {
    const binding = props.record.bindings.scriptPackages?.[dep.name];
    return binding?.path && binding.version !== dep.version;
  });
  const bindingStatus =
    [
      missing.length ? `${missing.length} 个缺少目录` : '',
      mismatched.length ? `${mismatched.length} 个版本不一致` : '',
      currentReview?.reading
        ? '正在读取包信息…'
        : currentReview && (currentReview.passed || currentReview.failed)
          ? [
              currentReview.passed ? `${currentReview.passed} 个目录名称与版本已核对` : '',
              currentReview.failed ? `${currentReview.failed} 个目录核对失败` : '',
              currentReview.unchecked ? `${currentReview.unchecked} 个尚未核对` : '',
            ]
              .filter(Boolean)
              .join('；')
          : '',
    ]
      .filter(Boolean)
      .join('；') ||
    (props.node.dependencies.length ? '已绑定 · 本次尚未核对目录' : '未声明第三方依赖');
  const navigate = (next: () => void) => {
    if (props.guard()) next();
  };
  useEffect(() => {
    const trigger = origin.current;
    return () => {
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <Drawer
      open
      panelRef={dialog}
      size="calc(100vw - var(--fa-workspace-navigation-width))"
      closable={false}
      mask={{ closable: false }}
      push={false}
      focusable={{ focusTriggerAfterClose: false, trap: true }}
      rootClassName="editor-workspace-overlay"
      afterOpenChange={(opened) => {
        if (opened) heading.current?.focus();
      }}
      className="editor-workspace-dialog resource-workspace script-configuration-workspace"
      aria-labelledby={id}
      onClose={() => {
        navigate(props.close);
      }}
      onKeyDown={(event) => {
        if ((event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[')) {
          if (
            (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          navigate(props.close);
        }
      }}
    >
      <EditorWorkspaceToolbar
        current="脚本与依赖配置"
        back={() => navigate(props.close)}
        showBrowser={() => navigate(props.showBrowser)}
      />
      <div className="resource-workspace-page">
        <header>
          <h1 id={id} ref={heading} tabIndex={-1}>
            脚本与依赖配置
          </h1>
          <p>
            当前步骤：{ordinal ? `${String(ordinal).padStart(2, '0')} ` : ''}
            {taskStepTitle(props.node)}。配置脚本、输入与本地依赖，应用后返回编排页保存。
          </p>
        </header>
        {props.error && (
          <Alert
            type="error"
            showIcon
            title={props.error}
            action={<Button onClick={props.clearError}>关闭提示</Button>}
          />
        )}
        <div className="resource-workspace-grid">
          <section aria-label="JS / TS 脚本">
            <Card className="resource-workspace-card">
              <h2>JS / TS 脚本</h2>
              <div className="script-configuration-field">
                <label htmlFor={id + '-language'}>语言</label>
                <Select<string>
                  id={id + '-language'}
                  value={props.node.language}
                  onChange={(value) =>
                    navigate(() => props.change({ ...props.node, language: value as 'js' | 'ts' }))
                  }
                  options={[
                    { value: 'ts', label: 'TypeScript' },
                    { value: 'js', label: 'JavaScript' },
                  ]}
                />
              </div>
              <Descriptions
                colon={false}
                className="script-configuration-summary"
                column={1}
                layout="vertical"
                size="small"
                items={[['入口', 'export default 的函数 · 接收 ctx']].map(([label, text]) => ({
                  key: label,
                  label,
                  children: <span title={text}>{text}</span>,
                }))}
              />
              <ValueField
                compactReference
                label="脚本输入"
                value={props.node.input}
                choices={referenceChoices(props.record.flow, props.node.id)}
                defaultValue={{}}
                change={(input) => props.change({ ...props.node, input })}
              />
              <Button type="primary" onClick={() => navigate(props.close)}>
                应用配置
              </Button>
            </Card>
          </section>
          <section aria-label="脚本正文">
            <Card className="resource-workspace-card">
              <h2>脚本正文</h2>
              <Descriptions
                colon={false}
                className="script-configuration-summary"
                column={1}
                layout="vertical"
                size="small"
                items={[
                  ['当前代码', props.node.code.trim().split('\n')[0] || '尚未编写'],
                  ['输出', '函数返回值成为步骤输出'],
                  ['定位错误', '编辑器可检查语法并定位行列'],
                ].map(([label, text]) => ({
                  key: label,
                  label,
                  children: <span title={text}>{text}</span>,
                }))}
              />
              <ActionButton
                hint="打开完整脚本编辑器，编辑正文与输入"
                aria-label="打开脚本编辑器"
                type="primary"
                onClick={() => navigate(() => props.openEditor())}
              >
                编辑脚本
              </ActionButton>
            </Card>
          </section>
          <section aria-label="依赖检查">
            <Card className="resource-workspace-card">
              <h2>依赖检查</h2>
              <Descriptions
                colon={false}
                className="script-configuration-summary"
                column={1}
                layout="vertical"
                size="small"
                items={[
                  [
                    '依赖',
                    props.node.dependencies.length
                      ? `${props.node.dependencies.length} 个精确版本依赖`
                      : '仅内置 SDK',
                  ],
                  ['绑定状态', bindingStatus],
                  ['运行中', '不自动安装依赖'],
                ].map(([label, text]) => ({
                  key: label,
                  label,
                  children: <span title={text}>{text}</span>,
                }))}
              />
              <Collapse
                className="script-configuration-packages"
                size="small"
                items={[
                  {
                    key: 'packages',
                    label: '配置与核对本地依赖',
                    forceRender: true,
                    onKeyDown: activateCollapseWithSpace,
                    children: (
                      <ScriptPackages
                        flowId={props.record.id}
                        node={props.node}
                        bindings={props.record.bindings}
                        guard={props.guard}
                        bind={props.bind}
                        remove={props.remove}
                        onReviewChange={setPackageReview}
                      />
                    ),
                  },
                ]}
              />
            </Card>
          </section>
          <section aria-label="模板内脚本">
            <Card className="resource-workspace-card">
              <h2>模板内脚本</h2>
              <Descriptions
                colon={false}
                className="script-configuration-summary"
                column={1}
                layout="vertical"
                size="small"
                items={[
                  ['来源', template?.packageKey || '本地流程 · 无模板来源'],
                  ['入口', template?.entryId || '当前流程脚本节点'],
                  ['执行', '独立受监督进程 · 可信代码'],
                ].map(([label, text]) => ({
                  key: label,
                  label,
                  children: <span title={text}>{text}</span>,
                }))}
              />
              {template ? (
                <Collapse
                  className="script-configuration-source"
                  size="small"
                  items={[
                    {
                      key: 'source',
                      label: '查看固定来源',
                      forceRender: true,
                      onKeyDown: activateCollapseWithSpace,
                      children: (
                        <>
                          <Descriptions
                            colon={false}
                            className="script-configuration-summary"
                            column={1}
                            layout="vertical"
                            size="small"
                            items={[
                              { key: 'instance', label: '实例', children: template.instanceId },
                              { key: 'digest', label: '内容摘要', children: template.digest },
                            ]}
                          />
                          <p>权限与资源由该模板入口声明，运行前核对绑定和授权。</p>
                        </>
                      ),
                    },
                  ]}
                />
              ) : (
                <p className="script-configuration-footnote">
                  此节点不属于模板入口，未附加模板权限。
                </p>
              )}
            </Card>
          </section>
          <section aria-label="日志与进度">
            <Card className="resource-workspace-card">
              <h2>日志与进度</h2>
              <Descriptions
                colon={false}
                className="script-configuration-summary"
                column={1}
                layout="vertical"
                size="small"
                items={[
                  ['日志', '统一脱敏后展示'],
                  ['进度', '仅展示实际报告的数量'],
                  ['取消', '协作取消，超时回收进程'],
                ].map(([label, text]) => ({
                  key: label,
                  label,
                  children: <span title={text}>{text}</span>,
                }))}
              />
              <ActionButton
                hint="打开脚本编辑器查看历史输出；不会重新执行脚本"
                aria-label="打开编辑器查看历史输出"
                type="primary"
                onClick={() => navigate(() => props.openEditor(true))}
              >
                历史输出
              </ActionButton>
            </Card>
          </section>
          <section aria-label="AI 调用边界">
            <Card className="resource-workspace-card">
              <h2>AI 调用边界</h2>
              <Descriptions
                colon={false}
                className="script-configuration-summary"
                column={1}
                layout="vertical"
                size="small"
                items={[
                  ['入口', template ? '当前模板入口 / 可信脚本 SDK' : '可信脚本 SDK'],
                  [
                    '资源',
                    resources.length
                      ? resources
                          .map(
                            ([name, value]) =>
                              `${name} · ${value.provider} / ${value.model || '未设置模型'}`,
                          )
                          .join('；')
                      : '当前流程未绑定 AI 资源',
                  ],
                  ['规则', '业务提示词归模板，调用前核对授权'],
                ].map(([label, text]) => ({
                  key: label,
                  label,
                  children: <span title={text}>{text}</span>,
                }))}
              />
              {resources.length > 0 && (
                <Collapse
                  className="script-configuration-source"
                  size="small"
                  items={[
                    {
                      key: 'ai',
                      label: '查看全部 AI 绑定',
                      forceRender: true,
                      onKeyDown: activateCollapseWithSpace,
                      children: (
                        <>
                          {resources.map(([name, resource]) => (
                            <p key={name}>
                              {name}：{resource.provider} / {resource.model || '未设置模型'}
                            </p>
                          ))}
                          <p>仅展示当前绑定，不表示密钥可用或 API 已验证。</p>
                        </>
                      ),
                    },
                  ]}
                />
              )}
              <ActionButton
                hint="查看当前流程的参数和资源绑定"
                aria-label="查看参数与资源"
                type="primary"
                onClick={() => navigate(props.openParameters)}
              >
                参数与资源
              </ActionButton>
            </Card>
          </section>
        </div>
      </div>
    </Drawer>
  );
}
