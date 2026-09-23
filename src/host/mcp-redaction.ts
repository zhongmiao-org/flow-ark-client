import type { McpReceipt } from '../shared/mcp-run';
import { redact } from '../shared/utils';

/** Preserve the protocol envelope; redact every payload field under that envelope. */
export function redactMcpReceipt(receipt: McpReceipt, secrets: string[]): McpReceipt {
  const { result, ...identity } = receipt;
  return {
    ...redact(identity, secrets),
    ...(result
      ? {
          result: {
            version: result.version,
            isError: result.isError,
            content: redact(result.content, secrets),
            ...(result.structuredContent !== undefined
              ? {
                  structuredContent: redact(result.structuredContent, secrets),
                }
              : {}),
          },
        }
      : {}),
  };
}
