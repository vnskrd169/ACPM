import { describe, expect, it } from 'vitest';

import type { GroundedFinding } from '../src/ai/contracts.js';
import { AGENT_IDS, AI_EVENT_TYPES } from '../src/ai/contracts.js';
import {
  evidenceReferenceSchema,
  groundedFindingSchema,
  routePlanSchema
} from '../src/ai/schemas.js';

const evidence = {
  path: 'projects/project-1/tasks',
  recordId: 'task-1',
  field: 'dueDate'
};

function validFinding(): GroundedFinding {
  return {
    schemaVersion: '0.1' as const,
    agentId: 'planning' as const,
    severity: 'high' as const,
    summary: 'A recorded task is overdue.',
    facts: [{ claim: 'The due date is before today.', evidenceRefs: [evidence] }],
    unknowns: [{ field: 'dependencyImpact', reason: 'No task dependency is stored.' }],
    scheduleImpact: {
      status: 'unknown' as const,
      days: null,
      reason: 'No dependency or duration is stored.',
      evidenceRefs: [evidence]
    },
    costImpact: {
      status: 'unknown' as const,
      amount: null,
      currency: null,
      reason: 'No grounded cost record is available.',
      evidenceRefs: []
    },
    recommendedActions: ['Review the task with the assigned project manager.'],
    needsHumanDecision: false,
    decisionQuestion: null
  };
}

describe('AI contracts and schemas', () => {
  it('defines only the three initial agents and four initial events', () => {
    expect(AGENT_IDS).toEqual(['pm', 'planning', 'materials']);
    expect(AI_EVENT_TYPES).toEqual([
      'material_delivery_overdue',
      'material_stock_low',
      'task_overdue',
      'site_issue_created'
    ]);
  });

  it('accepts an explicitly grounded finding with null unknown impacts', () => {
    const parsed = groundedFindingSchema.parse(validFinding());
    expect(parsed.scheduleImpact.days).toBeNull();
    expect(parsed.costImpact.amount).toBeNull();
    expect(parsed.costImpact.currency).toBeNull();
    expect(parsed.unknowns[0]?.reason).toContain('dependency');
  });

  it('rejects silently converting unknown schedule impact to zero', () => {
    const finding = validFinding();
    finding.scheduleImpact.days = 0;
    expect(groundedFindingSchema.safeParse(finding).success).toBe(false);
  });

  it('rejects silently converting unknown cost impact to zero PHP', () => {
    const finding = validFinding();
    finding.costImpact.amount = 0;
    finding.costImpact.currency = 'PHP';
    expect(groundedFindingSchema.safeParse(finding).success).toBe(false);
  });

  it('requires path, recordId, and field on evidence references', () => {
    expect(evidenceReferenceSchema.safeParse(evidence).success).toBe(true);
    expect(evidenceReferenceSchema.safeParse({ path: evidence.path, recordId: evidence.recordId }).success).toBe(false);
  });

  it('requires PM to be the unique final routing agent', () => {
    expect(routePlanSchema.safeParse({
      eventType: 'task_overdue',
      agents: ['planning', 'pm']
    }).success).toBe(true);
    expect(routePlanSchema.safeParse({
      eventType: 'task_overdue',
      agents: ['pm', 'planning']
    }).success).toBe(false);
    expect(routePlanSchema.safeParse({
      eventType: 'task_overdue',
      agents: ['planning', 'pm', 'pm']
    }).success).toBe(false);
  });

  it('requires a decision question only when human input is needed', () => {
    const missingQuestion = validFinding();
    missingQuestion.needsHumanDecision = true;
    expect(groundedFindingSchema.safeParse(missingQuestion).success).toBe(false);

    const unexpectedQuestion = validFinding();
    unexpectedQuestion.decisionQuestion = 'Choose an option?';
    expect(groundedFindingSchema.safeParse(unexpectedQuestion).success).toBe(false);
  });
});
