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
import { assertBrowserFieldsValue } from '../shared/browser-fields';
import BrowserFieldsResultView from './BrowserFieldsResultView';
import type { TypedResultMeta } from '../host/typed-results';
import { verifySourceResult } from '../shared/conversation-source';
import SourceResultView from './SourceResultView';
export default function TypedRunResults({
  runId,
  entries,
  rerun,
  openRun,
}: {
  runId: string;
  entries: TypedResultMeta[];
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
        if (v.type === 'source-reduce') await verifyReductionOutput(v.value);
        else if (v.type === 'source') await verifySourceResult(v.value);
        else if (v.type === 'document') assertDocumentResult(v.value);
        else if (v.type === 'skill') assertSkillVersion(v.value);
        else if (v.type === 'context') assertDataOutput(v.value);
        else if (v.type === 'conversation') {
          if (v.value?.formatVersion === '2.0') assertThreadOutput(v.value);
          else assertConversationOutput(v.value);
        } else if (v.type === 'browser') {
          if (v.operation === 'collect') assertBrowserFieldsValue(v.value);
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
      {entries.length > 1 && (
        <Select
          aria-label="选择结构化步骤结果"
          value={id}
          options={entries.map((e) => ({ value: e.id, label: e.label + ' · ' + e.nodeInstance }))}
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
      {value?.type === 'source' && (
        <SourceResultView runId={runId} nodeId={value.nodeId} value={value.value} />
      )}
      {value?.type === 'context' && <ContextResultView value={value.value} />}
      {value?.type === 'conversation' && <ConversationResultView value={value.value} />}
      {value?.type === 'browser' && value.operation === 'collect' && (
        <BrowserFieldsResultView key={id} value={value.value} />
      )}
      {value?.type === 'browser' && value.operation !== 'collect' && (
        <section aria-label="完整网页只读结果">
          <p>
            {value.operation === 'url'
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
