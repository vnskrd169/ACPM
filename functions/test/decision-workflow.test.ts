import { describe, expect, it } from 'vitest';

import type { AiDecisionRecord } from '../src/ai/contracts.js';
import {
  DecisionWorkflowError,
  mapDecisionWorkflowError,
  submitHumanDecision,
  type DecisionRelationshipRecord,
  type DecisionWorkflowStore
} from '../src/ai/decision-workflow.js';

const NOW = 1_785_254_400_000;
const ACTOR = { uid: 'manager-1', role: 'pm', status: 'active' };
const INPUT = {
  decisionId: 'decision-1',
  submissionId: 'submission-0001',
  action: 'choose' as const,
  selectedOptionId: 'Continue monitoring',
  expectedCreatedAt: NOW - 10_000
};

function decision(overrides: Partial<AiDecisionRecord> = {}): AiDecisionRecord {
  return {
    schemaVersion: '0.1',
    projectId: 'project-1',
    eventId: 'event-1',
    runId: 'run-1',
    recommendationId: 'recommendation-1',
    question: 'Which reviewed response should be recorded?',
    options: ['Proceed with review', 'Continue monitoring'],
    status: 'open',
    createdAt: NOW - 10_000,
    ...overrides
  };
}

class MemoryDecisionStore implements DecisionWorkflowStore {
  current: AiDecisionRecord | null;
  recommendation: DecisionRelationshipRecord | null = {
    projectId: 'project-1', eventId: 'event-1', runId: 'run-1', decisionId: 'decision-1'
  };
  event: DecisionRelationshipRecord | null = { projectId: 'project-1', runId: 'run-1' };
  transactionCount = 0;

  constructor(initial: AiDecisionRecord | null = decision()) {
    this.current = initial ? structuredClone(initial) : null;
  }

  async getDecision(): Promise<unknown | null> {
    return this.current ? structuredClone(this.current) : null;
  }

  async getRecommendation(): Promise<DecisionRelationshipRecord | null> {
    return this.recommendation ? structuredClone(this.recommendation) : null;
  }

  async getEvent(): Promise<DecisionRelationshipRecord | null> {
    return this.event ? structuredClone(this.event) : null;
  }

  async transactDecision(
    _decisionId: string,
    update: (current: unknown | null) => AiDecisionRecord | undefined
  ): Promise<{ committed: boolean; value: unknown | null }> {
    this.transactionCount += 1;
    const updated = update(this.current ? structuredClone(this.current) : null);
    if (updated === undefined) return { committed: false, value: this.current };
    this.current = structuredClone(updated);
    return { committed: true, value: structuredClone(updated) };
  }
}

describe('secure human decision workflow', () => {
  it('resolves a valid stored option and records an atomic audit event', async () => {
    const store = new MemoryDecisionStore();
    const result = await submitHumanDecision(INPUT, ACTOR, store, NOW);
    expect(result).toMatchObject({ status: 'resolved', resolution: 'Continue monitoring', resolvedByRole: 'pm', replayed: false });
    expect(store.current?.history?.['submission-0001']).toEqual({
      decisionId: 'decision-1',
      projectId: 'project-1',
      action: 'choose',
      selectedOptionId: 'Continue monitoring',
      actorUid: 'manager-1',
      actorRole: 'pm',
      timestamp: NOW
    });
  });

  it('rejects an option that is not stored on the decision', async () => {
    await expect(submitHumanDecision({ ...INPUT, selectedOptionId: 'Approve purchase' }, ACTOR, new MemoryDecisionStore(), NOW))
      .rejects.toMatchObject({ code: 'invalid_option' });
  });

  it('rejects a second final resolution', async () => {
    const store = new MemoryDecisionStore(decision({
      status: 'resolved', resolution: 'Continue monitoring', resolvedAt: NOW - 1, resolvedBy: 'manager-2', resolvedByRole: 'admin'
    }));
    await expect(submitHumanDecision(INPUT, ACTOR, store, NOW)).rejects.toMatchObject({ code: 'decision_already_resolved' });
  });

  it('dismisses without deleting the decision or creating a business action', async () => {
    const store = new MemoryDecisionStore();
    const result = await submitHumanDecision({
      ...INPUT, submissionId: 'submission-0002', action: 'dismiss', selectedOptionId: undefined, notes: 'No action required.'
    }, ACTOR, store, NOW);
    expect(result).toMatchObject({ status: 'dismissed', resolution: null, resolutionNotes: 'No action required.' });
    expect(store.current).toMatchObject({ status: 'dismissed', projectId: 'project-1', recommendationId: 'recommendation-1' });
  });

  it('defers while keeping the decision open and audited', async () => {
    const store = new MemoryDecisionStore();
    const result = await submitHumanDecision({
      ...INPUT, submissionId: 'submission-0003', action: 'defer', selectedOptionId: undefined
    }, ACTOR, store, NOW);
    expect(result).toMatchObject({ status: 'open', deferredAt: NOW, deferredBy: ACTOR.uid, deferredByRole: 'pm' });
    expect(store.current?.history?.['submission-0003'].action).toBe('defer');
  });

  it('accepts a short optional plain-text note', async () => {
    const result = await submitHumanDecision({ ...INPUT, notes: 'Reviewed with the site team.' }, ACTOR, new MemoryDecisionStore(), NOW);
    expect(result.resolutionNotes).toBe('Reviewed with the site team.');
  });

  it('rejects oversized and control-character notes', async () => {
    for (const notes of ['x'.repeat(501), 'unsafe\u0000note']) {
      await expect(submitHumanDecision({ ...INPUT, notes }, ACTOR, new MemoryDecisionStore(), NOW))
        .rejects.toMatchObject({ code: 'invalid_decision_request' });
    }
  });

  it('returns idempotent success for an identical browser retry', async () => {
    const store = new MemoryDecisionStore();
    const first = await submitHumanDecision(INPUT, ACTOR, store, NOW);
    const retry = await submitHumanDecision(INPUT, ACTOR, store, NOW + 100);
    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(Object.keys(store.current?.history ?? {})).toEqual(['submission-0001']);
  });

  it('allows exactly one of two competing final resolutions', async () => {
    const store = new MemoryDecisionStore();
    const attempts = await Promise.allSettled([
      submitHumanDecision(INPUT, ACTOR, store, NOW),
      submitHumanDecision({ ...INPUT, submissionId: 'submission-0004', selectedOptionId: 'Proceed with review' }, ACTOR, store, NOW)
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failure = attempts.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({ code: 'decision_already_resolved' });
  });

  it('rejects stale and inconsistent decision relationships', async () => {
    const stale = { ...INPUT, expectedCreatedAt: INPUT.expectedCreatedAt - 1 };
    await expect(submitHumanDecision(stale, ACTOR, new MemoryDecisionStore(), NOW))
      .rejects.toMatchObject({ code: 'stale_decision' });
    const invalid = new MemoryDecisionStore();
    invalid.recommendation = { ...invalid.recommendation, projectId: 'other-project' };
    await expect(submitHumanDecision(INPUT, ACTOR, invalid, NOW))
      .rejects.toMatchObject({ code: 'invalid_decision_relationship' });
  });

  it('rejects inactive users and roles outside management', async () => {
    await expect(submitHumanDecision(INPUT, { ...ACTOR, status: 'suspended' }, new MemoryDecisionStore(), NOW))
      .rejects.toMatchObject({ code: 'inactive_user' });
    await expect(submitHumanDecision(INPUT, { ...ACTOR, role: 'apm' }, new MemoryDecisionStore(), NOW))
      .rejects.toMatchObject({ code: 'unauthorized_role' });
  });

  it('maps workflow failures to stable callable errors without leaking details', () => {
    expect(mapDecisionWorkflowError(new DecisionWorkflowError('decision_already_resolved')))
      .toEqual({ httpsCode: 'failed-precondition', safeCode: 'decision_already_resolved' });
    expect(mapDecisionWorkflowError(new Error('raw database failure containing secrets')))
      .toEqual({ httpsCode: 'internal', safeCode: 'decision_submission_failed' });
  });
});
