export type ArtifactCleanupRecord = {
  runId: string;
  token: string;
  state: 'pending' | 'completed' | 'failed' | 'interrupted';
  startedAt: string;
  finishedAt?: string;
  count: number;
  bytes: number;
  error?: string;
};
export type ArtifactCleanupPreview = {
  runId: string;
  token: string;
  count: number;
  bytes: number;
  files: { name: string; size: number; link: boolean }[];
  omitted: number;
  externalCount: number;
  indexedCount: number;
  previousCleanup?: ArtifactCleanupRecord;
};
