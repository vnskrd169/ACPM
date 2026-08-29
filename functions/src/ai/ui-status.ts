import type { AiConfig, AiRuntimeStatusRecord, AiUiStatus } from './contracts.js';

export function deriveUiStatus(
  config: Readonly<AiConfig>,
  runtimeStatus: Readonly<AiRuntimeStatusRecord> | null,
  updatedAt: number
): AiUiStatus {
  let systemStatus: AiUiStatus['systemStatus'];

  if (!config.uiEnabled || !config.enabled || !config.generationEnabled) {
    systemStatus = 'disabled';
  } else if (!runtimeStatus || runtimeStatus.status === 'not_configured') {
    systemStatus = 'not_configured';
  } else if (runtimeStatus.status === 'healthy') {
    systemStatus = 'ready';
  } else {
    systemStatus = runtimeStatus.status;
  }

  return {
    schemaVersion: '0.1',
    uiEnabled: config.uiEnabled,
    systemStatus,
    updatedAt
  };
}
