
//  ACPM — reports.js
//  Executive dashboard, project health scores, variance analysis
//  Cross-project visibility for bosses, team performance metrics
// ════════════════════════════════════════════════════════════

let _reportsListeners = [];
let _teamAdminListener = null;
let _teamUsersCache = [];
let _auditListener = null;
let _projectCache = [];

function initReports() {
  detachReportsListeners();
  renderExecutiveDashboard();
  renderTeamPerformance();
  renderBudgetVariance();
}

function initAdminSummary() {
  const el = $('accountSummary');
  const user = window._currentUser || {};
  if (!el) return;
  el.innerHTML = `
    <div class="summary-table-wrap">
      <table class="summary-table">
        <tbody>
          <tr><td>Name</td><td>${escapeHtml(user.name || 'User')}</td></tr>
          <tr><td>UID</td><td style="font-family:monospace;font-size:11px">${escapeHtml(user.uid || '—')}</td></tr>
          <tr><td>Role</td><td>${escapeHtml(user.role || 'viewer')}</td></tr>
          <tr><td>Projects</td><td>${escapeHtml((user.projects || []).join(', ') || '—')}</td></tr>
          <tr><td>Boss Of</td><td>${escapeHtml((user.bossOf || []).join(', ') || '—')}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function initAuditLog() {
  const user = window._currentUser;
  if (!user || user.role !== 'boss') {
    const el = $('auditLogFeed');
    if (el) el.innerHTML = '<p class="empty-hint">Audit log is available for bosses only.</p>';
    return;
  }
  if (_auditListener) {
    _auditListener.off();
    _auditListener = null;
  }
  const ref = firebase.database().ref('auditLogs');
  _auditListener = ref;
  ref.on('value', snap => {
    const el = $('auditLogFeed');
    if (!el) return;
    const rows = [];
    snap.forEach(c => rows.push({ id: c.key, ...c.val() }));
    rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const projectSel = $('auditFilterProject');
    if (projectSel && !projectSel.dataset.loaded) {
      const projects = [...new Set(rows.map(r => r.projectId).filter(Boolean))].sort();
      projectSel.innerHTML = '<option value="">All projects</option>' + projects.map(pid => `<option value="${escapeHtml(pid)}">${escapeHtml(pid)}</option>`).join('');
      projectSel.dataset.loaded = '1';
    }
    renderAuditLog(rows);
  });
}

function renderAuditLog(rows = []) {
  const el = $('auditLogFeed');
  if (!el) return;
  const actionNeedle = String($('auditFilterAction')?.value || '').trim().toLowerCase();
  const userNeedle = String($('auditFilterUser')?.value || '').trim().toLowerCase();
  const projectNeedle = String($('auditFilterProject')?.value || '').trim().toLowerCase();

  const filtered = rows.filter(r => {
    const action = String(r.action || '').toLowerCase();
    const actor = String(r.userName || r.userId || '').toLowerCase();
    const pid = String(r.projectId || '').toLowerCase();
    return (!actionNeedle || action.includes(actionNeedle)) &&
      (!userNeedle || actor.includes(userNeedle)) &&
      (!projectNeedle || !pid || pid === projectNeedle);
  });

  setText('auditCountBadge', filtered.length);
  if (!filtered.length) {
    el.innerHTML = '<p class="empty-hint">No audit entries found.</p>';
    return;
  }

  el.innerHTML = `<div style="display:grid;gap:8px">
    ${filtered.map(r => `
      <div class="health-card" style="border-left-color:var(--border2)">
        <div class="health-hdr">
          <span class="health-name">${escapeHtml(r.action || 'action')}</span>
          <span class="health-score" style="font-size:12px">${escapeHtml(new Date(r.timestamp || Date.now()).toLocaleString('en-PH'))}</span>
        </div>
        <div style="font-size:12px;color:var(--muted2);line-height:1.5">
          <div><strong>User:</strong> ${escapeHtml(r.userName || r.userId || '—')}</div>
          <div><strong>Entity:</strong> ${escapeHtml(r.entityType || '—')} ${r.entityId ? `· ${escapeHtml(r.entityId)}` : ''}</div>
          <div><strong>Project:</strong> ${escapeHtml(r.projectId || '—')}</div>
          ${r.details ? `<div><strong>Details:</strong> ${escapeHtml(JSON.stringify(r.details))}</div>` : ''}
        </div>
      </div>`).join('')}
  </div>`;
}

function initSystemStatus() {
  const el = $('systemStatus');
  if (!el) return;
  const user = window._currentUser || {};
  el.innerHTML = `
    <div class="summary-table-wrap">
      <table class="summary-table">
        <tbody>
          <tr><td>App</td><td>ACPM</td></tr>
          <tr><td>Current Role</td><td>${escapeHtml(user.role || 'viewer')}</td></tr>
          <tr><td>Current User</td><td>${escapeHtml(user.name || 'User')}</td></tr>
          <tr><td>Project Context</td><td>${escapeHtml(window._currentPid || 'Hub')}</td></tr>
          <tr><td>Offline Cache</td><td>${navigator.onLine ? 'Online' : 'Offline'}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function initTeamAdmin() {
  if (window._currentUser?.role !== 'boss') {
    const el = $('teamAdminList');
    if (el) el.innerHTML = '<p class="empty-hint">Team admin is available for bosses only.</p>';
    return;
  }
  if (_teamAdminListener) {
    _teamAdminListener.off();
    _teamAdminListener = null;
  }
  const ref = firebase.database().ref('users');
  _teamAdminListener = ref;
  ref.on('value', snap => {
    const users = [];
    snap.forEach(c => users.push({ uid: c.key, ...c.val() }));
    users.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    _teamUsersCache = users;
    renderTeamAdmin(users);
  });
  loadProjectsForAssignments();
}

function loadProjectsForAssignments() {
  firebase.database().ref('projects').once('value', snap => {
    const projects = [];
    snap.forEach(c => projects.push({ id: c.key, ...c.val() }));
    projects.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    _projectCache = projects;
    const sel = $('assignProjectList');
    setText('assignProjectCount', projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'}` : 'No projects');
    if (sel) {
      sel.innerHTML = projects.map(p => `
        <label class="assign-proj-row">
          <input type="checkbox" value="${escapeHtml(p.id)}">
          <span>
            <span class="assign-proj-name">${escapeHtml(p.name || p.id)}</span>
            <span class="assign-proj-sub">${escapeHtml(p.status || 'active')}</span>
          </span>
        </label>
      `).join('') || '<p class="empty-hint">No projects yet.</p>';
    }
  });
}

function openProjectAssignModal(uid) {
  const user = _teamUsersCache.find(u => u.uid === uid);
  if (!user) return;
  const title = $('assignUserName');
  const holder = $('assignUserUid');
  const status = $('assignProjectStatus');
  if (title) title.textContent = user.name || 'User';
  if (holder) holder.textContent = uid;
  if (status) status.textContent = normalizeTeamRole(user.role);
  const modal = $('projectAssignModal');
  modal?.classList.remove('hidden');

  loadProjectsForAssignments();
  requestAnimationFrame(() => {
    const picked = new Set(user.projects || []);
    document.querySelectorAll('#assignProjectList input[type="checkbox"]').forEach(cb => {
      cb.checked = picked.has(cb.value);
    });
  });

function closeProjectAssignModal() {
  $('projectAssignModal')?.classList.add('hidden');
}

async function saveProjectAssignments() {
  const uid = $('assignUserUid')?.textContent;
  if (!uid) return;
  const user = _teamUsersCache.find(u => u.uid === uid);
  if (!user) return;
  const projects = Array.from(document.querySelectorAll('#assignProjectList input[type="checkbox"]:checked')).map(cb => cb.value);
  try {
    await firebase.database().ref(`users/${uid}/projects`).set(projects);
    auditLog('update', 'user', uid, { projects });
    showToast(`${user.name || uid} project access updated`);
    closeProjectAssignModal();
    initTeamAdmin();
  } catch (e) {
    console.error('saveProjectAssignments failed:', e);
    showToast(`Failed to update project access: ${e?.message || e?.code || 'permission denied'}`, 'error');
  }
}

function switchAdminSection(section) {
  const sections = ['summary', 'team', 'audit', 'system'];
  sections.forEach(name => {
    const panel = $(`adminSection_${name}`);
    const tab = $(`adminTab_${name}`);
    if (panel) panel.classList.toggle('hidden', name !== section);
    if (tab) tab.classList.toggle('tab-active', name === section);
  });
  if (section === 'team') initTeamAdmin();
  if (section === 'audit' && typeof initAuditLog === 'function') initAuditLog();
  if (section === 'summary' && typeof initAdminSummary === 'function') initAdminSummary();
  if (section === 'system' && typeof initSystemStatus === 'function') initSystemStatus();
}

function refreshTeamAdmin() {
  initTeamAdmin();
}

function normalizeTeamRole(role) {
  const r = String(role || 'viewer').trim().toLowerCase();
  return ['boss', 'apm', 'viewer'].includes(r) ? r : 'viewer';
}

async function updateUserRole(uid, role) {
  if (window._currentUser?.role !== 'boss') {
    showToast('You do not have permission to manage users.', 'error');
    return;
  }
  const nextRole = normalizeTeamRole(role);
  const target = _teamUsersCache.find(u => u.uid === uid);
  if (!target) return;
  if (uid === window._currentUser?.uid && nextRole !== 'boss') {
    showToast('You cannot remove your own boss role from this screen.', 'error');
    return;
  }
  if (!confirm(`Set ${target.name || uid} role to ${nextRole}?`)) return;
  try {
    await firebase.database().ref(`users/${uid}`).update({
      role: nextRole,
      updatedAt: Date.now(),
      updatedBy: window._currentUser?.uid || null
    });
    auditLog('update', 'user', uid, { role: nextRole });
    showToast(`${target.name || uid} set to ${nextRole}`);
    initTeamAdmin();
  } catch (e) {
    console.error('updateUserRole failed:', e);
    showToast(`Failed to update user role: ${e?.message || e?.code || 'permission denied'}`, 'error');
  }
}

function filterTeamUsers(term) {
  const needle = String(term || '').trim().toLowerCase();
  document.querySelectorAll('[data-team-user-row]').forEach(row => {
    const hay = row.getAttribute('data-search') || '';
    row.style.display = !needle || hay.includes(needle) ? '' : 'none';
  });
}

function renderTeamAdmin(users) {
  const el = $('teamAdminList');
  if (!el) return;
  const counts = {
    boss: users.filter(u => normalizeTeamRole(u.role) === 'boss').length,
    apm: users.filter(u => normalizeTeamRole(u.role) === 'apm').length,
    viewer: users.filter(u => normalizeTeamRole(u.role) === 'viewer').length
  };
  setText('teamUserCount', users.length);
  setText('teamBossCount', counts.boss);
  setText('teamApmCount', counts.apm);
  setText('teamViewerCount', counts.viewer);

  if (!users.length) {
    el.innerHTML = '<p class="empty-hint">No users found.</p>';
    return;
  }

  el.innerHTML = `<div style="overflow-x:auto"><table class="summary-table">
    <thead><tr>
      <th>Name</th><th>UID</th><th>Email</th><th>Role / Projects</th><th>Boss Of</th>
    </tr></thead>
    <tbody>
      ${users.map(user => {
        const role = normalizeTeamRole(user.role);
        const search = [user.name, user.email, user.uid, role, ...(user.projects || []), ...(user.bossOf || [])].join(' ').toLowerCase();
        return `<tr data-team-user-row data-search="${escapeHtml(search)}">
          <td>${escapeHtml(user.name || '�')}</td>
          <td style="font-family:monospace;font-size:11px">${escapeHtml(user.uid)}</td>
          <td>${escapeHtml(user.email || '�')}</td>
          <td>
            <div style="display:flex;flex-direction:column;gap:8px;min-width:180px">
              <select onchange="updateUserRole('${user.uid}', this.value)" ${user.uid === window._currentUser?.uid ? 'data-self-role="1"' : ''}>
                <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>viewer</option>
                <option value="apm" ${role === 'apm' ? 'selected' : ''}>apm</option>
                <option value="boss" ${role === 'boss' ? 'selected' : ''}>boss</option>
              </select>
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <span style="color:var(--muted);font-size:11px">${escapeHtml((user.projects || []).join(', ') || 'No project ticked yet')}</span>
                <button class="btn-ws-secondary" style="padding:8px 12px" onclick="openProjectAssignModal('${user.uid}')">Tick Projects</button>
              </div>
            </div>
          </td>
          <td>${escapeHtml((user.bossOf || []).join(', ') || '�')}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
  filterTeamUsers($('userSearch')?.value || '');
}

function detachReportsListeners() {
  _reportsListeners.forEach(ref => ref.off());
  _reportsListeners = [];
}
// ══════════════════════════════════════════════════════
function renderExecutiveDashboard() {
  const user = window._currentUser;
  if (!user || user.role !== 'boss') {
    const el = $('executiveDashboard');
    if (el) el.innerHTML = '<p class="empty-hint">Executive dashboard available for bosses only.</p>';
    return;
  }

  const ref = firebase.database().ref('projects');
  reportsListen(ref, snap => {
    const projects = [];
    snap.forEach(c => projects.push({ id: c.key, ...c.val() }));

    // Health scores
    const healthData = projects.map(p => ({
      ...p,
      health: calculateProjectHealth(p)
    }));

    healthData.sort((a, b) => b.health.score - a.health.score);

    // Render health cards
    const container = $('execProjectHealth');
    if (container) {
      container.innerHTML = healthData.map(p => {
        const h = p.health;
        const color = h.score >= 80 ? 'var(--green)' : h.score >= 60 ? 'var(--amber)' : 'var(--red)';
        const glow = h.score >= 80 ? 'var(--green-glow)' : h.score >= 60 ? 'var(--amber-glow)' : 'var(--red-glow)';
        return `
          <div class="health-card" style="border-left-color:${color}">
            <div class="health-hdr">
              <span class="health-name">${escapeHtml(p.name || 'Untitled')}</span>
              <span class="health-score" style="color:${color}">${h.score}</span>
            </div>
            <div class="health-bars">
              <div class="health-bar-wrap">
                <span>Budget</span>
                <div class="health-bar"><div style="width:${h.budgetPct}%;background:${color}"></div></div>
                <span>${h.budgetPct}%</span>
              </div>
              <div class="health-bar-wrap">
                <span>Schedule</span>
                <div class="health-bar"><div style="width:${h.schedulePct}%;background:${color}"></div></div>
                <span>${h.schedulePct}%</span>
              </div>
              <div class="health-bar-wrap">
                <span>Labor</span>
                <div class="health-bar"><div style="width:${h.laborPct}%;background:${color}"></div></div>
                <span>${h.laborPct}%</span>
              </div>
            </div>
            ${h.warnings.length ? `<div class="health-warn">${h.warnings.map(w => `\u26A0 ${w}`).join('<br>')}</div>` : '<div class="health-ok">\u2713 All clear</div>'}
          </div>
        `;
      }).join('');
    }

    // Summary stats
    const active = projects.filter(p => p.status === 'active').length;
    const totalBudget = projects.reduce((s, p) => s + effectiveBudget(p).total, 0);
    const totalSpent = projects.reduce((s, p) =>
      s + (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0), 0);
    const avgHealth = healthData.length ? Math.round(healthData.reduce((s, p) => s + p.health.score, 0) / healthData.length) : 0;

    setText('execActiveProjects', active);
    setText('execTotalBudget', peso(totalBudget));
    setText('execTotalSpent', peso(totalSpent));
    setText('execAvgHealth', avgHealth + '%');

    const healthEl = $('execAvgHealth');
    if (healthEl) {
      healthEl.style.color = avgHealth >= 80 ? 'var(--green)' : avgHealth >= 60 ? 'var(--amber)' : 'var(--red)';
    }
  });
}

// ══════════════════════════════════════════════════════
//  PROJECT HEALTH ALGORITHM
// ══════════════════════════════════════════════════════
function calculateProjectHealth(p) {
  const eff = effectiveBudget(p);
  const laborSpent = parseFloat(p.laborSpent) || 0;
  const matSpent = parseFloat(p.materialSpent) || 0;
  const totalSpent = laborSpent + matSpent;
  const budgetPct = eff.total ? Math.round((totalSpent / eff.total) * 100) : 0;

  // Budget health (lower is better, but 0% is also bad = no activity)
  let budgetScore = 100;
  if (budgetPct > 95) budgetScore = 30;
  else if (budgetPct > 85) budgetScore = 60;
  else if (budgetPct > 70) budgetScore = 80;
  else if (budgetPct < 5) budgetScore = 50; // No activity yet

  // Schedule health (based on contract dates)
  let scheduleScore = 100;
  const warnings = [];
  if (p.contract?.endDate) {
    const end = new Date(p.contract.endDate);
    const now = new Date();
    const daysLeft = Math.ceil((end - now) / 86400000);
    const start = p.contract.startDate ? new Date(p.contract.startDate) : now;
    const totalDays = Math.max(1, (end - start) / 86400000);
    const elapsedPct = Math.min(100, ((now - start) / (end - start)) * 100);

    if (daysLeft < 0) {
      scheduleScore = 20;
      warnings.push(`Overdue by ${Math.abs(daysLeft)} days`);
    } else if (daysLeft < 14) {
      scheduleScore = 50;
      warnings.push(`${daysLeft} days remaining`);
    } else if (elapsedPct > 80 && budgetPct < 60) {
      scheduleScore = 60;
      warnings.push('Behind schedule');
    }
  }

  // Labor health
  let laborScore = 100;
  const laborBudget = eff.labor;
  if (laborBudget) {
    const laborPct = Math.round((laborSpent / laborBudget) * 100);
    if (laborPct > 95) { laborScore = 40; warnings.push('Labor budget critical'); }
    else if (laborPct > 85) { laborScore = 65; warnings.push('Labor budget warning'); }
  }

  // Overall score (weighted)
  const score = Math.round((budgetScore * 0.4) + (scheduleScore * 0.35) + (laborScore * 0.25));

  return {
    score,
    budgetPct,
    schedulePct: scheduleScore,
    laborPct: laborScore,
    warnings: warnings.slice(0, 3)
  };
}

// ══════════════════════════════════════════════════════
//  TEAM PERFORMANCE
// ══════════════════════════════════════════════════════
function renderTeamPerformance() {
  const ref = firebase.database().ref('projects');
  reportsListen(ref, snap => {
    const el = $('teamPerformance');
    if (!el) return;

    // Aggregate worker data across projects
    const workerStats = {};
    snap.forEach(proj => {
      const pid = proj.key;
      const p = proj.val();
      if (p.workers) {
        Object.entries(p.workers).forEach(([wid, w]) => {
          if (!workerStats[w.name]) {
            workerStats[w.name] = { name: w.name, trade: w.trade, projects: [], totalDays: 0, totalPay: 0 };
          }
          workerStats[w.name].projects.push(p.name || pid);
        });
      }
      // Count attendance
      if (p.attendance) {
        Object.entries(p.attendance).forEach(([wid, days]) => {
          // Find worker name
          let wname = wid;
          if (p.workers && p.workers[wid]) wname = p.workers[wid].name;
          if (!workerStats[wname]) {
            workerStats[wname] = { name: wname, trade: 'Unknown', projects: [], totalDays: 0, totalPay: 0 };
          }
          Object.values(days).forEach(d => {
            if (d.status !== 'absent' && d.status !== 'rest') {
              workerStats[wname].totalDays += (d.status === 'half' ? 0.5 : 1);
            }
          });
        });
      }
    });

    const workers = Object.values(workerStats).sort((a, b) => b.totalDays - a.totalDays);

    if (!workers.length) {
      el.innerHTML = '<p class="empty-hint">No worker data yet.</p>';
      return;
    }

    el.innerHTML = `<div style="overflow-x:auto">
      <table class="summary-table">
        <thead><tr>
          <th>Worker</th><th>Trade</th><th style="text-align:center">Projects</th>
          <th style="text-align:center">Days Worked</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${workers.map(w => `
            <tr class="s-row">
              <td class="s-cell s-bold">${escapeHtml(w.name)}</td>
              <td class="s-cell s-trade">${escapeHtml(w.trade)}</td>
              <td class="s-cell s-center">${w.projects.length}</td>
              <td class="s-cell s-center">${w.totalDays}</td>
              <td class="s-cell">${w.totalDays > 20 ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-amber">Light</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  });
}

// ══════════════════════════════════════════════════════
//  BUDGET VARIANCE ANALYSIS
// ══════════════════════════════════════════════════════
function renderBudgetVariance() {
  const ref = firebase.database().ref('projects');
  reportsListen(ref, snap => {
    const el = $('budgetVariance');
    if (!el) return;

    const rows = [];
    snap.forEach(c => {
      const p = c.val();
      const eff = effectiveBudget(p);
      const laborSpent = parseFloat(p.laborSpent) || 0;
      const matSpent = parseFloat(p.materialSpent) || 0;
      const totalSpent = laborSpent + matSpent;
      const laborVar = eff.labor - laborSpent;
      const matVar = eff.material - matSpent;
      const totalVar = eff.total - totalSpent;

      rows.push({
        name: p.name || 'Untitled',
        laborBudget: eff.labor, laborSpent, laborVar,
        matBudget: eff.material, matSpent, matVar,
        totalBudget: eff.total, totalSpent, totalVar
      });
    });

    if (!rows.length) {
      el.innerHTML = '<p class="empty-hint">No project data.</p>';
      return;
    }

    el.innerHTML = `<div style="overflow-x:auto">
      <table class="summary-table">
        <thead><tr>
          <th>Project</th>
          <th style="text-align:right">Labor Budget</th><th style="text-align:right">Spent</th><th style="text-align:right">Variance</th>
          <th style="text-align:right">Mat Budget</th><th style="text-align:right">Spent</th><th style="text-align:right">Variance</th>
          <th style="text-align:right">Total Var</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr class="s-row">
              <td class="s-cell s-bold">${escapeHtml(r.name)}</td>
              <td class="s-cell s-right">${peso(r.laborBudget)}</td>
              <td class="s-cell s-right">${peso(r.laborSpent)}</td>
              <td class="s-cell s-right ${r.laborVar < 0 ? 'text-red' : 'text-green'}">${peso(r.laborVar)}</td>
              <td class="s-cell s-right">${peso(r.matBudget)}</td>
              <td class="s-cell s-right">${peso(r.matSpent)}</td>
              <td class="s-cell s-right ${r.matVar < 0 ? 'text-red' : 'text-green'}">${peso(r.matVar)}</td>
              <td class="s-cell s-right s-bold ${r.totalVar < 0 ? 'text-red' : 'text-green'}">${peso(r.totalVar)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
  });
}

// ══════════════════════════════════════════════════════
//  WEEKLY REPORT GENERATOR
// ══════════════════════════════════════════════════════
async function generateWeeklyReport() {
  const user = window._currentUser;
  if (!user) return;

  const snap = await firebase.database().ref('projects').once('value');
  const projects = [];
  snap.forEach(c => projects.push({ id: c.key, ...c.val() }));

  // Filter for APM's projects
  const myProjects = user.role === 'boss'
    ? projects
    : projects.filter(p => user.projects?.includes(p.id));

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStr = weekStart.toLocaleDateString('en-PH');

  let report = `WEEKLY PROJECT REPORT\\nGenerated: ${new Date().toLocaleDateString('en-PH')}\\nReporter: ${user.name} (${user.role})\\n${'='.repeat(60)}\\n\\n`;

  myProjects.forEach(p => {
    const eff = effectiveBudget(p);
    const spent = (parseFloat(p.laborSpent) || 0) + (parseFloat(p.materialSpent) || 0);
    const health = calculateProjectHealth(p);

    report += `PROJECT: ${p.name || 'Untitled'}\\n`;
    report += `Status: ${p.status || 'active'} | Health: ${health.score}/100\\n`;
    report += `Budget: ${peso(spent)} / ${peso(eff.total)} (${pct(spent, eff.total)}%)\\n`;
    if (health.warnings.length) {
      report += `Alerts: ${health.warnings.join(', ')}\\n`;
    }
    report += `\\n`;
  });

  downloadTextFile(`WeeklyReport_${todayISO()}.txt`, report, 'text/plain');
  showToast('Weekly report generated!');
}

// ── Expose ──────────────────────────────────────────────────
window.initReports = initReports;
window.initTeamAdmin = initTeamAdmin;
window.switchAdminSection = switchAdminSection;
window.initAdminSummary = initAdminSummary;
window.initAuditLog = initAuditLog;
window.renderAuditLog = renderAuditLog;
window.initSystemStatus = initSystemStatus;
window.openProjectAssignModal = openProjectAssignModal;
window.closeProjectAssignModal = closeProjectAssignModal;
window.saveProjectAssignments = saveProjectAssignments;
window.refreshTeamAdmin = refreshTeamAdmin;
window.filterTeamUsers = filterTeamUsers;
window.updateUserRole = updateUserRole;
window.detachReportsListeners = detachReportsListeners;
window.calculateProjectHealth = calculateProjectHealth;
window.generateWeeklyReport = generateWeeklyReport;
