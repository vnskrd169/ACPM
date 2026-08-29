import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentId, GroundedFinding } from '../src/ai/contracts.js';
import { OpenAIProvider, type OpenAIClientLike } from '../src/ai/providers/openai.js';
import {
  runStagingManualAiDryRun,
  STAGING_PROJECT_ID
} from '../src/ai/staging-manual.js';
import { enabledConfig, NOW } from './helpers.js';
import {
  createStagingProviderFixture,
  STAGING_QA_FIXTURE_EVENT_ID,
  STAGING_QA_FIXTURE_PROJECT_ID
} from './staging-provider-fixture.js';

const activeFixtures: Array<ReturnType<typeof createStagingProviderFixture>> = [];

afterEach(() => {
  for (const fixture of activeFixtures.splice(0)) fixture.cleanup();
});

function fixture() {
  const value = createStagingProviderFixture();
  activeFixtures.push(value);
  return value;
}

function finding(agentId: AgentId): GroundedFinding {
  const evidence = {
    path: `projects/${STAGING_QA_FIXTURE_PROJECT_ID}/tasks`,
    recordId: 'task-overdue',
    field: 'dueDate'
  };
  return {
    schemaVersion: '0.1',
    agentId,
    severity: 'medium',
    summary: 'Synthetic QA finding grounded in the supplied task.',
    facts: [{ claim: 'A due date is supplied.', evidenceRefs: [evidence] }],
    unknowns: [
      { field: 'scheduleImpact', reason: 'No exact duration is supplied.' },
      { field: 'costImpact', reason: 'No exact amount is supplied.' }
    ],
    scheduleImpact: {
      status: 'unknown', days: null, reason: 'No exact duration is supplied.', evidenceRefs: [evidence]
    },
    costImpact: {
      status: 'unknown', amount: null, currency: null, reason: 'No exact amount is supplied.', evidenceRefs: [evidence]
    },
    recommendedActions: ['Review the synthetic task.'],
    needsHumanDecision: false,
    decisionQuestion: null
  };
}

function providerWithResults(...agents: AgentId[]): OpenAIProvider {
  const parse = vi.fn();
  for (const agent of agents) parse.mockResolvedValueOnce({ output_parsed: finding(agent) });
  return new OpenAIProvider({ client: { responses: { parse } } as OpenAIClientLike });
}

function dependencies(
  current: ReturnType<typeof createStagingProviderFixture>,
  provider = providerWithResults('planning', 'pm')
) {
  return {
    runtimeProjectId: STAGING_PROJECT_ID as string,
    config: enabledConfig({ dryRun: true }),
    store: current.store,
    sourceReader: current.sourceReader,
    provider,
    now: NOW
  };
}

const input = {
  projectId: STAGING_QA_FIXTURE_PROJECT_ID,
  eventId: STAGING_QA_FIXTURE_EVENT_ID
};

describe('staging-only manual OpenAI dry run', () => {
  it('creates only a run and validated findings, then records healthy runtime status', async () => {
    const current = fixture();
    const result = await runStagingManualAiDryRun(input, dependencies(current));
    expect(result).toMatchObject({
      status: 'completed',
      reason: 'dry_run_no_user_facing_output',
      recommendationId: null,
      decisionId: null
    });
    expect(current.store.runs.get(result.runId!)).toMatchObject({
      providerAlias: 'openai',
      modelAlias: 'analysis+synthesis',
      dryRun: true
    });
    expect(current.store.findings.get(result.runId!)).toHaveProperty('planning');
    expect(current.store.findings.get(result.runId!)).toHaveProperty('pm');
    expect(current.store.recommendations.size).toBe(0);
    expect(current.store.decisions.size).toBe(0);
    expect(current.store.runtimeStatus).toMatchObject({
      providerAlias: 'openai', status: 'healthy', safeErrorCode: null
    });
  });

  it('rejects non-staging, non-dry-run, disabled, mismatched, and repeated requests', async () => {
    const cases: Array<(deps: ReturnType<typeof dependencies>, current: ReturnType<typeof fixture>) => void> = [
      deps => { deps.runtimeProjectId = 'acpm-project-system'; },
      deps => { deps.config = enabledConfig({ dryRun: false }); },
      deps => { deps.config = enabledConfig({ enabled: false, dryRun: true }); },
      (_deps, current) => { current.store.targets.get(STAGING_QA_FIXTURE_PROJECT_ID)!.enabled = false; },
      (_deps, current) => { current.store.events.get(STAGING_QA_FIXTURE_EVENT_ID)!.projectId = 'other'; }
    ];
    for (const mutate of cases) {
      const current = fixture();
      const deps = dependencies(current);
      mutate(deps, current);
      await expect(runStagingManualAiDryRun(input, deps)).rejects.toBeTruthy();
    }

    const current = fixture();
    const deps = dependencies(current);
    await runStagingManualAiDryRun(input, deps);
    await expect(runStagingManualAiDryRun(input, deps)).rejects.toMatchObject({
      code: 'event_already_processed'
    });
  });

  it('records not-configured health without creating a run', async () => {
    const current = fixture();
    await expect(runStagingManualAiDryRun(input, dependencies(current, new OpenAIProvider())))
      .rejects.toMatchObject({ code: 'provider_not_configured' });
    expect(current.store.runs.size).toBe(0);
    expect(current.store.runtimeStatus).toMatchObject({
      status: 'not_configured', safeErrorCode: 'provider_not_configured'
    });
  });

  it('maps provider failure to sanitized runtime health and creates no output', async () => {
    const current = fixture();
    const error = Object.assign(new Error('upstream body must not persist'), { status: 429 });
    const parse = vi.fn().mockRejectedValue(error);
    const provider = new OpenAIProvider({
      client: { responses: { parse } } as OpenAIClientLike,
      maxAttempts: 2,
      sleep: async () => undefined
    });
    const result = await runStagingManualAiDryRun(input, dependencies(current, provider));
    expect(result).toMatchObject({ status: 'failed', reason: 'provider_rate_limited' });
    expect(current.store.recommendations.size).toBe(0);
    expect(current.store.decisions.size).toBe(0);
    expect(current.store.runtimeStatus).toMatchObject({
      status: 'degraded', safeErrorCode: 'provider_rate_limited'
    });
  });

  it('uses a synthetic fixture with no sensitive domains and cleans it automatically', () => {
    const current = fixture();
    const serialized = JSON.stringify(current.projectSources);
    expect(serialized).toContain('Synthetic staging overdue task');
    expect(serialized).toContain('synthetic-cement');
    expect(serialized).toContain('Synthetic QA issue');
    expect(serialized).not.toMatch(/payroll|billing|bank|accountNumber|userPrivate/i);
    current.cleanup();
    activeFixtures.splice(activeFixtures.indexOf(current), 1);
    expect(current.store.events.size).toBe(0);
    expect(current.store.targets.size).toBe(0);
    expect(current.projectSources).toEqual({});
  });
});
