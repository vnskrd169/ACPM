import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { audit } from '../services/audit';
import { db } from '../services/db';
import type { AttendanceRecord, ReviewStatus, ToastMessage, Worker } from '../types';
import { objectUrl } from '../utils/imageUtils';

interface AttendanceRecordsProps {
  dataVersion: number;
  notify: (text: string, type?: ToastMessage['type']) => void;
  refreshData: () => void;
}

export function AttendanceRecords({ dataVersion, notify, refreshData }: AttendanceRecordsProps) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    Promise.all([
      db.attendanceRecords.orderBy('createdAt').reverse().toArray(),
      db.workers.orderBy('workerName').toArray()
    ]).then(([recordRows, workerRows]) => {
      setRecords(recordRows);
      setWorkers(workerRows);
    });
  }, [dataVersion]);

  const visible = records.filter(record => !filter || record.reviewStatus === filter);

  async function updateStatus(record: AttendanceRecord, reviewStatus: ReviewStatus) {
    await db.attendanceRecords.update(record.attendanceId, {
      reviewStatus,
      reviewedAt: Date.now(),
      finalWorkerId: reviewStatus === 'Unknown' ? undefined : record.finalWorkerId || record.suggestedWorkerId,
      finalWorkerName: reviewStatus === 'Unknown' ? undefined : record.finalWorkerName || record.suggestedWorkerName
    });
    await audit(`attendance_${reviewStatus.toLowerCase().replace(/\s+/g, '_')}`, 'attendance', record.attendanceId, { reviewStatus });
    refreshData();
    notify(`Attendance marked ${reviewStatus}.`, 'success');
  }

  async function changeWorker(record: AttendanceRecord, workerId: string) {
    const worker = workers.find(row => row.workerId === workerId);
    await db.attendanceRecords.update(record.attendanceId, {
      finalWorkerId: worker?.workerId || undefined,
      finalWorkerName: worker?.workerName || undefined,
      reviewStatus: worker ? 'Needs Correction' : 'Unknown',
      reviewedAt: Date.now()
    });
    await audit('attendance_corrected', 'attendance', record.attendanceId, { finalWorkerId: worker?.workerId, finalWorkerName: worker?.workerName });
    refreshData();
    notify('Matched worker updated for review.', 'success');
  }

  async function addNote(record: AttendanceRecord) {
    const notes = window.prompt('Attendance note:', record.notes || '');
    if (notes === null) return;
    await db.attendanceRecords.update(record.attendanceId, { notes, reviewedAt: Date.now() });
    await audit('attendance_note_added', 'attendance', record.attendanceId, { notes });
    refreshData();
  }

  async function deleteRecord(record: AttendanceRecord) {
    if (!window.confirm('Delete this attendance record from local storage?')) return;
    await db.attendanceRecords.delete(record.attendanceId);
    await audit('attendance_deleted', 'attendance', record.attendanceId, {});
    refreshData();
    notify('Attendance record deleted.', 'warning');
  }

  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="eyebrow">Manual Review</span>
        <h1>Attendance Records</h1>
        <p>AI suggestions stay as drafts until you approve, reject, correct, or mark them unknown.</p>
      </section>

      <section className="panel-card">
        <div className="toolbar">
          <select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="">All review statuses</option>
            {['For Review', 'Approved', 'Rejected', 'Needs Correction', 'Unknown'].map(status => <option key={status}>{status}</option>)}
          </select>
        </div>
        <div className="attendance-grid">
          {visible.length ? visible.map(record => (
            <AttendanceCard
              key={record.attendanceId}
              record={record}
              workers={workers}
              onStatus={status => updateStatus(record, status)}
              onWorker={workerId => changeWorker(record, workerId)}
              onNote={() => addNote(record)}
              onDelete={() => deleteRecord(record)}
            />
          )) : <EmptyState title="No attendance records" text="Scan a selfie to create the first For Review draft." />}
        </div>
      </section>
    </div>
  );
}

function AttendanceCard({
  record,
  workers,
  onStatus,
  onWorker,
  onNote,
  onDelete
}: {
  record: AttendanceRecord;
  workers: Worker[];
  onStatus: (status: ReviewStatus) => void;
  onWorker: (workerId: string) => void;
  onNote: () => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = objectUrl(record.selfieBlob);
    setUrl(next);
    return () => {
      if (next) URL.revokeObjectURL(next);
    };
  }, [record.selfieBlob]);

  return (
    <article className="attendance-card">
      {url ? <img src={url} alt="Selfie" /> : <div className="large-empty">No selfie</div>}
      <div className="attendance-main">
        <div className="attendance-title">
          <strong>{record.suggestedWorkerName || 'Unknown worker'}</strong>
          <b>{record.reviewStatus}</b>
        </div>
        <div className="attendance-meta">ID: {record.attendanceId}</div>
        <div className="attendance-meta">{record.attendanceType} - {new Date(record.createdAt).toLocaleString()}</div>
        <div className="settings-summary">
          <div><span>Match</span><strong>{record.matchLabel}</strong></div>
          <div><span>Distance</span><strong>{record.matchDistance ?? '-'}</strong></div>
          <div><span>Final Worker</span><strong>{record.finalWorkerName || '-'}</strong></div>
        </div>
        <div className="top-matches">
          {record.topMatches.map((match, index) => (
            <div key={`${record.attendanceId}_${match.workerId}`} className="mini-match">
              {index + 1}. {match.workerName} - {match.distance} - {match.matchLabel}
            </div>
          ))}
        </div>
        {record.notes && <p className="note-line">{record.notes}</p>}
        <div className="action-row">
          <button className="primary-btn" onClick={() => onStatus('Approved')}>Approve</button>
          <button className="ghost-btn" onClick={() => onStatus('Rejected')}>Reject</button>
          <button className="ghost-btn" onClick={() => onStatus('Unknown')}>Mark Unknown</button>
          <select onChange={event => event.target.value && onWorker(event.target.value)} defaultValue="">
            <option value="">Change matched worker</option>
            {workers.map(worker => <option key={worker.workerId} value={worker.workerId}>{worker.workerName}</option>)}
          </select>
          <button className="ghost-btn" onClick={onNote}>Add Note</button>
          <button className="danger-btn" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </article>
  );
}
