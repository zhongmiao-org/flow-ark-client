import { Alert, Button, Card, Drawer, Empty, Select, Spin, Tag } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import type { Bootstrap, FlowRecord } from '../shared/types';
import { flatten, stepParameterNames } from './flow-editing';
import { taskStepTitle } from './task-step-presentation';
import EditorWorkspaceToolbar from './EditorWorkspaceToolbar';
import './editor-workspace-dialog.css';
import './step-position.css';
import './saved-flow-steps.css';

export type SavedStepSource = Pick<FlowRecord, 'id' | 'flow' | 'updatedAt' | 'versionId'>;
type Props = {
  target: FlowRecord;
  targets: { value: string; label: string }[];
  destination: string;
  busy: boolean;
  error: string;
  backLabel: string;
  apply: (source: SavedStepSource, destination: string) => boolean;
  parameters: () => void;
  close: () => void;
};

export default function SavedFlowStepsPage(props: Props) {
  const [records, setRecords] = useState<SavedStepSource[]>([]);
  const [source, setSource] = useState<SavedStepSource>();
  const [destination, setDestination] = useState(props.destination);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorPanel = useRef<HTMLDivElement>(null);
  const origin = useRef(document.activeElement as HTMLElement | null);
  const locked = useRef(false);
  const titleId = useId();
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError('');
    setRecords([]);
    setSource(undefined);
    void window.flowark
      .request('bootstrap', {})
      .then((data: Bootstrap) => {
        if (!current) return;
        if (data.fault) {
          setLoadError('本机流程记录暂时不可读，请先处理本地存储提示。');
          return;
        }
        setRecords(
          data.flows
            .filter((record) => record.id !== props.target.id)
            .map(({ id, flow, updatedAt, versionId }) => ({
              id,
              flow: structuredClone(flow),
              updatedAt,
              versionId,
            })),
        );
      })
      .catch(() => {
        if (current) setLoadError('读取已保存流程失败。可重新读取，当前草稿保持不变。');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [props.target.id, reload]);
  useEffect(() => {
    if (loadError || props.error) errorPanel.current?.focus();
  }, [loadError, props.error]);
  useEffect(() => {
    const trigger = origin.current;
    return () => {
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, []);
  const nodes = source ? flatten(source.flow.steps) : [];
  const parameters = source ? stepParameterNames(source.flow.steps) : [];
  const missing = parameters.filter((name) => !Object.hasOwn(props.target.flow.parameters, name));
  const validDestination = props.targets.some((target) => target.value === destination);
  const error = loadError || props.error;
  return (
    <Drawer
      open
      size="calc(100vw - var(--fa-workspace-navigation-width))"
      closable={false}
      mask={{ closable: false }}
      push={false}
      focusable={{ focusTriggerAfterClose: false, trap: true }}
      rootClassName="editor-workspace-overlay"
      className="editor-workspace-dialog"
      keyboard={!props.busy}
      aria-labelledby={titleId}
      onClose={() => !props.busy && props.close()}
      afterOpenChange={(opened) => opened && heading.current?.focus()}
    >
      <EditorWorkspaceToolbar
        current="从已有流程添加步骤"
        backLabel={props.backLabel}
        back={props.close}
        disabled={props.busy}
      />
      <div className="step-position-page saved-flow-steps-page">
        <header>
          <h1 id={titleId} ref={heading} tabIndex={-1}>
            从已有流程添加步骤
          </h1>
          <p>使用已保存快照；添加后可撤销，不自动保存或运行。</p>
        </header>
        {error && (
          <div ref={errorPanel} tabIndex={-1} role="alert">
            <Alert type="error" showIcon title={error} />
          </div>
        )}
        <div className="step-position-columns">
          <section className="step-position-card" aria-label="选择来源和添加位置">
            <Card>
              <h2>选择来源和添加位置</h2>
              <label>
                来源流程
                <Select
                  aria-label="来源流程"
                  placeholder="选择一个已保存流程"
                  showSearch
                  optionFilterProp="label"
                  value={source?.id}
                  disabled={loading || props.busy}
                  onChange={(id) => setSource(records.find((record) => record.id === id))}
                  options={records.map((record) => ({
                    value: record.id,
                    label: `${record.flow.name} · ${flatten(record.flow.steps).length}个步骤 · ${new Date(record.updatedAt).toLocaleString()}`,
                  }))}
                />
              </label>
              <Button
                disabled={loading || props.busy}
                onClick={() => {
                  setLoading(true);
                  setSource(undefined);
                  setReload((value) => value + 1);
                }}
              >
                重新读取列表
              </Button>
              <label>
                添加到
                <Select
                  aria-label="已有流程步骤添加位置"
                  value={validDestination ? destination : undefined}
                  placeholder="重新选择添加位置"
                  status={validDestination ? undefined : 'error'}
                  options={props.targets}
                  disabled={props.busy}
                  onChange={setDestination}
                />
              </label>
              {loading ? (
                <Spin description="读取已保存流程…" />
              ) : !records.length && !loadError ? (
                <Empty description="还没有其他已保存流程。先保存一个来源流程，再重新读取。" />
              ) : source ? (
                <>
                  <p>
                    来源快照 · {new Date(source.updatedAt).toLocaleString()}保存 ·{' '}
                    {source.versionId ? '已有保存版本' : '已保存草稿'}
                  </p>
                  {nodes.length ? (
                    <ol className="saved-flow-step-list" aria-label="来源完整步骤">
                      {nodes.map((node) => (
                        <li key={node.id}>{taskStepTitle(node)}</li>
                      ))}
                    </ol>
                  ) : (
                    <Empty description="来源流程没有可添加的步骤" />
                  )}
                  <p>完整保留条件、循环及其步骤引用。</p>
                </>
              ) : (
                <p>选择来源后，先查看已保存步骤和参数要求。</p>
              )}
            </Card>
          </section>
          <section className="step-position-card" aria-label="核对目标参数与资源">
            <Card>
              <h2>核对目标参数与资源</h2>
              {source && (
                <>
                  <p>
                    {parameters.length
                      ? `需要参数：${parameters.join('、')}`
                      : '来源步骤未引用运行参数。'}
                  </p>
                  {missing.length ? (
                    <Alert
                      type="warning"
                      showIcon
                      title={`目标缺少参数：${missing.join('、')}`}
                      description="先在目标“参数与绑定”中添加或绑定，再重新核对。不会复制来源参数值。"
                    />
                  ) : (
                    <Tag color="success">所需参数已定义，使用目标当前值</Tag>
                  )}
                </>
              )}
              <p>请核对同名参数的含义。来源的参数值、资源、凭据与授权不会带入。</p>
              <p>添加后在目标入口核对所需资源、动作和提示词。</p>
              <Button
                type="primary"
                disabled={
                  props.busy ||
                  loading ||
                  !source ||
                  !nodes.length ||
                  !!missing.length ||
                  !validDestination
                }
                onClick={() => {
                  if (!source || locked.current) return;
                  locked.current = true;
                  if (!props.apply(source, destination)) locked.current = false;
                }}
              >
                {!source
                  ? '先选择来源流程'
                  : missing.length
                    ? '先补齐目标参数'
                    : `添加全部${nodes.length}个步骤`}
              </Button>
              {missing.length > 0 && (
                <Button disabled={props.busy} onClick={props.parameters}>
                  打开目标参数
                </Button>
              )}
              <Button disabled={props.busy} onClick={props.close}>
                {props.backLabel}
              </Button>
              <p>每次添加生成独立步骤；源流程后续变更不会自动跟随。</p>
            </Card>
          </section>
        </div>
      </div>
    </Drawer>
  );
}
