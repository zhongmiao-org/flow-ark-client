import { Alert, Button, Input } from 'antd';
import { useCallback, useId, useMemo, useState } from 'react';
import type { Json } from '../shared/types';
import { assertSkillDraft } from '../shared/skill';
import JsonTreeEditor from './JsonTreeEditor';

export default function SkillDataEditor({
  json,
  change,
  disabled,
  onPendingChange,
  pending,
}: {
  json: string;
  change: (json: string) => void;
  disabled: boolean;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const id = useId();
  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(json);
      if (!value || Object.keys(value).sort().join(',') !== 'data,evidence')
        throw Error('data.json须包含data对象和evidence数组。');
      assertSkillDraft({ title: '结构化内容', markdown: '待核对内容', ...value });
      return { value: value as { data: Record<string, Json>; evidence: Json[] } };
    } catch (e) {
      return {
        error:
          e instanceof SyntaxError
            ? 'JSON尚未完整或格式有误，当前输入保留。'
            : e instanceof Error
              ? e.message
              : 'JSON尚未完整，当前输入保留。',
      };
    }
  }, [json]);
  const [mode, setMode] = useState<'fields' | 'json'>(() => (parsed.value ? 'fields' : 'json'));
  const [error, setError] = useState('');
  const handlePending = useCallback(
    (value: boolean) => {
      onPendingChange(value);
      if (!value) setError('');
    },
    [onPendingChange],
  );
  const switchMode = (next: 'fields' | 'json') => {
    if (pending) {
      setError('请先应用当前字段，或放弃当前编辑。');
      return;
    }
    if (next === 'fields' && !parsed.value) {
      setError('请先修正高级JSON，输入会保留。');
      return;
    }
    setError('');
    setMode(next);
  };
  return (
    <div className="skill-data-editor">
      <div className="skill-actions" role="group" aria-label="结构化编辑方式">
        <Button
          type={mode === 'fields' ? 'primary' : 'default'}
          disabled={disabled}
          aria-pressed={mode === 'fields'}
          onClick={() => switchMode('fields')}
        >
          字段编辑
        </Button>
        <Button
          type={mode === 'json' ? 'primary' : 'default'}
          disabled={disabled}
          aria-pressed={mode === 'json'}
          onClick={() => switchMode('json')}
        >
          高级 JSON
        </Button>
      </div>
      {error && <Alert type="warning" title={error} role="alert" />}
      {mode === 'fields' && parsed.value ? (
        <JsonTreeEditor
          value={parsed.value.data}
          disabled={disabled}
          onPendingChange={handlePending}
          change={(data) => {
            const next = { data, evidence: parsed.value!.evidence };
            assertSkillDraft({ title: '结构化内容', markdown: '待核对内容', ...next });
            change(JSON.stringify(next, null, 2));
            setError('');
          }}
        />
      ) : (
        <>
          {parsed.error && (
            <Alert
              type="error"
              title={parsed.error}
              description="当前输入保留。修正后才能返回字段编辑、保存或试聊。"
              role="alert"
            />
          )}
          <label htmlFor={id}>完整data.json与来源记录</label>
          <Input.TextArea
            id={id}
            aria-invalid={!!parsed.error}
            data-value-invalid={parsed.error}
            disabled={disabled}
            value={json}
            autoSize={{ minRows: 10, maxRows: 24 }}
            onChange={(e) => {
              change(e.target.value);
              setError('');
            }}
          />
        </>
      )}
      <p className="json-data-help">
        来源记录原样保留，可在高级 JSON 中核对。先应用当前字段，再保存整个草稿。
      </p>
    </div>
  );
}
