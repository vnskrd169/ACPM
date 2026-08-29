import type { Database, Reference } from 'firebase-admin/database';

import type {
  AgentId,
  AiConditionRecord,
  AiDecisionRecord,
  AiEventRecord,
  AiProjectTarget,
  AiRecommendationRecord,
  AiRunRecord,
  AiRuntimeStatusRecord,
  AiUiStatus,
  GroundedFinding
} from './contracts.js';
import { aiProjectTargetSchema, aiUiStatusSchema } from './schemas.js';
import { assertAiWritePath } from './security.js';
import type {
  AiPipelineStore,
  ConditionEvaluation,
  ConditionTransition,
  RunClaim
} from './store.js';

export class FirebaseAiPipelineStore implements AiPipelineStore {
  constructor(private readonly database: Database) {}

  private aiRef(path: string): Reference {
    assertAiWritePath(path);
    return this.database.ref(path);
  }

  async getProjectTarget(projectId: string): Promise<AiProjectTarget | null> {
    const snapshot = await this.database.ref(`ai/projectTargets/${projectId}`).get();
    if (!snapshot.exists()) return null;
    return aiProjectTargetSchema.parse({
      activationAt: null,
      lastScanAt: null,
      ...snapshot.val()
    });
  }

  async setProjectTargetLastScan(projectId: string, lastScanAt: number): Promise<void> {
    await this.aiRef(`ai/projectTargets/${projectId}/lastScanAt`).set(lastScanAt);
  }

  async transitionCondition(evaluation: ConditionEvaluation): Promise<ConditionTransition> {
    const reference = this.aiRef(`ai/conditions/${evaluation.conditionKey}`);
    let opened = false;
    let resolvedEventId: string | null = null;
    const result = await reference.transaction((current: AiConditionRecord | null) => {
      opened = false;
      resolvedEventId = null;
      if (evaluation.eligible) {
        if (current?.active) {
          return { ...current, lastEvaluatedAt: evaluation.evaluatedAt };
        }
        const cycle = (current?.cycle ?? 0) + 1;
        opened = true;
        return {
          schemaVersion: '0.1',
          conditionKey: evaluation.conditionKey,
          projectId: evaluation.projectId,
          eventType: evaluation.eventType,
          sourcePath: evaluation.sourcePath,
          sourceRecordId: evaluation.sourceRecordId,
          active: true,
          cycle,
          currentEventId: `event_${evaluation.conditionKey.replace(/^condition_/, '')}_${cycle}`,
          openedAt: evaluation.evaluatedAt,
          lastEvaluatedAt: evaluation.evaluatedAt,
          resolvedAt: null
        } satisfies AiConditionRecord;
      }
      if (current?.active) {
        resolvedEventId = current.currentEventId;
        return {
          ...current,
          active: false,
          currentEventId: null,
          lastEvaluatedAt: evaluation.evaluatedAt,
          resolvedAt: evaluation.evaluatedAt
        } satisfies AiConditionRecord;
      }
      return current ?? {
        schemaVersion: '0.1',
        conditionKey: evaluation.conditionKey,
        projectId: evaluation.projectId,
        eventType: evaluation.eventType,
        sourcePath: evaluation.sourcePath,
        sourceRecordId: evaluation.sourceRecordId,
        active: false,
        cycle: 0,
        currentEventId: null,
        openedAt: null,
        lastEvaluatedAt: evaluation.evaluatedAt,
        resolvedAt: null
      } satisfies AiConditionRecord;
    });
    if (!result.committed) throw new Error('condition_transaction_aborted');
    return {
      condition: result.snapshot.val() as AiConditionRecord,
      opened,
      resolvedEventId
    };
  }

  async ensureEvent(eventId: string, event: AiEventRecord): Promise<AiEventRecord> {
    const claimRef = this.aiRef(`ai/idempotency/eventClaims/${event.dedupKey}`);
    const claim = await claimRef.transaction(current => current ?? {
      eventId,
      claimedAt: event.createdAt
    });
    const claimedEventId = String(claim.snapshot.child('eventId').val() ?? '');
    if (claimedEventId !== eventId) throw new Error('event_dedup_conflict');

    const eventRef = this.aiRef(`ai/events/${eventId}`);
    const result = await eventRef.transaction(current => current ?? event);
    if (!result.committed) throw new Error('event_transaction_aborted');
    return result.snapshot.val() as AiEventRecord;
  }

  async resolveEvent(eventId: string, resolvedAt: number): Promise<void> {
    await this.aiRef(`ai/events/${eventId}`).transaction((current: AiEventRecord | null) => (
      current ? { ...current, status: 'resolved', resolvedAt } : current
    ));
  }

  async getEvent(eventId: string): Promise<AiEventRecord | null> {
    const snapshot = await this.database.ref(`ai/events/${eventId}`).get();
    return snapshot.exists() ? snapshot.val() as AiEventRecord : null;
  }

  async claimRun(eventId: string, runId: string, run: AiRunRecord): Promise<RunClaim> {
    let claimed = false;
    const eventRef = this.aiRef(`ai/events/${eventId}`);
    const result = await eventRef.transaction((current: AiEventRecord | null) => {
      claimed = false;
      if (!current) return;
      if (current.runId) return current;
      claimed = true;
      return { ...current, runId, status: 'processing' } satisfies AiEventRecord;
    });
    if (!result.committed || !result.snapshot.exists()) throw new Error('event_claim_failed');
    const claimedRunId = String(result.snapshot.child('runId').val());
    if (claimedRunId === runId) {
      await this.aiRef(`ai/runs/${runId}`).transaction(current => current ?? run);
    }
    return { runId: claimedRunId, claimed };
  }

  async saveRun(runId: string, run: AiRunRecord): Promise<void> {
    await this.aiRef(`ai/runs/${runId}`).set(run);
  }

  async saveFinding(runId: string, agentId: AgentId, finding: GroundedFinding): Promise<void> {
    await this.aiRef(`ai/findings/${runId}/${agentId}`).set(finding);
  }

  async saveRecommendation(id: string, recommendation: AiRecommendationRecord): Promise<void> {
    await this.aiRef(`ai/recommendations/${id}`).set(recommendation);
  }

  async saveDecision(id: string, decision: AiDecisionRecord): Promise<void> {
    await this.aiRef(`ai/decisions/${id}`).set(decision);
  }

  async saveEvent(eventId: string, event: AiEventRecord): Promise<void> {
    await this.aiRef(`ai/events/${eventId}`).set(event);
  }

  async saveRuntimeStatus(status: AiRuntimeStatusRecord): Promise<void> {
    await this.aiRef('ai/runtimeStatus').set(status);
  }

  async saveUiStatus(status: AiUiStatus): Promise<void> {
    await this.aiRef('ai/uiStatus').set(aiUiStatusSchema.parse(status));
  }
}
