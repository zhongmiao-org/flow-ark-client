import { z } from 'zod';
export const localCredentialId = z
  .string()
  .regex(/^local-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const localCredentialName = z.string().trim().min(1).max(100);
export const localCredentialValue = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => !value.includes('\0'));
const identity = {
  id: localCredentialId,
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
};
export const localCredentialMethods = {
  'credential.local.list': z.object({}).strict(),
  'credential.local.save': z
    .object({ ...identity, name: localCredentialName, value: localCredentialValue.optional() })
    .strict(),
  'credential.local.remove': z.object({ ...identity, confirmed: z.literal(true) }).strict(),
};
export type LocalCredential = { id: string; name: string; revision: string };
export type LocalCredentialState = LocalCredential & {
  inUse: boolean;
  boundFlows: { id: string; name: string }[];
};
