import type {
  AiDecisionHistoryEvent,
  AiDecisionRecord
} from './contracts.js';
import {
  aiDecisionRecordSchema,
  aiDecisionRoleSchema,
  aiDecisionSubmissionSchema
} from './schemas.js';

export const DECISION_WORKFLOW_ERROR_CODES = [
  'unauthenticated',
  'inactive_user',
  'unauthorized_role',
  'invalid_decision_request',
  'decision_not_found',
  'decision_malformed',
  'invalid_option',
  'invalid_decision_relationship',
  'stale_decision',
  'decision_already_resolved',
  'duplicate_request_conflict',
  'decision_transaction_failed'
] as const;

export type DecisionWorkflowErrorCode = (typeof DECISION_WORKFLOW_ERROR_CODES)[number];
export type DecisionAction = 'choose' | 'defer' | 'dismiss';
export type DecisionRole = 'boss' | 'owner' | 'admin' | 'pm';

export interface DecisionActor {
  uid: string;
  role: string;
  status: string;
}

export interface DecisionSubmissionInput {
  decisionId: string;
  submissionId: string;
  action: DecisionAction;
  selectedOptionId?: string;
  notes?: string;
  expectedCreatedAt: number;
}

export interface DecisionRelationshipRecord {
  projectId?: unknown;
  eventId?: unknown;
  runId?: unknown;
  decisionId?: unknown;
}

export interface DecisionWorkflowStore {
  getDecision(decisionId: string): Promise<unknown | null>;
  getRecommendation(recommendationId: string): Promise<DecisionRelationshipRecord | null>;
  getEvent(eventId: string): Promise<DecisionRelationshipRecord | null>;
  transactDecision(
    decisionId: string,
    update: (current: unknown | null) => AiDecisionRecord | undefined
  ): Promise<{ committed: boolean; value: unknown | null }>;
}

export interface DecisionSubmissionResult {
  decisionId: string;
  status: AiDecisionRecord['status'];
  resolution: string | null;
  resolutionNotes: string | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolvedByRole: DecisionRole | null;
  deferredAt: number | null;
  deferredBy: string | null;
  deferredByRole: DecisionRole | null;
  auditEventId: string;
  replayed: boolean;
}

export class DecisionWorkflowError extends Error {
  constructor(readonly code: DecisionWorkflowErrorCode) {
    super(code);
    this.name = 'DecisionWorkflowError';
  }
}

function fail(code: DecisionWorkflowErrorCode): never {
  throw new DecisionWorkflowError(code);
}

function normalizedNote(value: string | undefined): string | undefined {
  const note = value?.trim();
  return note ? note : undefined;
}

function historyMatches(
  event: AiDecisionHistoryEvent,
  input: DecisionSubmissionInput,
  actor: { uid: string; role: DecisionRole },
  note: string | undefined
): boolean {
  return event.action === input.action
    && event.actorUid === actor.uid
    && event.actorRole === actor.role
    && (event.selectedOptionId ?? undefined) === input.selectedOptionId
    && (event.notes ?? undefined) === note;
}

function validateRelationships(
  decisionId: string,
  decision: AiDecisionRecord,
  recommendation: DecisionRelationshipRecord | null,
  event: DecisionRelationshipRecord | null
): void {
  if (!recommendation || !event
      || recommendation.projectId !== decision.projectId
      || recommendation.eventId !== decision.eventId
      || recommendation.runId !== decision.runId
      || recommendation.decisionId !== decisionId
      || event.projectId !== decision.projectId
      || event.runId !== decision.runId) {
    fail('invalid_decision_relationship');
  }
}

function hasStoredOption(decision: AiDecisionRecord, selectedOptionId: string): boolean {
  return decision.options.some(option => (typeof option === 'string' ? option : option.id) === selectedOptionId);
}

function publicResult(
  decisionId: string,
  decision: AiDecisionRecord,
  submissionId: string,
  replayed: boolean
): DecisionSubmissionResult {
  return {
    decisionId,
    status: decision.status,
    resolution: decision.resolution ?? null,
    resolutionNotes: decision.resolutionNotes ?? null,
    resolvedAt: decision.resolvedAt ?? null,
    resolvedBy: decision.resolvedBy ?? null,
    resolvedByRole: decision.resolvedByRole ?? null,
    deferredAt: decision.deferredAt ?? null,
    deferredBy: decision.deferredBy ?? null,
    deferredByRole: decision.deferredByRole ?? null,
    auditEventId: submissionId,
    replayed
  };
}

export async function submitHumanDecision(
  rawInput: unknown,
  rawActor: DecisionActor | null,
  store: DecisionWorkflowStore,
  now = Date.now()
): Promise<DecisionSubmissionResult> {
  if (!rawActor?.uid) fail('unauthenticated');
  if (rawActor.status !== 'active') fail('inactive_user');
  const parsedRole = aiDecisionRoleSchema.safeParse(rawActor.role);
  if (!parsedRole.success) fail('unauthorized_role');
  const parsedInput = aiDecisionSubmissionSchema.safeParse(rawInput);
  if (!parsedInput.success) fail('invalid_decision_request');

  const input = parsedInput.data;
  const actor = { uid: rawActor.uid, role: parsedRole.data };
  const stored = await store.getDecision(input.decisionId);
  if (stored === null) fail('decision_not_found');
  const parsedDecision = aiDecisionRecordSchema.safeParse(stored);
  if (!parsedDecision.success) fail('decision_malformed');
  const decision = parsedDecision.data;
  const [recommendation, event] = await Promise.all([
    store.getRecommendation(decision.recommendationId),
    store.getEvent(decision.eventId)
  ]);
  validateRelationships(input.decisionId, decision, recommendation, event);
  if (decision.createdAt !== input.expectedCreatedAt) fail('stale_decision');

  const note = normalizedNote(input.notes);
  const existingHistory = decision.history?.[input.submissionId];
  if (existingHistory) {
    if (!historyMatches(existingHistory, input, actor, note)) fail('duplicate_request_conflict');
    return publicResult(input.decisionId, decision, input.submissionId, true);
  }
  if (decision.status !== 'open') fail('decision_already_resolved');
  if (input.action === 'choose' && !hasStoredOption(decision, input.selectedOptionId ?? '')) {
    fail('invalid_option');
  }

  let abortCode: DecisionWorkflowErrorCode | null = null;
  let replayed = false;
  let transaction;
  try {
    transaction = await store.transactDecision(input.decisionId, current => {
      abortCode = null;
      replayed = false;
      const currentParsed = aiDecisionRecordSchema.safeParse(current);
      if (!currentParsed.success) {
        abortCode = current === null ? 'decision_not_found' : 'decision_malformed';
        return undefined;
      }
      const currentDecision = currentParsed.data;
      if (currentDecision.createdAt !== input.expectedCreatedAt
          || currentDecision.projectId !== decision.projectId
          || currentDecision.eventId !== decision.eventId
          || currentDecision.runId !== decision.runId
          || currentDecision.recommendationId !== decision.recommendationId) {
        abortCode = 'stale_decision';
        return undefined;
      }
      const duplicate = currentDecision.history?.[input.submissionId];
      if (duplicate) {
        if (!historyMatches(duplicate, input, actor, note)) {
          abortCode = 'duplicate_request_conflict';
          return undefined;
        }
        replayed = true;
        return currentDecision;
      }
      if (currentDecision.status !== 'open') {
        abortCode = 'decision_already_resolved';
        return undefined;
      }
      if (input.action === 'choose' && !hasStoredOption(currentDecision, input.selectedOptionId ?? '')) {
        abortCode = 'invalid_option';
        return undefined;
      }

      const auditEvent: AiDecisionHistoryEvent = {
        decisionId: input.decisionId,
        projectId: currentDecision.projectId,
        action: input.action,
        actorUid: actor.uid,
        actorRole: actor.role,
        timestamp: now,
        ...(input.action === 'choose' ? { selectedOptionId: input.selectedOptionId } : {}),
        ...(note ? { notes: note } : {})
      };
      const history = { ...(currentDecision.history ?? {}), [input.submissionId]: auditEvent };
      if (input.action === 'defer') {
        return {
          ...currentDecision,
          status: 'open',
          deferredAt: now,
          deferredBy: actor.uid,
          deferredByRole: actor.role,
          history
        };
      }
      if (input.action === 'dismiss') {
        return {
          ...currentDecision,
          status: 'dismissed',
          resolvedAt: now,
          resolvedBy: actor.uid,
          resolvedByRole: actor.role,
          resolution: null,
          resolutionNotes: note ?? null,
          history
        };
      }
      return {
        ...currentDecision,
        status: 'resolved',
        resolvedAt: now,
        resolvedBy: actor.uid,
        resolvedByRole: actor.role,
        resolution: input.selectedOptionId,
        resolutionNotes: note ?? null,
        history
      };
    });
  } catch {
    fail('decision_transaction_failed');
  }
  if (!transaction.committed) fail(abortCode ?? 'decision_transaction_failed');
  const committed = aiDecisionRecordSchema.safeParse(transaction.value);
  if (!committed.success) fail('decision_transaction_failed');
  return publicResult(input.decisionId, committed.data, input.submissionId, replayed);
}

export type DecisionHttpsCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'invalid-argument'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted'
  | 'internal';

export function mapDecisionWorkflowError(error: unknown): {
  httpsCode: DecisionHttpsCode;
  safeCode: DecisionWorkflowErrorCode | 'decision_submission_failed';
} {
  if (!(error instanceof DecisionWorkflowError)) {
    return { httpsCode: 'internal', safeCode: 'decision_submission_failed' };
  }
  if (error.code === 'unauthenticated') return { httpsCode: 'unauthenticated', safeCode: error.code };
  if (error.code === 'inactive_user' || error.code === 'unauthorized_role') {
    return { httpsCode: 'permission-denied', safeCode: error.code };
  }
  if (error.code === 'invalid_decision_request' || error.code === 'invalid_option'
      || error.code === 'duplicate_request_conflict') {
    return { httpsCode: 'invalid-argument', safeCode: error.code };
  }
  if (error.code === 'decision_not_found') return { httpsCode: 'not-found', safeCode: error.code };
  if (error.code === 'decision_transaction_failed') return { httpsCode: 'aborted', safeCode: error.code };
  return { httpsCode: 'failed-precondition', safeCode: error.code };
}
