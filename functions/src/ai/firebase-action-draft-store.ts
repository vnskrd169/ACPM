import type { Database } from 'firebase-admin/database';

import type { AiActionDraftEvent, AiActionDraftRecord } from './contracts.js';
import type { ActionDraftWorkflowStore } from './action-draft-workflow.js';
import { assertAiWritePath } from './security.js';

export class FirebaseActionDraftStore implements ActionDraftWorkflowStore {
  constructor(private readonly database: Database) {}

  async getDecision(decisionId: string): Promise<unknown | null> {
    const snapshot = await this.database.ref(`ai/decisions/${decisionId}`).get();
    return snapshot.exists() ? snapshot.val() : null;
  }

  async getDraft(draftId: string): Promise<unknown | null> {
    const snapshot = await this.database.ref(`ai/actionDrafts/${draftId}`).get();
    return snapshot.exists() ? snapshot.val() : null;
  }

  async getDraftEvent(eventId: string): Promise<unknown | null> {
    const snapshot = await this.database.ref(`ai/actionDraftEvents/${eventId}`).get();
    return snapshot.exists() ? snapshot.val() : null;
  }

  async transactDraft(
    draftId: string,
    update: (current: unknown | null) => AiActionDraftRecord | undefined
  ): Promise<{ committed: boolean; value: unknown | null }> {
    const path = `ai/actionDrafts/${draftId}`;
    assertAiWritePath(path);
    const result = await this.database.ref(path).transaction(update);
    return { committed: result.committed, value: result.snapshot.exists() ? result.snapshot.val() : null };
  }

  async transactDraftEvent(
    eventId: string,
    update: (current: unknown | null) => AiActionDraftEvent | undefined
  ): Promise<{ committed: boolean; value: unknown | null }> {
    const path = `ai/actionDraftEvents/${eventId}`;
    assertAiWritePath(path);
    const result = await this.database.ref(path).transaction(update);
    return { committed: result.committed, value: result.snapshot.exists() ? result.snapshot.val() : null };
  }
}
