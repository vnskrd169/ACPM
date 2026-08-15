/* ==========================================================================
   ACPM PMOS — Meeting Notes Module
   Standalone module for creating, editing, reviewing, and archiving
   meeting minutes within the PMOS ecosystem.

   Fields: project, meeting title, date, type, attendees, location,
   agenda, discussion, decisions, action items, assigned persons,
   target dates, attachments, prepared by, reviewed by, status.

   Statuses: Draft → Submitted → Reviewed → Action Required → Closed → Archived
   ========================================================================== */

(function () {
  'use strict';

  const MEETING_STATUSES = ['Draft', 'Submitted', 'Reviewed', 'Action Required', 'Closed', 'Archived'];
  const MEETING_TYPES = ['Site Coordination', 'Client Meeting', 'Technical Meeting', 'Contractor Meeting', 'Admin Meeting', 'Inspection', 'Safety Meeting', 'Internal Meeting', 'Other'];

  function h(text) {
    return typeof escapeHtml === 'function' ? escapeHtml(text) : String(text || '');
  }

  /* ---- Create Meeting Notes (called from PMOS mobile) ---- */
  async function pmosSaveMeeting(data, button) {
    const project = window.pmosCurrentProject ? window.pmosCurrentProject() : null;
    if (!project) {
      if (typeof setSync === 'function') setSync('Select a project first.', 'error');
      return;
    }
    const payload = {
      meetingTitle: data.meetingTitle || '',
      meetingDate: data.meetingDate || new Date().toISOString().slice(0, 10),
      meetingType: data.meetingType || 'Other',
      attendees: data.attendees || '',
      location: data.location || '',
      agenda: data.agenda || '',
      discussion: data.discussion || '',
      decisions: data.decisions || '',
      actionItems: data.actionItems || '',
      assignedPersons: data.assignedPersons || '',
      targetDates: data.targetDates || '',
      status: data.status || 'Draft'
    };

    await (typeof withBusy === 'function' ? withBusy(button, async () => {
      if (!navigator.onLine) {
        await saveMeetingOffline(project, payload);
        return;
      }
      const ref = firebase.database().ref('pmosMeetingNotes').push();
      const now = Date.now();
      const clientId = typeof pmosUuid === 'function' ? pmosUuid() : 'mtg_' + now;
      const record = {
        ...payload,
        id: ref.key,
        clientGeneratedId: clientId,
        module: 'Meeting Notes',
        projectId: project.id,
        projectName: project.name || project.id,
        schemaVersion: typeof PMOS_SCHEMA_VERSION !== 'undefined' ? PMOS_SCHEMA_VERSION : '1.0',
        syncStatus: 'synced',
        createdAt: now,
        updatedAt: now,
        createdBy: window._currentUser?.uid || '',
        createdByName: window._currentUser?.name || '',
        source: 'Line17 PMOS'
      };
      try {
        await ref.set(record);
        if (typeof pmosToast === 'function') pmosToast('Meeting notes saved');
        createMeetingNotification(record);
        if (typeof pmosAuditLog === 'function') {
          pmosAuditLog('create', 'pmos_meetings', project.id, ref.key, 'Meeting notes created');
        }
        return true;
      } catch (e) {
        if (String(e?.code || '').toLowerCase().includes('permission')) {
          try {
            await firebase.database().ref(`projects/${project.id}/pmosMeetingNotes/${ref.key}`).set({
              ...record, globalPathDenied: true
            });
            if (typeof pmosToast === 'function') pmosToast('Meeting notes saved');
            return true;
          } catch (fbError) {
            console.error('Meeting fallback failed:', fbError);
          }
        }
        await saveMeetingOffline(project, payload);
        return false;
      }
    }) : null);
  }

  async function saveMeetingOffline(project, payload) {
    const now = Date.now();
    const clientId = typeof pmosUuid === 'function' ? pmosUuid() : 'mtg_' + now;
    const offlineRecord = {
      localId: clientId,
      module: 'meeting',
      collection: 'pmosMeetingNotes',
      projectId: project.id,
      projectName: project.name || project.id,
      payload,
      syncStatus: 'queued',
      createdAt: now,
      createdBy: window._currentUser?.uid || '',
      createdByName: window._currentUser?.name || ''
    };
    try {
      const dbName = 'pmos_offline_queue';
      const storeName = 'offlineQueue';
      const req = indexedDB.open(dbName, 1);
      req.onsuccess = () => {
        const tx = req.result.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(offlineRecord);
        if (typeof pmosToast === 'function') pmosToast('Meeting notes saved offline');
      };
      req.onerror = () => {
        console.error('Could not save meeting offline');
        if (typeof pmosToast === 'function') pmosToast('Could not save meeting notes', 'error');
      };
    } catch (e) {
      console.error('Offline meeting save failed:', e);
    }
  }

  /* ---- Notification ---- */
  function createMeetingNotification(record) {
    try {
      if (typeof createNotificationEvent === 'function') {
        createNotificationEvent({
          projectId: record.projectId,
          module: 'pmos_meetings',
          type: 'meeting_notes_created',
          payload: {
            message: `Meeting Notes: ${record.meetingTitle || 'Untitled meeting'}`,
            projectName: record.projectName,
            idempotencyKey: `meeting_notes_created:${record.projectId}:${record.clientGeneratedId || record.id}`,
            notifyRole: 'pm,apm,boss,owner,admin',
            recordId: record.id
          }
        });
      }
    } catch (e) {
      console.warn('Meeting notification skipped:', e);
    }
  }

  /* ---- Office Hub: Render Meeting Notes view ---- */
  function pmosRenderMeetingNotes(records) {
    const meetings = records
      .filter(r => r.collection === 'pmosMeetingNotes' && !r.archived)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (!meetings.length) {
      return '<p class="empty-hint">No meeting notes yet. Create one from PMOS Mobile.</p>';
    }

    return `<div class="pmos-office-section">
      <h3>Meeting Notes &mdash; ${meetings.length} records</h3>
      <div class="pmos-filters">
        <select id="pmosMeetingType" onchange="pmosFilterMeetingNotes()">
          <option value="">All types</option>
          ${MEETING_TYPES.map(t => `<option value="${h(t)}">${h(t)}</option>`).join('')}
        </select>
        <select id="pmosMeetingStatus" onchange="pmosFilterMeetingNotes()">
          <option value="">All statuses</option>
          ${MEETING_STATUSES.map(s => `<option value="${h(s)}">${h(s)}</option>`).join('')}
        </select>
      </div>
      <div id="pmosMeetingList" class="pmos-office-list">
        ${meetings.map(meetingRow).join('')}
      </div>
    </div>`;
  }

  function meetingRow(r) {
    const date = r.meetingDate || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '');
    const title = r.meetingTitle || 'Untitled Meeting';
    return `<article class="pmos-office-row">
      <div>
        <div class="pmos-row-title">${h(title)}</div>
        <div class="pmos-row-meta">
          ${h(r.projectName || r.projectId || '')} &middot;
          ${h(r.meetingType || 'Meeting')} &middot;
          ${date} &middot;
          ${r.createdByName ? h(r.createdByName) : ''}
        </div>
        <div class="pmos-row-detail">
          ${r.attendees ? `Attendees: ${h(r.attendees)}` : ''}
          ${r.agenda ? ` | Agenda: ${h(r.agenda).slice(0, 100)}` : ''}
          ${r.decisions ? ` | Decisions: ${h(r.decisions).slice(0, 100)}` : ''}
        </div>
        ${r.actionItems ? `<div class="pmos-row-detail"><strong>Action Items:</strong> ${h(r.actionItems).slice(0, 200)}</div>` : ''}
      </div>
      <div class="pmos-row-actions">
        <span class="badge badge-${meetingStatusBadge(r.status || 'Draft')}">${h(r.status || 'Draft')}</span>
        <button type="button" onclick="pmosUpdateMeetingStatus('${h(r.id)}','${h(r.projectId || '')}','Reviewed')">Reviewed</button>
        <button type="button" onclick="pmosUpdateMeetingStatus('${h(r.id)}','${h(r.projectId || '')}','Closed')">Close</button>
        <button type="button" onclick="pmosUpdateMeetingStatus('${h(r.id)}','${h(r.projectId || '')}','Archived')">Archive</button>
        ${r.actionItems ? `<button type="button" onclick="pmosCreateFollowupFromMeeting('${h(r.id)}','${h(r.projectId || '')}','${h(r.actionItems).slice(0, 120).replace(/'/g, "\\'")}')">Create Follow-up</button>` : ''}
      </div>
    </article>`;
  }

  function meetingStatusBadge(status) {
    if (['Closed', 'Archived'].includes(status)) return 'green';
    if (['Action Required'].includes(status)) return 'red';
    if (['Submitted', 'Reviewed'].includes(status)) return 'blue';
    return 'amber';
  }

  /* ---- Status Update for Meeting Notes ---- */
  async function pmosUpdateMeetingStatus(id, projectId, status) {
    if (!id) return;
    const update = { status, updatedAt: Date.now(), updatedBy: window._currentUser?.uid || '', updatedByName: window._currentUser?.name || '' };
    try {
      await firebase.database().ref(`pmosMeetingNotes/${id}`).update(update);
      if (typeof pmosToast === 'function') pmosToast(`Meeting status: ${status}`);
      if (typeof pmosAuditLog === 'function') pmosAuditLog('status_change', 'pmos_meetings', projectId, id, `Meeting status changed to ${status}`);
    } catch (e) {
      if (projectId && String(e?.code || '').toLowerCase().includes('permission')) {
        try {
          await firebase.database().ref(`projects/${projectId}/pmosMeetingNotes/${id}`).update(update);
          if (typeof pmosToast === 'function') pmosToast(`Meeting status: ${status}`);
          return;
        } catch (fbError) {
          console.error('Meeting status fallback failed:', fbError);
        }
      }
      console.error('Meeting status update failed:', e);
      if (typeof pmosToast === 'function') pmosToast('Could not update meeting status.', 'error');
    }
  }

  /* ---- Filter Meeting Notes ---- */
  function pmosFilterMeetingNotes() {
    if (typeof renderPmosOffice === 'function') renderPmosOffice();
  }

  /* ---- Print Meeting Notes Report ---- */
  function pmosPrintMeetingReport(records) {
    const meetings = records.filter(r => r.collection === 'pmosMeetingNotes');
    if (!meetings.length) {
      if (typeof pmosToast === 'function') pmosToast('No meeting notes to print.', 'warn');
      return;
    }
    const win = window.open('', '_blank');
    if (!win) { if (typeof pmosToast === 'function') pmosToast('Popup blocked.', 'warn'); return; }
    win.document.write(`<!doctype html><html><head><title>Meeting Notes Report</title><style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111} h1{font-size:22px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}
      th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}
      th{background:#f3f4f6} .notes{max-width:400px;white-space:pre-wrap}
    </style></head><body>
      <h1>Meeting Notes Summary</h1>
      <p>Generated ${new Date().toLocaleString('en-PH')} &mdash; ${meetings.length} meetings</p>
      <table><thead><tr>
        <th>Project</th><th>Title</th><th>Type</th><th>Date</th><th>Attendees</th>
        <th>Discussion</th><th>Decisions</th><th>Action Items</th><th>Status</th>
      </tr></thead><tbody>
      ${meetings.map(r => `<tr>
        <td>${h(r.projectName || r.projectId || '')}</td>
        <td>${h(r.meetingTitle || '')}</td>
        <td>${h(r.meetingType || '')}</td>
        <td>${h(r.meetingDate || '')}</td>
        <td class="notes">${h(r.attendees || '')}</td>
        <td class="notes">${h(r.discussion || '').slice(0, 300)}</td>
        <td class="notes">${h(r.decisions || '').slice(0, 200)}</td>
        <td class="notes">${h(r.actionItems || '').slice(0, 200)}</td>
        <td>${h(r.status || 'Draft')}</td>
      </tr>`).join('')}
      </tbody></table></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  /* ---- Action Item to Follow-up Conversion ---- */
  async function pmosCreateFollowupFromMeeting(meetingId, projectId, actionItemText) {
    if (!meetingId || !projectId) {
      if (typeof pmosToast === 'function') pmosToast('Cannot create follow-up: missing meeting or project.', 'error');
      return;
    }
    try {
      // Check for existing follow-up with same source relationship
      const existingSnap = await firebase.database().ref('pmosTasks')
        .orderByChild('sourceModule')
        .equalTo('meeting-notes')
        .once('value');
      var alreadyExists = false;
      existingSnap.forEach(function (child) {
        var task = child.val() || {};
        if (task.sourceRecordId === meetingId) {
          alreadyExists = true;
        }
      });

      if (alreadyExists) {
        if (typeof pmosToast === 'function') pmosToast('Follow-up already created from this meeting.', 'warn');
        return;
      }

      // No existing follow-up found — create one
      // Use canonical task path: projects/{projectId}/tasks/{taskId}
      var adapter = window.PmosTaskAdapter;
      if (adapter) {
        var taskData = {
          title: actionItemText || 'Follow-up from meeting',
          assignedToName: '',
          description: 'Created from Meeting Notes action item',
          dueDate: '',
          priority: 'normal',
          status: 'open',
          source: 'Line17 PMOS',
          category: 'meeting-followup',
          createdByName: window._currentUser?.name || '',
          createdBy: window._currentUser?.uid || '',
          sourceModule: 'meeting-notes',
          sourceRecordId: meetingId
        };
        try {
          var result = await adapter.createCanonicalTask(projectId, taskData);
          if (typeof pmosToast === 'function') pmosToast('Follow-up task created.');
          if (typeof pmosAuditLog === 'function') {
            pmosAuditLog('create_followup_from_meeting', 'acpm_tasks', projectId, result.key, 'Follow-up created from meeting action item');
          }
          if (typeof renderPmosOffice === 'function') renderPmosOffice();
        } catch (e) {
          console.error('Follow-up canonical create failed:', e);
          if (typeof pmosToast === 'function') pmosToast('Could not create follow-up task.', 'error');
        }
      } else {
        // Adapter not loaded — use legacy pmosTasks path
        var taskRef = firebase.database().ref('pmosTasks').push();
        var now = Date.now();
        var task = {
          id: taskRef.key,
          task: actionItemText || 'Follow-up from meeting',
          person: '',
          dueDate: '',
          priority: 'Normal',
          status: 'New',
          remarks: 'Created from Meeting Notes action item',
          projectId: projectId,
          module: 'Follow-ups',
          sourceModule: 'meeting-notes',
          sourceRecordId: meetingId,
          schemaVersion: typeof PMOS_SCHEMA_VERSION !== 'undefined' ? PMOS_SCHEMA_VERSION : '1.0',
          syncStatus: 'synced',
          createdAt: now,
          updatedAt: now,
          createdBy: window._currentUser?.uid || '',
          createdByName: window._currentUser?.name || '',
          source: 'Line17 PMOS'
        };
        try {
          await taskRef.set(task);
          if (typeof pmosToast === 'function') pmosToast('Follow-up task created from meeting action item.');
          if (typeof pmosAuditLog === 'function') {
            pmosAuditLog('create_followup_from_meeting', 'pmos_tasks', projectId, taskRef.key, 'Follow-up created from meeting action item');
          }
          if (typeof renderPmosOffice === 'function') renderPmosOffice();
        } catch (e) {
          if (String(e?.code || '').toLowerCase().includes('permission')) {
            try {
              await firebase.database().ref('projects/' + projectId + '/pmosTasks/' + taskRef.key).set(task);
              if (typeof pmosToast === 'function') pmosToast('Follow-up task created (project path).');
              if (typeof renderPmosOffice === 'function') renderPmosOffice();
              return;
            } catch (fbError) {
              console.error('Follow-up creation fallback failed:', fbError);
            }
          }
          console.error('Follow-up creation failed:', e);
          if (typeof pmosToast === 'function') pmosToast('Could not create follow-up task.', 'error');
        }
      }
    } catch (e) {
      console.error('Follow-up check failed:', e);
      if (typeof pmosToast === 'function') pmosToast('Could not check for existing follow-up.', 'error');
    }
  }

  /* ---- Exports ---- */
  window.pmosSaveMeeting = pmosSaveMeeting;
  window.pmosRenderMeetingNotes = pmosRenderMeetingNotes;
  window.pmosUpdateMeetingStatus = pmosUpdateMeetingStatus;
  window.pmosFilterMeetingNotes = pmosFilterMeetingNotes;
  window.pmosPrintMeetingReport = pmosPrintMeetingReport;
  window.pmosCreateFollowupFromMeeting = pmosCreateFollowupFromMeeting;
  window.MEETING_STATUSES = MEETING_STATUSES;
  window.MEETING_TYPES = MEETING_TYPES;
})();
