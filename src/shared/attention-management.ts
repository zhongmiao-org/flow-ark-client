export type AttentionAction = 'read' | 'trash' | 'restore';
export type AttentionBatchPreview = {
  token: string;
  action: AttentionAction;
  targetCount: number;
  skippedCount: number;
  expiresAt: string;
};
export type AttentionBatchResult = {
  changed: number;
  skipped: number;
  unchanged: number;
};
