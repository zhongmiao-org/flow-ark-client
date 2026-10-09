import { Alert, Button, Flex, Modal } from 'antd';
import { useEffect, useRef, useState } from 'react';

export default function EditorLeaveDialog({
  name,
  destination,
  save,
  discard,
  stay,
}: {
  name: string;
  destination: string;
  save: () => Promise<void>;
  discard: () => void;
  stay: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (error) heading.current?.focus();
  }, [error]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const persist = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await save();
    } catch (reason) {
      if (alive.current)
        setError(
          (reason instanceof Error ? reason.message : '保存未完成，请重试').replace(
            /^Error invoking remote method 'flowark:request': (?:Error: )?/,
            '',
          ),
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal
      open
      width={640}
      centered
      closable={false}
      keyboard={!busy}
      mask={{ closable: false }}
      onCancel={() => {
        if (!locked.current) stay();
      }}
      afterOpenChange={(open) => {
        if (open) continueButton.current?.focus();
      }}
      title={
        <h2 ref={heading} tabIndex={-1}>
          {error ? '保存未完成，尚未离开' : '离开前保存更改？'}
        </h2>
      }
      footer={
        <Flex gap={12} wrap justify="flex-end">
          <Button ref={continueButton} disabled={busy || undefined} onClick={stay}>
            继续编辑
          </Button>
          <Button danger disabled={busy || undefined} onClick={discard}>
            不保存离开
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={busy || undefined}
            onClick={() => void persist()}
          >
            {busy ? '正在保存…' : error ? '重试保存并离开' : '保存并离开'}
          </Button>
        </Flex>
      }
    >
      <p>
        “{name}”的当前输入尚未保存。保存成功后前往“{destination}”；不保存将放弃本次草稿更改。
      </p>
      <p>已开始的运行和固定计划保持原版本。</p>
      {error && <Alert type="error" title="保存错误详情" description={error} role="alert" />}
    </Modal>
  );
}
