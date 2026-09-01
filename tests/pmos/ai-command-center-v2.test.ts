import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const V2 = require('../../ai-command-center-v2.js');
const NOW = Date.parse('2026-09-01T02:00:00Z');

function attention(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task:p1:t1', projectId: 'p1', projectName: 'RCBC Plaza', category: 'task',
    severity: 'high', title: 'Blocked task', summary: 'Ceiling framing — Drawing pending',
    sourceType: 'task', sourceId: 't1', occurredAt: NOW - 3_600_000, age: 2,
    status: 'blocked', recommendedDestination: 'task', detectedBy: 'deterministic',
    ...overrides,
  };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    projects: [
      { id: 'p1', name: 'RCBC Plaza', status: 'active' },
      { id: 'p2', name: 'Coffee Bay', status: 'active' },
      { id: 'p3', name: 'Completed Site', status: 'completed' },
    ],
    attention: [
      attention(),
      attention({ id: 'delivery:p1:po1:0', category: 'delivery', severity: 'medium', title: 'Gypsum Board', summary: 'Received 80 sheets / 100 sheets. Pending 20 sheets.', sourceType: 'purchase_order', sourceId: 'po1' }),
      attention({ id: 'attendance:p2:2026-08-31', projectId: 'p2', projectName: 'Coffee Bay', category: 'attendance', severity: 'medium', title: 'Unresolved attendance', summary: '2 attendance entries are unresolved for 2026-08-31.', sourceType: 'attendance_date', sourceId: '2026-08-31' }),
      attention({ id: 'site_issue:p2:i1', projectId: 'p2', projectName: 'Coffee Bay', category: 'site_issue', severity: 'medium', title: 'Aging site issue', summary: 'Wall crack review — open for 4 days.', sourceType: 'site_issue', sourceId: 'i1', age: 4 }),
    ],
    runs: [], events: {}, findings: {}, recommendations: [],
    decisions: [{ id: 'd1', projectId: 'p1', recommendationId: 'r1', runId: 'run1', eventId: 'e1', status: 'open', question: 'Choose a reviewed response?', createdAt: NOW - 1_000 }],
    actionDrafts: [{ id: 'a1', projectId: 'p1', decisionId: 'd0', recommendationId: 'r0', status: 'draft', title: 'Prepare supplier follow-up', summary: 'Review-only draft.', createdAt: NOW - 2_000 }],
    actionDraftEvents: [],
    uiStatus: { systemStatus: 'not_configured' }, runtimeStatus: null,
    ...overrides,
  };
}

describe('AI Command Center V2 presentation model', () => {
  it('builds grounded company pulse counts without percentages', () => {
    const pulse = V2.buildCompanyPulse(context(), { now: NOW });
    expect(pulse).toMatchObject({
      activeProjects: 2,
      projectsNeedingAttention: 2,
      openFindings: 4,
      highCriticalAttention: 1,
      waitingDecisions: 1,
      pendingActionDrafts: 1,
      priority: { projectName: 'RCBC Plaza', title: 'Blocked task' },
    });
    expect(JSON.stringify(pulse)).not.toMatch(/health|riskPercent|confidence|financialExposure/i);
  });

  it('reports truthful agent states and finding counts', () => {
    const agents = V2.buildAiTeam(context());
    expect(agents.map((agent: any) => agent.label)).toEqual([
      'PM Agent', 'Planning Monitor', 'Materials Monitor', 'Site / QA Monitor',
    ]);
    expect(agents.find((agent: any) => agent.id === 'pm')).toMatchObject({ status: 'NOT_CONFIGURED', activeRun: false });
    expect(agents.find((agent: any) => agent.id === 'planning')).toMatchObject({ status: 'MONITORING', findingCount: 2 });
    expect(agents.find((agent: any) => agent.id === 'materials')).toMatchObject({ status: 'MONITORING', findingCount: 1 });
    expect(agents.find((agent: any) => agent.id === 'site')).toMatchObject({ status: 'MONITORING', findingCount: 1 });
  });

  it('uses ANALYZING only for a real active run', () => {
    const agents = V2.buildAiTeam(context({ runs: [{ id: 'run1', status: 'running', requiredAgents: ['materials'] }] }));
    expect(agents.find((agent: any) => agent.id === 'materials')).toMatchObject({ status: 'ANALYZING', activeRun: true });
    expect(agents.find((agent: any) => agent.id === 'planning').status).toBe('MONITORING');
    expect(agents.find((agent: any) => agent.id === 'pm').status).toBe('NOT_CONFIGURED');
  });

  it('groups project intelligence by responsibility without inventing health', () => {
    const projects = V2.buildProjectIntelligence(context(), { now: NOW });
    const rcbc = projects.find((project: any) => project.projectId === 'p1');
    expect(rcbc).toMatchObject({ attentionCount: 2 });
    expect(rcbc.planning).toHaveLength(1);
    expect(rcbc.materials).toHaveLength(1);
    expect(rcbc.site).toHaveLength(0);
    expect(rcbc.waitingDecisions).toHaveLength(1);
    expect(rcbc.actionDrafts).toHaveLength(1);
    expect(rcbc).not.toHaveProperty('healthPercent');
  });

  it('normalizes real timeline records with distinct provenance labels', () => {
    const timeline = V2.normalizeTimeline(context({
      events: { e1: { id: 'e1', projectId: 'p1', eventType: 'task_blocked', detectedAt: NOW - 5_000 } },
      runs: [{ id: 'run1', projectId: 'p1', eventId: 'e1', status: 'completed', requiredAgents: ['planning'], createdAt: NOW - 4_000 }],
      recommendations: [{ id: 'r1', projectId: 'p1', eventId: 'e1', runId: 'run1', title: 'Review blocked work', summary: 'Validated finding.', status: 'open', createdAt: NOW - 3_000 }],
    }), { now: NOW });
    expect(new Set(timeline.map((item: any) => item.type))).toEqual(new Set([
      'SYSTEM_DETECTED', 'RULE_BASED_MONITOR', 'AI_ANALYSIS', 'HUMAN_DECISION', 'ACTION_DRAFT',
    ]));
    expect(timeline.some((item: any) => item.actor === 'Planning Monitor')).toBe(true);
    expect(timeline.some((item: any) => item.actor === 'PM Agent')).toBe(true);
  });

  it('creates handoffs only from explicit stored IDs', () => {
    const linked = V2.normalizeTimeline(context({
      attention: [], actionDrafts: [], decisions: [],
      events: { e1: { id: 'e1', projectId: 'p1', eventType: 'task_blocked', detectedAt: NOW - 5_000 } },
      runs: [{ id: 'run1', projectId: 'p1', eventId: 'e1', status: 'completed', requiredAgents: ['planning'], createdAt: NOW - 4_000 }],
      recommendations: [{ id: 'r1', projectId: 'p1', eventId: 'e1', runId: 'run1', title: 'Review', createdAt: NOW - 3_000 }],
    }), { now: NOW });
    const handoffs = V2.buildHandoffs(linked);
    expect(handoffs.length).toBeGreaterThan(0);
    expect(handoffs.every((link: any) => {
      const from = linked.find((item: any) => item.id === link.fromId);
      const to = linked.find((item: any) => item.id === link.toId);
      return from?.actorId !== to?.actorId && from?.actor !== to?.actor;
    })).toBe(true);
    expect(handoffs.some((link: any) => {
      const from = linked.find((item: any) => item.id === link.fromId);
      const to = linked.find((item: any) => item.id === link.toId);
      return from?.actor === 'Planning Monitor' && to?.actor === 'PM Agent';
    })).toBe(true);

    const unrelated = V2.normalizeTimeline(context({
      attention: [], actionDrafts: [], decisions: [],
      events: { e1: { id: 'e1', projectId: 'p1', eventType: 'task_blocked', detectedAt: NOW - 5_000 } },
      recommendations: [{ id: 'r2', projectId: 'p1', title: 'Independent review', createdAt: NOW - 3_000 }],
    }), { now: NOW });
    expect(V2.buildHandoffs(unrelated)).toEqual([]);
  });
});

describe('Ask Command Center deterministic query engine', () => {
  const cases = [
    ['Ano kailangan kong unahin ngayon?', 'company_priority'],
    ['Show blocked tasks.', 'blocked_tasks'],
    ['May overdue tasks ba?', 'overdue_tasks'],
    ['Show tasks for verification.', 'verification_tasks'],
    ['May attendance na unresolved?', 'attendance_unresolved'],
    ['May pending deliveries ba?', 'partial_deliveries'],
    ['Show pending material requests.', 'pending_material_requests'],
    ['Show open site issues.', 'open_site_issues'],
    ['Any aging issues?', 'aging_site_issues'],
    ['What changed today?', 'recent_changes'],
    ['Summarize Materials concerns.', 'materials_summary'],
    ['Give me a planning summary.', 'planning_summary'],
    ['Give me a site summary.', 'site_summary'],
    ['What decisions are waiting?', 'waiting_decisions'],
    ['Show pending action drafts.', 'action_drafts'],
  ];

  it.each(cases)('matches %s to %s', (question, expectedIntent) => {
    expect(V2.detectIntent(question, context().projects).intent).toBe(expectedIntent);
  });

  it.each([
    'Company priority',
    'What needs attention?',
    'Which project needs the most attention?',
    'Ano ang dapat unahin?',
  ])('keeps company-wide priority phrasing in company scope: %s', (question) => {
    expect(V2.detectIntent(question, context().projects)).toEqual({ intent: 'company_priority', projectId: null });
    expect(V2.answer(question, context(), { now: NOW })).toMatchObject({
      intent: 'company_priority', scope: 'company', projectId: null, generatedBy: 'deterministic',
    });
  });

  it('uses project scope only when a known project is explicitly identified', () => {
    expect(V2.detectIntent('What is wrong with RCBC?', context().projects)).toEqual({ intent: 'project_attention', projectId: 'p1' });
    expect(V2.detectIntent('RCBC blocked tasks', context().projects)).toEqual({ intent: 'blocked_tasks', projectId: 'p1' });
  });

  it('keeps delivery questions company-wide unless a project is explicit', () => {
    expect(V2.detectIntent('Pending deliveries', context().projects)).toEqual({ intent: 'partial_deliveries', projectId: null });
    expect(V2.detectIntent('Pending deliveries in RCBC Plaza', context().projects)).toEqual({ intent: 'partial_deliveries', projectId: 'p1' });
  });

  it('does not let intent words in a project name override company scope or contradict Company Pulse', () => {
    const snapshot = context({
      projects: [
        ...context().projects,
        { id: 'legacy', name: 'Attention Archive', status: 'archived' },
      ],
    });
    const pulse = V2.buildCompanyPulse(snapshot, { now: NOW });
    const result = V2.answer('Which project needs the most attention?', snapshot, { now: NOW });

    expect(pulse.openFindings).toBeGreaterThan(0);
    expect(result).toMatchObject({ intent: 'company_priority', scope: 'company', projectId: null });
    expect(result.summary).toContain(`${pulse.openFindings} current attention items detected across ${pulse.projectsNeedingAttention} projects.`);
    expect(result.summary).not.toBe('No operational attention items are currently detected.');
    expect(result.facts[0]).toContain('RCBC Plaza');
  });

  it('matches known project names without turning text into a data path', () => {
    const detected = V2.detectIntent('Ano ang issues sa RCBC?', context().projects);
    expect(detected).toEqual({ intent: 'project_attention', projectId: 'p1' });
    const result = V2.answer('Ano ang issues sa RCBC?', context(), { now: NOW });
    expect(result).toMatchObject({ intent: 'project_attention', scope: 'project', projectId: 'p1', generatedBy: 'deterministic' });
    expect(result.facts.join(' ')).toContain('Ceiling framing');
    expect(result.sourceRefs.every((ref: any) => !('path' in ref))).toBe(true);
  });

  it('returns a safe truthful fallback for unsupported questions', () => {
    const result = V2.answer('How much money will this delay cost next quarter?', context(), { now: NOW });
    expect(result.intent).toBe('unsupported');
    expect(result.summary).toBe('That question requires advanced AI analysis, which is not configured in the current pilot.');
    expect(result.facts).toEqual([]);
  });

  it('answers only with grounded facts and no unsupported inference', () => {
    const result = V2.answer('May pending deliveries ba?', context(), { now: NOW });
    expect(result.facts.join(' ')).toContain('Received 80 sheets / 100 sheets');
    expect(JSON.stringify(result)).not.toMatch(/cost impact|schedule impact|supplier blame|stock shortage|caused by|because/i);
  });

  it('prioritizes by deterministic severity rather than input order', () => {
    const low = attention({ id: 'low', projectId: 'p2', projectName: 'Coffee Bay', severity: 'low', title: 'Open site issue', category: 'site_issue' });
    const critical = attention({ id: 'critical', severity: 'critical', title: 'Blocked overdue task' });
    const result = V2.answer('Which project needs the most attention?', context({ attention: [low, critical] }), { now: NOW });
    expect(result).toMatchObject({ scope: 'company', projectId: null });
    expect(result.summary).toContain('2 current attention items detected across 2 projects.');
    expect(result.facts[0]).toContain('RCBC Plaza');
    expect(result.facts[0]).toContain('Blocked overdue task');
  });

  it('keeps deterministic and future AI answer provenance distinct', () => {
    expect(V2.answer('Show blocked tasks', context(), { now: NOW }).generatedBy).toBe('deterministic');
    expect(V2.normalizeAnswer({ intent: 'planning_summary', generatedBy: 'ai', title: 'Grounded provider answer', summary: 'Validated.', facts: [], sourceRefs: [], timestamp: NOW }).generatedBy).toBe('ai');
  });
});
