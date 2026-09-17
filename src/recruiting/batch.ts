import type { Bridge, Policy } from '../shared/types';
/** Finite batch entry. Site operations are admitted only after the local adapter profile is validated. */
export async function runRecruitingBatch(
  platform: 'boss' | 'zhaopin',
  limit: number,
  bridge: Bridge,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const policy: Policy = await bridge.request('recruiting.policy', {
    platform,
  });
  if (!policy.account || !policy.resumeVersion) throw new Error('请先绑定求职者账号与简历版本');
  return bridge.request('recruiting.batch', {
    platform,
    limit: Math.min(limit, policy.batchLimit),
  });
}
