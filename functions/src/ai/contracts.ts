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
