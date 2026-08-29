import type { AiConfig, AiEventRecord, AiProjectTarget } from '../src/ai/contracts.js';

export const NOW = Date.parse('2026-08-29T04:00:00Z');

export function enabledConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    enabled: true,
    generationEnabled: true,
    uiEnabled: false,
    dryRun: false,
    timeZone: 'Asia/Manila',
    maxAttempts: 3,
    eventTypes: {
      material_delivery_overdue: true,
      material_stock_low: true,
      task_overdue: true,
      site_issue_created: true
    },
    ...overrides
  };
}

export function enabledTarget(overrides: Partial<AiProjectTarget> = {}): AiProjectTarget {
  return {
    schemaVersion: '0.1',
    enabled: true,
    activationAt: NOW - 10_000,
    scanTasks: true,
    scanMaterials: true,
    scanIssues: true,
    lastScanAt: null,
    ...overrides
  };
}

export function taskEvent(overrides: Partial<AiEventRecord> = {}): AiEventRecord {
  return {
    schemaVersion: '0.1',
    eventType: 'task_overdue',
    projectId: 'project-1',
    sourcePath: 'projects/project-1/tasks',
    sourceRecordId: 'task-1',
    sourceField: 'dueDate',
    sourceDigest: 'digest-1',
    conditionKey: 'condition-1',
    dedupKey: 'dedup-1',
    occurredAt: NOW - 86_400_000,
    detectedAt: NOW,
    status: 'queued',
    runId: null,
    createdAt: NOW,
    resolvedAt: null,
    ...overrides
  };
}
