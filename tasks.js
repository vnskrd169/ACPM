//  ACPM — tasks.js
//  Task management: create, assign, track deadlines, dependencies
//  Integrated with labor (worker assignments) and billing milestones
// ════════════════════════════════════════════════════════════

let _tpid = null;
let _taskListeners = [];

function initTasks(pid) {
  _tpid = pid;
  detachTaskListeners();
  watchTasks(pid);
  watchTaskSummary(pid);
}

function detachTaskListeners() {
  _taskListeners.forEach(ref => ref.off());
  _taskListeners = [];
}

function taskListen(ref, cb) {
  ref.on('value', cb);
  _taskListeners.push(ref);
}

// ══════════════════════════════════════════════════════
//  WATCH + RENDER
// ══════════════════════════════════════════════════════
function watchTasks(pid) {
  const ref = firebase.database().ref(`projects/${pid}/tasks`);
  taskListen(ref, snap => {
    const container = $('taskList');
    if (!container) return;
    container.innerHTML = '';

    if (!snap.exists()) {
      container.innerHTML = '<p class="empty-hint">No tasks yet. Create the first task above.</p>';
      return;
    }

    const tasks = [];
    snap.forEach(c => tasks.push({ id: c.key, ...c.val() }));

    // Sort: overdue first, then by due date, then priority
    const now = Date.now();
    tasks.sort((a, b) => {
      const aOverdue = a.dueDate && new Date(a.dueDate + 'T23:59:59') < now;
      const bOverdue = b.dueDate && new Date(b.dueDate + 'T23:59:59') < now;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      const priMap = { critical: 0, high: 1, normal: 2, low: 3 };
      if (priMap[a.priority] !== priMap[b.priority]) {
        return priMap[a.priority] - priMap[b.priority];
      }
      return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1;
    });

    // Group by status
    const groups = { todo: [], in_progress: [], review: [], done: [] };
    tasks.forEach(t => {
      const g = groups[t.status] || groups.todo;
      g.push(t);
    });

    const fragment = document.createDocumentFragment();

    Object.entries(groups).forEach(([status, items]) => {
      if (!items.length) return;
      const col = document.createElement('div');
      col.className = 'task-column';
      col.setAttribute('data-status', status);

      const headerMap = {
        todo: { label: 'To Do', icon: '\u25CB', color: 'var(--muted)' },
        in_progress: { label: 'In Progress', icon: '\u25D0', color: 'var(--blue)' },
        review: { label: 'Review', icon: '\u25C9', color: 'var(--amber)' },
        done: { label: 'Done', icon: '\u2713', color: 'var(--green)' }
      };
      const hdr = headerMap[status];

      col.innerHTML = `<div class="task-col-header" style="color:${hdr.color}">
        <span>${hdr.icon} ${hdr.label}</span>
        <span class="task-count">${items.length}</span>
      </div>`;

      items.forEach(t => {
        const isOverdue = t.dueDate && new Date(t.dueDate + 'T23:59:59') < now && t.status !== 'done';
        const daysLeft = t.dueDate ? Math.ceil((new Date(t.dueDate + 'T23:59:59') - now) / 86400000) : null;

        const card = document.createElement('div');
        card.className = `task-card ${isOverdue ? 'task-overdue' : ''} priority-${t.priority || 'normal'}`;
        card.setAttribute('data-task-id', t.id);
        card.draggable = true;

        const priorityBadge = {
          critical: '<span class="task-priority critical">\u1F534 Critical</span>',
          high: '<span class="task-priority high">\u26A0 High</span>',
          normal: '<span class="task-priority normal">\u25CB Normal</span>',
          low: '<span class="task-priority low">\u2193 Low</span>'
        }[t.priority || 'normal'];

        const assignee = t.assignedToName || t.assignedTo || 'Unassigned';
        const dueText = t.dueDate
          ? (isOverdue ? `\u26A0 Overdue ${Math.abs(daysLeft)}d` : daysLeft <= 3 ? `\u23F0 ${daysLeft}d left` : t.dueDate)
          : 'No deadline';

        card.innerHTML = `
          <div class="task-card-hdr">
            ${priorityBadge}
            <button class="task-menu-btn" data-tid="${t.id}">\u22EE</button>
          </div>
          <div class="task-title">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : ''}
          <div class="task-meta">
            <span class="task-assignee">\u1F464 ${escapeHtml(assignee)}</span>
            <span class="task-due ${isOverdue ? 'overdue' : ''}">${dueText}</span>
          </div>
          ${t.budgetImpact ? `<div class="task-budget">Budget: ${peso(t.budgetImpact)}</div>` : ''}
          <div class="task-progress">
            <div class="task-progress-bar" style="width:${t.progress || 0}%"></div>
          </div>
        `;

        // Drag events
        card.addEventListener('dragstart', e => {
          e.dataTransfer.setData('taskId', t.id);
          e.dataTransfer.setData('fromStatus', t.status);
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));

        // Menu button
        card.querySelector('.task-menu-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          showTaskMenu(t.id, t);
        });

        col.appendChild(card);
      });

      // Drop zone
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('taskId');
        const newStatus = col.getAttribute('data-status');
        if (taskId && newStatus) updateTaskStatus(taskId, newStatus);
      });

      fragment.appendChild(col);
    });

    container.appendChild(fragment);
  });
}

function watchTaskSummary(pid) {
  const ref = firebase.database().ref(`projects/${pid}/tasks`);
  taskListen(ref, snap => {
    let total = 0, done = 0, overdue = 0, critical = 0;
    const now = Date.now();
    snap.forEach(c => {
      const t = c.val();
      total++;
      if (t.status === 'done') done++;
      if (t.priority === 'critical') critical++;
      if (t.dueDate && new Date(t.dueDate + 'T23:59:59') < now && t.status !== 'done') overdue++;
    });

    setText('taskTotal', total);
    setText('taskDone', done);
    setText('taskOverdue', overdue);
    setText('taskCritical', critical);

    const completion = total ? Math.round((done / total) * 100) : 0;
    const bar = $('taskProgressBar');
    if (bar) {
      bar.style.width = completion + '%';
      bar.className = `mini-fill ${budgetBarClass(completion)}`;
    }
    setText('taskCompletionPct', completion + '%');
  });
}

// ══════════════════════════════════════════════════════
//  ADD / EDIT TASK
// ══════════════════════════════════════════════════════
async function addTask() {
  if (!_tpid) return;
  const title = $('taskTitle')?.value.trim();
  const desc = $('taskDesc')?.value.trim() || '';
  const priority = $('taskPriority')?.value || 'normal';
  const dueDate = $('taskDueDate')?.value || '';
  const assignedTo = $('taskAssignee')?.value || '';
  const budgetImpact = parseFloat($('taskBudgetImpact')?.value) || 0;
  const category = $('taskCategory')?.value || 'general';

  if (!title) { showToast('Enter task title.', 'error'); return; }
  if (title.length > 100) { showToast('Title too long (max 100).', 'error'); return; }

  // Validate due date not in past
  if (dueDate) {
    const due = new Date(dueDate + 'T23:59:59');
    const today = new Date(); today.setHours(0,0,0,0);
    if (due < today) { showToast('Due date cannot be in the past.', 'error'); return; }
  }

  const taskData = {
    title, description: desc, priority, dueDate,
    assignedTo, assignedToName: assignedTo,
    budgetImpact, category,
    status: 'todo', progress: 0,
    createdAt: Date.now(), createdBy: window._currentUser?.uid || 'system'
  };

  await safeDb(() => firebase.database().ref(`projects/${_tpid}/tasks`).push(taskData), 'Failed to create task');

  ['taskTitle', 'taskDesc', 'taskDueDate', 'taskBudgetImpact'].forEach(id => {
    const e = $(id); if (e) e.value = '';
  });
  if ($('taskPriority')) $('taskPriority').value = 'normal';
  if ($('taskCategory')) $('taskCategory').value = 'general';

  auditLog('create', 'task', null, { title, priority, projectId: _tpid });
  showToast(`Task "${title}" created`);
}

async function updateTaskStatus(taskId, newStatus) {
  if (!_tpid) return;
  const updates = {
    status: newStatus,
    updatedAt: Date.now(),
    updatedBy: window._currentUser?.uid || 'system'
  };
  if (newStatus === 'done') {
    updates.progress = 100;
    updates.completedAt = Date.now();
  }
  await safeDb(() => firebase.database().ref(`projects/${_tpid}/tasks/${taskId}`).update(updates), 'Failed to update task');
  auditLog('update', 'task', taskId, { status: newStatus, projectId: _tpid });
}

async function updateTaskProgress(taskId, progress) {
  if (!_tpid) return;
  progress = Math.max(0, Math.min(100, parseInt(progress) || 0));
  const status = progress >= 100 ? 'done' : progress > 0 ? 'in_progress' : 'todo';
  await safeDb(() => firebase.database().ref(`projects/${_tpid}/tasks/${taskId}`).update({
    progress, status,
    updatedAt: Date.now(), updatedBy: window._currentUser?.uid || 'system'
  }), 'Failed to update progress');
}

async function deleteTask(taskId) {
  if (!_tpid || !confirm('Delete this task?')) return;
  await safeDb(() => firebase.database().ref(`projects/${_tpid}/tasks/${taskId}`).remove(), 'Failed to delete task');
  auditLog('delete', 'task', taskId, { projectId: _tpid });
  showToast('Task deleted', 'warn');
}

function showTaskMenu(taskId, task) {
  const actions = [
    { label: 'Edit', action: () => openEditTaskModal(taskId, task) },
    { label: 'Set Progress', action: () => {
      const p = prompt('Progress (0-100):', task.progress || 0);
      if (p !== null) updateTaskProgress(taskId, p);
    }},
    { label: 'Delete', action: () => deleteTask(taskId), danger: true }
  ];

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';
  menu.style.cssText = 'position:fixed;background:var(--surface);border:1px solid var(--border2);border-radius:8px;padding:6px;z-index:300;box-shadow:var(--shadow);';
  menu.innerHTML = actions.map(a =>
    `<button class="task-menu-item ${a.danger ? 'danger' : ''}" style="display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:none;color:${a.danger ? 'var(--red)' : 'var(--text)'};font-size:13px;cursor:pointer;border-radius:4px;">${a.label}</button>`
  ).join('');

  document.body.appendChild(menu);

  // Position near click
  const rect = document.querySelector(`[data-task-id="${taskId}"] .task-menu-btn`)?.getBoundingClientRect();
  if (rect) {
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
  }

  // Click outside to close
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 10);

  menu.querySelectorAll('button').forEach((btn, i) => {
    btn.addEventListener('click', () => { actions[i].action(); menu.remove(); });
  });
}

function openEditTaskModal(taskId, task) {
  $('editTaskId').value = taskId;
  $('editTaskTitle').value = task.title || '';
  $('editTaskDesc').value = task.description || '';
  $('editTaskPriority').value = task.priority || 'normal';
  $('editTaskDueDate').value = task.dueDate || '';
  $('editTaskAssignee').value = task.assignedTo || '';
  $('editTaskBudgetImpact').value = task.budgetImpact || '';
  $('editTaskCategory').value = task.category || 'general';
  $('editTaskModal').classList.remove('hidden');
}

function closeEditTaskModal() {
  $('editTaskModal')?.classList.add('hidden');
}

async function saveEditTask() {
  const taskId = $('editTaskId')?.value;
  if (!taskId || !_tpid) return;

  const updates = {
    title: $('editTaskTitle')?.value.trim(),
    description: $('editTaskDesc')?.value.trim() || '',
    priority: $('editTaskPriority')?.value || 'normal',
    dueDate: $('editTaskDueDate')?.value || '',
    assignedTo: $('editTaskAssignee')?.value || '',
    budgetImpact: parseFloat($('editTaskBudgetImpact')?.value) || 0,
    category: $('editTaskCategory')?.value || 'general',
    updatedAt: Date.now(),
    updatedBy: window._currentUser?.uid || 'system'
  };

  if (!updates.title) { showToast('Title required.', 'error'); return; }

  await safeDb(() => firebase.database().ref(`projects/${_tpid}/tasks/${taskId}`).update(updates), 'Failed to update task');
  closeEditTaskModal();
  auditLog('update', 'task', taskId, { title: updates.title, projectId: _tpid });
  showToast('Task updated');
}

// ══════════════════════════════════════════════════════
//  GANTT VIEW (simple timeline)
// ══════════════════════════════════════════════════════
function renderGanttView() {
  if (!_tpid) return;
  firebase.database().ref(`projects/${_tpid}/tasks`).once('value', snap => {
    const el = $('ganttView');
    if (!el) return;

    const tasks = [];
    snap.forEach(c => tasks.push({ id: c.key, ...c.val() }));

    if (!tasks.length) {
      el.innerHTML = '<p class="empty-hint">No tasks to display.</p>';
      return;
    }

    // Simple timeline bars
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysInMonth = monthEnd.getDate();

    let html = '<div class="gantt-chart">';
    html += '<div class="gantt-header">';
    for (let d = 1; d <= daysInMonth; d++) {
      html += `<div class="gantt-day ${d === now.getDate() ? 'today' : ''}">${d}</div>`;
    }
    html += '</div>';

    tasks.filter(t => t.dueDate).forEach(t => {
      const due = new Date(t.dueDate + 'T12:00:00');
      if (due.getMonth() !== now.getMonth() || due.getFullYear() !== now.getFullYear()) return;

      const dayPos = due.getDate();
      const left = ((dayPos - 1) / daysInMonth) * 100;
      const color = t.priority === 'critical' ? 'var(--red)' : t.priority === 'high' ? 'var(--amber)' : 'var(--blue)';

      html += `<div class="gantt-row">
        <span class="gantt-label">${escapeHtml(t.title.substring(0, 20))}</span>
        <div class="gantt-track">
          <div class="gantt-bar" style="left:${left}%;width:3%;background:${color}" title="${escapeHtml(t.title)} - Due ${t.dueDate}"></div>
        </div>
      </div>`;
    });

    html += '</div>';
    el.innerHTML = html;
  });
}

// ── Expose ──────────────────────────────────────────────────
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