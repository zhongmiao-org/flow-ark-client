import { z } from 'zod';
import type { OAuthSummary } from './tool-connections';

const token = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[\x21-\x7e]+$/);
const address = z.string().url().max(2048);
export const oauthGrant = z
  .object({
    kind: z.literal('mcp-oauth-v1'),
    url: address,
    issuer: address,
    resource: address,
    clientId: z.string().min(1).max(500),
    tokenEndpoint: address,
    authorizationEndpoint: address,
    scopes: z.array(z.string().min(1).max(200)).max(128),
    accessToken: token,
    refreshToken: token.optional(),
    expiresAt: z.number().finite().positive().optional(),
  })
  .strict();
export type OAuthGrant = z.infer<typeof oauthGrant>;
export function oauthSummary(grant: OAuthGrant): OAuthSummary {
  const { issuer, clientId, resource, scopes, expiresAt } = grant;
  return { issuer, clientId, resource, scopes, expiresAt };
}
export function toolSecretValues(value: string): string[] {
  try {
    const parsed = oauthGrant.safeParse(JSON.parse(value));
    if (parsed.success)
      return [
        value,
        parsed.data.accessToken,
        ...(parsed.data.refreshToken ? [parsed.data.refreshToken] : []),
      ];
  } catch {
    /* Plain Bearer credentials have no envelope. */
  }
  return [value];
}
