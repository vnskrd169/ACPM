import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { StatCard } from '../components/StatCard';
import { db } from '../services/db';
import type { AppSettings, AttendanceRecord, ModelStatus, Worker } from '../types';

interface DashboardProps {
  dataVersion: number;
  settings: AppSettings;
  modelStatus: ModelStatus;
  modelMessage: string;
  onNavigate: (page: string) => void;
}

export function Dashboard({ dataVersion, settings, modelStatus, modelMessage, onNavigate }: DashboardProps) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);

  useEffect(() => {
    Promise.all([
      db.workers.toArray(),
      db.attendanceRecords.orderBy('createdAt').reverse().limit(6).toArray()
    ]).then(([workerRows, attendanceRows]) => {
      setWorkers(workerRows);
      setAttendance(attendanceRows);
    });
  }, [dataVersion]);

  const complete = workers.filter(worker => worker.faceEnrollmentStatus === 'Complete').length;
  const forReview = attendance.filter(row => row.reviewStatus === 'For Review').length;

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div>
          <span className="eyebrow">Local-first</span>
          <h1>Face Attendance Dashboard</h1>
          <p>Enroll construction workers, scan selfies, and prepare attendance drafts for manual review without Firebase, cloud uploads, or paid APIs.</p>
        </div>
        <div className={`hero-model status-${modelStatus}`}>
          <span>Face model</span>
          <strong>{modelStatus === 'ready' ? 'Ready to scan' : 'Setup needed'}</strong>
          <small>{modelMessage}</small>
        </div>
      </section>

      <section className="stat-grid">
        <StatCard label="Total enrolled workers" value={workers.length} />
        <StatCard label="Complete enrollments" value={complete} tone="blue" />
        <StatCard label="Attendance scans" value={attendance.length} tone="amber" />
        <StatCard label="For review" value={forReview} tone="red" />
      </section>

      <section className="quick-grid">
        {[
          ['enroll', 'Enroll Worker', 'Add consent and 3 to 5 reference photos.'],
          ['scan', 'Scan Selfie', 'Run local face recognition and save a draft.'],
          ['attendance', 'Attendance Records', 'Approve, reject, correct, or mark unknown.'],
          ['workers', 'Workers', 'Manage profiles, face data, and consent.'],
          ['settings', 'Settings', 'Thresholds, models, backup, and deletion.']
        ].map(([key, title, text]) => (
          <button key={key} className="quick-card" onClick={() => onNavigate(key)}>
            <strong>{title}</strong>
            <span>{text}</span>
          </button>
        ))}
      </section>

      <section className="split-grid">
        <div className="panel-card">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Recent</span>
              <h2>Attendance Scans</h2>
            </div>
          </div>
          {attendance.length ? (
            <div className="record-list">
              {attendance.map(record => (
                <article className="compact-row" key={record.attendanceId}>
                  <div>
                    <strong>{record.suggestedWorkerName || 'Unknown worker'}</strong>
                    <span>{record.attendanceType} - {record.matchLabel} - {record.matchDistance ?? '-'}</span>
                  </div>
                  <b>{record.reviewStatus}</b>
                </article>
              ))}
            </div>
          ) : <EmptyState title="No scans yet" text="Use Selfie Scan to create the first attendance draft." />}
        </div>

        <div className="panel-card">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Current Settings</span>
              <h2>Matching Thresholds</h2>
            </div>
          </div>
          <div className="settings-summary">
            <div><span>Strong Match</span><strong>{settings.strongMatchThreshold}</strong></div>
            <div><span>Possible Match</span><strong>{settings.possibleMatchThreshold}</strong></div>
            <div><span>Model Path</span><strong>{settings.modelPath}</strong></div>
          </div>
        </div>
      </section>
    </div>
  );
}
