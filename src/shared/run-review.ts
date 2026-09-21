import { z } from 'zod';
import type { Run, ScriptBundle } from './types';

const selection = {
  rerun: z
    .object({ runId: z.string().min(1).max(100), reviewed: z.literal(true) })
    .strict()
    .optional(),
  id: z.string().min(1).max(100),
  debug: z.boolean().optional(),
  task: z
    .object({
      id: z.string().min(1).max(100),
      revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    })
    .strict()
    .optional(),
};
export const runReviewPreviewSchema = z.object(selection).strict();
export const runReviewConfirmSchema = z
  .object({
    ...selection,
    token: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().uuid(),
    reviewed: z.literal(true),
  })
  .strict();
export type RunReviewInput = z.infer<typeof runReviewPreviewSchema>;
export type RunReviewConfirmation = z.infer<typeof runReviewConfirmSchema>;
export type RunReviewOutcome = Run | { rejected: true; message: string };
/** Main -> Host only. Reading this never starts or borrows a browser session. */
export type EmbeddedReview = {
  resourceId?: string;
  documentRevision: number;
  started: boolean;
  loading: boolean;
  url: string;
  title: string;
  blocked?: string;
};
export type ReviewResource = {
  id: string;
  name: string;
  kind: 'file' | 'directory' | 'browser' | 'ai' | 'credential' | 'action';
  access: string;
  location?: string;
  detail: string;
};
export type ReviewEffect = {
  nodeId: string;
  name: string;
  kind: 'read' | 'write' | 'network' | 'control' | 'unknown';
  detail: string;
};
export type RunReviewPreview = {
  rerun?: { runId: string; name: string; state: string };
  ready: boolean;
  token?: string;
  debug: boolean;
  task?: RunReviewInput['task'];
  flow: {
    id: string;
    name: string;
    versionId?: string;
    stepCount: number;
    parameterNames: string[];
    capabilities: string[];
    scriptBundles: ScriptBundle[];
  };
  resources: ReviewResource[];
  effects: ReviewEffect[];
  checks: { name: string; passed: boolean; detail: string }[];
  limitations: string[];
};
