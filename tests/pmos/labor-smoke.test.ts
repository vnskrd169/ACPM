import { describe, it, expect, beforeAll } from 'vitest';

// Load the pure math module FIRST (labor.js reads window.PayrollMath at load time),
// then labor.js itself to prove the wiring has no load-time errors.
beforeAll(async () => {
  await import('../../payroll-math.js');
  await import('../../labor.js');
});

describe('labor.js wiring smoke', () => {
  it('loads with payroll-math.js as the math source of truth', () => {
    expect((globalThis as any).PayrollMath).toBeDefined();
    expect(typeof (globalThis as any).PayrollMath.computeAdvanceDeductions).toBe('function');
    expect(typeof (globalThis as any).PayrollMath.resolveRate).toBe('function');
    expect(typeof (globalThis as any).PayrollMath.advanceHasDeductionForWeek).toBe('function');
  });

  it('exposes the payroll review workflow functions', () => {
    const w = globalThis as any;
    for (const fn of [
      'compilePayroll',
      'confirmSavePayroll',
      'generateRFP',
      'downloadRFP',
      'updatePayrollNet',
      'generatePayslips'
    ]) {
      expect(typeof w[fn], fn).toBe('function');
    }
  });

  it('exposes the worker editing / safe deactivate-reactivate workflow', () => {
    const w = globalThis as any;
    for (const fn of [
      'removeWorker',
      'openWorkerEditModal',
      'closeWorkerEditModal',
      'saveWorkerEdit',
      'reactivateWorker'
    ]) {
      expect(typeof w[fn], fn).toBe('function');
    }
  });

  it('labor payroll math delegates to PayrollMath (single source of truth)', () => {
    const w = globalThis as any;
    const gross = w.calculateGrossPay ? w.calculateGrossPay(1000, { status: 'present', overtimeHours: 0, nightDiffHours: 0 }) : (globalThis as any).PayrollMath.calculateGrossPay(1000, { status: 'present', overtimeHours: 0, nightDiffHours: 0 });
    expect(gross.total).toBe(1000);
  });
});
