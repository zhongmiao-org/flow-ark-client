/** Read-only projection of a saved Run snapshot; never a live target observation. */
export type RunTargetContext = {
  formatVersion: 1;
  runId: string;
  versionId: string;
  browser?: {
    bindingId: string;
    product?: 'embedded' | 'chrome' | 'firefox' | 'safari';
    page?: { title: string; url: string; source: 'selected' | 'reviewed' };
  };
  files: { binding: string; directory?: string }[];
};
