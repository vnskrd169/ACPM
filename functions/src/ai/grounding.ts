import type {
  AgentId,
  EvidenceReference,
  GroundedContext,
  GroundedFinding
} from './contracts.js';
import { groundedFindingSchema } from './schemas.js';

export class GroundingValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'GroundingValidationError';
  }
}

function referenceKey(reference: EvidenceReference): string {
  return `${reference.path}|${reference.recordId}|${reference.field}`;
}

function contextEvidence(context: Readonly<GroundedContext>): EvidenceReference[] {
  const evidence = context.facts.evidence;
  const listed = Array.isArray(evidence)
    ? evidence.filter((value): value is EvidenceReference => (
      value !== null
      && typeof value === 'object'
      && typeof (value as EvidenceReference).path === 'string'
      && typeof (value as EvidenceReference).recordId === 'string'
      && typeof (value as EvidenceReference).field === 'string'
    ))
    : [];
  return [context.source, ...listed];
}

function numericSupport(context: Readonly<GroundedContext>, field: string): number[] {
  const value = context.facts[field];
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : [];
}

export function validateGroundedFinding(
  value: unknown,
  expectedAgent: AgentId,
  context: Readonly<GroundedContext>
): GroundedFinding {
  const parsed = groundedFindingSchema.safeParse(value);
  if (!parsed.success) throw new GroundingValidationError('schema_invalid');
  const finding = parsed.data;
  if (finding.agentId !== expectedAgent) {
    throw new GroundingValidationError('agent_mismatch');
  }

  const allowedReferences = new Set(contextEvidence(context).map(referenceKey));
  const assertedReferences = [
    ...finding.facts.flatMap(fact => fact.evidenceRefs),
    ...finding.scheduleImpact.evidenceRefs,
    ...finding.costImpact.evidenceRefs
  ];
  if (assertedReferences.some(reference => !allowedReferences.has(referenceKey(reference)))) {
    throw new GroundingValidationError('evidence_not_in_context');
  }

  if (finding.scheduleImpact.days !== null) {
    const supported = numericSupport(context, 'supportedScheduleDays');
    if (!supported.includes(finding.scheduleImpact.days) || finding.scheduleImpact.evidenceRefs.length === 0) {
      throw new GroundingValidationError('unsupported_schedule_days');
    }
  }
  if (finding.costImpact.amount !== null) {
    const supported = numericSupport(context, 'supportedCostAmounts');
    if (!supported.includes(finding.costImpact.amount) || finding.costImpact.evidenceRefs.length === 0) {
      throw new GroundingValidationError('unsupported_cost_amount');
    }
  }
  return finding;
}
