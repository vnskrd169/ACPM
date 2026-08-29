import type { AgentId, GroundedContext, GroundedFinding, TokenUsage } from './contracts.js';
import { validateGroundedFinding } from './grounding.js';
import type { LlmProvider } from './providers/provider.js';
import { groundedFindingProviderSchema } from './schemas.js';
import { promptVersion, systemInstructionFor } from './prompts.js';

export interface AgentRunResult {
  finding: GroundedFinding;
  usage: TokenUsage | null;
}

export async function runLogicalAgent(
  agentId: AgentId,
  context: Readonly<GroundedContext>,
  provider: LlmProvider,
  idempotencyKey: string
): Promise<AgentRunResult> {
  const operation = agentId === 'pm' ? 'pm-synthesis' : 'agent-analysis';
  const response = await provider.generateStructured({
    operation,
    agentId,
    modelAlias: provider.modelAliasForOperation(operation),
    promptVersion: promptVersion(agentId),
    systemInstruction: systemInstructionFor(agentId),
    context,
    outputSchema: groundedFindingProviderSchema,
    timeoutMs: 5000,
    idempotencyKey
  });
  return {
    finding: validateGroundedFinding(response.value, agentId, context),
    usage: response.usage ?? null
  };
}
