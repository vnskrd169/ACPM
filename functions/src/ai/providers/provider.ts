import type { AgentId, GroundedContext, ProviderHealth, TokenUsage } from '../contracts.js';

export type LlmOperation = 'agent-analysis' | 'pm-synthesis';
export type ProviderModelAlias = 'analysis' | 'synthesis' | 'fake' | 'disabled';

export type ProviderSafeErrorCode =
  | 'provider_timeout'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_auth_failed'
  | 'provider_bad_request'
  | 'provider_invalid_output'
  | 'provider_unknown_error'
  | 'provider_transient'
  | 'provider_permanent';

export class ProviderExecutionError extends Error {
  constructor(
    readonly code: ProviderSafeErrorCode,
    readonly retryable: boolean
  ) {
    super(code);
    this.name = 'ProviderExecutionError';
  }
}

export interface GenerateStructuredRequest {
  operation: LlmOperation;
  agentId: AgentId;
  modelAlias: string;
  promptVersion: string;
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
  readonly alias: 'disabled' | 'fake' | 'openai';
  modelAliasForOperation(operation: LlmOperation): ProviderModelAlias;
  health(): Promise<ProviderHealth>;
  generateStructured<T>(
    request: Readonly<GenerateStructuredRequest>
  ): Promise<GenerateStructuredResponse>;
}
