import { describe, expect, it } from 'vitest';

import type { AiRuntimeStatusRecord } from '../src/ai/contracts.js';
import { aiUiStatusSchema } from '../src/ai/schemas.js';
import { deriveUiStatus } from '../src/ai/ui-status.js';
import { enabledConfig, NOW } from './helpers.js';

function runtime(status: AiRuntimeStatusRecord['status']): AiRuntimeStatusRecord {
  return {
    schemaVersion: '0.1',
    providerAlias: 'openai',
    status,
    lastCheckedAt: NOW,
    lastSuccessAt: status === 'healthy' ? NOW : null,
    safeErrorCode: null
  };
}

describe('sanitized AI UI status projection', () => {
  it('fails closed when the UI or generation system is disabled', () => {
    expect(deriveUiStatus(enabledConfig({ uiEnabled: false }), runtime('healthy'), NOW))
      .toEqual({ schemaVersion: '0.1', uiEnabled: false, systemStatus: 'disabled', updatedAt: NOW });
    expect(deriveUiStatus(enabledConfig({ uiEnabled: true, enabled: false }), runtime('healthy'), NOW).systemStatus)
      .toBe('disabled');
    expect(deriveUiStatus(enabledConfig({ uiEnabled: true, generationEnabled: false }), runtime('healthy'), NOW).systemStatus)
      .toBe('disabled');
  });

  it('maps only sanitized runtime availability states', () => {
    const config = enabledConfig({ uiEnabled: true });
    expect(deriveUiStatus(config, null, NOW).systemStatus).toBe('not_configured');
    expect(deriveUiStatus(config, runtime('not_configured'), NOW).systemStatus).toBe('not_configured');
    expect(deriveUiStatus(config, runtime('healthy'), NOW).systemStatus).toBe('ready');
    expect(deriveUiStatus(config, runtime('degraded'), NOW).systemStatus).toBe('degraded');
    expect(deriveUiStatus(config, runtime('unavailable'), NOW).systemStatus).toBe('unavailable');
  });

  it('accepts exactly the four approved fields', () => {
    const value = deriveUiStatus(enabledConfig({ uiEnabled: true }), runtime('healthy'), NOW);
    expect(aiUiStatusSchema.parse(value)).toEqual(value);
    expect(() => aiUiStatusSchema.parse({ ...value, generationEnabled: true })).toThrow();
    expect(() => aiUiStatusSchema.parse({ ...value, systemStatus: 'provider_error' })).toThrow();
  });
});
