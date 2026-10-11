import { Alert, Button, Card, Tag } from 'antd';
import { useEffect, useRef } from 'react';
import type { LearningStatus } from '../shared/learning';

export default function FirstTaskGuide({
  progress,
  busy,
  start,
  skip,
  readError,
  action,
  refresh,
}: {
  readError?: string;
  action?: 'continue' | 'restart' | 'skip' | 'refresh';
  refresh: () => void;
  progress?: LearningStatus;
  busy: boolean;
  start: (mode: 'continue' | 'restart') => void;
  skip: () => void;
}) {
  const feedback = useRef<HTMLSpanElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const retrying = useRef(false);
  useEffect(() => {
    if (readError) feedback.current?.focus();
  }, [readError]);
  useEffect(() => {
    const container = feedback.current?.closest('.learning-read-error');
    const main = container?.closest('main');
    if (!main || !container) return;
    const observer = new ResizeObserver(() => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !container.contains(focused)) return;
      const bounds = focused.getBoundingClientRect();
      const viewport = main.getBoundingClientRect();
      if (bounds.top < viewport.top || bounds.bottom > viewport.bottom)
        focused.scrollIntoView({ block: focused === feedback.current ? 'center' : 'nearest' });
    });
    observer.observe(main);
    return () => observer.disconnect();
  }, [readError]);
  useEffect(() => {
    if (retrying.current && !busy) {
      retrying.current = false;
      if (readError) feedback.current?.focus();
      else {
        actionButton.current?.parentElement
          ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
          ?.focus();
      }
    }
  }, [busy, readError]);
  const milestones = ['target', 'plan', 'trial', 'result'] as const;
  const completed = milestones.filter((key) => !!progress?.achieved[key]).length;
  const unavailable = busy || !progress || !!readError;
  return (
    <div className="learning-columns">
      <section className="learning-intro">
        <Card className="learning-card">
          <h2>把网页标题保存为文件</h2>
          <p>你会学会四件事：选操作对象、检查步骤、试一次、找到结果。</p>
          {[
            ['1 选目标', '明确看到将操作哪个网页'],
            ['2 看方案', '确认读取内容和输出位置'],
            ['3 试一次', '每一步都能看见进度'],
            ['4 找结果', '打开文件并继续修改'],
          ].map(([heading, text], index) => (
            <Card
              className="learning-topic"
              size="small"
              styles={{ body: { padding: 16 } }}
              key={heading}
            >
              <div className="learning-topic-heading">
                <h3>{heading}</h3>
                {progress?.achieved[milestones[index]] && (
                  <Tag color={readError ? 'default' : 'success'}>
                    {readError ? '上次记录已完成' : '已完成'}
                  </Tag>
                )}
              </div>
              <p>{text}</p>
            </Card>
          ))}
        </Card>
      </section>
      <section className="learning-practice">
        <Card className="learning-card">
          <h2>练习内容</h2>
          {[
            ['打开选定网页', '对象：内置浏览器 · 示例资料页'],
            ['读取页面标题', '字段：页面标题 · 仅读取'],
            ['标题不为空？', '满足条件继续；否则结束并提醒'],
            ['保存为文本文件', '位置：任务输出 · 新建文件，不覆盖'],
          ].map(([heading, text], i) => (
            <Card
              className="learning-step"
              size="small"
              variant="borderless"
              styles={{ body: { padding: 16 } }}
              key={heading}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{heading}</h3>
                <p>{text}</p>
              </div>
            </Card>
          ))}
          <Alert
            className="learning-disclosure"
            type="info"
            showIcon
            title="练习只读取示例页，并在选定目录新建一个文本文件。不会发送消息或提交网页表单。"
          />
          {progress?.taskId && (
            <p className="learning-resume-note" role="status">
              {progress.status === 'completed'
                ? '上次学习已完成。'
                : `已完成 ${completed} / 4 项学习。`}{' '}
              继续会保留原任务；重新学习会创建新草稿，旧任务和结果保留。
            </p>
          )}
          {readError ? (
            <div className="learning-read-error">
              <Alert
                type="error"
                showIcon
                title={
                  <span tabIndex={-1} ref={feedback}>
                    暂时无法读取学习记录
                  </span>
                }
                description={
                  <>
                    <p>{readError}</p>
                    <p>上次记录保留，恢复读取后再继续或跳过。重新读取不会创建教学任务。</p>
                  </>
                }
                action={
                  <Button
                    disabled={busy || undefined}
                    onClick={() => {
                      retrying.current = true;
                      refresh();
                    }}
                  >
                    {action === 'refresh' ? '正在重新读取…' : '重新读取学习记录'}
                  </Button>
                }
              />
            </div>
          ) : !progress ? (
            <p role="status">正在读取学习记录…</p>
          ) : null}
          <div className="ai-task-actions" aria-busy={busy}>
            <Button
              ref={actionButton}
              type="primary"
              disabled={unavailable || (!!progress?.taskId && !progress.taskExists) || undefined}
              onClick={() => start('continue')}
            >
              {action === 'continue'
                ? '正在打开教学任务…'
                : progress?.status === 'completed'
                  ? '查看上次结果'
                  : progress?.taskId
                    ? '继续教学'
                    : '跟着做一次'}
            </Button>
            {progress?.taskId && (
              <Button disabled={unavailable || undefined} onClick={() => start('restart')}>
                {action === 'restart' ? '正在创建新教学草稿…' : '重新开始学习'}
              </Button>
            )}
            {progress?.status !== 'completed' && (
              <Button disabled={unavailable || undefined} onClick={skip}>
                {action === 'skip' ? '正在保存跳过状态…' : '先跳过'}
              </Button>
            )}
          </div>
          {!readError && progress?.taskId && !progress.taskExists && (
            <Alert
              type="warning"
              role="alert"
              showIcon
              title="原教学任务已不存在，请选择重新开始学习。"
            />
          )}
        </Card>
      </section>
    </div>
  );
}
