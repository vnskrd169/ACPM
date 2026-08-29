(function () {
  'use strict';

  const state = {
    projects: [],
    projectQuery: '',
    moreOpen: false,
    selectedProjectId: ''
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function h(value) {
    return typeof escapeHtml === 'function'
      ? escapeHtml(String(value ?? ''))
      : String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
  }

  function role() {
    return typeof normalizeRole === 'function'
      ? normalizeRole(window._currentUser?.role || 'apm')
      : String(window._currentUser?.role || 'apm').toLowerCase();
  }

  function isApm() {
    return role() === 'apm';
  }

  function rows(value) {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).map(([id, record]) => ({ id, ...(record || {}) }));
  }

  function status(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  }

  function activeProject(project) {
    return !['completed', 'archived', 'cancelled'].includes(status(project.status || 'active'));
  }

  function openRecord(record) {
    return !['completed', 'done', 'closed', 'cancelled', 'archived', 'rejected', 'fully_delivered', 'delivered'].includes(status(record.status));
  }

  function localIso(date = new Date()) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  }

  function yesterdayIso() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return localIso(date);
  }

  function activeWorkers(project) {
    return rows(project.workers).filter(worker => worker.active !== false && !['inactive', 'archived'].includes(status(worker.status)));
  }

  function attendanceProgress(project, date) {
    const workers = activeWorkers(project);
    const attendance = project.attendance || {};
    const recorded = workers.filter(worker => {
      const entry = attendance[worker.id]?.[date];
      return entry && entry.status && status(entry.status) !== 'unmarked';
    }).length;
    return { recorded, total: workers.length, unresolved: Math.max(0, workers.length - recorded) };
  }

  function projectTasks(project) {
    return [...rows(project.tasks), ...rows(project.pmosTasks)]
      .filter(openRecord)
      .map(task => ({ ...task, status: status(task.status || 'pending') }));
  }

  function projectIssues(project) {
    return [...rows(project.defects), ...rows(project.pmosIssues)]
      .filter(openRecord);
  }

  function pendingDeliveries(project) {
    return rows(project.purchaseOrders).filter(order =>
      ['approved', 'ordered', 'partially_delivered'].includes(status(order.deliveryStatus || order.status))
    );
  }

  function pendingMaterialRequests(project) {
    return [...rows(project.purchaseRequests), ...rows(project.pmosMaterialRequests)]
      .filter(openRecord);
  }

  function dueDate(task) {
    return String(task.dueDate || task.date || '').slice(0, 10);
  }

  function projectDailySummary(project) {
    const today = localIso();
    const tasks = projectTasks(project);
    const dueToday = tasks.filter(task => dueDate(task) === today).length;
    const overdue = tasks.filter(task => dueDate(task) && dueDate(task) < today).length;
    const blocked = tasks.filter(task => status(task.status) === 'blocked').length;
    const issues = projectIssues(project);
    const deliveries = pendingDeliveries(project);
    const requests = pendingMaterialRequests(project);
    return {
      attendance: attendanceProgress(project, today),
      yesterdayAttendance: attendanceProgress(project, yesterdayIso()),
      tasks,
      dueToday,
      overdue,
      blocked,
      issues,
      deliveries,
      requests
    };
  }

  function attentionItems(projects) {
    const items = [];
    projects.filter(activeProject).forEach(project => {
      const summary = projectDailySummary(project);
      const name = project.name || project.id || 'Project';
      if (summary.yesterdayAttendance.total && summary.yesterdayAttendance.unresolved) {
        items.push({
          level: 'urgent', projectId: project.id, tab: 'labor',
          title: `${summary.yesterdayAttendance.unresolved} attendance entr${summary.yesterdayAttendance.unresolved === 1 ? 'y is' : 'ies are'} still unmarked`,
          meta: `${name} · yesterday`
        });
      }
      if (summary.blocked || summary.overdue) {
        const parts = [];
        if (summary.overdue) parts.push(`${summary.overdue} overdue`);
        if (summary.blocked) parts.push(`${summary.blocked} blocked`);
        items.push({
          level: summary.blocked ? 'urgent' : 'attention', projectId: project.id, tab: 'tasks',
          title: `${parts.join(' and ')} task${summary.overdue + summary.blocked === 1 ? '' : 's'} need follow-up`,
          meta: name
        });
      }
      if (summary.deliveries.length) {
        items.push({
          level: 'attention', projectId: project.id, tab: 'materials',
          title: `${summary.deliveries.length} material deliver${summary.deliveries.length === 1 ? 'y is' : 'ies are'} pending`,
          meta: name
        });
      }
      if (summary.issues.length) {
        items.push({
          level: 'attention', projectId: project.id, tab: 'defects',
          title: `${summary.issues.length} site issue${summary.issues.length === 1 ? ' needs' : 's need'} follow-up`,
          meta: name
        });
      }
    });
    return items;
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function ensureHome() {
    if (!isApm()) return null;
    let home = byId('apmHome');
    if (home) return home;
    home = document.createElement('section');
    home.id = 'apmHome';
    home.className = 'apm-home';
    home.setAttribute('aria-labelledby', 'apmHomeTitle');
    byId('hubView')?.prepend(home);
    return home;
  }

  function projectOptions(projects, selected) {
    return projects.map(project =>
      `<option value="${h(project.id)}"${project.id === selected ? ' selected' : ''}>${h(project.name || 'Untitled project')}</option>`
    ).join('');
  }

  function selectedProjectId() {
    const selected = byId('apmQuickProject')?.value || '';
    if (selected) state.selectedProjectId = selected;
    return selected || state.selectedProjectId || state.projects.find(activeProject)?.id || state.projects[0]?.id || '';
  }

  function rememberApmQuickProject(projectId) {
    if (projectId) state.selectedProjectId = String(projectId);
  }

  function renderAttention(items) {
    if (!items.length) {
      return `<div class="apm-calm-state" id="apmCalmState">
        <strong>Everything is on track.</strong>
        <span>No overdue, blocked, unresolved, or pending items need action right now.</span>
      </div>`;
    }
    return `<div class="apm-attention-list" id="apmAttentionList">${items.slice(0, 8).map(item => `
      <button class="apm-attention-row is-${item.level}" type="button" data-apm-attention
        onclick="openApmProjectTab('${h(item.projectId)}','${h(item.tab)}')">
        <span class="apm-state-dot" aria-hidden="true"></span>
        <span><strong>${h(item.title)}</strong><small>${h(item.meta)}</small></span>
        <span class="apm-row-action">Open</span>
      </button>`).join('')}</div>
      ${items.length > 8 ? `<p class="apm-track-note">${items.length - 8} more items are available inside your projects.</p>` : ''}`;
  }

  function renderProjects(projects) {
    const query = state.projectQuery.toLowerCase().trim();
    const filtered = projects.filter(project => !query || String(project.name || '').toLowerCase().includes(query));
    if (!filtered.length) return '<p class="apm-empty">No assigned projects match this search.</p>';
    return filtered.map(project => {
      const summary = projectDailySummary(project);
      const signals = [];
      if (summary.overdue) signals.push(`${summary.overdue} overdue task${summary.overdue === 1 ? '' : 's'}`);
      if (summary.blocked) signals.push(`${summary.blocked} blocked`);
      if (summary.issues.length) signals.push(`${summary.issues.length} open issue${summary.issues.length === 1 ? '' : 's'}`);
      if (summary.deliveries.length) signals.push(`${summary.deliveries.length} pending deliver${summary.deliveries.length === 1 ? 'y' : 'ies'}`);
      return `<article class="apm-project-row" data-apm-project data-name="${h(String(project.name || '').toLowerCase())}">
        <div class="apm-project-main">
          <span class="apm-project-label">Project</span>
          <h3>${h(project.name || 'Untitled project')}</h3>
          <p>${signals.length ? h(signals.join(' · ')) : 'Everything on track'}</p>
        </div>
        <div class="apm-project-counts">
          <span><strong>${summary.tasks.length}</strong> active tasks</span>
          <span><strong>${summary.issues.length}</strong> pending issues</span>
        </div>
        <button type="button" class="apm-open-project" onclick="openApmProjectTab('${h(project.id)}','dashboard')">Open</button>
      </article>`;
    }).join('');
  }

  function renderApmHome(projects) {
    if (!isApm()) return false;
    const currentSelection = byId('apmQuickProject')?.value || '';
    if (currentSelection) state.selectedProjectId = currentSelection;
    state.projects = projects.filter(project => project && project.id);
    const active = state.projects.filter(activeProject);
    const choices = active.length ? active : state.projects;
    const selected = choices.some(project => project.id === state.selectedProjectId)
      ? state.selectedProjectId
      : (choices[0]?.id || '');
    const attention = attentionItems(active);
    const name = window._currentUser?.name || 'there';
    const home = ensureHome();
    if (!home) return false;

    home.innerHTML = `
      <nav class="apm-primary-nav" aria-label="APM workspace">
        <button type="button" class="is-active" onclick="showApmHomeSection('today')">Home</button>
        <button type="button" onclick="showApmHomeSection('projects')">Projects</button>
        <button type="button" onclick="openApmQuickAction('labor')">Attendance</button>
        <button type="button" onclick="openApmQuickAction('tasks')">Tasks</button>
        <button type="button" onclick="openApmQuickAction('materials')">Materials</button>
        <button type="button" onclick="openApmQuickAction('sitelog')">Site</button>
        <button id="apmMoreButton" type="button" aria-expanded="${state.moreOpen}" onclick="toggleApmHomeMore()">More</button>
      </nav>

      <div id="apmMoreMenu" class="apm-more-menu${state.moreOpen ? '' : ' hidden'}">
        <button type="button" onclick="openPmosOffice()">PMOS Office</button>
        <a href="pmos.html">PMOS Field</a>
      </div>

      <header class="apm-today-head" id="apmTodaySection">
        <div>
          <span class="apm-eyebrow">Today</span>
          <h1 id="apmHomeTitle">${h(greeting())}, ${h(name.split(' ')[0])}</h1>
          <p>${attention.length ? `<strong>${attention.length}</strong> thing${attention.length === 1 ? '' : 's'} need attention` : 'Your assigned projects are calm today.'}</p>
        </div>
        <label class="apm-project-picker">Project for quick actions
          <select id="apmQuickProject" onchange="rememberApmQuickProject(this.value)">${projectOptions(choices, selected)}</select>
        </label>
      </header>

      <section class="apm-section" aria-labelledby="apmAttentionTitle">
        <div class="apm-section-head"><div><span class="apm-eyebrow">Level 1</span><h2 id="apmAttentionTitle">Needs attention</h2></div></div>
        ${renderAttention(attention)}
        ${attention.length ? '<p class="apm-track-note">Everything not listed here is on track.</p>' : ''}
      </section>

      <section class="apm-section" aria-labelledby="apmQuickTitle">
        <div class="apm-section-head"><div><span class="apm-eyebrow">Quick actions</span><h2 id="apmQuickTitle">Start work</h2></div></div>
        <div class="apm-quick-grid">
          <button type="button" onclick="openApmQuickAction('labor')"><strong>Attendance</strong><span>Record today's status</span></button>
          <button type="button" onclick="openApmQuickAction('materials')"><strong>Material Request</strong><span>Request or check delivery</span></button>
          <button type="button" onclick="openApmQuickAction('sitelog')"><strong>Site Update</strong><span>Add today's field notes</span></button>
          <button type="button" onclick="openApmQuickAction('tasks')"><strong>Tasks</strong><span>Review current work</span></button>
        </div>
      </section>

      <section class="apm-section" id="apmProjectsSection" aria-labelledby="apmProjectsTitle">
        <div class="apm-section-head">
          <div><span class="apm-eyebrow">Level 2</span><h2 id="apmProjectsTitle">My projects</h2></div>
          <input type="search" value="${h(state.projectQuery)}" placeholder="Find a project" aria-label="Find a project" oninput="filterApmProjects(this.value)">
        </div>
        <div id="apmProjectList" class="apm-project-list">${renderProjects(active.length ? active : state.projects)}</div>
      </section>`;
    return true;
  }

  function filterApmProjects(value) {
    state.projectQuery = String(value || '');
    const list = byId('apmProjectList');
    if (list) list.innerHTML = renderProjects(state.projects.filter(activeProject));
  }

  function showApmHomeSection(section) {
    const target = section === 'projects' ? byId('apmProjectsSection') : byId('apmTodaySection');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleApmHomeMore() {
    state.moreOpen = !state.moreOpen;
    byId('apmMoreMenu')?.classList.toggle('hidden', !state.moreOpen);
    byId('apmMoreButton')?.setAttribute('aria-expanded', String(state.moreOpen));
  }

  function openApmProjectTab(projectId, tab) {
    if (!projectId) {
      if (typeof showToast === 'function') showToast('No assigned project is available.', 'warn');
      return;
    }
    if (typeof getAppPage === 'function' && getAppPage() === 'workspace') {
      Promise.resolve(window._currentPid === projectId ? true : enterProject(projectId)).then(opened => {
        if (opened === false) return;
        if (['changeorders', 'suppliers', 'equipment', 'compliance', 'defects'].includes(tab)) toggleExtraTabs(true);
        switchTab(tab);
      });
      return;
    }
    window.location.href = typeof appUrl === 'function'
      ? appUrl('workspace', { projectId, tab })
      : `workspace.html?projectId=${encodeURIComponent(projectId)}&tab=${encodeURIComponent(tab)}`;
  }

  function openApmQuickAction(tab) {
    openApmProjectTab(selectedProjectId(), tab);
  }

  function ageLabel(value) {
    const timestamp = Number(value) || Date.parse(value || '');
    if (!timestamp) return 'Age unknown';
    const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
    return days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} old`;
  }

  function materialLines(project) {
    const lines = [];
    rows(project.purchaseOrders).forEach(order => {
      (Array.isArray(order.items) ? order.items : rows(order.items)).forEach((item, index) => {
        const ordered = Number(item.qtyOrdered ?? item.qty) || 0;
        const received = Number(item.qtyAccepted ?? item.qtyReceived) || 0;
        lines.push({
          id: `${order.id}-${index}`,
          name: item.desc || item.description || item.item || 'Material',
          ordered,
          received,
          pending: Math.max(0, Number(item.qtyRemaining ?? ordered - received) || 0),
          unit: item.unit || '',
          status: order.deliveryStatus || order.status || 'requested'
        });
      });
    });
    return lines;
  }

  function renderApmProjectHome(projectId, project) {
    if (!isApm()) return false;
    const panel = byId('dashboardPanel');
    if (!panel) return false;
    const summary = projectDailySummary(project);
    const today = localIso();
    const taskRows = summary.tasks
      .sort((a, b) => String(dueDate(a) || '9999-12-31').localeCompare(String(dueDate(b) || '9999-12-31')))
      .slice(0, 6);
    const issues = summary.issues.slice(0, 6);
    const materials = materialLines(project).filter(line => !['fully_delivered', 'closed', 'cancelled'].includes(status(line.status))).slice(0, 6);

    panel.innerHTML = `<div class="apm-project-home">
      <header class="apm-project-hero">
        <div><span class="apm-eyebrow">Project home</span><h2>${h(project.name || projectId)}</h2><p>${h(project.location || project.address || project.siteAddress || 'Active project')}</p></div>
        <span class="apm-project-status">${h(project.status || 'active')}</span>
      </header>

      <section class="apm-project-today" aria-labelledby="apmProjectTodayTitle">
        <div class="apm-section-head"><div><span class="apm-eyebrow">Today · ${h(today)}</span><h3 id="apmProjectTodayTitle">Daily operations</h3></div></div>
        <div class="apm-operational-summary">
          <button type="button" onclick="switchTab('labor')"><span>Attendance</span><strong>${summary.attendance.recorded} / ${summary.attendance.total}</strong><small>${summary.attendance.unresolved ? `${summary.attendance.unresolved} unmarked` : 'Complete'}</small></button>
          <button type="button" onclick="switchTab('tasks')"><span>Tasks due</span><strong>${summary.dueToday + summary.overdue}</strong><small>${summary.overdue ? `${summary.overdue} overdue` : 'Today'}</small></button>
          <button type="button" onclick="toggleExtraTabs(true);switchTab('defects')"><span>Open issues</span><strong>${summary.issues.length}</strong><small>${summary.issues.length ? 'Follow-up needed' : 'On track'}</small></button>
          <button type="button" onclick="switchTab('materials')"><span>Deliveries</span><strong>${summary.deliveries.length}</strong><small>${summary.deliveries.length ? 'Pending' : 'On track'}</small></button>
        </div>
      </section>

      <section class="apm-project-quick" aria-label="Project quick actions">
        <button type="button" onclick="switchTab('labor')">Attendance</button>
        <button type="button" onclick="switchTab('materials')">New Material Request</button>
        <button type="button" onclick="switchTab('sitelog')">Site Update</button>
        <button type="button" onclick="toggleExtraTabs(true);switchTab('defects')">Add Issue</button>
      </section>

      <section class="apm-current-work" aria-labelledby="apmCurrentWorkTitle">
        <div class="apm-section-head"><div><span class="apm-eyebrow">Level 2</span><h3 id="apmCurrentWorkTitle">Current work</h3></div></div>
        <div class="apm-work-block">
          <div class="apm-work-head"><h4>Tasks</h4><button type="button" onclick="switchTab('tasks')">View tasks</button></div>
          <div class="apm-table-wrap"><table><thead><tr><th>Task</th><th>Status</th><th>Due</th></tr></thead><tbody>${taskRows.length ? taskRows.map(task => `<tr><td>${h(task.title || task.task || 'Task')}</td><td>${h(status(task.status || 'pending').replace(/_/g, ' '))}</td><td>${h(dueDate(task) || 'Not set')}</td></tr>`).join('') : '<tr><td colspan="3">No active tasks.</td></tr>'}</tbody></table></div>
        </div>
        <div class="apm-work-block">
          <div class="apm-work-head"><h4>Materials</h4><button type="button" onclick="switchTab('materials')">View materials</button></div>
          <div class="apm-table-wrap"><table><thead><tr><th>Item</th><th>Ordered</th><th>Received</th><th>Pending</th></tr></thead><tbody>${materials.length ? materials.map(item => `<tr><td>${h(item.name)}</td><td>${h(item.ordered)} ${h(item.unit)}</td><td>${h(item.received)} ${h(item.unit)}</td><td>${h(item.pending)} ${h(item.unit)}</td></tr>`).join('') : '<tr><td colspan="4">No pending material deliveries.</td></tr>'}</tbody></table></div>
        </div>
        <div class="apm-work-block">
          <div class="apm-work-head"><h4>Site issues</h4><button type="button" onclick="toggleExtraTabs(true);switchTab('defects')">View issues</button></div>
          <div class="apm-table-wrap"><table><thead><tr><th>Issue / Area</th><th>Status</th><th>Age</th><th>Next action</th></tr></thead><tbody>${issues.length ? issues.map(issue => `<tr><td>${h(issue.issue || issue.title || issue.description || 'Site issue')}<small>${h(issue.area || issue.location || '')}</small></td><td>${h(status(issue.status || 'new').replace(/_/g, ' '))}</td><td>${h(ageLabel(issue.createdAt || issue.reportedAt || issue.date))}</td><td>${status(issue.status) === 'blocked' ? 'Resolve blocker' : 'Follow up'}</td></tr>`).join('') : '<tr><td colspan="4">No open site issues.</td></tr>'}</tbody></table></div>
        </div>
      </section>

      <details class="apm-advanced-details">
        <summary>View project details</summary>
        <div class="apm-detail-grid">
          <div><span>Started</span><strong>${h(project.startDate || project.dateStarted || project.createdDate || 'Not set')}</strong></div>
          <div><span>Active workers</span><strong>${activeWorkers(project).length}</strong></div>
          <div><span>Pending material requests</span><strong>${summary.requests.length}</strong></div>
          <div><span>Project status</span><strong>${h(project.status || 'active')}</strong></div>
        </div>
      </details>
    </div>`;
    return true;
  }

  function configureApmWorkspaceNavigation() {
    if (!isApm()) return false;
    const group = document.querySelector('#workspaceView > .tab-scroll > .tab-group');
    if (!group) return false;
    const labels = {
      tab_dashboard: 'Home', tab_labor: 'Attendance', tab_tasks: 'Tasks',
      tab_materials: 'Materials', tab_sitelog: 'Site', extrasToggleBtn: window._apmMoreExpanded ? 'Less' : 'More'
    };
    Object.entries(labels).forEach(([id, label]) => {
      const button = byId(id);
      if (button) button.textContent = label;
    });
    ['tab_dashboard', 'tab_labor', 'tab_tasks', 'tab_materials', 'tab_sitelog', 'extrasToggleBtn',
      'tab_changeorders', 'tab_suppliers', 'tab_equipment', 'tab_compliance', 'tab_defects', 'tab_reports', 'tab_admin']
      .forEach(id => {
        const button = byId(id);
        if (button) group.appendChild(button);
      });
    return true;
  }

  window.isApmWorkspaceUser = isApm;
  window.renderApmHome = renderApmHome;
  window.renderApmProjectHome = renderApmProjectHome;
  window.configureApmWorkspaceNavigation = configureApmWorkspaceNavigation;
  window.openApmProjectTab = openApmProjectTab;
  window.openApmQuickAction = openApmQuickAction;
  window.rememberApmQuickProject = rememberApmQuickProject;
  window.filterApmProjects = filterApmProjects;
  window.showApmHomeSection = showApmHomeSection;
  window.toggleApmHomeMore = toggleApmHomeMore;
  window.getApmWorkspaceDiagnostics = function () {
    return {
      active: isApm(),
      projects: state.projects.length,
      attention: attentionItems(state.projects.filter(activeProject)).length,
      moreOpen: state.moreOpen,
      selectedProjectId: selectedProjectId()
    };
  };
})();
