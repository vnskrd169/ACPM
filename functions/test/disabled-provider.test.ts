import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GroundedContext } from '../src/ai/contracts.js';
import { DisabledProvider } from '../src/ai/providers/disabled.js';

const context: GroundedContext = {
  eventType: 'task_overdue',
  projectId: 'project-1',
  source: {
    path: 'projects/project-1/tasks',
    recordId: 'task-1',
    field: 'dueDate'
  },
  facts: Object.freeze({ dueDate: '2026-01-31' })
};

const request = {
  operation: 'agent-analysis' as const,
  agentId: 'planning' as const,
  modelAlias: 'disabled',
  systemInstruction: 'Use only grounded records.',
  context,
  outputSchema: {},
  timeoutMs: 1000,
  idempotencyKey: 'test-task-1'
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DisabledProvider', () => {
  it('returns an explicit normal disabled state without network access', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new DisabledProvider();

    await expect(provider.health()).resolves.toEqual({
      status: 'disabled',
      configured: false,
      reason: 'provider_disabled'
    });
    await expect(provider.generateStructured(request)).resolves.toEqual({
      value: { status: 'disabled', reason: 'provider_disabled' }
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('represents missing configuration without throwing', async () => {
    const provider = new DisabledProvider('provider_not_configured');

    await expect(provider.health()).resolves.toEqual({
      status: 'not_configured',
      configured: false,
      reason: 'provider_not_configured'
    });
    await expect(provider.generateStructured(request)).resolves.toEqual({
      value: { status: 'disabled', reason: 'provider_not_configured' }
    });
  });
});
