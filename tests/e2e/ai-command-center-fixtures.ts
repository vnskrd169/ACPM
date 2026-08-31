export type AiFixtureData = Record<string, unknown>;

const PROJECT_ID = 'test-project-1';

function uiStatus(now: number, systemStatus = 'ready', uiEnabled = true) {
  return { schemaVersion: '0.1', uiEnabled, systemStatus, updatedAt: now };
}

function runtime(now: number, status = 'healthy') {
  return {
    schemaVersion: '0.1',
    providerAlias: 'openai',
    status,
    lastCheckedAt: now - 15_000,
    lastSuccessAt: status === 'healthy' ? now - 15_000 : now - 3_600_000,
    safeErrorCode: status === 'healthy' ? null : 'provider_unavailable',
  };
}

function base(now: number, systemStatus = 'ready'): AiFixtureData {
  return {
    'ai/uiStatus': uiStatus(now, systemStatus),
    'ai/runtimeStatus': runtime(now, systemStatus === 'ready' ? 'healthy' : systemStatus),
    'ai/runs': {},
    'ai/events': {},
    'ai/findings': {},
    'ai/recommendations': {},
    'ai/decisions': {},
    'ai/actionDrafts': {},
    'ai/actionDraftEvents': {},
  };
}

function run(id: string, now: number, agents: string[], status = 'running') {
  return {
    schemaVersion: '0.1',
    eventId: `event-${id}`,
    projectId: PROJECT_ID,
    requiredAgents: agents,
    attempt: 1,
    status,
    providerAlias: 'openai',
    modelAlias: 'analysis+synthesis',
    contextDigest: `fixture-${id}`,
    dryRun: false,
    createdAt: now,
    startedAt: now,
    completedAt: status === 'completed' ? now + 1_000 : null,
    safeErrorCode: null,
    usage: null,
  };
}

function event(id: string, now: number, eventType: string) {
  return {
    schemaVersion: '0.1',
    eventType,
    projectId: PROJECT_ID,
    sourcePath: 'projects/test-project-1/tasks',
    sourceRecordId: `task-${id}`,
    sourceField: 'status',
    sourceDigest: `digest-${id}`,
    conditionKey: `condition-${id}`,
    dedupKey: `dedup-${id}`,
    occurredAt: now - 30_000,
    detectedAt: now - 20_000,
    status: 'processing',
    runId: `run-${id}`,
    createdAt: now,
    resolvedAt: null,
  };
}

const unknownSchedule = { status: 'unknown', days: null, reason: null, evidenceRefs: [] };
const unknownCost = { status: 'unknown', amount: null, currency: null, reason: null, evidenceRefs: [] };

function recommendation(id: string, now: number, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '0.1',
    projectId: PROJECT_ID,
    eventId: `event-${id}`,
    runId: `run-${id}`,
    severity: 'medium',
    title: 'Review delivery risk',
    summary: 'A validated delivery signal may affect planned work.',
    scheduleImpact: unknownSchedule,
    costImpact: unknownCost,
    recommendedActions: ['Confirm the supplier delivery date.'],
    needsHumanDecision: false,
    decisionId: null,
    evidenceRefs: [],
    status: 'open',
    createdAt: now,
    ...overrides,
  };
}

function decision(id: string, recommendationId: string, runId: string, now: number, question: string) {
  return {
    schemaVersion: '0.1',
    projectId: PROJECT_ID,
    eventId: `event-${id}`,
    runId,
    recommendationId,
    question,
    options: ['Proceed with the mitigation plan', 'Continue monitoring'],
    status: 'open',
    createdAt: now,
  };
}

function actionDrafts(now: number, providerOff = false): AiFixtureData {
  const data = base(now, providerOff ? 'not_configured' : 'ready');
  if (providerOff) data['ai/runtimeStatus'] = null;
  data['ai/decisions'] = {
    'decision-draft-source': {
      schemaVersion: '0.1',
      projectId: PROJECT_ID,
      eventId: 'event-draft-source',
      runId: 'run-draft-source',
      recommendationId: 'rec-draft-source',
      question: 'Prepare the validated follow-up draft?',
      options: [{
        id: 'prepare-alternate-source',
        label: 'Prepare alternate sourcing',
        actionIntent: {
          type: 'prepare_material_request',
          title: 'Prepare alternate material request',
          summary: 'Prepare a review-only alternate sourcing draft.',
          payload: {
            schemaVersion: '0.1',
            materialReference: 'material-42', requestedQuantity: null, supplierReference: null,
            taskReference: null, siteIssueReference: null, noteReference: null,
            reason: 'Validated need <img src=x onerror=alert(1)>',
            sourceEvidenceRefs: [{ path: 'projects/test-project-1/materials', recordId: 'material-42', field: 'status' }],
          },
        },
      }],
      status: 'resolved',
      createdAt: now - 120_000,
      resolvedAt: now - 60_000,
      resolvedBy: 'test-pm-user-uid',
      resolvedByRole: 'pm',
      resolution: 'prepare-alternate-source',
    },
  };
  data['ai/recommendations'] = {
    'rec-draft-source': recommendation('draft-source', now - 120_000, {
      title: 'Alternate sourcing review', needsHumanDecision: true, decisionId: 'decision-draft-source',
    }),
  };
  data['ai/actionDrafts'] = {
    'action-draft-1': {
      schemaVersion: '0.1',
      decisionId: 'decision-draft-source',
      recommendationId: 'rec-draft-source',
      eventId: 'event-draft-source',
      projectId: PROJECT_ID,
      actionType: 'prepare_material_request',
      title: 'Prepare alternate material request',
      summary: 'Prepare a review-only alternate sourcing draft.',
      status: 'draft',
      createdAt: now - 60_000,
      createdBy: 'test-pm-user-uid',
      sourceDecisionOptionId: 'prepare-alternate-source',
      payload: {
        schemaVersion: '0.1',
        materialReference: 'material-42', requestedQuantity: null, supplierReference: null,
        taskReference: null, siteIssueReference: null, noteReference: null,
        reason: 'Validated need <img src=x onerror=alert(1)>',
        sourceEvidenceRefs: [{ path: 'projects/test-project-1/materials', recordId: 'material-42', field: 'status' }],
      },
      lastEventId: 'action-draft-created-1',
    },
  };
  return data;
}

function activeRuns(now: number): AiFixtureData {
  const data = base(now);
  data['ai/runs'] = {
    'run-materials': run('materials', now - 120_000, ['materials', 'pm']),
    'run-planning': run('planning', now - 60_000, ['planning', 'pm']),
  };
  data['ai/events'] = {
    'event-materials': event('materials', now - 120_000, 'material_delivery_delayed'),
    'event-planning': event('planning', now - 60_000, 'task_overdue'),
  };
  data['ai/findings'] = {
    'run-materials': {
      materials: { summary: 'Supplier delivery is later than the task need date.' },
      pm: { summary: 'Delivery risk is under active review.' },
    },
    'run-planning': {
      planning: { summary: 'The activity is behind its planned completion date.' },
      pm: { summary: 'Schedule recovery options are being synthesized.' },
    },
  };
  return data;
}

function openRecommendation(now: number): AiFixtureData {
  const data = base(now);
  data['ai/recommendations'] = {
    'rec-delivery': recommendation('delivery', now - 180_000),
  };
  return data;
}

function decisions(now: number): AiFixtureData {
  const data = activeRuns(now);
  const evidence = [{ path: 'projects/test-project-1/tasks', recordId: 'task-critical', field: 'needDate' }];
  data['ai/recommendations'] = {
    'rec-critical': recommendation('critical', now - 240_000, {
      severity: 'critical',
      title: 'Critical material delivery conflict',
      summary: 'The confirmed delivery date is after the installation need date.',
      recommendedActions: ['Escalate the supplier and resequence affected work.'],
      needsHumanDecision: true,
      decisionId: 'decision-critical',
      evidenceRefs: evidence,
    }),
    'rec-high': recommendation('high', now - 300_000, {
      severity: 'high',
      title: 'Schedule recovery choice required',
      summary: 'A recovery path requires management review.',
      recommendedActions: ['Review the proposed recovery sequence.'],
      needsHumanDecision: true,
      decisionId: 'decision-high',
    }),
  };
  data['ai/decisions'] = {
    'decision-high': decision('high', 'rec-high', 'run-high', now - 300_000, 'Should the recovery sequence be adopted?'),
    'decision-critical': decision('critical', 'rec-critical', 'run-critical', now - 240_000, 'Should the supplier escalation begin today?'),
  };
  data['ai/findings'] = {
    ...(data['ai/findings'] as Record<string, unknown>),
    'run-critical': {
      materials: { summary: 'Delivery is confirmed after the recorded need date.', facts: [{ evidenceRefs: evidence }] },
      planning: { summary: 'Installation cannot start before the material arrives.' },
      pm: { summary: 'Management action is required to contain the delay.' },
    },
  };
  return data;
}

function unknownImpacts(now: number): AiFixtureData {
  const data = openRecommendation(now);
  data['ai/recommendations'] = {
    'rec-unknown': recommendation('unknown', now - 90_000, {
      title: 'Impact validation required',
      summary: 'The signal is valid, but schedule and cost magnitude are not known.',
      scheduleImpact: { status: 'unknown', days: 0, reason: null, evidenceRefs: [] },
      costImpact: { status: 'unknown', amount: 0, currency: 'PHP', reason: null, evidenceRefs: [] },
    }),
  };
  return data;
}

function groundedCritical(now: number): AiFixtureData {
  const data = base(now);
  const evidence = [{ path: 'projects/test-project-1/materials', recordId: 'mat-42', field: 'deliveryDate' }];
  data['ai/recommendations'] = {
    'rec-grounded': recommendation('grounded', now - 60_000, {
      severity: 'critical',
      title: 'Confirmed delivery impact',
      summary: 'The material delivery misses the validated need date.',
      scheduleImpact: { status: 'confirmed', days: 4, reason: 'Validated date difference.', evidenceRefs: evidence },
      costImpact: { status: 'confirmed', amount: 12_500, currency: 'PHP', reason: 'Validated standby cost.', evidenceRefs: evidence },
      recommendedActions: ['Approve expedited delivery review.'],
      needsHumanDecision: true,
      decisionId: 'decision-grounded',
      evidenceRefs: evidence,
    }),
  };
  data['ai/decisions'] = {
    'decision-grounded': decision('grounded', 'rec-grounded', 'run-grounded', now - 60_000, 'Should expedited delivery be reviewed?'),
  };
  data['ai/findings'] = {
    'run-grounded': {
      materials: { summary: 'Delivery is four days after the recorded need date.', facts: [{ evidenceRefs: evidence }] },
      planning: { summary: 'The affected installation activity has no recorded float.' },
      pm: { summary: 'The impact is grounded in schedule and material records.' },
    },
  };
  return data;
}

export function aiScenarios(now = Date.now()) {
  const degraded = base(now, 'degraded');
  degraded['ai/runtimeStatus'] = runtime(now, 'degraded');
  return {
    A_HEALTHY_NO_ISSUES: base(now),
    B_ACTIVE_RUNS: activeRuns(now),
    C_ONE_OPEN_RECOMMENDATION: openRecommendation(now),
    D_TWO_WAITING_DECISIONS: decisions(now),
    E_UNKNOWN_IMPACTS: unknownImpacts(now),
    F_CRITICAL_GROUNDED: groundedCritical(now),
    G_PROVIDER_DEGRADED: degraded,
    H_AI_DISABLED: {
      ...base(now, 'disabled'),
      'ai/uiStatus': uiStatus(now, 'disabled', false),
    },
  };
}

function manilaDate(now: number, offsetDays = 0) {
  const base = new Date(now + (8 * 60 * 60 * 1000));
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

function operationalProject(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return { id, name, status: 'active', createdAt: Date.now() - 30 * 86_400_000, ...overrides };
}

function withProjects(data: AiFixtureData, projects: Record<string, any>): AiFixtureData {
  data.projects = projects;
  Object.entries(projects).forEach(([id, value]) => { data[`projects/${id}`] = value; });
  return data;
}

export function zeroBudgetScenarios(now = Date.now()) {
  const yesterday = manilaDate(now, -1);
  const overdueDate = manilaDate(now, -2);
  const futureDate = manilaDate(now, 2);
  const calm = operationalProject('test-project-1', 'Coffee Bay');
  const overdue = operationalProject('test-project-1', 'RCBC Plaza', {
    tasks: { 'task-overdue': { title: 'Ceiling framing', status: 'in_progress', dueDate: overdueDate, priority: 'normal', createdAt: now - 5 * 86_400_000 } },
  });
  const blocked = operationalProject('test-project-1', 'RCBC Plaza', {
    tasks: { 'task-blocked': { title: 'Release coordinated layout', status: 'blocked', dueDate: futureDate, blockedReason: 'Awaiting drawing', updatedAt: now - 2 * 86_400_000 } },
  });
  const attendance = operationalProject('test-project-1', 'Coffee Bay', {
    workers: { w1: { name: 'Ana', active: true }, w2: { name: 'Ben', active: true }, w3: { name: 'Carlo', active: true } },
    attendance: { w1: { [yesterday]: { status: 'present', date: yesterday } } },
  });
  const delivery = operationalProject('test-project-1', 'RCBC Plaza', {
    purchaseOrders: { po1: { status: 'partially_delivered', items: [{ desc: 'Gypsum Board', qtyOrdered: 100, qtyAccepted: 80, unit: 'sheets' }] } },
    inventory: { gypsum: { quantity: 0, reorderPoint: 50 } },
  });
  const openIssue = operationalProject('test-project-1', 'Coffee Bay', {
    punchList: { issue1: { description: 'Door alignment requires review', status: 'open', severity: 'minor', createdAt: now - 86_400_000 } },
  });
  const agingIssue = operationalProject('test-project-1', 'Coffee Bay', {
    punchList: { issue1: { description: 'Wall crack review', status: 'open', severity: 'minor', createdAt: now - 4 * 86_400_000 } },
  });
  const notConfigured = base(now, 'not_configured');
  notConfigured['ai/runtimeStatus'] = null;
  const trueAiAlongside = decisions(now);
  const providerOffDecisions = decisions(now);
  providerOffDecisions['ai/uiStatus'] = uiStatus(now, 'not_configured');
  providerOffDecisions['ai/runtimeStatus'] = null;
  const drafts = actionDrafts(now);
  const providerOffDrafts = actionDrafts(now, true);
  const dailyBrief = operationalProject('test-project-1', 'RCBC Plaza', {
    workers: { w1: { name: 'Ana', active: true }, w2: { name: 'Ben', active: true } },
    attendance: { w1: { [yesterday]: { status: 'present', date: yesterday } } },
    tasks: {
      'task-brief': {
        title: 'Ceiling framing',
        status: 'blocked',
        dueDate: overdueDate,
        blockedReason: 'Drawing pending',
        createdAt: now - 5 * 86_400_000,
      },
    },
    purchaseOrders: {
      po1: {
        status: 'partially_delivered',
        items: [{ desc: 'Gypsum Board', qtyOrdered: 100, qtyAccepted: 80, unit: 'sheets' }],
      },
    },
    punchList: {
      issue1: {
        description: 'Wall crack review',
        status: 'open',
        severity: 'minor',
        createdAt: now - 4 * 86_400_000,
      },
    },
  });

  return {
    Z1_NO_ATTENTION: withProjects(base(now), { 'test-project-1': calm }),
    Z2_OVERDUE_TASK: withProjects(base(now), { 'test-project-1': overdue }),
    Z3_BLOCKED_TASK: withProjects(base(now), { 'test-project-1': blocked }),
    Z4_UNRESOLVED_ATTENDANCE: withProjects(base(now), { 'test-project-1': attendance }),
    Z5_PARTIAL_DELIVERY: withProjects(base(now), { 'test-project-1': delivery }),
    Z6_OPEN_SITE_ISSUE: withProjects(base(now), { 'test-project-1': openIssue }),
    Z7_AGING_SITE_ISSUE: withProjects(base(now), { 'test-project-1': agingIssue }),
    Z8_MULTIPLE_PROJECTS: withProjects(base(now), {
      'test-project-1': overdue,
      'test-project-2': operationalProject('test-project-2', 'Coffee Bay'),
    }),
    Z9_PROVIDER_OFF_MONITORING: withProjects(notConfigured, { 'test-project-1': overdue }),
    Z10_AI_DECISION_AND_ATTENTION: withProjects(trueAiAlongside, { 'test-project-1': overdue }),
    Z11_DAILY_BRIEF: withProjects(base(now), {
      'test-project-1': dailyBrief,
      'test-project-2': operationalProject('test-project-2', 'Coffee Bay'),
    }),
    Z12_PROVIDER_OFF_DECISIONS: withProjects(providerOffDecisions, { 'test-project-1': calm }),
    Z13_ACTION_DRAFTS: withProjects(drafts, { 'test-project-1': calm }),
    Z14_PROVIDER_OFF_ACTION_DRAFTS: withProjects(providerOffDrafts, { 'test-project-1': calm }),
  };
}
