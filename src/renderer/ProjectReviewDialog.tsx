import { useEffect, useState } from 'react';
import { Alert, Checkbox, Modal } from 'antd';

type Review = { id: string; readStamp: string; detail: string; configuring: boolean; expiresAt: number };
export default function ProjectReviewDialog() {
  const [review, setReview] = useState<Review | null>(null), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, running = false, previous = '';
    const poll = async () => {
      if (running) return; running = true;
      try {
        const next = await window.flowark.request('project.review.get', {}) as Review | null;
        if (!disposed) { if ((next?.id ?? '') !== previous) { previous = next?.id ?? ''; setChecked(false); setError(''); } setReview(next); }
      } catch { /* Host startup/restart does not approve a request. */ }
      finally { running = false; }
    };
    void poll(); const interval = setInterval(() => void poll(), 500);
    return () => { disposed = true; clearInterval(interval); };
  }, []);
  const answer = async (approved: boolean) => {
    if (!review || busy || (approved && !checked)) return;
    setBusy(true); setError('');
    try { await window.flowark.request('project.review.respond', { reviewId: review.id, readStamp: review.readStamp, approved }); setReview(null); }
    catch (e) { setError(e instanceof Error ? e.message : '核对失败，未批准'); }
    finally { setBusy(false); }
  };
  return <Modal open={!!review} title={review?.configuring ? '本地工程配置核对' : '本地工程运行核对'} width={880}
    onCancel={() => void answer(false)} onOk={() => void answer(true)} confirmLoading={busy}
    okButtonProps={{ disabled: !checked || busy }} cancelButtonProps={{ disabled: busy }}
    okText={review?.configuring ? '已核对，保存配置' : '已核对，开始运行'} cancelText="取消" destroyOnHidden>
    <Alert type="warning" showIcon title="核对完整内容后确认。关闭或60秒超时均不执行；资源及动作授权继续复验。" />
    <pre role="region" aria-label="完整工程核对内容" tabIndex={0} style={{ maxHeight: '48vh', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 16 }}>{review?.detail}</pre>
    <Checkbox checked={checked} onChange={e => setChecked(e.target.checked)}>我已核对配置差异、资源、动作和固定快照</Checkbox>
    {error && <Alert type="error" title={error} />}
  </Modal>;
}
