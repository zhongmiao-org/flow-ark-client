/** Normative capability validation only; no request, credentials, lifecycle or IO. */
export const aiOutcomeCapability = 'ai-outcome-v1';

export function assertAIOutcomeCapabilities(node: any, capabilities: readonly string[]) {
  if (node?.type !== 'ai' || ![2, 3].includes(node.version)) return;
  for (const capability of ['ai-node-v1', aiOutcomeCapability])
    if (!capabilities.includes(capability))
      throw new Error('AI v2节点未声明能力：' + capability);
}
