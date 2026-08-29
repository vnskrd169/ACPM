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

export interface ConditionEvaluation {
  conditionKey: string;
  projectId: string;
  eventType: AiEventRecord['eventType'];
  sourcePath: string;
  sourceRecordId: string;
  eligible: boolean;
  evaluatedAt: number;
}

export interface ConditionTransition {
  condition: AiConditionRecord;
  opened: boolean;
  resolvedEventId: string | null;
}

export interface RunClaim {
  runId: string;
  claimed: boolean;
}

export interface AiPipelineStore {
  getProjectTarget(projectId: string): Promise<AiProjectTarget | null>;
  setProjectTargetLastScan(projectId: string, lastScanAt: number): Promise<void>;
  transitionCondition(evaluation: ConditionEvaluation): Promise<ConditionTransition>;
  ensureEvent(eventId: string, event: AiEventRecord): Promise<AiEventRecord>;
  resolveEvent(eventId: string, resolvedAt: number): Promise<void>;
  getEvent(eventId: string): Promise<AiEventRecord | null>;
  claimRun(eventId: string, runId: string, run: AiRunRecord): Promise<RunClaim>;
  saveRun(runId: string, run: AiRunRecord): Promise<void>;
  saveFinding(runId: string, agentId: AgentId, finding: GroundedFinding): Promise<void>;
  saveRecommendation(id: string, recommendation: AiRecommendationRecord): Promise<void>;
  saveDecision(id: string, decision: AiDecisionRecord): Promise<void>;
  saveEvent(eventId: string, event: AiEventRecord): Promise<void>;
  saveRuntimeStatus(status: AiRuntimeStatusRecord): Promise<void>;
  saveUiStatus(status: AiUiStatus): Promise<void>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryAiPipelineStore implements AiPipelineStore {
  readonly targets = new Map<string, AiProjectTarget>();
  readonly conditions = new Map<string, AiConditionRecord>();
  readonly events = new Map<string, AiEventRecord>();
  readonly runs = new Map<string, AiRunRecord>();
  readonly findings = new Map<string, Partial<Record<AgentId, GroundedFinding>>>();
  readonly recommendations = new Map<string, AiRecommendationRecord>();
  readonly decisions = new Map<string, AiDecisionRecord>();
  runtimeStatus: AiRuntimeStatusRecord | null = null;
  uiStatus: AiUiStatus | null = null;

  constructor(targets: Readonly<Record<string, AiProjectTarget>> = {}) {
    for (const [projectId, target] of Object.entries(targets)) {
      this.targets.set(projectId, clone(target));
    }
  }

  async getProjectTarget(projectId: string): Promise<AiProjectTarget | null> {
    const target = this.targets.get(projectId);
    return target ? clone(target) : null;
  }

  async setProjectTargetLastScan(projectId: string, lastScanAt: number): Promise<void> {
    const target = this.targets.get(projectId);
    if (target) this.targets.set(projectId, { ...target, lastScanAt });
  }

  async transitionCondition(evaluation: ConditionEvaluation): Promise<ConditionTransition> {
    const existing = this.conditions.get(evaluation.conditionKey);
    if (evaluation.eligible) {
      if (existing?.active) {
        const unchanged = { ...existing, lastEvaluatedAt: evaluation.evaluatedAt };
        this.conditions.set(evaluation.conditionKey, unchanged);
        return { condition: clone(unchanged), opened: false, resolvedEventId: null };
      }
      const cycle = (existing?.cycle ?? 0) + 1;
      const currentEventId = `event_${evaluation.conditionKey.replace(/^condition_/, '')}_${cycle}`;
      const opened: AiConditionRecord = {
        schemaVersion: '0.1',
        conditionKey: evaluation.conditionKey,
        projectId: evaluation.projectId,
        eventType: evaluation.eventType,
        sourcePath: evaluation.sourcePath,
        sourceRecordId: evaluation.sourceRecordId,
        active: true,
        cycle,
        currentEventId,
        openedAt: evaluation.evaluatedAt,
        lastEvaluatedAt: evaluation.evaluatedAt,
        resolvedAt: null
      };
      this.conditions.set(evaluation.conditionKey, opened);
      return { condition: clone(opened), opened: true, resolvedEventId: null };
    }

    if (existing?.active) {
      const resolvedEventId = existing.currentEventId;
      const resolved: AiConditionRecord = {
        ...existing,
        active: false,
        currentEventId: null,
        lastEvaluatedAt: evaluation.evaluatedAt,
        resolvedAt: evaluation.evaluatedAt
      };
      this.conditions.set(evaluation.conditionKey, resolved);
      return { condition: clone(resolved), opened: false, resolvedEventId };
    }

    const inactive: AiConditionRecord = existing ?? {
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
    };
    inactive.lastEvaluatedAt = evaluation.evaluatedAt;
    this.conditions.set(evaluation.conditionKey, inactive);
    return { condition: clone(inactive), opened: false, resolvedEventId: null };
  }

  async ensureEvent(eventId: string, event: AiEventRecord): Promise<AiEventRecord> {
    const existing = this.events.get(eventId);
    if (existing) return clone(existing);
    this.events.set(eventId, clone(event));
    return clone(event);
  }

  async resolveEvent(eventId: string, resolvedAt: number): Promise<void> {
    const event = this.events.get(eventId);
    if (event) this.events.set(eventId, { ...event, status: 'resolved', resolvedAt });
  }

  async getEvent(eventId: string): Promise<AiEventRecord | null> {
    const event = this.events.get(eventId);
    return event ? clone(event) : null;
  }

  async claimRun(eventId: string, runId: string, run: AiRunRecord): Promise<RunClaim> {
    const event = this.events.get(eventId);
    if (!event) throw new Error('event_not_found');
    if (event.runId) return { runId: event.runId, claimed: false };
    this.events.set(eventId, { ...event, runId, status: 'processing' });
    this.runs.set(runId, clone(run));
    return { runId, claimed: true };
  }

  async saveRun(runId: string, run: AiRunRecord): Promise<void> {
    this.runs.set(runId, clone(run));
  }

  async saveFinding(runId: string, agentId: AgentId, finding: GroundedFinding): Promise<void> {
    this.findings.set(runId, { ...this.findings.get(runId), [agentId]: clone(finding) });
  }

  async saveRecommendation(id: string, recommendation: AiRecommendationRecord): Promise<void> {
    this.recommendations.set(id, clone(recommendation));
  }

  async saveDecision(id: string, decision: AiDecisionRecord): Promise<void> {
    this.decisions.set(id, clone(decision));
  }

  async saveEvent(eventId: string, event: AiEventRecord): Promise<void> {
    this.events.set(eventId, clone(event));
  }

  async saveRuntimeStatus(status: AiRuntimeStatusRecord): Promise<void> {
    this.runtimeStatus = clone(status);
  }

  async saveUiStatus(status: AiUiStatus): Promise<void> {
    this.uiStatus = clone(status);
  }
}
