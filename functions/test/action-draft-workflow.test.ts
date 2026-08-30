import { describe, expect, it } from 'vitest';

import type {
  AiActionDraftEvent,
  AiActionDraftRecord,
  AiDecisionRecord,
  AiStructuredDecisionOption
} from '../src/ai/contracts.js';
import {
  createActionDraftFromDecision,
  reviewActionDraft,
  type ActionDraftWorkflowStore
} from '../src/ai/action-draft-workflow.js';

const NOW = 1_785_254_400_000;
const ACTOR = { uid: 'manager-1', role: 'pm', status: 'active' };

function structuredOption(overrides: Partial<AiStructuredDecisionOption> = {}): AiStructuredDecisionOption {
  return {
    id: 'prepare_alternate_source',
    label: 'Prepare alternate sourcing',
    actionIntent: {
      type: 'prepare_material_request',
      title: 'Prepare alternate material request',
      summary: 'Draft a material request for human review only.',
      payload: {
        schemaVersion: '0.1',
        materialReference: 'material-42',
        requestedQuantity: null,
        supplierReference: null,
        taskReference: null,
        siteIssueReference: null,
        noteReference: null,
        reason: 'The recorded delivery requires a reviewed fallback.',
        sourceEvidenceRefs: [{ path: 'projects/project-1/materials', recordId: 'material-42', field: 'status' }]
      }
    },
    ...overrides
  };
}

function resolvedDecision(options: AiDecisionRecord['options'] = [structuredOption()]): AiDecisionRecord {
  return {
    schemaVersion: '0.1',
    projectId: 'project-1',
    eventId: 'event-1',
    runId: 'run-1',
    recommendationId: 'recommendation-1',
    question: 'Which reviewed response should be recorded?',
    options,
    status: 'resolved',
    createdAt: NOW - 10_000,
    resolvedAt: NOW - 1_000,
    resolvedBy: 'manager-1',
    resolvedByRole: 'pm',
    resolution: typeof options[0] === 'string' ? options[0] : options[0].id
  };
}

class MemoryActionDraftStore implements ActionDraftWorkflowStore {
  decision: unknown | null;
  drafts: Record<string, AiActionDraftRecord> = {};
  events: Record<string, AiActionDraftEvent> = {};
  draftTransactions = 0;

  constructor(decision: unknown | null = resolvedDecision()) {
    this.decision = decision === null ? null : structuredClone(decision);
  }

  async getDecision(): Promise<unknown | null> {
    return this.decision === null ? null : structuredClone(this.decision);
  }

  async getDraft(draftId: string): Promise<unknown | null> {
    return this.drafts[draftId] ? structuredClone(this.drafts[draftId]) : null;
  }

  async getDraftEvent(eventId: string): Promise<unknown | null> {
    return this.events[eventId] ? structuredClone(this.events[eventId]) : null;
  }

  async transactDraft(
    draftId: string,
    update: (current: unknown | null) => AiActionDraftRecord | undefined
  ): Promise<{ committed: boolean; value: unknown | null }> {
    this.draftTransactions += 1;
    const updated = update(this.drafts[draftId] ? structuredClone(this.drafts[draftId]) : null);
    if (updated === undefined) return { committed: false, value: this.drafts[draftId] ?? null };
    this.drafts[draftId] = structuredClone(updated);
    return { committed: true, value: structuredClone(updated) };
  }

  async transactDraftEvent(
    eventId: string,
    update: (current: unknown | null) => AiActionDraftEvent | undefined
  ): Promise<{ committed: boolean; value: unknown | null }> {
    const updated = update(this.events[eventId] ? structuredClone(this.events[eventId]) : null);
    if (updated === undefined) return { committed: false, value: this.events[eventId] ?? null };
    this.events[eventId] = structuredClone(updated);
    return { committed: true, value: structuredClone(updated) };
  }
}

function reviewInput(draftId: string, action: 'review' | 'cancel', submissionId: string) {
  return { draftId, action, submissionId, expectedCreatedAt: NOW - 1_000 };
}

describe('controlled action drafts', () => {
  it('creates a draft from a valid structured action intent', async () => {
    const store = new MemoryActionDraftStore();
    const result = await createActionDraftFromDecision('decision-1', store);
    expect(result).toMatchObject({ created: true });
    expect(store.drafts[result.draftId!]).toMatchObject({
      actionType: 'prepare_material_request', status: 'draft', sourceDecisionOptionId: 'prepare_alternate_source'
    });
  });

  it('creates no draft when the selected option has no actionIntent', async () => {
    const store = new MemoryActionDraftStore(resolvedDecision([{ id: 'monitor', label: 'Continue monitoring' }]));
    await expect(createActionDraftFromDecision('decision-1', store)).resolves.toEqual({ draftId: null, created: false });
    expect(store.drafts).toEqual({});
  });

  it('rejects an unknown actionType', async () => {
    const option = structuredOption();
    option.actionIntent!.type = 'approve_purchase' as never;
    await expect(createActionDraftFromDecision('decision-1', new MemoryActionDraftStore(resolvedDecision([option]))))
      .rejects.toMatchObject({ code: 'invalid_action_intent' });
  });

  it('never converts arbitrary option label text into an action', async () => {
    const store = new MemoryActionDraftStore(resolvedDecision(['Prepare material request and purchase now']));
    await expect(createActionDraftFromDecision('decision-1', store)).resolves.toEqual({ draftId: null, created: false });
    expect(store.drafts).toEqual({});
  });

  it('preserves explicit null and unknown payload values', async () => {
    const store = new MemoryActionDraftStore();
    const result = await createActionDraftFromDecision('decision-1', store);
    expect(store.drafts[result.draftId!].payload).toMatchObject({
      requestedQuantity: null, supplierReference: null, taskReference: null
    });
  });

  it('marks a draft reviewed without implying execution', async () => {
    const store = new MemoryActionDraftStore();
    const created = await createActionDraftFromDecision('decision-1', store);
    const result = await reviewActionDraft(reviewInput(created.draftId!, 'review', 'submission-review-1'), ACTOR, store, NOW);
    expect(result).toMatchObject({ status: 'reviewed', reviewedAt: NOW, reviewedByRole: 'pm' });
    expect(store.drafts[created.draftId!].status).toBe('reviewed');
  });

  it('cancels a draft without deleting it or changing the source decision', async () => {
    const store = new MemoryActionDraftStore();
    const source = structuredClone(store.decision);
    const created = await createActionDraftFromDecision('decision-1', store);
    const result = await reviewActionDraft(reviewInput(created.draftId!, 'cancel', 'submission-cancel-1'), ACTOR, store, NOW);
    expect(result).toMatchObject({ status: 'cancelled', cancelledAt: NOW, cancelledByRole: 'pm' });
    expect(store.drafts[created.draftId!]).toBeDefined();
    expect(store.decision).toEqual(source);
  });

  it('retains append-only creation and reviewed or cancelled events', async () => {
    for (const action of ['review', 'cancel'] as const) {
      const store = new MemoryActionDraftStore();
      const created = await createActionDraftFromDecision('decision-1', store);
      await reviewActionDraft(reviewInput(created.draftId!, action, `submission-${action}-2`), ACTOR, store, NOW);
      expect(Object.values(store.events).map(event => event.action).sort()).toEqual(
        ['created', action === 'review' ? 'reviewed' : 'cancelled'].sort()
      );
    }
  });

  it('prevents duplicate draft creation for the same resolved option', async () => {
    const store = new MemoryActionDraftStore();
    const first = await createActionDraftFromDecision('decision-1', store);
    const retry = await createActionDraftFromDecision('decision-1', store);
    expect(first).toMatchObject({ created: true });
    expect(retry).toEqual({ draftId: first.draftId, created: false });
    expect(Object.keys(store.drafts)).toHaveLength(1);
    expect(Object.values(store.events).filter(event => event.action === 'created')).toHaveLength(1);

    await reviewActionDraft(reviewInput(first.draftId!, 'review', 'submission-review-final'), ACTOR, store, NOW);
    await expect(createActionDraftFromDecision('decision-1', store)).resolves.toEqual({ draftId: first.draftId, created: false });
    expect(store.drafts[first.draftId!].status).toBe('reviewed');
  });
});
