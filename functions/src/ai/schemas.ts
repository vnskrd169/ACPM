import { z } from 'zod';

import {
  AGENT_IDS,
  AI_EVENT_STATUSES,
  AI_EVENT_TYPES,
  AI_RUN_STATUSES,
  IMPACT_STATUSES,
  SEVERITIES
} from './contracts.js';

export const agentIdSchema = z.enum(AGENT_IDS);
export const aiEventTypeSchema = z.enum(AI_EVENT_TYPES);
export const severitySchema = z.enum(SEVERITIES);
export const impactStatusSchema = z.enum(IMPACT_STATUSES);

export const aiConfigSchema = z.object({
  enabled: z.boolean(),
  generationEnabled: z.boolean(),
  uiEnabled: z.boolean(),
  dryRun: z.boolean(),
  timeZone: z.literal('Asia/Manila'),
  maxAttempts: z.number().int().min(1).max(10),
  eventTypes: z.object({
    material_delivery_overdue: z.boolean(),
    material_stock_low: z.boolean(),
    task_overdue: z.boolean(),
    site_issue_created: z.boolean()
  }).strict()
}).strict();

export const aiProjectTargetSchema = z.object({
  schemaVersion: z.literal('0.1'),
  enabled: z.boolean(),
  activationAt: z.number().int().nonnegative().nullable(),
  scanTasks: z.boolean(),
  scanMaterials: z.boolean(),
  scanIssues: z.boolean(),
  lastScanAt: z.number().int().nonnegative().nullable()
}).strict().superRefine((target, ctx) => {
  if (target.enabled && target.activationAt === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['activationAt'],
      message: 'enabled project targets require activationAt'
    });
  }
});

export const aiEventStatusSchema = z.enum(AI_EVENT_STATUSES);
export const aiRunStatusSchema = z.enum(AI_RUN_STATUSES);

export const evidenceReferenceSchema = z.object({
  path: z.string().trim().min(1),
  recordId: z.string().trim().min(1),
  field: z.string().trim().min(1)
}).strict();

export const groundedFactSchema = z.object({
  claim: z.string().trim().min(1),
  evidenceRefs: z.array(evidenceReferenceSchema).min(1)
}).strict();

export const unknownFactSchema = z.object({
  field: z.string().trim().min(1),
  reason: z.string().trim().min(1)
}).strict();

const providerEvidenceReferenceSchema = z.object({
  path: z.string().min(1),
  recordId: z.string().min(1),
  field: z.string().min(1)
}).strict();

const providerGroundedFactSchema = z.object({
  claim: z.string().min(1),
  evidenceRefs: z.array(providerEvidenceReferenceSchema).min(1)
}).strict();

const providerUnknownFactSchema = z.object({
  field: z.string().min(1),
  reason: z.string().min(1)
}).strict();

export const providerScheduleImpactSchema = z.object({
  status: impactStatusSchema,
  days: z.number().positive().finite().nullable(),
  reason: z.string().min(1).nullable(),
  evidenceRefs: z.array(providerEvidenceReferenceSchema)
}).strict();

export const scheduleImpactSchema = z.object({
  status: impactStatusSchema,
  days: z.number().positive().finite().nullable(),
  reason: z.string().trim().min(1).nullable(),
  evidenceRefs: z.array(evidenceReferenceSchema)
}).strict().superRefine((impact, ctx) => {
  if ((impact.status === 'none' || impact.status === 'unknown') && impact.days !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['days'],
      message: `${impact.status} schedule impact must use null days`
    });
  }
  if (impact.status === 'unknown' && impact.reason === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'unknown schedule impact requires a reason'
    });
  }
});

export const providerCostImpactSchema = z.object({
  status: impactStatusSchema,
  amount: z.number().nonnegative().finite().nullable(),
  currency: z.literal('PHP').nullable(),
  reason: z.string().min(1).nullable(),
  evidenceRefs: z.array(providerEvidenceReferenceSchema)
}).strict();

export const costImpactSchema = z.object({
  status: impactStatusSchema,
  amount: z.number().nonnegative().finite().nullable(),
  currency: z.literal('PHP').nullable(),
  reason: z.string().trim().min(1).nullable(),
  evidenceRefs: z.array(evidenceReferenceSchema)
}).strict().superRefine((impact, ctx) => {
  if ((impact.status === 'none' || impact.status === 'unknown') && impact.amount !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amount'],
      message: `${impact.status} cost impact must use a null amount`
    });
  }
  if (impact.amount === null && impact.currency !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currency'],
      message: 'currency must be null when amount is unknown'
    });
  }
  if (impact.amount !== null && impact.currency !== 'PHP') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currency'],
      message: 'known amounts must declare PHP currency'
    });
  }
  if (impact.status === 'unknown' && impact.reason === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'unknown cost impact requires a reason'
    });
  }
});

const providerGroundedFindingShape = {
  schemaVersion: z.literal('0.1'),
  agentId: agentIdSchema,
  severity: severitySchema,
  summary: z.string().min(1),
  facts: z.array(providerGroundedFactSchema),
  unknowns: z.array(providerUnknownFactSchema),
  scheduleImpact: providerScheduleImpactSchema,
  costImpact: providerCostImpactSchema,
  recommendedActions: z.array(z.string().min(1)),
  needsHumanDecision: z.boolean(),
  decisionQuestion: z.string().min(1).nullable()
} as const;

// Provider-compatible strict structure. Custom cross-field and grounding
// checks remain local because they cannot be represented faithfully in JSON Schema.
export const groundedFindingProviderSchema = z.object(providerGroundedFindingShape).strict();

export const groundedFindingSchema = z.object({
  schemaVersion: z.literal('0.1'),
  agentId: agentIdSchema,
  severity: severitySchema,
  summary: z.string().trim().min(1),
  facts: z.array(groundedFactSchema),
  unknowns: z.array(unknownFactSchema),
  scheduleImpact: scheduleImpactSchema,
  costImpact: costImpactSchema,
  recommendedActions: z.array(z.string().trim().min(1)),
  needsHumanDecision: z.boolean(),
  decisionQuestion: z.string().trim().min(1).nullable()
}).strict().superRefine((finding, ctx) => {
  if (finding.needsHumanDecision && finding.decisionQuestion === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['decisionQuestion'],
      message: 'a human decision requires an explicit question'
    });
  }
  if (!finding.needsHumanDecision && finding.decisionQuestion !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['decisionQuestion'],
      message: 'decisionQuestion must be null when no human decision is needed'
    });
  }
});

export const groundedContextSchema = z.object({
  eventType: aiEventTypeSchema,
  projectId: z.string().trim().min(1),
  source: evidenceReferenceSchema,
  facts: z.record(z.unknown())
}).strict();

export const routePlanSchema = z.object({
  eventType: aiEventTypeSchema,
  agents: z.array(agentIdSchema).min(1)
}).strict().superRefine((route, ctx) => {
  if (route.agents.at(-1) !== 'pm') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agents'],
      message: 'PM must always be the final agent'
    });
  }
  if (new Set(route.agents).size !== route.agents.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agents'],
      message: 'route agents must be unique'
    });
  }
});

export type ValidatedGroundedFinding = z.infer<typeof groundedFindingSchema>;
