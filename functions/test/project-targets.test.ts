import { describe, expect, it } from 'vitest';

import { AI_PROJECT_TARGET_DEFAULTS } from '../src/ai/contracts.js';
import { aiProjectTargetSchema } from '../src/ai/schemas.js';

describe('AI project target contract', () => {
  it('is explicit and disabled by default without copied project metadata', () => {
    expect(aiProjectTargetSchema.parse(AI_PROJECT_TARGET_DEFAULTS)).toEqual(AI_PROJECT_TARGET_DEFAULTS);
    expect(AI_PROJECT_TARGET_DEFAULTS).toMatchObject({
      enabled: false,
      activationAt: null,
      scanTasks: false,
      scanMaterials: false,
      scanIssues: false
    });
    expect(AI_PROJECT_TARGET_DEFAULTS).not.toHaveProperty('projectName');
    expect(AI_PROJECT_TARGET_DEFAULTS).not.toHaveProperty('client');
    expect(AI_PROJECT_TARGET_DEFAULTS).not.toHaveProperty('budget');
  });

  it('requires activationAt before a target can be enabled', () => {
    expect(aiProjectTargetSchema.safeParse({
      ...AI_PROJECT_TARGET_DEFAULTS,
      enabled: true
    }).success).toBe(false);
    expect(aiProjectTargetSchema.safeParse({
      ...AI_PROJECT_TARGET_DEFAULTS,
      enabled: true,
      activationAt: 1000
    }).success).toBe(true);
  });

  it('rejects copied or unknown project fields', () => {
    expect(aiProjectTargetSchema.safeParse({
      ...AI_PROJECT_TARGET_DEFAULTS,
      projectName: 'Must not be copied'
    }).success).toBe(false);
  });
});
