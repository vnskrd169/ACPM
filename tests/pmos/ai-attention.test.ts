import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Attention = require('../../ai-attention.js');
const NOW = Date.parse('2026-08-30T04:00:00Z'); // 2026-08-30 noon in Manila

function project(overrides: Record<string, unknown> = {}) {
  return { id: 'p1', name: 'RCBC Plaza', status: 'active', ...overrides };
}

describe('deterministic AI attention model', () => {
  it('returns a calm zero state without inventing stock or attendance alerts', () => {
    const items = Attention.derive([project({
      inventory: { gypsum: { quantity: 0, reorderPoint: 10 } },
      workers: { w1: { name: 'Ana', active: true } },
      attendance: {},
    })], { now: NOW });
    expect(items).toEqual([]);
  });

  it('detects overdue, blocked, and verification task states with deterministic priority', () => {
    const items = Attention.derive([project({ tasks: {
      overdue: { title: 'Ceiling framing', status: 'in_progress', dueDate: '2026-08-27', priority: 'normal' },
      blocked: { title: 'MEP layout', status: 'blocked', dueDate: '2026-09-02', blockedReason: 'Drawing pending' },
      both: { title: 'Door schedule', status: 'blocked', dueDate: '2026-08-26' },
      verify: { title: 'Wall inspection', status: 'for_verification', updatedAt: NOW - 3_600_000 },
      done: { title: 'Finished', status: 'completed', dueDate: '2026-08-20' },
    } })], { now: NOW });
    expect(items.map((item: any) => [item.sourceId, item.title, item.severity])).toEqual(expect.arrayContaining([
      ['overdue', 'Overdue task', 'medium'],
      ['blocked', 'Blocked task', 'medium'],
      ['both', 'Blocked overdue task', 'high'],
      ['verify', 'For verification', 'low'],
    ]));
    expect(items.some((item: any) => item.sourceId === 'done')).toBe(false);
  });

  it('labels missing applicable attendance as unresolved and never absent', () => {
    const items = Attention.derive([project({
      workers: { w1: { active: true }, w2: { active: true }, w3: { status: 'inactive' } },
      attendance: { w1: { '2026-08-29': { status: 'present' } } },
    })], { now: NOW });
    const attendance = items.find((item: any) => item.category === 'attendance');
    expect(attendance.summary).toContain('1 attendance entry is unresolved');
    expect(attendance.summary.toLowerCase()).not.toContain('absent');
    expect(attendance.detectedBy).toBe('deterministic');
  });

  it('computes partial delivery only from reliable ordered and accepted quantities', () => {
    const items = Attention.derive([project({ purchaseOrders: {
      po1: { status: 'partially_delivered', items: [
        { desc: 'Gypsum Board', qtyOrdered: 100, qtyAccepted: 80, unit: 'sheets' },
        { desc: 'Unknown receipt', qtyOrdered: 20 },
      ] },
    } })], { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0].summary).toBe('Received 80 sheets / 100 sheets. Pending 20 sheets.');
  });

  it('detects only legitimate pending material request states', () => {
    const items = Attention.derive([project({ pmosMaterialRequests: {
      pending: { item: 'Cement', status: 'Under Review', createdAt: NOW - 10_000 },
      draft: { item: 'Paint', status: 'Draft' },
      delivered: { item: 'Tiles', status: 'Delivered' },
    } })], { now: NOW });
    expect(items.map((item: any) => item.sourceId)).toEqual(['pending']);
  });

  it('distinguishes open and aging issues without escalating age to critical', () => {
    const items = Attention.derive([project({ punchList: {
      recent: { description: 'Door alignment', status: 'open', severity: 'minor', createdAt: NOW - 1 * 86_400_000 },
      aging: { description: 'Wall crack review', status: 'open', severity: 'minor', createdAt: NOW - 4 * 86_400_000 },
      explicit: { description: 'Unsafe opening', status: 'open', severity: 'critical', createdAt: NOW - 1 * 86_400_000 },
      closed: { description: 'Resolved', status: 'closed', createdAt: NOW - 8 * 86_400_000 },
    } })], { now: NOW });
    expect(items.find((item: any) => item.sourceId === 'recent')).toMatchObject({ title: 'Open site issue', severity: 'low' });
    expect(items.find((item: any) => item.sourceId === 'aging')).toMatchObject({ title: 'Aging site issue', severity: 'medium' });
    expect(items.find((item: any) => item.sourceId === 'explicit')).toMatchObject({ severity: 'critical' });
    expect(items.some((item: any) => item.sourceId === 'closed')).toBe(false);
  });

  it('builds deterministic multi-project summaries without health scores', () => {
    const projects = [
      project({ tasks: { t1: { title: 'Late task', status: 'in_progress', dueDate: '2026-08-25' } } }),
      { id: 'p2', name: 'Coffee Bay', status: 'active' },
    ];
    const items = Attention.derive(projects, { now: NOW });
    const summaries = Attention.summarizeProjects(projects, items);
    expect(summaries[0]).toMatchObject({ projectName: 'RCBC Plaza', attentionCount: 1, status: 'needs_attention' });
    expect(summaries[1]).toMatchObject({ projectName: 'Coffee Bay', attentionCount: 0, status: 'on_track' });
    expect(summaries[0]).not.toHaveProperty('score');
    expect(summaries[0]).not.toHaveProperty('healthPercentage');
  });

  it('emits only normalized allowlisted destinations and the complete UI contract', () => {
    const item = Attention.derive([project({ tasks: {
      t1: { title: 'Late task', status: 'in_progress', dueDate: '2026-08-25' },
    } })], { now: NOW })[0];
    expect(Object.keys(item).sort()).toEqual([
      'age', 'category', 'detectedBy', 'id', 'occurredAt', 'projectId', 'projectName',
      'recommendedDestination', 'severity', 'sourceId', 'sourceType', 'status', 'summary', 'title',
    ].sort());
    expect(Attention.DESTINATIONS).toContain(item.recommendedDestination);
  });

  it('builds a concise deterministic daily brief from normalized attention only', () => {
    const projects = [
      project({
        workers: { w1: { active: true }, w2: { active: true } },
        attendance: { w1: { '2026-08-29': { status: 'present' } } },
        tasks: { blocked: { title: 'Ceiling framing', status: 'blocked', dueDate: '2026-08-27', blockedReason: 'Drawing pending' } },
        purchaseOrders: { po1: { status: 'partially_delivered', items: [{ desc: 'Gypsum Board', qtyOrdered: 100, qtyAccepted: 80, unit: 'sheets' }] } },
        punchList: { issue1: { description: 'Wall crack review', status: 'open', severity: 'minor', createdAt: NOW - 4 * 86_400_000 } },
      }),
      { id: 'p2', name: 'Coffee Bay', status: 'active' },
    ];
    const items = Attention.derive(projects, { now: NOW });
    const summaries = Attention.summarizeProjects(projects, items);
    const brief = Attention.buildDailyBrief(items, summaries, { now: NOW });
    const copy = brief.lines.join('\n');

    expect(brief.detectedBy).toBe('deterministic');
    expect(brief.lines).toHaveLength(6);
    expect(brief.lines[0]).toBe('Good afternoon.');
    expect(copy).toContain('4 items need attention across 1 project.');
    expect(copy).toContain('Priority: RCBC Plaza — Blocked overdue task: Ceiling framing — Drawing pending.');
    expect(copy).toContain('1 attendance record from yesterday remains unresolved.');
    expect(copy).toContain('1 blocked and overdue task needs follow-up.');
    expect(copy).toContain('Gypsum Board delivery is 80 of 100 sheets received.');
    expect(copy).toContain('1 site issue has been open for 4 days.');
    expect(brief.lines.at(-1)).toBe('Everything else currently has no detected attention items.');
    expect(copy).not.toMatch(/schedule impact|cost impact|out of stock|caused|because/i);
  });

  it('uses the exact calm two-line brief when there is no attention', () => {
    const brief = Attention.buildDailyBrief([], [{ projectId: 'p1', status: 'on_track' }], { now: NOW });
    expect(brief).toEqual({
      detectedBy: 'deterministic',
      lines: ['Everything looks on track.', 'No operational issues currently need your attention.'],
    });
  });

  it('omits the calm remainder when no loaded project is on track', () => {
    const projects = [project({ tasks: { late: { title: 'Late task', status: 'in_progress', dueDate: '2026-08-25' } } })];
    const items = Attention.derive(projects, { now: NOW });
    const summaries = Attention.summarizeProjects(projects, items);
    const brief = Attention.buildDailyBrief(items, summaries, { now: NOW });
    expect(brief.lines).toContain('1 item needs attention across 1 project.');
    expect(brief.lines).not.toContain('Everything else currently has no detected attention items.');
    expect(brief.lines.length).toBeLessThanOrEqual(6);
  });

  it('omits the calm remainder when an attention item is not otherwise reported', () => {
    const projects = [
      project({ tasks: { late: { title: 'Late task', status: 'in_progress', dueDate: '2026-08-25' } } }),
      { id: 'p2', name: 'Library Fit-out', status: 'active', pmosMaterialRequests: { pending: { item: 'Cement', status: 'Under Review' } } },
      { id: 'p3', name: 'Coffee Bay', status: 'active' },
    ];
    const items = Attention.derive(projects, { now: NOW });
    const summaries = Attention.summarizeProjects(projects, items);
    const brief = Attention.buildDailyBrief(items, summaries, { now: NOW });
    expect(items.some((item: any) => item.category === 'materials')).toBe(true);
    expect(summaries.some((summary: any) => summary.status === 'on_track')).toBe(true);
    expect(brief.lines).not.toContain('Everything else currently has no detected attention items.');
  });
});
