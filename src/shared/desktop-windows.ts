import { z } from 'zod';

export const desktopMethods = {
  'desktop.windows.list': z.object({}).strict(),
  'desktop.accessibility.openSettings': z.object({}).strict(),
};

const windowInfo = z
  .object({
    title: z.string().max(1024),
    minimized: z.boolean(),
  })
  .strict();
const availability = z.enum(['available', 'permission-required', 'unsupported', 'unavailable']);
const accessibility = z.enum(['granted', 'not-granted', 'unknown']);
const consistent = (value: { availability: string; accessibility: string; windows: unknown[] }) => {
  if (value.availability === 'available') return value.accessibility === 'granted';
  if (value.windows.length) return false;
  return value.availability !== 'permission-required' || value.accessibility === 'not-granted';
};
export const nativeWindowDiscovery = z
  .object({
    version: z.literal(1),
    accessibility,
    availability,
    windows: z.array(windowInfo).max(30),
    truncated: z.boolean(),
  })
  .strict()
  .refine(consistent);
export const desktopWindowDiscovery = z
  .object({
    version: z.literal(1),
    platform: z.enum(['macos', 'unsupported']),
    accessibility,
    availability,
    windows: z
      .array(
        windowInfo.extend({
          id: z.string().uuid(),
          application: z.literal('TextEdit'),
        }),
      )
      .max(30),
    truncated: z.boolean(),
    observedAt: z.string().datetime(),
    reason: z.string().max(1000).optional(),
  })
  .strict()
  .refine(consistent)
  .refine((value) =>
    value.platform === 'macos'
      ? value.availability !== 'unsupported'
      : value.availability === 'unsupported' && value.accessibility === 'unknown',
  );
export type DesktopWindowDiscovery = z.infer<typeof desktopWindowDiscovery>;
export type DesktopWindow = DesktopWindowDiscovery['windows'][number];
