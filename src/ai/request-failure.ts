import { aiFailureMessages } from '../shared/ai-outcome';
import type { AIRequestFailure } from '../shared/types';

/** Created only at known provider request/response boundaries, never from arbitrary errors. */
export class AIRequestFailureError extends Error {
  readonly failure: AIRequestFailure;
  constructor(
    code: AIRequestFailure['error']['code'],
    metadata: Omit<AIRequestFailure, 'status' | 'error'>,
    httpStatus: number | null,
    legacyMessage: string,
  ) {
    super(legacyMessage);
    this.name = 'AIRequestFailureError';
    this.failure = {
      status: 'failed',
      ...metadata,
      error: { code, message: aiFailureMessages[code], httpStatus } as AIRequestFailure['error'],
    };
  }
}
