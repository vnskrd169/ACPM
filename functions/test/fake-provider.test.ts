import { describe, expect, it, vi } from 'vitest';

import { FakeProvider, FakeProviderError, type FakeProviderScenario } from '../src/ai/providers/fake.js';

const context = {
  eventType: 'task_overdue' as const,
  projectId: 'project-1',
  source: { path: 'projects/project-1/tasks', recordId: 'task-1', field: 'dueDate' },
  facts: { evidence: [] }
};

function request() {
  return {
    operation: 'agent-analysis' as const,
    agentId: 'planning' as const,
    modelAlias: 'fake',
    systemInstruction: 'Use supplied data only.',
    context,
    outputSchema: {},
    timeoutMs: 100,
    idempotencyKey: 'fake-test'
  };
}

describe('deterministic FakeProvider', () => {
  it('returns valid, unknown, and decision scenarios without network access', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const scenario of [
      'valid', 'unknown_schedule', 'unknown_cost', 'decision_required', 'no_decision'
    ] satisfies FakeProviderScenario[]) {
      const response = await new FakeProvider({ scenario }).generateStructured(request());
      expect(response.value).toMatchObject({ schemaVersion: '0.1', agentId: 'planning' });
      if (scenario === 'decision_required') {
        expect(response.value).toMatchObject({ needsHumanDecision: true });
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('returns deliberately invalid result variants for fail-closed tests', async () => {
    await expect(new FakeProvider({ scenario: 'invalid_result' }).generateStructured(request()))
      .resolves.toEqual({ value: 'not-a-structured-finding' });
    await expect(new FakeProvider({ scenario: 'schema_invalid' }).generateStructured(request()))
      .resolves.toEqual({ value: { schemaVersion: '0.1', agentId: 'planning', summary: 42 } });
  });

  it.each([
    ['timeout', 'provider_timeout', true],
    ['transient_error', 'provider_transient', true],
    ['permanent_error', 'provider_permanent', false]
  ] as const)('simulates %s deterministically', async (scenario, code, retryable) => {
    const provider = new FakeProvider({ scenario });
    try {
      await provider.generateStructured(request());
      throw new Error('expected fake provider failure');
    } catch (error) {
      expect(error).toBeInstanceOf(FakeProviderError);
      expect(error).toMatchObject({ code, retryable });
    }
  });
});
