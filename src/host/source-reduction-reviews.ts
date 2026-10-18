import {
  createSourceReductionRunReview,
  assertSourceReductionRunReviewCurrent,
  SOURCE_REDUCTION_REVIEW_LIMITS,
  type SourceReductionReviewContext,
} from '../../contracts/source-reduction-review';
import type { ReductionTarget, SourceReductionRunReview } from '../shared/source-reduction';
import { uid, now } from '../shared/utils';

export type ReductionSelection = ReductionTarget & { jobId: string };
type Registered = { selection: ReductionSelection; review: SourceReductionRunReview };
type Context = { value: SourceReductionReviewContext; check: () => void };

/** Read-only host registry. A preview never authorizes a Run or a provider request. */
export class SourceReductionReviews {
  private readonly epoch = uid();
  private registered = new Map<string, Registered>();
  constructor(
    private deps: {
      context: (selection: ReductionSelection, epoch: string) => Promise<Context>;
    },
  ) {}

  async preview(selection: ReductionSelection): Promise<SourceReductionRunReview> {
    const actual = await this.deps.context(selection, this.epoch);
    actual.check();
    const createdAt = now();
    this.prune(Date.parse(createdAt));
    if (this.registered.size >= 128) throw Error('来源范围核对数量达到上限，请稍后重试');
    const review: SourceReductionRunReview = createSourceReductionRunReview(
      actual.value,
      uid(),
      createdAt,
      new Date(Date.parse(createdAt) + SOURCE_REDUCTION_REVIEW_LIMITS.lifetimeMs).toISOString(),
    );
    // The registry has its own clone; Renderer can never replace the host authority.
    this.registered.set(review.reviewId, {
      selection: structuredClone(selection),
      review: structuredClone(review),
    });
    return structuredClone(review);
  }

  /** Confirmation must retrieve this original registration, not accept a client review object. */
  async current(reviewId: string) {
    const entry = this.registered.get(reviewId);
    if (!entry) throw Error('来源范围核对不存在或应用已重启，请重新核对');
    const actual = await this.deps.context(entry.selection, this.epoch);
    const check = () => {
      actual.check();
      assertSourceReductionRunReviewCurrent(entry.review, actual.value, now());
    };
    check();
    return { review: structuredClone(entry.review), actual: actual.value, check };
  }

  private prune(time: number) {
    for (const [id, entry] of this.registered)
      if (Date.parse(entry.review.expiresAt) <= time) this.registered.delete(id);
  }
}
