export type EnrollmentStatus = 'Not Enrolled' | 'Partial' | 'Complete' | 'Failed' | 'Revoked';
export type AttendanceType = 'Time In' | 'Time Out' | 'Half-day' | 'OT Note' | 'Test Scan';
export type ReviewStatus = 'For Review' | 'Approved' | 'Rejected' | 'Needs Correction' | 'Unknown';
export type MatchLabel = 'Strong Match' | 'Possible Match' | 'Unknown';
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';
export type CameraEventType = 'Locked Match' | 'Unknown Face' | 'Quality Hold' | 'No Face';

export interface Worker {
  workerId: string;
  workerName: string;
  trade?: string;
  dailyRate?: number;
  workerCode?: string;
  consentRecorded: boolean;
  consentRecordedAt?: number;
  faceEnrollmentStatus: EnrollmentStatus;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FaceDescriptorRecord {
  descriptorId: string;
  workerId: string;
  vector: number[];
  model: string;
  sourcePhotoName: string;
  createdAt: number;
}

export interface ReferencePhoto {
  photoId: string;
  workerId: string;
  fileName: string;
  blob: Blob;
  descriptorId?: string;
  faceDetected: boolean;
  multipleFacesDetected: boolean;
  rejectionReason?: string;
  createdAt: number;
}

export interface MatchCandidate {
  workerId: string;
  workerName: string;
  distance: number;
  matchLabel: MatchLabel;
  referencePhotoId?: string;
  referencePhotoBlob?: Blob;
}

export interface AttendanceRecord {
  attendanceId: string;
  attendanceType: AttendanceType;
  selfieBlob?: Blob;
  faceDetected: boolean;
  multipleFacesDetected: boolean;
  suggestedWorkerId?: string;
  suggestedWorkerName?: string;
  matchDistance?: number;
  matchLabel: MatchLabel;
  topMatches: MatchCandidate[];
  reviewStatus: ReviewStatus;
  finalWorkerId?: string;
  finalWorkerName?: string;
  notes?: string;
  createdAt: number;
  reviewedAt?: number;
}

export interface AppSettings {
  id: 'default';
  strongMatchThreshold: number;
  possibleMatchThreshold: number;
  liveStableFrameCount: number;
  liveScanIntervalMs: number;
  liveAutoDraftCooldownMinutes: number;
  modelPath: string;
  updatedAt: number;
}

export interface AuditLog {
  logId: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
  createdAt: number;
}

export interface CameraEvent {
  eventId: string;
  eventType: CameraEventType;
  workerId?: string;
  workerName?: string;
  matchDistance?: number;
  matchLabel?: MatchLabel;
  qualitySummary?: string;
  snapshotBlob?: Blob;
  createdAt: number;
}

export interface FaceAnalysisResult {
  ok: boolean;
  faceDetected: boolean;
  multipleFacesDetected: boolean;
  descriptor?: number[];
  primaryBox?: FaceBox;
  quality?: FaceQualityReport;
  imageSize?: {
    width: number;
    height: number;
  };
  error?: string;
  warning?: string;
  faceCount: number;
}

export interface FaceQualityReport {
  ok: boolean;
  summary: string;
  issues: string[];
  brightness: number;
  sharpness: number;
  faceCoverage: number;
  centeredness: number;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  text: string;
}
