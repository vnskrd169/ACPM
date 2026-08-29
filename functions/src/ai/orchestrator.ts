import { runLogicalAgent } from './agents.js';
import type {
  AgentId,
  AiConfig,
  AiDecisionRecord,
  AiEventRecord,
  AiRecommendationRecord,
  AiRunRecord,
  GroundedFinding,
  TokenUsage
} from './contracts.js';
import { ContextAssembler } from './context.js';
import { deterministicId, stableDigest } from './determinism.js';
import { GroundingValidationError } from './grounding.js';
import { FakeProviderError } from './providers/fake.js';
import type { LlmProvider } from './providers/provider.js';
import { routeAiEvent } from './router.js';
import type { AiSourceReader } from './source-reader.js';
import type { AiPipelineStore } from './store.js';

export interface ProcessEventDependencies {
  store: AiPipelineStore;
  sourceReader: AiSourceReader;
  provider: LlmProvider;
  config: Readonly<AiConfig>;
}

export interface ProcessEventResult {
  status: 'completed' | 'failed' | 'skipped' | 'already_claimed';
  reason: string | null;
  eventId: string;
  runId: string | null;
  recommendationId: string | null;
  decisionId: string | null;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof FakeProviderError) return error.code;
  if (error instanceof GroundingValidationError) return error.code;
  return 'pipeline_failed';
}

function sumUsage(usages: Array<TokenUsage | null>): TokenUsage | null {
  const actual = usages.filter((usage): usage is TokenUsage => usage !== null);
  if (actual.length === 0) return null;
  return {
    inputTokens: actual.reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0),
    outputTokens: actual.reduce((sum, usage) => sum + (usage.outputTokens ?? 0), 0),
    totalTokens: actual.reduce((sum, usage) => sum + (usage.totalTokens ?? 0), 0)
  };
}

function recommendationEvidence(finding: GroundedFinding) {
  return [...new Map([
    ...finding.facts.flatMap(fact => fact.evidenceRefs),
    ...finding.scheduleImpact.evidenceRefs,
    ...finding.costImpact.evidenceRefs
  ].map(reference => [
    `${reference.path}|${reference.recordId}|${reference.field}`,
    reference
  ])).values()];
}

function failedEvent(event: AiEventRecord): AiEventRecord {
  return { ...event, status: 'failed' };
}

export async function processAiEvent(
  eventId: string,
  now: number,
  dependencies: ProcessEventDependencies
): Promise<ProcessEventResult> {
  const empty = (
    status: ProcessEventResult['status'],
    reason: string,
    runId: string | null = null
  ): ProcessEventResult => ({
    status,
    reason,
    eventId,
    runId,
    recommendationId: null,
    decisionId: null
  });
  if (!dependencies.config.enabled) return empty('skipped', 'ai_disabled');
  if (!dependencies.config.generationEnabled) {
    return empty('skipped', 'generation_disabled');
  }

  const event = await dependencies.store.getEvent(eventId);
  if (!event) return empty('skipped', 'event_not_found');
  if (event.status === 'resolved') return empty('skipped', 'event_resolved');

  const assembler = new ContextAssembler(dependencies.sourceReader);
  const primaryAgent: Exclude<AgentId, 'pm'> = event.eventType.startsWith('material_')
    ? 'materials'
    : 'planning';
  const primaryContext = await assembler.forAgent(event, primaryAgent);
  const route = routeAiEvent(event.eventType, primaryContext.routing);
  const contextDigest = stableDigest({
    eventId,
    route: route.agents,
    primaryContext: primaryContext.context
  });
  const attempt = 1;
  const runId = deterministicId('run', { eventId, contextDigest, attempt });
  const run: AiRunRecord = {
    schemaVersion: '0.1',
    eventId,
    projectId: event.projectId,
    requiredAgents: route.agents,
    attempt,
    status: 'queued',
    providerAlias: 'fake',
    modelAlias: 'fake',
    contextDigest,
    dryRun: dependencies.config.dryRun,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    safeErrorCode: null,
    usage: null
  };
  const claim = await dependencies.store.claimRun(eventId, runId, run);
  if (!claim.claimed) return empty('already_claimed', 'event_already_claimed', claim.runId);

  const running: AiRunRecord = { ...run, status: 'running', startedAt: now };
  await dependencies.store.saveRun(runId, running);
  const findings: Partial<Record<AgentId, GroundedFinding>> = {};
  const usages: Array<TokenUsage | null> = [];

  try {
    for (const agentId of route.agents.filter((agent): agent is Exclude<AgentId, 'pm'> => agent !== 'pm')) {
      const assembled = agentId === primaryAgent
        ? primaryContext
        : await assembler.forAgent(event, agentId);
      const agentResult = await runLogicalAgent(
        agentId,
        assembled.context,
        dependencies.provider,
        `${runId}:${agentId}`
      );
      findings[agentId] = agentResult.finding;
      usages.push(agentResult.usage);
      await dependencies.store.saveFinding(runId, agentId, agentResult.finding);
    }

    const pmContext = assembler.forPm(event, findings);
    const pmResult = await runLogicalAgent('pm', pmContext.context, dependencies.provider, `${runId}:pm`);
    findings.pm = pmResult.finding;
    usages.push(pmResult.usage);
    await dependencies.store.saveFinding(runId, 'pm', pmResult.finding);

    const completedRun: AiRunRecord = {
      ...running,
      status: 'completed',
      completedAt: now,
      usage: sumUsage(usages)
    };
    await dependencies.store.saveRun(runId, completedRun);

    const completedEvent: AiEventRecord = { ...event, runId, status: 'completed' };
    await dependencies.store.saveEvent(eventId, completedEvent);

    if (dependencies.config.dryRun) {
      return {
        status: 'completed',
        reason: 'dry_run_no_user_facing_output',
        eventId,
        runId,
        recommendationId: null,
        decisionId: null
      };
    }

    const pmFinding = pmResult.finding;
    const recommendationId = deterministicId('recommendation', { eventId, runId });
    const decisionId = pmFinding.needsHumanDecision
      ? deterministicId('decision', { eventId, runId })
      : null;
    const recommendation: AiRecommendationRecord = {
      schemaVersion: '0.1',
      projectId: event.projectId,
      eventId,
      runId,
      severity: pmFinding.severity,
      title: `AI review: ${event.eventType.replace(/_/g, ' ')}`,
      summary: pmFinding.summary,
      scheduleImpact: pmFinding.scheduleImpact,
      costImpact: pmFinding.costImpact,
      recommendedActions: pmFinding.recommendedActions,
      needsHumanDecision: pmFinding.needsHumanDecision,
      decisionId,
      evidenceRefs: recommendationEvidence(pmFinding),
      status: 'open',
      createdAt: now
    };
    await dependencies.store.saveRecommendation(recommendationId, recommendation);

    if (decisionId && pmFinding.decisionQuestion) {
      const decision: AiDecisionRecord = {
        schemaVersion: '0.1',
        projectId: event.projectId,
        eventId,
        runId,
        recommendationId,
        question: pmFinding.decisionQuestion,
        status: 'open',
        createdAt: now
      };
      await dependencies.store.saveDecision(decisionId, decision);
    }

    return {
      status: 'completed',
      reason: null,
      eventId,
      runId,
      recommendationId,
      decisionId
    };
  } catch (error) {
    const code = safeErrorCode(error);
    await dependencies.store.saveRun(runId, {
      ...running,
      status: 'failed',
      completedAt: now,
      safeErrorCode: code,
      usage: sumUsage(usages)
    });
    await dependencies.store.saveEvent(eventId, failedEvent({ ...event, runId }));
    return empty('failed', code, runId);
  }
}
