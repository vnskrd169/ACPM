/* ==========================================================================
   ACPM ↔ PMOS Task Adapter — Canonical task normalization, dual-path reading
   ==========================================================================
   Provides a unified bridge between the ACPM task format (projects/{id}/tasks)
   and the PMOS task format (pmosTasks / projects/{id}/pmosTasks).

   All new writes go to the canonical path: projects/{projectId}/tasks/{taskId}
   Reads check both paths for backward compatibility with existing records.
   ========================================================================== */

(function () {
  'use strict';

  /* ---- Canonical Status Vocabulary ---- */
  var TASK_STATUSES = {
    pending:          { label: 'Pending',          icon: '\u25CB', color: 'var(--muted)' },
    in_progress:      { label: 'In Progress',      icon: '\u25D0', color: 'var(--blue)' },
    blocked:          { label: 'Blocked',          icon: '\u2298', color: 'var(--amber)' },
    for_verification: { label: 'For Verification', icon: '\u25C9', color: 'var(--purple)' },
    completed:        { label: 'Completed',        icon: '\u2713', color: 'var(--green)' },
    cancelled:        { label: 'Cancelled',        icon: '\u00D7', color: 'var(--red)' }
  };

  var TASK_TRANSITIONS = {
    pending:          ['in_progress', 'cancelled'],
    in_progress:      ['blocked', 'for_verification', 'cancelled'],
    blocked:          ['in_progress', 'cancelled'],
    for_verification: ['completed', 'in_progress', 'blocked', 'cancelled'],
    completed:        [],
    cancelled:        []
  };

  /* ---- Legacy Status → Canonical Mapping ---- */
  var STATUS_MAP = {
    'todo':        'pending',
    'in_progress': 'in_progress',
    'review':      'for_verification',
    'done':        'completed',
    'Open':        'pending',
    'In Progress': 'in_progress',
    'Waiting':     'blocked',
    'Done':        'completed',
    'For Verification': 'for_verification',
    'for_verification': 'for_verification',
    'Cancelled':   'cancelled',
    'cancelled':   'cancelled',
    'Archived':    'cancelled',
    'archived':    'cancelled',
    'New':         'pending',
    'closed':      'completed',
    'pending':     'pending',
    'ongoing':     'in_progress'
  };

  /* ---- Legacy Priority → Canonical Mapping ---- */
  var PRIORITY_MAP = {
    'critical': 'critical',
    'high':     'high',
    'normal':   'normal',
    'low':      'low',
    'Critical': 'critical',
    'High':     'high',
    'Normal':   'normal',
    'Low':      'low'
  };

  /* ---- Normalize a single status value to canonical ---- */
  function normalizeStatus(status) {
    return STATUS_MAP[String(status || '').trim()] || 'pending';
  }

  /* ---- Normalize a single priority value to canonical ---- */
  function normalizePriority(priority) {
    return PRIORITY_MAP[String(priority || '').trim()] || 'normal';
  }

  /* ---- Normalize display label for canonical status ---- */
  function statusLabel(canonicalStatus) {
    var entry = TASK_STATUSES[canonicalStatus];
    return entry ? entry.label : (canonicalStatus.charAt(0).toUpperCase() + canonicalStatus.slice(1));
  }

  /* ---- Normalize a task from any source to the canonical schema ---- */
  function normalizeTask(task) {
    if (!task) return null;

    var id        = task.id || task._key || '';
    var projectId = task.projectId || '';
    var isAcpm    = task.title !== undefined || (task._originalCollection || task.collection) === 'tasks';
    var isPmos    = task.task !== undefined || (task._originalCollection || task.collection) === 'pmosTasks' || task.collection === 'pmosTasks';

    if (isAcpm) {
      // ACPM format: { title, description, assignedTo, assignedToName, status, priority, dueDate, progress, ... }
      return {
        id: id,
        projectId: projectId,
        title: task.title || '',
        description: task.description || '',
        assignedToUid: task.assignedToUid || '',
        assignedToName: task.assignedToName || task.assignedTo || '',
        status: normalizeStatus(task.status),
        priority: normalizePriority(task.priority),
        dueDate: task.dueDate || '',
        progress: typeof task.progress === 'number' ? task.progress : 0,
        source: task.source || 'acpm',
        createdBy: task.createdBy || '',
        createdAt: task.createdAt || 0,
        updatedAt: task.updatedAt || 0,
        completedAt: task.completedAt || 0,
        photos: task.photos || null,
        archived: normalizeStatus(task.status) === 'cancelled' || task.archived === true,
        completionNote: task.completionNote || '',
        completionProof: task.completionProof || null,
        blockedReason: task.blockedReason || '',
        budgetImpact: task.budgetImpact || 0,
        category: task.category || '',
        _collection: 'tasks',
        _raw: task
      };
    }

    if (isPmos) {
      // PMOS format: { task, person, company, remarks, status, priority, dueDate, ... }
      // meeting-notes follow-ups: { task, person, status, ... }
      return {
        id: id,
        projectId: projectId,
        title: task.task || task.title || '',
        description: task.remarks || task.description || '',
        assignedToUid: task.assignedToUid || '',
        assignedToName: task.assignedToName || task.person || task.assignedTo || '',
        status: normalizeStatus(task.status),
        priority: normalizePriority(task.priority),
        dueDate: task.dueDate || '',
        progress: typeof task.progress === 'number' ? task.progress : 0,
        source: task.source || 'pmos',
        createdBy: task.createdBy || '',
        createdAt: task.createdAt || 0,
        updatedAt: task.updatedAt || 0,
        completedAt: task.completedAt || 0,
        photos: task.photos || null,
        archived: task.archived === true || normalizeStatus(task.status) === 'cancelled',
        completionNote: task.completionNote || '',
        completionProof: task.completionProof || null,
        blockedReason: task.blockedReason || '',
        budgetImpact: task.budgetImpact || 0,
        category: task.category || '',
        company: task.company || '',
        _collection: 'pmosTasks',
        _raw: task
      };
    }

    // Generic fallback: try best-effort normalization
    return {
      id: id,
      projectId: projectId,
      title: task.task || task.title || '',
      description: task.remarks || task.description || '',
      assignedToUid: task.assignedToUid || '',
      assignedToName: task.assignedToName || task.person || task.assignedTo || '',
      status: normalizeStatus(task.status),
      priority: normalizePriority(task.priority),
      dueDate: task.dueDate || '',
      progress: typeof task.progress === 'number' ? task.progress : 0,
      source: task.source || '',
      createdBy: task.createdBy || '',
      createdAt: task.createdAt || 0,
      updatedAt: task.updatedAt || 0,
      completedAt: task.completedAt || 0,
      photos: task.photos || null,
      archived: task.archived === true || normalizeStatus(task.status) === 'cancelled',
      completionNote: task.completionNote || '',
      completionProof: task.completionProof || null,
      blockedReason: task.blockedReason || '',
      budgetImpact: task.budgetImpact || 0,
      category: task.category || '',
      _collection: task.collection || '',
      _raw: task
    };
  }

  /* ---- Convert canonical task → PMOS format for saving ---- */
  function toPmosFormat(task) {
    var statusLabel = statusLabelFromCanonical(task.status);
    return {
      task: task.title,
      person: task.assignedToName,
      assignedToUid: task.assignedToUid,
      remarks: task.description,
      dueDate: task.dueDate,
      priority: capitalize(task.priority),
      status: statusLabel,
      progress: task.progress || 0,
      source: task.source || 'Line17 PMOS'
    };
  }

  /* ---- Convert canonical task → ACPM format for saving ---- */
  function toAcpmFormat(task) {
    return {
      title: task.title,
      description: task.description,
      assignedTo: task.assignedToName,
      assignedToUid: task.assignedToUid,
      assignedToName: task.assignedToName,
      priority: task.priority,
      dueDate: task.dueDate,
      status: task.status,
      progress: task.progress || 0,
      source: task.source || 'acpm'
    };
  }

  /* ---- Helper: status label from canonical (e.g. 'open' → 'Open', 'in_progress' → 'In Progress') ---- */
  function statusLabelFromCanonical(status) {
    var entry = TASK_STATUSES[status];
    if (entry) return entry.label;
    return status.split('_').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }

  /* ---- Helper: capitalize first letter ---- */
  function capitalize(s) {
    if (!s) return 'Normal';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ---- Read unified tasks from BOTH paths, deduplicate, normalize ---- */
  async function readUnifiedTasks(projectId) {
    var seen = {};
    var allTasks = [];

    // Read from canonical ACPM path
    try {
      var snap1 = await firebase.database().ref('projects/' + projectId + '/tasks').once('value');
      if (snap1.exists()) {
        snap1.forEach(function (child) {
          var task = child.val() || {};
          task.id = task.id || child.key;
          task.projectId = task.projectId || projectId;
          var normalized = normalizeTask(task);
          if (normalized) {
            seen[normalized.id] = true;
            allTasks.push(normalized);
          }
        });
      }
    } catch (e) { /* path may not exist or no permission */ }

    // Read from legacy PMOS path
    try {
      var snap2 = await firebase.database().ref('projects/' + projectId + '/pmosTasks').once('value');
      if (snap2.exists()) {
        snap2.forEach(function (child) {
          var task = child.val() || {};
          task.id = task.id || child.key;
          task.projectId = task.projectId || projectId;
          // Deduplicate in case a migration copied it to both paths
          if (!seen[task.id]) {
            seen[task.id] = true;
            var normalized = normalizeTask(task);
            if (normalized) allTasks.push(normalized);
          }
        });
      }
    } catch (e) { /* path may not exist */ }

    return allTasks;
  }

  /* ---- Create a new task in the canonical path ---- */
  async function createCanonicalTask(projectId, data) {
    var ref = firebase.database().ref('projects/' + projectId + '/tasks').push();
    var now = Date.now();
    var record = {
      id: ref.key,
      projectId: projectId,
      title: data.title || data.task || '',
      description: data.description || data.remarks || '',
      assignedToUid: data.assignedToUid || '',
      assignedToName: data.assignedToName || data.person || data.assignedTo || '',
      assignedTo: data.assignedToName || data.person || data.assignedTo || '',
      performedByName: '',
      status: normalizeStatus(data.status || 'pending'),
      priority: normalizePriority(data.priority || 'normal'),
      startDate: data.startDate || '',
      dueDate: data.dueDate || '',
      progress: typeof data.progress === 'number' ? data.progress : 0,
      verificationAuthority: data.verificationAuthority || 'pm',
      completionProof: data.completionProof || null,
      completionNote: data.completionNote || '',
      comments: data.comments || {},
      attachments: data.attachments || {},
      linkedProcurement: data.linkedProcurement || {},
      linkedIssues: data.linkedIssues || {},
      source: data.source || 'Line17 PMOS',
      createdBy: data.createdBy || (window._currentUser ? window._currentUser.uid : '') || '',
      createdByName: data.createdByName || (window._currentUser ? window._currentUser.name : '') || '',
      createdAt: now,
      updatedAt: now,
      completedAt: data.completedAt || 0,
      photos: data.photos || null,
      archived: false,
      category: data.category || ''
    };

    // Auto-set completedAt
    if (record.status === 'completed') {
      record.completedAt = now;
      record.progress = 100;
    }

    try {
      var eventKey = firebase.database().ref('projects/' + projectId + '/taskEvents').push().key;
      var activityKey = firebase.database().ref('projects/' + projectId + '/activity').push().key;
      var event = {
        type: 'task.created',
        module: 'tasks',
        taskId: ref.key,
        recordId: ref.key,
        projectId: projectId,
        title: record.title,
        fromStatus: null,
        toStatus: record.status,
        createdAt: now,
        createdBy: record.createdBy,
        createdByName: record.createdByName
      };
      var updates = {};
      updates['projects/' + projectId + '/tasks/' + ref.key] = record;
      updates['projects/' + projectId + '/taskEvents/' + eventKey] = event;
      updates['projects/' + projectId + '/activity/' + activityKey] = event;
      await firebase.database().ref().update(updates);
      return { key: ref.key, record: record };
    } catch (e) {
      console.error('Failed to create canonical task:', e);
      throw e;
    }
  }

  /* ---- Update an existing task in the canonical path ---- */
  async function updateCanonicalTask(projectId, taskId, updates) {
    if (!projectId || !taskId) return;

    var safeUpdates = {};
    if (updates.title !== undefined) safeUpdates.title = updates.title;
    if (updates.description !== undefined) safeUpdates.description = updates.description;
    if (updates.assignedToUid !== undefined) safeUpdates.assignedToUid = updates.assignedToUid;
    if (updates.assignedToName !== undefined) safeUpdates.assignedToName = updates.assignedToName;
    if (updates.priority !== undefined) safeUpdates.priority = normalizePriority(updates.priority);
    if (updates.dueDate !== undefined) safeUpdates.dueDate = updates.dueDate;
    if (updates.progress !== undefined) {
      // Lifecycle status changes must use transitionCanonicalTask so PM
      // verification, taskEvents, and project activity cannot be bypassed.
      safeUpdates.progress = Math.max(0, Math.min(99, parseInt(updates.progress) || 0));
    }
    if (updates.photos !== undefined) safeUpdates.photos = updates.photos;
    if (updates.category !== undefined) safeUpdates.category = updates.category;

    safeUpdates.updatedAt = Date.now();
    safeUpdates.updatedBy = (window._currentUser ? window._currentUser.uid : '') || '';
    safeUpdates.updatedByName = (window._currentUser ? window._currentUser.name : '') || '';

    try {
      await firebase.database().ref('projects/' + projectId + '/tasks/' + taskId).update(safeUpdates);
    } catch (e) {
      console.error('Failed to update canonical task:', e);
      throw e;
    }
  }

  async function transitionCanonicalTask(projectId, taskId, requestedStatus, details) {
    if (!projectId || !taskId) throw new Error('Task project and ID are required.');
    var snap = await firebase.database().ref('projects/' + projectId + '/tasks/' + taskId).once('value');
    var task = snap.val();
    if (!task) throw new Error('Task not found.');
    var fromStatus = normalizeStatus(task.status);
    var toStatus = normalizeStatus(requestedStatus);
    var allowed = TASK_TRANSITIONS[fromStatus] || [];
    if (allowed.indexOf(toStatus) === -1) {
      throw new Error(statusLabel(fromStatus) + ' cannot move to ' + statusLabel(toStatus) + '.');
    }

    var actor = window._currentUser || {};
    var role = typeof normalizeRole === 'function' ? normalizeRole(actor.role) : String(actor.role || '').toLowerCase();
    if (toStatus === 'completed' && ['boss', 'owner', 'admin', 'pm'].indexOf(role) === -1) {
      throw new Error('PM verification is required before completion.');
    }

    details = details || {};
    var now = Date.now();
    var taskUpdate = {
      status: toStatus,
      updatedAt: now,
      updatedBy: actor.uid || 'system',
      updatedByName: actor.name || 'System'
    };
    if (toStatus === 'in_progress' && !task.startedAt) {
      taskUpdate.startedAt = now;
      taskUpdate.startDate = new Date(now).toISOString().slice(0, 10);
      taskUpdate.performedByName = actor.name || task.assignedToName || '';
    }
    if (toStatus === 'blocked') taskUpdate.blockedReason = String(details.reason || '').trim();
    if (toStatus === 'for_verification') {
      taskUpdate.progress = 100;
      taskUpdate.submittedForVerificationAt = now;
      taskUpdate.submittedForVerificationBy = actor.uid || 'system';
      taskUpdate.completionNote = String(details.completionNote || '').trim();
      taskUpdate.completionProof = details.completionProof || null;
    }
    if (toStatus === 'completed') {
      taskUpdate.progress = 100;
      taskUpdate.completedAt = now;
      taskUpdate.completedBy = actor.uid || 'system';
      taskUpdate.verifiedAt = now;
      taskUpdate.verifiedBy = actor.uid || 'system';
      taskUpdate.verifiedByName = actor.name || 'System';
    }
    if (toStatus === 'cancelled') {
      taskUpdate.cancelledAt = now;
      taskUpdate.cancelledBy = actor.uid || 'system';
      taskUpdate.cancelReason = String(details.reason || '').trim();
    }

    var eventType = toStatus === 'completed' ? 'task.verified'
      : toStatus === 'for_verification' ? 'task.submitted_for_verification'
      : toStatus === 'in_progress' ? 'task.started'
      : toStatus === 'blocked' ? 'task.blocked'
      : 'task.cancelled';
    var eventKey = firebase.database().ref('projects/' + projectId + '/taskEvents').push().key;
    var activityKey = firebase.database().ref('projects/' + projectId + '/activity').push().key;
    var event = {
      type: eventType,
      module: 'tasks',
      taskId: taskId,
      recordId: taskId,
      projectId: projectId,
      title: task.title || '',
      fromStatus: fromStatus,
      toStatus: toStatus,
      reason: String(details.reason || ''),
      createdAt: now,
      createdBy: actor.uid || 'system',
      createdByName: actor.name || 'System'
    };
    var multi = {};
    multi['projects/' + projectId + '/tasks/' + taskId] = Object.assign({}, task, taskUpdate);
    multi['projects/' + projectId + '/taskEvents/' + eventKey] = event;
    multi['projects/' + projectId + '/activity/' + activityKey] = event;
    await firebase.database().ref().update(multi);
    return Object.assign({}, task, taskUpdate);
  }

  /* ---- Listen to unified tasks from both paths (realtime) ---- */
  function listenUnifiedTasks(projectId, onData) {
    if (!projectId || typeof onData !== 'function') return [];

    var listeners = [];
    var allTasks = {};
    var pendingTimeout = null;

    function mergeAndCallback() {
      if (pendingTimeout) clearTimeout(pendingTimeout);
      pendingTimeout = setTimeout(function () {
        pendingTimeout = null;
        var result = [];
        for (var key in allTasks) {
          if (allTasks.hasOwnProperty(key)) result.push(allTasks[key]);
        }
        result.sort(function (a, b) {
          var aDue = a.dueDate || '9999';
          var bDue = b.dueDate || '9999';
          return aDue.localeCompare(bDue) || (b.createdAt || 0) - (a.createdAt || 0);
        });
        onData(result);
      }, 100);
    }

    // Listen to canonical path
    try {
      var ref1 = firebase.database().ref('projects/' + projectId + '/tasks');
      var cb1 = function (snap) {
        if (!snap.exists()) {
          // Remove only 'tasks' collection tasks
          for (var key in allTasks) {
            if (allTasks.hasOwnProperty(key) && allTasks[key]._collection === 'tasks') {
              delete allTasks[key];
            }
          }
        } else {
          snap.forEach(function (child) {
            var task = child.val() || {};
            task.id = task.id || child.key;
            task.projectId = task.projectId || projectId;
            var normalized = normalizeTask(task);
            if (normalized) allTasks[normalized.id] = normalized;
          });
        }
        mergeAndCallback();
      };
      ref1.on('value', cb1, function () { /* silent permission error */ });
      listeners.push({ ref: ref1, callback: cb1 });
    } catch (e) { /* ignore */ }

    // Listen to legacy PMOS path
    try {
      var ref2 = firebase.database().ref('projects/' + projectId + '/pmosTasks');
      var cb2 = function (snap) {
        if (!snap.exists()) {
          for (var key in allTasks) {
            if (allTasks.hasOwnProperty(key) && allTasks[key]._collection === 'pmosTasks') {
              delete allTasks[key];
            }
          }
        } else {
          snap.forEach(function (child) {
            var task = child.val() || {};
            task.id = task.id || child.key;
            task.projectId = task.projectId || projectId;
            // Don't overwrite canonical if same id exists
            if (allTasks[task.id] && allTasks[task.id]._collection === 'tasks') return;
            var normalized = normalizeTask(task);
            if (normalized) allTasks[normalized.id] = normalized;
          });
        }
        mergeAndCallback();
      };
      ref2.on('value', cb2, function () { /* silent permission error */ });
      listeners.push({ ref: ref2, callback: cb2 });
    } catch (e) { /* ignore */ }

    return listeners;
  }

  /* ---- Detach unified task listeners ---- */
  function detachUnifiedTaskListeners(listeners) {
    if (!listeners || !listeners.length) return;
    listeners.forEach(function (entry) {
      try { entry.ref.off('value', entry.callback); } catch (e) { /* ignore */ }
    });
  }

  /* ---- Expose globally ---- */
  window.PmosTaskAdapter = {
    TASK_STATUSES: TASK_STATUSES,
    TASK_TRANSITIONS: TASK_TRANSITIONS,
    STATUS_MAP: STATUS_MAP,
    PRIORITY_MAP: PRIORITY_MAP,
    normalizeStatus: normalizeStatus,
    normalizePriority: normalizePriority,
    statusLabel: statusLabel,
    normalizeTask: normalizeTask,
    toPmosFormat: toPmosFormat,
    toAcpmFormat: toAcpmFormat,
    readUnifiedTasks: readUnifiedTasks,
    createCanonicalTask: createCanonicalTask,
    updateCanonicalTask: updateCanonicalTask,
    transitionCanonicalTask: transitionCanonicalTask,
    listenUnifiedTasks: listenUnifiedTasks,
    detachUnifiedTaskListeners: detachUnifiedTaskListeners
  };
})();
