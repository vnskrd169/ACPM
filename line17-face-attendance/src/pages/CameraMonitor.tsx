import { useEffect, useMemo, useState } from 'react';
import { audit } from '../services/audit';
import { db } from '../services/db';
import type { AttendanceRecord, CameraEvent, CameraEventType, MatchLabel, ToastMessage } from '../types';
import { objectUrl } from '../utils/imageUtils';

interface CameraMonitorProps {
  dataVersion: number;
  notify: (text: string, type?: ToastMessage['type']) => void;
  refreshData: () => void;
}

const EVENT_TYPES: CameraEventType[] = ['Locked Match', 'Unknown Face', 'Quality Hold', 'No Face'];

export function CameraMonitor({ dataVersion, notify, refreshData }: CameraMonitorProps) {
  const [events, setEvents] = useState<CameraEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    loadEvents();
  }, [dataVersion]);

  async function loadEvents() {
    const rows = await db.cameraEvents.orderBy('createdAt').reverse().toArray();
    setEvents(rows);
  }

  const visibleEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter(event => {
      const matchesType = !filter || event.eventType === filter;
      const matchesSearch = !needle || [
        event.eventType,
        event.workerName,
        event.matchLabel,
        event.matchDistance?.toString(),
        event.qualitySummary
      ].filter(Boolean).join(' ').toLowerCase().includes(needle);
      return matchesType && matchesSearch;
    });
  }, [events, filter, query]);

  const stats = useMemo(() => ({
    total: events.length,
    locked: events.filter(event => event.eventType === 'Locked Match').length,
    unknown: events.filter(event => event.eventType === 'Unknown Face').length,
    holds: events.filter(event => event.eventType === 'Quality Hold' || event.eventType === 'No Face').length
  }), [events]);

  async function createDraft(event: CameraEvent) {
    if (!event.workerId || !event.workerName || !event.matchLabel || typeof event.matchDistance !== 'number') {
      notify('This camera event does not have enough match evidence for an attendance draft.', 'warning');
      return;
    }
    const record: AttendanceRecord = {
      attendanceId: crypto.randomUUID(),
      attendanceType: 'Time In',
      selfieBlob: event.snapshotBlob,
      faceDetected: true,
      multipleFacesDetected: false,
      suggestedWorkerId: event.workerId,
      suggestedWorkerName: event.workerName,
      matchDistance: event.matchDistance,
      matchLabel: event.matchLabel,
      topMatches: [{
        workerId: event.workerId,
        workerName: event.workerName,
        distance: event.matchDistance,
        matchLabel: event.matchLabel as MatchLabel
      }],
      reviewStatus: 'For Review',
      notes: `Created from Camera Monitor event ${event.eventId}. Manual review required.`,
      createdAt: Date.now()
    };
    await db.attendanceRecords.add(record);
    await audit('camera_event_attendance_draft_created', 'attendance', record.attendanceId, {
      cameraEventId: event.eventId,
      workerId: event.workerId,
      matchDistance: event.matchDistance
    });
    refreshData();
    notify(`Attendance draft created for ${event.workerName}.`, 'success');
  }

  async function deleteEvent(event: CameraEvent) {
    if (!window.confirm('Delete this local camera event?')) return;
    await db.cameraEvents.delete(event.eventId);
    await audit('camera_event_deleted', 'camera_event', event.eventId, { eventType: event.eventType });
    await loadEvents();
    notify('Camera event deleted.', 'warning');
  }

  async function clearEvents() {
    if (!window.confirm('Clear all local camera events? Attendance records will stay.')) return;
    await db.cameraEvents.clear();
    await audit('camera_events_cleared', 'camera_event', 'all', { count: events.length });
    await loadEvents();
    notify('Camera events cleared.', 'warning');
  }

  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="eyebrow">Camera Monitor</span>
        <h1>Local Detection Review</h1>
        <p>Review live camera events, inspect snapshots, and create attendance drafts from stable locked matches.</p>
      </section>

      <section className="stat-grid">
        <div className="stat-card stat-blue"><span>Total events</span><strong>{stats.total}</strong></div>
        <div className="stat-card stat-teal"><span>Locked matches</span><strong>{stats.locked}</strong></div>
        <div className="stat-card stat-amber"><span>Unknown faces</span><strong>{stats.unknown}</strong></div>
        <div className="stat-card stat-red"><span>Holds / no face</span><strong>{stats.holds}</strong></div>
      </section>

      <section className="panel-card">
        <div className="toolbar">
          <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="">All camera events</option>
            {EVENT_TYPES.map(type => <option key={type}>{type}</option>)}
          </select>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search worker, label, distance, quality" />
          <button className="ghost-btn" onClick={loadEvents}>Refresh</button>
          <button className="danger-btn" disabled={!events.length} onClick={clearEvents}>Clear Events</button>
        </div>
        <div className="camera-monitor-list">
          {visibleEvents.length ? visibleEvents.map(event => (
            <CameraMonitorCard
              key={event.eventId}
              event={event}
              onCreateDraft={() => createDraft(event)}
              onDelete={() => deleteEvent(event)}
            />
          )) : (
            <div className="empty-state"><strong>No camera events found</strong><span>Start live camera scanning to build the local event history.</span></div>
          )}
        </div>
      </section>
    </div>
  );
}

function CameraMonitorCard({
  event,
  onCreateDraft,
  onDelete
}: {
  event: CameraEvent;
  onCreateDraft: () => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = objectUrl(event.snapshotBlob);
    setUrl(next);
    return () => {
      if (next) URL.revokeObjectURL(next);
    };
  }, [event.snapshotBlob]);
  const canDraft = event.eventType === 'Locked Match' && !!event.workerId && !!event.workerName;
  return (
    <article className={`camera-monitor-card event-${event.eventType.toLowerCase().replace(/\s+/g, '-')}`}>
      {url ? <img src={url} alt={event.eventType} /> : <div className="large-empty">No snapshot</div>}
      <div className="camera-monitor-main">
        <div className="attendance-title">
          <strong>{event.workerName || event.eventType}</strong>
          <b>{event.eventType}</b>
        </div>
        <div className="attendance-meta">{new Date(event.createdAt).toLocaleString()}</div>
        <div className="attendance-meta">ID: {event.eventId}</div>
        <div className="settings-summary">
          <div><span>Match</span><strong>{event.matchLabel || '-'}</strong></div>
          <div><span>Distance</span><strong>{event.matchDistance ?? '-'}</strong></div>
          <div><span>Worker</span><strong>{event.workerName || '-'}</strong></div>
          <div><span>Quality</span><strong>{event.qualitySummary || '-'}</strong></div>
        </div>
        <div className="action-row">
          <button className="primary-btn" disabled={!canDraft} onClick={onCreateDraft}>Create Attendance Draft</button>
          <button className="danger-btn" onClick={onDelete}>Delete Event</button>
        </div>
      </div>
    </article>
  );
}
