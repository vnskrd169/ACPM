import type {
  AgentId,
  AiEventRecord,
  EvidenceReference,
  GroundedContext,
  GroundedFinding,
  RoutingContext
} from './contracts.js';
import type { AiSourceReader, SourceRecord } from './source-reader.js';

export const TASK_CONTEXT_FIELDS = [
  'title', 'status', 'dueDate', 'category', 'trade', 'materialRelevant',
  'procurementRelevant', 'materialIds', 'purchaseRequestIds', 'createdAt', 'updatedAt'
] as const;
export const MATERIAL_CONTEXT_FIELDS = [
  'poNo', 'requestNo', 'status', 'deliveryStatus', 'supplierId', 'supplierName',
  'expectedDeliveryDate', 'promisedDeliveryDate', 'remainingQuantity', 'items',
  'lineItems', 'itemKey', 'description', 'qtyOnHand', 'reorderPoint', 'threshold',
  'lastMovementAt', 'createdAt', 'updatedAt'
] as const;
export const ISSUE_CONTEXT_FIELDS = [
  'type', 'category', 'issue', 'description', 'status', 'createdAt', 'date',
  'taskId', 'taskIds', 'materialId', 'materialIds', 'purchaseRequestId',
  'clientGeneratedId', 'canonicalId'
] as const;
const LINE_ITEM_FIELDS = [
  'id', 'itemId', 'itemKey', 'description', 'quantity', 'orderedQuantity',
  'receivedQuantity', 'remainingQuantity', 'unit', 'status'
] as const;

export interface AssembledAgentContext {
  context: GroundedContext;
  evidence: EvidenceReference[];
  routing: RoutingContext;
}

function selectFields(
  record: SourceRecord,
  fields: readonly string[]
): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const value = record[field];
    if ((field === 'items' || field === 'lineItems') && value !== null && typeof value === 'object') {
      selected[field] = Array.isArray(value)
        ? value.map(item => (
          item !== null && typeof item === 'object'
            ? selectFields(item as SourceRecord, LINE_ITEM_FIELDS)
            : item
        ))
        : Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([id, item]) => [
          id,
          item !== null && typeof item === 'object'
            ? selectFields(item as SourceRecord, LINE_ITEM_FIELDS)
            : item
        ]));
      continue;
    }
    selected[field] = structuredClone(value);
  }
  return selected;
}

function fieldsForEvent(event: AiEventRecord, agentId: AgentId): readonly string[] {
  if (agentId === 'materials') {
    return event.eventType === 'task_overdue'
      ? ['materialRelevant', 'procurementRelevant', 'materialIds', 'purchaseRequestIds']
      : MATERIAL_CONTEXT_FIELDS;
  }
  if (event.eventType === 'task_overdue') return TASK_CONTEXT_FIELDS;
  if (event.eventType === 'site_issue_created') return ISSUE_CONTEXT_FIELDS;
  return [event.sourceField, 'status', 'createdAt', 'updatedAt'];
}

async function sourceRecord(event: AiEventRecord, reader: AiSourceReader): Promise<SourceRecord> {
  if (event.sourcePath === 'pmosIssues') {
    return (await reader.readRootPmosIssues(event.projectId))[event.sourceRecordId] ?? {};
  }
  const match = event.sourcePath.match(/^projects\/[^/]+\/([^/]+)(?:\/([^/]+)\/issues)?$/);
  if (!match) throw new Error('context_source_path_denied');
  const collection = match[1] as Parameters<AiSourceReader['readProjectCollection']>[1];
  const records = await reader.readProjectCollection(event.projectId, collection);
  if (match[2]) {
    const [logId, issueId] = event.sourceRecordId.split(':');
    const issues = records[logId]?.issues;
    if (issues !== null && typeof issues === 'object' && !Array.isArray(issues)) {
      const issue = (issues as Record<string, unknown>)[issueId];
      return issue !== null && typeof issue === 'object' && !Array.isArray(issue)
        ? issue as SourceRecord
        : {};
    }
    return {};
  }
  return records[event.sourceRecordId] ?? {};
}

function evidenceFor(
  event: AiEventRecord,
  selected: Readonly<Record<string, unknown>>
): EvidenceReference[] {
  const fields = Object.keys(selected);
  if (!fields.includes(event.sourceField)) fields.push(event.sourceField);
  return fields.sort().map(field => ({
    path: event.sourcePath,
    recordId: event.sourceRecordId,
    field
  }));
}

function routingFrom(selected: Readonly<Record<string, unknown>>): RoutingContext {
  const linkedWorkExists = ['taskId', 'taskIds', 'materialIds', 'purchaseRequestIds']
    .some(field => selected[field] !== undefined && selected[field] !== null);
  return {
    linkedWorkExists,
    materialOrProcurementRelevant:
      selected.materialRelevant === true
      || selected.procurementRelevant === true
      || selected.materialId !== undefined
      || selected.materialIds !== undefined
      || selected.purchaseRequestId !== undefined
      || selected.purchaseRequestIds !== undefined
  };
}

export class ContextAssembler {
  constructor(private readonly reader: AiSourceReader) {}

  async forAgent(event: AiEventRecord, agentId: Exclude<AgentId, 'pm'>): Promise<AssembledAgentContext> {
    const raw = await sourceRecord(event, this.reader);
    const selected = selectFields(raw, fieldsForEvent(event, agentId));
    const evidence = evidenceFor(event, selected);
    return {
      context: {
        eventType: event.eventType,
        projectId: event.projectId,
        source: {
          path: event.sourcePath,
          recordId: event.sourceRecordId,
          field: event.sourceField
        },
        facts: Object.freeze({
          event: Object.freeze({
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            sourceDigest: event.sourceDigest
          }),
          record: Object.freeze(selected),
          evidence: Object.freeze(evidence),
          supportedScheduleDays: Object.freeze([]),
          supportedCostAmounts: Object.freeze([]),
          userEnteredTextIsData: true
        })
      },
      evidence,
      routing: routingFrom(selected)
    };
  }

  forPm(
    event: AiEventRecord,
    findings: Readonly<Partial<Record<Exclude<AgentId, 'pm'>, GroundedFinding>>>
  ): AssembledAgentContext {
    const evidence = [...new Map(
      Object.values(findings)
        .flatMap(finding => finding?.facts.flatMap(fact => fact.evidenceRefs) ?? [])
        .map(reference => [`${reference.path}|${reference.recordId}|${reference.field}`, reference])
    ).values()];
    if (evidence.length === 0) {
      evidence.push({
        path: event.sourcePath,
        recordId: event.sourceRecordId,
        field: event.sourceField
      });
    }
    return {
      context: {
        eventType: event.eventType,
        projectId: event.projectId,
        source: evidence[0],
        facts: Object.freeze({
          event: Object.freeze({
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            sourcePath: event.sourcePath,
            sourceRecordId: event.sourceRecordId
          }),
          validatedFindings: Object.freeze(structuredClone(findings)),
          evidence: Object.freeze(evidence),
          supportedScheduleDays: Object.freeze([]),
          supportedCostAmounts: Object.freeze([])
        })
      },
      evidence,
      routing: {}
    };
  }
}
