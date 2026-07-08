import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  AttendanceRecord,
  AuditLog,
  CameraEvent,
  FaceDescriptorRecord,
  ReferencePhoto,
  Worker
} from '../types';
import { DEFAULT_SETTINGS } from '../utils/thresholds';
import { blobToDataUrl, dataUrlToBlob } from '../utils/imageUtils';

class FaceAttendanceDb extends Dexie {
  workers!: Table<Worker, string>;
  faceDescriptors!: Table<FaceDescriptorRecord, string>;
  referencePhotos!: Table<ReferencePhoto, string>;
  attendanceRecords!: Table<AttendanceRecord, string>;
  settings!: Table<AppSettings, string>;
  auditLogs!: Table<AuditLog, string>;
  cameraEvents!: Table<CameraEvent, string>;

  constructor() {
    super('line17_face_attendance');
    this.version(1).stores({
      workers: 'workerId, workerName, workerCode, faceEnrollmentStatus, consentRecorded, updatedAt',
      faceDescriptors: 'descriptorId, workerId, createdAt',
      referencePhotos: 'photoId, workerId, descriptorId, createdAt',
      attendanceRecords: 'attendanceId, attendanceType, suggestedWorkerId, reviewStatus, createdAt',
      settings: 'id',
      auditLogs: 'logId, action, targetType, targetId, createdAt'
    });
    this.version(2).stores({
      cameraEvents: 'eventId, eventType, workerId, createdAt'
    });
  }
}

export const db = new FaceAttendanceDb();

export async function getSettings(): Promise<AppSettings> {
  const settings = await db.settings.get('default');
  if (settings) return { ...DEFAULT_SETTINGS, ...settings, id: 'default' };
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put({ ...settings, id: 'default', updatedAt: Date.now() });
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.workers, db.faceDescriptors, db.referencePhotos, db.attendanceRecords, db.settings, db.auditLogs, db.cameraEvents], async () => {
    await Promise.all([
      db.workers.clear(),
      db.faceDescriptors.clear(),
      db.referencePhotos.clear(),
      db.attendanceRecords.clear(),
      db.settings.clear(),
      db.auditLogs.clear(),
      db.cameraEvents.clear()
    ]);
    await db.settings.put(DEFAULT_SETTINGS);
  });
}

export async function exportBackup(): Promise<Record<string, unknown>> {
  const [workers, faceDescriptors, referencePhotosRaw, attendanceRecordsRaw, settings, auditLogs, cameraEventsRaw] = await Promise.all([
    db.workers.toArray(),
    db.faceDescriptors.toArray(),
    db.referencePhotos.toArray(),
    db.attendanceRecords.toArray(),
    db.settings.toArray(),
    db.auditLogs.toArray(),
    db.cameraEvents.toArray()
  ]);
  const referencePhotos = await Promise.all(referencePhotosRaw.map(async photo => ({
    ...photo,
    blob: photo.blob ? await blobToDataUrl(photo.blob) : ''
  })));
  const attendanceRecords = await Promise.all(attendanceRecordsRaw.map(async record => ({
    ...record,
    selfieBlob: record.selfieBlob ? await blobToDataUrl(record.selfieBlob) : ''
  })));
  const cameraEvents = await Promise.all(cameraEventsRaw.map(async event => ({
    ...event,
    snapshotBlob: event.snapshotBlob ? await blobToDataUrl(event.snapshotBlob) : ''
  })));
  return {
    app: 'Line17 Face Attendance',
    version: 2,
    exportedAt: Date.now(),
    workers,
    faceDescriptors,
    referencePhotos,
    attendanceRecords,
    settings,
    auditLogs,
    cameraEvents
  };
}

export async function importBackup(payload: any): Promise<void> {
  if (!payload || typeof payload !== 'object' || payload.app !== 'Line17 Face Attendance') {
    throw new Error('This is not a Line17 Face Attendance backup.');
  }
  const arrayFields: Array<keyof typeof payload> = ['workers', 'faceDescriptors', 'referencePhotos', 'attendanceRecords', 'cameraEvents', 'auditLogs'];
  for (const field of arrayFields) {
    if (payload[field] !== undefined && !Array.isArray(payload[field])) {
      throw new Error(`Backup file is malformed: "${String(field)}" should be a list.`);
    }
  }
  const referencePhotos: ReferencePhoto[] = await Promise.all((payload.referencePhotos || []).map(async (photo: any) => ({
    ...photo,
    blob: photo.blob ? await dataUrlToBlob(photo.blob) : undefined
  })));
  const attendanceRecords: AttendanceRecord[] = await Promise.all((payload.attendanceRecords || []).map(async (record: any) => ({
    ...record,
    selfieBlob: record.selfieBlob ? await dataUrlToBlob(record.selfieBlob) : undefined
  })));
  const cameraEvents: CameraEvent[] = await Promise.all((payload.cameraEvents || []).map(async (event: any) => ({
    ...event,
    snapshotBlob: event.snapshotBlob ? await dataUrlToBlob(event.snapshotBlob) : undefined
  })));
  await db.transaction('rw', [db.workers, db.faceDescriptors, db.referencePhotos, db.attendanceRecords, db.settings, db.auditLogs, db.cameraEvents], async () => {
    await Promise.all([
      db.workers.clear(),
      db.faceDescriptors.clear(),
      db.referencePhotos.clear(),
      db.attendanceRecords.clear(),
      db.settings.clear(),
      db.auditLogs.clear(),
      db.cameraEvents.clear()
    ]);
    await db.workers.bulkPut(payload.workers || []);
    await db.faceDescriptors.bulkPut(payload.faceDescriptors || []);
    await db.referencePhotos.bulkPut(referencePhotos);
    await db.attendanceRecords.bulkPut(attendanceRecords);
    await db.settings.bulkPut(payload.settings?.length ? payload.settings : [DEFAULT_SETTINGS]);
    await db.auditLogs.bulkPut(payload.auditLogs || []);
    await db.cameraEvents.bulkPut(cameraEvents);
  });
}
