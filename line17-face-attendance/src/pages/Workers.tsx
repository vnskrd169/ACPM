import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { audit } from '../services/audit';
import { db } from '../services/db';
import type { ToastMessage, Worker } from '../types';
import { ReferenceThumb } from './EnrollWorker';

interface WorkersProps {
  dataVersion: number;
  notify: (text: string, type?: ToastMessage['type']) => void;
  refreshData: () => void;
}

export function Workers({ dataVersion, notify, refreshData }: WorkersProps) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [counts, setCounts] = useState<Record<string, { photos: number; descriptors: number }>>({});
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState<Partial<Worker>>({});

  useEffect(() => {
    async function load() {
      const [workerRows, descriptors, photos] = await Promise.all([
        db.workers.orderBy('workerName').toArray(),
        db.faceDescriptors.toArray(),
        db.referencePhotos.toArray()
      ]);
      const nextCounts: Record<string, { photos: number; descriptors: number }> = {};
      workerRows.forEach(worker => {
        nextCounts[worker.workerId] = {
          photos: photos.filter(photo => photo.workerId === worker.workerId).length,
          descriptors: descriptors.filter(descriptor => descriptor.workerId === worker.workerId).length
        };
      });
      setWorkers(workerRows);
      setCounts(nextCounts);
    }
    load();
  }, [dataVersion]);

  const filtered = useMemo(() => workers.filter(worker => {
    const text = `${worker.workerName} ${worker.trade || ''} ${worker.workerCode || ''}`.toLowerCase();
    return text.includes(query.toLowerCase());
  }), [workers, query]);

  function startEdit(worker: Worker) {
    setEditingId(worker.workerId);
    setDraft(worker);
  }

  async function saveWorker(worker: Worker) {
    await db.workers.update(worker.workerId, {
      workerName: draft.workerName?.trim() || worker.workerName,
      trade: draft.trade || '',
      dailyRate: Number(draft.dailyRate || 0) || undefined,
      workerCode: draft.workerCode || '',
      notes: draft.notes || '',
      updatedAt: Date.now()
    });
    await audit('worker_updated', 'worker', worker.workerId, {});
    setEditingId('');
    refreshData();
    notify('Worker updated.', 'success');
  }

  async function deleteFaceData(worker: Worker) {
    if (!window.confirm(`Delete face descriptors and reference photos for ${worker.workerName}?`)) return;
    await db.transaction('rw', db.faceDescriptors, db.referencePhotos, db.workers, async () => {
      await db.faceDescriptors.where('workerId').equals(worker.workerId).delete();
      await db.referencePhotos.where('workerId').equals(worker.workerId).delete();
      await db.workers.update(worker.workerId, {
        faceEnrollmentStatus: 'Not Enrolled',
        updatedAt: Date.now()
      });
    });
    await audit('face_data_deleted', 'worker', worker.workerId, {});
    refreshData();
    notify('Face data deleted.', 'warning');
  }

  async function revokeConsent(worker: Worker) {
    if (!window.confirm(`Revoke consent for ${worker.workerName}? Matching will be disabled.`)) return;
    await db.workers.update(worker.workerId, {
      consentRecorded: false,
      faceEnrollmentStatus: 'Revoked',
      updatedAt: Date.now()
    });
    await audit('consent_revoked', 'worker', worker.workerId, {});
    refreshData();
    notify('Consent revoked.', 'warning');
  }

  async function deleteWorker(worker: Worker) {
    if (!window.confirm(`Delete ${worker.workerName} and all local face data?`)) return;
    await db.transaction('rw', db.workers, db.faceDescriptors, db.referencePhotos, async () => {
      await db.workers.delete(worker.workerId);
      await db.faceDescriptors.where('workerId').equals(worker.workerId).delete();
      await db.referencePhotos.where('workerId').equals(worker.workerId).delete();
    });
    await audit('worker_deleted', 'worker', worker.workerId, {});
    refreshData();
    notify('Worker deleted.', 'warning');
  }

  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="eyebrow">Workers</span>
        <h1>Local Worker Profiles</h1>
        <p>Manage worker details, enrollment status, consent, and locally stored face data.</p>
      </section>
      <section className="panel-card">
        <div className="toolbar">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search workers..." />
        </div>
        <div className="worker-grid">
          {filtered.length ? filtered.map(worker => (
            <WorkerCard
              key={worker.workerId}
              worker={worker}
              counts={counts[worker.workerId] || { photos: 0, descriptors: 0 }}
              editing={editingId === worker.workerId}
              draft={draft}
              onDraft={setDraft}
              onEdit={() => startEdit(worker)}
              onSave={() => saveWorker(worker)}
              onCancel={() => setEditingId('')}
              onDeleteFace={() => deleteFaceData(worker)}
              onRevoke={() => revokeConsent(worker)}
              onDelete={() => deleteWorker(worker)}
            />
          )) : <EmptyState title="No workers found" text="Enroll a worker to build the local roster." />}
        </div>
      </section>
    </div>
  );
}

function WorkerCard({
  worker,
  counts,
  editing,
  draft,
  onDraft,
  onEdit,
  onSave,
  onCancel,
  onDeleteFace,
  onRevoke,
  onDelete
}: {
  worker: Worker;
  counts: { photos: number; descriptors: number };
  editing: boolean;
  draft: Partial<Worker>;
  onDraft: (worker: Partial<Worker>) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDeleteFace: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const [photo, setPhoto] = useState<Blob | undefined>();
  useEffect(() => {
    db.referencePhotos.where('workerId').equals(worker.workerId).first().then(item => setPhoto(item?.blob));
  }, [worker.workerId, counts.photos]);

  return (
    <article className="worker-card">
      <div className="worker-thumb"><ReferenceThumb blob={photo} /></div>
      {editing ? (
        <div className="form-grid single">
          <label><span>Name</span><input value={draft.workerName || ''} onChange={event => onDraft({ ...draft, workerName: event.target.value })} /></label>
          <label><span>Trade</span><input value={draft.trade || ''} onChange={event => onDraft({ ...draft, trade: event.target.value })} /></label>
          <label><span>Daily rate</span><input type="number" value={draft.dailyRate || ''} onChange={event => onDraft({ ...draft, dailyRate: Number(event.target.value) })} /></label>
          <label><span>Worker code</span><input value={draft.workerCode || ''} onChange={event => onDraft({ ...draft, workerCode: event.target.value })} /></label>
          <label><span>Notes</span><textarea rows={2} value={draft.notes || ''} onChange={event => onDraft({ ...draft, notes: event.target.value })} /></label>
          <div className="action-row"><button className="primary-btn" onClick={onSave}>Save</button><button className="ghost-btn" onClick={onCancel}>Cancel</button></div>
        </div>
      ) : (
        <>
          <div className="worker-card-head">
            <div>
              <strong>{worker.workerName}</strong>
              <span>{worker.trade || 'No trade'} {worker.workerCode ? `- ${worker.workerCode}` : ''}</span>
            </div>
            <b>{worker.faceEnrollmentStatus}</b>
          </div>
          <div className="settings-summary">
            <div><span>Consent</span><strong>{worker.consentRecorded ? 'Yes' : 'No'}</strong></div>
            <div><span>Photos</span><strong>{counts.photos}</strong></div>
            <div><span>Descriptors</span><strong>{counts.descriptors}</strong></div>
          </div>
          {worker.notes && <p className="note-line">{worker.notes}</p>}
          <div className="action-row">
            <button className="ghost-btn" onClick={onEdit}>Edit</button>
            <button className="ghost-btn" onClick={onDeleteFace}>Delete Face Data</button>
            <button className="ghost-btn" onClick={onRevoke}>Revoke Consent</button>
            <button className="danger-btn" onClick={onDelete}>Delete Worker</button>
          </div>
        </>
      )}
    </article>
  );
}
