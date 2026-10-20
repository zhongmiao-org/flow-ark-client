import { assertBrowserScrollResult } from '../shared/browser-scroll';
import BrowserScrollResultView from './BrowserScrollResultView';
import TechnicalDetails from './TechnicalDetails';
import type { Flow } from '../shared/types';
import { runInstancePresenter } from './run-instance-presentation';
import CompleteValue from './CompleteValue';
import { resultBudget } from '../shared/run-result-source';
import { run_result_read_v1 } from '../shared/node-schema.generated';
import { browserDigest } from '../shared/conversation-archive';
import SourceReductionPanel from './SourceReductionPanel';
import { verifyReductionOutput } from '../shared/source-reduction';
import { useEffect, useState } from 'react';
import { Alert, Button, Select } from 'antd';
import { assertDocumentResult } from '../shared/document';
import { assertSkillVersion } from '../shared/skill';
import { assertConversationOutput } from '../shared/conversation';
import { assertThreadOutput } from '../shared/conversation-thread';
import ConversationResultView from './ConversationResultView';
import { DocumentResultView } from './DocumentResults';
import { SkillVersionView } from './SkillPanel';
import { assertDataOutput } from '../shared/template-data';
import ContextResultView from './ContextResultView';
import { assertBrowserInspectionResult } from '../shared/browser-inspection';
import { assertBrowserTargetResult } from '../shared/browser-target';
import { assertBrowserFieldsValue } from '../shared/browser-fields';
import BrowserFieldsResultView from './BrowserFieldsResultView';
import type { TypedResultMeta } from '../host/typed-results';
import { verifySourceResult } from '../shared/conversation-source';
import SourceResultView from './SourceResultView';
import EffectResultView from './EffectResultView';
import { assertEffectResult } from '../shared/effect-node';
import ResultCapacity from './ResultCapacity';
export default function TypedRunResults({
  runId,
  entries,
  snapshot,
  rerun,
  openRun,
}: {
  runId: string;
  entries: TypedResultMeta[];
  snapshot?: Flow;
  rerun?: () => void;
  openRun?: (detail: any) => void;
}) {
  const [selected, setSelected] = useState(entries[0]?.id),
    [value, setValue] = useState<any>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const id = entries.some((e) => e.id === selected) ? selected : entries[0]?.id;
  useEffect(() => {
    let live = true;
    setValue(undefined);
    setError('');
    if (!id) return;
    void window.flowark
      .request('run.typedResult', { runId, id })
      .then(async (v) => {
        if (v.type === 'run-result') {
          if (
            !resultBudget(v.value) ||
            !run_result_read_v1(v.value) ||
            (await browserDigest(v.value.value)) !== v.value.ref.dataSha256
          )
            throw Error('完整读取结果核对失败');
        } else if (v.type === 'effect') assertEffectResult(v.value);
        else if (v.type === 'source-reduce') await verifyReductionOutput(v.value);
        else if (v.type === 'source') await verifySourceResult(v.value);
        else if (v.type === 'document') assertDocumentResult(v.value);
        else if (v.type === 'skill') assertSkillVersion(v.value);
        else if (v.type === 'context') assertDataOutput(v.value);
        else if (v.type === 'conversation') {
          if (v.value?.formatVersion === '2.0') assertThreadOutput(v.value);
          else assertConversationOutput(v.value);
        } else if (v.type === 'browser') {
          if (v.operation === 'scroll') assertBrowserScrollResult(v.value, v.value);
          else if (v.operation === 'collect') assertBrowserFieldsValue(v.value);
          else if (['read', 'click', 'wait'].includes(v.operation))
            assertBrowserTargetResult(v.operation, v.value);
          else assertBrowserInspectionResult(v.operation, v.value);
        } else throw Error('结果类型无效');
        if (live) setValue(v);
      })
      .catch((e) => {
        if (live) setError(e.message ?? '完整结果读取失败');
      });
    return () => {
      live = false;
    };
  }, [runId, id, revision]);
  if (!entries.length) return null;
  return (
    <section aria-label="本次完整结构化结果">
      <ResultCapacity key={runId} entries={entries} />
      {entries.length > 1 && (
        <Select
          aria-label="选择结构化步骤结果"
          value={id}
          options={entries.map((e, index) => ({
            value: e.id,
            label:
              runInstancePresenter(snapshot)(e.nodeInstance) ??
              `第 ${index + 1} 项结果 · 位置待核对`,
          }))}
          onChange={setSelected}
        />
      )}
      <p>完整来源与内容保存在本机加密记录中；普通日志和通用输出继续脱敏。</p>
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={() => setRevision((v) => v + 1)}>重新读取结果</Button>}
        />
      )}{' '}
      {value?.type === 'document' && <DocumentResultView key={id} value={value.value} />}{' '}
      {value?.type === 'skill' && <SkillVersionView value={value.value} />}
      {value?.type === 'source-reduce' && (
        <SourceReductionPanel
          key={id}
          target={{ runId, nodeId: value.nodeId, nodeInstance: value.nodeInstance }}
          initial={value.value}
          rerun={rerun}
          openRun={openRun}
        />
      )}
      {value?.type === 'run-result' && (
        <section className="result-read-view" aria-label="已读取固定的前次结果">
          <h3>已读取固定的前次结果</h3>
          <p>已读取你选择并固定的来源运行</p>
          <p>凭据字段已过滤 · 固定结构核验通过</p>
          <TechnicalDetails
            items={[
              { label: '来源入口 ID', value: value.value.ref.source.entryId },
              { label: '来源运行 ID', value: value.value.ref.run.id },
              { label: '数据摘要', value: value.value.ref.dataSha256 },
            ]}
          />
          <CompleteValue key={id} value={value.value.value} labels={value.value.labels} />
          <p>本步骤仅读取；后续动作仍须按当前事实、配置和权限核对。</p>
          {openRun && (
            <Button
              onClick={() =>
                void window.flowark
                  .request('run.detail', { id: value.value.ref.run.id })
                  .then(openRun)
                  .catch((e) => setError(e.message))
              }
            >
              查看来源运行
            </Button>
          )}
        </section>
      )}
      {value?.type === 'source' && (
        <SourceResultView runId={runId} nodeId={value.nodeId} value={value.value} />
      )}
      {value?.type === 'context' && <ContextResultView key={id} value={value.value} />}
      {value?.type === 'effect' && (
        <EffectResultView key={id} value={value.value} openRun={openRun} />
      )}
      {value?.type === 'conversation' && <ConversationResultView value={value.value} />}
      {value?.type === 'browser' && value.operation === 'collect' && (
        <BrowserFieldsResultView key={id} value={value.value} />
      )}
      {value?.type === 'browser' && value.operation === 'scroll' && (
        <BrowserScrollResultView value={value.value} />
      )}
      {value?.type === 'browser' &&
        value.operation !== 'collect' &&
        value.operation !== 'scroll' && (
          <section
            aria-label={
              ['read', 'click', 'wait'].includes(value.operation)
                ? '完整网页目标结果'
                : '完整网页只读结果'
            }
          >
            <p>
              {value.operation === 'read'
                ? '本次绑定唯一可见目标的完整文字'
                : value.operation === 'click'
                  ? '已调用点击；业务结果仍未核对，不会自动再次点击'
                  : value.operation === 'wait'
                    ? '本次绑定目标已可见'
                    : value.operation === 'url'
                      ? '当前顶层页面实际地址'
                      : value.operation === 'count'
                        ? '匹配数量；0表示当前范围没有匹配'
                        : value.value === null
                          ? '该元素没有此属性（null）'
                          : value.value === ''
                            ? '属性存在，值为空文本（""）'
                            : '唯一元素的原始DOM属性'}
            </p>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: 320,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(value.value, null, 2)}
            </pre>
            <p>本次独立观察不代表账号、职位或外部动作已核对。</p>
          </section>
        )}
    </section>
  );
}
