import { describe, it, expect, beforeAll } from 'vitest';

// Load the pure payroll math module (attaches window.PayrollMath).
beforeAll(async () => {
  await import('../../payroll-math.js');
});

function M(): any {
  return (globalThis as any).PayrollMath;
}

describe('PayrollMath — required financial scenarios (A–D)', () => {
  it('A: ₱1,000/day × 5 days, no CA → NET ₱5,000', () => {
    const m = M();
    const workerPayroll = { w1: { name: 'Worker 1', trade: 'Carpenter', gross: 5000, rate: 1000 } };
    const { pendingAdvances, totalPending } = m.computeAdvanceDeductions({ w1: {} }, workerPayroll, {});
    expect(totalPending).toBe(0);
    expect(Object.keys(pendingAdvances)).toHaveLength(0);
    expect(m.computeWorkerNet(5000, totalPending)).toBe(5000);
  });

  it('B: ₱1,000/day × 5 days, ₱2,000 CA → deduct ₱2,000, NET ₱3,000', () => {
    const m = M();
    const workerPayroll = { w1: { name: 'Worker 1', trade: 'Carpenter', gross: 5000, rate: 1000 } };
    const advances = {
      w1: { a1: { amount: 2000, deductedAmount: 0, status: 'released', date: '2026-06-15' } }
    };
    const { pendingAdvances, totalPending } = m.computeAdvanceDeductions(advances, workerPayroll, { weekEnd: '2026-06-20' });
    expect(totalPending).toBe(2000);
    expect(pendingAdvances.w1.advances[0].deductThisPayroll).toBe(2000);
    expect(pendingAdvances.w1.advances[0].remainingAfter).toBe(0);
    expect(m.computeWorkerNet(5000, totalPending)).toBe(3000);
  });

  it('C: ₱1,000/day × 2 days, ₱3,000 CA → deduct ₱2,000, carry ₱1,000, NET ₱0', () => {
    const m = M();
    const workerPayroll = { w1: { name: 'Worker 1', trade: 'Carpenter', gross: 2000, rate: 1000 } };
    const advances = {
      w1: { a1: { amount: 3000, deductedAmount: 0, status: 'released', date: '2026-06-15' } }
    };
    const { pendingAdvances, totalPending } = m.computeAdvanceDeductions(advances, workerPayroll, { weekEnd: '2026-06-20' });
    expect(totalPending).toBe(2000);
    expect(pendingAdvances.w1.advances[0].deductThisPayroll).toBe(2000);
    expect(pendingAdvances.w1.advances[0].remainingAfter).toBe(1000);
    expect(m.computeWorkerNet(2000, totalPending)).toBe(0);
    // carry-forward is preserved as outstanding balance
    expect(m.cashAdvanceOutstanding({ amount: 3000, deductedAmount: 2000 })).toBe(1000);
  });

  it('carry-forward is deducted next run without double deduction', () => {
    const m = M();
    const week1 = { w1: { a1: { amount: 3000, deductedAmount: 0, status: 'released', date: '2026-06-15' } } };
    // Run 1: gross 2000 → deduct 2000, carry 1000
    const r1 = m.computeAdvanceDeductions(week1, { w1: { gross: 2000 } }, { weekEnd: '2026-06-20' });
    expect(r1.totalPending).toBe(2000);
    expect(r1.pendingAdvances.w1.advances[0].remainingAfter).toBe(1000);

    // Run 2: advance now partially deducted → deduct remaining 1000, closed
    const week2 = { w1: { a1: { amount: 3000, deductedAmount: 2000, status: 'deducted', date: '2026-06-15' } } };
    const r2 = m.computeAdvanceDeductions(week2, { w1: { gross: 2000 } }, { weekEnd: '2026-06-27' });
    expect(r2.totalPending).toBe(1000);
    expect(r2.pendingAdvances.w1.advances[0].remainingAfter).toBe(0);
    expect(m.computeWorkerNet(2000, 1000)).toBe(1000);
  });

  it('fully deducted advances are never deducted a second time', () => {
    const m = M();
    const advances = { w1: { a1: { amount: 2000, deductedAmount: 2000, deducted: true, status: 'closed', date: '2026-06-15' } } };
    const { pendingAdvances, totalPending } = m.computeAdvanceDeductions(advances, { w1: { gross: 5000 } }, { weekEnd: '2026-06-20' });
    expect(totalPending).toBe(0);
    expect(Object.keys(pendingAdvances)).toHaveLength(0);
  });

  it('multiple advances cannot push a worker NET below zero', () => {
    const m = M();
    const advances = {
      w1: {
        a1: { amount: 2000, deductedAmount: 0, status: 'released', date: '2026-06-15' },
        a2: { amount: 2000, deductedAmount: 0, status: 'released', date: '2026-06-16' }
      }
    };
    const { pendingAdvances, totalPending } = m.computeAdvanceDeductions(advances, { w1: { name: 'W', gross: 2000 } }, { weekEnd: '2026-06-20' });
    expect(totalPending).toBe(2000); // capped at gross, not 4000
    expect(m.computeWorkerNet(2000, totalPending)).toBe(0);
    expect(pendingAdvances.w1.advances[0].remainingAfter).toBe(0);
    // second advance has no budget left this run, so it is untouched and fully carried
    expect(pendingAdvances.w1.advances.length).toBe(1);
    expect(m.cashAdvanceOutstanding({ amount: 2000, deductedAmount: 0 })).toBe(2000);
  });

  it('only released/legacy eligible advances are deducted (pending/approved/rejected/closed are not)', () => {
    const m = M();
    const workerPayroll = { w1: { name: 'W', trade: 'Carpenter', gross: 5000 } };
    const advances = {
      w1: {
        p:  { amount: 1000, status: 'pending_approval', date: '2026-06-15' },
        a:  { amount: 1000, status: 'approved', date: '2026-06-15' },
        rj: { amount: 1000, status: 'rejected', date: '2026-06-15' },
        c:  { amount: 1000, status: 'closed', date: '2026-06-15' },
        rel: { amount: 1000, status: 'released', date: '2026-06-15' },
        leg: { amount: 1000, date: '2026-06-15' } // legacy active → released
      }
    };
    const { pendingAdvances, totalPending } = m.computeAdvanceDeductions(advances, workerPayroll, { weekEnd: '2026-06-20' });
    expect(totalPending).toBe(2000); // only released + legacy
    expect(pendingAdvances.w1.advances.map((x: any) => x.key)).toEqual(['rel', 'leg']);
  });

  it('D: released payroll compiled at ₱850/day stays ₱850 even if the live rate is later edited to ₱900', () => {
    const m = M();
    // Archived snapshot rate wins over the current live worker rate.
    expect(m.resolveRate(850, 900)).toBe(850);
    // Workers never compiled fall back to the live rate.
    expect(m.resolveRate(0, 900)).toBe(900);
    expect(m.resolveRate(undefined, 900)).toBe(900);
  });

  it('advance deduction priority is deterministic — oldest advance first', () => {
    const m = M();
    const workerPayroll = { w1: { name: 'W', gross: 2000 } };
    const advances = {
      w1: {
        newer: { amount: 2000, deductedAmount: 0, status: 'released', date: '2026-06-16' },
        older: { amount: 2000, deductedAmount: 0, status: 'released', date: '2026-06-15' }
      }
    };
    const { pendingAdvances, totalPending } = m.computeAdvanceDeductions(advances, workerPayroll, { weekEnd: '2026-06-20' });
    expect(totalPending).toBe(2000);
    // Only the oldest advance can be covered by this week's gross.
    expect(pendingAdvances.w1.advances).toHaveLength(1);
    expect(pendingAdvances.w1.advances[0].key).toBe('older');
    expect(pendingAdvances.w1.advances[0].remainingAfter).toBe(0);
  });

  it('D: RFP derived from the immutable archived log keeps snapshot rates and NET (rate later edited to ₱900 does not matter)', () => {
    const m = M();
    const log = {
      weekKey: '2026-06-15_2026-06-20',
      gross: 4250,
      net: 3400,
      byTrade: {
        Carpenter: {
          trade: 'Carpenter',
          foremanName: 'FM QA',
          paymentMethod: 'Bank',
          total: 4250,
          cashAdvanceDeductions: 850,
          net: 3400,
          workers: { w1: { name: 'Worker 1', trade: 'Carpenter', rate: 850, days: 5, gross: 4250 } }
        }
      },
      cashAdvancesDeducted: { w1: { name: 'Worker 1', totalDeduct: 850 } }
    };
    const { groups, grand } = m.buildRFPGroupsFromLog(log);
    expect(grand).toBe(3400);
    expect(groups).toHaveLength(1);
    expect(groups[0].workers[0].rate).toBe(850); // snapshot rate, NOT the later ₱900 edit
    expect(groups[0].workers[0].sub).toBe(4250);
    expect(groups[0].workers[0].caDeduct).toBe(850);
    expect(groups[0].workers[0].net).toBe(3400);
    expect(groups[0].net).toBe(3400);
    expect(groups[0].caDeduct).toBe(850);
  });

  it('RFP legacy fallback: no per-worker deduction detail → group deduction is distributed and NET stays consistent', () => {
    const m = M();
    const log = {
      weekKey: '2026-06-15_2026-06-20',
      net: 3400,
      byTrade: {
        Carpenter: {
          trade: 'Carpenter',
          total: 4250,
          cashAdvanceDeductions: 850,
          net: 3400,
          workers: {
            w1: { name: 'A', rate: 850, days: 3, gross: 2550 },
            w2: { name: 'B', rate: 850, days: 2, gross: 1700 }
          }
        }
      }
      // NOTE: no cashAdvancesDeducted — legacy log
    };
    const { groups, grand } = m.buildRFPGroupsFromLog(log);
    expect(grand).toBe(3400);
    const w = groups[0].workers;
    // proportional: 2550/4250*850 = 510 ; 1700/4250*850 = 340
    expect(w[0].caDeduct).toBeCloseTo(510);
    expect(w[1].caDeduct).toBeCloseTo(340);
    expect(w[0].net).toBeCloseTo(2040);
    expect(w[1].net).toBeCloseTo(1360);
    expect(groups[0].caDeduct).toBeCloseTo(850);
    expect(groups[0].net).toBe(3400);
  });

  it('advanceHasDeductionForWeek: an advance already deducted for a weekKey is never deducted again', () => {
    const m = M();
    const advance = {
      amount: 3000,
      deductedAmount: 2000,
      status: 'deducted',
      statusHistory: {
        payrollWeek1: { status: 'deducted', weekKey: '2026-06-15_2026-06-20', payrollLogId: 'log-1' },
        requested: { status: 'pending_approval', weekKey: '' }
      }
    };
    // Already applied for this exact period → guard blocks a second application.
    expect(m.advanceHasDeductionForWeek(advance, '2026-06-15_2026-06-20')).toBe(true);
    // A different period is not blocked.
    expect(m.advanceHasDeductionForWeek(advance, '2026-06-22_2026-06-27')).toBe(false);
    // Missing history / missing weekKey → not blocked.
    expect(m.advanceHasDeductionForWeek({ amount: 1000 }, '2026-06-15_2026-06-20')).toBe(false);
    expect(m.advanceHasDeductionForWeek(advance, '')).toBe(false);
    expect(m.advanceHasDeductionForWeek(null, '2026-06-15_2026-06-20')).toBe(false);
  });

  it('double-compile of a saved week cannot re-deduct: the same advance state yields no pending deduction', () => {
    const m = M();
    // State AFTER the week was compiled & saved: advance is fully deducted/closed.
    const week2 = { w1: { a1: { amount: 2000, deductedAmount: 2000, deducted: true, status: 'closed', date: '2026-06-15' } } };
    const r = m.computeAdvanceDeductions(week2, { w1: { gross: 5000 } }, { weekEnd: '2026-06-20' });
    expect(r.totalPending).toBe(0);
    expect(Object.keys(r.pendingAdvances)).toHaveLength(0);
    // Partially deducted advance: only the REMAINING balance is eligible, never the original amount.
    const week2b = { w1: { a1: { amount: 3000, deductedAmount: 2000, status: 'deducted', date: '2026-06-15' } } };
    const r2 = m.computeAdvanceDeductions(week2b, { w1: { gross: 5000 } }, { weekEnd: '2026-06-20' });
    expect(r2.totalPending).toBe(1000);
    expect(r2.pendingAdvances.w1.advances[0].deductThisPayroll).toBe(1000);
  });

  it('gross pay math: present / half-day / holiday / OT / night-diff', () => {
    const m = M();
    expect(m.calculateGrossPay(1000, { status: 'present', overtimeHours: 0, nightDiffHours: 0 }).total).toBe(1000);
    expect(m.calculateGrossPay(1000, { status: 'half', overtimeHours: 0, nightDiffHours: 0 }).total).toBe(500);
    expect(m.calculateGrossPay(1000, { status: 'holiday', overtimeHours: 0, nightDiffHours: 0 }).total).toBe(2000);
    expect(m.calculateGrossPay(1000, { status: 'absent', overtimeHours: 0, nightDiffHours: 0 }).total).toBe(0);

    const ot = m.calculateGrossPay(1000, { status: 'present', overtimeHours: 2, nightDiffHours: 0 });
    expect(ot.otPay).toBeCloseTo((1000 / 8) * 1.25 * 2);
    expect(ot.total).toBeCloseTo(1000 + (1000 / 8) * 1.25 * 2);

    const nd = m.calculateGrossPay(1000, { status: 'present', overtimeHours: 0, nightDiffHours: 4 });
    expect(nd.nightDiffPay).toBeCloseTo((1000 / 8) * 0.1 * 4);
    expect(nd.total).toBeCloseTo(1000 + (1000 / 8) * 0.1 * 4);
  });
});
