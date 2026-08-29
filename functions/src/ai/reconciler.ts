import type {
  AiConfig,
  AiEventRecord,
  AiEventType,
  AiProjectTarget
} from './contracts.js';
import { conditionKey, stableDigest } from './determinism.js';
import {
  detectMaterialDeliveryOverdue,
  detectMaterialStockLow,
  detectSiteIssueCreated,
  detectTaskOverdue,
  type DetectorResult
} from './detectors.js';
import { aiProjectTargetSchema } from './schemas.js';
import type { AiContextCollection, AiSourceReader, SourceRecord, SourceRecordMap } from './source-reader.js';
import type { AiPipelineStore } from './store.js';
import { manilaDateIso, manilaDateStartTimestamp } from './time.js';

export interface ReconcileSuppression {
  eventType: AiEventType;
  sourcePath: string;
  sourceRecordId: string;
  reason: string;
}

export interface ReconcileResult {
  status: 'completed' | 'skipped';
  reason: string | null;
  projectId: string;
  eventIds: string[];
  openedConditionKeys: string[];
  resolvedConditionKeys: string[];
  suppressions: ReconcileSuppression[];
}

export interface ReconcilerDependencies {
  store: AiPipelineStore;
  sourceReader: AiSourceReader;
  config: Readonly<AiConfig>;
}

interface Observation {
  eventType: AiEventType;
  sourcePath: string;
  sourceRecordId: string;
  sourceField: string;
  logicalSource: string;
  logicalRecordId: string;
  occurredAt: number;
  detector: DetectorResult;
  digestFields: Readonly<Record<string, unknown>>;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function projectPath(projectId: string, collection: string): string {
  return `projects/${projectId}/${collection}`;
}

function taskObservations(
  projectId: string,
  records: SourceRecordMap,
  todayIso: string
): Observation[] {
  const sourcePath = projectPath(projectId, 'tasks');
  return Object.entries(records).map(([id, record]) => {
    const dueDate = text(record.dueDate);
    const detector = detectTaskOverdue({ dueDate, status: text(record.status) }, todayIso);
    return {
      eventType: 'task_overdue',
      sourcePath,
      sourceRecordId: id,
      sourceField: 'dueDate',
      logicalSource: 'tasks',
      logicalRecordId: id,
      occurredAt: dueDate ? manilaDateStartTimestamp(dueDate) : 0,
      detector,
      digestFields: {
        dueDate,
        status: text(record.status),
        updatedAt: finiteNumber(record.updatedAt)
      }
    };
  });
}

function inventoryObservations(
  projectId: string,
  records: SourceRecordMap,
  now: number
): Observation[] {
  const sourcePath = projectPath(projectId, 'inventory');
  return Object.entries(records).map(([id, record]) => {
    const qtyOnHand = finiteNumber(record.qtyOnHand);
    const reorderPoint = finiteNumber(record.reorderPoint ?? record.threshold);
    return {
      eventType: 'material_stock_low',
      sourcePath,
      sourceRecordId: id,
      sourceField: 'qtyOnHand',
      logicalSource: 'inventory',
      logicalRecordId: text(record.itemKey) ?? id,
      occurredAt: finiteNumber(record.lastMovementAt) ?? now,
      detector: detectMaterialStockLow({ qtyOnHand, reorderPoint }),
      digestFields: {
        itemKey: text(record.itemKey),
        qtyOnHand,
        reorderPoint,
        lastMovementAt: finiteNumber(record.lastMovementAt)
      }
    };
  });
}

function deliveryObservations(
  projectId: string,
  records: SourceRecordMap,
  todayIso: string
): Observation[] {
  const sourcePath = projectPath(projectId, 'purchaseOrders');
  return Object.entries(records).map(([id, record]) => {
    const expectedDeliveryDate = text(record.expectedDeliveryDate);
    const promisedDeliveryDate = text(record.promisedDeliveryDate);
    const explicitDate = expectedDeliveryDate ?? promisedDeliveryDate;
    return {
      eventType: 'material_delivery_overdue',
      sourcePath,
      sourceRecordId: id,
      sourceField: expectedDeliveryDate ? 'expectedDeliveryDate' : 'promisedDeliveryDate',
      logicalSource: 'purchaseOrders',
      logicalRecordId: id,
      occurredAt: explicitDate ? manilaDateStartTimestamp(explicitDate) : 0,
      detector: detectMaterialDeliveryOverdue({
        expectedDeliveryDate,
        promisedDeliveryDate,
        remainingQuantity: finiteNumber(record.remainingQuantity),
        status: text(record.status),
        deliveryStatus: text(record.deliveryStatus)
      }, todayIso),
      digestFields: {
        expectedDeliveryDate,
        promisedDeliveryDate,
        remainingQuantity: finiteNumber(record.remainingQuantity),
        status: text(record.status),
        deliveryStatus: text(record.deliveryStatus)
      }
    };
  });
}

function issueLogicalId(record: SourceRecord, recordId: string): string {
  return text(record.clientGeneratedId) ?? text(record.canonicalId) ?? recordId;
}

function issueObservation(
  projectId: string,
  sourcePath: string,
  sourceRecordId: string,
  record: SourceRecord,
  activationAt: number,
  logicalId = issueLogicalId(record, sourceRecordId)
): Observation {
  const createdAt = finiteNumber(record.createdAt);
  return {
    eventType: 'site_issue_created',
    sourcePath,
    sourceRecordId,
    sourceField: 'createdAt',
    logicalSource: 'siteIssues',
    logicalRecordId: `${projectId}:${logicalId}`,
    occurredAt: createdAt ?? 0,
    detector: detectSiteIssueCreated({ createdAt }, activationAt),
    digestFields: {
      canonicalId: text(record.canonicalId),
      clientGeneratedId: text(record.clientGeneratedId),
      createdAt,
      status: text(record.status)
    }
  };
}

function issueObservations(
  projectId: string,
  rootIssues: SourceRecordMap,
  projectIssues: SourceRecordMap,
  punchList: SourceRecordMap,
  siteLogs: SourceRecordMap,
  activationAt: number
): Observation[] {
  const observations: Observation[] = [];
  for (const [id, record] of Object.entries(rootIssues)) {
    observations.push(issueObservation(projectId, 'pmosIssues', id, record, activationAt));
  }
  for (const [id, record] of Object.entries(projectIssues)) {
    observations.push(issueObservation(
      projectId,
      projectPath(projectId, 'pmosIssues'),
      id,
      record,
      activationAt
    ));
  }
  for (const [id, record] of Object.entries(punchList)) {
    observations.push(issueObservation(
      projectId,
      projectPath(projectId, 'punchList'),
      id,
      record,
      activationAt,
      `punch:${id}`
    ));
  }
  for (const [logId, log] of Object.entries(siteLogs)) {
    const issues = log.issues;
    if (issues === null || typeof issues !== 'object' || Array.isArray(issues)) continue;
    for (const [issueId, issue] of Object.entries(issues as Record<string, unknown>)) {
      if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) continue;
      observations.push(issueObservation(
        projectId,
        `${projectPath(projectId, 'siteLogs')}/${logId}/issues`,
        `${logId}:${issueId}`,
        issue as SourceRecord,
        activationAt,
        `siteLog:${logId}:${issueId}`
      ));
    }
  }
  return observations;
}

async function read(
  reader: AiSourceReader,
  projectId: string,
  collection: AiContextCollection
): Promise<SourceRecordMap> {
  return reader.readProjectCollection(projectId, collection);
}

function targetAllows(target: AiProjectTarget, eventType: AiEventType): boolean {
  if (eventType === 'task_overdue') return target.scanTasks;
  if (eventType === 'site_issue_created') return target.scanIssues;
  return target.scanMaterials;
}

export async function reconcileProject(
  projectId: string,
  now: number,
  dependencies: ReconcilerDependencies
): Promise<ReconcileResult> {
  const skipped = (reason: string): ReconcileResult => ({
    status: 'skipped',
    reason,
    projectId,
    eventIds: [],
    openedConditionKeys: [],
    resolvedConditionKeys: [],
    suppressions: []
  });
  if (!dependencies.config.enabled) return skipped('ai_disabled');

  const rawTarget = await dependencies.store.getProjectTarget(projectId);
  if (!rawTarget) return skipped('target_not_enrolled');
  const parsed = aiProjectTargetSchema.safeParse(rawTarget);
  if (!parsed.success) return skipped('target_invalid');
  const target = parsed.data;
  if (!target.enabled) return skipped('target_disabled');
  if (target.activationAt === null) return skipped('target_missing_activation');

  const todayIso = manilaDateIso(now);
  const observations: Observation[] = [];

  if (target.scanTasks && dependencies.config.eventTypes.task_overdue) {
    observations.push(...taskObservations(
      projectId,
      await read(dependencies.sourceReader, projectId, 'tasks'),
      todayIso
    ));
  }
  if (target.scanMaterials) {
    if (dependencies.config.eventTypes.material_stock_low) {
      observations.push(...inventoryObservations(
        projectId,
        await read(dependencies.sourceReader, projectId, 'inventory'),
        now
      ));
    }
    if (dependencies.config.eventTypes.material_delivery_overdue) {
      observations.push(...deliveryObservations(
        projectId,
        await read(dependencies.sourceReader, projectId, 'purchaseOrders'),
        todayIso
      ));
    }
  }
  if (target.scanIssues && dependencies.config.eventTypes.site_issue_created) {
    const [rootIssues, projectIssues, punchList, siteLogs] = await Promise.all([
      dependencies.sourceReader.readRootPmosIssues(projectId),
      read(dependencies.sourceReader, projectId, 'pmosIssues'),
      read(dependencies.sourceReader, projectId, 'punchList'),
      read(dependencies.sourceReader, projectId, 'siteLogs')
    ]);
    observations.push(...issueObservations(
      projectId,
      rootIssues,
      projectIssues,
      punchList,
      siteLogs,
      target.activationAt
    ));
  }

  const grouped = new Map<string, Observation[]>();
  for (const observation of observations) {
    if (!targetAllows(target, observation.eventType)) continue;
    const key = conditionKey({
      projectId,
      eventType: observation.eventType,
      logicalSource: observation.logicalSource,
      logicalRecordId: observation.logicalRecordId
    });
    grouped.set(key, [...(grouped.get(key) ?? []), observation]);
  }

  const result: ReconcileResult = {
    status: 'completed',
    reason: null,
    projectId,
    eventIds: [],
    openedConditionKeys: [],
    resolvedConditionKeys: [],
    suppressions: []
  };

  for (const [key, duplicates] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const ordered = [...duplicates].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
    const selected = ordered.find(item => item.detector.eligible) ?? ordered[0];
    if (!selected) continue;
    for (const observation of ordered) {
      if (observation.detector.eligible) continue;
      result.suppressions.push({
        eventType: observation.eventType,
        sourcePath: observation.sourcePath,
        sourceRecordId: observation.sourceRecordId,
        reason: observation.detector.reason
      });
    }

    const transition = await dependencies.store.transitionCondition({
      conditionKey: key,
      projectId,
      eventType: selected.eventType,
      sourcePath: selected.sourcePath,
      sourceRecordId: selected.sourceRecordId,
      eligible: ordered.some(item => item.detector.eligible),
      evaluatedAt: now
    });

    if (transition.resolvedEventId) {
      await dependencies.store.resolveEvent(transition.resolvedEventId, now);
      result.resolvedConditionKeys.push(key);
    }
    if (!transition.condition.active || !transition.condition.currentEventId) continue;

    const eventId = transition.condition.currentEventId;
    const dedupKey = stableDigest({ conditionKey: key, cycle: transition.condition.cycle });
    const event: AiEventRecord = {
      schemaVersion: '0.1',
      eventType: selected.eventType,
      projectId,
      sourcePath: selected.sourcePath,
      sourceRecordId: selected.sourceRecordId,
      sourceField: selected.sourceField,
      sourceDigest: stableDigest(selected.digestFields),
      conditionKey: key,
      dedupKey,
      occurredAt: selected.occurredAt || now,
      detectedAt: now,
      status: 'queued',
      runId: null,
      createdAt: now,
      resolvedAt: null
    };
    await dependencies.store.ensureEvent(eventId, event);
    if (!result.eventIds.includes(eventId)) result.eventIds.push(eventId);
    if (transition.opened) result.openedConditionKeys.push(key);
  }

  await dependencies.store.setProjectTargetLastScan(projectId, now);
  return result;
}
