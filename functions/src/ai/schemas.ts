import { z } from 'zod';

import {
  AGENT_IDS,
  AI_ACTION_TYPES,
  AI_EVENT_STATUSES,
  AI_EVENT_TYPES,
  AI_RUN_STATUSES,
  AI_UI_SYSTEM_STATUSES,
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

export const aiUiStatusSchema = z.object({
  schemaVersion: z.literal('0.1'),
  uiEnabled: z.boolean(),
  systemStatus: z.enum(AI_UI_SYSTEM_STATUSES),
  updatedAt: z.number().int().nonnegative()
}).strict();

export const aiDecisionRoleSchema = z.enum(['boss', 'owner', 'admin', 'pm']);
export const aiDecisionActionSchema = z.enum(['choose', 'defer', 'dismiss']);
const safeDecisionTextSchema = z.string().trim().min(1).max(500)
  .refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), 'control characters are not allowed');

const safeReferenceSchema = z.string().trim().min(1).max(160).nullable();
const nullableReferenceFieldSchema = safeReferenceSchema.optional().transform(value => value ?? null);
const nullableQuantityFieldSchema = z.number().nonnegative().finite().nullable().optional().transform(value => value ?? null);
const nullableReasonFieldSchema = safeDecisionTextSchema.nullable().optional().transform(value => value ?? null);
export const aiActionTypeSchema = z.enum(AI_ACTION_TYPES);
export const aiActionDraftPayloadSchema = z.object({
  schemaVersion: z.literal('0.1'),
  materialReference: nullableReferenceFieldSchema,
  requestedQuantity: nullableQuantityFieldSchema,
  supplierReference: nullableReferenceFieldSchema,
  taskReference: nullableReferenceFieldSchema,
  siteIssueReference: nullableReferenceFieldSchema,
  noteReference: nullableReferenceFieldSchema,
  reason: nullableReasonFieldSchema,
  sourceEvidenceRefs: z.array(z.object({
    path: z.string().trim().min(1).max(240),
    recordId: z.string().trim().min(1).max(160),
    field: z.string().trim().min(1).max(160)
  }).strict()).max(50).optional().transform(value => value ?? [])
}).strict();

export const aiActionIntentSchema = z.object({
  type: aiActionTypeSchema,
  title: safeDecisionTextSchema,
  summary: safeDecisionTextSchema,
  payload: aiActionDraftPayloadSchema
}).strict();

export const aiStructuredDecisionOptionSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/),
  label: safeDecisionTextSchema,
  actionIntent: aiActionIntentSchema.optional()
}).strict();

export const aiDecisionOptionSchema = z.union([
  safeDecisionTextSchema,
  aiStructuredDecisionOptionSchema
]);

export const aiDecisionHistoryEventSchema = z.object({
  decisionId: z.string().trim().min(1).max(160),
  projectId: z.string().trim().min(1).max(160),
  action: aiDecisionActionSchema,
  selectedOptionId: safeDecisionTextSchema.optional(),
  actorUid: z.string().trim().min(1).max(128),
  actorRole: aiDecisionRoleSchema,
  timestamp: z.number().int().nonnegative(),
  notes: safeDecisionTextSchema.optional()
}).strict().superRefine((event, ctx) => {
  if (event.action === 'choose' && event.selectedOptionId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedOptionId'], message: 'choose requires a stored option' });
  }
  if (event.action !== 'choose' && event.selectedOptionId !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedOptionId'], message: 'only choose may store an option' });
  }
});

export const aiDecisionRecordSchema = z.object({
  schemaVersion: z.literal('0.1'),
  projectId: z.string().trim().min(1).max(160),
  eventId: z.string().trim().min(1).max(160),
  runId: z.string().trim().min(1).max(160),
  recommendationId: z.string().trim().min(1).max(160),
  question: safeDecisionTextSchema,
  options: z.array(aiDecisionOptionSchema).min(1).max(20).refine(options => {
    const ids = options.map(option => typeof option === 'string' ? option : option.id);
    return new Set(ids).size === ids.length;
  }),
  status: z.enum(['open', 'resolved', 'dismissed']),
  createdAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().nullable().optional(),
  resolvedBy: z.string().trim().min(1).max(128).nullable().optional(),
  resolvedByRole: aiDecisionRoleSchema.nullable().optional(),
  resolution: safeDecisionTextSchema.nullable().optional(),
  resolutionNotes: safeDecisionTextSchema.nullable().optional(),
  deferredAt: z.number().int().nonnegative().nullable().optional(),
  deferredBy: z.string().trim().min(1).max(128).nullable().optional(),
  deferredByRole: aiDecisionRoleSchema.nullable().optional(),
  history: z.record(z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), aiDecisionHistoryEventSchema).optional()
}).strict().superRefine((decision, ctx) => {
  if (decision.status === 'resolved') {
    if (!decision.resolvedAt || !decision.resolvedBy || !decision.resolvedByRole || !decision.resolution) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'resolved decisions require immutable resolution fields' });
    } else if (!decision.options.some(option => (typeof option === 'string' ? option : option.id) === decision.resolution)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolution'], message: 'resolution must be a stored option' });
    }
  }
  if (decision.status === 'dismissed' && (!decision.resolvedAt || !decision.resolvedBy || !decision.resolvedByRole)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'dismissed decisions require immutable resolution fields' });
  }
});

export const aiActionDraftEventSchema = z.object({
  draftId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/),
  decisionId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/),
  projectId: z.string().trim().min(1).max(160),
  action: z.enum(['created', 'reviewed', 'cancelled']),
  actorUid: z.string().trim().min(1).max(128),
  actorRole: aiDecisionRoleSchema,
  timestamp: z.number().int().nonnegative()
}).strict();

export const aiActionDraftRecordSchema = z.object({
  schemaVersion: z.literal('0.1'),
  decisionId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/),
  recommendationId: z.string().trim().min(1).max(160),
  eventId: z.string().trim().min(1).max(160),
  projectId: z.string().trim().min(1).max(160),
  actionType: aiActionTypeSchema,
  title: safeDecisionTextSchema,
  summary: safeDecisionTextSchema,
  status: z.enum(['draft', 'reviewed', 'cancelled']),
  createdAt: z.number().int().nonnegative(),
  createdBy: z.string().trim().min(1).max(128),
  reviewedAt: z.number().int().nonnegative().nullable().optional().transform(value => value ?? null),
  reviewedBy: z.string().trim().min(1).max(128).nullable().optional().transform(value => value ?? null),
  reviewedByRole: aiDecisionRoleSchema.nullable().optional().transform(value => value ?? null),
  cancelledAt: z.number().int().nonnegative().nullable().optional().transform(value => value ?? null),
  cancelledBy: z.string().trim().min(1).max(128).nullable().optional().transform(value => value ?? null),
  cancelledByRole: aiDecisionRoleSchema.nullable().optional().transform(value => value ?? null),
  sourceDecisionOptionId: z.string().trim().min(1).max(160),
  payload: aiActionDraftPayloadSchema,
  lastEventId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,160}$/)
}).strict().superRefine((draft, ctx) => {
  const reviewed = draft.reviewedAt !== null && draft.reviewedBy !== null && draft.reviewedByRole !== null;
  const cancelled = draft.cancelledAt !== null && draft.cancelledBy !== null && draft.cancelledByRole !== null;
  if (draft.status === 'draft' && (reviewed || cancelled)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'draft status cannot contain a final review' });
  }
  if (draft.status === 'reviewed' && (!reviewed || cancelled)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'reviewed status requires only reviewed audit fields' });
  }
  if (draft.status === 'cancelled' && (!cancelled || reviewed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'cancelled status requires only cancelled audit fields' });
  }
});

export const aiActionDraftReviewInputSchema = z.object({
  draftId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/),
  submissionId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/),
  action: z.enum(['review', 'cancel']),
  expectedCreatedAt: z.number().int().nonnegative()
}).strict();

export const aiDecisionSubmissionSchema = z.object({
  decisionId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,160}$/),
  submissionId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,128}$/),
  action: aiDecisionActionSchema,
  selectedOptionId: safeDecisionTextSchema.optional(),
  notes: z.string().trim().max(500)
    .refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), 'control characters are not allowed')
    .optional(),
  expectedCreatedAt: z.number().int().nonnegative()
}).strict().superRefine((submission, ctx) => {
  if (submission.action === 'choose' && submission.selectedOptionId === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedOptionId'], message: 'choose requires a selected option' });
  }
  if (submission.action !== 'choose' && submission.selectedOptionId !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedOptionId'], message: 'only choose accepts a selected option' });
  }
});

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
  if (finding.needsHumanDecision && finding.recommendedActions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recommendedActions'],
      message: 'a human decision requires at least one stored option'
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
