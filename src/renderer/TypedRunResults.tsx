import { useEffect, useState } from 'react';
import { Alert, Button, Select } from 'antd';
import { assertDocumentResult } from '../shared/document';
import { assertSkillVersion } from '../shared/skill';
import { assertConversationOutput } from '../shared/conversation';
import ConversationResultView from './ConversationResultView';
import { DocumentResultView } from './DocumentResults';
import { SkillVersionView } from './SkillPanel';
import { assertDataOutput } from '../shared/template-data';
import ContextResultView from './ContextResultView';
import type { TypedResultMeta } from '../host/typed-results';
export default function TypedRunResults({
  runId,
  entries,
}: {
  runId: string;
  entries: TypedResultMeta[];
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
      .then((v) => {
        if (v.type === 'document') assertDocumentResult(v.value);
        else if (v.type === 'skill') assertSkillVersion(v.value);
        else if (v.type === 'context') assertDataOutput(v.value);
        else if (v.type === 'conversation') assertConversationOutput(v.value);
        else throw Error('结果类型无效');
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
      {value?.type === 'context' && <ContextResultView value={value.value} />}
      {value?.type === 'conversation' && <ConversationResultView value={value.value} />}
    </section>
  );
}
