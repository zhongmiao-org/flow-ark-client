import type { Policy } from '../shared/types';
import { uid } from '../shared/utils';
import { validateObject } from '../core/validate';
import { defaultJobFilter, validateJobFilter } from './job-filter';
export function validateRecruitingPolicy(value: unknown): Policy {
  const policy = validateObject<Policy>('RecruitingPolicy', value);
  validateJobFilter(policy.jobFilter);
  return policy;
}
export const defaultPolicy = (platform: 'boss' | 'zhaopin'): Policy => ({
  platform,
  account: '',
  keywords: [],
  excludedCompanies: [],
  allowedTargets: [],
  jobFilter: defaultJobFilter(),
  resumeVersion: '',
  resumeBinding: '',
  facts: [],
  actions: {
    apply: 'confirm',
    resume: 'confirm',
    reply: 'confirm',
    requestWechat: 'confirm',
    acceptWechat: 'confirm',
    requestPhone: 'confirm',
    acceptPhone: 'confirm',
  },
  dailyLimit: 10,
  batchLimit: 5,
  startHour: 9,
  endHour: 21,
  timezone: 'Asia/Shanghai',
  ownWechat: '',
  ownPhone: '',
  provider: 'openai-codex',
  model: 'gpt-5.3-codex',
  contextRevision: uid(),
});
