/** Native dispatch evidence; none of these states establishes business success. */
export type DesktopActionRecord = {
  version: 1;
  runId: string;
  actionId: string;
  effectId: string;
  at: string;
  completedAt?: string;
  status: 'performed' | 'not-executed' | 'unknown';
  receipt?: { status: 'performed' | 'not-executed' | 'unknown'; reason?: string };
};
