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
  providerAlias: 'fake' | 'openai';
  modelAlias: 'fake' | 'analysis+synthesis';
  contextDigest: string;
  dryRun: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  safeErrorCode: string | null;
  usage: TokenUsage | null;
}

export const AI_RUNTIME_STATUSES = [
  'not_configured',
  'healthy',
  'degraded',
  'unavailable'
] as const;
export type AiRuntimeStatusValue = (typeof AI_RUNTIME_STATUSES)[number];

export interface AiRuntimeStatusRecord {
  schemaVersion: '0.1';
  providerAlias: 'openai';
  status: AiRuntimeStatusValue;
  lastCheckedAt: number;
  lastSuccessAt: number | null;
  safeErrorCode: string | null;
}

export const AI_UI_SYSTEM_STATUSES = [
  'disabled',
  'not_configured',
  'ready',
  'degraded',
  'unavailable'
] as const;
export type AiUiSystemStatus = (typeof AI_UI_SYSTEM_STATUSES)[number];

export interface AiUiStatus {
  schemaVersion: '0.1';
  uiEnabled: boolean;
  systemStatus: AiUiSystemStatus;
  updatedAt: number;
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

export const AI_ACTION_TYPES = [
  'follow_up_supplier',
  'prepare_material_request',
  'prepare_task_update',
  'prepare_site_follow_up',
  'prepare_internal_note'
] as const;
export type AiActionType = (typeof AI_ACTION_TYPES)[number];

export interface AiActionDraftPayload {
  schemaVersion: '0.1';
  materialReference: string | null;
  requestedQuantity: number | null;
  supplierReference: string | null;
  taskReference: string | null;
  siteIssueReference: string | null;
  noteReference: string | null;
  reason: string | null;
  sourceEvidenceRefs: EvidenceReference[];
}

export interface AiActionIntent {
  type: AiActionType;
  title: string;
  summary: string;
  payload: AiActionDraftPayload;
}

export interface AiStructuredDecisionOption {
  id: string;
  label: string;
  actionIntent?: AiActionIntent;
}

export type AiDecisionOption = string | AiStructuredDecisionOption;

export interface AiDecisionRecord {
  schemaVersion: '0.1';
  projectId: string;
  eventId: string;
  runId: string;
  recommendationId: string;
  question: string;
  options: AiDecisionOption[];
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: number;
  resolvedAt?: number | null;
  resolvedBy?: string | null;
  resolvedByRole?: 'boss' | 'owner' | 'admin' | 'pm' | null;
  resolution?: string | null;
  resolutionNotes?: string | null;
  deferredAt?: number | null;
  deferredBy?: string | null;
  deferredByRole?: 'boss' | 'owner' | 'admin' | 'pm' | null;
  history?: Record<string, AiDecisionHistoryEvent>;
}

export interface AiActionDraftRecord {
  schemaVersion: '0.1';
  decisionId: string;
  recommendationId: string;
  eventId: string;
  projectId: string;
  actionType: AiActionType;
  title: string;
  summary: string;
  status: 'draft' | 'reviewed' | 'cancelled';
  createdAt: number;
  createdBy: string;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  reviewedByRole?: 'boss' | 'owner' | 'admin' | 'pm' | null;
  cancelledAt?: number | null;
  cancelledBy?: string | null;
  cancelledByRole?: 'boss' | 'owner' | 'admin' | 'pm' | null;
  sourceDecisionOptionId: string;
  payload: AiActionDraftPayload;
  lastEventId: string;
}

export interface AiActionDraftEvent {
  draftId: string;
  decisionId: string;
  projectId: string;
  action: 'created' | 'reviewed' | 'cancelled';
  actorUid: string;
  actorRole: 'boss' | 'owner' | 'admin' | 'pm';
  timestamp: number;
}

export interface AiDecisionHistoryEvent {
  decisionId: string;
  projectId: string;
  action: 'choose' | 'defer' | 'dismiss';
  selectedOptionId?: string;
  actorUid: string;
  actorRole: 'boss' | 'owner' | 'admin' | 'pm';
  timestamp: number;
  notes?: string;
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
