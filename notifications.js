let _notifListener = null;
let _notifCount = 0;

function initNotifications() {
  if (_notifListener) { _notifListener.off(); _notifListener = null; }
  watchNotifications();
}

function detachNotifications() {
  if (_notifListener) { _notifListener.off(); _notifListener = null; }
}

function watchNotifications() {
  const user = window._currentUser;
  if (!user) return;

  const ref = firebase.database().ref(`notifications/${user.uid}`);
  _notifListener = ref;

  ref.orderByChild('read').equalTo(false).on('value', snap => {
    _notifCount = 0;
    snap.forEach(() => _notifCount++);
    updateNotifBadge();
  });

  // Also show recent notifications
  ref.orderByChild('createdAt').limitToLast(20).on('value', snap => {
    renderNotificationFeed(snap);
  });
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

function renderNotificationFeed(snap) {
  const el = $('notificationFeed');
  if (!el) return;

  const items = [];
  snap.forEach(c => items.push({ id: c.key, ...c.val() }));
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!items.length) {
    el.innerHTML = '<p class="empty-hint">No notifications yet.</p>';
    return;
  }

  el.innerHTML = items.map(n => {
    const iconMap = {
      task: '\u2705', payroll: '\u1F4B0', billing: '\u1F4C4',
      delivery: '\u1F4E6', alert: '\u26A0', mention: '\u0040'
    };
    return `
      <div class="notif-item ${n.read ? 'notif-read' : 'notif-unread'}" data-nid="${n.id}">
        <span class="notif-icon">${iconMap[n.type] || '\u1F4AC'}</span>
        <div class="notif-body">
          <div class="notif-text">${escapeHtml(n.message)}</div>
          <div class="notif-meta">${n.projectName || ''} \u00B7 ${timeAgo(n.createdAt)}</div>
        </div>
        ${!n.read ? `<button class="notif-mark" onclick="markNotifRead('${n.id}')">\u2713</button>` : ''}
      </div>
    `;
  }).join('');
}

async function markNotifRead(nid) {
  const user = window._currentUser;
  if (!user) return;
  await firebase.database().ref(`notifications/${user.uid}/${nid}`).update({ read: true, readAt: Date.now() });
}

async function markAllNotifRead() {
  const user = window._currentUser;
  if (!user) return;
  const snap = await firebase.database().ref(`notifications/${user.uid}`).orderByChild('read').equalTo(false).once('value');
  const updates = {};
  snap.forEach(c => { updates[`${c.key}/read`] = true; updates[`${c.key}/readAt`] = Date.now(); });
  await firebase.database().ref(`notifications/${user.uid}`).update(updates);
}

// ══════════════════════════════════════════════════════
//  SEND NOTIFICATION (called from other modules)
// ══════════════════════════════════════════════════════
async function sendNotification({ to, type, message, projectId, projectName, link }) {
  const sender = window._currentUser || {};
  if (!sender.uid) return;

  if (to !== sender.uid && sender.role !== 'boss' && projectId) {
    if (!canAccessProject(projectId)) {
      showToast('You do not have permission to notify that project.', 'error');
      return;
    }
  }

  const notif = {
    type, message, projectId, projectName, link,
    read: false, createdAt: Date.now(),
    from: sender.uid || 'system',
    fromName: sender.name || 'System'
  };
  await firebase.database().ref(`notifications/${to}`).push(notif);
}

// Send to all project members
async function notifyProject(projectId, { type, message }) {
  const sender = window._currentUser || {};
  if (!sender.uid) return;
  if (sender.role !== 'boss' && !canAccessProject(projectId)) {
    showToast('You do not have permission to notify that project.', 'error');
    return;
  }

  const projSnap = await firebase.database().ref(`projects/${projectId}`).once('value');
  const proj = projSnap.val();
  if (!proj) return;

  const name = proj.name || projectId;

  // Get all users who have this project
  const usersSnap = await firebase.database().ref('users').once('value');
  const promises = [];
  usersSnap.forEach(c => {
    const u = c.val();
    if (u.projects?.includes(projectId) || u.role === 'boss') {
      promises.push(sendNotification({
        to: c.key, type, message, projectId, projectName: name
      }));
    }
  });
  await Promise.all(promises);
}

// ══════════════════════════════════════════════════════
//  TIME AGO HELPER
// ══════════════════════════════════════════════════════
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

// ── Expose ──────────────────────────────────────────────────
window.initNotifications = initNotifications;
window.detachNotifications = detachNotifications;
window.sendNotification = sendNotification;
window.notifyProject = notifyProject;
window.markNotifRead = markNotifRead;
window.markAllNotifRead = markAllNotifRead;
window.timeAgo = timeAgo;
