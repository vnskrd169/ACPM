import { describe, expect, it } from 'vitest';

import {
  AI_SERVICE_UID,
  assertAiWritePath,
  isAiContextReadPath,
  isAiWritePath,
  selectSafeSupplierContext
} from '../src/ai/security.js';

describe('AI security guards', () => {
  it('uses the dedicated down-scoped identity', () => {
    expect(AI_SERVICE_UID).toBe('acpm-ai-service');
  });

  it('accepts only explicit V0.1 context paths', () => {
    expect(isAiContextReadPath('/projects/project-1/tasks/task-1')).toBe(true);
    expect(isAiContextReadPath('projects/project-1/purchaseOrders')).toBe(true);
    expect(isAiContextReadPath('pmosIssues/issue-1')).toBe(true);
    expect(isAiContextReadPath('projects/project-1/payrollLogs')).toBe(false);
    expect(isAiContextReadPath('suppliers/supplier-1')).toBe(false);
    expect(isAiContextReadPath('users/user-1')).toBe(false);
  });

  it('accepts writes only in an explicit AI collection', () => {
    expect(isAiWritePath('/ai/events/event-1')).toBe(true);
    expect(isAiWritePath('/ai/idempotency/key-1')).toBe(true);
    expect(isAiWritePath('/ai/unknown/value')).toBe(false);
    expect(isAiWritePath('/projects/project-1/tasks/task-1')).toBe(false);
    expect(() => assertAiWritePath('/suppliers/supplier-1')).toThrow(/denied/);
  });

  it('drops supplier bank and account fields from future context', () => {
    expect(selectSafeSupplierContext({
      name: 'Safe Supply Co.',
      specialty: 'Concrete',
      status: 'active',
      bankName: 'Sensitive Bank',
      accountNumber: '123456789'
    })).toEqual({
      name: 'Safe Supply Co.',
      specialty: 'Concrete',
      status: 'active'
    });
  });
});
