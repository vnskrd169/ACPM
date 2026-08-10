// ══════════════════════════════════════════════════════════════════
//  payroll-math.js — ACPM Labor Payroll Financial Math (SINGLE SOURCE OF TRUTH)
//
//  All payroll formulas used by labor.js live here so they can be proven
//  by unit tests (tests/pmos/payroll-math.test.ts). This file must stay
//  free of Firebase/DOM dependencies so the math is fully testable.
//
//  VERIFIED CASH ADVANCE DEDUCTION RULE (2026-08, QA scenarios A-D):
//    • Deduct the exact eligible cash advance balance for the period.
//    • Cap the deduction at the worker's gross pay so NET can never be
//      negative — when the advance is larger than the pay available, the
//      unpaid remainder carries forward to the next payroll run.
//    • Only `released` (or legacy active) advances with an outstanding
//      balance are eligible. Already-deducted / closed advances are never
//      deducted twice.
//
//  LOAD ORDER: workspace.html and dashboard.html load this file BEFORE
//  labor.js, which reads window.PayrollMath.
// ══════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  var ATTENDANCE_STATUS = {
    present:  { label: 'Present',    multiplier: 1.0, hours: 8 },
    half:     { label: 'Half Day',   multiplier: 0.5, hours: 4 },
    absent:   { label: 'Absent',     multiplier: 0,   hours: 0 },
    leave:    { label: 'Paid Leave', multiplier: 1.0, hours: 8 },
    rest:     { label: 'Rest Day',   multiplier: 0,   hours: 0 },
    holiday:  { label: 'Holiday',    multiplier: 2.0, hours: 8 }
  };

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  // Gross pay for one attendance record: regular (rate × status multiplier)
  // + OT (rate/8 × 1.25 × otHours) + night diff (rate/8 × 0.10 × nightDiffHours).
  function calculateGrossPay(rate, att) {
    var r = num(rate);
    att = att || {};
    var status = att.status || 'absent';
    var config = ATTENDANCE_STATUS[status] || ATTENDANCE_STATUS.absent;
    var regularPay = r * config.multiplier;
    var otPay = (r / 8 * 1.25) * num(att.overtimeHours);
    var nightDiffPay = (r / 8 * 0.1) * num(att.nightDiffHours);
    return { regularPay: regularPay, otPay: otPay, nightDiffPay: nightDiffPay, total: regularPay + otPay + nightDiffPay };
  }

  // Legacy advances without a status are treated as `released` so old active
  // balances remain payroll-eligible without a migration.
  function normalizeAdvanceStatus(a) {
    a = a || {};
    if (a.status) return a.status;
    if (a.deducted) return 'closed';
    return 'released';
  }

  // Remaining balance never below zero (prevents negative carry from bad data).
  function cashAdvanceOutstanding(a) {
    return Math.max(0, num(a && a.amount) - num(a && a.deductedAmount));
  }

  // Payroll-eligible = released/deducted lifecycle status, not already fully
  // deducted, and with a remaining balance. Never double-deducts.
  function cashAdvancePayrollEligible(a) {
    if (!a) return false;
    if (a.deducted) return false;
    var status = normalizeAdvanceStatus(a);
    return (status === 'released' || status === 'deducted') && cashAdvanceOutstanding(a) > 0;
  }

  function normalizeTradeName(name) {
    return String(name || 'Unassigned').trim() || 'Unassigned';
  }

  // ── Core deduction engine ─────────────────────────────────────────
  // advancesByWorker: { workerId: { advanceId: advanceRecord } }
  // workerPayroll:    { workerId: { name, trade, foremanName, gross } }
  // options.weekEnd:  only deduct advances dated on/before weekEnd.
  // Returns { pendingAdvances, totalPending } where each pending entry carries
  // deductThisPayroll and remainingAfter (carry-forward) per advance.
  // Deduction priority is deterministic: oldest advance first (by `date`, then
  // created order), so audits can reproduce the allocation.
  function computeAdvanceDeductions(advancesByWorker, workerPayroll, options) {
    options = options || {};
    var pendingAdvances = {};
    var totalPending = 0;

    Object.keys(advancesByWorker || {}).forEach(function (wid) {
      var worker = (workerPayroll && workerPayroll[wid]) || {};
      var gross = num(worker.gross);
      if (gross <= 0) return; // no pay this week → nothing to deduct (carry stays)

      var budget = gross;             // deduct only up to what the worker earned
      var workerTotal = 0;
      var advances = [];

      var eligible = [];
      Object.keys(advancesByWorker[wid] || {}).forEach(function (key) {
        var a = advancesByWorker[wid][key];
        if (!cashAdvancePayrollEligible(a)) return;
        if (options.weekEnd && a.date && String(a.date) > String(options.weekEnd)) return;
        eligible.push({ key: key, a: a });
      });
      // Deterministic priority: oldest advance first (stable sort preserves
      // insertion/created order for equal dates).
      eligible.sort(function (x, y) {
        var xd = String(x.a.date || '');
        var yd = String(y.a.date || '');
        if (xd === yd) return 0;
        return xd < yd ? -1 : 1;
      });

      eligible.forEach(function (entry) {
        var a = entry.a;
        var remaining = cashAdvanceOutstanding(a);
        if (remaining <= 0) return;

        var deductThisPayroll = Math.min(remaining, budget);
        if (deductThisPayroll <= 0) return;

        var remainingAfter = remaining - deductThisPayroll;
        budget -= deductThisPayroll;
        workerTotal += deductThisPayroll;

        advances.push({
          key: entry.key,
          trade: normalizeTradeName(a.trade || worker.trade),
          amount: num(a.amount),
          deductedAmount: num(a.deductedAmount),
          date: a.date || '',
          deductThisPayroll: deductThisPayroll,
          remainingAfter: remainingAfter
        });
      });

      if (advances.length) {
        pendingAdvances[wid] = {
          name: worker.name || wid,
          trade: worker.trade || '',
          foremanName: worker.foremanName || '',
          advances: advances,
          totalDeduct: workerTotal
        };
        totalPending += workerTotal;
      }
    });

    return { pendingAdvances: pendingAdvances, totalPending: totalPending };
  }

  // ── RFP groups from an immutable archived payroll log ────────────
  // Derives per-trade groups (with per-worker Gross / Cash Advance Deduction /
  // NET) and the grand NET total straight from the payroll log snapshot, so a
  // released RFP can never drift from released payroll (scenario D).
  // Legacy fallback: when per-worker deduction detail is missing but the trade
  // recorded a group deduction, it is distributed proportionally to gross.
  function buildRFPGroupsFromLog(log) {
    log = log || {};
    var cashAdvByWid = log.cashAdvancesDeducted || {};

    var groups = Object.keys(log.byTrade || {}).sort().map(function (trade) {
      var d = log.byTrade[trade] || {};
      var workerEntries = Object.entries(d.workers || {});
      var groupCa = (typeof d.cashAdvanceDeductions === 'number' && d.cashAdvanceDeductions > 0)
        ? d.cashAdvanceDeductions : 0;
      var totalGross = workerEntries.reduce(function (s, pair) {
        return s + num(pair[1].gross);
      }, 0);

      var workers = workerEntries.map(function (pair) {
        var wid = pair[0];
        var w = pair[1];
        var gross = num(w.gross);
        var caDeduct = (cashAdvByWid[wid] && cashAdvByWid[wid].totalDeduct) || 0;
        if (!(caDeduct > 0) && groupCa > 0 && totalGross > 0) {
          // Legacy log without per-worker detail: proportional share.
          caDeduct = groupCa * (gross / totalGross);
        }
        return {
          name: w.name || wid,
          rate: w.rate,
          days: w.days || 0,
          sub: gross,
          caDeduct: caDeduct,
          net: computeWorkerNet(gross, caDeduct)
        };
      });
      workers.sort(function (a, b) { return a.name.localeCompare(b.name); });

      var total = workers.reduce(function (s, w) { return s + w.sub; }, 0);
      var caTotal = workers.reduce(function (s, w) { return s + w.caDeduct; }, 0);
      return {
        trade: trade,
        workers: workers,
        total: total,
        caDeduct: caTotal,
        net: typeof d.net === 'number' ? d.net : Math.max(0, total - caTotal),
        foremanName: d.foremanName || '',
        paymentMethod: d.paymentMethod || 'Bank',
        notes: d.notes || ''
      };
    });

    var grand = typeof log.net === 'number' ? log.net
      : groups.reduce(function (s, g) { return s + g.net; }, 0);
    return { groups: groups, grand: grand };
  }

  // NET is floored at zero — the capped deduction rule guarantees this.
  function computeWorkerNet(gross, caDeduction) {
    return Math.max(0, num(gross) - num(caDeduction));
  }

  // Scenario D: historical/payroll views must use the ARCHIVED rate captured
  // at compile time. A later edit to the live worker rate must not change a
  // released payroll or its RFP. Falls back to the live rate only when no
  // archived rate exists.
  function resolveRate(archivedRate, liveRate) {
    var a = num(archivedRate);
    return a > 0 ? a : num(liveRate);
  }

  // ── Idempotency guard (double-deduction proof) ─────────────────────
  // Once an advance's status history records a payroll deduction for a given
  // weekKey, that advance must NEVER be deducted again for the same period.
  // This is the stable-period-key mechanism that makes re-compiling or
  // re-saving a period a no-op instead of a second cash-advance application.
  function advanceHasDeductionForWeek(a, weekKey) {
    if (!a || !weekKey) return false;
    var history = a.statusHistory || {};
    return Object.keys(history).some(function (k) {
      var e = history[k] || {};
      return e.weekKey === weekKey && (e.status === 'deducted' || e.status === 'closed');
    });
  }

  global.PayrollMath = {
    ATTENDANCE_STATUS: ATTENDANCE_STATUS,
    calculateGrossPay: calculateGrossPay,
    normalizeAdvanceStatus: normalizeAdvanceStatus,
    cashAdvanceOutstanding: cashAdvanceOutstanding,
    cashAdvancePayrollEligible: cashAdvancePayrollEligible,
    computeAdvanceDeductions: computeAdvanceDeductions,
    buildRFPGroupsFromLog: buildRFPGroupsFromLog,
    computeWorkerNet: computeWorkerNet,
    resolveRate: resolveRate,
    advanceHasDeductionForWeek: advanceHasDeductionForWeek
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.PayrollMath;
  }
})(typeof window !== 'undefined' ? window : globalThis);
