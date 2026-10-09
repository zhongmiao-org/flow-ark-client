import { Alert, Badge, Button, Flex, Modal, Tag } from 'antd';
import { useEffect, useId, useRef } from 'react';
import './antd-layout.css';

export default function ScheduleLeaveDialog({
  destination,
  creating,
  busy,
  blocked,
  unconfirmed,
  error,
  stay,
  discard,
  save,
}: {
  destination: string;
  creating: boolean;
  busy: boolean;
  blocked: boolean;
  unconfirmed: boolean;
  error?: string;
  stay: () => void;
  discard: () => void;
  save: () => void;
}) {
  const descriptionId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (error) heading.current?.focus();
  }, [error]);
  return (
    <Modal
      open
      width={640}
      centered
      closable={false}
      mask={{ closable: false }}
      keyboard={!busy}
      focusable={{ focusTriggerAfterClose: false }}
      className="flowark-leave-modal"
      aria-describedby={descriptionId}
      aria-busy={busy}
      onCancel={() => {
        if (!busy) stay();
      }}
      afterOpenChange={(open) => {
        if (open) (error ? heading.current : continueButton.current)?.focus();
      }}
      title={
        <Flex vertical gap={16} align="flex-start">
          <Tag
            color={error ? 'error' : 'warning'}
            variant="filled"
            className="flowark-leave-status"
            icon={<Badge status={error ? 'error' : 'warning'} />}
          >
            {error ? '保存未完成' : '存在未保存更改'}
          </Tag>
          <h2 ref={heading} tabIndex={-1}>
            保存计划更改再离开？
          </h2>
        </Flex>
      }
      footer={
        <Flex gap={12} wrap className="flowark-leave-actions">
          <Button ref={continueButton} disabled={busy || undefined} onClick={stay}>
            继续编辑
          </Button>
          <Button color="danger" variant="filled" disabled={busy || undefined} onClick={discard}>
            不保存离开
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={busy || blocked || unconfirmed || undefined}
            onClick={save}
          >
            {busy
              ? creating
                ? '正在创建…'
                : '正在保存…'
              : error
                ? '重试保存并离开'
                : '保存并离开'}
          </Button>
        </Flex>
      }
    >
      <p id={descriptionId}>
        {creating
          ? '保存会创建并启用一个固定版本的计划'
          : '保存仅修改未来触发的计划，保留原启停状态'}
        ，成功后前往“{destination}”。不保存将放弃本次计划更改。
      </p>
      <p className="flowark-leave-note">
        {unconfirmed
          ? '请先继续编辑，选择来源并确认固定当前已保存版本与入口。'
          : '已排队和正在执行的运行保持原状，不追赶错过的触发。'}
      </p>
      {error && <Alert type="error" title="保存未完成" description={error} role="alert" />}
    </Modal>
  );
}
