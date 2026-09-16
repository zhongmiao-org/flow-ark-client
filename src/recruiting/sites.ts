import type { AIRequest, BrowserDriver, Contact, Policy } from '../shared/types';
import type { Proposal } from './actions';

export type SiteProbe = { verified: boolean; account?: string; reason?: string };
export type Opportunity = Omit<Proposal, 'content' | 'contextHash' | 'resumeVersion'> & {
  content?: string;
};
export type Conversation = {
  account: string;
  target: string;
  contextHash: string;
  eventId: string;
  resumeVersion: string;
  conversation: AIRequest['conversation'];
  replied: boolean;
};
export interface RecruitingSiteAdapter {
  readonly platform: Policy['platform'];
  probe(signal: AbortSignal): Promise<SiteProbe>;
  opportunities(policy: Policy, limit: number, signal: AbortSignal): Promise<Opportunity[]>;
  read(target: string, signal: AbortSignal): Promise<Conversation>;
  submit(
    proposal: Proposal,
    signal: AbortSignal,
  ): Promise<{ state: 'CONFIRMED' | 'WAITING_PEER' | 'FAILED'; evidence: string }>;
  contacts(target: string, signal: AbortSignal): Promise<Contact[]>;
}

/** No production selectors have been calibrated against an authorized account.
 * These adapters explicitly reject execution until that work is performed.
 * No guessed selectors, private APIs or test fixture routes are used in production. */
abstract class UnverifiedRecruitingAdapter implements RecruitingSiteAdapter {
  abstract readonly platform: Policy['platform'];
  constructor(protected driver: BrowserDriver) {}
  async probe(signal: AbortSignal): Promise<SiteProbe> {
    signal.throwIfAborted();
    return {
      verified: false,
      reason: '当前求职者网页的账号、简历和动作入口尚未校准；请先完成该网站适配验证',
    };
  }
  async opportunities(): Promise<Opportunity[]> {
    throw new Error('站点适配尚未验证');
  }
  async read(): Promise<Conversation> {
    throw new Error('站点适配尚未验证');
  }
  async submit(): Promise<never> {
    throw new Error('站点适配尚未验证，禁止外发');
  }
  async contacts(): Promise<Contact[]> {
    throw new Error('站点适配尚未验证');
  }
}
export class BossRecruitingAdapter extends UnverifiedRecruitingAdapter {
  readonly platform = 'boss' as const;
}
export class ZhaopinRecruitingAdapter extends UnverifiedRecruitingAdapter {
  readonly platform = 'zhaopin' as const;
}
