import { recordTime } from './readable-labels';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Select } from 'antd';
import type { Bindings } from '../shared/types';
import type { SkillRestorePreview } from '../shared/skill';
const restoreReason = (reason: unknown, fallback: string) =>
  (reason instanceof Error ? reason.message : fallback).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );
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
  const restoreRef = useRef<SkillRestorePreview | null>(null);
  const [restore, setRestore] = useState<SkillRestorePreview | null>(null),
    [restoreReviewed, setRestoreReviewed] = useState(false);
  const restoreRequest = useRef('');
  const cancelRestore = () => {
    const original = restoreRef.current;
    restoreRef.current = null;
    if (original)
      void window.flowark
        .request('skill.restore.cancel', { token: original.token })
        .catch(() => {});
  };
  useEffect(() => {
    generation.current++;
    setSelecting(false);
    setRestore(null);
    cancelRestore();
    return () => {
      generation.current++;
      cancelRestore();
    };
  }, [disabled, value?.path, value?.skill?.versionId, value?.skill?.sha256]);
  const [choices, setChoices] = useState<SkillChoice[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
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
  const selectedChoice = choices.find(
    (v) =>
      v.binding.path === value?.path &&
      v.ref.versionId === value?.skill?.versionId &&
      v.ref.sha256 === value?.skill?.sha256,
  );
  const selected = selectedChoice?.id;
  const chooseSaved = async () => {
    if (disabled || selecting || restoreRef.current) return;
    const visit = ++generation.current;
    setSelecting(true);
    setError('');
    setNotice('');
    try {
      const path = await window.flowark.request('file.choose', { kind: 'file' });
      if (!path || visit !== generation.current) return;
      const preview: SkillRestorePreview = await window.flowark.request('skill.restore.preview', {
        path,
      });
      if (visit !== generation.current) {
        void window.flowark
          .request('skill.restore.cancel', { token: preview.token })
          .catch(() => {});
        return;
      }
      restoreRequest.current = crypto.randomUUID();
      restoreRef.current = preview;
      setRestore(preview);
      setRestoreReviewed(false);
    } catch (reason) {
      if (visit === generation.current)
        setError(restoreReason(reason, '未读取到完整确认版本') + '；原绑定保留。');
    } finally {
      if (visit === generation.current) setSelecting(false);
    }
  };
  const confirmSaved = async () => {
    if (disabled || selecting || !restoreReviewed || !restore) return;
    const visit = ++generation.current;
    setSelecting(true);
    setError('');
    try {
      const result = await window.flowark.request('skill.restore.confirm', {
        token: restore.token,
        requestId: restoreRequest.current,
        reviewed: true,
      });
      if (visit !== generation.current) return;
      const updated = await window.flowark.request('skill.list');
      if (visit !== generation.current) return;
      setChoices(updated);
      restoreRef.current = null;
      setRestore(null);
      changeRef.current(result.binding);
      setNotice(
        '已核对登记原确认版本，文件与确认时间保持。保存资源后使用，不会自动运行或调用模型。',
      );
    } catch (reason) {
      if (visit === generation.current)
        setError(restoreReason(reason, '复用结果未核对') + '；原绑定保留。');
    } finally {
      if (visit === generation.current) setSelecting(false);
    }
  };
  const recheckWorkspace = async () => {
    if (disabled || selecting || !selectedChoice) return;
    const choice = selectedChoice;
    const visit = ++generation.current;
    setSelecting(true);
    setError('');
    setNotice('');
    try {
      const path = await window.flowark.request('file.choose', { kind: 'directory' });
      if (!path || visit !== generation.current) return;
      await window.flowark.request('skill.relocate', { id: choice.id, path, reviewed: true });
      if (visit !== generation.current) return;
      await window.flowark.request('skill.inspectBinding', { path, ref: choice.ref });
      const updated = await window.flowark.request('skill.list');
      if (visit !== generation.current) return;
      setChoices(updated);
      changeRef.current({ path, skill: choice.ref });
      setNotice('同一确认版本与原记录一致，工作区已核对登记。保存资源后生效，不会自动运行。');
    } catch (reason) {
      if (visit === generation.current)
        setError(
          (reason instanceof Error ? reason.message : '工作区核对未完成') +
            '；原绑定保留，请选择包含完整同版本文件的工作区。',
        );
    } finally {
      if (visit === generation.current) setSelecting(false);
    }
  };
  return (
    <div className="skill-picker">
      <Select
        aria-label={label}
        disabled={disabled || selecting}
        value={selected ?? (value?.skill ? 'original' : '')}
        onChange={(id) => {
          const next = choices.find((v) => v.id === id);
          const visit = ++generation.current;
          setNotice('');
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
                  label: '原绑定确认版本 · 请核对工作区后刷新',
                  disabled: true,
                },
              ]
            : []),
          ...choices.map((v) => ({
            value: v.id,
            label: v.title + ' · 确认于 ' + recordTime(v.confirmedAt),
          })),
        ]}
      />
      <Button disabled={disabled || selecting} onClick={() => setRevision((v) => v + 1)}>
        刷新确认版本
      </Button>
      <Button disabled={disabled || selecting} onClick={() => void chooseSaved()}>
        复用已保存 Skill
      </Button>
      <Modal
        title="核对已有 Skill"
        open={!!restore}
        width={960}
        styles={{ body: { maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' } }}
        closable={!selecting}
        maskClosable={!selecting}
        keyboard={!selecting}
        onCancel={() => {
          if (!selecting) {
            generation.current++;
            cancelRestore();
            setRestore(null);
          }
        }}
        footer={[
          <Button
            key="cancel"
            disabled={selecting}
            onClick={() => {
              generation.current++;
              cancelRestore();
              setRestore(null);
            }}
          >
            取消，保留原绑定
          </Button>,
          <Button
            key="confirm"
            type="primary"
            disabled={disabled || !restoreReviewed}
            loading={selecting}
            onClick={() => void confirmSaved()}
          >
            核对无误，复用此版本
          </Button>,
        ]}
      >
        {restore && (
          <>
            <Alert
              type="info"
              title="请本人核对文件来源和完整内容。文件摘要只证明一致性，不是作者身份签名。"
            />
            <div
              style={{
                maxHeight: 'min(45vh, calc(100vh - 420px))',
                overflow: 'auto',
                overflowWrap: 'anywhere',
              }}
            >
              <p>
                {restore.version.title} · 确认于 {recordTime(restore.version.confirmedAt)}
              </p>
              <p>来源目录：{restore.workspace}</p>
              <p>
                固定版本：{restore.version.ref.key} / {restore.version.ref.versionId}
              </p>
              <p>摘要：{restore.version.ref.sha256}</p>
              <p>
                父版本：{restore.version.parent ? JSON.stringify(restore.version.parent) : '无'}
              </p>
              <h3>完整正文</h3>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{restore.version.markdown}</pre>
              <h3>结构化资料与来源</h3>
              <pre style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(
                  { data: restore.version.data, evidence: restore.version.evidence },
                  null,
                  2,
                )}
              </pre>
            </div>
            <p>
              {restore.alreadyRegistered
                ? '此版本已登记，确认后复核使用。'
                : '仅登记这个原版本，不改写文件或确认时间。'}
              {restore.headPreserved
                ? '已有当前版本保持。'
                : '此版本将作为该资料键的首次本机登记。'}
              不替换其他实例绑定，不自动运行或调用模型；原历史引用仍属于外部资料。
            </p>
            <Checkbox
              checked={restoreReviewed}
              disabled={selecting}
              onChange={(e) => setRestoreReviewed(e.target.checked)}
            >
              我已核对来源、完整正文、资料和版本信息，确认复用本人保存的版本
            </Checkbox>
            {error && <Alert type="error" title={error} />}
          </>
        )}
      </Modal>
      {selectedChoice && (
        <Button disabled={disabled || selecting} onClick={() => void recheckWorkspace()}>
          {selecting ? '正在核对…' : '选择并核对工作区'}
        </Button>
      )}
      {error && <Alert type="error" title={error} />}
      {notice && <Alert type="success" title={notice} />}
      <p>固定选择版本，运行前复验文件；新版本不会自动替换此绑定。确认Skill不授予模型或外发权限。</p>
    </div>
  );
}
