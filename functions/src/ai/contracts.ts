export const AGENT_IDS = ['pm', 'planning', 'materials'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AI_EVENT_TYPES = [
  'material_delivery_overdue',
  'material_stock_low',
  'task_overdue',
  'site_issue_created'
] as const;
export type AiEventType = (typeof AI_EVENT_TYPES)[number];

export type AiEventFlags = Readonly<Record<AiEventType, boolean>>;

export interface AiConfig {
  enabled: boolean;
  generationEnabled: boolean;
  uiEnabled: boolean;
  dryRun: boolean;
  timeZone: 'Asia/Manila';
  maxAttempts: number;
  eventTypes: AiEventFlags;
}

export interface AiProjectTarget {
  schemaVersion: '0.1';
  enabled: boolean;
  activationAt: number | null;
  scanTasks: boolean;
  scanMaterials: boolean;
  scanIssues: boolean;
  lastScanAt: number | null;
}

export const AI_PROJECT_TARGET_DEFAULTS: Readonly<AiProjectTarget> = Object.freeze({
  schemaVersion: '0.1',
  enabled: false,
  activationAt: null,
  scanTasks: false,
  scanMaterials: false,
  scanIssues: false,
  lastScanAt: null
});

export const AI_CONFIG_DEFAULTS: Readonly<AiConfig> = Object.freeze({
  enabled: false,
  generationEnabled: false,
  uiEnabled: false,
  dryRun: true,
  timeZone: 'Asia/Manila',
  maxAttempts: 3,
  eventTypes: Object.freeze({
    material_delivery_overdue: false,
    material_stock_low: false,
    task_overdue: false,
    site_issue_created: false
  })
});

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const IMPACT_STATUSES = ['none', 'possible', 'confirmed', 'unknown'] as const;
export type ImpactStatus = (typeof IMPACT_STATUSES)[number];

export interface EvidenceReference {
  path: string;
  recordId: string;
  field: string;
}

export interface GroundedFact {
  claim: string;
  evidenceRefs: EvidenceReference[];
}

export interface UnknownFact {
  field: string;
  reason: string;
}

export interface ScheduleImpact {
  status: ImpactStatus;
  days: number | null;
  reason: string | null;
  evidenceRefs: EvidenceReference[];
}

export interface CostImpact {
  status: ImpactStatus;
  amount: number | null;
  currency: 'PHP' | null;
  reason: string | null;
  evidenceRefs: EvidenceReference[];
}

export interface GroundedFinding {
  schemaVersion: '0.1';
  agentId: AgentId;
  severity: Severity;
  summary: string;
  facts: GroundedFact[];
  unknowns: UnknownFact[];
  scheduleImpact: ScheduleImpact;
  costImpact: CostImpact;
  recommendedActions: string[];
  needsHumanDecision: boolean;
  decisionQuestion: string | null;
}

export interface GroundedContext {
  eventType: AiEventType;
  projectId: string;
  source: EvidenceReference;
  facts: Readonly<Record<string, unknown>>;
}

export const AI_EVENT_STATUSES = [
  'queued',
  'processing',
  'completed',
  'failed',
  'resolved'
] as const;
export type AiEventStatus = (typeof AI_EVENT_STATUSES)[number];

export interface AiEventRecord {
  schemaVersion: '0.1';
  eventType: AiEventType;
  projectId: string;
  sourcePath: string;
  sourceRecordId: string;
  sourceField: string;
  sourceDigest: string;
  conditionKey: string;
  dedupKey: string;
  occurredAt: number;
  detectedAt: number;
  status: AiEventStatus;
  runId: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface AiConditionRecord {
  schemaVersion: '0.1';
  conditionKey: string;
  projectId: string;
  eventType: AiEventType;
  sourcePath: string;
  sourceRecordId: string;
  active: boolean;
  cycle: number;
  currentEventId: string | null;
  openedAt: number | null;
  lastEvaluatedAt: number;
  resolvedAt: number | null;
}

export const AI_RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'skipped'] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export interface AiRunRecord {
  schemaVersion: '0.1';
  eventId: string;
  projectId: string;
  requiredAgents: AgentId[];
  attempt: number;
  status: AiRunStatus;
  providerAlias: 'fake';
  modelAlias: 'fake';
  contextDigest: string;
  dryRun: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  safeErrorCode: string | null;
  usage: TokenUsage | null;
}

export interface AiRecommendationRecord {
  schemaVersion: '0.1';
  projectId: string;
  eventId: string;
  runId: string;
  severity: Severity;
  title: string;
  summary: string;
  scheduleImpact: ScheduleImpact;
  costImpact: CostImpact;
  recommendedActions: string[];
  needsHumanDecision: boolean;
  decisionId: string | null;
  evidenceRefs: EvidenceReference[];
  status: 'open';
  createdAt: number;
}

export interface AiDecisionRecord {
  schemaVersion: '0.1';
  projectId: string;
  eventId: string;
  runId: string;
  recommendationId: string;
  question: string;
  status: 'open';
  createdAt: number;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type ProviderHealthStatus =
  | 'available'
  | 'unavailable'
  | 'disabled'
  | 'not_configured';

export interface ProviderHealth {
  status: ProviderHealthStatus;
  configured: boolean;
  reason: string | null;
}

export interface RoutingContext {
  linkedWorkExists?: boolean;
  materialOrProcurementRelevant?: boolean;
}

export interface RoutePlan {
  eventType: AiEventType;
  agents: AgentId[];
}
