(function () {
  'use strict';

  var MANAGEMENT_ROLES = ['boss', 'owner', 'admin', 'pm'];
  var AGENTS = [
    { id: 'pm', label: 'PM Agent', description: 'Company synthesis, recommendations, and decision framing.' },
    { id: 'planning', label: 'Planning Monitor', description: 'Tasks, deadlines, blocked work, and verification.' },
    { id: 'materials', label: 'Materials Monitor', description: 'Requests, quantities, and partial deliveries.' },
    { id: 'site', label: 'Site / QA Monitor', description: 'Open and aging site concerns and punch signals.' }
  ];
  var LIMITS = { runs: 100, events: 100, findings: 60, recommendations: 100, decisions: 100, actionDrafts: 100, actionDraftEvents: 100 };
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
    draftReturnFocus: null,
    draftSubmitting: false,
    pendingDraftSubmission: null,
    section: 'overview',
    selectedProjectId: '',
    lastAnswer: null,
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
      actionDrafts: [],
      actionDraftEvents: [],
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
            <div class="ws-kicker">AI operations team · construction intelligence</div>
            <h2 id="aiCommandTitle">AI Command Center</h2>
            <p>Your company operations room for grounded project signals, specialized monitors, management decisions, and read-only questions.</p>
          </div>
          <div class="ai-command-hero-actions">
            <span id="aiSystemStatus" class="ai-status-pill ai-status-deterministic">DETERMINISTIC INTELLIGENCE</span>
            <button id="aiRefreshBtn" class="btn-ws-secondary" type="button">Refresh</button>
            <button id="aiCommandBackBtn" class="btn-ws-back" type="button">Back</button>
          </div>
        </div>

        <div id="aiCommandNotice" class="ai-command-notice hidden" role="status"></div>

        <nav id="aiCommandSections" class="ai-v2-nav" aria-label="Command Center sections">
          <button type="button" class="is-active" data-ai-v2-section="overview">Overview</button>
          <button type="button" data-ai-v2-section="projects">Projects</button>
          <button type="button" data-ai-v2-section="team">AI Team</button>
          <button type="button" data-ai-v2-section="activity">Activity</button>
        </nav>

        <div data-ai-v2-panel="overview" tabindex="-1">
        <section class="ai-company-pulse" aria-labelledby="aiCompanyPulseTitle">
          <div class="ai-panel-head ai-company-pulse-head">
            <div><span class="ai-panel-kicker">Company-wide operational picture</span><h3 id="aiCompanyPulseTitle">Company Pulse</h3></div>
            <span class="ai-truth-label">Grounded in current ACPM records</span>
          </div>
          <div id="aiCompanyPulseMetrics" class="ai-pulse-metrics" aria-label="Company pulse metrics"></div>
          <p id="aiCompanyPulseMeta" class="ai-pulse-meta"></p>
          <div id="aiCompanyPriority" class="ai-company-priority"></div>
          <div class="ai-daily-brief" aria-labelledby="aiDailyBriefTitle">
            <div class="ai-daily-brief-head">
              <div><span class="ai-panel-kicker">Deterministic daily brief</span><h3 id="aiDailyBriefTitle">Daily Brief</h3></div>
              <span class="ai-rule-badge">Rule-based · no AI generation</span>
            </div>
            <div id="aiDailyBriefLines" class="ai-daily-brief-lines"></div>
          </div>
        </section>

        <section class="ai-panel ai-ask-panel" aria-labelledby="aiAskTitle">
          <div class="ai-panel-head">
            <div><span class="ai-panel-kicker">Ask Command Center</span><h3 id="aiAskTitle">Ask your ACPM operations team</h3></div>
            <span class="ai-rule-badge">Deterministic answers</span>
          </div>
          <form id="aiAskForm" class="ai-ask-form">
            <label for="aiAskInput">What would you like to understand?</label>
            <div class="ai-ask-input-row"><input id="aiAskInput" type="text" maxlength="240" autocomplete="off" placeholder="Ano kailangan kong unahin ngayon?"><button type="submit" class="btn-ws-primary">Ask</button></div>
            <p>Read-only answers from current ACPM records. Questions never become commands.</p>
          </form>
          <div class="ai-ask-suggestions" aria-label="Suggested questions">
            <button type="button" data-ai-question="Which project needs the most attention?">Company priority</button>
            <button type="button" data-ai-question="Show blocked tasks.">Blocked tasks</button>
            <button type="button" data-ai-question="May pending deliveries ba?">Pending deliveries</button>
            <button type="button" data-ai-question="What changed today?">What changed</button>
          </div>
          <div id="aiAskAnswer" class="ai-ask-answer hidden" aria-live="polite"></div>
        </section>

        <section class="ai-management-overview" aria-labelledby="aiTodayHeading">
          <div class="ai-management-heading">
            <div><span class="ai-panel-kicker">Management attention</span><h3 id="aiTodayHeading">Everything looks on track.</h3></div>
            <p id="aiTodaySummary">No operational issues currently need your attention.</p>
          </div>
          <div class="ai-command-layout ai-management-layout">
            <section class="ai-panel ai-waiting-panel">
              <div class="ai-panel-head">
                <div><span class="ai-panel-kicker">Human judgment</span><h3>Waiting On You</h3></div>
                <span id="aiWaitingCount" class="ai-count-badge">0</span>
              </div>
              <div id="aiDecisionList" class="ai-card-list ai-decision-list"></div>
            </section>
            <section class="ai-panel ai-needs-action-panel">
              <div class="ai-panel-head">
                <div><span class="ai-panel-kicker">System detected · rule-based</span><h3>Operations Attention</h3></div>
                <span id="aiNeedsActionCount" class="ai-count-badge">0</span>
              </div>
              <div id="aiAttentionList" class="ai-card-list"></div>
            </section>
          </div>
        </section>

        <div class="ai-overview-intelligence-grid">
          <section class="ai-panel ai-overview-team" aria-labelledby="aiTeamPreviewTitle">
            <div class="ai-panel-head">
              <div><span class="ai-panel-kicker">Coordinated operations team</span><h3 id="aiTeamPreviewTitle">AI Team</h3></div>
              <button type="button" class="ai-text-button" data-ai-v2-jump="team">View team</button>
            </div>
            <div id="aiTeamPreview" class="ai-team-preview"></div>
          </section>
          <section class="ai-panel ai-overview-activity" aria-labelledby="aiActivityPreviewTitle">
            <div class="ai-panel-head">
              <div><span class="ai-panel-kicker">Latest grounded signals</span><h3 id="aiActivityPreviewTitle">Recent Intelligence</h3></div>
              <button type="button" class="ai-text-button" data-ai-v2-jump="activity">View activity</button>
            </div>
            <div id="aiActivityPreview" class="ai-activity-preview"></div>
          </section>
        </div>

        <section class="ai-panel ai-overview-projects" aria-labelledby="aiProjectsPreviewTitle">
          <div class="ai-panel-head">
            <div><span class="ai-panel-kicker">Where attention is concentrated</span><h3 id="aiProjectsPreviewTitle">Project Intelligence</h3></div>
            <button type="button" class="ai-text-button" data-ai-v2-jump="projects">View projects</button>
          </div>
          <div id="aiProjectSummary" class="ai-project-list"></div>
        </section>

        <details id="aiSupportingWorkflows" class="ai-overview-disclosure ai-supporting-workflows">
          <summary><span>Supporting workflows</span><small>Recommendations and review-only action drafts</small></summary>
          <div class="ai-secondary-workflow-grid">
            <section class="ai-panel ai-action-drafts-panel" aria-labelledby="aiActionDraftsTitle">
              <div class="ai-panel-head">
                <div><span class="ai-panel-kicker">Human-approved intent · no execution</span><h3 id="aiActionDraftsTitle">Action Drafts</h3></div>
                <span id="aiActionDraftCount" class="ai-count-badge">0</span>
              </div>
              <div id="aiActionDraftList" class="ai-card-list"></div>
            </section>
            <section class="ai-panel">
              <div class="ai-panel-head ai-panel-head-wrap">
                <div><span class="ai-panel-kicker">Current and recorded guidance</span><h3>Recommendations</h3></div>
                <div id="aiRecommendationFilters" class="ai-filter-group" aria-label="Recommendation status filters">
                  <button type="button" data-ai-filter="open" class="is-active">Open</button>
                  <button type="button" data-ai-filter="acknowledged">Acknowledged</button>
                  <button type="button" data-ai-filter="dismissed">Dismissed</button>
                </div>
              </div>
              <div id="aiRecommendationList" class="ai-card-list"></div>
            </section>
          </div>
        </details>

        <details class="ai-overview-disclosure ai-system-disclosure">
          <summary><span>System status</span><small>Operational monitoring and optional advanced analysis</small></summary>
          <div id="aiRuntimeHealth"></div>
        </details>
        </div>

        <section id="aiV2ProjectsPanel" class="ai-v2-section hidden" data-ai-v2-panel="projects" aria-labelledby="aiV2ProjectsTitle" tabindex="-1">
          <div class="ai-v2-section-head"><div><span class="ai-panel-kicker">Project drill-down</span><h3 id="aiV2ProjectsTitle">Project Intelligence</h3></div><p>Current attention, domain signals, management items, and recent intelligence—without invented health scores.</p></div>
          <div class="ai-v2-project-layout"><div id="aiV2ProjectGrid" class="ai-v2-project-grid"></div><div id="aiProjectIntelligence" class="ai-project-intelligence"></div></div>
        </section>

        <section id="aiV2TeamPanel" class="ai-v2-section hidden" data-ai-v2-panel="team" aria-labelledby="aiV2TeamTitle" tabindex="-1">
          <div class="ai-v2-section-head"><div><span class="ai-panel-kicker">Specialized operational monitors</span><h3 id="aiV2TeamTitle">AI Team</h3></div><p>States reflect real rule monitoring, provider configuration, and active recorded runs only.</p></div>
          <div id="aiAgentStatus" class="ai-agent-grid ai-agent-grid-v2" aria-label="Operational monitors and AI agents"></div>
          <div id="aiHandoffView" class="ai-handoff-view"></div>
        </section>

        <section id="aiV2ActivityPanel" class="ai-v2-section hidden" data-ai-v2-panel="activity" aria-labelledby="aiV2ActivityTitle" tabindex="-1">
          <div class="ai-v2-section-head"><div><span class="ai-panel-kicker">Live and recent intelligence</span><h3 id="aiV2ActivityTitle">Intelligence Timeline</h3></div><p>Independent records stay independent. Workflow links appear only when stored IDs prove the relationship.</p></div>
          <div id="aiIntelligenceTimeline" class="ai-intelligence-timeline"></div>
          <details class="ai-panel ai-advanced-activity"><summary>Advanced AI run history</summary><div id="aiRunActivity" class="ai-activity-list"></div></details>
        </section>

        <div id="aiDecisionModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="aiDecisionModalTitle" data-escape-owner="ai">
          <div class="modal-box modal-wide ai-decision-modal">
            <div class="ai-modal-head">
              <div><span class="ai-panel-kicker">Waiting on you · human intent only</span><h3 id="aiDecisionModalTitle">Decision Detail</h3></div>
              <button id="aiDecisionModalClose" class="btn-ws-secondary" type="button">Close</button>
            </div>
            <div id="aiDecisionModalBody"></div>
          </div>
        </div>

        <div id="aiActionDraftModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="aiActionDraftModalTitle" data-escape-owner="ai">
          <div class="modal-box modal-wide ai-decision-modal ai-action-draft-modal">
            <div class="ai-modal-head">
              <div><span class="ai-panel-kicker">Structured proposal · review only</span><h3 id="aiActionDraftModalTitle">Action Draft Detail</h3></div>
              <button id="aiActionDraftModalClose" class="btn-ws-secondary" type="button">Close</button>
            </div>
            <div id="aiActionDraftModalBody"></div>
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
    el('aiActionDraftModalClose').addEventListener('click', closeActionDraft);
    el('aiActionDraftModal').addEventListener('click', function (event) {
      if (event.target === el('aiActionDraftModal')) closeActionDraft();
    });
    el('aiActionDraftModalBody').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-draft-action]');
      if (button) submitActionDraftReview(button.dataset.aiDraftAction);
    });
    el('aiActionDraftList').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-draft-review]');
      if (button) openActionDraft(button.dataset.aiDraftReview);
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
    el('aiCommandSections').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-v2-section]');
      if (button) setV2Section(button.dataset.aiV2Section, true);
    });
    document.querySelector('[data-ai-v2-panel="overview"]').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-v2-jump]');
      if (button) setV2Section(button.dataset.aiV2Jump, true);
    });
    el('aiV2ProjectGrid').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-intelligence-project]');
      if (button) selectProjectIntelligence(button.dataset.aiIntelligenceProject);
    });
    el('aiAskForm').addEventListener('submit', function (event) {
      event.preventDefault();
      submitAskQuestion(el('aiAskInput').value);
    });
    document.querySelector('.ai-ask-suggestions').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ai-question]');
      if (!button) return;
      el('aiAskInput').value = button.dataset.aiQuestion;
      submitAskQuestion(button.dataset.aiQuestion);
    });
  }

  function removeView() {
    closeDecision();
    closeActionDraft();
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
    closeActionDraft();
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
    closeActionDraft();
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
    listenValue('actionDrafts', recentQuery('ai/actionDrafts', LIMITS.actionDrafts), function (snapshot) {
      state.data.actionDrafts = snapshotRows(snapshot).sort(newestFirst);
    });
    listenValue('actionDraftEvents', database().ref('ai/actionDraftEvents').orderByChild('timestamp').limitToLast(LIMITS.actionDraftEvents), function (snapshot) {
      state.data.actionDraftEvents = snapshotRows(snapshot).sort(newestFirst);
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

  function v2Context() {
    return {
      projects: state.data.projects,
      attention: state.data.attention,
      projectSummaries: state.data.projectSummaries,
      runs: state.data.runs,
      events: state.data.events,
      findings: state.data.findings,
      recommendations: state.data.recommendations,
      decisions: state.data.decisions,
      actionDrafts: state.data.actionDrafts,
      actionDraftEvents: state.data.actionDraftEvents,
      uiStatus: state.uiStatus,
      runtimeStatus: state.data.runtimeStatus
    };
  }

  function v2Model() {
    return window.ACPMCommandCenterV2 || null;
  }

  function setV2Section(section, focusPanel) {
    var allowed = ['overview', 'projects', 'team', 'activity'];
    state.section = allowed.indexOf(section) === -1 ? 'overview' : section;
    var activePanel = null;
    document.querySelectorAll('[data-ai-v2-panel]').forEach(function (panel) {
      var active = panel.dataset.aiV2Panel === state.section;
      panel.classList.toggle('hidden', !active);
      if (active) activePanel = panel;
    });
    document.querySelectorAll('[data-ai-v2-section]').forEach(function (button) {
      var active = button.dataset.aiV2Section === state.section;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (focusPanel && activePanel) {
      activePanel.focus({ preventScroll: true });
      activePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderCompanyPulse() {
    var model = v2Model();
    if (!model) return;
    var pulse = model.buildCompanyPulse(v2Context(), { now: Date.now() });
    var metrics = [
      ['Active projects', pulse.activeProjects],
      ['Need attention', pulse.projectsNeedingAttention],
      ['Waiting on you', pulse.waitingDecisions]
    ];
    el('aiCompanyPulseMetrics').innerHTML = metrics.map(function (metric) {
      return '<div><strong>' + h(metric[1]) + '</strong><span>' + h(metric[0]) + '</span></div>';
    }).join('');
    el('aiCompanyPulseMeta').textContent = pulse.openFindings + ' open finding' + (pulse.openFindings === 1 ? '' : 's') +
      ' · ' + pulse.highCriticalAttention + ' high or critical · ' + pulse.recentIntelligenceToday + ' recorded today';
    el('aiCompanyPriority').innerHTML = pulse.priority
      ? '<span>Current priority</span><strong>' + h(pulse.priority.projectName) + ' · ' + h(pulse.priority.title) + '</strong><p>' + h(pulse.priority.summary) + '</p>'
      : '<span>Current priority</span><strong>No operational attention item detected</strong><p>ACPM has no current deterministic exception to prioritize.</p>';
  }

  function agentStatusLabel(status) {
    return {
      ANALYZING: 'Analysis active', MONITORING: 'Monitoring', NOT_CONFIGURED: 'Not configured',
      DEGRADED: 'Degraded', IDLE: 'Idle', WAITING_FOR_PROVIDER: 'Waiting for provider'
    }[status] || 'Status unavailable';
  }

  function agentIcon(agentId) {
    return { pm: 'AI', planning: 'PL', materials: 'MT', site: 'QA' }[agentId] || 'AI';
  }

  function findingLabel(count) {
    return count ? count + ' current finding' + (count === 1 ? '' : 's') : 'No current findings';
  }

  function renderOverviewPreviews() {
    var model = v2Model();
    if (!model) return;
    var agents = model.buildAiTeam(v2Context());
    el('aiTeamPreview').innerHTML = agents.map(function (agent) {
      return '<article class="ai-team-preview-row ai-team-preview-' + h(agent.id) + '"><span class="ai-agent-icon" aria-hidden="true">' + h(agentIcon(agent.id)) + '</span><div><strong>' + h(agent.label) + '</strong><small>' + h(findingLabel(agent.findingCount)) + '</small></div><span class="ai-preview-state ai-agent-' + h(String(agent.status).toLowerCase().replace(/_/g, '-')) + '">' + h(agentStatusLabel(agent.status)) + '</span></article>';
    }).join('');
    var timeline = model.normalizeTimeline(v2Context(), { now: Date.now(), limit: 5 });
    el('aiActivityPreview').innerHTML = timeline.length ? timeline.map(function (item) {
      return '<article><time>' + h(formatWhen(item.timestamp)) + '</time><div><strong>' + h(item.actor) + '</strong><span>' + h(item.title) + '</span></div><small>' + h(item.projectName) + '</small></article>';
    }).join('') : '<p class="ai-quiet-empty">No recent intelligence activity is recorded.</p>';
  }

  function projectSignalMarkup(label, items, emptyText) {
    return '<section class="ai-project-signal"><h4>' + h(label) + '</h4>' +
      (items.length
        ? '<ul>' + items.slice(0, 8).map(function (item) { return '<li><strong>' + h(item.title) + '</strong><span>' + h(item.summary) + '</span></li>'; }).join('') + '</ul>'
        : '<p>' + h(emptyText) + '</p>') + '</section>';
  }

  function renderProjectIntelligence() {
    var model = v2Model();
    if (!model) return;
    var projects = model.buildProjectIntelligence(v2Context(), { now: Date.now() });
    if (!projects.length) {
      el('aiV2ProjectGrid').innerHTML = emptyMarkup('No active projects available', 'Project intelligence uses already-authorized Office snapshots.');
      el('aiProjectIntelligence').innerHTML = '';
      return;
    }
    if (!projects.some(function (project) { return project.projectId === state.selectedProjectId; })) {
      state.selectedProjectId = projects[0].projectId;
    }
    el('aiV2ProjectGrid').innerHTML = projects.map(function (project) {
      return '<button type="button" class="ai-v2-project-card' + (project.projectId === state.selectedProjectId ? ' is-selected' : '') + '" data-ai-intelligence-project="' + h(project.projectId) + '">' +
        '<span>' + h(project.projectName) + '</span><strong>' + h(project.attentionCount) + '</strong><small>' +
        (project.attentionCount ? 'Needs attention' : 'No detected attention') + '</small></button>';
    }).join('');
    var selected = projects.find(function (project) { return project.projectId === state.selectedProjectId; }) || projects[0];
    var management = [];
    if (selected.recommendations.length) management.push(selected.recommendations.length + ' recommendation' + (selected.recommendations.length === 1 ? '' : 's'));
    if (selected.waitingDecisions.length) management.push(selected.waitingDecisions.length + ' decision' + (selected.waitingDecisions.length === 1 ? '' : 's') + ' waiting');
    if (selected.actionDrafts.length) management.push(selected.actionDrafts.length + ' action draft' + (selected.actionDrafts.length === 1 ? '' : 's'));
    el('aiProjectIntelligence').innerHTML = '<div class="ai-project-intelligence-head"><div><span class="ai-panel-kicker">Project intelligence</span><h3>' + h(selected.projectName) + '</h3><p>' + h(selected.attentionCount) + ' current attention item' + (selected.attentionCount === 1 ? '' : 's') + '</p></div><button type="button" class="btn-ws-secondary" data-ai-project-open="' + h(selected.projectId) + '">Open Project</button></div>' +
      '<div class="ai-project-signal-grid">' +
      projectSignalMarkup('Planning', selected.planning, 'No current planning attention items.') +
      projectSignalMarkup('Materials', selected.materials, 'No current materials attention items.') +
      projectSignalMarkup('Site / QA', selected.site, 'No current site or QA attention items.') +
      '<section class="ai-project-signal"><h4>Management</h4><p>' + h(management.length ? management.join(' · ') : 'No recommendations, decisions, or drafts currently recorded.') + '</p></section>' +
      '</div><section class="ai-project-recent"><h4>Recent intelligence activity</h4>' +
      (selected.recentActivity.length ? '<ul>' + selected.recentActivity.slice(0, 6).map(function (item) { return '<li><span>' + h(item.actor) + '</span><strong>' + h(item.title) + '</strong><small>' + h(formatWhen(item.timestamp)) + '</small></li>'; }).join('') + '</ul>' : '<p>No recent intelligence activity is recorded for this project.</p>') + '</section>';
    el('aiProjectIntelligence').querySelector('[data-ai-project-open]').addEventListener('click', function (event) {
      navigateToDestination(event.currentTarget.dataset.aiProjectOpen, 'project');
    });
  }

  function selectProjectIntelligence(projectId) {
    var model = v2Model();
    if (!model) return;
    var valid = model.buildProjectIntelligence(v2Context(), { now: Date.now() })
      .some(function (project) { return project.projectId === String(projectId || ''); });
    if (!valid) return;
    state.selectedProjectId = String(projectId);
    renderProjectIntelligence();
    setV2Section('projects');
  }

  function timelineTypeLabel(value) {
    return {
      SYSTEM_DETECTED: 'System detected', RULE_BASED_MONITOR: 'Rule-based monitor',
      AI_ANALYSIS: 'AI analysis', HUMAN_DECISION: 'Human decision', ACTION_DRAFT: 'Action draft'
    }[value] || 'Recorded activity';
  }

  function renderTimeline() {
    var model = v2Model();
    if (!model) return;
    var timeline = model.normalizeTimeline(v2Context(), { now: Date.now(), limit: 16 });
    if (!timeline.length) {
      el('aiIntelligenceTimeline').innerHTML = emptyMarkup('No intelligence activity yet', 'Real detections, runs, findings, recommendations, decisions, and drafts will appear here.');
      return;
    }
    el('aiIntelligenceTimeline').innerHTML = timeline.map(function (item) {
      return '<article class="ai-timeline-item ai-timeline-' + h(item.type.toLowerCase().replace(/_/g, '-')) + '"><div class="ai-timeline-marker"></div><time>' + h(formatWhen(item.timestamp)) + '</time><div class="ai-timeline-source"><span>' + h(timelineTypeLabel(item.type)) + '</span><strong>' + h(item.actor) + '</strong></div><div class="ai-timeline-event"><h4>' + h(item.title) + '</h4>' + (item.summary ? '<p>' + h(item.summary) + '</p>' : '') + '</div><small>' + h(item.projectName) + '</small></article>';
    }).join('');
  }

  function renderHandoffs() {
    var model = v2Model();
    if (!model) return;
    var timeline = model.normalizeTimeline(v2Context(), { now: Date.now(), limit: 60 });
    var links = model.buildHandoffs(timeline);
    var records = {};
    timeline.forEach(function (item) { records[item.id] = item; });
    if (!links.length) {
      el('aiHandoffView').innerHTML = '<div class="ai-handoff-empty"><strong>No explicit handoff chain recorded</strong><p>Current findings remain independent unless stored IDs prove a workflow relationship.</p></div>';
      return;
    }
    function handoffMarkup(link) {
      var from = records[link.fromId];
      var to = records[link.toId];
      return '<div><span>' + h(from.actor) + '</span><i aria-hidden="true">→</i><span>' + h(to.actor) + '</span><small>Linked by stored record ID</small></div>';
    }
    var primary = links.slice(0, 5);
    var remaining = links.slice(5, 12);
    el('aiHandoffView').innerHTML = '<div class="ai-panel-head"><div><span class="ai-panel-kicker">Explicit stored relationships</span><h3>Verified Handoffs</h3></div></div><div class="ai-handoff-list">' + primary.map(handoffMarkup).join('') + '</div>' +
      (remaining.length ? '<details class="ai-list-disclosure ai-handoff-more"><summary>Show ' + h(remaining.length) + ' more verified relationship' + (remaining.length === 1 ? '' : 's') + '</summary><div class="ai-handoff-list">' + remaining.map(handoffMarkup).join('') + '</div></details>' : '');
  }

  function renderAskAnswer() {
    var container = el('aiAskAnswer');
    var answer = state.lastAnswer;
    if (!container) return;
    if (!answer) {
      container.className = 'ai-ask-answer hidden';
      container.innerHTML = '';
      return;
    }
    container.className = 'ai-ask-answer';
    container.dataset.generatedBy = answer.generatedBy;
    container.innerHTML = '<div class="ai-ask-answer-head"><span>' + h(answer.generatedBy === 'ai' ? 'AI-generated · grounded output' : 'Rule-based · deterministic') + '</span><small>' + h(answer.scope === 'project' ? 'Project scope' : 'Company scope') + '</small></div><h4>' + h(answer.title) + '</h4><p>' + h(answer.summary) + '</p>' +
      (answer.facts.length ? '<ul>' + answer.facts.map(function (fact) { return '<li>' + h(fact) + '</li>'; }).join('') + '</ul>' : '') +
      '<small class="ai-answer-boundary">Read-only answer. No business action was created or changed.</small>';
  }

  function submitAskQuestion(question) {
    var model = v2Model();
    var safeQuestion = String(question || '').trim().slice(0, 240);
    if (!model || !safeQuestion) {
      state.lastAnswer = null;
      renderAskAnswer();
      return;
    }
    state.lastAnswer = model.answer(safeQuestion, v2Context(), { now: Date.now() });
    renderAskAnswer();
  }

  function renderAll() {
    if (!el('aiCommandCenterView')) return;
    var status = el('aiSystemStatus');
    status.textContent = 'DETERMINISTIC INTELLIGENCE';
    status.className = 'ai-status-pill ai-status-deterministic';
    renderNotice();
    renderCompanyPulse();
    renderDailyBrief();
    renderSummary();
    renderAttention();
    renderProjectSummaries();
    renderAgents();
    renderDecisions();
    renderActionDrafts();
    renderRecommendations();
    renderRuntime();
    renderRuns();
    renderProjectIntelligence();
    renderTimeline();
    renderHandoffs();
    renderOverviewPreviews();
    renderAskAnswer();
    setV2Section(state.section);
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
    var panel = el('aiAttentionList').closest('.ai-needs-action-panel');
    panel.classList.toggle('ai-is-empty', !items.length);
    el('aiNeedsActionCount').textContent = String(items.length);
    if (!items.length) {
      el('aiAttentionList').innerHTML = '<p class="ai-quiet-empty"><strong>Everything looks on track.</strong><span>No operational issues currently need your attention.</span></p>';
      return;
    }
    function attentionMarkup(item) {
      var meta = [item.projectName, ageLabel(item)].filter(Boolean).join(' · ');
      return '<article class="ai-attention-card ai-severity-border-' + h(item.severity) + '">' +
        '<div class="ai-card-meta"><span>' + h(meta) + '</span><span class="ai-severity ai-severity-' + h(item.severity) + '">' + h(item.severity) + '</span></div>' +
        '<div class="ai-detection-label">System detected · ' + h(item.category.replace(/_/g, ' ')) + '</div>' +
        '<h4>' + h(item.title) + '</h4><p>' + h(item.summary) + '</p>' +
        '<div class="ai-card-actions"><button type="button" class="btn-ws-secondary" data-project-id="' + h(item.projectId) + '" data-ai-destination="' + h(item.recommendedDestination) + '">' + h(actionLabel(item.recommendedDestination)) + '</button></div>' +
      '</article>';
    }
    var primary = items.slice(0, 3).map(attentionMarkup).join('');
    var remaining = items.slice(3);
    el('aiAttentionList').innerHTML = primary + (remaining.length
      ? '<details class="ai-list-disclosure"><summary>Show ' + h(remaining.length) + ' more attention item' + (remaining.length === 1 ? '' : 's') + '</summary><div class="ai-card-list">' + remaining.map(attentionMarkup).join('') + '</div></details>'
      : '');
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
    var model = v2Model();
    var agents = model ? model.buildAiTeam(v2Context()) : [];
    el('aiAgentStatus').innerHTML = agents.map(function (agent) {
      var statusClassName = String(agent.status || 'IDLE').toLowerCase().replace(/_/g, '-');
      return '<article class="ai-agent-card ai-agent-card-v2 ai-agent-card-' + h(agent.id) + '" data-ai-agent="' + h(agent.id) + '" data-ai-agent-status="' + h(agent.status) + '"><div class="ai-agent-icon" aria-hidden="true">' + h(agentIcon(agent.id)) + '</div><div class="ai-agent-copy"><span class="ai-agent-role">' + h(agent.id === 'pm' ? 'Synthesis agent' : 'Domain monitor') + '</span><h3>' + h(agent.label) + '</h3><p>' + h(agent.description) + '</p><small>' + h(findingLabel(agent.findingCount)) + '</small></div><div class="ai-agent-state ai-agent-' + h(statusClassName) + '"><i></i><strong>' + h(agentStatusLabel(agent.status)) + '</strong><span>' + h(agent.statusDetail) + '</span></div></article>';
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
    var panel = el('aiDecisionList').closest('.ai-waiting-panel');
    panel.classList.toggle('ai-is-empty', !decisions.length);
    if (!decisions.length) {
      el('aiDecisionList').innerHTML = '<p class="ai-quiet-empty"><strong>No decisions are waiting.</strong><span>Management is clear for now.</span></p>';
      return;
    }
    el('aiDecisionList').innerHTML = decisions.map(function (decision) {
      var recommendation = recommendationForDecision(decision) || {};
      var level = severity(recommendation.severity);
      return '<article class="ai-review-card ai-severity-border-' + level + '">' +
        '<div class="ai-card-meta"><span>' + h(projectName(decision.projectId || recommendation.projectId)) + '</span><span class="ai-severity ai-severity-' + level + '">' + h(level) + '</span></div>' +
        '<h4>' + h(recommendation.title || 'Human decision required') + '</h4>' +
        '<p>' + h(recommendation.summary || decision.question || 'No validated summary was provided.') + '</p>' +
        '<div class="ai-recommended"><span>Recommended action</span><strong>' + h(firstAction(recommendation)) + '</strong></div>' +
        '<div class="ai-card-actions"><button type="button" class="btn-ws-secondary" data-ai-review="' + h(decision.id) + '">Review</button></div>' +
      '</article>';
    }).join('');
  }

  function actionTypeLabel(value) {
    return {
      follow_up_supplier: 'Follow up supplier',
      prepare_material_request: 'Prepare material request',
      prepare_task_update: 'Prepare task update',
      prepare_site_follow_up: 'Prepare site follow-up',
      prepare_internal_note: 'Prepare internal note'
    }[value] || 'Unsupported draft type';
  }

  function actionDraftStatusLabel(draft) {
    if (draft.status === 'reviewed') return 'Reviewed — not executed';
    if (draft.status === 'cancelled') return 'Cancelled';
    return 'Draft — awaiting review';
  }

  function renderActionDrafts() {
    var drafts = state.data.actionDrafts.slice().sort(function (a, b) {
      if (a.status === 'draft' && b.status !== 'draft') return -1;
      if (a.status !== 'draft' && b.status === 'draft') return 1;
      return newestFirst(a, b);
    });
    el('aiActionDraftCount').textContent = String(drafts.filter(function (draft) { return draft.status === 'draft'; }).length);
    if (!drafts.length) {
      el('aiActionDraftList').innerHTML = emptyMarkup('No action drafts', 'Resolved structured options may create review-only drafts. No business action runs here.');
      return;
    }
    el('aiActionDraftList').innerHTML = drafts.map(function (draft) {
      return '<article class="ai-action-draft-card" data-ai-draft-status="' + h(draft.status) + '">' +
        '<div class="ai-card-meta"><span>' + h(projectName(draft.projectId)) + '</span><span class="ai-draft-status ai-draft-status-' + h(draft.status) + '">' + h(actionDraftStatusLabel(draft)) + '</span></div>' +
        '<h4>' + h(draft.title || 'Structured action draft') + '</h4>' +
        '<p>' + h(draft.summary || 'No validated summary was provided.') + '</p>' +
        '<dl class="ai-draft-card-fields"><div><dt>Action type</dt><dd>' + h(actionTypeLabel(draft.actionType)) + '</dd></div><div><dt>Source decision</dt><dd>' + h(draft.decisionId || 'Unavailable') + '</dd></div></dl>' +
        '<div class="ai-card-foot"><span>' + h(formatWhen(draft.createdAt)) + '</span><span>No execution</span></div>' +
        '<div class="ai-card-actions"><button type="button" class="btn-ws-secondary" data-ai-draft-review="' + h(draft.id) + '">Review Draft</button></div>' +
      '</article>';
    }).join('');
  }

  function draftPayloadMarkup(payload) {
    var data = payload && typeof payload === 'object' ? payload : {};
    var fields = [
      ['Material reference', data.materialReference],
      ['Requested quantity', data.requestedQuantity],
      ['Supplier reference', data.supplierReference],
      ['Task reference', data.taskReference],
      ['Site issue reference', data.siteIssueReference],
      ['Note reference', data.noteReference],
      ['Reason', data.reason]
    ];
    var details = fields.map(function (field) {
      var present = field[1] !== null && field[1] !== undefined && field[1] !== '';
      return '<div><dt>' + h(field[0]) + '</dt><dd>' + h(present ? field[1] : 'Unknown') + '</dd></div>';
    }).join('');
    var refs = Array.isArray(data.sourceEvidenceRefs) ? data.sourceEvidenceRefs : [];
    return '<dl class="ai-draft-detail-fields">' + details + '</dl>' +
      '<section class="ai-detail-section"><h4>Source evidence references</h4>' + evidenceMarkup(refs) + '</section>';
  }

  function renderActionDraftDetail(draft) {
    var finalDetail = draft.status === 'reviewed'
      ? '<section class="ai-decision-result ai-decision-result-resolved" data-ai-draft-result="reviewed"><span>Reviewed — not executed</span><p>Reviewed by: ' + h(draft.reviewedByRole || 'authorized manager') + '</p><p>Reviewed at: ' + h(formatWhen(draft.reviewedAt)) + '</p></section>'
      : draft.status === 'cancelled'
        ? '<section class="ai-decision-result ai-decision-result-dismissed" data-ai-draft-result="cancelled"><span>Cancelled</span><p>Cancelled by: ' + h(draft.cancelledByRole || 'authorized manager') + '</p><p>Cancelled at: ' + h(formatWhen(draft.cancelledAt)) + '</p><small>The draft remains preserved for history.</small></section>'
        : '<section class="ai-decision-controls ai-draft-controls" data-ai-draft-id="' + h(draft.id) + '">' +
          '<div id="aiDraftSubmitState" class="ai-decision-submit-state" role="status" aria-live="polite"></div>' +
          '<div class="ai-decision-actions"><button type="button" class="btn-ws-primary" data-ai-draft-action="review">Mark Reviewed</button><button type="button" class="btn-ws-secondary ai-dismiss-button" data-ai-draft-action="cancel">Cancel Draft</button></div>' +
          '<p class="ai-intent-boundary">Review changes this AI draft only. It does not create or update tasks, purchase orders, schedules, billing, payments, or messages.</p></section>';
    el('aiActionDraftModalBody').innerHTML =
      '<section class="ai-detail-section"><h4>Draft title</h4><h3>' + h(draft.title || 'Structured action draft') + '</h3><p>' + h(draft.summary || 'No validated summary was provided.') + '</p></section>' +
      '<dl class="ai-draft-detail-fields"><div><dt>Project</dt><dd>' + h(projectName(draft.projectId)) + '</dd></div><div><dt>Source decision</dt><dd>' + h(draft.decisionId || 'Unavailable') + '</dd></div><div><dt>Source option</dt><dd>' + h(draft.sourceDecisionOptionId || 'Unavailable') + '</dd></div><div><dt>Action type</dt><dd>' + h(actionTypeLabel(draft.actionType)) + '</dd></div><div><dt>Status</dt><dd>' + h(actionDraftStatusLabel(draft)) + '</dd></div><div><dt>Created</dt><dd>' + h(formatWhen(draft.createdAt)) + '</dd></div></dl>' +
      '<section class="ai-detail-section"><h4>Structured payload</h4>' + draftPayloadMarkup(draft.payload) + '</section>' +
      '<p class="ai-draft-execution-boundary"><strong>Draft only.</strong> No business action has executed.</p>' +
      finalDetail;
  }

  function openActionDraft(draftId) {
    var draft = state.data.actionDrafts.find(function (item) { return item.id === draftId; });
    if (!draft) return;
    state.draftReturnFocus = document.activeElement;
    state.pendingDraftSubmission = null;
    renderActionDraftDetail(draft);
    el('aiActionDraftModal').classList.remove('hidden');
    el('aiActionDraftModal').setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { el('aiActionDraftModalClose')?.focus(); });
  }

  function closeActionDraft() {
    var modal = el('aiActionDraftModal');
    var wasOpen = modal && !modal.classList.contains('hidden');
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    if (wasOpen && state.draftReturnFocus && state.draftReturnFocus.isConnected) state.draftReturnFocus.focus();
    state.draftReturnFocus = null;
    state.pendingDraftSubmission = null;
  }

  function actionDraftFailureMessage(error) {
    var safeCode = String(error && error.message || '').split(/\s+/).pop();
    var code = String(error && error.code || '').replace(/^functions\//, '');
    return {
      unauthenticated: 'Your session expired. Sign in and try again.',
      inactive_user: 'Your account is not active.',
      unauthorized_role: 'Your role cannot review action drafts.',
      invalid_action_draft_request: 'The draft review request is invalid.',
      action_draft_not_found: 'This action draft is no longer available.',
      action_draft_malformed: 'This action draft cannot be safely reviewed.',
      stale_action_draft: 'This action draft changed. Refresh before reviewing.',
      action_draft_already_final: 'Another manager already completed this draft review.',
      duplicate_request_conflict: 'This review could not be safely retried.',
      action_draft_transaction_failed: 'The draft review could not be saved. Please try again.'
    }[safeCode] || ({
      unauthenticated: 'Your session expired. Sign in and try again.',
      'permission-denied': 'You are not authorized to review action drafts.',
      unavailable: 'The draft review service is currently unavailable.'
    }[code] || 'The draft review could not be recorded. No business action was taken.');
  }

  function setActionDraftSubmitting(submitting) {
    state.draftSubmitting = submitting;
    document.querySelectorAll('#aiActionDraftModalBody [data-ai-draft-action]').forEach(function (control) {
      control.disabled = submitting;
    });
    var closeButton = el('aiActionDraftModalClose');
    if (closeButton) closeButton.disabled = submitting;
  }

  function mergeActionDraftResult(draftId, result) {
    var index = state.data.actionDrafts.findIndex(function (item) { return item.id === draftId; });
    if (index === -1) return null;
    state.data.actionDrafts[index] = Object.assign({}, state.data.actionDrafts[index], result, { id: draftId });
    return state.data.actionDrafts[index];
  }

  async function submitActionDraftReview(action) {
    if (state.draftSubmitting || ['review', 'cancel'].indexOf(action) === -1) return;
    var controls = document.querySelector('#aiActionDraftModalBody [data-ai-draft-id]');
    var draftId = controls && controls.dataset.aiDraftId;
    var draft = state.data.actionDrafts.find(function (item) { return item.id === draftId; });
    if (!draft || draft.status !== 'draft') return;
    var status = el('aiDraftSubmitState');
    var signature = [draft.id, action, draft.createdAt].join('|');
    if (!state.pendingDraftSubmission || state.pendingDraftSubmission.signature !== signature) {
      state.pendingDraftSubmission = { signature: signature, id: submissionId().replace(/^decision-/, 'draft-') };
    }
    var service = callableService();
    if (!service || typeof service.httpsCallable !== 'function') {
      if (status) status.textContent = 'The draft review service is currently unavailable.';
      return;
    }
    setActionDraftSubmitting(true);
    if (status) status.textContent = action === 'review' ? 'Recording review…' : 'Cancelling draft…';
    try {
      var response = await service.httpsCallable('reviewAiActionDraft')({
        draftId: draft.id,
        submissionId: state.pendingDraftSubmission.id,
        action: action,
        expectedCreatedAt: draft.createdAt
      });
      var result = response && response.data;
      if (!result || result.draftId !== draft.id || ['reviewed', 'cancelled'].indexOf(result.status) === -1) {
        throw { code: 'functions/internal', message: 'action_draft_request_failed' };
      }
      state.pendingDraftSubmission = null;
      var updated = mergeActionDraftResult(draft.id, result);
      renderAll();
      if (updated && el('aiActionDraftModal') && !el('aiActionDraftModal').classList.contains('hidden')) {
        renderActionDraftDetail(updated);
      }
    } catch (error) {
      if (status) status.textContent = actionDraftFailureMessage(error);
    } finally {
      setActionDraftSubmitting(false);
    }
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
      .map(function (item) {
        if (typeof item === 'string' && item.trim()) return { id: item, label: item, hasActionIntent: false };
        if (!item || typeof item !== 'object') return null;
        var id = typeof item.id === 'string' ? item.id.trim() : '';
        var label = typeof item.label === 'string' ? item.label.trim() : '';
        return id && label ? { id: id, label: label, hasActionIntent: !!item.actionIntent } : null;
      })
      .filter(Boolean)
      .slice(0, 20);
  }

  function decisionOptionLabel(decision, optionId) {
    var option = decisionOptions(decision).find(function (item) { return item.id === optionId; });
    return option ? option.label : optionId;
  }

  function decisionStatusMarkup(decision) {
    if (decision.status === 'resolved') {
      return '<section class="ai-decision-result ai-decision-result-resolved" data-ai-decision-result="resolved">' +
        '<span>Resolved</span><h4>Selected: ' + h(decisionOptionLabel(decision, decision.resolution) || 'Recorded option unavailable') + '</h4>' +
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
          return '<label><input type="radio" name="aiDecisionOption" value="' + index + '"><span>' + h(item.label) + '</span>' +
            (item.hasActionIntent ? '<small>May create a structured action draft for separate review.</small>' : '') + '</label>';
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
    var selectedOption = action === 'choose' && selected ? options[Number(selected.value)] : undefined;
    var selectedOptionId = selectedOption && selectedOption.id;
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
    if (el('aiActionDraftModal') && !el('aiActionDraftModal').classList.contains('hidden')) {
      event.preventDefault();
      event.stopPropagation();
      closeActionDraft();
      return;
    }
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
