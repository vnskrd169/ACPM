import type {
  AiActionDraftEvent,
  AiActionDraftRecord,
  AiDecisionRecord,
  AiStructuredDecisionOption
} from './contracts.js';
import { deterministicId, stableJson } from './determinism.js';
import type { DecisionActor, DecisionRole } from './decision-workflow.js';
import {
  aiActionDraftEventSchema,
  aiActionDraftRecordSchema,
  aiActionDraftReviewInputSchema,
  aiDecisionRecordSchema,
  aiDecisionRoleSchema
} from './schemas.js';

export const ACTION_DRAFT_ERROR_CODES = [
  'unauthenticated',
  'inactive_user',
  'unauthorized_role',
  'invalid_action_draft_request',
  'decision_not_found',
  'decision_not_resolved',
  'invalid_action_intent',
  'action_draft_not_found',
  'action_draft_malformed',
  'stale_action_draft',
  'action_draft_already_final',
  'duplicate_request_conflict',
  'action_draft_transaction_failed'
] as const;

export type ActionDraftErrorCode = (typeof ACTION_DRAFT_ERROR_CODES)[number];

export interface ActionDraftWorkflowStore {
  getDecision(decisionId: string): Promise<unknown | null>;
  getDraft(draftId: string): Promise<unknown | null>;
  getDraftEvent(eventId: string): Promise<unknown | null>;
  transactDraft(
    draftId: string,
    update: (current: unknown | null) => AiActionDraftRecord | undefined
  ): Promise<{ committed: boolean; value: unknown | null }>;
  transactDraftEvent(
    eventId: string,
    update: (current: unknown | null) => AiActionDraftEvent | undefined
  ): Promise<{ committed: boolean; value: unknown | null }>;
}

export interface ActionDraftCreationResult {
  draftId: string | null;
  created: boolean;
}

export interface ActionDraftReviewResult {
  draftId: string;
  status: AiActionDraftRecord['status'];
  reviewedAt: number | null;
  reviewedBy: string | null;
  reviewedByRole: DecisionRole | null;
  cancelledAt: number | null;
  cancelledBy: string | null;
  cancelledByRole: DecisionRole | null;
  auditEventId: string;
  replayed: boolean;
}

export class ActionDraftWorkflowError extends Error {
  constructor(readonly code: ActionDraftErrorCode) {
    super(code);
    this.name = 'ActionDraftWorkflowError';
  }
}

function fail(code: ActionDraftErrorCode): never {
  throw new ActionDraftWorkflowError(code);
}

function structuredSelectedOption(decision: AiDecisionRecord): AiStructuredDecisionOption | null {
  if (!decision.resolution) return null;
  const option = decision.options.find(candidate => (
    typeof candidate === 'object' && candidate.id === decision.resolution
  ));
  return option && typeof option === 'object' ? option : null;
}

function eventMatches(
  event: AiActionDraftEvent,
  draft: AiActionDraftRecord,
  action: AiActionDraftEvent['action'],
  actorUid: string,
  actorRole: DecisionRole,
  timestamp?: number
): boolean {
  return event.draftId === deterministicId('action_draft', {
    decisionId: draft.decisionId,
    optionId: draft.sourceDecisionOptionId
  })
    && event.decisionId === draft.decisionId
    && event.projectId === draft.projectId
    && event.action === action
    && event.actorUid === actorUid
    && event.actorRole === actorRole
    && (timestamp === undefined || event.timestamp === timestamp);
}

async function ensureDraftEvent(
  eventId: string,
  event: AiActionDraftEvent,
  store: ActionDraftWorkflowStore
): Promise<void> {
  let conflict = false;
  let replayed = false;
  let transaction;
  try {
    transaction = await store.transactDraftEvent(eventId, current => {
      if (current === null) return event;
      const parsed = aiActionDraftEventSchema.safeParse(current);
      if (!parsed.success || stableJson(parsed.data) !== stableJson(event)) conflict = true;
      else replayed = true;
      return undefined;
    });
  } catch {
    fail('action_draft_transaction_failed');
  }
  if (conflict || (!transaction.committed && !replayed)) fail('duplicate_request_conflict');
}

function draftSourceMatches(current: AiActionDraftRecord, expected: AiActionDraftRecord): boolean {
  return current.schemaVersion === expected.schemaVersion
    && current.decisionId === expected.decisionId
    && current.recommendationId === expected.recommendationId
    && current.eventId === expected.eventId
    && current.projectId === expected.projectId
    && current.actionType === expected.actionType
    && current.title === expected.title
    && current.summary === expected.summary
    && current.createdAt === expected.createdAt
    && current.createdBy === expected.createdBy
    && current.sourceDecisionOptionId === expected.sourceDecisionOptionId
    && stableJson(current.payload) === stableJson(expected.payload);
}

export async function createActionDraftFromDecision(
  decisionId: string,
  store: ActionDraftWorkflowStore
): Promise<ActionDraftCreationResult> {
  const stored = await store.getDecision(decisionId);
  if (stored === null) fail('decision_not_found');
  const parsedDecision = aiDecisionRecordSchema.safeParse(stored);
  if (!parsedDecision.success) fail('invalid_action_intent');
  const decision = parsedDecision.data;
  if (decision.status !== 'resolved' || !decision.resolvedAt || !decision.resolvedBy || !decision.resolvedByRole) {
    fail('decision_not_resolved');
  }

  const selected = structuredSelectedOption(decision);
  if (!selected?.actionIntent) return { draftId: null, created: false };

  const draftId = deterministicId('action_draft', { decisionId, optionId: selected.id });
  const createdEventId = deterministicId('action_draft_event', { draftId, action: 'created' });
  const draft: AiActionDraftRecord = {
    schemaVersion: '0.1',
    decisionId,
    recommendationId: decision.recommendationId,
    eventId: decision.eventId,
    projectId: decision.projectId,
    actionType: selected.actionIntent.type,
    title: selected.actionIntent.title,
    summary: selected.actionIntent.summary,
    status: 'draft',
    createdAt: decision.resolvedAt,
    createdBy: decision.resolvedBy,
    reviewedAt: null,
    reviewedBy: null,
    reviewedByRole: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelledByRole: null,
    sourceDecisionOptionId: selected.id,
    payload: structuredClone(selected.actionIntent.payload),
    lastEventId: createdEventId
  };
  const validatedDraft = aiActionDraftRecordSchema.safeParse(draft);
  if (!validatedDraft.success) fail('invalid_action_intent');

  const alreadyStored = await store.getDraft(draftId);
  if (alreadyStored !== null) {
    const parsedStored = aiActionDraftRecordSchema.safeParse(alreadyStored);
    if (!parsedStored.success || !draftSourceMatches(parsedStored.data, validatedDraft.data)) {
      fail('duplicate_request_conflict');
    }
    await ensureDraftEvent(createdEventId, {
      draftId,
      decisionId,
      projectId: decision.projectId,
      action: 'created',
      actorUid: decision.resolvedBy,
      actorRole: decision.resolvedByRole,
      timestamp: decision.resolvedAt
    }, store);
    return { draftId, created: false };
  }

  let created = false;
  let conflict = false;
  let replayed = false;
  let transaction;
  try {
    transaction = await store.transactDraft(draftId, current => {
      if (current === null) {
        created = true;
        return validatedDraft.data;
      }
      const parsed = aiActionDraftRecordSchema.safeParse(current);
      if (!parsed.success || !draftSourceMatches(parsed.data, validatedDraft.data)) conflict = true;
      else replayed = true;
      return undefined;
    });
  } catch {
    fail('action_draft_transaction_failed');
  }
  if (conflict || (!transaction.committed && !replayed)) fail('duplicate_request_conflict');

  await ensureDraftEvent(createdEventId, {
    draftId,
    decisionId,
    projectId: decision.projectId,
    action: 'created',
    actorUid: decision.resolvedBy,
    actorRole: decision.resolvedByRole,
    timestamp: decision.resolvedAt
  }, store);
  return { draftId, created };
}

function publicReviewResult(
  draftId: string,
  draft: AiActionDraftRecord,
  auditEventId: string,
  replayed: boolean
): ActionDraftReviewResult {
  return {
    draftId,
    status: draft.status,
    reviewedAt: draft.reviewedAt ?? null,
    reviewedBy: draft.reviewedBy ?? null,
    reviewedByRole: draft.reviewedByRole ?? null,
    cancelledAt: draft.cancelledAt ?? null,
    cancelledBy: draft.cancelledBy ?? null,
    cancelledByRole: draft.cancelledByRole ?? null,
    auditEventId,
    replayed
  };
}

export async function reviewActionDraft(
  rawInput: unknown,
  rawActor: DecisionActor | null,
  store: ActionDraftWorkflowStore,
  now = Date.now()
): Promise<ActionDraftReviewResult> {
  if (!rawActor?.uid) fail('unauthenticated');
  if (rawActor.status !== 'active') fail('inactive_user');
  const parsedRole = aiDecisionRoleSchema.safeParse(rawActor.role);
  if (!parsedRole.success) fail('unauthorized_role');
  const parsedInput = aiActionDraftReviewInputSchema.safeParse(rawInput);
  if (!parsedInput.success) fail('invalid_action_draft_request');
  const input = parsedInput.data;
  const actor = { uid: rawActor.uid, role: parsedRole.data };

  const stored = await store.getDraft(input.draftId);
  if (stored === null) fail('action_draft_not_found');
  const parsedDraft = aiActionDraftRecordSchema.safeParse(stored);
  if (!parsedDraft.success) fail('action_draft_malformed');
  const draft = parsedDraft.data;
  if (draft.createdAt !== input.expectedCreatedAt) fail('stale_action_draft');
  const eventAction = input.action === 'review' ? 'reviewed' : 'cancelled';
  const expectedFinalStatus = eventAction;

  const existingEvent = await store.getDraftEvent(input.submissionId);
  if (existingEvent !== null) {
    const parsedEvent = aiActionDraftEventSchema.safeParse(existingEvent);
    if (!parsedEvent.success || !eventMatches(parsedEvent.data, draft, eventAction, actor.uid, actor.role)) {
      fail('duplicate_request_conflict');
    }
    if (draft.status !== expectedFinalStatus || draft.lastEventId !== input.submissionId) {
      fail('duplicate_request_conflict');
    }
    return publicReviewResult(input.draftId, draft, input.submissionId, true);
  }

  if (draft.status !== 'draft') {
    if (draft.status === expectedFinalStatus && draft.lastEventId === input.submissionId) {
      const timestamp = eventAction === 'reviewed' ? draft.reviewedAt : draft.cancelledAt;
      if (timestamp === null) fail('action_draft_malformed');
      await ensureDraftEvent(input.submissionId, {
        draftId: input.draftId,
        decisionId: draft.decisionId,
        projectId: draft.projectId,
        action: eventAction,
        actorUid: actor.uid,
        actorRole: actor.role,
        timestamp
      }, store);
      return publicReviewResult(input.draftId, draft, input.submissionId, true);
    }
    fail('action_draft_already_final');
  }

  let abortCode: ActionDraftErrorCode | null = null;
  let replayed = false;
  let transaction;
  try {
    transaction = await store.transactDraft(input.draftId, current => {
      abortCode = null;
      replayed = false;
      const parsed = aiActionDraftRecordSchema.safeParse(current);
      if (!parsed.success) {
        abortCode = current === null ? 'action_draft_not_found' : 'action_draft_malformed';
        return undefined;
      }
      const currentDraft = parsed.data;
      if (currentDraft.createdAt !== input.expectedCreatedAt
          || currentDraft.decisionId !== draft.decisionId
          || currentDraft.projectId !== draft.projectId
          || currentDraft.sourceDecisionOptionId !== draft.sourceDecisionOptionId) {
        abortCode = 'stale_action_draft';
        return undefined;
      }
      if (currentDraft.status !== 'draft') {
        if (currentDraft.status === expectedFinalStatus && currentDraft.lastEventId === input.submissionId) {
          replayed = true;
          return undefined;
        }
        abortCode = 'action_draft_already_final';
        return undefined;
      }
      if (eventAction === 'reviewed') {
        return {
          ...currentDraft,
          status: 'reviewed',
          reviewedAt: now,
          reviewedBy: actor.uid,
          reviewedByRole: actor.role,
          lastEventId: input.submissionId
        };
      }
      return {
        ...currentDraft,
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: actor.uid,
        cancelledByRole: actor.role,
        lastEventId: input.submissionId
      };
    });
  } catch {
    fail('action_draft_transaction_failed');
  }
  if (!transaction.committed && !replayed) fail(abortCode ?? 'action_draft_transaction_failed');
  const committed = aiActionDraftRecordSchema.safeParse(transaction.value);
  if (!committed.success) fail('action_draft_transaction_failed');
  const timestamp = eventAction === 'reviewed' ? committed.data.reviewedAt : committed.data.cancelledAt;
  if (timestamp === null) fail('action_draft_transaction_failed');
  await ensureDraftEvent(input.submissionId, {
    draftId: input.draftId,
    decisionId: committed.data.decisionId,
    projectId: committed.data.projectId,
    action: eventAction,
    actorUid: actor.uid,
    actorRole: actor.role,
    timestamp
  }, store);
  return publicReviewResult(input.draftId, committed.data, input.submissionId, replayed);
}

export type ActionDraftHttpsCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted'
  | 'internal';

export function mapActionDraftError(error: unknown): {
  httpsCode: ActionDraftHttpsCode;
  safeCode: ActionDraftErrorCode | 'action_draft_request_failed';
} {
  if (!(error instanceof ActionDraftWorkflowError)) {
    return { httpsCode: 'internal', safeCode: 'action_draft_request_failed' };
  }
  if (error.code === 'unauthenticated') return { httpsCode: 'unauthenticated', safeCode: error.code };
  if (error.code === 'inactive_user' || error.code === 'unauthorized_role') {
    return { httpsCode: 'permission-denied', safeCode: error.code };
  }
  if (error.code === 'invalid_action_draft_request' || error.code === 'duplicate_request_conflict') {
    return { httpsCode: 'invalid-argument', safeCode: error.code };
  }
  if (error.code === 'action_draft_not_found' || error.code === 'decision_not_found') {
    return { httpsCode: 'not-found', safeCode: error.code };
  }
  if (error.code === 'action_draft_transaction_failed') {
    return { httpsCode: 'aborted', safeCode: error.code };
  }
  return { httpsCode: 'failed-precondition', safeCode: error.code };
}
