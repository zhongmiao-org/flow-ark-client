import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Select } from 'antd';
import type { Bindings } from '../shared/types';
export type SkillChoice = {
  id: string;
  title: string;
  ref: import('../shared/skill').SkillVersionRef;
  parent: import('../shared/skill').SkillVersionRef | null;
  confirmedAt: string;
  workspace: string;
  binding: NonNullable<Bindings['resources']>[string];
};
export default function SkillPicker({
  value,
  change,
  disabled = false,
  label = '固定确认版本',
}: {
  value?: NonNullable<Bindings['resources']>[string];
  change: (v: NonNullable<Bindings['resources']>[string] | undefined) => void;
  disabled?: boolean;
  label?: string;
}) {
  const generation = useRef(0),
    changeRef = useRef(change);
  changeRef.current = change;
  const [selecting, setSelecting] = useState(false);
  useEffect(() => {
    generation.current++;
    setSelecting(false);
    return () => {
      generation.current++;
    };
  }, [value?.path, value?.skill?.versionId, value?.skill?.sha256]);
  const [choices, setChoices] = useState<SkillChoice[]>([]),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    void window.flowark
      .request('skill.list')
      .then((v) => {
        if (live) {
          setChoices(v);
          setError('');
        }
      })
      .catch(() => {
        if (live) setError('确认版本列表未读取，原绑定保留。');
      });
    return () => {
      live = false;
    };
  }, [revision]);
  const selected = choices.find(
    (v) =>
      v.binding.path === value?.path &&
      v.ref.versionId === value?.skill?.versionId &&
      v.ref.sha256 === value?.skill?.sha256,
  )?.id;
  return (
    <div className="skill-picker">
      <Select
        aria-label={label}
        disabled={disabled || selecting}
        value={selected ?? (value?.skill ? 'original' : '')}
        onChange={(id) => {
          const next = choices.find((v) => v.id === id);
          const visit = ++generation.current;
          if (!id) {
            changeRef.current(undefined);
            return;
          }
          if (!next) return;
          setSelecting(true);
          setError('');
          void window.flowark
            .request('skill.inspectBinding', { path: next.workspace, ref: next.ref })
            .then(() => {
              if (visit === generation.current) changeRef.current(next.binding);
            })
            .catch(() => {
              if (visit === generation.current)
                setError('此版本文件不可用或已变化，原绑定保留；请核对工作区。');
            })
            .finally(() => {
              if (visit === generation.current) setSelecting(false);
            });
        }}
        options={[
          { value: '', label: '尚未选择确认版本' },
          ...(!selected && value?.skill
            ? [
                {
                  value: 'original',
                  label: '原绑定 · ' + value.skill.key + ' / ' + value.skill.versionId,
                  disabled: true,
                },
              ]
            : []),
          ...choices.map((v) => ({
            value: v.id,
            label:
              v.title +
              ' · ' +
              v.ref.key +
              ' / ' +
              v.ref.versionId.slice(-8) +
              ' · ' +
              v.ref.sha256.slice(0, 8),
          })),
        ]}
      />
      <Button disabled={disabled} onClick={() => setRevision((v) => v + 1)}>
        刷新确认版本
      </Button>
      {error && <Alert type="error" title={error} />}
      <p>固定选择版本，运行前复验文件；新版本不会自动替换此绑定。确认Skill不授予模型或外发权限。</p>
    </div>
  );
}
