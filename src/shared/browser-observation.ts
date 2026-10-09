import { z } from 'zod';
import type { ElementTarget } from './element-picker';

export type FocusedTarget = {
  requestId: string;
  target: ElementTarget;
  page: { title: string; url: string };
  percentage?: number;
};

// Main-originated keyboard requests only; this method is not exposed by preload.
export const observationPan = z
  .object({
    resourceId: z.string().uuid(),
    documentRevision: z.number().int().nonnegative(),
    direction: z.enum(['left', 'right', 'up', 'down']),
  })
  .strict();
export type ObservationPan = z.infer<typeof observationPan>;
