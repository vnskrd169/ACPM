(function () {
  const STATUS_WORKFLOW = ['New', 'Reviewed', 'In Progress', 'Waiting', 'Done', 'Archived'];
  const MATERIAL_STATUSES = ['Pending', 'Approved', 'Bought', 'Delivered', 'Cancelled'];
  const MODULES = [
    { key: 'updates', label: 'Quick Updates', collection: 'pmosUpdates', title: r => r.note || r.category || 'Quick update' },
    { key: 'siteLogs', label: 'Site Logs', collection: 'pmosSiteLogs', title: r => r.accomplishment || r.remarks || 'Site log' },
    { key: 'issues', label: 'Issues', collection: 'pmosIssues', title: r => r.issue || r.location || 'Issue' },
    { key: 'materials', label: 'Material Requests', collection: 'pmosMaterialRequests', title: r => r.item || 'Material request' },
    { key: 'tasks', label: 'Follow-ups', collection: 'pmosTasks', title: r => r.task || 'Follow-up task' },
    { key: 'meetings', label: 'Meeting Notes', collection: 'pmosMeetingNotes', title: r => r.meetingTitle || 'Meeting note' },
    { key: 'photos', label: 'Photo Logs', collection: 'pmosPhotoLogs', title: r => r.caption || r.location || 'Photo log' }
  ];

  const state = {
    initialized: false,
    projects: [],
    records: [],
    listeners: [],
    activeView: 'inbox',
    globalReadDeniedNotified: false,
    fallbackReadDeniedNotified: false
  };

  function h(text) {
    return typeof escapeHtml === 'function' ? escapeHtml(text) : String(text || '');
  }

  function projectList(value) {
    if (typeof normalizeProjectList === 'function') return normalizeProjectList(value);
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (value && typeof value === 'object') {
      return Object.entries(value)
        .filter(([, enabled]) => enabled !== false && enabled !== null)
        .map(([key]) => String(key));
    }
    return [];
  }

  function officeCanSeeProject(pid) {
    const user = window._currentUser || {};
    if (!pid) return true;
    if (typeof isBoss === 'function' && isBoss(user.role)) return true;
    return projectList(user.projects).includes(pid) || projectList(user.bossOf).includes(pid);
  }

  function moduleByCollection(collection) {
    return MODULES.find(m => m.collection === collection) || MODULES[0];
  }

  function projectName(pid) {
    return state.projects.find(p => p.id === pid)?.name || pid || 'No project';
  }

  async function loadOfficeProjects() {
    const user = window._currentUser || {};
    const projects = [];
    if (typeof isBoss === 'function' && isBoss(user.role)) {
      const snap = await db.ref('projects').once('value');
      snap.forEach(child => projects.push({ ...(child.val() || {}), id: child.key }));
    } else {
      const ids = Array.from(new Set([...projectList(user.projects), ...projectList(user.bossOf)]));
      const snaps = await Promise.all(ids.map(id => db.ref(`projects/${id}`).once('value').then(s => [id, s.val()])));
      snaps.forEach(([id, p]) => { if (p) projects.push({ ...p, id }); });
    }
    state.projects = projects.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  function injectPmosOffice() {
    if ($('pmosOfficeView')) return;
    const main = document.querySelector('.main');
    if (!main) return;

    const hubActions = document.querySelector('.hub-command-actions');
    if (hubActions && !$('openPmosOfficeBtn')) {
      hubActions.insertAdjacentHTML('afterbegin', '<button id="openPmosOfficeBtn" class="btn-hub" type="button" onclick="openPmosOffice()">PMOS Office</button><a class="btn-export-hub" href="pmos.html">Open PMOS Mobile</a>');
    }

    const tabGroup = document.querySelector('#workspaceView .tab-group');
    if (tabGroup && !$('tab_pmos')) {
      tabGroup.insertAdjacentHTML('beforeend', '<button id="tab_pmos" class="tab-btn" onclick="openPmosOffice()" data-role-visible="apm,pm,boss,owner,admin">PMOS</button>');
    }

    main.insertAdjacentHTML('beforeend', `
      <section id="pmosOfficeView" class="view-workspace hidden">
        <div class="workspace-head">
          <div>
            <div class="ws-kicker">Line17 PMOS</div>
            <h2>Field Updates Office Center</h2>
            <p>Review, route, track, and print PMOS records captured from the field.</p>
          </div>
          <div class="ws-actions">
            <a class="btn-ws-secondary" href="pmos.html">Open Mobile Capture</a>
            <button class="btn-ws-back" type="button" onclick="closePmosOffice()">Back</button>
          </div>
        </div>

        <div class="pmos-office-stats" id="pmosOfficeStats"></div>
        <div class="pmos-office-tabs">
          ${['inbox', 'feed', 'issues', 'materials', 'tasks', 'sitelogs', 'photos', 'reports'].map(view => `<button id="pmosOfficeTab_${view}" type="button" onclick="showPmosOfficeView('${view}')">${viewLabel(view)}</button>`).join('')}
        </div>
        <div id="pmosOfficeContent" class="pmos-office-content"></div>
      </section>
    `);
  }

  function viewLabel(view) {
    return {
      inbox: 'Inbox',
      feed: 'Project Feed',
      issues: 'Issue Board',
      materials: 'Material Requests',
      tasks: 'Follow-ups',
      sitelogs: 'Site Logs',
      photos: 'Photo Logs',
      reports: 'Reports'
    }[view] || view;
  }

  async function initPmosOffice() {
    injectPmosOffice();
    if (state.initialized) {
      renderPmosOffice();
      return;
    }
    state.initialized = true;
    await loadOfficeProjects();
    MODULES.forEach(mod => {
      const ref = db.ref(mod.collection).limitToLast(300);
      const sourceKey = `root:${mod.collection}`;
      ref.on('value', snap => {
        state.records = state.records.filter(r => r.sourceKey !== sourceKey);
        snap.forEach(child => {
          const record = child.val() || {};
          if (officeCanSeeProject(record.projectId)) {
            state.records.push({
              ...record,
              id: record.id || child.key,
              collection: mod.collection,
              moduleKey: mod.key,
              moduleLabel: mod.label,
              sourceKey
            });
          }
        });
        renderPmosOffice();
      }, err => noteOfficeReadFallback(err, 'global'));
      state.listeners.push(ref);
    });
    state.projects.forEach(project => {
      MODULES.forEach(mod => {
        const ref = db.ref(`projects/${project.id}/${mod.collection}`).limitToLast(120);
        const sourceKey = `project:${project.id}:${mod.collection}`;
        ref.on('value', snap => {
          state.records = state.records.filter(r => r.sourceKey !== sourceKey);
          snap.forEach(child => {
            const record = child.val() || {};
            if (officeCanSeeProject(record.projectId || project.id)) {
              state.records.push({
                ...record,
                id: record.id || child.key,
                projectId: record.projectId || project.id,
                projectName: record.projectName || project.name || project.id,
                collection: mod.collection,
                moduleKey: mod.key,
                moduleLabel: mod.label,
                sourceKey
              });
            }
          });
          renderPmosOffice();
        }, err => noteOfficeReadFallback(err, 'project fallback'));
        state.listeners.push(ref);
      });
    });
    const projectFallbackRef = db.ref('projects');
    projectFallbackRef.on('value', snap => {
      MODULES.forEach(mod => {
        const sourcePrefix = `project-root:${mod.collection}`;
        state.records = state.records.filter(r => r.sourceKey !== sourcePrefix);
        snap.forEach(projectSnap => {
          const project = projectSnap.val() || {};
          const rows = project[mod.collection] || {};
          Object.entries(rows).forEach(([id, record]) => {
            const projectId = record?.projectId || projectSnap.key;
            if (officeCanSeeProject(projectId)) {
              state.records.push({
                ...(record || {}),
                id: record?.id || id,
                projectId,
                projectName: record?.projectName || project.name || projectId,
                collection: mod.collection,
                moduleKey: mod.key,
                moduleLabel: mod.label,
                sourceKey: sourcePrefix
              });
            }
          });
        });
      });
      renderPmosOffice();
    }, err => noteOfficeReadFallback(err, 'project-root fallback'));
    state.listeners.push(projectFallbackRef);
    renderPmosOffice();
  }

  function noteOfficeReadFallback(err, scope = 'global') {
    const permissionDenied = String(err?.code || err?.message || '').toLowerCase().includes('permission');
    if (!permissionDenied) {
      console.warn(`PMOS office ${scope} listener skipped:`, err);
      return;
    }
    if (scope === 'global') {
      if (state.globalReadDeniedNotified) return;
      state.globalReadDeniedNotified = true;
      console.info('PMOS Office global inbox is waiting for deployed Firebase rules. Using project fallback records.');
      showToast('Global PMOS inbox waiting for rules deployment. Using project fallback records.', 'warn');
      return;
    }
    if (state.fallbackReadDeniedNotified) return;
    state.fallbackReadDeniedNotified = true;
    console.info('PMOS Office project fallback listener denied by Firebase rules.');
  }

  function openPmosOffice() {
    injectPmosOffice();
    $('hubView')?.classList.add('hidden');
    $('workspaceView')?.classList.add('hidden');
    $('systemReportsView')?.classList.add('hidden');
    $('pmosOfficeView')?.classList.remove('hidden');
    initPmosOffice();
  }

  function closePmosOffice() {
    $('pmosOfficeView')?.classList.add('hidden');
    if (window._currentPid) $('workspaceView')?.classList.remove('hidden');
    else $('hubView')?.classList.remove('hidden');
  }

  function showPmosOfficeView(view) {
    state.activeView = view;
    renderPmosOffice();
  }

  function allRecords() {
    const seen = new Set();
    return state.records
      .filter(r => {
        const key = `${r.collection || ''}|${r.projectId || ''}|${r.id || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderPmosOffice() {
    if (!$('pmosOfficeView') || $('pmosOfficeView').classList.contains('hidden')) return;
    document.querySelectorAll('.pmos-office-tabs button').forEach(btn => btn.classList.toggle('is-active', btn.id === `pmosOfficeTab_${state.activeView}`));
    renderPmosStats();
    const renderers = {
      inbox: renderInbox,
      feed: renderFeed,
      issues: renderIssues,
      materials: renderMaterials,
      tasks: renderTasks,
      sitelogs: renderSiteLogs,
      photos: renderPhotos,
      reports: renderReports
    };
    setHTML('pmosOfficeContent', (renderers[state.activeView] || renderInbox)());
  }

  function renderPmosStats() {
    const records = allRecords();
    const open = records.filter(r => !['Done', 'Archived', 'Delivered', 'Cancelled'].includes(String(r.status || 'New'))).length;
    const issues = records.filter(r => r.collection === 'pmosIssues' && !['Done', 'Archived'].includes(String(r.status || 'New'))).length;
    const materials = records.filter(r => r.collection === 'pmosMaterialRequests' && !['Delivered', 'Cancelled'].includes(String(r.status || 'Pending'))).length;
    setHTML('pmosOfficeStats', `
      <div><span>Total Records</span><strong>${records.length}</strong></div>
      <div><span>Open Items</span><strong>${open}</strong></div>
      <div><span>Open Issues</span><strong>${issues}</strong></div>
      <div><span>Material Requests</span><strong>${materials}</strong></div>
    `);
  }

  function filtersMarkup(prefix = 'pmosInbox') {
    const projectOptions = ['<option value="">All projects</option>'].concat(state.projects.map(p => `<option value="${h(p.id)}">${h(p.name || p.id)}</option>`)).join('');
    const moduleOptions = ['<option value="">All modules</option>'].concat(MODULES.map(m => `<option value="${h(m.collection)}">${h(m.label)}</option>`)).join('');
    const statusOptions = ['<option value="">All statuses</option>'].concat([...new Set([...STATUS_WORKFLOW, ...MATERIAL_STATUSES])].map(s => `<option value="${h(s)}">${h(s)}</option>`)).join('');
    return `<div class="pmos-filters">
      <select id="${prefix}Project" onchange="renderPmosOffice()">${projectOptions}</select>
      <select id="${prefix}Module" onchange="renderPmosOffice()">${moduleOptions}</select>
      <select id="${prefix}Status" onchange="renderPmosOffice()">${statusOptions}</select>
      <select id="${prefix}Priority" onchange="renderPmosOffice()">
        <option value="">All priorities</option><option>Critical</option><option>High</option><option>Normal</option><option>Low</option>
      </select>
      <input id="${prefix}Date" type="date" onchange="renderPmosOffice()">
    </div>`;
  }

  function readFilters(prefix = 'pmosInbox') {
    return {
      project: $(`${prefix}Project`)?.value || '',
      module: $(`${prefix}Module`)?.value || '',
      status: $(`${prefix}Status`)?.value || '',
      priority: $(`${prefix}Priority`)?.value || '',
      date: $(`${prefix}Date`)?.value || ''
    };
  }

  function filteredRecords(prefix = 'pmosInbox') {
    const f = readFilters(prefix);
    return allRecords().filter(r => {
      const recordDate = r.date || r.dueDate || r.neededDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '');
      return (!f.project || r.projectId === f.project) &&
        (!f.module || r.collection === f.module) &&
        (!f.status || String(r.status || 'New') === f.status) &&
        (!f.priority || String(r.priority || '') === f.priority) &&
        (!f.date || recordDate === f.date);
    });
  }

  function renderInbox() {
    const records = filteredRecords('pmosInbox');
    return `<div class="pmos-office-section">
      <h3>PMOS Inbox</h3>
      ${filtersMarkup('pmosInbox')}
      <div class="pmos-office-list">${records.length ? records.map(recordRow).join('') : '<p class="empty-hint">No PMOS records match the filters.</p>'}</div>
    </div>`;
  }

  function recordRow(r) {
    if (r.collection === 'pmosPhotoLogs') return photoLogCard(r, true);
    const mod = moduleByCollection(r.collection);
    const title = mod.title(r);
    const date = r.date || r.dueDate || r.neededDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '');
    const status = r.status || (r.collection === 'pmosMaterialRequests' ? 'Pending' : 'New');
    return `<article class="pmos-office-row">
      <div>
        <div class="pmos-row-title">${h(title)}</div>
        <div class="pmos-row-meta">${h(projectName(r.projectId))} - ${h(r.moduleLabel)}${date ? ` - ${h(date)}` : ''}${r.createdByName ? ` - ${h(r.createdByName)}` : ''}</div>
        ${recordDetail(r)}
      </div>
      <div class="pmos-row-actions">
        <span class="badge badge-purple">${h(status)}</span>
        ${STATUS_WORKFLOW.filter(s => ['Reviewed', 'In Progress', 'Done', 'Archived'].includes(s)).map(s => `<button type="button" onclick="pmosUpdateStatus('${h(r.collection)}','${h(r.id)}','${h(s)}','${h(r.projectId || '')}','${h(r.sourceKey || '')}')">${h(s)}</button>`).join('')}
      </div>
    </article>`;
  }

  function recordDetail(r) {
    const bits = [];
    if (r.category) bits.push(`Category: ${r.category}`);
    if (r.priority) bits.push(`Priority: ${r.priority}`);
    if (r.location) bits.push(`Location: ${r.location}`);
    if (r.uploadStatus) bits.push(`Upload: ${r.uploadStatus}`);
    if (r.assignedTo) bits.push(`Assigned: ${r.assignedTo}`);
    if (r.person) bits.push(`Person: ${r.person}`);
    if (r.quantity || r.unit) bits.push(`Qty: ${r.quantity || 0} ${r.unit || ''}`);
    return bits.length ? `<div class="pmos-row-detail">${h(bits.join(' | '))}</div>` : '';
  }

  function renderFeed() {
    const records = allRecords();
    const groups = {};
    records.forEach(r => {
      const date = r.date || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : 'No date');
      const key = `${projectName(r.projectId)}||${date}`;
      groups[key] = groups[key] || [];
      groups[key].push(r);
    });
    const html = Object.entries(groups).map(([key, items]) => {
      const [project, date] = key.split('||');
      return `<section class="pmos-feed-group">
        <h3>${h(project)} <span>${h(date)}</span></h3>
        ${items.map(recordRow).join('')}
      </section>`;
    }).join('');
    return html || '<p class="empty-hint">No PMOS project feed records yet.</p>';
  }

  function renderIssues() {
    const filter = $('pmosIssueFilter')?.value || 'open';
    const records = allRecords().filter(r => r.collection === 'pmosIssues').filter(r => {
      const status = String(r.status || 'New');
      if (filter === 'done') return status === 'Done';
      if (filter === 'archived') return status === 'Archived';
      return !['Done', 'Archived'].includes(status);
    });
    return `<div class="pmos-office-section">
      <div class="pmos-section-head"><h3>Issue Board</h3><select id="pmosIssueFilter" onchange="renderPmosOffice()"><option value="open">Open</option><option value="done">Done</option><option value="archived">Archived</option></select></div>
      <div class="pmos-board">${records.length ? records.map(issueCard).join('') : '<p class="empty-hint">No issues in this lane.</p>'}</div>
    </div>`;
  }

  function issueCard(r) {
    return `<article class="pmos-board-card">
      <strong>${h(r.issue || 'Issue')}</strong>
      <span>${h(projectName(r.projectId))} - ${h(r.location || 'No location')}</span>
      <span>${h(r.assignedTo || 'Unassigned')} - ${h(r.priority || 'Normal')}</span>
      <select onchange="pmosUpdateStatus('${h(r.collection)}','${h(r.id)}',this.value,'${h(r.projectId || '')}','${h(r.sourceKey || '')}')">
        ${STATUS_WORKFLOW.map(s => `<option value="${h(s)}" ${String(r.status || 'New') === s ? 'selected' : ''}>${h(s)}</option>`).join('')}
      </select>
    </article>`;
  }

  function renderMaterials() {
    const records = allRecords().filter(r => r.collection === 'pmosMaterialRequests');
    return `<div class="pmos-office-section">
      <h3>Material Request Inbox</h3>
      <div class="pmos-office-list">${records.length ? records.map(materialRow).join('') : '<p class="empty-hint">No material requests from PMOS yet.</p>'}</div>
    </div>`;
  }

  function materialRow(r) {
    return `<article class="pmos-office-row">
      <div>
        <div class="pmos-row-title">${h(r.item || 'Material')}</div>
        <div class="pmos-row-meta">${h(projectName(r.projectId))} - ${h(r.quantity || 0)} ${h(r.unit || '')} - Needed ${h(r.neededDate || '')}</div>
        <div class="pmos-row-detail">${h(r.purpose || '')}</div>
      </div>
      <div class="pmos-row-actions">
        ${MATERIAL_STATUSES.map(s => `<button class="${String(r.status || 'Pending') === s ? 'is-active' : ''}" type="button" onclick="pmosUpdateStatus('${h(r.collection)}','${h(r.id)}','${h(s)}','${h(r.projectId || '')}','${h(r.sourceKey || '')}')">${h(s)}</button>`).join('')}
      </div>
    </article>`;
  }

  function renderTasks() {
    const priorityScore = { Critical: 0, High: 1, Normal: 2, Low: 3 };
    const records = allRecords()
      .filter(r => r.collection === 'pmosTasks')
      .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')) || ((priorityScore[a.priority] ?? 9) - (priorityScore[b.priority] ?? 9)));
    return `<div class="pmos-office-section">
      <h3>Follow-up Board</h3>
      <div class="pmos-office-list">${records.length ? records.map(recordRow).join('') : '<p class="empty-hint">No follow-up tasks yet.</p>'}</div>
    </div>`;
  }

  function renderSiteLogs() {
    const selectedProject = $('pmosSiteProject')?.value || '';
    const selectedDate = $('pmosSiteDate')?.value || '';
    const projectOptions = ['<option value="">All projects</option>'].concat(state.projects.map(p => `<option value="${h(p.id)}">${h(p.name || p.id)}</option>`)).join('');
    const records = allRecords().filter(r => r.collection === 'pmosSiteLogs')
      .filter(r => (!selectedProject || r.projectId === selectedProject) && (!selectedDate || r.date === selectedDate));
    return `<div class="pmos-office-section">
      <h3>Site Log Viewer</h3>
      <div class="pmos-filters"><select id="pmosSiteProject" onchange="renderPmosOffice()">${projectOptions}</select><input id="pmosSiteDate" type="date" onchange="renderPmosOffice()"></div>
      <div class="pmos-office-list">${records.length ? records.map(siteLogCard).join('') : '<p class="empty-hint">No site logs for this view.</p>'}</div>
    </div>`;
  }

  function siteLogCard(r) {
    return `<article class="pmos-office-row">
      <div>
        <div class="pmos-row-title">${h(r.date || '')} - ${h(projectName(r.projectId))}</div>
        <div class="pmos-row-meta">Weather: ${h(r.weather || '-')} - Manpower: ${h(r.manpowerCount || 0)}</div>
        <div class="pmos-row-detail">${h(r.accomplishment || '')}${r.remarks ? ` | ${h(r.remarks)}` : ''}</div>
      </div>
    </article>`;
  }

  function renderPhotos() {
    const selectedProject = $('pmosPhotoProject')?.value || '';
    const selectedDate = $('pmosPhotoDate')?.value || '';
    const projectOptions = ['<option value="">All projects</option>'].concat(state.projects.map(p => `<option value="${h(p.id)}">${h(p.name || p.id)}</option>`)).join('');
    const photos = allRecords().filter(r => r.collection === 'pmosPhotoLogs')
      .filter(r => {
        const date = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '';
        return (!selectedProject || r.projectId === selectedProject) && (!selectedDate || date === selectedDate);
      });
    const groups = {};
    photos.forEach(r => {
      const date = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : 'No date';
      const key = `${projectName(r.projectId)}||${date}`;
      groups[key] = groups[key] || [];
      groups[key].push(r);
    });
    const body = Object.entries(groups).map(([key, rows]) => {
      const [project, date] = key.split('||');
      return `<section class="pmos-feed-group">
        <h3>${h(project)} <span>${h(date)}</span></h3>
        <div class="pmos-photo-grid">${rows.map(r => photoLogCard(r)).join('')}</div>
      </section>`;
    }).join('');
    return `<div class="pmos-office-section">
      <h3>Photo Logs</h3>
      <div class="pmos-filters"><select id="pmosPhotoProject" onchange="renderPmosOffice()">${projectOptions}</select><input id="pmosPhotoDate" type="date" onchange="renderPmosOffice()"></div>
      ${body || '<p class="empty-hint">No PMOS photo logs for this view.</p>'}
    </div>`;
  }

  function photoLogCard(r, compact = false) {
    const date = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '';
    const thumb = r.thumbnailUrl || r.photoUrl || '';
    const status = r.uploadStatus || 'Uploaded';
    const original = r.photoUrl ? `<a class="pmos-photo-link" href="${h(r.photoUrl)}" target="_blank" rel="noopener">Open Photo</a>` : '';
    const title = r.caption || r.location || 'Photo log';
    if (compact) {
      return `<article class="pmos-office-row pmos-photo-row">
        ${thumb ? `<img class="pmos-photo-thumb" src="${h(thumb)}" alt="">` : '<div class="pmos-photo-thumb pmos-photo-missing">No image</div>'}
        <div>
          <div class="pmos-row-title">${h(title)}</div>
          <div class="pmos-row-meta">${h(projectName(r.projectId))} - ${h(date)}${r.createdByName ? ` - ${h(r.createdByName)}` : ''}</div>
          <div class="pmos-row-detail">${h([r.category ? `Category: ${r.category}` : '', r.location ? `Location: ${r.location}` : '', `Upload: ${status}`].filter(Boolean).join(' | '))}</div>
        </div>
        <div class="pmos-row-actions">
          <span class="badge badge-purple">${h(r.status || 'New')}</span>
          <span class="badge badge-blue">${h(status)}</span>
          ${original}
        </div>
      </article>`;
    }
    return `<article class="pmos-photo-card">
      ${thumb ? `<img src="${h(thumb)}" alt="">` : '<div class="pmos-photo-missing">No image</div>'}
      <div class="pmos-photo-card-body">
        <strong>${h(title)}</strong>
        <span>${h(r.location || 'No location')} - ${h(r.category || 'Photo')} - ${h(date)}</span>
        <span>${h(projectName(r.projectId))}</span>
        <div class="pmos-photo-card-actions">
          <b>${h(status)}</b>
          ${original}
        </div>
      </div>
    </article>`;
  }

  function renderReports() {
    return `<div class="pmos-office-section">
      <h3>Report Generator</h3>
      <div class="pmos-report-grid">
        <button onclick="pmosPrintReport('daily')">Daily Site Report</button>
        <button onclick="pmosPrintReport('weekly')">Weekly Project Update</button>
        <button onclick="pmosPrintReport('issues')">Open Issues Report</button>
        <button onclick="pmosPrintReport('materials')">Material Request Summary</button>
        <button onclick="pmosPrintReport('tasks')">Follow-up List</button>
      </div>
      <p class="empty-hint">Reports open in a printable browser window using current PMOS records.</p>
    </div>`;
  }

  async function pmosUpdateStatus(collection, id, status, projectId = '', sourceKey = '') {
    if (!collection || !id) return;
    const update = {
      status,
      reviewedAt: Date.now(),
      reviewedBy: window._currentUser?.uid || '',
      reviewedByName: window._currentUser?.name || '',
      updatedAt: Date.now()
    };
    const useProjectFallback = sourceKey.startsWith('project:') || sourceKey.startsWith('project-root:');
    try {
      if (useProjectFallback && projectId) {
        await db.ref(`projects/${projectId}/${collection}/${id}`).update(update);
      } else {
        await db.ref(`${collection}/${id}`).update(update);
      }
      showToast(`PMOS status set to ${status}`);
    } catch (e) {
      if (projectId && String(e?.code || e?.message || '').toLowerCase().includes('permission')) {
        try {
          await db.ref(`projects/${projectId}/${collection}/${id}`).update(update);
          showToast(`PMOS status set to ${status}`);
          return;
        } catch (fallbackError) {
          console.error('PMOS fallback status update failed:', fallbackError);
        }
      }
      console.error('PMOS status update failed:', e);
      showToast('Could not update PMOS status.', 'error');
    }
  }

  function pmosPrintReport(type) {
    const records = allRecords();
    const today = todayISO();
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const pick = {
      daily: records.filter(r => (r.date || new Date(r.createdAt || 0).toISOString().slice(0, 10)) === today),
      weekly: records.filter(r => (r.createdAt || 0) >= oneWeekAgo),
      issues: records.filter(r => r.collection === 'pmosIssues' && !['Done', 'Archived'].includes(String(r.status || 'New'))),
      materials: records.filter(r => r.collection === 'pmosMaterialRequests'),
      tasks: records.filter(r => r.collection === 'pmosTasks' && !['Done', 'Archived'].includes(String(r.status || 'New')))
    }[type] || records;
    const title = viewReportTitle(type);
    const rows = pick.map(r => `<tr><td>${h(projectName(r.projectId))}</td><td>${h(r.moduleLabel)}</td><td>${h(moduleByCollection(r.collection).title(r))}</td><td>${h(r.status || '')}</td><td>${h(r.dueDate || r.neededDate || r.date || '')}</td></tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) {
      showToast('Popup blocked. Allow popups to print reports.', 'warn');
      return;
    }
    win.document.write(`<!doctype html><html><head><title>${h(title)}</title><style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111} h1{font-size:22px} table{width:100%;border-collapse:collapse;font-size:12px} th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top} th{background:#f3f4f6}
    </style></head><body><h1>${h(title)}</h1><p>Generated ${h(new Date().toLocaleString('en-PH'))}</p><table><thead><tr><th>Project</th><th>Module</th><th>Summary</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No records.</td></tr>'}</tbody></table></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  function viewReportTitle(type) {
    return {
      daily: 'Daily Site Report',
      weekly: 'Weekly Project Update',
      issues: 'Open Issues Report',
      materials: 'Material Request Summary',
      tasks: 'Follow-up List'
    }[type] || 'PMOS Report';
  }

  document.addEventListener('DOMContentLoaded', injectPmosOffice);

  window.initPmosOffice = initPmosOffice;
  window.openPmosOffice = openPmosOffice;
  window.closePmosOffice = closePmosOffice;
  window.showPmosOfficeView = showPmosOfficeView;
  window.renderPmosOffice = renderPmosOffice;
  window.pmosUpdateStatus = pmosUpdateStatus;
  window.pmosPrintReport = pmosPrintReport;
})();
