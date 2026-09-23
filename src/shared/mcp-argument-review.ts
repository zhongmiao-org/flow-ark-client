/** Static review of saved arguments; never an execution authorization. */
export type McpArgumentReview = {
  status: 'valid' | 'invalid' | 'deferred' | 'unsupported' | 'unavailable';
  summary: string;
  issues: { path: string; message: string }[];
  referenceCount?: number;
};
