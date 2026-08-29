import type { AgentId, GroundedContext, ProviderHealth, TokenUsage } from '../contracts.js';

export type LlmOperation = 'agent-analysis' | 'pm-synthesis';

export interface GenerateStructuredRequest {
  operation: LlmOperation;
  agentId: AgentId;
  modelAlias: string;
  systemInstruction: string;
  context: Readonly<GroundedContext>;
  outputSchema: unknown;
  timeoutMs: number;
  idempotencyKey: string;
}

export interface GenerateStructuredResponse {
  value: unknown;
  providerRequestId?: string;
  usage?: TokenUsage;
}

export interface LlmProvider {
  health(): Promise<ProviderHealth>;
  generateStructured<T>(
    request: Readonly<GenerateStructuredRequest>
  ): Promise<GenerateStructuredResponse>;
}
