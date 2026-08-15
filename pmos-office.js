(function () {
  /* ---- Subscription Manager gate ---- */
  var SUB = typeof PMOSSubscriptionManager !== 'undefined' ? PMOSSubscriptionManager : null;
  var PAG = typeof PMOSPagination !== 'undefined' ? PMOSPagination : null;

  const STATUS_WORKFLOW = ['New', 'Reviewed', 'In Progress', 'Waiting', 'Done', 'Archived'];
  const MATERIAL_STATUSES = ['Pending', 'Approved', 'Bought', 'Delivered', 'Cancelled'];
  const MODULES = [
    { key: 'updates', label: 'Quick Updates', collection: 'pmosUpdates', title: r => r.note || r.category || 'Quick update' },
    { key: 'siteLogs', label: 'Site Logs', collection: 'pmosSiteLogs', title: r => r.accomplishment || r.remarks || 'Site log' },
    { key: 'issues', label: 'Issues', collection: 'pmosIssues', title: r => r.issue || r.location || 'Issue' },
    { key: 'materials', label: 'Material Requests', collection: 'pmosMaterialRequests', title: r => r.item || 'Material request' },
    { key: 'tasks', label: 'Follow-ups', collection: 'pmosTasks', title: r => r.task || r.title || 'Follow-up task' },
    { key: 'acpmTasks', label: 'ACPM Tasks', collection: 'tasks', title: r => r.title || 'Task' },
    { key: 'photos', label: 'Photo Proofs', collection: 'pmosPhotoLogs', title: r => r.caption || r.location || 'Photo proof' },
    { key: 'meetings', label: 'Meeting Notes', collection: 'pmosMeetingNotes', title: r => r.meetingTitle || r.meetingType || 'Meeting note' }
  ];

  var PAGE_SIZES = {
    inbox: 30,
    feed: 30,
    issues: 30,
    materials: 25,
    tasks: 30,
    sitelogs: 20,
    photos: 30,
    meetings: 20
  };

  const state = {
    initialized: false,
    projects: [],
    records: [],
    activeView: 'inbox',
    globalReadDeniedNotified: false,
    fallbackReadDeniedNotified: false,
    paginators: {},
    pagination: {},  // { viewName: { page, hasMore, loading, records, cursorKey } }
    lastProjectId: '',
    lastFilterKey: '',
    initialLoading: true  // True until first data arrives from any source
  };

  /* ---- Pagination helpers ---- */
  function getPagination(viewName) {
    if (!state.pagination[viewName]) {
      state.pagination[viewName] = { page: 0, hasMore: true, loading: false, records: [], cursorKey: null, error: null };
    }
    return state.pagination[viewName];
  }

  function resetPagination(viewName) {
    state.pagination[viewName] = { page: 0, hasMore: true, loading: false, records: [], cursorKey: null, error: null };
  }

  /* Wire resetPagination into filter/project changes */
  function resetPaginationForCurrentView() {
    resetPagination(state.activeView);
  }

  function loadMoreView(viewName) {
    var pag = getPagination(viewName);
    if (pag.loading || !pag.hasMore) return;
    pag.loading = true;
    state.initialLoading = false;  // First pagination clears initial loading
    renderPmosOffice();  // Show loading state

    var pageSize = PAGE_SIZES[viewName] || 30;
    var projectId = state.lastProjectId;

    /* Inbox/Feed must query ALL 7 collections; other views query only their own */
    var ALL_COLLECTIONS = ['pmosUpdates', 'pmosSiteLogs', 'pmosIssues', 'pmosMaterialRequests', 'pmosTasks', 'tasks', 'pmosPhotoLogs', 'pmosMeetingNotes'];
    var collections;
    if (viewName === 'inbox' || viewName === 'feed') {
      collections = ALL_COLLECTIONS;
    } else {
      collections = [collectionForView(viewName)];
    }

    /* Build queries for each collection in parallel */
    var queryDefs = collections.map(function (collection) {
      var ref;
      if (projectId) {
        ref = firebase.database().ref('projects/' + projectId + '/' + collection);
      } else {
        ref = firebase.database().ref(collection);
      }
      var q = ref.orderByChild('createdAt');
      if (pag.cursorKey) {
        q = q.endAt(pag.cursorKey);
      }
      q = q.limitToLast(pageSize + 1);
      return { collection: collection, query: q };
    });

    /* Execute all queries in parallel, merge results */
    /* Use per-query catch() so one denied collection doesn't block others */
    Promise.all(queryDefs.map(function (qd) {
      return qd.query.once('value').then(function (snap) {
        var items = [];
        snap.forEach(function (child) {
          var val = child.val() || {};
          items.push({
            id: val.id || child.key,
            _key: child.key,
            _createdAt: val.createdAt || 0,
            collection: qd.collection,
            ...val
          });
        });
        return items;
      }).catch(function () {
        return [];  // Gracefully skip collections that fail (e.g. restricted access)
      });
    }))
    .then(function (results) {
      /* Merge items from all collections, newest-first */
      var allItems = [];
      results.forEach(function (items) {
        allItems = allItems.concat(items);
      });
      allItems.sort(function (a, b) {
        return (b._createdAt || 0) - (a._createdAt || 0);
      });

      /* Check boundary: allItems > pageSize means we have more */
      if (allItems.length > pageSize) {
        pag.hasMore = true;
        allItems = allItems.slice(0, pageSize);
      } else {
        pag.hasMore = false;
      }

      /* Dedup against existing pagination records by collection|key */
      var existingKeys = {};
      pag.records.forEach(function (r) { existingKeys[(r.collection||'')+'|'+(r._key||'')] = true; });
      var newItems = [];
      allItems.forEach(function (item) {
        var dedupKey = (item.collection||'')+'|'+(item._key||'');
        if (!existingKeys[dedupKey]) {
          newItems.push(item);
          existingKeys[dedupKey] = true;
        }
      });

      pag.records = pag.records.concat(newItems);
      pag.page++;
      pag.loading = false;
      pag.error = null;

      /* Set cursor for next page (last item's createdAt across all collections) */
      if (newItems.length > 0) {
        var last = newItems[newItems.length - 1];
        pag.cursorKey = last.createdAt || last._createdAt || 0;
      } else {
        pag.hasMore = false;
      }

      renderPmosOffice();
    })
    ['catch'](function (err) {
      pag.loading = false;
      pag.error = err;
      renderPmosOffice();
    });
  }
  window.loadMoreView = loadMoreView;

  function collectionForView(viewName) {
    var map = {
      inbox: 'pmosUpdates',
      feed: 'pmosUpdates',
      issues: 'pmosIssues',
      materials: 'pmosMaterialRequests',
      tasks: 'pmosTasks',
      sitelogs: 'pmosSiteLogs',
      photos: 'pmosPhotoLogs',
      meetings: 'pmosMeetingNotes'
    };
    return map[viewName] || 'pmosUpdates';
  }

  function loadMoreMarkup(viewName) {
    var pag = getPagination(viewName);
    if (!pag.hasMore && pag.records.length === 0 && !pag.error) return '';
    if (!pag.hasMore && pag.records.length > 0) {
      return '<div class="pmos-load-more-wrap"><span class="pmos-end-hint">All records loaded.</span></div>';
    }
    if (pag.loading) {
      /* Show shimmer skeleton rows while loading */
      return '<div class="pmos-skeleton-office-list">' + skeletonOfficeRows(3) + '</div>';
    }
    if (pag.error) {
      return '<div class="pmos-load-more-wrap"><button class="btn-ws-secondary" onclick="loadMoreView(\'' + viewName + '\')">Retry</button> <span class="pmos-error-hint">Could not load more.</span></div>';
    }
    return '<div class="pmos-load-more-wrap"><button class="btn-ws-secondary" onclick="loadMoreView(\'' + viewName + '\')">Load More</button></div>';
  }

  /* Generate N skeleton office rows for loading states */
  function skeletonOfficeRows(count) {
    var widths = [
      { title: '72%', meta: '48%' },
      { title: '64%', meta: '52%' },
      { title: '78%', meta: '40%' },
      { title: '68%', meta: '55%' }
    ];
    var html = '';
    for (var i = 0; i < count; i++) {
      var w = widths[i % widths.length];
      html += '<div class="pmos-skeleton-office-row">' +
        '<div class="skeleton skeleton-text" style="width:' + w.title + ';height:16px"></div>' +
        '<div class="skeleton skeleton-text" style="width:' + w.meta + ';height:12px"></div>' +
      '</div>';
    }
    return html;
  }

  /* ---- View-specific key helpers for subscription manager ---- */
  function viewGroup(view) { return 'pmos-office-' + view; }
  function moduleGroup(mod) { return 'pmos-module-' + mod.collection; }
  function projectGroup(pid) { return 'pmos-project-' + (pid || 'all'); }
  function filterKey() { return (state.activeView || '') + '|' + (state.lastProjectId || '') + '|' + (state.lastFilterKey || ''); }

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

  function projectInfo(pid) {
    return state.projects.find(p => p.id === pid) || null;
  }

  function projectName(pid, fallback = '') {
    return projectInfo(pid)?.name || fallback || 'Unknown project';
  }

  function projectIsOperational(pid) {
    if (!pid) return true;
    const project = projectInfo(pid);
    if (!project) return false;
    return !['completed', 'archived', 'done'].includes(String(project.status || 'active').toLowerCase());
  }

  function visibleProjects() {
    return state.projects.filter(p => projectIsOperational(p.id));
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
          ${['inbox', 'feed', 'issues', 'materials', 'tasks', 'sitelogs', 'photos', 'meetings', 'reports'].map(view => `<button id="pmosOfficeTab_${view}" type="button" onclick="showPmosOfficeView('${view}')">${viewLabel(view)}</button>`).join('')}
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
      photos: 'Photo Proof Gallery',
      meetings: 'Meeting Notes',
      reports: 'Reports'
    }[view] || view;
  }

  /* ---- Logout cleanup listener ---- */
  function pmosOfficeLogoutCleanup() {
    if (SUB) {
      Object.keys(VIEW_GROUPS).forEach(function (v) {
        SUB.unsubscribeGroup(VIEW_GROUPS[v]);
      });
    }
  }

  /* Auth listener for logout cleanup */
  if (typeof firebase !== 'undefined') {
    firebase.auth().onAuthStateChanged(function (user) {
      if (!user && SUB) {
        pmosOfficeLogoutCleanup();
      }
    });
  }

  async function initPmosOffice() {
    injectPmosOffice();

    /* === Single reinit/init path === */
    if (state.initialized) {
      /* Reinit: clean old subs, reload projects, clear stale data, activate current view */
      state.initialLoading = true;  // Reset for re-init skeleton state
      await loadOfficeProjects();
      state.records = [];
      state.pagination = {};
      if (SUB) {
        pmosOfficeLogoutCleanup();
        SUB.enableDiagnostics(false);
        activatePMOSOfficeView(state.activeView || 'inbox', { projectId: state.lastProjectId });
      } else {
        renderPmosOffice();
      }
      return;
    }

    /* === First init === */
    state.initialized = true;
    await loadOfficeProjects();

    if (SUB) {
      SUB.enableDiagnostics(false);
      activatePMOSOfficeView(state.activeView || 'inbox', { projectId: state.lastProjectId });
      return;
    }

    /* ----- Fallback: direct listeners (legacy, first init only) ----- */
    MODULES.forEach(mod => {
      const sourceKey = 'root:' + mod.collection;
      const ref = firebase.database().ref(mod.collection).limitToLast(300);
      ref.on('value', function (snap) {
        state.records = state.records.filter(function (r) { return r.sourceKey !== sourceKey; });
        snap.forEach(function (child) {
          var record = child.val() || {};
          if (officeCanSeeProject(record.projectId)) {
            state.records.push({
              ...record,
              id: record.id || child.key,
              collection: mod.collection,
              moduleKey: mod.key,
              moduleLabel: mod.label,
              sourceKey: sourceKey
            });
          }
        });
        renderPmosOffice();
      }, function (err) { return noteOfficeReadFallback(err, 'global'); });
    });
    state.projects.forEach(function (project) {
      MODULES.forEach(function (mod) {
        var sourceKey = 'project:' + project.id + ':' + mod.collection;
        var ref = firebase.database().ref('projects/' + project.id + '/' + mod.collection).limitToLast(120);
        ref.on('value', function (snap) {
          state.records = state.records.filter(function (r) { return r.sourceKey !== sourceKey; });
          snap.forEach(function (child) {
            var record = child.val() || {};
            if (officeCanSeeProject(record.projectId || project.id)) {
              state.records.push({
                ...record,
                id: record.id || child.key,
                projectId: record.projectId || project.id,
                projectName: record.projectName || project.name || project.id,
                collection: mod.collection,
                moduleKey: mod.key,
                moduleLabel: mod.label,
                sourceKey: sourceKey
              });
            }
          });
          renderPmosOffice();
        }, function (err) { return noteOfficeReadFallback(err, 'project fallback'); });
      });
    });
    var projectFallbackRef = firebase.database().ref('projects');
    projectFallbackRef.on('value', function (snap) {
      MODULES.forEach(function (mod) {
        var sourcePrefix = 'project-root:' + mod.collection;
        state.records = state.records.filter(function (r) { return r.sourceKey !== sourcePrefix; });
        snap.forEach(function (projectSnap) {
          var project = projectSnap.val() || {};
          var rows = project[mod.collection] || {};
          Object.keys(rows).forEach(function (id) {
            var record = rows[id] || {};
            var projectId = record.projectId || projectSnap.key;
            if (officeCanSeeProject(projectId)) {
              state.records.push({
                ...(record || {}),
                id: record.id || id,
                projectId: projectId,
                projectName: record.projectName || project.name || projectId,
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
    }, function (err) { return noteOfficeReadFallback(err, 'project-root fallback'); });
    renderPmosOffice();
  }

  /* ---- Subscription Manager wiring ---- */
  /* ---- View-aware subscription groups ---- */
  var VIEW_GROUPS = {
    inbox: 'pmos-inbox',
    feed: 'pmos-project-feed',
    issues: 'pmos-issues',
    materials: 'pmos-materials',
    tasks: 'pmos-followups',
    sitelogs: 'pmos-site-logs',
    photos: 'pmos-photos',
    meetings: 'pmos-meeting-notes',
    reports: 'pmos-reports'
  };

  /* ---- Activate a view: unsubscribe previous, subscribe new, render ---- */
  function activatePMOSOfficeView(viewName, options) {
    options = options || {};
    var previousGroup = VIEW_GROUPS[state.activeView] || '';
    var newGroup = VIEW_GROUPS[viewName] || '';
    var selectedProjectId = options.projectId || state.lastProjectId || '';
    var previousProjectId = state.lastProjectId;

    // Unsubscribe previous view's subscriptions if different group
    if (previousGroup && previousGroup !== newGroup && SUB) {
      SUB.unsubscribeGroup(previousGroup);
    }

    // Flush records from previous project if project changed
    if (previousProjectId && selectedProjectId && previousProjectId !== selectedProjectId) {
      state.records = state.records.filter(function (r) {
        return r.projectId !== previousProjectId;
      });
      // Reset pagination for new project
      resetPagination(viewName);
    }

    state.activeView = viewName;
    state.lastProjectId = selectedProjectId;

    // Subscribe to the new view's required paths
    if (SUB) {
      subscribeView(viewName, newGroup, selectedProjectId);
    }

    renderPmosOffice();
  }

  /* ---- Subscribe only the paths needed by a specific view ---- */
  function subscribeView(viewName, group, projectId) {
    if (!SUB) return;

    // If we have a projectId, listen to project-scoped paths
    switch (viewName) {
      case 'inbox':
        // Inbox: bounded recent records from ALL modules
        MODULES.forEach(function (mod) {
          SUB.subscribe({
            key: 'inbox:' + mod.collection,
            group: group,
            module: mod.key,
            projectId: '',
            queryFactory: function () {
              return firebase.database().ref(mod.collection).limitToLast(100);
            },
            callback: function (snap) {
              handleModuleSnapshot(snap, mod, 'inbox:' + mod.collection, true);
            },
            errorCallback: function (err) { noteOfficeReadFallback(err, 'global'); }
          });
          // Also project-scoped if projectId
          if (projectId) {
            SUB.subscribe({
              key: 'inbox:project:' + projectId + ':' + mod.collection,
              group: group,
              module: mod.key,
              projectId: projectId,
              queryFactory: function () {
                return firebase.database().ref('projects/' + projectId + '/' + mod.collection).limitToLast(50);
              },
              callback: function (snap) {
                handleModuleSnapshot(snap, mod, 'inbox:project:' + projectId + ':' + mod.collection, false);
              },
              errorCallback: function (err) { /* silent fallback */ }
            });
          }
        });
        break;

      case 'feed':
        // Project Feed: only for the selected project
        if (projectId) {
          MODULES.forEach(function (mod) {
            SUB.subscribe({
              key: 'feed:' + projectId + ':' + mod.collection,
              group: group,
              module: mod.key,
              projectId: projectId,
              queryFactory: function () {
                return firebase.database().ref('projects/' + projectId + '/' + mod.collection).limitToLast(100);
              },
              callback: function (snap) {
                handleModuleSnapshot(snap, mod, 'feed:' + projectId + ':' + mod.collection, false);
              },
              errorCallback: function (err) { /* silent fallback */ }
            });
          });
        } else {
          // No project selected: fallback to inbox-like all-module
          MODULES.forEach(function (mod) {
            SUB.subscribe({
              key: 'feed:all:' + mod.collection,
              group: group,
              module: mod.key,
              projectId: '',
              queryFactory: function () {
                return firebase.database().ref(mod.collection).limitToLast(100);
              },
              callback: function (snap) {
                handleModuleSnapshot(snap, mod, 'feed:all:' + mod.collection, true);
              },
              errorCallback: function (err) { /* silent fallback */ }
            });
          });
        }
        break;

      case 'issues':
        // Issue Board: only issues
        SUB.subscribe({
          key: 'issues:' + (projectId || 'all'),
          group: group,
          module: 'issues',
          projectId: projectId || '',
          queryFactory: function () {
            if (projectId) {
              return firebase.database().ref('projects/' + projectId + '/pmosIssues').limitToLast(100);
            }
            return firebase.database().ref('pmosIssues').limitToLast(100);
          },
          callback: function (snap) {
            handleModuleSnapshot(snap, { key: 'issues', collection: 'pmosIssues', label: 'Issues' }, 'issues:' + (projectId || 'all'), !projectId);
          },
          errorCallback: function (err) { /* silent */ }
        });
        break;

      case 'materials':
        // Material Requests: only materials
        SUB.subscribe({
          key: 'materials:' + (projectId || 'all'),
          group: group,
          module: 'materials',
          projectId: projectId || '',
          queryFactory: function () {
            if (projectId) {
              return firebase.database().ref('projects/' + projectId + '/pmosMaterialRequests').limitToLast(100);
            }
            return firebase.database().ref('pmosMaterialRequests').limitToLast(100);
          },
          callback: function (snap) {
            handleModuleSnapshot(snap, { key: 'materials', collection: 'pmosMaterialRequests', label: 'Material Requests' }, 'materials:' + (projectId || 'all'), !projectId);
          },
          errorCallback: function (err) { /* silent */ }
        });
        break;

      case 'tasks':
        // Follow-ups: listen to both pmosTasks (legacy) AND tasks (canonical)
        SUB.subscribe({
          key: 'tasks:' + (projectId || 'all'),
          group: group,
          module: 'tasks',
          projectId: projectId || '',
          queryFactory: function () {
            if (projectId) {
              return firebase.database().ref('projects/' + projectId + '/pmosTasks').limitToLast(100);
            }
            return firebase.database().ref('pmosTasks').limitToLast(100);
          },
          callback: function (snap) {
            handleModuleSnapshot(snap, { key: 'tasks', collection: 'pmosTasks', label: 'Follow-ups' }, 'tasks:' + (projectId || 'all'), !projectId);
          },
          errorCallback: function (err) { /* silent */ }
        });
        // Also listen to canonical tasks path
        SUB.subscribe({
          key: 'tasks_canonical:' + (projectId || 'all'),
          group: group,
          module: 'acpmTasks',
          projectId: projectId || '',
          queryFactory: function () {
            if (projectId) {
              return firebase.database().ref('projects/' + projectId + '/tasks').limitToLast(100);
            }
            return firebase.database().ref('tasks').limitToLast(100);
          },
          callback: function (snap) {
            handleModuleSnapshot(snap, { key: 'acpmTasks', collection: 'tasks', label: 'ACPM Tasks' }, 'tasks_canonical:' + (projectId || 'all'), !projectId);
          },
          errorCallback: function (err) { /* silent */ }
        });
        break;

      case 'sitelogs':
        // Site Logs: only site logs
        SUB.subscribe({
          key: 'sitelogs:' + (projectId || 'all'),
          group: group,
          module: 'sitelogs',
          projectId: projectId || '',
          queryFactory: function () {
            if (projectId) {
              return firebase.database().ref('projects/' + projectId + '/pmosSiteLogs').limitToLast(100);
            }
            return firebase.database().ref('pmosSiteLogs').limitToLast(100);
          },
          callback: function (snap) {
            handleModuleSnapshot(snap, { key: 'sitelogs', collection: 'pmosSiteLogs', label: 'Site Logs' }, 'sitelogs:' + (projectId || 'all'), !projectId);
          },
          errorCallback: function (err) { /* silent */ }
        });
        break;

      case 'photos':
        // Gallery: only photos
        SUB.subscribe({
          key: 'photos:' + (projectId || 'all'),
          group: group,
          module: 'photos',
          projectId: projectId || '',
          queryFactory: function () {
            if (projectId) {
              return firebase.database().ref('projects/' + projectId + '/pmosPhotoLogs').limitToLast(100);
            }
            return firebase.database().ref('pmosPhotoLogs').limitToLast(100);
          },
          callback: function (snap) {
            handleModuleSnapshot(snap, { key: 'photos', collection: 'pmosPhotoLogs', label: 'Photo Proofs' }, 'photos:' + (projectId || 'all'), !projectId);
          },
          errorCallback: function (err) { /* silent */ }
        });
        break;

      case 'meetings':
        // Meeting Notes: only meetings
        SUB.subscribe({
          key: 'meetings:' + (projectId || 'all'),
          group: group,
          module: 'meetings',
          projectId: projectId || '',
          queryFactory: function () {
            if (projectId) {
              return firebase.database().ref('projects/' + projectId + '/pmosMeetingNotes').limitToLast(100);
            }
            return firebase.database().ref('pmosMeetingNotes').limitToLast(100);
          },
          callback: function (snap) {
            handleModuleSnapshot(snap, { key: 'meetings', collection: 'pmosMeetingNotes', label: 'Meeting Notes' }, 'meetings:' + (projectId || 'all'), !projectId);
          },
          errorCallback: function (err) { /* silent */ }
        });
        break;

      case 'reports':
        // Reports: bounded one-time reads, no permanent listener
        // No subscription needed - reports use one-time reads from allRecords()
        break;

      default:
        // Fallback: subscribe to all modules like inbox
        MODULES.forEach(function (mod) {
          SUB.subscribe({
            key: 'default:' + mod.collection,
            group: group,
            module: mod.key,
            projectId: '',
            queryFactory: function () {
              return firebase.database().ref(mod.collection).limitToLast(100);
            },
            callback: function (snap) {
              handleModuleSnapshot(snap, mod, 'default:' + mod.collection, true);
            },
            errorCallback: function (err) { noteOfficeReadFallback(err, 'global'); }
          });
        });
    }
  }

  function handleModuleSnapshot(snap, mod, sourceKey, isGlobal) {
    state.initialLoading = false;  // Any data arrival clears initial loading
    // Remove existing records with this sourceKey
    state.records = state.records.filter(function (r) { return r.sourceKey !== sourceKey; });

    snap.forEach(function (child) {
      var record = child.val() || {};
      var pid = isGlobal ? record.projectId : (record.projectId || '');
      if (officeCanSeeProject(pid)) {
        state.records.push({
          ...record,
          id: record.id || child.key,
          projectId: pid,
          collection: mod.collection,
          moduleKey: mod.key,
          moduleLabel: mod.label,
          sourceKey: sourceKey
        });
      }
    });

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
    /* Cleanup subscriptions when closing office */
    if (SUB) {
      Object.keys(VIEW_GROUPS).forEach(function (v) {
        SUB.unsubscribeGroup(VIEW_GROUPS[v]);
      });
    }
    $('pmosOfficeView')?.classList.add('hidden');
    if (window._currentPid) $('workspaceView')?.classList.remove('hidden');
    else $('hubView')?.classList.remove('hidden');
  }

  function showPmosOfficeView(view) {
    activatePMOSOfficeView(view, { projectId: state.lastProjectId });
  }

  function allRecords() {
    var seen = new Set();
    // Merge listener records (state.records) with pagination records (pag.records)
    var merged = [].concat(state.records);
    var pag = getPagination(state.activeView);
    if (pag && pag.records.length > 0) {
      merged = merged.concat(pag.records);
    }
    return merged
      .filter(function (r) { return projectIsOperational(r.projectId); })
      .filter(function (r) {
        var key = (r.collection || '') + '|' + (r.projectId || '') + '|' + (r.id || '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  function renderPmosOffice() {
    if (!$('pmosOfficeView') || $('pmosOfficeView').classList.contains('hidden')) return;
    document.querySelectorAll('.pmos-office-tabs button').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.id === 'pmosOfficeTab_' + state.activeView);
    });
    renderPmosStats();

    /* Show skeleton content during initial load */
    var records = allRecords();
    if (state.initialLoading && records.length === 0) {
      setHTML('pmosOfficeContent',
        '<div class="pmos-office-section">' +
          '<h3><span class="skeleton skeleton-text" style="width:120px;height:18px;display:inline-block"></span></h3>' +
          '<div class="pmos-skeleton-office-list">' + skeletonOfficeRows(4) + '</div>' +
        '</div>'
      );
      return;
    }

    var renderers = {
      inbox: renderInbox,
      feed: renderFeed,
      issues: renderIssues,
      materials: renderMaterials,
      tasks: renderTasks,
      sitelogs: renderSiteLogs,
      photos: renderPhotos,
      meetings: renderMeetings,
      reports: renderReports
    };
    setHTML('pmosOfficeContent', (renderers[state.activeView] || renderInbox)());

    /* Wire lightbox after photo gallery renders - MutationObserver to detect gallery insertion */
    if (state.activeView === 'photos' && typeof pmosAttachLightboxToGallery === 'function') {
      var galleryContainer = document.querySelector('.pmos-photo-grid');
      if (galleryContainer) {
        pmosAttachLightboxToGallery('.pmos-photo-grid');
      } else {
        // Gallery not yet in DOM; observe the content area for insertion
        var contentEl = document.getElementById('pmosOfficeContent');
        if (contentEl) {
          var observer = new MutationObserver(function () {
            var grid = document.querySelector('.pmos-photo-grid');
            if (grid) {
              pmosAttachLightboxToGallery('.pmos-photo-grid');
              observer.disconnect();
            }
          });
          observer.observe(contentEl, { childList: true, subtree: true });
          // Safety cleanup after 2 seconds
          setTimeout(function () { observer.disconnect(); }, 2000);
        }
      }
    }
  }

  function renderPmosStats() {
    const records = allRecords();
    if (state.initialLoading && records.length === 0) {
      setHTML('pmosOfficeStats', `
        <div class="skeleton pmos-skeleton-stat"></div>
        <div class="skeleton pmos-skeleton-stat"></div>
        <div class="skeleton pmos-skeleton-stat"></div>
        <div class="skeleton pmos-skeleton-stat"></div>
      `);
      return;
    }
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
    const projectOptions = ['<option value="">All active projects</option>'].concat(visibleProjects().map(p => `<option value="${h(p.id)}">${h(p.name || 'Untitled project')}</option>`)).join('');
    const moduleOptions = ['<option value="">All modules</option>'].concat(MODULES.map(m => `<option value="${h(m.collection)}">${h(m.label)}</option>`)).join('');
    const statusOptions = ['<option value="">All statuses</option>'].concat([...new Set([...STATUS_WORKFLOW, ...MATERIAL_STATUSES])].map(s => `<option value="${h(s)}">${h(s)}</option>`)).join('');
    return `<div class="pmos-filters">
      <select id="${prefix}Project" onchange="resetPaginationForCurrentView(); renderPmosOffice()">${projectOptions}</select>
      <select id="${prefix}Module" onchange="resetPaginationForCurrentView(); renderPmosOffice()">${moduleOptions}</select>
      <select id="${prefix}Status" onchange="resetPaginationForCurrentView(); renderPmosOffice()">${statusOptions}</select>
      <select id="${prefix}Priority" onchange="resetPaginationForCurrentView(); renderPmosOffice()">
        <option value="">All priorities</option><option>Critical</option><option>High</option><option>Normal</option><option>Low</option>
      </select>
      <input id="${prefix}Date" type="date" onchange="resetPaginationForCurrentView(); renderPmosOffice()">
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
    var records = filteredRecords('pmosInbox');
    var pag = getPagination('inbox');
    /* On first render, reset pagination if filters changed */
    if (pag.records.length === 0 && !pag.loading && pag.hasMore) {
      loadMoreView('inbox');
    }
    return '<div class="pmos-office-section">' +
      '<h3>PMOS Inbox</h3>' +
      filtersMarkup('pmosInbox') +
      '<div class="pmos-office-list">' + (records.length ? records.map(recordRow).join('') : '<p class="empty-hint">No PMOS records match the filters.</p>') + '</div>' +
      loadMoreMarkup('inbox') +
    '</div>';
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
        <div class="pmos-row-meta">${h(projectName(r.projectId, r.projectName))} - ${h(r.moduleLabel)}${date ? ` - ${h(date)}` : ''}${r.createdByName ? ` - ${h(r.createdByName)}` : ''}</div>
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
    if (r.company) bits.push(`Company: ${r.company}`);
    if (r.quantity || r.unit) bits.push(`Qty: ${r.quantity || 0} ${r.unit || ''}`);
    return bits.length ? `<div class="pmos-row-detail">${h(bits.join(' | '))}</div>` : '';
  }

  function renderFeed() {
    var records = allRecords();
    var groups = {};
    records.forEach(function (r) {
      var date = r.date || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : 'No date');
      var key = projectName(r.projectId, r.projectName) + '||' + date + '||' + (r.moduleLabel || moduleByCollection(r.collection).label);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    var html = Object.keys(groups).map(function (key) {
      var items = groups[key];
      var parts = key.split('||');
      var project = parts[0], date = parts[1], moduleLabel = parts[2];
      return '<section class="pmos-feed-group">' +
        '<h3>' + h(project) + ' <span>' + h(date) + ' - ' + h(moduleLabel) + '</span></h3>' +
        items.map(function (r) { return recordRow(r); }).join('') +
      '</section>';
    }).join('');
    var pag = getPagination('feed');
    if (pag.records.length === 0 && !pag.loading && pag.hasMore) loadMoreView('feed');
    return html || '<p class="empty-hint">No PMOS project feed records yet.</p>' + loadMoreMarkup('feed');
  }

  function renderIssues() {
    var filter = $('pmosIssueFilter')?.value || 'open';
    var records = allRecords().filter(function (r) { return r.collection === 'pmosIssues'; }).filter(function (r) {
      var status = String(r.status || 'New');
      if (filter === 'done') return status === 'Done';
      if (filter === 'archived') return status === 'Archived';
      return !['Done', 'Archived'].includes(status);
    });
    var pag = getPagination('issues');
    if (pag.records.length === 0 && !pag.loading && pag.hasMore) loadMoreView('issues');
    return '<div class="pmos-office-section">' +
      '<div class="pmos-section-head"><h3>Issue Board</h3><select id="pmosIssueFilter" onchange="resetPaginationForCurrentView(); renderPmosOffice()"><option value="open">Open</option><option value="done">Done</option><option value="archived">Archived</option></select></div>' +
      '<div class="pmos-board">' + (records.length ? records.map(function (r) { return issueCard(r); }).join('') : '<p class="empty-hint">No issues in this lane.</p>') + '</div>' +
      loadMoreMarkup('issues') +
    '</div>';
  }

  function issueCard(r) {
    return `<article class="pmos-board-card">
      <strong>${h(r.issue || 'Issue')}</strong>
      <span>${h(projectName(r.projectId, r.projectName))} - ${h(r.location || 'No location')}</span>
      <span>${h(r.assignedTo || 'Unassigned')} - ${h(r.priority || 'Normal')}</span>
      <select onchange="pmosUpdateStatus('${h(r.collection)}','${h(r.id)}',this.value,'${h(r.projectId || '')}','${h(r.sourceKey || '')}')">
        ${STATUS_WORKFLOW.map(s => `<option value="${h(s)}" ${String(r.status || 'New') === s ? 'selected' : ''}>${h(s)}</option>`).join('')}
      </select>
    </article>`;
  }

  function renderMaterials() {
    var records = allRecords().filter(function (r) { return r.collection === 'pmosMaterialRequests'; });
    var pag = getPagination('materials');
    if (pag.records.length === 0 && !pag.loading && pag.hasMore) loadMoreView('materials');
    return '<div class="pmos-office-section">' +
      '<h3>Material Request Inbox</h3>' +
      '<div class="pmos-office-list">' + (records.length ? records.map(function (r) { return materialRow(r); }).join('') : '<p class="empty-hint">No material requests from PMOS yet.</p>') + '</div>' +
      loadMoreMarkup('materials') +
    '</div>';
  }

  function materialRow(r) {
    return `<article class="pmos-office-row">
      <div>
        <div class="pmos-row-title">${h(r.item || 'Material')}</div>
        <div class="pmos-row-meta">${h(projectName(r.projectId, r.projectName))} - ${h(r.quantity || 0)} ${h(r.unit || '')} - Needed ${h(r.neededDate || '')}</div>
        <div class="pmos-row-detail">${h(r.purpose || '')}</div>
      </div>
      <div class="pmos-row-actions">
        ${MATERIAL_STATUSES.map(s => `<button class="${String(r.status || 'Pending') === s ? 'is-active' : ''}" type="button" onclick="pmosUpdateStatus('${h(r.collection)}','${h(r.id)}','${h(s)}','${h(r.projectId || '')}','${h(r.sourceKey || '')}')">${h(s)}</button>`).join('')}
      </div>
    </article>`;
  }

  function renderTasks() {
    var priorityScore = { Critical: 0, High: 1, Normal: 2, Low: 3 };
    var records = allRecords()
      .filter(function (r) { return r.collection === 'pmosTasks' || r.collection === 'tasks'; })
      .sort(function (a, b) { return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')) || ((priorityScore[a.priority] ?? 9) - (priorityScore[b.priority] ?? 9)); });
    var pag = getPagination('tasks');
    if (pag.records.length === 0 && !pag.loading && pag.hasMore) loadMoreView('tasks');
    return '<div class="pmos-office-section">' +
      '<h3>Follow-up Board</h3>' +
      '<div class="pmos-office-list">' + (records.length ? records.map(function (r) { return recordRow(r); }).join('') : '<p class="empty-hint">No follow-up tasks yet.</p>') + '</div>' +
      loadMoreMarkup('tasks') +
    '</div>';
  }

  function renderSiteLogs() {
    var selectedProject = $('pmosSiteProject')?.value || '';
    var selectedDate = $('pmosSiteDate')?.value || '';
    var projectOptions = ['<option value="">All active projects</option>'].concat(visibleProjects().map(function (p) { return '<option value="' + h(p.id) + '">' + h(p.name || 'Untitled project') + '</option>'; })).join('');
    var records = allRecords().filter(function (r) { return r.collection === 'pmosSiteLogs'; })
      .filter(function (r) { return (!selectedProject || r.projectId === selectedProject) && (!selectedDate || r.date === selectedDate); });
    var pag = getPagination('sitelogs');
    if (pag.records.length === 0 && !pag.loading && pag.hasMore) loadMoreView('sitelogs');
    return '<div class="pmos-office-section">' +
      '<h3>Site Log Viewer</h3>' +
      '<div class="pmos-filters"><select id="pmosSiteProject" onchange="resetPaginationForCurrentView(); renderPmosOffice()">' + projectOptions + '</select><input id="pmosSiteDate" type="date" onchange="resetPaginationForCurrentView(); renderPmosOffice()"></div>' +
      '<div class="pmos-office-list">' + (records.length ? records.map(function (r) { return siteLogCard(r); }).join('') : '<p class="empty-hint">No site logs for this view.</p>') + '</div>' +
      loadMoreMarkup('sitelogs') +
    '</div>';
  }

  function siteLogCard(r) {
    return `<article class="pmos-office-row">
      <div>
        <div class="pmos-row-title">${h(r.date || '')} - ${h(projectName(r.projectId, r.projectName))}</div>
        <div class="pmos-row-meta">Weather: ${h(r.weather || '-')} - Manpower: ${h(r.manpowerCount || 0)}</div>
        <div class="pmos-row-detail">${h(r.accomplishment || '')}${r.remarks ? ` | ${h(r.remarks)}` : ''}</div>
      </div>
    </article>`;
  }

  /* ---- Meeting Notes View ---- */
  function renderMeetings() {
    var f = readFilters('pmosMeeting');
    var records = allRecords().filter(function (r) { return r.collection === 'pmosMeetingNotes'; })
      .filter(function (r) {
        return (!f.project || r.projectId === f.project) &&
          (!f.status || String(r.status || 'Draft') === f.status);
      });
    var projectOptions = ['<option value="">All active projects</option>'].concat(visibleProjects().map(function (p) { return '<option value="' + h(p.id) + '">' + h(p.name || 'Untitled project') + '</option>'; })).join('');
    var statusOptions = ['<option value="">All statuses</option>'].concat(
      (typeof MEETING_STATUSES !== 'undefined' ? MEETING_STATUSES : ['Draft', 'Submitted', 'Reviewed', 'Action Required', 'Closed', 'Archived'])
        .map(function (s) { return '<option value="' + h(s) + '">' + h(s) + '</option>'; })
    ).join('');
    var pag = getPagination('meetings');
    if (pag.records.length === 0 && !pag.loading && pag.hasMore) loadMoreView('meetings');
    return '<div class="pmos-office-section">' +
      '<h3>Meeting Notes</h3>' +
      '<div class="pmos-filters">' +
        '<select id="pmosMeetingProject" onchange="resetPaginationForCurrentView(); renderPmosOffice()">' + projectOptions + '</select>' +
        '<select id="pmosMeetingStatus" onchange="resetPaginationForCurrentView(); renderPmosOffice()">' + statusOptions + '</select>' +
      '</div>' +
      '<div class="pmos-office-list">' + (records.length ? records.map(function (r) { return meetingRow(r); }).join('') : '<p class="empty-hint">No meeting notes found.</p>') + '</div>' +
      '<div class="pmos-report-grid">' +
        (typeof window.pmosPrintMeetingReport === 'function' ? '<button onclick="pmosPrintMeetingReport(allRecords())">Print Meeting Report</button>' : '') +
      '</div>' +
      loadMoreMarkup('meetings') +
    '</div>';
  }

  function meetingRow(r) {
    const date = r.meetingDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '');
    const title = r.meetingTitle || 'Untitled Meeting';
    const status = r.status || 'Draft';
    return `<article class="pmos-office-row">
      <div>
        <div class="pmos-row-title">${h(title)}</div>
        <div class="pmos-row-meta">${h(projectName(r.projectId, r.projectName))} - ${h(r.meetingType || 'Meeting')} - ${date}${r.createdByName ? ` - ${h(r.createdByName)}` : ''}</div>
        <div class="pmos-row-detail">
          ${r.attendees ? `Attendees: ${h(r.attendees)}` : ''}
          ${r.agenda ? ` | ${h(r.agenda).slice(0, 150)}` : ''}
        </div>
        ${r.actionItems ? `<div class="pmos-row-detail"><strong>Actions:</strong> ${h(r.actionItems).slice(0, 200)}</div>` : ''}
      </div>
      <div class="pmos-row-actions">
        <span class="badge badge-${meetingBadgeClass(status)}">${h(status)}</span>
        <select onchange="pmosUpdateMeetingStatus('${h(r.id)}','${h(r.projectId || '')}',this.value)">
          ${(typeof MEETING_STATUSES !== 'undefined' ? MEETING_STATUSES : ['Draft', 'Submitted', 'Reviewed', 'Action Required', 'Closed', 'Archived']).map(s => `<option value="${h(s)}" ${status === s ? 'selected' : ''}>${h(s)}</option>`).join('')}
        </select>
        ${r.actionItems ? `<button type="button" onclick="pmosCreateFollowupFromMeeting('${h(r.id)}','${h(r.projectId || '')}','${h(r.actionItems).slice(0, 120).replace(/'/g, "\\'")}')">Create Follow-up</button>` : ''}
      </div>
    </article>`;
  }

  function meetingBadgeClass(status) {
    if (['Closed', 'Archived'].includes(status)) return 'green';
    if (['Action Required'].includes(status)) return 'red';
    if (['Submitted', 'Reviewed'].includes(status)) return 'blue';
    return 'amber';
  }

  function renderPhotos() {
    const selectedProject = $('pmosPhotoProject')?.value || '';
    const selectedDate = $('pmosPhotoDate')?.value || '';
    const projectOptions = ['<option value="">All active projects</option>'].concat(visibleProjects().map(p => `<option value="${h(p.id)}">${h(p.name || 'Untitled project')}</option>`)).join('');
    const photos = allRecords().filter(r => r.collection === 'pmosPhotoLogs')
      .filter(r => {
        const date = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '';
        return (!selectedProject || r.projectId === selectedProject) && (!selectedDate || date === selectedDate);
      });
    const groups = {};
    photos.forEach(r => {
      const date = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : 'No date';
      const category = r.category || 'Uncategorized';
      const key = `${projectName(r.projectId, r.projectName)}||${date}||${category}`;
      groups[key] = groups[key] || [];
      groups[key].push(r);
    });
    var body = Object.entries(groups).map(function (entry) {
      var key = entry[0], rows = entry[1];
      var parts = key.split('||');
      var project = parts[0], date = parts[1], category = parts[2];
      return '<section class="pmos-feed-group">' +
        '<h3>' + h(project) + ' <span>' + h(date) + ' - ' + h(category) + '</span></h3>' +
        '<div class="pmos-photo-grid" id="pmosPhotoGrid">' + rows.map(function (r) { return photoLogCard(r); }).join('') + '</div>' +
      '</section>';
    }).join('');
    return '<div class="pmos-office-section">' +
      '<h3>Photo Proof Gallery</h3>' +
      '<div class="pmos-filters"><select id="pmosPhotoProject" onchange="resetPaginationForCurrentView(); renderPmosOffice()">' + projectOptions + '</select><input id="pmosPhotoDate" type="date" onchange="resetPaginationForCurrentView(); renderPmosOffice()"></div>' +
      (body || '<p class="empty-hint">No PMOS photo proofs for this view.</p>') +
      '<div class="pmos-load-more-wrap" id="pmosPhotoLoadMore"></div>' +
    '</div>';
  }

  function isDrivePhoto(r) {
    return String(r.storageProvider || '').toLowerCase() === 'google drive' || String(r.photoUrl || '').includes('drive.google.com');
  }

  function driveBadge(r) {
    return isDrivePhoto(r) ? '<span class="pmos-drive-badge">&#x1F4C1; Google Drive</span>' : '';
  }

  function photoLogCard(r, compact = false) {
    const date = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '';
    const thumb = r.thumbnailUrl || r.photoUrl || '';
    const status = r.uploadStatus || 'Synced';
    const original = r.photoUrl ? `<a class="pmos-photo-link" href="${h(r.photoUrl)}" target="_blank" rel="noopener">View Original</a>` : '';
    const title = r.caption || r.location || 'Photo proof';
    if (compact) {
      return `<article class="pmos-office-row pmos-photo-row">
        ${thumb ? `<img class="pmos-photo-thumb" src="${h(thumb)}" alt="">` : '<div class="pmos-photo-thumb pmos-photo-missing">No image</div>'}
        <div>
          <div class="pmos-row-title">${h(title)}</div>
          <div class="pmos-row-meta">${h(projectName(r.projectId, r.projectName))} - ${h(date)}${r.createdByName ? ` - ${h(r.createdByName)}` : ''}</div>
          <div class="pmos-row-detail">${h([r.category ? `Category: ${r.category}` : '', r.location ? `Location: ${r.location}` : '', `Upload: ${status}`].filter(Boolean).join(' | '))}</div>
          ${driveBadge(r)}
        </div>
        <div class="pmos-row-actions">
          <span class="badge badge-purple">${h(r.status || 'New')}</span>
          <span class="badge badge-blue">${h(status)}</span>
          ${STATUS_WORKFLOW.filter(s => ['Reviewed', 'In Progress', 'Done', 'Archived'].includes(s)).map(s => `<button type="button" onclick="pmosUpdateStatus('${h(r.collection)}','${h(r.id)}','${h(s)}','${h(r.projectId || '')}','${h(r.sourceKey || '')}')">${h(s)}</button>`).join('')}
          ${original}
        </div>
      </article>`;
    }
    return `<article class="pmos-photo-card">
      ${thumb ? `<img src="${h(thumb)}" alt="">` : '<div class="pmos-photo-missing">No image</div>'}
      <div class="pmos-photo-card-body">
        <strong>${h(title)}</strong>
        <span>${h(r.location || 'No location')} - ${h(r.category || 'Photo')} - ${h(date)}</span>
        <span>${h(projectName(r.projectId, r.projectName))}</span>
        ${driveBadge(r)}
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
    const pick = {
      daily: records.filter(r => (r.date || new Date(r.createdAt || 0).toISOString().slice(0, 10)) === today),
      issues: records.filter(r => r.collection === 'pmosIssues' && !['Done', 'Archived'].includes(String(r.status || 'New'))),
      materials: records.filter(r => r.collection === 'pmosMaterialRequests'),
      tasks: records.filter(r => (r.collection === 'pmosTasks' || r.collection === 'tasks') && !['Done', 'Archived'].includes(String(r.status || 'New')))
    }[type] || records;
    const title = viewReportTitle(type);
    const rows = pick.map(r => `<tr><td>${h(projectName(r.projectId, r.projectName))}</td><td>${h(r.moduleLabel)}</td><td>${h(moduleByCollection(r.collection).title(r))}</td><td>${h(r.status || '')}</td><td>${h(r.dueDate || r.neededDate || r.date || '')}</td></tr>`).join('');
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
      issues: 'Open Issues Report',
      materials: 'Material Request Summary',
      tasks: 'Follow-up List'
    }[type] || 'PMOS Report';
  }

  document.addEventListener('DOMContentLoaded', injectPmosOffice);

  /* ---- Meeting Notes status update (delegates to meeting-notes.js if loaded) ---- */
  async function pmosUpdateMeetingStatus(id, projectId, status) {
    // If meeting-notes.js already loaded its version, use it
    var meetingFn = window.pmosUpdateMeetingStatus;
    if (typeof meetingFn === 'function' && meetingFn !== pmosUpdateMeetingStatus) {
      return meetingFn(id, projectId, status);
    }
    if (!id) return;
    const update = { status, updatedAt: Date.now(), updatedBy: window._currentUser?.uid || '', updatedByName: window._currentUser?.name || '' };
    try {
      await db.ref(`pmosMeetingNotes/${id}`).update(update);
      showToast(`Meeting status: ${status}`);
    } catch (e) {
      if (projectId && String(e?.code || '').toLowerCase().includes('permission')) {
        try {
          await db.ref(`projects/${projectId}/pmosMeetingNotes/${id}`).update(update);
          showToast(`Meeting status: ${status}`);
          return;
        } catch (fbError) {
          console.error('Meeting status update fallback failed:', fbError);
        }
      }
      console.error('Meeting status update failed:', e);
      showToast('Could not update meeting status.', 'error');
    }
  }

  window.initPmosOffice = initPmosOffice;
  window.openPmosOffice = openPmosOffice;
  window.closePmosOffice = closePmosOffice;
  window.showPmosOfficeView = showPmosOfficeView;
  window.renderPmosOffice = renderPmosOffice;
  window.pmosUpdateStatus = pmosUpdateStatus;
  window.pmosPrintReport = pmosPrintReport;
  window.pmosUpdateMeetingStatus = pmosUpdateMeetingStatus;
  window.renderMeetings = renderMeetings;
})();
