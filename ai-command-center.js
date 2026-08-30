(function () {
  'use strict';

  var MANAGEMENT_ROLES = ['boss', 'owner', 'admin', 'pm'];
  var AGENTS = [
    { id: 'pm', label: 'PM Agent', description: 'Advanced cross-discipline analysis.' },
    { id: 'planning', label: 'Planning Monitor', description: 'Task and schedule rule monitoring.' },
    { id: 'materials', label: 'Materials Monitor', description: 'Request and delivery rule monitoring.' }
  ];
  var LIMITS = { runs: 100, events: 100, findings: 60, recommendations: 100, decisions: 100 };
  var RUNTIME_STALE_MS = 60 * 60 * 1000;
  var SEVERITY_RANK = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

  var state = {
    active: false,
    authUid: '',
    authUnsubscribe: null,
    profileTimer: null,
    gateRequest: 0,
    uiStatus: null,
    previousViewId: 'hubView',
    listeners: [],
    errors: {},
    filter: 'open',
    decisionReturnFocus: null,
    decisionSubmitting: false,
    pendingDecisionSubmission: null,
    data: emptyData()
  };

  function emptyData() {
    return {
      runtimeStatus: null,
      runs: [],
      events: {},
      findings: {},
      recommendations: [],
      decisions: [],
      projects: [],
      attention: [],
      projectSummaries: []
    };
  }

  function el(id) {
    return document.getElementById(id);
  }

  function h(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value == null ? '' : String(value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function normalizedRole() {
    var role = window._currentUser && window._currentUser.role;
    return typeof normalizeRole === 'function'
      ? normalizeRole(role || 'apm')
      : String(role || 'apm').trim().toLowerCase();
  }

  function authorizedProfile() {
    var user = window._currentUser || {};
    return user.status === 'active' && MANAGEMENT_ROLES.indexOf(normalizedRole()) !== -1;
  }

  function isOfficePage() {
    var page = String(window.ACPM_PAGE || '').toLowerCase();
    return page === 'dashboard' || page === 'workspace';
  }

  function database() {
    return window.firebase && firebase.database ? firebase.database() : null;
  }

  function snapshotRows(snapshot) {
    var rows = [];
    if (!snapshot || !snapshot.exists || !snapshot.exists()) return rows;
    snapshot.forEach(function (child) {
      rows.push(Object.assign({ id: child.key }, child.val() || {}));
    });
    return rows;
  }

  function rowsById(rows) {
    var output = {};
    rows.forEach(function (row) { output[row.id] = row; });
    return output;
  }

  function readUiStatus() {
    var db = database();
    if (!db) return Promise.resolve(null);
    return db.ref('ai/uiStatus').once('value').then(function (snapshot) {
      var value = snapshot && snapshot.exists && snapshot.exists() ? snapshot.val() : null;
      if (!value || value.schemaVersion !== '0.1' || value.uiEnabled !== true) return null;
      var fields = Object.keys(value).sort().join('|');
      if (fields !== 'schemaVersion|systemStatus|uiEnabled|updatedAt') return null;
      if (['disabled', 'not_configured', 'ready', 'degraded', 'unavailable'].indexOf(value.systemStatus) === -1) {
        return null;
      }
      if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) return null;
      return {
        schemaVersion: '0.1',
        uiEnabled: true,
        systemStatus: value.systemStatus,
        updatedAt: value.updatedAt
      };
    }).catch(function () {
      return null;
    });
  }

  function removeNavigation() {
    el('openAiCommandCenterBtn')?.remove();
    el('openAiCommandCenterWorkspaceBtn')?.remove();
  }

  function addNavigation() {
    var hubActions = document.querySelector('.hub-command-actions');
    if (hubActions && !el('openAiCommandCenterBtn')) {
      var hubButton = document.createElement('button');
      hubButton.id = 'openAiCommandCenterBtn';
      hubButton.className = 'btn-hub ai-command-nav';
      hubButton.type = 'button';
      hubButton.textContent = 'AI Command Center';
      hubButton.addEventListener('click', open);
      var pmosButton = el('openPmosOfficeBtn');
      if (pmosButton && pmosButton.parentNode === hubActions) hubActions.insertBefore(hubButton, pmosButton);
      else hubActions.insertBefore(hubButton, hubActions.firstChild);
    }

    var workspaceActions = document.querySelector('#workspaceView .ws-topbar .ws-actions');
    if (workspaceActions && !el('openAiCommandCenterWorkspaceBtn')) {
      var workspaceButton = document.createElement('button');
      workspaceButton.id = 'openAiCommandCenterWorkspaceBtn';
      workspaceButton.className = 'btn-ws-secondary ai-command-nav';
      workspaceButton.type = 'button';
      workspaceButton.textContent = 'AI Command Center';
      workspaceButton.addEventListener('click', open);
      workspaceActions.insertBefore(workspaceButton, workspaceActions.firstChild);
    }
  }

  function ensureView() {
    if (el('aiCommandCenterView')) return;
    var main = document.querySelector('.main');
    if (!main) return;
    main.insertAdjacentHTML('beforeend', `
      <section id="aiCommandCenterView" class="view-workspace ai-command-center hidden" aria-labelledby="aiCommandTitle">
        <div class="ai-command-hero ai-command-hero-operational">
          <div>
            <div class="ws-kicker">Construction operations intelligence</div>
            <h2 id="aiCommandTitle">AI Command Center</h2>
            <p>What needs attention across your projects, using stored ACPM records and clearly identified detection methods.</p>
          </div>
          <div class="ai-command-hero-actions">
            <span id="aiSystemStatus" class="ai-status-pill ai-status-deterministic">DETERMINISTIC INTELLIGENCE</span>
            <button id="aiRefreshBtn" class="btn-ws-secondary" type="button">Refresh</button>
            <button id="aiCommandBackBtn" class="btn-ws-back" type="button">Back</button>
          </div>
        </div>

        <div id="aiCommandNotice" class="ai-command-notice hidden" role="status"></div>

        <section class="ai-daily-brief" aria-labelledby="aiDailyBriefTitle">
          <div class="ai-daily-brief-head">
            <div><span class="ai-panel-kicker">Deterministic daily brief</span><h3 id="aiDailyBriefTitle">Operational Brief</h3></div>
            <span class="ai-rule-badge">Rule-based · no AI generation</span>
          </div>
          <div id="aiDailyBriefLines" class="ai-daily-brief-lines"></div>
        </section>

        <section class="ai-today-panel" aria-labelledby="aiTodayHeading">
          <span class="ai-panel-kicker">Today</span>
          <h3 id="aiTodayHeading">Everything looks on track.</h3>
          <p id="aiTodaySummary">No operational issues currently need your attention.</p>
        </section>

        <div class="ai-command-layout">
          <div class="ai-command-primary">
            <section class="ai-panel ai-needs-action-panel">
              <div class="ai-panel-head">
                <div><span class="ai-panel-kicker">System detected · rule-based</span><h3>Needs Action</h3></div>
                <span id="aiNeedsActionCount" class="ai-count-badge">0</span>
              </div>
              <div id="aiAttentionList" class="ai-card-list"></div>
            </section>

            <section class="ai-panel">
              <div class="ai-panel-head">
                <div><span class="ai-panel-kicker">Operational summary</span><h3>Projects</h3></div>
              </div>
              <div id="aiProjectSummary" class="ai-project-list"></div>
            </section>

            <section class="ai-panel ai-waiting-panel">
              <div class="ai-panel-head">
                <div><span class="ai-panel-kicker">Actual AI decisions · human judgment</span><h3>Waiting On You</h3></div>
                <span id="aiWaitingCount" class="ai-count-badge">0</span>
              </div>
              <div id="aiDecisionList" class="ai-card-list"></div>
            </section>

            <section class="ai-panel">
              <div class="ai-panel-head ai-panel-head-wrap">
                <div><span class="ai-panel-kicker">Generative analysis output</span><h3>Recommendations</h3></div>
                <div id="aiRecommendationFilters" class="ai-filter-group" aria-label="Recommendation status filters">
                  <button type="button" data-ai-filter="open" class="is-active">Open</button>
                  <button type="button" data-ai-filter="acknowledged">Acknowledged</button>
                  <button type="button" data-ai-filter="dismissed">Dismissed</button>
                </div>
              </div>
              <div id="aiRecommendationList" class="ai-card-list"></div>
            </section>
          </div>

          <aside class="ai-command-side ai-command-secondary">
            <section class="ai-panel">
              <div class="ai-panel-head"><div><span class="ai-panel-kicker">Recent record</span><h3>Activity</h3></div></div>
              <div id="aiRunActivity" class="ai-activity-list"></div>
            </section>
            <section class="ai-panel">
              <div class="ai-panel-head"><div><span class="ai-panel-kicker">Secondary</span><h3>System</h3></div></div>
              <div id="aiRuntimeHealth"></div>
            </section>
            <section class="ai-panel">
              <div class="ai-panel-head"><div><span class="ai-panel-kicker">Secondary</span><h3>Monitors &amp; Agents</h3></div></div>
              <div id="aiAgentStatus" class="ai-agent-grid" aria-label="Operational monitors and AI agents"></div>
            </section>
          </aside>
        </div>

        <div id="aiDecisionModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="aiDecisionModalTitle" data-escape-owner="ai">
          <div class="modal-box modal-wide ai-decision-modal">
            <div class="ai-modal-head">
              <div><span class="ai-panel-kicker">Waiting on you · human intent only</span><h3 id="aiDecisionModalTitle">Decision Detail</h3></div>
              <button id="aiDecisionModalClose" class="btn-ws-secondary" type="button">Close</button>
            </div>
            <div id="aiDecisionModalBody"></div>
          </div>
        </div>
      </section>
    `);

    el('aiCommandBackBtn').addEventListener('click', close);
    el('aiRefreshBtn').addEventListener('click', refresh);
    el('aiDecisionModalClose').addEventListener('click', closeDecision);
    el('aiDecisionModal').addEventListener('click', function (event) {
      if (event.target === el('aiDecisionModal')) closeDecision();
    });
    el('aiDecisionModalBody').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-decision-action]');
      if (button) submitDecision(button.dataset.aiDecisionAction);
    });
    el('aiRecommendationFilters').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-filter]');
      if (!button) return;
      state.filter = button.dataset.aiFilter;
      renderRecommendations();
    });
    el('aiRecommendationList').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-decision-history]');
      if (button) openDecision(button.dataset.aiDecisionHistory);
    });
    el('aiDecisionList').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-review]');
      if (button) openDecision(button.dataset.aiReview);
    });
    el('aiAttentionList').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-destination]');
      if (button) navigateToDestination(button.dataset.projectId, button.dataset.aiDestination);
    });
    el('aiProjectSummary').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-project-open]');
      if (button) navigateToDestination(button.dataset.aiProjectOpen, 'project');
    });
  }

  function removeView() {
    closeDecision();
    el('aiCommandCenterView')?.remove();
  }

  function initialize() {
    var request = ++state.gateRequest;
    stopOutputListeners();
    if (!isOfficePage() || !authorizedProfile()) {
      state.uiStatus = null;
      removeNavigation();
      removeView();
      return Promise.resolve(false);
    }

    return readUiStatus().then(function (uiStatus) {
      if (request !== state.gateRequest) return false;
      if (!uiStatus) {
        state.uiStatus = null;
        removeNavigation();
        removeView();
        return false;
      }
      state.uiStatus = uiStatus;
      ensureView();
      addNavigation();
      renderAll();
      return true;
    });
  }

  function visibleOfficeView() {
    var ids = ['workspaceView', 'hubView', 'pmosOfficeView', 'systemReportsView'];
    for (var i = 0; i < ids.length; i += 1) {
      var view = el(ids[i]);
      if (view && !view.classList.contains('hidden')) return ids[i];
    }
    return window.ACPM_PAGE === 'workspace' ? 'workspaceView' : 'hubView';
  }

  async function open() {
    if (!authorizedProfile()) return false;
    var uiStatus = await readUiStatus();
    if (!uiStatus) {
      state.uiStatus = null;
      removeNavigation();
      removeView();
      return false;
    }
    state.uiStatus = uiStatus;
    ensureView();
    addNavigation();
    state.previousViewId = visibleOfficeView();
    if (state.previousViewId === 'pmosOfficeView' && typeof window.deactivatePmosOffice === 'function') {
      window.deactivatePmosOffice();
    }
    ['hubView', 'workspaceView', 'pmosOfficeView', 'systemReportsView'].forEach(function (id) {
      el(id)?.classList.add('hidden');
    });
    el('aiCommandCenterView').classList.remove('hidden');
    state.active = true;
    startOutputListeners();
    return true;
  }

  function close() {
    stopOutputListeners();
    closeDecision();
    el('aiCommandCenterView')?.classList.add('hidden');
    state.active = false;
    if (state.previousViewId === 'pmosOfficeView' && typeof window.openPmosOffice === 'function') {
      window.openPmosOffice();
      return;
    }
    var previous = el(state.previousViewId);
    if (previous) previous.classList.remove('hidden');
    else el(window.ACPM_PAGE === 'workspace' ? 'workspaceView' : 'hubView')?.classList.remove('hidden');
  }

  async function refresh() {
    if (!state.active) return initialize();
    var uiStatus = await readUiStatus();
    if (!uiStatus) {
      close();
      state.uiStatus = null;
      removeNavigation();
      removeView();
      return false;
    }
    state.uiStatus = uiStatus;
    startOutputListeners();
    return true;
  }

  function cleanup() {
    ++state.gateRequest;
    clearTimeout(state.profileTimer);
    state.profileTimer = null;
    stopOutputListeners();
    closeDecision();
    state.uiStatus = null;
    state.authUid = '';
    removeNavigation();
    if (state.active) close();
    removeView();
  }

  function listenValue(key, reference, transform) {
    var onValue = function (snapshot) {
      delete state.errors[key];
      transform(snapshot);
      renderAll();
    };
    var onError = function () {
      state.errors[key] = true;
      renderAll();
    };
    reference.on('value', onValue, onError);
    state.listeners.push(function () { reference.off('value', onValue); });
  }

  function recentQuery(path, limit) {
    return database().ref(path).orderByChild('createdAt').limitToLast(limit);
  }

  function startOutputListeners() {
    stopOutputListeners();
    if (!state.active || !state.uiStatus || state.uiStatus.uiEnabled !== true || !authorizedProfile()) return;
    state.data = emptyData();
    state.errors = {};
    refreshOperationalData();
    renderAll();

    listenValue('runtimeStatus', database().ref('ai/runtimeStatus'), function (snapshot) {
      state.data.runtimeStatus = snapshot.exists() ? snapshot.val() : null;
    });
    listenValue('runs', recentQuery('ai/runs', LIMITS.runs), function (snapshot) {
      state.data.runs = snapshotRows(snapshot).sort(newestFirst);
    });
    listenValue('events', recentQuery('ai/events', LIMITS.events), function (snapshot) {
      state.data.events = rowsById(snapshotRows(snapshot));
    });
    listenValue('findings', database().ref('ai/findings').limitToLast(LIMITS.findings), function (snapshot) {
      state.data.findings = snapshot.exists() ? snapshot.val() || {} : {};
    });
    listenValue('recommendations', recentQuery('ai/recommendations', LIMITS.recommendations), function (snapshot) {
      state.data.recommendations = snapshotRows(snapshot).sort(newestFirst);
    });
    listenValue('decisions', recentQuery('ai/decisions', LIMITS.decisions), function (snapshot) {
      state.data.decisions = snapshotRows(snapshot).sort(oldestFirst);
    });
  }

  function refreshOperationalData() {
    var projects = typeof window.getAccessibleProjectSnapshots === 'function'
      ? window.getAccessibleProjectSnapshots()
      : [];
    state.data.projects = Array.isArray(projects) ? projects : [];
    if (!window.ACPMAttention) {
      state.data.attention = [];
      state.data.projectSummaries = [];
      return;
    }
    state.data.attention = window.ACPMAttention.derive(state.data.projects, { now: Date.now() });
    state.data.projectSummaries = window.ACPMAttention.summarizeProjects(state.data.projects, state.data.attention);
  }

  function stopOutputListeners() {
    state.listeners.splice(0).forEach(function (detach) {
      try { detach(); } catch (_) {}
    });
  }

  function newestFirst(a, b) {
    return numberTime(b.createdAt) - numberTime(a.createdAt);
  }

  function oldestFirst(a, b) {
    return numberTime(a.createdAt) - numberTime(b.createdAt);
  }

  function numberTime(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  function projectName(projectId) {
    var id = String(projectId || '').trim();
    if (!id) return 'Project unavailable';
    var loaded = state.data.projects.find(function (project) { return String(project.id || '') === id; });
    if (loaded && loaded.name) return String(loaded.name);
    var card = document.querySelector('.proj-card[data-pid="' + cssEscape(id) + '"] .proj-name');
    if (card && card.textContent.trim()) return card.textContent.trim();
    if (String(window._currentPid || '') === id) {
      var workspaceName = el('wsName');
      if (workspaceName && workspaceName.textContent.trim() && workspaceName.textContent.trim() !== '-') {
        return workspaceName.textContent.trim();
      }
    }
    return 'Project ' + id;
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return value.replace(/[^A-Za-z0-9_-]/g, '');
  }

  function statusText() {
    var status = state.uiStatus && state.uiStatus.systemStatus;
    return {
      ready: 'SYSTEM ONLINE',
      degraded: 'DEGRADED',
      not_configured: 'NOT CONFIGURED',
      disabled: 'DISABLED',
      unavailable: 'UNAVAILABLE'
    }[status] || 'DISABLED';
  }

  function statusClass() {
    return 'ai-status-' + String((state.uiStatus && state.uiStatus.systemStatus) || 'disabled').replace('_', '-');
  }

  function workingAgents() {
    var ids = {};
    state.data.runs.filter(function (run) { return run.status === 'running'; }).forEach(function (run) {
      (Array.isArray(run.requiredAgents) ? run.requiredAgents : []).forEach(function (id) {
        if (AGENTS.some(function (agent) { return agent.id === id; })) ids[id] = true;
      });
    });
    return ids;
  }

  function manilaDateKey(timestamp) {
    if (!timestamp) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date(timestamp));
    } catch (_) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }

  function renderAll() {
    if (!el('aiCommandCenterView')) return;
    var status = el('aiSystemStatus');
    status.textContent = 'DETERMINISTIC INTELLIGENCE';
    status.className = 'ai-status-pill ai-status-deterministic';
    renderNotice();
    renderDailyBrief();
    renderSummary();
    renderAttention();
    renderProjectSummaries();
    renderAgents();
    renderDecisions();
    renderRecommendations();
    renderRuntime();
    renderRuns();
  }

  function renderNotice() {
    var notice = el('aiCommandNotice');
    var errorKeys = Object.keys(state.errors);
    var runtime = state.data.runtimeStatus;
    var stale = runtime && numberTime(runtime.lastCheckedAt) > 0
      && Date.now() - numberTime(runtime.lastCheckedAt) > RUNTIME_STALE_MS;
    var message = '';
    var tone = 'info';
    if (errorKeys.length) {
      message = 'Some AI operational data could not be read. ACPM Office remains available; try Refresh when connectivity returns.';
      tone = 'danger';
    } else if ((state.uiStatus && state.uiStatus.systemStatus) === 'not_configured' || !runtime) {
      message = 'Advanced AI analysis is not configured. Rule-based operational monitoring remains available.';
      tone = 'info';
    } else if ((state.uiStatus && state.uiStatus.systemStatus) === 'degraded') {
      message = 'AI runtime health is degraded. Existing Office workflows are not affected.';
      tone = 'warning';
    } else if ((state.uiStatus && state.uiStatus.systemStatus) === 'unavailable') {
      message = 'AI runtime is currently unavailable. Existing Office workflows are not affected.';
      tone = 'danger';
    } else if (stale) {
      message = 'Runtime health has not been checked recently. Displayed records remain read-only.';
      tone = 'warning';
    }
    notice.className = message ? 'ai-command-notice ai-notice-' + tone : 'ai-command-notice hidden';
    notice.textContent = message;
  }

  function renderSummary() {
    var count = state.data.attention.length;
    el('aiTodayHeading').textContent = count
      ? count + ' thing' + (count === 1 ? ' needs' : 's need') + ' attention'
      : 'Everything looks on track.';
    el('aiTodaySummary').textContent = count
      ? 'Prioritized from current ACPM project records using deterministic business rules.'
      : 'No operational issues currently need your attention.';
  }

  function renderDailyBrief() {
    var container = el('aiDailyBriefLines');
    if (!container || !window.ACPMAttention || typeof window.ACPMAttention.buildDailyBrief !== 'function') return;
    var brief = window.ACPMAttention.buildDailyBrief(
      state.data.attention,
      state.data.projectSummaries,
      { now: Date.now() }
    );
    container.innerHTML = brief.lines.map(function (line) { return '<p>' + h(line) + '</p>'; }).join('');
    container.dataset.detectedBy = brief.detectedBy;
  }

  function actionLabel(destination) {
    return {
      attendance: 'Review Attendance', task: 'Open Task', materials: 'Open Materials',
      issue: 'Open Issue', project: 'Open Project'
    }[destination] || 'Open Project';
  }

  function ageLabel(item) {
    if (typeof item.age !== 'number') return '';
    return item.age === 0 ? 'Today' : item.age + ' day' + (item.age === 1 ? '' : 's') + ' old';
  }

  function renderAttention() {
    var items = state.data.attention;
    el('aiNeedsActionCount').textContent = String(items.length);
    if (!items.length) {
      el('aiAttentionList').innerHTML = emptyMarkup('No action needed', 'Everything looks on track. Rule-based monitoring found no current operational exceptions.');
      return;
    }
    el('aiAttentionList').innerHTML = items.map(function (item) {
      var meta = [item.projectName, ageLabel(item)].filter(Boolean).join(' · ');
      return '<article class="ai-attention-card ai-severity-border-' + h(item.severity) + '">' +
        '<div class="ai-card-meta"><span>' + h(meta) + '</span><span class="ai-severity ai-severity-' + h(item.severity) + '">' + h(item.severity) + '</span></div>' +
        '<div class="ai-detection-label">System detected · ' + h(item.category.replace(/_/g, ' ')) + '</div>' +
        '<h4>' + h(item.title) + '</h4><p>' + h(item.summary) + '</p>' +
        '<div class="ai-card-actions"><button type="button" class="btn-ws-secondary" data-project-id="' + h(item.projectId) + '" data-ai-destination="' + h(item.recommendedDestination) + '">' + h(actionLabel(item.recommendedDestination)) + '</button></div>' +
      '</article>';
    }).join('');
  }

  function renderProjectSummaries() {
    var summaries = state.data.projectSummaries;
    if (!summaries.length) {
      el('aiProjectSummary').innerHTML = emptyMarkup('No active projects available', 'Operational summaries use the project records already loaded by ACPM Office.');
      return;
    }
    el('aiProjectSummary').innerHTML = summaries.map(function (project) {
      var levels = ['critical', 'high', 'medium', 'low'].filter(function (level) { return project.counts[level]; })
        .map(function (level) { return project.counts[level] + ' ' + level.charAt(0).toUpperCase() + level.slice(1); });
      return '<article class="ai-project-row"><div><h4>' + h(project.projectName) + '</h4>' +
        (project.attentionCount
          ? '<p>' + h(project.attentionCount + ' attention item' + (project.attentionCount === 1 ? '' : 's')) + '</p><small>' + h(levels.join(' · ')) + '</small>'
          : '<p>No current attention items</p><small class="ai-on-track">On track</small>') +
        '</div><button type="button" class="btn-ws-secondary" data-ai-project-open="' + h(project.projectId) + '">Open Project</button></article>';
    }).join('');
  }

  function navigateToDestination(projectId, destination) {
    var destinationTabs = { attendance: 'labor', task: 'tasks', materials: 'materials', issue: 'defects', project: 'dashboard' };
    var tab = destinationTabs[destination];
    if (!tab || !projectId) return false;
    if (String(window._currentPid || '') === String(projectId) && el('workspaceView')) {
      close();
      if (tab === 'defects' && typeof toggleExtraTabs === 'function') toggleExtraTabs(true);
      if (typeof switchTab === 'function') switchTab(tab);
      return true;
    }
    var target = typeof appUrl === 'function'
      ? appUrl('workspace', { projectId: projectId, tab: tab })
      : '/workspace.html?projectId=' + encodeURIComponent(projectId) + '&tab=' + encodeURIComponent(tab);
    window.location.href = target;
    return true;
  }

  function agentState(agentId) {
    var system = state.uiStatus && state.uiStatus.systemStatus;
    var providerOff = system === 'disabled' || system === 'unavailable' || system === 'not_configured';
    if (agentId === 'pm') {
      if (providerOff) return { label: 'Advanced analysis unavailable', className: 'unavailable' };
      if (system === 'degraded') return { label: 'Advanced analysis degraded', className: 'degraded' };
      return workingAgents()[agentId]
        ? { label: 'Advanced analysis working', className: 'working' }
        : { label: 'Advanced analysis available', className: 'idle' };
    }
    if (!providerOff && workingAgents()[agentId]) return { label: 'Advanced analysis working', className: 'working' };
    return { label: 'Rule-based monitoring active', className: 'monitoring' };
  }

  function renderAgents() {
    el('aiAgentStatus').innerHTML = AGENTS.map(function (agent) {
      var current = agentState(agent.id);
      return '<article class="ai-agent-card"><div class="ai-agent-icon" aria-hidden="true">' + (agent.id === 'pm' ? 'AI' : 'OP') + '</div><div><h3>' + h(agent.label) + '</h3><p>' + h(agent.description) + '</p></div><span class="ai-agent-state ai-agent-' + h(current.className) + '"><i></i>' + h(current.label) + '</span></article>';
    }).join('');
  }

  function recommendationForDecision(decision) {
    return state.data.recommendations.find(function (item) {
      return item.id === decision.recommendationId || item.decisionId === decision.id;
    }) || null;
  }

  function impactStatus(impact) {
    var allowed = ['unknown', 'none', 'possible', 'confirmed'];
    var status = impact && allowed.indexOf(impact.status) !== -1 ? impact.status : 'unknown';
    return status;
  }

  function impactMarkup(label, impact, type) {
    var current = impactStatus(impact);
    var display = current.charAt(0).toUpperCase() + current.slice(1);
    var detail = '';
    if ((current === 'possible' || current === 'confirmed') && type === 'schedule'
        && typeof impact.days === 'number' && Number.isFinite(impact.days)) {
      detail = impact.days + (impact.days === 1 ? ' day' : ' days');
    }
    if ((current === 'possible' || current === 'confirmed') && type === 'cost'
        && typeof impact.amount === 'number' && Number.isFinite(impact.amount)) {
      detail = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(impact.amount);
    }
    return '<div class="ai-impact"><span>' + h(label) + '</span><strong class="ai-impact-' + current + '">' + h(display) + '</strong>' + (detail ? '<small>' + h(detail) + '</small>' : '') + '</div>';
  }

  function severity(value) {
    var normalized = String(value || 'info').toLowerCase();
    return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, normalized) ? normalized : 'info';
  }

  function firstAction(recommendation) {
    var actions = recommendation && Array.isArray(recommendation.recommendedActions)
      ? recommendation.recommendedActions.filter(function (item) { return typeof item === 'string' && item.trim(); })
      : [];
    return actions[0] || 'No validated action was provided.';
  }

  function renderDecisions() {
    var decisions = state.data.decisions.filter(function (item) { return item.status === 'open'; });
    decisions.sort(function (a, b) {
      var severityDifference = SEVERITY_RANK[severity(recommendationForDecision(b)?.severity)]
        - SEVERITY_RANK[severity(recommendationForDecision(a)?.severity)];
      return severityDifference || oldestFirst(a, b);
    });
    el('aiWaitingCount').textContent = String(decisions.length);
    if (!decisions.length) {
      el('aiDecisionList').innerHTML = emptyMarkup('No decisions are waiting', 'Open human decisions will appear here after validated AI review.');
      return;
    }
    el('aiDecisionList').innerHTML = decisions.map(function (decision) {
      var recommendation = recommendationForDecision(decision) || {};
      var level = severity(recommendation.severity);
      return '<article class="ai-review-card ai-severity-border-' + level + '">' +
        '<div class="ai-card-meta"><span>' + h(projectName(decision.projectId || recommendation.projectId)) + '</span><span class="ai-severity ai-severity-' + level + '">' + h(level) + '</span></div>' +
        '<h4>' + h(recommendation.title || 'Human decision required') + '</h4>' +
        '<p>' + h(recommendation.summary || decision.question || 'No validated summary was provided.') + '</p>' +
        '<div class="ai-impact-row">' + impactMarkup('Schedule impact', recommendation.scheduleImpact, 'schedule') + impactMarkup('Cost impact', recommendation.costImpact, 'cost') + '</div>' +
        '<div class="ai-recommended"><span>Recommended action</span><strong>' + h(firstAction(recommendation)) + '</strong></div>' +
        '<div class="ai-card-actions"><button type="button" class="btn-ws-secondary" data-ai-review="' + h(decision.id) + '">Review</button></div>' +
      '</article>';
    }).join('');
  }

  function renderRecommendations() {
    var filters = el('aiRecommendationFilters');
    filters.querySelectorAll('[data-ai-filter]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.aiFilter === state.filter);
    });
    var recommendations = state.data.recommendations.filter(function (item) {
      return String(item.status || 'open').toLowerCase() === state.filter;
    });
    if (!recommendations.length) {
      el('aiRecommendationList').innerHTML = emptyMarkup('No ' + state.filter + ' recommendations', 'Validated recommendations for this filter will appear here.');
      return;
    }
    el('aiRecommendationList').innerHTML = recommendations.map(function (recommendation) {
      var level = severity(recommendation.severity);
      var actions = Array.isArray(recommendation.recommendedActions) ? recommendation.recommendedActions : [];
      var linkedDecision = state.data.decisions.find(function (decision) {
        return decision.id === recommendation.decisionId || decision.recommendationId === recommendation.id;
      });
      var historyAction = linkedDecision && linkedDecision.status !== 'open'
        ? '<div class="ai-card-actions"><button type="button" class="btn-ws-secondary" data-ai-decision-history="' + h(linkedDecision.id) + '">View recorded decision</button></div>'
        : '';
      return '<article class="ai-recommendation-card ai-severity-border-' + level + '">' +
        '<div class="ai-card-meta"><span>' + h(projectName(recommendation.projectId)) + '</span><span class="ai-severity ai-severity-' + level + '">' + h(level) + '</span></div>' +
        '<h4>' + h(recommendation.title || 'AI recommendation') + '</h4><p>' + h(recommendation.summary || 'No validated summary was provided.') + '</p>' +
        '<div class="ai-impact-row">' + impactMarkup('Schedule impact', recommendation.scheduleImpact, 'schedule') + impactMarkup('Cost impact', recommendation.costImpact, 'cost') + '</div>' +
        (actions.length ? '<ul class="ai-action-list">' + actions.map(function (action) { return '<li>' + h(action) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="ai-card-foot"><span>' + h(formatWhen(recommendation.createdAt)) + '</span>' +
          (recommendation.needsHumanDecision ? '<span class="ai-human-indicator">Human decision required</span>' : '<span>Informational</span>') + '</div>' +
        historyAction +
      '</article>';
    }).join('');
  }

  function providerLabel(alias) {
    return alias === 'openai' ? 'OpenAI' : 'AI Provider';
  }

  function runtimeLabel(status) {
    return { healthy: 'Healthy', degraded: 'Degraded', unavailable: 'Unavailable', not_configured: 'Not configured' }[status] || 'Not configured';
  }

  function renderRuntime() {
    var runtime = state.data.runtimeStatus;
    var configured = runtime && (state.uiStatus && state.uiStatus.systemStatus) !== 'not_configured';
    var advanced = configured ? runtimeLabel(runtime.status) : 'Not configured';
    var stale = runtime && numberTime(runtime.lastCheckedAt) > 0 && Date.now() - numberTime(runtime.lastCheckedAt) > RUNTIME_STALE_MS;
    el('aiRuntimeHealth').innerHTML = '<div class="ai-system-list">' +
      '<div><span>Operational monitoring</span><strong class="ai-on-track">Available</strong><small>Deterministic rules · no provider required</small></div>' +
      '<div><span>Advanced AI analysis</span><strong>' + h(advanced) + '</strong><small>' +
        (configured ? (stale ? 'Provider status is stale' : h(providerLabel(runtime.providerAlias)) + ' · ' + h(formatWhen(runtime.lastCheckedAt))) : 'Optional provider enhancement') +
      '</small></div></div>';
  }

  function agentNames(run) {
    var ids = Array.isArray(run.requiredAgents) ? run.requiredAgents : [];
    var labels = ids.map(function (id) {
      var agent = AGENTS.find(function (item) { return item.id === id; });
      return agent ? agent.label : null;
    }).filter(Boolean);
    return labels.length ? labels.join(', ') : 'AI Operations';
  }

  function safeErrorLabel(code) {
    return {
      provider_timeout: 'Provider timed out',
      provider_rate_limited: 'Provider temporarily busy',
      provider_unavailable: 'Provider unavailable',
      provider_auth_failed: 'Provider not configured',
      provider_bad_request: 'Request could not be processed',
      provider_invalid_output: 'Output validation failed',
      provider_unknown_error: 'Provider run failed'
    }[code] || '';
  }

  function findingSummary(runId) {
    var findings = state.data.findings && state.data.findings[runId];
    if (!findings || typeof findings !== 'object') return '';
    var finding = findings.pm || findings.planning || findings.materials;
    return finding && typeof finding.summary === 'string' ? finding.summary : '';
  }

  function eventLabel(run) {
    var event = state.data.events[run.eventId] || {};
    var type = event.eventType || run.eventType || '';
    if (!type) return 'AI analysis run';
    return String(type).replace(/_/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function renderRuns() {
    var runs = state.data.runs.slice(0, 20);
    if (!runs.length) {
      el('aiRunActivity').innerHTML = emptyMarkup('No recent runs', 'Bounded AI run activity will appear here.');
      return;
    }
    el('aiRunActivity').innerHTML = runs.map(function (run) {
      var summary = findingSummary(run.id);
      var error = safeErrorLabel(run.safeErrorCode);
      return '<article class="ai-activity-item"><div class="ai-activity-dot ai-run-' + h(String(run.status || 'queued').toLowerCase()) + '"></div><div>' +
        '<div class="ai-activity-head"><strong>' + h(agentNames(run)) + '</strong><span>' + h(formatWhen(run.createdAt)) + '</span></div>' +
        '<p>' + h(eventLabel(run)) + ' · ' + h(projectName(run.projectId)) + '</p>' +
        (summary ? '<small>' + h(summary) + '</small>' : '') +
        (error ? '<small class="ai-safe-error">' + h(error) + '</small>' : '') +
      '</div></article>';
    }).join('');
  }

  function evidenceRefs(recommendation, findings) {
    var refs = [];
    function add(items) {
      (Array.isArray(items) ? items : []).forEach(function (item) {
        if (!item || typeof item.path !== 'string' || typeof item.recordId !== 'string' || typeof item.field !== 'string') return;
        var key = item.path + '|' + item.recordId + '|' + item.field;
        if (!refs.some(function (existing) { return existing.key === key; })) refs.push({ key: key, item: item });
      });
    }
    add(recommendation && recommendation.evidenceRefs);
    Object.keys(findings || {}).forEach(function (agentId) {
      var finding = findings[agentId] || {};
      (Array.isArray(finding.facts) ? finding.facts : []).forEach(function (fact) { add(fact.evidenceRefs); });
      add(finding.scheduleImpact && finding.scheduleImpact.evidenceRefs);
      add(finding.costImpact && finding.costImpact.evidenceRefs);
    });
    return refs.map(function (entry) { return entry.item; });
  }

  function evidenceMarkup(refs) {
    if (!refs.length) return '<p class="ai-empty-inline">No validated evidence references were provided.</p>';
    return '<ul class="ai-evidence-list">' + refs.map(function (ref) {
      var path = ref.path.replace(/\/+$/, '');
      var fullPath = path.endsWith('/' + ref.recordId) ? path : path + '/' + ref.recordId;
      return '<li><code>' + h(fullPath) + '</code><span aria-hidden="true">→</span><strong>' + h(ref.field) + '</strong></li>';
    }).join('') + '</ul>';
  }

  function findingBlock(label, finding) {
    return '<section class="ai-detail-section"><h4>' + h(label) + '</h4>' +
      (finding && typeof finding.summary === 'string'
        ? '<p>' + h(finding.summary) + '</p>'
        : '<p class="ai-empty-inline">No validated finding was provided.</p>') + '</section>';
  }

  function decisionOptions(decision) {
    return (Array.isArray(decision.options) ? decision.options : [])
      .filter(function (item) { return typeof item === 'string' && item.trim(); })
      .slice(0, 20);
  }

  function decisionStatusMarkup(decision) {
    if (decision.status === 'resolved') {
      return '<section class="ai-decision-result ai-decision-result-resolved" data-ai-decision-result="resolved">' +
        '<span>Resolved</span><h4>Selected: ' + h(decision.resolution || 'Recorded option unavailable') + '</h4>' +
        '<p>Resolved by: ' + h(decision.resolvedByRole || 'authorized manager') + '</p>' +
        '<p>Resolved at: ' + h(formatWhen(decision.resolvedAt)) + '</p>' +
        (decision.resolutionNotes ? '<p>Note: ' + h(decision.resolutionNotes) + '</p>' : '') +
        '<small>This records human intent only. No business action was performed.</small></section>';
    }
    if (decision.status === 'dismissed') {
      return '<section class="ai-decision-result ai-decision-result-dismissed" data-ai-decision-result="dismissed">' +
        '<span>Dismissed</span><p>Resolved by: ' + h(decision.resolvedByRole || 'authorized manager') + '</p>' +
        '<p>Resolved at: ' + h(formatWhen(decision.resolvedAt)) + '</p>' +
        (decision.resolutionNotes ? '<p>Note: ' + h(decision.resolutionNotes) + '</p>' : '') +
        '<small>No decision or business action is required from this recommendation.</small></section>';
    }
    return '';
  }

  function decisionControlsMarkup(decision) {
    var options = decisionOptions(decision);
    var deferred = decision.deferredAt
      ? '<div class="ai-deferred-note" data-ai-decision-result="deferred"><strong>Deferred</strong><span>By ' + h(decision.deferredByRole || 'authorized manager') + ' · ' + h(formatWhen(decision.deferredAt)) + '</span></div>'
      : '';
    var optionMarkup = options.length
      ? '<fieldset class="ai-decision-options"><legend>Choose one stored option</legend>' + options.map(function (item, index) {
          return '<label><input type="radio" name="aiDecisionOption" value="' + index + '"><span>' + h(item) + '</span></label>';
        }).join('') + '</fieldset>'
      : '<p class="ai-empty-inline">No structured options were provided. You may defer or dismiss this decision.</p>';
    return deferred + '<section class="ai-decision-controls" data-ai-decision-id="' + h(decision.id) + '">' +
      optionMarkup +
      '<label class="ai-decision-note"><span>Optional note</span><textarea id="aiDecisionNote" maxlength="500" rows="3" placeholder="Add a short plain-text note"></textarea><small>Maximum 500 characters. Notes are recorded as user data, not AI instructions.</small></label>' +
      '<div id="aiDecisionSubmitState" class="ai-decision-submit-state" role="status" aria-live="polite"></div>' +
      '<div class="ai-decision-actions">' +
        '<button type="button" class="btn-ws-primary" data-ai-decision-action="choose"' + (options.length ? '' : ' disabled') + '>Submit Decision</button>' +
        '<button type="button" class="btn-ws-secondary" data-ai-decision-action="defer">Defer</button>' +
        '<button type="button" class="btn-ws-secondary ai-dismiss-button" data-ai-decision-action="dismiss">Dismiss</button>' +
      '</div><p class="ai-intent-boundary">Records human intent only. It does not update tasks, purchases, schedules, billing, payments, or messages.</p></section>';
  }

  function renderDecisionDetail(decision) {
    var recommendation = recommendationForDecision(decision) || {};
    var findings = state.data.findings[decision.runId || recommendation.runId] || {};
    var refs = evidenceRefs(recommendation, findings);
    var actions = Array.isArray(recommendation.recommendedActions) ? recommendation.recommendedActions : [];
    el('aiDecisionModalBody').innerHTML =
      '<section class="ai-detail-section"><h4>Issue</h4><h3>' + h(recommendation.title || 'Human decision required') + '</h3><p>' + h(recommendation.summary || 'No validated issue summary was provided.') + '</p></section>' +
      '<section class="ai-detail-section"><h4>Evidence</h4>' + evidenceMarkup(refs) + '</section>' +
      findingBlock('Materials Finding', findings.materials) +
      findingBlock('Planning Finding', findings.planning) +
      findingBlock('PM Recommendation', findings.pm) +
      '<section class="ai-detail-section"><h4>Impacts</h4><div class="ai-impact-row">' + impactMarkup('Schedule impact', recommendation.scheduleImpact, 'schedule') + impactMarkup('Cost impact', recommendation.costImpact, 'cost') + '</div></section>' +
      '<section class="ai-detail-section"><h4>Recommendation</h4>' + (actions.length ? '<ul class="ai-action-list">' + actions.map(function (item) { return '<li>' + h(item) + '</li>'; }).join('') + '</ul>' : '<p class="ai-empty-inline">No validated action was provided.</p>') + '</section>' +
      '<section class="ai-detail-section"><h4>Question</h4><p>' + h(decision.question || 'No decision question was provided.') + '</p></section>' +
      (decision.status === 'resolved' || decision.status === 'dismissed'
        ? decisionStatusMarkup(decision)
        : decisionControlsMarkup(decision));
  }

  function openDecision(decisionId) {
    var decision = state.data.decisions.find(function (item) { return item.id === decisionId; });
    if (!decision) return;
    state.decisionReturnFocus = document.activeElement;
    state.pendingDecisionSubmission = null;
    renderDecisionDetail(decision);
    el('aiDecisionModal').classList.remove('hidden');
    el('aiDecisionModal').setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { el('aiDecisionModalClose')?.focus(); });
  }

  function closeDecision() {
    var modal = el('aiDecisionModal');
    var wasOpen = modal && !modal.classList.contains('hidden');
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    if (wasOpen && state.decisionReturnFocus && state.decisionReturnFocus.isConnected) {
      state.decisionReturnFocus.focus();
    }
    state.decisionReturnFocus = null;
    state.pendingDecisionSubmission = null;
  }

  function callableService() {
    if (!window.firebase) return null;
    try {
      var app = typeof firebase.app === 'function' ? firebase.app() : null;
      if (app && typeof app.functions === 'function') return app.functions('asia-southeast1');
      if (typeof firebase.functions === 'function') return firebase.functions('asia-southeast1');
    } catch (_) {}
    return null;
  }

  function submissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'decision-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  function decisionFailureMessage(error) {
    var safeCode = String(error && error.message || '').split(/\s+/).pop();
    var code = String(error && error.code || '').replace(/^functions\//, '');
    return {
      unauthenticated: 'Your session expired. Sign in and try again.',
      inactive_user: 'Your account is not active.',
      unauthorized_role: 'Your role cannot submit AI decisions.',
      invalid_decision_request: 'The decision request is invalid. Review it and try again.',
      invalid_option: 'That option is no longer available. Refresh and review the decision.',
      decision_not_found: 'This decision is no longer available.',
      decision_malformed: 'This decision cannot be safely processed.',
      invalid_decision_relationship: 'The linked AI records could not be validated.',
      stale_decision: 'This decision changed. Refresh before submitting.',
      decision_already_resolved: 'Another manager already resolved this decision.',
      duplicate_request_conflict: 'This submission could not be safely retried.',
      decision_transaction_failed: 'The decision could not be saved. Please try again.',
      unavailable: 'The decision service is currently unavailable.'
    }[safeCode] || ({
      unauthenticated: 'Your session expired. Sign in and try again.',
      'permission-denied': 'You are not authorized to submit this decision.',
      unavailable: 'The decision service is currently unavailable.'
    }[code] || 'The decision could not be submitted. No changes were made.');
  }

  function setDecisionSubmitting(submitting) {
    state.decisionSubmitting = submitting;
    document.querySelectorAll('#aiDecisionModalBody [data-ai-decision-action], #aiDecisionModalBody input, #aiDecisionModalBody textarea')
      .forEach(function (control) {
        var unavailableChoice = control.dataset && control.dataset.aiDecisionAction === 'choose'
          && !document.querySelector('#aiDecisionModalBody input[name="aiDecisionOption"]');
        control.disabled = submitting || unavailableChoice;
      });
    var closeButton = el('aiDecisionModalClose');
    if (closeButton) closeButton.disabled = submitting;
  }

  function mergeDecisionResult(decisionId, result) {
    var index = state.data.decisions.findIndex(function (item) { return item.id === decisionId; });
    if (index === -1) return null;
    state.data.decisions[index] = Object.assign({}, state.data.decisions[index], result, { id: decisionId });
    return state.data.decisions[index];
  }

  async function submitDecision(action) {
    if (state.decisionSubmitting || ['choose', 'defer', 'dismiss'].indexOf(action) === -1) return;
    var controls = document.querySelector('#aiDecisionModalBody [data-ai-decision-id]');
    var decisionId = controls && controls.dataset.aiDecisionId;
    var decision = state.data.decisions.find(function (item) { return item.id === decisionId; });
    if (!decision || decision.status !== 'open') return;
    var options = decisionOptions(decision);
    var selected = document.querySelector('#aiDecisionModalBody input[name="aiDecisionOption"]:checked');
    var selectedOptionId = action === 'choose' && selected ? options[Number(selected.value)] : undefined;
    var status = el('aiDecisionSubmitState');
    if (action === 'choose' && !selectedOptionId) {
      if (status) status.textContent = 'Choose one option before submitting.';
      return;
    }
    var notes = String(el('aiDecisionNote')?.value || '').trim();
    var signature = [decision.id, action, selectedOptionId || '', notes].join('|');
    if (!state.pendingDecisionSubmission || state.pendingDecisionSubmission.signature !== signature) {
      state.pendingDecisionSubmission = { signature: signature, id: submissionId() };
    }
    var service = callableService();
    if (!service || typeof service.httpsCallable !== 'function') {
      if (status) status.textContent = 'The decision service is currently unavailable.';
      return;
    }
    setDecisionSubmitting(true);
    if (status) status.textContent = 'Recording human intent…';
    try {
      var callable = service.httpsCallable('submitAiDecision');
      var response = await callable({
        decisionId: decision.id,
        submissionId: state.pendingDecisionSubmission.id,
        action: action,
        ...(selectedOptionId ? { selectedOptionId: selectedOptionId } : {}),
        ...(notes ? { notes: notes } : {}),
        expectedCreatedAt: decision.createdAt
      });
      var result = response && response.data;
      if (!result || result.decisionId !== decision.id || ['open', 'resolved', 'dismissed'].indexOf(result.status) === -1) {
        throw { code: 'functions/internal', message: 'decision_submission_failed' };
      }
      state.pendingDecisionSubmission = null;
      var updated = mergeDecisionResult(decision.id, result);
      renderAll();
      if (updated && el('aiDecisionModal') && !el('aiDecisionModal').classList.contains('hidden')) {
        renderDecisionDetail(updated);
        var success = el('aiDecisionSubmitState');
        if (success) success.textContent = action === 'defer'
          ? 'Decision deferred. It remains open.'
          : 'Decision recorded. No business action was taken.';
      }
    } catch (error) {
      if (status) status.textContent = decisionFailureMessage(error);
    } finally {
      setDecisionSubmitting(false);
    }
  }

  function emptyMarkup(title, description) {
    return '<div class="ai-empty-state"><div aria-hidden="true">OP</div><strong>' + h(title) + '</strong><p>' + h(description) + '</p></div>';
  }

  function formatWhen(timestamp) {
    var value = numberTime(timestamp);
    if (!value) return 'Time unavailable';
    try {
      return new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(new Date(value));
    } catch (_) {
      return new Date(value).toLocaleString();
    }
  }

  function waitForProfile(user, attempt) {
    clearTimeout(state.profileTimer);
    if (!user) {
      cleanup();
      return;
    }
    var profile = window._currentUser || {};
    if (profile.uid === user.uid && profile.status) {
      if (state.authUid && state.authUid !== user.uid) cleanup();
      state.authUid = user.uid;
      initialize();
      return;
    }
    if (attempt >= 50) {
      cleanup();
      return;
    }
    state.profileTimer = setTimeout(function () { waitForProfile(user, attempt + 1); }, 100);
  }

  function observeAuth() {
    if (!isOfficePage() || state.authUnsubscribe || !window.firebase || !firebase.auth) return;
    state.authUnsubscribe = firebase.auth().onAuthStateChanged(function (user) {
      stopOutputListeners();
      waitForProfile(user, 0);
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (el('aiDecisionModal') && !el('aiDecisionModal').classList.contains('hidden')) {
      event.preventDefault();
      event.stopPropagation();
      closeDecision();
      return;
    }
    if (state.active) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });

  window.addEventListener('acpm:accessible-projects', function () {
    refreshOperationalData();
    if (state.active) renderAll();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeAuth);
  else observeAuth();

  window.initializeAiCommandCenter = initialize;
  window.openAiCommandCenter = open;
  window.closeAiCommandCenter = close;
  window.cleanupAiCommandCenter = cleanup;
  window.refreshAiCommandCenter = refresh;
  window.getAiCommandCenterDiagnostics = function () {
    return {
      active: state.active,
      uiEnabled: !!(state.uiStatus && state.uiStatus.uiEnabled),
      listenerCount: state.listeners.length,
      operationalProjectCount: state.data.projects.length,
      attentionCount: state.data.attention.length,
      role: normalizedRole()
    };
  };
})();
