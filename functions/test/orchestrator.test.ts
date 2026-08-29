import { describe, expect, it } from 'vitest';

import { processAiEvent } from '../src/ai/orchestrator.js';
import { FakeProvider } from '../src/ai/providers/fake.js';
import { InMemoryAiSourceReader } from '../src/ai/source-reader.js';
import { InMemoryAiPipelineStore } from '../src/ai/store.js';
import { enabledConfig, NOW, taskEvent } from './helpers.js';

function setup(provider = new FakeProvider(), dryRun = false) {
  const source = {
    'project-1': {
      tasks: {
        'task-1': {
          title: 'Inspect slab',
          status: 'in_progress',
          dueDate: '2026-08-28',
          payroll: { gross: 999999 },
          billing: { amount: 999999 }
        }
      }
    }
  };
  const store = new InMemoryAiPipelineStore();
  store.events.set('event-1', taskEvent());
  return {
    source,
    store,
    provider,
    dependencies: {
      store,
      sourceReader: new InMemoryAiSourceReader(source),
      provider,
      config: enabledConfig({ dryRun })
    }
  };
}

describe('internal AI event orchestrator', () => {
  it('runs planning then PM and creates a recommendation without a decision', async () => {
    const test = setup(new FakeProvider({ scenario: 'no_decision' }));
    const result = await processAiEvent('event-1', NOW, test.dependencies);
    expect(result).toMatchObject({
      status: 'completed',
      decisionId: null
    });
    expect(result.recommendationId).toBeTruthy();
    expect(test.store.findings.get(result.runId!)).toHaveProperty('planning');
    expect(test.store.findings.get(result.runId!)).toHaveProperty('pm');
    expect(test.store.runs.get(result.runId!)?.requiredAgents).toEqual(['planning', 'pm']);
    expect(test.store.recommendations.size).toBe(1);
    expect(test.store.decisions.size).toBe(0);
  });

  it('creates an open decision request only when PM requires human judgment', async () => {
    const provider = new FakeProvider({ scenariosByAgent: { pm: 'decision_required' } });
    const test = setup(provider);
    const result = await processAiEvent('event-1', NOW, test.dependencies);
    expect(result.decisionId).toBeTruthy();
    expect(test.store.decisions.get(result.decisionId!)).toMatchObject({ status: 'open' });
    expect(test.store.recommendations.get(result.recommendationId!)?.needsHumanDecision).toBe(true);
  });

  it('records runs and findings in dry run but creates no user-facing output', async () => {
    const test = setup(new FakeProvider({ scenario: 'decision_required' }), true);
    const result = await processAiEvent('event-1', NOW, test.dependencies);
    expect(result).toMatchObject({
      status: 'completed',
      reason: 'dry_run_no_user_facing_output',
      recommendationId: null,
      decisionId: null
    });
    expect(test.store.runs.size).toBe(1);
    expect(test.store.findings.size).toBe(1);
    expect(test.store.recommendations.size).toBe(0);
    expect(test.store.decisions.size).toBe(0);
  });

  it('makes zero provider calls when AI or generation is disabled', async () => {
    for (const config of [
      enabledConfig({ enabled: false }),
      enabledConfig({ generationEnabled: false })
    ]) {
      const test = setup();
      test.dependencies.config = config;
      const result = await processAiEvent('event-1', NOW, test.dependencies);
      expect(result.status).toBe('skipped');
      expect(test.provider.callCount).toBe(0);
      expect(test.store.runs.size).toBe(0);
    }
  });

  it.each(['timeout', 'transient_error', 'permanent_error', 'invalid_result', 'schema_invalid'] as const)(
    'fails closed for %s with no recommendation',
    async scenario => {
      const test = setup(new FakeProvider({ scenario }));
      const result = await processAiEvent('event-1', NOW, test.dependencies);
      expect(result.status).toBe('failed');
      expect(test.store.runs.get(result.runId!)?.status).toBe('failed');
      expect(test.store.recommendations.size).toBe(0);
      expect(test.store.decisions.size).toBe(0);
    }
  );

  it('concurrent claims produce one run and one agent sequence', async () => {
    const test = setup();
    const [first, second] = await Promise.all([
      processAiEvent('event-1', NOW, test.dependencies),
      processAiEvent('event-1', NOW, test.dependencies)
    ]);
    expect([first.status, second.status].sort()).toEqual(['already_claimed', 'completed']);
    expect(test.store.runs.size).toBe(1);
    expect(test.provider.callCount).toBe(2);
  });

  it('never mutates supplied ACPM business records', async () => {
    const test = setup();
    const before = structuredClone(test.source);
    await processAiEvent('event-1', NOW, test.dependencies);
    expect(test.source).toEqual(before);
  });
});
