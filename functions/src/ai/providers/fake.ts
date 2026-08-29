import type {
  AgentId,
  GroundedContext,
  GroundedFinding,
  ProviderHealth
} from '../contracts.js';
import type {
  GenerateStructuredRequest,
  GenerateStructuredResponse,
  LlmProvider
} from './provider.js';

export const FAKE_PROVIDER_SCENARIOS = [
  'valid',
  'unknown_schedule',
  'unknown_cost',
  'decision_required',
  'no_decision',
  'invalid_result',
  'schema_invalid',
  'timeout',
  'transient_error',
  'permanent_error'
] as const;
export type FakeProviderScenario = (typeof FAKE_PROVIDER_SCENARIOS)[number];

export class FakeProviderError extends Error {
  constructor(
    readonly code: 'provider_timeout' | 'provider_transient' | 'provider_permanent',
    readonly retryable: boolean
  ) {
    super(code);
    this.name = 'FakeProviderError';
  }
}

export interface FakeProviderOptions {
  scenario?: FakeProviderScenario;
  scenariosByAgent?: Partial<Record<AgentId, FakeProviderScenario>>;
}

function findingFor(
  agentId: AgentId,
  context: Readonly<GroundedContext>,
  scenario: FakeProviderScenario
): GroundedFinding {
  const decisionRequired = scenario === 'decision_required';
  return {
    schemaVersion: '0.1',
    agentId,
    severity: 'medium',
    summary: `Deterministic fake finding for ${context.eventType}.`,
    facts: [{
      claim: `The referenced ${context.eventType} condition is present in supplied context.`,
      evidenceRefs: [context.source]
    }],
    unknowns: [
      ...(scenario === 'unknown_schedule' || scenario === 'valid'
        ? [{ field: 'scheduleImpact', reason: 'No deterministic duration is supplied.' }]
        : []),
      ...(scenario === 'unknown_cost' || scenario === 'valid'
        ? [{ field: 'costImpact', reason: 'No deterministic cost amount is supplied.' }]
        : [])
    ],
    scheduleImpact: {
      status: 'unknown',
      days: null,
      reason: 'No supported schedule-day value exists in the supplied context.',
      evidenceRefs: [context.source]
    },
    costImpact: {
      status: 'unknown',
      amount: null,
      currency: null,
      reason: 'No supported cost amount exists in the supplied context.',
      evidenceRefs: [context.source]
    },
    recommendedActions: ['Review the referenced ACPM record with the responsible manager.'],
    needsHumanDecision: decisionRequired,
    decisionQuestion: decisionRequired ? 'Should management investigate this condition now?' : null
  };
}

export class FakeProvider implements LlmProvider {
  readonly alias = 'fake';
  callCount = 0;

  constructor(private readonly options: FakeProviderOptions = {}) {}

  async health(): Promise<ProviderHealth> {
    return { status: 'available', configured: true, reason: null };
  }

  async generateStructured<T>(
    request: Readonly<GenerateStructuredRequest>
  ): Promise<GenerateStructuredResponse> {
    this.callCount += 1;
    const scenario = this.options.scenariosByAgent?.[request.agentId]
      ?? this.options.scenario
      ?? 'valid';
    if (scenario === 'timeout') throw new FakeProviderError('provider_timeout', true);
    if (scenario === 'transient_error') throw new FakeProviderError('provider_transient', true);
    if (scenario === 'permanent_error') throw new FakeProviderError('provider_permanent', false);
    if (scenario === 'invalid_result') return { value: 'not-a-structured-finding' };
    if (scenario === 'schema_invalid') {
      return { value: { schemaVersion: '0.1', agentId: request.agentId, summary: 42 } };
    }
    return {
      value: findingFor(request.agentId, request.context, scenario),
      providerRequestId: `fake-${this.callCount}`,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    };
  }
}
