import { useEffect, useMemo, useState } from 'react';
import { audit } from '../services/audit';
import { db } from '../services/db';
import { analyzeFace, getModelName } from '../services/faceEngine';
import type { AppSettings, EnrollmentStatus, ReferencePhoto, ToastMessage, Worker } from '../types';
import { enrollmentStatus } from '../utils/thresholds';
import { objectUrl, resizeImageBlob } from '../utils/imageUtils';

interface EnrollWorkerProps {
  settings: AppSettings;
  modelReady: boolean;
  modelMessage: string;
  notify: (text: string, type?: ToastMessage['type']) => void;
  refreshData: () => void;
}

interface PendingPhoto {
  id: string;
  file: File;
  previewUrl: string;
  status: 'Pending' | 'Valid' | 'Rejected';
  message: string;
}

export function EnrollWorker({ settings, modelReady, modelMessage, notify, refreshData }: EnrollWorkerProps) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [trade, setTrade] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [workerCode, setWorkerCode] = useState('');
  const [consentRecorded, setConsentRecorded] = useState(false);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    db.workers.orderBy('workerName').toArray().then(setWorkers);
  }, []);

  useEffect(() => () => photos.forEach(photo => URL.revokeObjectURL(photo.previewUrl)), [photos]);

  const selectedWorker = useMemo(() => workers.find(worker => worker.workerId === selectedWorkerId), [workers, selectedWorkerId]);

  function resetForm() {
    setSelectedWorkerId('');
    setWorkerName('');
    setTrade('');
    setDailyRate('');
    setWorkerCode('');
    setConsentRecorded(false);
    setNotes('');
    setPhotos([]);
  }

  function loadWorker(worker: Worker) {
    setSelectedWorkerId(worker.workerId);
    setWorkerName(worker.workerName);
    setTrade(worker.trade || '');
    setDailyRate(worker.dailyRate ? String(worker.dailyRate) : '');
    setWorkerCode(worker.workerCode || '');
    setConsentRecorded(worker.consentRecorded);
    setNotes(worker.notes || '');
    setPhotos([]);
  }

  function handlePhotos(files: FileList | null) {
    const next = Array.from(files || []).slice(0, 5).map(file => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'Pending' as const,
      message: 'Ready for validation'
    }));
    setPhotos(current => {
      current.forEach(photo => URL.revokeObjectURL(photo.previewUrl));
      return next;
    });
  }

  async function saveEnrollment() {
    if (!modelReady) {
      notify(modelMessage, 'error');
      return;
    }
    if (!workerName.trim()) {
      notify('Enter worker name.', 'error');
      return;
    }
    if (!consentRecorded) {
      notify('Consent must be recorded before face enrollment.', 'error');
      return;
    }
    if (photos.length < 3 || photos.length > 5) {
      notify('Upload 3 to 5 reference photos.', 'error');
      return;
    }

    if (selectedWorkerId) {
      const existingCount = await db.faceDescriptors.where('workerId').equals(selectedWorkerId).count();
      if (existingCount > 0 && !window.confirm(
        `${selectedWorker?.workerName || 'This worker'} already has ${existingCount} saved face sample${existingCount === 1 ? '' : 's'}. ` +
        'Processing new photos replaces all of them. Continue?'
      )) {
        return;
      }
    } else {
      const trimmedName = workerName.trim().toLowerCase();
      const trimmedCode = workerCode.trim().toLowerCase();
      const possibleDuplicate = workers.find(worker =>
        worker.workerName.trim().toLowerCase() === trimmedName ||
        (trimmedCode && worker.workerCode?.trim().toLowerCase() === trimmedCode)
      );
      if (possibleDuplicate && !window.confirm(
        `A worker named "${possibleDuplicate.workerName}"${possibleDuplicate.workerCode ? ` (code ${possibleDuplicate.workerCode})` : ''} already exists. ` +
        'Creating a new profile instead of editing that one will split their attendance history across two records. Continue anyway?'
      )) {
        return;
      }
    }

    setBusy(true);
    try {
      const now = Date.now();
      const workerId = selectedWorkerId || crypto.randomUUID();
      const worker: Worker = {
        workerId,
        workerName: workerName.trim(),
        trade: trade.trim(),
        dailyRate: Number(dailyRate || 0) || undefined,
        workerCode: workerCode.trim(),
        consentRecorded,
        consentRecordedAt: selectedWorker?.consentRecordedAt || now,
        faceEnrollmentStatus: 'Failed',
        notes: notes.trim(),
        createdAt: selectedWorker?.createdAt || now,
        updatedAt: now
      };

      await db.transaction('rw', db.workers, db.faceDescriptors, db.referencePhotos, async () => {
        await db.workers.put(worker);
        await db.faceDescriptors.where('workerId').equals(workerId).delete();
        await db.referencePhotos.where('workerId').equals(workerId).delete();
      });
      if (!selectedWorkerId) await audit('worker_created', 'worker', workerId, { workerName: worker.workerName });
      if (consentRecorded) await audit('consent_recorded', 'worker', workerId, { workerName: worker.workerName });

      let validCount = 0;
      const processed: PendingPhoto[] = [];
      for (const pending of photos) {
        const blob = await resizeImageBlob(pending.file);
        const result = await analyzeFace(blob, settings.modelPath);
        if (!result.ok || !result.descriptor || result.multipleFacesDetected) {
          processed.push({
            ...pending,
            status: 'Rejected',
            message: result.multipleFacesDetected ? 'Multiple faces detected. Use one worker per reference photo.' : result.error || 'Photo rejected.'
          });
          const photoRecord: ReferencePhoto = {
            photoId: crypto.randomUUID(),
            workerId,
            fileName: pending.file.name,
            blob,
            faceDetected: result.faceDetected,
            multipleFacesDetected: result.multipleFacesDetected,
            rejectionReason: result.error || result.warning || 'Rejected',
            createdAt: Date.now()
          };
          await db.referencePhotos.put(photoRecord);
          continue;
        }

        const descriptorId = crypto.randomUUID();
        const photoId = crypto.randomUUID();
        await db.referencePhotos.put({
          photoId,
          workerId,
          fileName: pending.file.name,
          blob,
          descriptorId,
          faceDetected: true,
          multipleFacesDetected: false,
          createdAt: Date.now()
        });
        await db.faceDescriptors.put({
          descriptorId,
          workerId,
          vector: result.descriptor,
          model: getModelName(),
          sourcePhotoName: pending.file.name,
          createdAt: Date.now()
        });
        validCount += 1;
        processed.push({ ...pending, status: 'Valid', message: 'Descriptor generated' });
      }

      const status = enrollmentStatus(validCount) as EnrollmentStatus;
      await db.workers.update(workerId, {
        faceEnrollmentStatus: status,
        updatedAt: Date.now()
      });
      await audit('face_enrolled', 'worker', workerId, { validReferencePhotos: validCount, status });
      setPhotos(processed);
      const refreshed = await db.workers.orderBy('workerName').toArray();
      setWorkers(refreshed);
      setSelectedWorkerId(workerId);
      refreshData();
      notify(`Enrollment ${status}. ${validCount} valid descriptors saved.`, status === 'Complete' ? 'success' : 'warning');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Enrollment failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="eyebrow">Worker Enrollment</span>
        <h1>Enroll Worker Face References</h1>
        <p>Record consent, upload 3 to 5 reference photos, and generate local face descriptors in IndexedDB.</p>
      </section>

      {!modelReady && (
        <div className="warning-card">
          <strong>Model setup required</strong>
          <span>{modelMessage}</span>
        </div>
      )}

      <section className="enroll-layout">
        <div className="panel-card">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Workers</span>
              <h2>Existing Profiles</h2>
            </div>
            <button className="ghost-btn" onClick={resetForm}>New</button>
          </div>
          <div className="record-list">
            {workers.length ? workers.map(worker => (
              <button key={worker.workerId} className={`worker-list-item ${worker.workerId === selectedWorkerId ? 'active' : ''}`} onClick={() => loadWorker(worker)}>
                <span>
                  <strong>{worker.workerName}</strong>
                  <small>{worker.trade || 'No trade'} - {worker.faceEnrollmentStatus}</small>
                </span>
              </button>
            )) : <div className="empty-state"><strong>No workers yet</strong><span>Create the first local worker profile.</span></div>}
          </div>
        </div>

        <div className="panel-card">
          <div className="form-grid">
            <label><span>Worker name</span><input value={workerName} onChange={event => setWorkerName(event.target.value)} /></label>
            <label><span>Trade optional</span><input value={trade} onChange={event => setTrade(event.target.value)} /></label>
            <label><span>Daily rate optional</span><input type="number" value={dailyRate} onChange={event => setDailyRate(event.target.value)} /></label>
            <label><span>Worker code optional</span><input value={workerCode} onChange={event => setWorkerCode(event.target.value)} /></label>
            <label className="full-row check-row"><input type="checkbox" checked={consentRecorded} onChange={event => setConsentRecorded(event.target.checked)} /> <span>Consent recorded for face enrollment and attendance matching</span></label>
            <label className="full-row"><span>Notes optional</span><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} /></label>
            <label className="full-row"><span>Reference photos, 3 to 5</span><input type="file" accept="image/*" multiple onChange={event => handlePhotos(event.target.files)} /></label>
          </div>

          <div className="helper-card">
            Recommended: front face, slight left, slight right, normal site lighting, and optional hard hat/cap if common.
          </div>

          <div className="photo-grid">
            {photos.map(photo => (
              <div key={photo.id} className={`photo-card ${photo.status.toLowerCase()}`}>
                <img src={photo.previewUrl} alt={photo.file.name} />
                <strong>{photo.status}</strong>
                <span>{photo.message}</span>
              </div>
            ))}
          </div>

          <button className="primary-btn" disabled={busy || !modelReady} onClick={saveEnrollment}>
            {busy ? 'Processing photos...' : 'Process and Save Enrollment'}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ReferenceThumb({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = objectUrl(blob);
    setUrl(next);
    return () => {
      if (next) URL.revokeObjectURL(next);
    };
  }, [blob]);
  return url ? <img src={url} alt="Reference" /> : null;
}
