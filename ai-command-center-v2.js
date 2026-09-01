(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ACPMCommandCenterV2 = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var CLOSED_PROJECT = ['completed', 'archived', 'cancelled'];
  var SEVERITY_RANK = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  var SUPPORTED_INTENTS = Object.freeze([
    'company_priority', 'project_attention', 'blocked_tasks', 'overdue_tasks',
    'verification_tasks', 'attendance_unresolved', 'partial_deliveries',
    'pending_material_requests', 'open_site_issues', 'aging_site_issues',
    'recent_changes', 'materials_summary', 'planning_summary', 'site_summary',
    'waiting_decisions', 'action_drafts'
  ]);

  function rows(value) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.map(function (item, index) {
      return Object.assign({ id: String(item && item.id != null ? item.id : index) }, item || {});
    });
    return Object.keys(value).map(function (id) { return Object.assign({ id: id }, value[id] || {}); });
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalized(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function time(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    if (typeof value !== 'string' || !value.trim()) return 0;
    var parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function activeProject(project) {
    return CLOSED_PROJECT.indexOf(normalized(project && project.status || 'active').replace(/ /g, '_')) === -1;
  }

  function projectMap(projects) {
    var map = {};
    rows(projects).forEach(function (project) {
      var id = text(project.id);
      if (id) map[id] = text(project.name) || id;
    });
    return map;
  }

  function projectName(map, projectId) {
    var id = text(projectId);
    return map[id] || (id ? 'Project ' + id : 'Company-wide');
  }

  function manilaDateKey(value) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date(value));
    } catch (_) {
      return new Date(value).toISOString().slice(0, 10);
    }
  }

  function sourceRef(type, item, projectId) {
    return { type: type, id: text(item && item.id), projectId: text(projectId || item && item.projectId) };
  }

  function linksFrom(item) {
    var ids = [];
    ['eventId', 'runId', 'recommendationId', 'decisionId', 'actionDraftId', 'draftId', 'lastEventId'].forEach(function (field) {
      if (text(item && item[field])) ids.push(text(item[field]));
    });
    return Array.from(new Set(ids));
  }

  function monitorForAttention(item) {
    if (item.category === 'delivery' || item.category === 'materials') return { id: 'materials', label: 'Materials Monitor' };
    if (item.category === 'site_issue') return { id: 'site', label: 'Site / QA Monitor' };
    return { id: 'planning', label: 'Planning Monitor' };
  }

  function agentLabel(agentId) {
    if (agentId === 'pm') return 'PM Agent';
    if (agentId === 'planning') return 'Planning Monitor';
    if (agentId === 'materials') return 'Materials Monitor';
    if (agentId === 'site' || agentId === 'qa') return 'Site / QA Monitor';
    return 'AI Analysis';
  }

  function normalizeTimeline(context, options) {
    var map = projectMap(context.projects);
    var output = [];
    var now = options && Number.isFinite(options.now) ? options.now : Date.now();

    rows(context.attention).forEach(function (item) {
      var monitor = monitorForAttention(item);
      output.push({
        id: 'attention:' + text(item.id), type: 'RULE_BASED_MONITOR', actorId: monitor.id,
        actor: monitor.label, title: text(item.title) || 'Operational finding', summary: text(item.summary),
        projectId: text(item.projectId), projectName: text(item.projectName) || projectName(map, item.projectId),
        timestamp: time(item.occurredAt), sourceRefs: [sourceRef('attention', item)],
        relationshipIds: []
      });
    });

    rows(context.events).forEach(function (item) {
      output.push({
        id: 'event:' + text(item.id), type: 'SYSTEM_DETECTED', actorId: 'system', actor: 'ACPM System',
        title: text(item.eventType).replace(/_/g, ' ') || 'Operational condition detected', summary: '',
        projectId: text(item.projectId), projectName: projectName(map, item.projectId),
        timestamp: time(item.detectedAt) || time(item.occurredAt) || time(item.createdAt),
        sourceRefs: [sourceRef('event', item)], relationshipIds: linksFrom(item)
      });
    });

    rows(context.runs).forEach(function (item) {
      var agents = Array.isArray(item.requiredAgents) ? item.requiredAgents.map(text).filter(Boolean) : [];
      var agentId = agents.length === 1 ? agents[0] : 'analysis';
      output.push({
        id: 'run:' + text(item.id), type: 'AI_ANALYSIS', actorId: agentId,
        actor: agents.length === 1 ? agentLabel(agentId) : 'AI Analysis',
        title: item.status === 'running' ? 'Analysis run in progress' : 'Analysis run ' + (text(item.status) || 'recorded'),
        summary: text(item.safeErrorCode) ? 'Run recorded a safe provider status.' : '',
        projectId: text(item.projectId), projectName: projectName(map, item.projectId),
        timestamp: time(item.completedAt) || time(item.startedAt) || time(item.createdAt),
        sourceRefs: [sourceRef('run', item)], relationshipIds: linksFrom(item)
      });
    });

    rows(context.recommendations).forEach(function (item) {
      output.push({
        id: 'recommendation:' + text(item.id), type: 'AI_ANALYSIS', actorId: 'pm', actor: 'PM Agent',
        title: text(item.title) || 'Recommendation prepared', summary: text(item.summary),
        projectId: text(item.projectId), projectName: projectName(map, item.projectId),
        timestamp: time(item.createdAt), sourceRefs: [sourceRef('recommendation', item)],
        relationshipIds: linksFrom(item)
      });
    });

    var runsById = {};
    rows(context.runs).forEach(function (run) { runsById[text(run.id)] = run; });
    Object.keys(context.findings || {}).forEach(function (runId) {
      var runFindings = context.findings[runId];
      if (!runFindings || typeof runFindings !== 'object') return;
      Object.keys(runFindings).forEach(function (agentId) {
        var finding = runFindings[agentId];
        if (!finding || typeof finding !== 'object' || !text(finding.summary)) return;
        var run = runsById[runId] || {};
        var actor = agentLabel(agentId);
        output.push({
          id: 'finding:' + runId + ':' + agentId, type: 'AI_ANALYSIS', actorId: agentId, actor: actor,
          title: actor + ' finding recorded', summary: text(finding.summary),
          projectId: text(run.projectId || finding.projectId), projectName: projectName(map, run.projectId || finding.projectId),
          timestamp: time(finding.createdAt) || time(run.completedAt) || time(run.startedAt) || time(run.createdAt),
          sourceRefs: [{ type: 'finding', id: runId + ':' + agentId, projectId: text(run.projectId || finding.projectId) }],
          relationshipIds: [runId]
        });
      });
    });

    rows(context.decisions).forEach(function (item) {
      output.push({
        id: 'decision:' + text(item.id), type: 'HUMAN_DECISION', actorId: 'management', actor: 'Management Decision',
        title: item.status === 'open' ? 'Decision waiting for management' : 'Management decision recorded',
        summary: text(item.question), projectId: text(item.projectId), projectName: projectName(map, item.projectId),
        timestamp: time(item.resolvedAt) || time(item.deferredAt) || time(item.createdAt),
        sourceRefs: [sourceRef('decision', item)], relationshipIds: linksFrom(item)
      });
    });

    rows(context.actionDrafts).forEach(function (item) {
      output.push({
        id: 'action_draft:' + text(item.id), type: 'ACTION_DRAFT', actorId: 'action_draft', actor: 'Action Draft',
        title: text(item.title) || 'Controlled action draft', summary: text(item.summary),
        projectId: text(item.projectId), projectName: projectName(map, item.projectId),
        timestamp: time(item.reviewedAt) || time(item.cancelledAt) || time(item.createdAt),
        sourceRefs: [sourceRef('action_draft', item)], relationshipIds: linksFrom(item)
      });
    });

    rows(context.actionDraftEvents).forEach(function (item) {
      output.push({
        id: 'action_draft_event:' + text(item.id), type: 'ACTION_DRAFT', actorId: 'action_draft', actor: 'Action Draft',
        title: text(item.eventType || item.action).replace(/_/g, ' ') || 'Action draft event recorded', summary: '',
        projectId: text(item.projectId), projectName: projectName(map, item.projectId),
        timestamp: time(item.timestamp) || time(item.createdAt), sourceRefs: [sourceRef('action_draft_event', item)],
        relationshipIds: linksFrom(item)
      });
    });

    return output.filter(function (item) { return item.id && item.timestamp >= 0; })
      .sort(function (a, b) { return b.timestamp - a.timestamp || a.id.localeCompare(b.id); })
      .slice(0, options && Number.isFinite(options.limit) ? options.limit : 60);
  }

  function buildHandoffs(timeline) {
    var records = Array.isArray(timeline) ? timeline : [];
    var bySourceId = {};
    records.forEach(function (item) {
      (item.sourceRefs || []).forEach(function (ref) {
        if (!ref.id) return;
        if (!bySourceId[ref.id]) bySourceId[ref.id] = [];
        bySourceId[ref.id].push(item);
      });
    });
    var seen = {};
    var links = [];
    records.forEach(function (to) {
      (to.relationshipIds || []).forEach(function (id) {
        (bySourceId[id] || []).forEach(function (from) {
          if (from.id === to.id || from.actorId === to.actorId || from.actor === to.actor) return;
          var key = [from.id, to.id].sort().join('|');
          if (seen[key]) return;
          seen[key] = true;
          links.push({ fromId: from.id, toId: to.id, relationshipId: id, explicit: true });
        });
      });
    });
    return links;
  }

  function buildCompanyPulse(context, options) {
    var projects = rows(context.projects).filter(activeProject);
    var attention = rows(context.attention);
    var decisions = rows(context.decisions).filter(function (item) { return item.status === 'open'; });
    var drafts = rows(context.actionDrafts).filter(function (item) { return item.status === 'draft'; });
    var timeline = normalizeTimeline(context, options);
    var today = manilaDateKey(options && Number.isFinite(options.now) ? options.now : Date.now());
    var projectIds = {};
    attention.forEach(function (item) { if (item.projectId) projectIds[item.projectId] = true; });
    var priority = attention.slice().sort(function (a, b) {
      return (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
        || (Number(b.age) || 0) - (Number(a.age) || 0);
    })[0] || null;
    return {
      activeProjects: projects.length,
      projectsNeedingAttention: Object.keys(projectIds).length,
      openFindings: attention.length,
      highCriticalAttention: attention.filter(function (item) { return item.severity === 'high' || item.severity === 'critical'; }).length,
      waitingDecisions: decisions.length,
      pendingActionDrafts: drafts.length,
      recentIntelligenceToday: timeline.filter(function (item) { return manilaDateKey(item.timestamp) === today; }).length,
      priority: priority ? {
        itemId: text(priority.id), projectId: text(priority.projectId), projectName: text(priority.projectName),
        title: text(priority.title), summary: text(priority.summary), severity: text(priority.severity)
      } : null
    };
  }

  function runningAgentIds(runs) {
    var active = {};
    rows(runs).filter(function (run) { return run.status === 'running'; }).forEach(function (run) {
      (Array.isArray(run.requiredAgents) ? run.requiredAgents : []).forEach(function (id) { active[text(id)] = true; });
    });
    return active;
  }

  function buildAiTeam(context) {
    var attention = rows(context.attention);
    var running = runningAgentIds(context.runs);
    var system = text(context.uiStatus && context.uiStatus.systemStatus) || 'disabled';
    var providerUnavailable = ['disabled', 'not_configured', 'unavailable'].indexOf(system) !== -1;
    var definitions = [
      { id: 'pm', label: 'PM Agent', description: 'Company synthesis, prioritization, recommendations, and decision framing.', categories: [] },
      { id: 'planning', label: 'Planning Monitor', description: 'Tasks, deadlines, blocked work, verification, and recorded planning evidence.', categories: ['task', 'verification', 'attendance'] },
      { id: 'materials', label: 'Materials Monitor', description: 'Requests, ordered and received quantities, partial deliveries, and verified material status.', categories: ['delivery', 'materials'] },
      { id: 'site', label: 'Site / QA Monitor', description: 'Open and aging site issues, punch items, and verification signals.', categories: ['site_issue'] }
    ];
    return definitions.map(function (agent) {
      var aliases = agent.id === 'site' ? ['site', 'qa', 'site_qa'] : [agent.id];
      var activeRun = aliases.some(function (id) { return running[id]; });
      var findingCount = agent.id === 'pm'
        ? rows(context.recommendations).filter(function (item) { return item.status === 'open'; }).length
        : attention.filter(function (item) { return agent.categories.indexOf(item.category) !== -1; }).length;
      var status = 'MONITORING';
      var detail = 'Rule-based monitoring active';
      if (activeRun) {
        status = 'ANALYZING';
        detail = 'A recorded analysis run is active';
      } else if (agent.id === 'pm' && providerUnavailable) {
        status = 'NOT_CONFIGURED';
        detail = 'Advanced analysis not configured';
      } else if (agent.id === 'pm' && system === 'degraded') {
        status = 'DEGRADED';
        detail = 'Advanced analysis degraded';
      } else if (agent.id === 'pm') {
        status = 'IDLE';
        detail = 'No active analysis run';
      }
      return Object.assign({}, agent, { status: status, statusDetail: detail, findingCount: findingCount, activeRun: activeRun });
    });
  }

  function projectSignals(attention) {
    return {
      planning: attention.filter(function (item) { return ['task', 'verification', 'attendance'].indexOf(item.category) !== -1; }),
      materials: attention.filter(function (item) { return ['delivery', 'materials'].indexOf(item.category) !== -1; }),
      site: attention.filter(function (item) { return item.category === 'site_issue'; })
    };
  }

  function buildProjectIntelligence(context, options) {
    var timeline = normalizeTimeline(context, options);
    return rows(context.projects).filter(activeProject).map(function (project) {
      var id = text(project.id);
      var attention = rows(context.attention).filter(function (item) { return text(item.projectId) === id; });
      var signals = projectSignals(attention);
      var recommendations = rows(context.recommendations).filter(function (item) { return text(item.projectId) === id; });
      var decisions = rows(context.decisions).filter(function (item) { return text(item.projectId) === id; });
      var drafts = rows(context.actionDrafts).filter(function (item) { return text(item.projectId) === id; });
      return {
        projectId: id, projectName: text(project.name) || id, attentionCount: attention.length,
        currentAttention: attention, planning: signals.planning, materials: signals.materials, site: signals.site,
        recommendations: recommendations, waitingDecisions: decisions.filter(function (item) { return item.status === 'open'; }),
        actionDrafts: drafts, recentActivity: timeline.filter(function (item) { return item.projectId === id; }).slice(0, 12)
      };
    }).sort(function (a, b) { return b.attentionCount - a.attentionCount || a.projectName.localeCompare(b.projectName); });
  }

  function findProject(question, projects) {
    var query = normalized(question);
    var projectRows = rows(projects);
    var fullMatches = projectRows.filter(function (project) {
      var name = normalized(project.name);
      return name && query.indexOf(name) !== -1;
    });
    fullMatches.sort(function (a, b) { return normalized(b.name).length - normalized(a.name).length; });
    if (fullMatches.length === 1 || (fullMatches.length > 1 && normalized(fullMatches[0].name).length > normalized(fullMatches[1].name).length)) {
      return fullMatches[0];
    }

    var generic = {
      project: true, projects: true, plaza: true, site: true, construction: true,
      company: true, priority: true, attention: true, need: true, needs: true,
      most: true, highest: true, what: true, which: true, dapat: true, unahin: true
    };
    var tokenOwners = {};
    projectRows.forEach(function (project) {
      Array.from(new Set(normalized(project.name).split(' ').filter(function (token) {
        return token.length >= 4 && !generic[token];
      }))).forEach(function (token) {
        tokenOwners[token] = (tokenOwners[token] || 0) + 1;
      });
    });
    var queryTokens = query.split(' ');
    var matches = projectRows.filter(function (project) {
      return normalized(project.name).split(' ').some(function (token) {
        return token.length >= 4 && !generic[token] && tokenOwners[token] === 1 && queryTokens.indexOf(token) !== -1;
      });
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function detectIntent(question, projects) {
    var query = normalized(question);
    var project = findProject(question, projects);
    function has(pattern) { return pattern.test(query); }
    var priorityQuestion = has(/\b(most attention|needs? (?:the )?most attention|highest priority|company priority|what needs attention|priority|unahin|uuna|kailangan.*unahin|ano.*dapat.*unahin)\b/);
    if (project && (priorityQuestion || has(/\b(problem|problema|issue|issues|attention|nangyayari|happening|wrong)\b/))) {
      return { intent: 'project_attention', projectId: text(project.id) };
    }
    if (priorityQuestion) return { intent: 'company_priority', projectId: null };
    if (has(/\b(blocked|blocking|naka block|nakablock|harang)\b/)) return { intent: 'blocked_tasks', projectId: project && text(project.id) };
    if (has(/\b(overdue|late task|past due|lampas.*due)\b/)) return { intent: 'overdue_tasks', projectId: project && text(project.id) };
    if (has(/\b(verification|verify|for review|ipa verify)\b/)) return { intent: 'verification_tasks', projectId: project && text(project.id) };
    if (has(/\b(attendance|timekeeping|unmarked)\b/)) return { intent: 'attendance_unresolved', projectId: project && text(project.id) };
    if (has(/\b(partial delivery|partial deliveries|pending delivery|pending deliveries|delivery|deliveries)\b/)) return { intent: 'partial_deliveries', projectId: project && text(project.id) };
    if (has(/\b(material requests?|purchase requests?|pending requests?|requests pending)\b/)) return { intent: 'pending_material_requests', projectId: project && text(project.id) };
    if (has(/\b(aging issue|aging issues|old issue|matagal.*issue|open.*days)\b/)) return { intent: 'aging_site_issues', projectId: project && text(project.id) };
    if (has(/\b(open site issue|open site issues|site issue|site issues|punch list)\b/)) return { intent: 'open_site_issues', projectId: project && text(project.id) };
    if (has(/\b(what changed|changed today|recent changes|recent activity|ano.*nagbago)\b/)) return { intent: 'recent_changes', projectId: project && text(project.id) };
    if (has(/\b(materials summary|summarize materials|materials concern|material concerns)\b/)) return { intent: 'materials_summary', projectId: project && text(project.id) };
    if (has(/\b(planning summary|summarize planning|planning concern|task summary)\b/)) return { intent: 'planning_summary', projectId: project && text(project.id) };
    if (has(/\b(site summary|qa summary|summarize site|site concern)\b/)) return { intent: 'site_summary', projectId: project && text(project.id) };
    if (has(/\b(waiting decisions?|pending decisions?|decisions? (?:are )?waiting|waiting on you)\b/)) return { intent: 'waiting_decisions', projectId: project && text(project.id) };
    if (has(/\b(action draft|action drafts|drafts pending|pending drafts)\b/)) return { intent: 'action_drafts', projectId: project && text(project.id) };
    if (project) return { intent: 'project_attention', projectId: text(project.id) };
    return { intent: null, projectId: null };
  }

  function filterProject(items, projectId) {
    return projectId ? items.filter(function (item) { return text(item.projectId) === projectId; }) : items;
  }

  function factFromAttention(item) {
    return [text(item.projectName), text(item.title), text(item.summary)].filter(Boolean).join(' — ');
  }

  function normalizedAnswer(values) {
    var generatedBy = values && values.generatedBy === 'ai' ? 'ai' : 'deterministic';
    return {
      intent: SUPPORTED_INTENTS.indexOf(values && values.intent) !== -1 ? values.intent : 'unsupported',
      scope: values && values.projectId ? 'project' : 'company', projectId: text(values && values.projectId) || null,
      title: text(values && values.title) || 'Command Center answer',
      summary: text(values && values.summary),
      facts: (Array.isArray(values && values.facts) ? values.facts : []).map(text).filter(Boolean).slice(0, 12),
      sourceRefs: (Array.isArray(values && values.sourceRefs) ? values.sourceRefs : []).filter(function (ref) {
        return ref && typeof ref.type === 'string' && typeof ref.id === 'string';
      }).map(function (ref) { return { type: text(ref.type), id: text(ref.id), projectId: text(ref.projectId) }; }).slice(0, 20),
      generatedBy: generatedBy,
      timestamp: Number.isFinite(values && values.timestamp) ? values.timestamp : Date.now()
    };
  }

  function answer(question, context, options) {
    var detected = detectIntent(question, context.projects);
    var now = options && Number.isFinite(options.now) ? options.now : Date.now();
    if (!detected.intent) return normalizedAnswer({
      intent: 'unsupported', title: 'Advanced analysis required',
      summary: 'That question requires advanced AI analysis, which is not configured in the current pilot.',
      facts: [], sourceRefs: [], generatedBy: 'deterministic', timestamp: now
    });
    var attention = filterProject(rows(context.attention), detected.projectId);
    var selected = [];
    var title = '';
    var summary = '';
    var facts = [];
    var refs = [];
    var map = projectMap(context.projects);
    var scopeName = detected.projectId ? projectName(map, detected.projectId) : 'the company';

    var categorySelectors = {
      blocked_tasks: function (item) { return item.category === 'task' && /^Blocked/.test(text(item.title)); },
      overdue_tasks: function (item) { return item.category === 'task' && /Overdue task/.test(text(item.title)); },
      verification_tasks: function (item) { return item.category === 'verification'; },
      attendance_unresolved: function (item) { return item.category === 'attendance'; },
      partial_deliveries: function (item) { return item.category === 'delivery'; },
      pending_material_requests: function (item) { return item.category === 'materials'; },
      open_site_issues: function (item) { return item.category === 'site_issue'; },
      aging_site_issues: function (item) { return item.category === 'site_issue' && text(item.title) === 'Aging site issue'; },
      materials_summary: function (item) { return item.category === 'delivery' || item.category === 'materials'; },
      planning_summary: function (item) { return ['task', 'verification', 'attendance'].indexOf(item.category) !== -1; },
      site_summary: function (item) { return item.category === 'site_issue'; }
    };

    if (detected.intent === 'company_priority') {
      selected = attention.slice().sort(function (a, b) {
        return (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
          || (Number(b.age) || 0) - (Number(a.age) || 0);
      }).slice(0, 1);
      title = 'Current company priority';
      if (selected.length) {
        var attentionProjectIds = {};
        attention.forEach(function (item) { if (text(item.projectId)) attentionProjectIds[text(item.projectId)] = true; });
        var attentionProjectCount = Object.keys(attentionProjectIds).length;
        var highestProjectName = text(selected[0].projectName) || projectName(map, selected[0].projectId);
        summary = attention.length + ' current attention item' + (attention.length === 1 ? '' : 's') + ' detected across '
          + attentionProjectCount + ' project' + (attentionProjectCount === 1 ? '' : 's') + '. '
          + highestProjectName + ' has the highest-ranked current attention item.';
      } else {
        summary = 'No operational attention items are currently detected.';
      }
    } else if (detected.intent === 'project_attention') {
      selected = attention;
      title = scopeName + ' attention';
      summary = selected.length ? selected.length + ' current attention item' + (selected.length === 1 ? '' : 's') + ' detected.' : 'No current attention items are detected for this project.';
    } else if (categorySelectors[detected.intent]) {
      selected = attention.filter(categorySelectors[detected.intent]);
      title = detected.intent.replace(/_/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
      summary = selected.length + ' matching current item' + (selected.length === 1 ? '' : 's') + ' detected for ' + scopeName + '.';
    } else if (detected.intent === 'recent_changes') {
      var timeline = normalizeTimeline(context, { now: now, limit: 12 });
      if (detected.projectId) timeline = timeline.filter(function (item) { return item.projectId === detected.projectId; });
      title = 'Recent intelligence activity';
      summary = timeline.length ? timeline.length + ' recent recorded intelligence event' + (timeline.length === 1 ? '' : 's') + ' available.' : 'No recent intelligence activity is available.';
      facts = timeline.slice(0, 8).map(function (item) { return [item.actor, item.title, item.projectName].filter(Boolean).join(' — '); });
      refs = timeline.slice(0, 8).flatMap(function (item) { return item.sourceRefs || []; });
    } else if (detected.intent === 'waiting_decisions') {
      var decisions = filterProject(rows(context.decisions), detected.projectId).filter(function (item) { return item.status === 'open'; });
      title = 'Waiting on management';
      summary = decisions.length + ' decision' + (decisions.length === 1 ? ' is' : 's are') + ' waiting for ' + scopeName + '.';
      facts = decisions.slice(0, 8).map(function (item) { return projectName(map, item.projectId) + ' — ' + (text(item.question) || 'Decision awaiting review'); });
      refs = decisions.slice(0, 8).map(function (item) { return sourceRef('decision', item); });
    } else if (detected.intent === 'action_drafts') {
      var drafts = filterProject(rows(context.actionDrafts), detected.projectId).filter(function (item) { return item.status === 'draft'; });
      title = 'Action drafts pending review';
      summary = drafts.length + ' controlled draft' + (drafts.length === 1 ? ' is' : 's are') + ' pending review for ' + scopeName + '. No action has executed.';
      facts = drafts.slice(0, 8).map(function (item) { return projectName(map, item.projectId) + ' — ' + (text(item.title) || 'Controlled action draft'); });
      refs = drafts.slice(0, 8).map(function (item) { return sourceRef('action_draft', item); });
    }

    if (selected.length) {
      facts = selected.slice(0, 8).map(factFromAttention);
      refs = selected.slice(0, 8).map(function (item) { return sourceRef('attention', item); });
    }
    return normalizedAnswer({
      intent: detected.intent, projectId: detected.projectId, title: title, summary: summary,
      facts: facts, sourceRefs: refs, generatedBy: 'deterministic', timestamp: now
    });
  }

  return {
    SUPPORTED_INTENTS: SUPPORTED_INTENTS,
    buildCompanyPulse: buildCompanyPulse,
    buildAiTeam: buildAiTeam,
    normalizeTimeline: normalizeTimeline,
    buildHandoffs: buildHandoffs,
    buildProjectIntelligence: buildProjectIntelligence,
    detectIntent: detectIntent,
    answer: answer,
    normalizeAnswer: normalizedAnswer
  };
});
