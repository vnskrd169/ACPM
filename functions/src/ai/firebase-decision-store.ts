import type { Database } from 'firebase-admin/database';

import type { AiDecisionRecord } from './contracts.js';
import type {
  DecisionRelationshipRecord,
  DecisionWorkflowStore
} from './decision-workflow.js';
import { assertAiWritePath } from './security.js';

export class FirebaseDecisionWorkflowStore implements DecisionWorkflowStore {
  constructor(private readonly database: Database) {}

  async getDecision(decisionId: string): Promise<unknown | null> {
    const snapshot = await this.database.ref(`ai/decisions/${decisionId}`).get();
    return snapshot.exists() ? snapshot.val() : null;
  }

  async getRecommendation(recommendationId: string): Promise<DecisionRelationshipRecord | null> {
    const snapshot = await this.database.ref(`ai/recommendations/${recommendationId}`).get();
    return snapshot.exists() ? snapshot.val() as DecisionRelationshipRecord : null;
  }

  async getEvent(eventId: string): Promise<DecisionRelationshipRecord | null> {
    const snapshot = await this.database.ref(`ai/events/${eventId}`).get();
    return snapshot.exists() ? snapshot.val() as DecisionRelationshipRecord : null;
  }

  async transactDecision(
    decisionId: string,
    update: (current: unknown | null) => AiDecisionRecord | undefined
  ): Promise<{ committed: boolean; value: unknown | null }> {
    const path = `ai/decisions/${decisionId}`;
    assertAiWritePath(path);
    const result = await this.database.ref(path).transaction(update);
    return {
      committed: result.committed,
      value: result.snapshot.exists() ? result.snapshot.val() : null
    };
  }
}
