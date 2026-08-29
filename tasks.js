// ACPM task engine.
// Canonical path: projects/{projectId}/tasks/{taskId}
// Historical events: projects/{projectId}/taskEvents and /activity

let _tpid = null;
let _taskListeners = [];
let _taskCache = [];
let _taskAssigneeDirectory = [];
let _apmTaskFilter = 'today';

const TASK_STATUS = Object.freeze({
  pending: { label: 'Pending', icon: '\u25CB', color: 'var(--muted)' },
  in_progress: { label: 'In Progress', icon: '\u25D0', color: 'var(--blue)' },
  blocked: { label: 'Blocked', icon: '\u2298', color: 'var(--amber)' },
  for_verification: { label: 'For Verification', icon: '\u25C9', color: 'var(--purple)' },
  completed: { label: 'Completed', icon: '\u2713', color: 'var(--green)' },
  cancelled: { label: 'Cancelled', icon: '\u00D7', color: 'var(--red)' }
});

const TASK_TRANSITIONS = Object.freeze({
  pending: ['in_progress', 'cancelled'],
  in_progress: ['blocked', 'for_verification', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  for_verification: ['completed', 'in_progress', 'blocked', 'cancelled'],
  completed: [],
  cancelled: []
});

function normalizeTaskStatus(status) {
  const value = String(status || '').trim();
  const map = {
    todo: 'pending',
    open: 'pending',
    Open: 'pending',
    New: 'pending',
    pending: 'pending',
    in_progress: 'in_progress',
    'In Progress': 'in_progress',
    ongoing: 'in_progress',
    blocked: 'blocked',
    Waiting: 'blocked',
    review: 'for_verification',
    'For Verification': 'for_verification',
    for_verification: 'for_verification',
    done: 'completed',
    Done: 'completed',
    closed: 'completed',
    completed: 'completed',
    archived: 'cancelled',
    Archived: 'cancelled',
    Cancelled: 'cancelled',
    cancelled: 'cancelled'
  };
  return map[value] || 'pending';
}

function canTouchTasksProject() {
  return typeof requireEdit === 'function'
    ? requireEdit(_tpid)
    : !!_tpid && typeof canEditProject === 'function' && canEditProject(_tpid);
}

function tasksIsApm() {
  return (typeof normalizeRole === 'function'
    ? normalizeRole(window._currentUser?.role || 'apm')
    : String(window._currentUser?.role || 'apm').toLowerCase()) === 'apm';
}

function ensureApmTaskFilters() {
  const panel = $('tasksPanel');
  const card = panel?.querySelector('.panel-card');
  if (!card || !tasksIsApm()) return;
  panel.classList.add('apm-tasks-mode');
  if ($('apmTaskFilters')) return;
  const filters = document.createElement('div');
  filters.id = 'apmTaskFilters';
  filters.className = 'apm-task-filters';
  filters.setAttribute('aria-label', 'Task view');
  filters.innerHTML = [
    ['today', 'Today'], ['upcoming', 'Upcoming'], ['blocked', 'Blocked'],
    ['verification', 'For Verification'], ['history', 'Completed / History']
  ].map(([key, label]) => `<button type="button" data-apm-task-filter="${key}" onclick="setApmTaskFilter('${key}')">${label}</button>`).join('');
  const form = card.querySelector('.task-form-row');
  card.insertBefore(filters, form || card.firstChild);
  updateApmTaskFilterButtons();
}

function updateApmTaskFilterButtons() {
  document.querySelectorAll('[data-apm-task-filter]').forEach(button => {
    const active = button.dataset.apmTaskFilter === _apmTaskFilter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function apmFilteredTasks(tasks) {
  if (!tasksIsApm()) return tasks;
  const today = new Date();
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return tasks.filter(task => {
    const due = String(task.dueDate || '').slice(0, 10);
    const historical = ['completed', 'cancelled'].includes(task.status);
    if (_apmTaskFilter === 'history') return historical;
    if (historical) return false;
    if (_apmTaskFilter === 'blocked') return task.status === 'blocked';
    if (_apmTaskFilter === 'verification') return task.status === 'for_verification';
    if (_apmTaskFilter === 'upcoming') return !due || due > localToday;
    return !!due && due <= localToday;
  });
}

function setApmTaskFilter(filter) {
  const allowed = ['today', 'upcoming', 'blocked', 'verification', 'history'];
  if (!allowed.includes(filter)) return;
  _apmTaskFilter = filter;
  updateApmTaskFilterButtons();
  renderTaskBoard(_taskCache);
}

function canVerifyTasks() {
  const role = typeof normalizeRole === 'function'
    ? normalizeRole(window._currentUser?.role)
    : String(window._currentUser?.role || '').toLowerCase();
  return ['boss', 'owner', 'admin', 'pm'].includes(role);
}

function initTasks(pid) {
  detachTaskListeners();
  _tpid = pid || null;
  _taskCache = [];
  _apmTaskFilter = 'today';
  if (!_tpid) return;
  ensureApmTaskFilters();
  loadTaskAssignees();
  watchTasks(_tpid);
}

function detachTaskListeners() {
  _taskListeners.forEach(({ ref, eventName, callback }) => {
    try { ref.off(eventName, callback); } catch (e) { /* listener cleanup is best-effort */ }
  });
  _taskListeners = [];
  _taskCache = [];
  _taskAssigneeDirectory = [];
}

function taskListen(ref, eventName, callback) {
  ref.on(eventName, callback);
  _taskListeners.push({ ref, eventName, callback });
}

async function loadTaskAssignees() {
  const list = document.getElementById('taskAssigneeOptions');
  if (!list) return;
  try {
    const snap = await firebase.database().ref('users').once('value');
    const rows = [];
    snap.forEach(child => {
      const user = { uid: child.key, ...(child.val() || {}) };
      if (String(user.status || 'active').toLowerCase() !== 'active') return false;
      const projects = typeof normalizeProjectList === 'function'
        ? normalizeProjectList(user.projects || user.assignedProjects)
        : Object.keys(user.projects || {});
      const role = typeof normalizeRole === 'function' ? normalizeRole(user.role) : user.role;
      if (['boss', 'owner', 'admin', 'pm'].includes(role) || projects.includes(_tpid)) rows.push(user);
      return false;
    });
    _taskAssigneeDirectory = rows;
    list.innerHTML = rows.map(user => {
      const name = user.displayName || user.name || user.email || user.uid;
      return `<option value="${escapeHtml(name)}"></option>`;
    }).join('');
  } catch (error) {
    console.warn('Task assignee directory unavailable:', error?.code || error?.message || error);
  }
}

function normalizedTask(child) {
  const raw = child.val() || {};
  return {
    id: child.key,
    ...raw,
    status: normalizeTaskStatus(raw.status),
    progress: Math.max(0, Math.min(100, parseInt(raw.progress, 10) || 0))
  };
}

function watchTasks(pid) {
  const ref = firebase.database().ref(`projects/${pid}/tasks`);
  const callback = snap => {
    const tasks = [];
    snap.forEach(child => {
      tasks.push(normalizedTask(child));
      return false;
    });
    _taskCache = tasks;
    renderTaskBoard(tasks);
    renderTaskSummary(tasks);
    renderGanttFromTasks(tasks);
  };
  taskListen(ref, 'value', callback);
}

function taskIsOverdue(task, now = Date.now()) {
  return !!task.dueDate &&
    new Date(`${task.dueDate}T23:59:59`).getTime() < now &&
    !['completed', 'cancelled'].includes(task.status);
}

function sortTasks(tasks) {
  const priority = { critical: 0, high: 1, normal: 2, low: 3 };
  const now = Date.now();
  return tasks.slice().sort((a, b) => {
    const overdueDiff = Number(taskIsOverdue(b, now)) - Number(taskIsOverdue(a, now));
    if (overdueDiff) return overdueDiff;
    const priorityDiff = (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2);
    if (priorityDiff) return priorityDiff;
    return String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31'));
  });
}

function renderTaskBoard(tasks) {
  const container = $('taskList');
  if (!container) return;
  const visibleTasks = apmFilteredTasks(tasks);
  if (!visibleTasks.length) {
    const label = _apmTaskFilter === 'history' ? 'completed tasks or history' : `${_apmTaskFilter.replace('_', ' ')} tasks`;
    container.innerHTML = `<p class="empty-hint">No ${tasksIsApm() ? label : 'tasks'} in this view.</p>`;
    return;
  }

  const groups = Object.keys(TASK_STATUS).reduce((result, status) => {
    result[status] = [];
    return result;
  }, {});
  sortTasks(visibleTasks).forEach(task => groups[task.status].push(task));

  container.innerHTML = '';
  const board = document.createDocumentFragment();
  Object.entries(groups).forEach(([status, items]) => {
    if (!items.length) return;
    const config = TASK_STATUS[status];
    const column = document.createElement('section');
    column.className = `task-column task-column-${status}`;
    column.dataset.status = status;
    column.innerHTML = `<div class="task-col-header" style="color:${config.color}">
      <span>${config.icon} ${config.label}</span>
      <span class="task-count">${items.length}</span>
    </div>`;

    items.forEach(task => column.appendChild(buildTaskCard(task)));
    if (!['completed', 'cancelled'].includes(status)) {
      column.addEventListener('dragover', event => {
        event.preventDefault();
        column.classList.add('drag-over');
      });
      column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
      column.addEventListener('drop', event => {
        event.preventDefault();
        column.classList.remove('drag-over');
        const taskId = event.dataTransfer.getData('taskId');
        if (taskId) updateTaskStatus(taskId, status);
      });
    }
    board.appendChild(column);
  });
  container.appendChild(board);
}

function buildTaskCard(task) {
  const now = Date.now();
  const overdue = taskIsOverdue(task, now);
  const due = task.dueDate
    ? (overdue ? `Overdue: ${task.dueDate}` : `Due: ${task.dueDate}`)
    : 'No deadline';
  const card = document.createElement('article');
  card.className = `task-card ${overdue ? 'task-overdue' : ''} priority-${task.priority || 'normal'}`;
  card.dataset.taskId = task.id;
  card.draggable = !['completed', 'cancelled'].includes(task.status);
  card.innerHTML = `
    <div class="task-card-hdr">
      <span class="task-priority ${escapeHtml(task.priority || 'normal')}">${escapeHtml(task.priority || 'normal')}</span>
      <button class="task-menu-btn" type="button" aria-label="Actions for ${escapeHtml(task.title || 'task')}">\u22EE</button>
    </div>
    <div class="task-title">${escapeHtml(task.title || 'Untitled task')}</div>
    ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
    <div class="task-meta">
      <span class="task-assignee">${escapeHtml(task.assignedToName || task.assignedTo || 'Unassigned')}</span>
      <span class="task-due ${overdue ? 'overdue' : ''}">${escapeHtml(due)}</span>
    </div>
    ${task.blockedReason ? `<div class="task-blocked-reason">${escapeHtml(task.blockedReason)}</div>` : ''}
    ${task.completionNote ? `<div class="task-completion-note">${escapeHtml(task.completionNote)}</div>` : ''}
    <div class="task-progress">
      <div class="task-progress-bar" style="width:${task.progress}%"></div>
    </div>
  `;
  card.addEventListener('dragstart', event => {
    event.dataTransfer.setData('taskId', task.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.querySelector('.task-menu-btn').addEventListener('click', event => {
    event.stopPropagation();
    showTaskMenu(task.id, task);
  });
  return card;
}

function renderTaskSummary(tasks) {
  const active = tasks.filter(task => !['completed', 'cancelled'].includes(task.status));
  const completed = tasks.filter(task => task.status === 'completed');
  const overdue = active.filter(task => taskIsOverdue(task));
  const critical = active.filter(task => task.priority === 'critical');
  setText('taskTotal', active.length);
  setText('taskDone', completed.length);
  setText('taskOverdue', overdue.length);
  setText('taskCritical', critical.length);
  const countable = tasks.filter(task => task.status !== 'cancelled');
  const completion = countable.length ? Math.round((completed.length / countable.length) * 100) : 0;
  setText('taskCompletionPct', `${completion}%`);
  const bar = $('taskProgressBar');
  if (bar) {
    bar.style.width = `${completion}%`;
    bar.className = `mini-fill ${budgetBarClass(completion)}`;
  }
}

function taskAssigneeByName(name) {
  const wanted = String(name || '').trim().toLowerCase();
  return _taskAssigneeDirectory.find(user => {
    const display = user.displayName || user.name || user.email || user.uid;
    return String(display).trim().toLowerCase() === wanted;
  }) || null;
}

function taskActor() {
  return window._currentUser || { uid: 'system', name: 'System', role: 'apm' };
}

function taskEventUpdates(taskId, type, task, extra = {}) {
  const actor = taskActor();
  const now = Date.now();
  const eventRef = firebase.database().ref(`projects/${_tpid}/taskEvents`).push();
  const activityRef = firebase.database().ref(`projects/${_tpid}/activity`).push();
  const common = {
    type,
    module: 'tasks',
    taskId,
    recordId: taskId,
    projectId: _tpid,
    title: task?.title || '',
    fromStatus: extra.fromStatus || null,
    toStatus: extra.toStatus || null,
    createdAt: now,
    createdBy: actor.uid || 'system',
    createdByName: actor.name || 'System',
    ...extra
  };
  return {
    [`projects/${_tpid}/taskEvents/${eventRef.key}`]: common,
    [`projects/${_tpid}/activity/${activityRef.key}`]: common
  };
}

async function addTask() {
  if (!_tpid || !canTouchTasksProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return;
  }
  const title = $('taskTitle')?.value.trim() || '';
  const description = $('taskDesc')?.value.trim() || '';
  const priority = $('taskPriority')?.value || 'normal';
  const dueDate = $('taskDueDate')?.value || '';
  const assigneeName = $('taskAssignee')?.value.trim() || '';
  const assignee = taskAssigneeByName(assigneeName);
  const category = $('taskCategory')?.value || 'general';
  const budgetImpact = parseFloat($('taskBudgetImpact')?.value) || 0;
  if (!title) {
    setFieldError($('taskTitle'), 'Enter a task title.');
    return;
  }
  if (title.length > 120) {
    setFieldError($('taskTitle'), 'Use 120 characters or fewer.');
    return;
  }
  if (dueDate && new Date(`${dueDate}T23:59:59`) < new Date(new Date().toDateString())) {
    showToast('Due date cannot be in the past.', 'error');
    return;
  }

  const actor = taskActor();
  const ref = firebase.database().ref(`projects/${_tpid}/tasks`).push();
  const now = Date.now();
  const record = {
    id: ref.key,
    projectId: _tpid,
    title,
    description,
    assignedTo: assigneeName,
    assignedToName: assigneeName,
    assignedToUid: assignee?.uid || '',
    performedByName: '',
    priority,
    startDate: '',
    dueDate,
    status: 'pending',
    progress: 0,
    verificationAuthority: 'pm',
    completionProof: null,
    comments: {},
    attachments: {},
    linkedProcurement: {},
    linkedIssues: {},
    budgetImpact,
    category,
    source: 'acpm',
    createdAt: now,
    createdBy: actor.uid || 'system',
    createdByName: actor.name || 'System',
    updatedAt: now,
    updatedBy: actor.uid || 'system'
  };
  const updates = {
    [`projects/${_tpid}/tasks/${ref.key}`]: record,
    ...taskEventUpdates(ref.key, 'task.created', record, { toStatus: 'pending' })
  };
  await safeDb(() => firebase.database().ref().update(updates), 'Failed to create task');
  ['taskTitle', 'taskDesc', 'taskDueDate', 'taskBudgetImpact', 'taskAssignee'].forEach(id => {
    const field = $(id);
    if (field) field.value = '';
  });
  auditLog('create', 'task', ref.key, { title, priority, projectId: _tpid, status: 'pending' });
  if (assignee?.uid && typeof sendNotification === 'function') {
    sendNotification({
      to: assignee.uid,
      type: 'task_assigned',
      message: `New task: ${title}`,
      projectId: _tpid,
      link: `workspace.html?projectId=${encodeURIComponent(_tpid)}&tab=tasks&fromNotif=1`
    }).catch(() => {});
  }
  showToast(`Task "${title}" created`);
}

async function updateTaskStatus(taskId, requestedStatus, extra = {}) {
  if (!_tpid || !canTouchTasksProject()) {
    showToast('You do not have edit access to this project.', 'error');
    return false;
  }
  const task = _taskCache.find(item => item.id === taskId);
  if (!task) {
    showToast('Task not found. Refresh and try again.', 'error');
    return false;
  }
  const fromStatus = normalizeTaskStatus(task.status);
  const toStatus = normalizeTaskStatus(requestedStatus);
  if (fromStatus === toStatus) return true;
  if (!TASK_TRANSITIONS[fromStatus]?.includes(toStatus)) {
    showToast(`A ${TASK_STATUS[fromStatus].label} task cannot move to ${TASK_STATUS[toStatus].label}.`, 'error');
    return false;
  }
  if (toStatus === 'completed' && !canVerifyTasks()) {
    showToast('Submit the task for verification. A PM or Admin completes it.', 'error');
    return false;
  }

  const actor = taskActor();
  const now = Date.now();
  const taskUpdate = {
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
  if (toStatus === 'blocked') taskUpdate.blockedReason = String(extra.reason || '').trim();
  if (toStatus === 'for_verification') {
    taskUpdate.progress = 100;
    taskUpdate.submittedForVerificationAt = now;
    taskUpdate.submittedForVerificationBy = actor.uid || 'system';
    taskUpdate.completionNote = String(extra.completionNote || task.completionNote || '').trim();
    taskUpdate.completionProof = extra.completionProof || task.completionProof || null;
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
    taskUpdate.cancelReason = String(extra.reason || '').trim();
  }
  const eventType = toStatus === 'completed'
    ? 'task.verified'
    : toStatus === 'for_verification'
      ? 'task.submitted_for_verification'
      : toStatus === 'in_progress'
        ? 'task.started'
        : toStatus === 'blocked'
          ? 'task.blocked'
          : 'task.cancelled';
  const updates = {
    [`projects/${_tpid}/tasks/${taskId}`]: { ...task, ...taskUpdate },
    ...taskEventUpdates(taskId, eventType, task, {
      fromStatus,
      toStatus,
      reason: extra.reason || '',
      completionNote: extra.completionNote || ''
    })
  };
  await safeDb(() => firebase.database().ref().update(updates), 'Failed to update task');
  auditLog('update', 'task', taskId, {
    projectId: _tpid,
    previousStatus: fromStatus,
    newStatus: toStatus,
    reason: extra.reason || ''
  });
  if (toStatus === 'for_verification' && typeof createNotificationEvent === 'function') {
    createNotificationEvent({
      projectId: _tpid,
      module: 'tasks',
      type: 'task_verification_requested',
      payload: {
        recordId: taskId,
        message: `${task.title || 'Task'} is ready for PM verification.`,
        recipientRole: 'pm',
        link: `workspace.html?projectId=${encodeURIComponent(_tpid)}&tab=tasks&fromNotif=1`
      }
    }).catch(() => {});
  }
  return true;
}

async function updateTaskProgress(taskId, progress) {
  const task = _taskCache.find(item => item.id === taskId);
  if (!task || !canTouchTasksProject()) return;
  if (['completed', 'cancelled'].includes(task.status)) {
    showToast('Historical tasks cannot be edited.', 'error');
    return;
  }
  const value = Math.max(0, Math.min(99, parseInt(progress, 10) || 0));
  const status = value > 0 && task.status === 'pending' ? 'in_progress' : task.status;
  await safeDb(() => firebase.database().ref(`projects/${_tpid}/tasks/${taskId}`).update({
    progress: value,
    status,
    updatedAt: Date.now(),
    updatedBy: taskActor().uid || 'system'
  }), 'Failed to update progress');
}

async function deleteTask(taskId) {
  const task = _taskCache.find(item => item.id === taskId);
  if (!task) return;
  if (['completed', 'cancelled'].includes(task.status)) {
    showToast('Historical tasks are preserved and cannot be deleted.', 'warn');
    return;
  }
  const reason = prompt('Reason for cancelling this task:');
  if (reason === null) return;
  if (!reason.trim()) {
    showToast('Enter a cancellation reason.', 'error');
    return;
  }
  await updateTaskStatus(taskId, 'cancelled', { reason: reason.trim() });
}

function showTaskMenu(taskId, task) {
  document.querySelector('.task-context-menu')?.remove();
  const actions = [];
  const addTransition = (status, label, extraFactory = null) => {
    if (!TASK_TRANSITIONS[task.status]?.includes(status)) return;
    if (status === 'completed' && !canVerifyTasks()) return;
    actions.push({
      label,
      action: () => {
        const extra = extraFactory ? extraFactory() : {};
        if (extra === null) return;
        updateTaskStatus(taskId, status, extra);
      }
    });
  };
  addTransition('in_progress', task.status === 'for_verification' ? 'Return to In Progress' : 'Start Work');
  addTransition('blocked', 'Mark Blocked', () => {
    const reason = prompt('Why is this blocked?');
    return reason === null ? null : { reason: reason.trim() };
  });
  addTransition('for_verification', 'Submit for Verification', () => {
    const completionNote = prompt('Completion note / work accomplished:');
    if (completionNote === null) return null;
    const proofUrl = prompt('Completion proof link (optional Google Drive URL):') || '';
    return {
      completionNote: completionNote.trim(),
      completionProof: proofUrl.trim() ? { url: proofUrl.trim(), addedAt: Date.now() } : null
    };
  });
  addTransition('completed', 'Verify and Complete');
  if (!['completed', 'cancelled'].includes(task.status)) {
    actions.push({ label: 'Set Progress', action: () => {
      const value = prompt('Progress (0-99):', task.progress || 0);
      if (value !== null) updateTaskProgress(taskId, value);
    } });
    actions.push({ label: 'Edit Details', action: () => openEditTaskModal(taskId, task) });
    actions.push({ label: 'Cancel Task', action: () => deleteTask(taskId), danger: true });
  }
  if (!actions.length) actions.push({ label: 'Historical record', action: () => {} });

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';
  menu.innerHTML = actions.map(action =>
    `<button type="button" class="task-menu-item ${action.danger ? 'danger' : ''}">${escapeHtml(action.label)}</button>`
  ).join('');
  document.body.appendChild(menu);
  const anchor = document.querySelector(`[data-task-id="${CSS.escape(taskId)}"] .task-menu-btn`);
  const rect = anchor?.getBoundingClientRect();
  if (rect) {
    menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 4)}px`;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, rect.left))}px`;
  }
  menu.querySelectorAll('button').forEach((button, index) => {
    button.addEventListener('click', () => {
      menu.remove();
      actions[index].action();
    });
  });
  const close = event => {
    if (!menu.contains(event.target)) {
      menu.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function openEditTaskModal(taskId, task) {
  $('editTaskId').value = taskId;
  $('editTaskTitle').value = task.title || '';
  $('editTaskDesc').value = task.description || '';
  $('editTaskPriority').value = task.priority || 'normal';
  $('editTaskDueDate').value = task.dueDate || '';
  $('editTaskAssignee').value = task.assignedToName || task.assignedTo || '';
  $('editTaskBudgetImpact').value = task.budgetImpact || '';
  $('editTaskCategory').value = task.category || 'general';
  $('editTaskModal').classList.remove('hidden');
}

function closeEditTaskModal() {
  $('editTaskModal')?.classList.add('hidden');
}

async function saveEditTask() {
  const taskId = $('editTaskId')?.value;
  const task = _taskCache.find(item => item.id === taskId);
  if (!task || !_tpid || !canTouchTasksProject()) return;
  if (['completed', 'cancelled'].includes(task.status)) {
    showToast('Historical tasks cannot be edited.', 'error');
    return;
  }
  const title = $('editTaskTitle')?.value.trim() || '';
  if (!title) {
    setFieldError($('editTaskTitle'), 'Title required.');
    return;
  }
  const assignedToName = $('editTaskAssignee')?.value.trim() || '';
  const assigned = taskAssigneeByName(assignedToName);
  const updates = {
    title,
    description: $('editTaskDesc')?.value.trim() || '',
    priority: $('editTaskPriority')?.value || 'normal',
    dueDate: $('editTaskDueDate')?.value || '',
    assignedTo: assignedToName,
    assignedToName,
    assignedToUid: assigned?.uid || task.assignedToUid || '',
    budgetImpact: parseFloat($('editTaskBudgetImpact')?.value) || 0,
    category: $('editTaskCategory')?.value || 'general',
    updatedAt: Date.now(),
    updatedBy: taskActor().uid || 'system'
  };
  await safeDb(() => firebase.database().ref(`projects/${_tpid}/tasks/${taskId}`).update(updates), 'Failed to update task');
  closeEditTaskModal();
  auditLog('update', 'task', taskId, { title, projectId: _tpid });
  showToast('Task updated');
}

function renderGanttFromTasks(tasks) {
  const el = $('ganttView');
  if (!el) return;
  const active = sortTasks(tasks).filter(task => task.dueDate && !['completed', 'cancelled'].includes(task.status));
  if (!active.length) {
    el.innerHTML = '<p class="empty-hint">No active task deadlines this month.</p>';
    return;
  }
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const rows = active.filter(task => {
    const due = new Date(`${task.dueDate}T12:00:00`);
    return due.getMonth() === now.getMonth() && due.getFullYear() === now.getFullYear();
  });
  if (!rows.length) {
    el.innerHTML = '<p class="empty-hint">No active task deadlines this month.</p>';
    return;
  }
  el.innerHTML = `<div class="gantt-chart">
    <div class="gantt-header">${Array.from({ length: daysInMonth }, (_, index) =>
      `<div class="gantt-day ${index + 1 === now.getDate() ? 'today' : ''}">${index + 1}</div>`
    ).join('')}</div>
    ${rows.map(task => {
      const day = new Date(`${task.dueDate}T12:00:00`).getDate();
      const left = ((day - 1) / daysInMonth) * 100;
      const color = task.priority === 'critical' ? 'var(--red)' : task.priority === 'high' ? 'var(--amber)' : 'var(--blue)';
      return `<div class="gantt-row">
        <span class="gantt-label">${escapeHtml(task.title.slice(0, 24))}</span>
        <div class="gantt-track"><div class="gantt-bar" style="left:${left}%;width:3%;background:${color}" title="${escapeHtml(task.title)} - Due ${escapeHtml(task.dueDate)}"></div></div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderGanttView() {
  renderGanttFromTasks(_taskCache);
}

window.TASK_STATUS = TASK_STATUS;
window.TASK_TRANSITIONS = TASK_TRANSITIONS;
window.normalizeTaskStatus = normalizeTaskStatus;
window.initTasks = initTasks;
window.detachTaskListeners = detachTaskListeners;
window.addTask = addTask;
window.updateTaskStatus = updateTaskStatus;
window.updateTaskProgress = updateTaskProgress;
window.deleteTask = deleteTask;
window.openEditTaskModal = openEditTaskModal;
window.closeEditTaskModal = closeEditTaskModal;
window.saveEditTask = saveEditTask;
window.renderGanttView = renderGanttView;
window.setApmTaskFilter = setApmTaskFilter;
