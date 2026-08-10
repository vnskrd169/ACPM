let _notifListeners = [];
let _notifSources = {
  inbox: [],
  projectEvents: [],
  globalEvents: []
};
let _notifCount = 0;

function initNotifications() {
  detachNotifications();
  watchNotifications();
}

function detachNotifications() {
  _notifListeners.forEach(entry => {
    if (!entry || !entry.ref) return;
    entry.ref.off(entry.event || 'value', entry.callback);
  });
  _notifListeners = [];
  _notifSources = { inbox: [], projectEvents: [], globalEvents: [] };
  _notifCount = 0;
  updateNotifBadge();
}

function addNotifListener(ref, callback, event = 'value') {
  ref.on(event, callback, error => {
    console.warn('Notification listener skipped:', error?.code || error?.message || error);
  });
  _notifListeners.push({ ref, callback, event });
}

function watchNotifications() {
  const user = window._currentUser;
  if (!user || !user.uid || typeof firebase === 'undefined') return;

  const inboxRef = firebase.database().ref(`notifications/${user.uid}`).orderByChild('createdAt').limitToLast(30);
  addNotifListener(inboxRef, snap => {
    _notifSources.inbox = snapshotRows(snap).map(row => normalizeInboxNotification(row));
    refreshNotificationUi();
  });

  watchProjectNotificationEvents(user);
  watchGlobalNotificationEvents(user);
}

function watchProjectNotificationEvents(user) {
  const currentPid = window._currentPid || '';
  if (currentPid && canReadNotificationProject(currentPid)) {
    const ref = firebase.database().ref(`projects/${currentPid}/notificationEvents`).orderByChild('createdAt').limitToLast(50);
    addNotifListener(ref, snap => {
      _notifSources.projectEvents = snapshotRows(snap).map(row => normalizeEventNotification(row, 'projectEvent', currentPid));
      refreshNotificationUi();
    });
    return;
  }

  if (userCanReadAllNotificationProjects(user)) {
    const ref = firebase.database().ref('projects');
    addNotifListener(ref, snap => {
      const items = [];
      snap.forEach(projectSnap => {
        const project = projectSnap.val() || {};
        const events = project.notificationEvents || {};
        Object.entries(events).forEach(([id, event]) => {
          items.push(normalizeEventNotification(
            { id, ...(event || {}) },
            'projectEvent',
            projectSnap.key,
            project.name || projectSnap.key
          ));
        });
        return false;
      });
      _notifSources.projectEvents = recentItems(items, 80);
      refreshNotificationUi();
    });
    return;
  }

  const ids = notificationAssignedProjectIds(user);
  if (!ids.length) return;
  const projectItems = {};
  ids.forEach(pid => {
    if (!canReadNotificationProject(pid)) return;
    const ref = firebase.database().ref(`projects/${pid}/notificationEvents`).orderByChild('createdAt').limitToLast(30);
    addNotifListener(ref, snap => {
      projectItems[pid] = snapshotRows(snap).map(row => normalizeEventNotification(row, 'projectEvent', pid));
      _notifSources.projectEvents = recentItems(Object.values(projectItems).flat(), 80);
      refreshNotificationUi();
    });
  });
}

function watchGlobalNotificationEvents(user) {
  if (!userCanReadGlobalNotificationEvents(user)) return;
  const ref = firebase.database().ref('globalNotificationEvents').orderByChild('createdAt').limitToLast(50);
  addNotifListener(ref, snap => {
    _notifSources.globalEvents = snapshotRows(snap).map(row => normalizeEventNotification(row, 'globalEvent', row.projectId || ''));
    refreshNotificationUi();
  });
}

function snapshotRows(snap) {
  const rows = [];
  if (!snap || !snap.forEach) return rows;
  snap.forEach(child => {
    rows.push({ id: child.key, ...(child.val() || {}) });
    return false;
  });
  return rows;
}

function recentItems(items, limit) {
  return items
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
}

function notificationAssignedProjectIds(user = window._currentUser || {}) {
  const normalize = typeof normalizeProjectList === 'function'
    ? normalizeProjectList
    : value => {
      if (Array.isArray(value)) return value.filter(Boolean).map(String);
      if (value && typeof value === 'object') {
        return Object.entries(value)
          .filter(([, enabled]) => enabled !== false && enabled !== null)
          .map(([key]) => String(key));
      }
      return [];
    };
  return Array.from(new Set([
    ...normalize(user.projects),
    ...normalize(user.assignedProjects),
    ...normalize(user.bossOf)
  ].filter(Boolean)));
}

function notificationRole(user = window._currentUser || {}) {
  return typeof normalizeRole === 'function'
    ? normalizeRole(user.role || '')
    : String(user.role || '').trim().toLowerCase();
}

function userCanReadAllNotificationProjects(user = window._currentUser || {}) {
  return typeof isBoss === 'function'
    ? isBoss(user.role)
    : ['boss', 'owner', 'admin'].includes(notificationRole(user));
}

function userCanReadGlobalNotificationEvents(user = window._currentUser || {}) {
  return ['boss', 'owner', 'admin'].includes(notificationRole(user)) ||
    (typeof isBoss === 'function' && isBoss(user.role));
}

function canReadNotificationProject(pid) {
  if (!pid) return false;
  return typeof canReadFullProject === 'function'
    ? canReadFullProject(pid)
    : typeof canAccessProject === 'function'
      ? canAccessProject(pid)
      : true;
}

function notificationReadKey(item) {
  return item && item.readKey ? item.readKey : '';
}

function eventReadState(item) {
  const user = window._currentUser || {};
  const readBy = item?.readBy || {};
  return user.uid ? readBy[safeReadKey(user.uid)] : null;
}

function eventClearedState(item) {
  const user = window._currentUser || {};
  const clearedBy = item?.clearedBy || {};
  return user.uid ? clearedBy[safeReadKey(user.uid)] : null;
}

function eventMatchesUser(item, user = window._currentUser || {}) {
  if (!item) return false;
  if (isQaNotification(item)) return false;
  const role = notificationRole(user);
  const recipientUserId = item.recipientUserId || item.toUserId || '';
  if (recipientUserId && recipientUserId !== user.uid) return false;

  const recipientRole = String(item.recipientRole || item.toRole || '').trim().toLowerCase();
  if (recipientRole) {
    const normalizedRecipientRole = typeof normalizeRole === 'function' ? normalizeRole(recipientRole) : recipientRole;
    if (normalizedRecipientRole !== role && !(normalizedRecipientRole === 'boss' && userCanReadGlobalNotificationEvents(user))) {
      return false;
    }
  }

  if (item.projectId && !canReadNotificationProject(item.projectId)) return false;
  return true;
}

function isQaNotification(item = {}) {
  const raw = item.raw || {};
  const values = [
    item.type,
    item.module,
    item.message,
    item.projectName,
    raw.type,
    raw.module,
    raw.qaRun,
    raw.message
  ].map(value => String(value || '').trim().toLowerCase());
  return values.some(value =>
    value === 'qa' ||
    value.startsWith('qa_') ||
    value.startsWith('qa ') ||
    value.includes('qa notification') ||
    value.includes('qa global event') ||
    value.includes('qa project event') ||
    value.includes('qa supplier') ||
    value.includes('qa audit')
  );
}

function normalizeInboxNotification(row) {
  const createdAt = parseFloat(row.createdAt) || 0;
  return {
    source: 'inbox',
    id: row.id,
    readKey: `inbox:${row.id}`,
    type: row.type || 'message',
    message: row.message || notificationLabel(row.type || 'Notification'),
    projectId: row.projectId || '',
    projectName: row.projectName || '',
    read: row.read === true,
    cleared: row.cleared === true,
    createdAt,
    link: row.link || '',
    fromName: row.fromName || ''
  };
}

function normalizeEventNotification(row, source, fallbackProjectId = '', fallbackProjectName = '') {
  const projectId = row.projectId || fallbackProjectId || '';
  const createdAt = parseFloat(row.createdAt) || 0;
  const type = row.type || row.module || 'notification_event';
  const readKey = `${source}:${projectId || 'global'}:${row.id}`;
  const message = row.message || eventMessage(row);
  return {
    source,
    id: row.id,
    readKey,
    type,
    module: row.module || '',
    message,
    projectId,
    projectName: row.projectName || fallbackProjectName || projectId || 'Whole system',
    read: !!eventReadState({ readKey, readBy: row.readBy || {} }),
    cleared: !!eventClearedState({ clearedBy: row.clearedBy || {} }),
    createdAt,
    status: row.status || 'pending',
    consumed: row.consumed === true,
    readBy: row.readBy || {},
    clearedBy: row.clearedBy || {},
    recipientRole: row.recipientRole || row.toRole || '',
    recipientUserId: row.recipientUserId || row.toUserId || '',
    link: row.link || '',
    raw: row
  };
}

function eventMessage(row = {}) {
  const label = notificationLabel(row.type || row.module || 'Notification event');
  const moduleLabel = notificationLabel(row.module || '');
  const parts = [];
  if (moduleLabel) parts.push(moduleLabel);
  if (label) parts.push(label);
  if (row.coNo) parts.push(row.coNo);
  if (row.billingNo) parts.push(row.billingNo);
  if (row.collectionNo) parts.push(row.collectionNo);
  if (row.poNo) parts.push(row.poNo);
  if (row.supplierName) parts.push(row.supplierName);
  if (row.date) parts.push(row.date);
  return parts.filter(Boolean).join(' - ') || 'Notification event';
}

function notificationLabel(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function mergedNotificationItems() {
  const user = window._currentUser || {};
  const items = [
    ..._notifSources.inbox,
    ..._notifSources.projectEvents,
    ..._notifSources.globalEvents
  ].filter(item => eventMatchesUser(item, user) && !item.cleared);

  const unique = new Map();
  items.forEach(item => {
    if (!item || !item.readKey) return;
    unique.set(item.readKey, item);
  });
  return recentItems(Array.from(unique.values()), 80);
}

function refreshNotificationUi() {
  const items = mergedNotificationItems();
  _notifCount = items.filter(item => !item.read).length;
  updateNotifBadge();
  renderNotificationFeed(items);
}

function updateNotifBadge() {
  const badge = $('notifBadge');
  if (!badge) return;
  if (_notifCount > 0) {
    badge.textContent = _notifCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderNotificationFeed(items) {
  const el = $('notificationFeed');
  if (!el) return;

  if (!items.length) {
    el.innerHTML = '<p class="empty-hint">No notifications yet.</p>';
    return;
  }

  el.innerHTML = items.map(n => {
    const typeLabel = notificationLabel(n.type || n.module || 'Message');
    const targetUrl = notificationTargetUrl(n);
    const iconMap = {
      task: 'TASK',
      payroll: 'PAY',
      billing: 'BILL',
      collection_post: 'COL',
      delivery: 'PO',
      po_approve: 'PO',
      alert: '!',
      mention: '@',
      change_order_submitted: 'CO',
      site_log_submitted: 'SITE',
      supplier_created: 'SUP'
    };
    return `
      <div class="notif-item ${n.read ? 'notif-read' : 'notif-unread'} ${targetUrl ? 'notif-clickable' : ''}" data-nid="${escapeHtml(n.readKey)}" ${targetUrl ? `role="button" tabindex="0" onclick="openNotification('${escapeHtml(n.readKey)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openNotification('${escapeHtml(n.readKey)}')}"` : ''}>
        <span class="notif-icon">${iconMap[n.type] || iconMap[n.module] || 'MSG'}</span>
        <div class="notif-body">
          <div class="notif-topline">
            <span class="notif-chip">${escapeHtml(typeLabel)}</span>
            <span class="notif-age">${timeAgo(n.createdAt)}</span>
          </div>
          <div class="notif-text">${escapeHtml(n.message)}</div>
          <div class="notif-meta">${escapeHtml(n.projectName || 'Whole system')}</div>
        </div>
        ${!n.read ? `<button class="notif-mark" aria-label="Mark notification as read" onclick="event.stopPropagation(); markNotifRead('${escapeHtml(n.readKey)}')" title="Mark as read">OK</button>` : '<span class="notif-done">Read</span>'}
      </div>
    `;
  }).join('');
}

function notificationTargetUrl(item = {}) {
  if (item.link) return item.link;
  if (!item.projectId) return '';
  const tab = notificationTargetTab(item);
  const baseUrl = typeof appUrl === 'function'
    ? appUrl('workspace', { projectId: item.projectId })
    : `workspace.html?projectId=${encodeURIComponent(item.projectId)}`;
  const joiner = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${joiner}fromNotif=1${tab ? `&tab=${encodeURIComponent(tab)}` : ''}`;
}

function notificationTargetTab(item = {}) {
  const moduleName = String(item.module || item.raw?.module || '').toLowerCase();
  const type = String(item.type || item.raw?.type || '').toLowerCase();
  const text = `${moduleName} ${type}`;
  if (text.includes('material') || text.includes('po_') || text.includes('purchase') || text.includes('delivery') || text.includes('supplier')) return 'materials';
  if (text.includes('billing') || text.includes('collection') || text.includes('invoice') || text.includes('payment')) return 'billing';
  if (text.includes('change') || text.includes('co_')) return 'changeorders';
  if (text.includes('site_log') || text.includes('sitelog') || text.includes('site logs')) return 'sitelog';
  if (text.includes('task') || text.includes('mission') || text.includes('follow_up')) return 'tasks';
  if (text.includes('labor') || text.includes('payroll') || text.includes('cash_advance')) return 'labor';
  return 'dashboard';
}

async function openNotification(readKey) {
  const item = mergedNotificationItems().find(row => row.readKey === readKey || row.id === readKey);
  if (!item) return;
  if (!item.read) {
    await markNotifRead(item.readKey);
  }
  const targetUrl = notificationTargetUrl(item);
  if (targetUrl) {
    window.location.href = targetUrl;
  }
}

async function markNotifRead(readKey) {
  const user = window._currentUser;
  if (!user || !user.uid || !readKey) return;
  let item = mergedNotificationItems().find(row => row.readKey === readKey || row.id === readKey);
  if (!item && !String(readKey).includes(':')) {
    item = { source: 'inbox', id: readKey, readKey: `inbox:${readKey}` };
  }
  if (!item) return;

  if (item.source === 'inbox') {
    await safeDb(() => firebase.database().ref(`notifications/${user.uid}/${item.id}`).update({ read: true, readAt: Date.now() }), 'Failed to mark notification read');
  } else {
    const path = notificationEventReadPath(item, user.uid);
    if (path) {
      await safeDb(() => firebase.database().ref(path).set(Date.now()), 'Failed to mark notification read');
    }
  }
}

async function markAllNotifRead() {
  const user = window._currentUser;
  if (!user || !user.uid) return;
  const unread = mergedNotificationItems().filter(item => !item.read);
  if (!unread.length) return;

  const inboxUpdates = {};
  const rootUpdates = {};
  unread.forEach(item => {
    if (item.source === 'inbox') {
      inboxUpdates[`${item.id}/read`] = true;
      inboxUpdates[`${item.id}/readAt`] = Date.now();
    } else {
      const path = notificationEventReadPath(item, user.uid);
      if (path) rootUpdates[path] = Date.now();
    }
  });

  if (Object.keys(inboxUpdates).length) {
    await safeDb(() => firebase.database().ref(`notifications/${user.uid}`).update(inboxUpdates), 'Failed to mark notifications read');
  }
  if (Object.keys(rootUpdates).length) {
    await safeDb(() => firebase.database().ref().update(rootUpdates), 'Failed to mark notifications read');
  }
}

async function clearReadNotifications() {
  const user = window._currentUser;
  if (!user || !user.uid) return;
  const readItems = mergedNotificationItems().filter(item => item.read);
  if (!readItems.length) {
    showToast('No read notifications to clear.', 'warn');
    return;
  }

  const inboxUpdates = {};
  const rootUpdates = {};
  const now = Date.now();
  readItems.forEach(item => {
    if (item.source === 'inbox') {
      inboxUpdates[`${item.id}/cleared`] = true;
      inboxUpdates[`${item.id}/clearedAt`] = now;
    } else {
      const path = notificationEventClearedPath(item, user.uid);
      if (path) rootUpdates[path] = now;
    }
  });

  if (Object.keys(inboxUpdates).length) {
    await safeDb(() => firebase.database().ref(`notifications/${user.uid}`).update(inboxUpdates), 'Failed to clear notifications');
  }
  if (Object.keys(rootUpdates).length) {
    await safeDb(() => firebase.database().ref().update(rootUpdates), 'Failed to clear notifications');
  }
  showToast('Read notifications cleared.');
}

function notificationEventReadPath(item, uid) {
  if (!item || !item.id || !uid) return '';
  const readPath = `readBy/${safeReadKey(uid)}`;
  if (item.source === 'projectEvent' && item.projectId) {
    return `projects/${item.projectId}/notificationEvents/${item.id}/${readPath}`;
  }
  if (item.source === 'globalEvent') {
    return `globalNotificationEvents/${item.id}/${readPath}`;
  }
  return '';
}

function notificationEventClearedPath(item, uid) {
  if (!item || !item.id || !uid) return '';
  const clearedPath = `clearedBy/${safeReadKey(uid)}`;
  if (item.source === 'projectEvent' && item.projectId) {
    return `projects/${item.projectId}/notificationEvents/${item.id}/${clearedPath}`;
  }
  if (item.source === 'globalEvent') {
    return `globalNotificationEvents/${item.id}/${clearedPath}`;
  }
  return '';
}

function safeReadKey(key) {
  return String(key || '').replace(/[.#$\[\]/]/g, '_');
}

async function sendNotification({ to, type, message, projectId, projectName, link }) {
  const sender = window._currentUser || {};
  if (!sender.uid) return;
  if (!to || !message) return;

  const cleanMessage = String(message).trim();
  if (!cleanMessage) return;
  if (cleanMessage.length > 500) {
    showToast('Notification message is too long.', 'error');
    return;
  }

  if (to !== sender.uid && !(typeof isBoss === 'function' ? isBoss(sender.role) : sender.role === 'boss')) {
    if (!projectId || !canAccessProject(projectId)) {
      showToast('You do not have permission to notify that project.', 'error');
      return;
    }
    const recipientSnap = await firebase.database().ref(`users/${to}`).once('value');
    const recipient = recipientSnap.val() || {};
    const recipientProjects = typeof normalizeProjectList === 'function'
      ? normalizeProjectList(recipient.projects || recipient.assignedProjects)
      : Array.isArray(recipient.projects) ? recipient.projects : Object.keys(recipient.projects || {});
    if (!(typeof isBoss === 'function' ? isBoss(recipient.role) : recipient.role === 'boss') && !recipientProjects.includes(projectId)) {
      showToast('You can only notify members of that project.', 'error');
      return;
    }
  }

  const notif = {
    type, message: cleanMessage,
    read: false, createdAt: Date.now(),
    from: sender.uid || 'system',
    fromName: sender.name || 'System'
  };
  if (projectId) notif.projectId = projectId;
  if (projectName) notif.projectName = projectName;
  if (link) notif.link = link;
  await safeDb(() => firebase.database().ref(`notifications/${to}`).push(notif), 'Failed to send notification');
}

async function notifyProject(projectId, { type, message }) {
  const sender = window._currentUser || {};
  if (!sender.uid) return;
  if (!(typeof isBoss === 'function' ? isBoss(sender.role) : sender.role === 'boss') && !canAccessProject(projectId)) {
    showToast('You do not have permission to notify that project.', 'error');
    return;
  }

  const projSnap = await firebase.database().ref(`projects/${projectId}`).once('value');
  const proj = projSnap.val();
  if (!proj) return;

  const name = proj.name || projectId;
  const usersSnap = await firebase.database().ref('users').once('value');
  const promises = [];
  usersSnap.forEach(c => {
    const u = c.val();
    const projects = notificationAssignedProjectIds(u);
    const bossOf = typeof normalizeProjectList === 'function'
      ? normalizeProjectList(u.bossOf)
      : Array.isArray(u.bossOf) ? u.bossOf : Object.keys(u.bossOf || {});
    if (projects.includes(projectId) || bossOf.includes(projectId) || (typeof isBoss === 'function' ? isBoss(u.role) : u.role === 'boss')) {
      promises.push(sendNotification({
        to: c.key, type, message, projectId, projectName: name
      }));
    }
    return false;
  });
  await Promise.all(promises);
}

async function createNotificationEvent({ projectId = '', module = 'general', type, payload = {}, global = false }) {
  if (!type) return null;
  const sender = window._currentUser || {};
  const event = {
    module,
    type,
    status: 'pending',
    consumed: false,
    projectId: projectId || '',
    createdAt: Date.now(),
    createdBy: sender.uid || 'system',
    createdByName: sender.name || 'System',
    ...payload
  };
  const path = global || !projectId
    ? 'globalNotificationEvents'
    : `projects/${projectId}/notificationEvents`;
  const ref = firebase.database().ref(path).push();
  try {
    await ref.set(event);
    return { id: ref.key, path, ...event };
  } catch (e) {
    console.warn('notification event skipped:', e?.code || e?.message || e);
    return null;
  }
}

function timeAgo(ts) {
  if (!ts) return 'just now';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-PH');
}

window.initNotifications = initNotifications;
window.detachNotifications = detachNotifications;
window.sendNotification = sendNotification;
window.notifyProject = notifyProject;
window.createNotificationEvent = createNotificationEvent;
window.markNotifRead = markNotifRead;
window.markAllNotifRead = markAllNotifRead;
window.clearReadNotifications = clearReadNotifications;
window.openNotification = openNotification;
window.timeAgo = timeAgo;
