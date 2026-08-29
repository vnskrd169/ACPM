import { z } from 'zod';

import type { AiConfig, AiRuntimeStatusRecord } from './contracts.js';
import { processAiEvent, type ProcessEventResult } from './orchestrator.js';
import type { LlmProvider } from './providers/provider.js';
import type { AiSourceReader } from './source-reader.js';
import type { AiPipelineStore } from './store.js';

export const STAGING_PROJECT_ID = 'acpm-project-system-qa' as const;

export const stagingManualInputSchema = z.object({
  projectId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  eventId: z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/)
}).strict();

export interface StagingManualInput {
  projectId: string;
  eventId: string;
}

export interface StagingManualDependencies {
  runtimeProjectId: string;
  config: Readonly<AiConfig>;
  store: AiPipelineStore;
  sourceReader: AiSourceReader;
  provider: LlmProvider;
  now: number;
}

export class StagingManualError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'StagingManualError';
  }
}

function runtimeStatus(
  status: AiRuntimeStatusRecord['status'],
  now: number,
  safeErrorCode: string | null
): AiRuntimeStatusRecord {
  return {
    schemaVersion: '0.1',
    providerAlias: 'openai',
    status,
    lastCheckedAt: now,
    lastSuccessAt: status === 'healthy' ? now : null,
    safeErrorCode
  };
}

function failureHealth(reason: string | null): AiRuntimeStatusRecord['status'] {
  return reason === 'provider_auth_failed' || reason === 'provider_unavailable'
    ? 'unavailable'
    : 'degraded';
}

export async function runStagingManualAiDryRun(
  rawInput: unknown,
  dependencies: StagingManualDependencies
): Promise<ProcessEventResult> {
  if (dependencies.runtimeProjectId !== STAGING_PROJECT_ID) {
    throw new StagingManualError('staging_environment_required');
  }
  const input = stagingManualInputSchema.parse(rawInput);
  if (!dependencies.config.enabled) throw new StagingManualError('ai_disabled');
  if (!dependencies.config.generationEnabled) throw new StagingManualError('generation_disabled');
  if (!dependencies.config.dryRun) throw new StagingManualError('dry_run_required');
  if (dependencies.provider.alias !== 'openai') throw new StagingManualError('openai_provider_required');

  const target = await dependencies.store.getProjectTarget(input.projectId);
  if (!target?.enabled || target.activationAt === null) {
    throw new StagingManualError('enabled_project_target_required');
  }
  const event = await dependencies.store.getEvent(input.eventId);
  if (!event || event.projectId !== input.projectId) {
    throw new StagingManualError('event_project_mismatch');
  }
  if (event.runId !== null || event.status !== 'queued') {
    throw new StagingManualError('event_already_processed');
  }

  const health = await dependencies.provider.health();
  if (!health.configured || health.status !== 'available') {
    await dependencies.store.saveRuntimeStatus(runtimeStatus(
      'not_configured',
      dependencies.now,
      'provider_not_configured'
    ));
    throw new StagingManualError('provider_not_configured');
  }

  const result = await processAiEvent(input.eventId, dependencies.now, dependencies);
  if (result.status === 'completed') {
    if (result.recommendationId !== null || result.decisionId !== null) {
      throw new StagingManualError('dry_run_output_violation');
    }
    await dependencies.store.saveRuntimeStatus(runtimeStatus('healthy', dependencies.now, null));
    return result;
  }

  await dependencies.store.saveRuntimeStatus(runtimeStatus(
    failureHealth(result.reason),
    dependencies.now,
    result.reason ?? 'provider_unknown_error'
  ));
  return result;
}
