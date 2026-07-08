import { useEffect, useRef, useState } from 'react';
import { audit } from '../services/audit';
import { db } from '../services/db';
import { analyzeFace, analyzeFaceElement } from '../services/faceEngine';
import { findTopMatches } from '../services/matching';
import type { AppSettings, AttendanceRecord, AttendanceType, CameraEvent, CameraEventType, FaceBox, FaceQualityReport, MatchCandidate, ToastMessage } from '../types';
import { isAcceptedMatch, labelForDistance } from '../utils/thresholds';
import { objectUrl, resizeImageBlob } from '../utils/imageUtils';

interface SelfieScanProps {
  settings: AppSettings;
  modelReady: boolean;
  modelMessage: string;
  notify: (text: string, type?: ToastMessage['type']) => void;
  refreshData: () => void;
}

interface LiveIdentity {
  workerId: string;
  workerName: string;
  matchLabel: string;
  distance: number;
  streak: number;
  stable: boolean;
}

export function SelfieScan({ settings, modelReady, modelMessage, notify, refreshData }: SelfieScanProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const liveLoopRef = useRef<number | null>(null);
  const liveBusyRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const liveCandidateRef = useRef<{ workerId: string; streak: number }>({ workerId: '', streak: 0 });
  const eventCooldownRef = useRef<Record<string, number>>({});
  const autoDraftCooldownRef = useRef<Record<string, number>>({});
  const autoDraftEnabledRef = useRef(false);
  const settingsRef = useRef<AppSettings>(settings);
  const attendanceTypeRef = useRef<AttendanceType>('Time In');
  const [attendanceType, setAttendanceType] = useState<AttendanceType>('Time In');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveStatus, setLiveStatus] = useState('Camera is off.');
  const [liveBox, setLiveBox] = useState<FaceBox | null>(null);
  const [liveBoxSize, setLiveBoxSize] = useState({ width: 1, height: 1 });
  const [liveIdentity, setLiveIdentity] = useState<LiveIdentity | null>(null);
  const [faceQuality, setFaceQuality] = useState<FaceQualityReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [matches, setMatches] = useState<MatchCandidate[]>([]);
  const [faceDetected, setFaceDetected] = useState(false);
  const [multipleFacesDetected, setMultipleFacesDetected] = useState(false);
  const [compressedSelfie, setCompressedSelfie] = useState<Blob | undefined>();
  const [recentCameraEvents, setRecentCameraEvents] = useState<CameraEvent[]>([]);
  const [autoDraftEnabled, setAutoDraftEnabled] = useState(false);
  const [autoDraftStatus, setAutoDraftStatus] = useState('Auto draft is off.');

  useEffect(() => () => {
    stopLiveCamera();
  }, []);

  useEffect(() => {
    loadRecentCameraEvents();
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    attendanceTypeRef.current = attendanceType;
  }, [attendanceType]);

  useEffect(() => {
    autoDraftEnabledRef.current = autoDraftEnabled;
    setAutoDraftStatus(autoDraftEnabled
      ? `Auto draft on. Cooldown: ${settings.liveAutoDraftCooldownMinutes || 10} minutes.`
      : 'Auto draft is off.');
  }, [autoDraftEnabled, settings.liveAutoDraftCooldownMinutes]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleFile(nextFile?: File) {
    if (!nextFile) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setMatches([]);
    setError('');
    setWarning('');
    setFaceQuality(null);
    setCompressedSelfie(undefined);
  }

  async function scanSelfie() {
    if (!modelReady) {
      notify(modelMessage, 'error');
      return;
    }
    if (!file) {
      notify('Choose or take a selfie first.', 'error');
      return;
    }
    setBusy(true);
    setError('');
    setWarning('');
    try {
      const blob = await resizeImageBlob(file);
      const result = await analyzeFace(blob, settings.modelPath);
      setFaceDetected(result.faceDetected);
      setMultipleFacesDetected(result.multipleFacesDetected);
      setFaceQuality(result.quality || null);
      setCompressedSelfie(blob);
      await audit('selfie_scanned', 'attendance', 'draft', { attendanceType, faceDetected: result.faceDetected, faceCount: result.faceCount });
      if (!result.ok || !result.descriptor) {
        setMatches([]);
        setError(result.error || 'Could not generate face descriptor.');
        return;
      }
      if (result.warning) setWarning(result.warning);
      const topMatches = await findTopMatches(result.descriptor, settings);
      setMatches(topMatches);
      if (!topMatches.length) setWarning('No eligible enrolled workers found. Consent and complete enrollment are required.');
      notify('Scan complete. Review the match before saving a draft.', 'success');
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Scan failed.');
    } finally {
      setBusy(false);
    }
  }

  async function startLiveCamera() {
    if (!modelReady) {
      notify(modelMessage, 'error');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      notify('Live camera is not available in this browser.', 'error');
      return;
    }
    try {
      stopLiveCamera();
      setError('');
      setWarning('');
      setMatches([]);
      setLiveIdentity(null);
      setFaceQuality(null);
      liveCandidateRef.current = { workerId: '', streak: 0 };
      setLiveStatus('Opening front camera...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 960 },
          height: { ideal: 720 }
        },
        audio: false
      });
      streamRef.current = stream;
      stream.getVideoTracks().forEach(track => {
        track.onended = () => {
          if (streamRef.current !== stream) return;
          setLiveStatus('Camera disconnected. Reconnect the webcam and press Start Camera again.');
          notify('Webcam disconnected during live scanning.', 'error');
          stopLiveCamera();
        };
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setLiveEnabled(true);
      setLiveStatus('Live camera on. Scanning enrolled workers locally...');
      await audit('live_camera_started', 'attendance', 'live', { attendanceType });
      runLiveLoop();
    } catch (cameraError) {
      setLiveEnabled(false);
      setLiveStatus('Camera permission denied or unavailable.');
      notify(cameraError instanceof Error ? cameraError.message : 'Could not start camera.', 'error');
    }
  }

  function stopLiveCamera() {
    if (liveLoopRef.current) {
      window.clearTimeout(liveLoopRef.current);
      liveLoopRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    liveBusyRef.current = false;
    liveCandidateRef.current = { workerId: '', streak: 0 };
    setLiveEnabled(false);
    setLiveBox(null);
    setLiveIdentity(null);
    setFaceQuality(null);
    setLiveStatus('Camera is off.');
  }

  function runLiveLoop() {
    if (liveLoopRef.current) window.clearTimeout(liveLoopRef.current);
    liveLoopRef.current = window.setTimeout(async () => {
      await scanLiveFrame();
      if (streamRef.current) runLiveLoop();
    }, settingsRef.current.liveScanIntervalMs || 850);
  }

  async function scanLiveFrame() {
    const cfg = settingsRef.current;
    const video = videoRef.current;
    if (!video || liveBusyRef.current || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    liveBusyRef.current = true;
    try {
      const result = await analyzeFaceElement(video, cfg.modelPath);
      setFaceDetected(result.faceDetected);
      setMultipleFacesDetected(result.multipleFacesDetected);
      setLiveBox(result.primaryBox || null);
      setLiveBoxSize(result.imageSize || { width: video.videoWidth, height: video.videoHeight });
      setFaceQuality(result.quality || null);
      setWarning(result.warning || '');
      if (!result.ok || !result.descriptor) {
        setMatches([]);
        setLiveIdentity(null);
        liveCandidateRef.current = { workerId: '', streak: 0 };
        setLiveStatus(result.error || 'No face detected.');
        setCompressedSelfie(undefined);
        await recordCameraEvent('No Face', { qualitySummary: result.error || 'No face detected.' }, false);
        return;
      }
      if (result.quality && !result.quality.ok) {
        setMatches([]);
        setLiveIdentity(null);
        liveCandidateRef.current = { workerId: '', streak: 0 };
        setLiveStatus(`Quality check: ${result.quality.summary}`);
        setCompressedSelfie(undefined);
        await recordCameraEvent('Quality Hold', { qualitySummary: result.quality.summary }, true);
        return;
      }
      const topMatches = await findTopMatches(result.descriptor, cfg);
      setMatches(topMatches);
      const candidate = topMatches[0];
      const accepted = isAcceptedMatch(candidate);
      if (accepted && candidate) {
        const previous = liveCandidateRef.current;
        const streak = previous.workerId === candidate.workerId ? previous.streak + 1 : 1;
        const requiredFrames = cfg.liveStableFrameCount || 3;
        const stable = streak >= requiredFrames;
        liveCandidateRef.current = { workerId: candidate.workerId, streak };
        setLiveIdentity({
          workerId: candidate.workerId,
          workerName: candidate.workerName,
          matchLabel: candidate.matchLabel,
          distance: candidate.distance,
          streak,
          stable
        });
        setLiveStatus(stable
          ? `Locked: ${candidate.workerName} - ${candidate.matchLabel} (${candidate.distance})`
          : `Tracking ${candidate.workerName}: ${streak}/${requiredFrames} stable frames`);
        if (stable) {
          await recordCameraEvent('Locked Match', {
            workerId: candidate.workerId,
            workerName: candidate.workerName,
            matchDistance: candidate.distance,
            matchLabel: candidate.matchLabel,
            qualitySummary: result.quality?.summary
          }, true);
          if (autoDraftEnabledRef.current) {
            await createAutoAttendanceDraft(candidate, topMatches);
          }
        }
      } else {
        setLiveIdentity(null);
        liveCandidateRef.current = { workerId: '', streak: 0 };
        setLiveStatus(candidate
          ? `Unknown - nearest enrolled record distance ${candidate.distance}`
          : 'Face detected, but no enrolled worker matched.');
        await recordCameraEvent('Unknown Face', {
          matchDistance: candidate?.distance,
          matchLabel: candidate?.matchLabel,
          qualitySummary: result.quality?.summary
        }, true);
      }
      setCompressedSelfie(await captureVideoFrameBlob());
    } catch (liveError) {
      setLiveStatus(liveError instanceof Error ? liveError.message : 'Live scan failed.');
    } finally {
      liveBusyRef.current = false;
    }
  }

  function captureVideoFrameBlob(): Promise<Blob> {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      return Promise.reject(new Error('No live frame is available.'));
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return Promise.reject(new Error('Canvas is not available.'));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not capture live frame.')), 'image/jpeg', 0.86);
    });
  }

  async function loadRecentCameraEvents() {
    const events = await db.cameraEvents.orderBy('createdAt').reverse().limit(8).toArray();
    setRecentCameraEvents(events);
  }

  async function recordCameraEvent(
    eventType: CameraEventType,
    details: Partial<Omit<CameraEvent, 'eventId' | 'eventType' | 'createdAt' | 'snapshotBlob'>>,
    includeSnapshot: boolean
  ) {
    const key = `${eventType}:${details.workerId || details.matchLabel || details.qualitySummary || 'event'}`;
    const now = Date.now();
    if (eventCooldownRef.current[key] && now - eventCooldownRef.current[key] < 12000) return;
    eventCooldownRef.current[key] = now;
    let snapshotBlob: Blob | undefined;
    if (includeSnapshot) {
      try {
        snapshotBlob = await captureVideoFrameBlob();
      } catch {
        snapshotBlob = undefined;
      }
    }
    await db.cameraEvents.add({
      eventId: crypto.randomUUID(),
      eventType,
      ...details,
      snapshotBlob,
      createdAt: now
    });
    const olderEvents = await db.cameraEvents.orderBy('createdAt').reverse().offset(200).toArray();
    if (olderEvents.length) await db.cameraEvents.bulkDelete(olderEvents.map(event => event.eventId));
    await loadRecentCameraEvents();
  }

  async function createAutoAttendanceDraft(candidate: MatchCandidate, topMatches: MatchCandidate[]) {
    const cfg = settingsRef.current;
    const currentAttendanceType = attendanceTypeRef.current;
    const key = `${currentAttendanceType}:${candidate.workerId}`;
    const now = Date.now();
    const cooldownMs = Math.max(1, cfg.liveAutoDraftCooldownMinutes || 10) * 60 * 1000;
    if (autoDraftCooldownRef.current[key] && now - autoDraftCooldownRef.current[key] < cooldownMs) {
      setAutoDraftStatus(`Auto draft waiting: ${candidate.workerName} already captured recently.`);
      return;
    }
    const recentRecords = await db.attendanceRecords.where('suggestedWorkerId').equals(candidate.workerId).toArray();
    const hasRecentDuplicate = recentRecords.some(record => record.attendanceType === currentAttendanceType && record.createdAt >= now - cooldownMs);
    if (hasRecentDuplicate) {
      autoDraftCooldownRef.current[key] = now;
      setAutoDraftStatus(`Auto draft skipped: ${candidate.workerName} has a recent ${currentAttendanceType} draft.`);
      return;
    }
    const selfieBlob = await captureVideoFrameBlob();
    const record: AttendanceRecord = {
      attendanceId: crypto.randomUUID(),
      attendanceType: currentAttendanceType,
      selfieBlob,
      faceDetected: true,
      multipleFacesDetected,
      suggestedWorkerId: candidate.workerId,
      suggestedWorkerName: candidate.workerName,
      matchDistance: candidate.distance,
      matchLabel: candidate.matchLabel,
      topMatches,
      reviewStatus: 'For Review',
      notes: 'Auto-drafted from stable live camera lock. Manual review required.',
      createdAt: now
    };
    await db.attendanceRecords.add(record);
    await audit('live_auto_attendance_draft_created', 'attendance', record.attendanceId, {
      attendanceType: currentAttendanceType,
      workerId: candidate.workerId,
      matchDistance: candidate.distance,
      cooldownMinutes: cfg.liveAutoDraftCooldownMinutes
    });
    autoDraftCooldownRef.current[key] = now;
    setCompressedSelfie(selfieBlob);
    refreshData();
    setAutoDraftStatus(`Auto draft saved for ${candidate.workerName} (${currentAttendanceType}).`);
  }

  async function saveDraft(reviewStatus: AttendanceRecord['reviewStatus'] = 'For Review') {
    if (!compressedSelfie) {
      notify('Scan a selfie before saving an attendance draft.', 'error');
      return;
    }
    const best = matches[0];
    const accepted = isAcceptedMatch(best) && (!liveEnabled || (!!liveIdentity?.stable && liveIdentity.workerId === best?.workerId));
    if (reviewStatus === 'Approved' && !accepted) {
      notify('Cannot confirm this match because it is outside the threshold. Mark it Unknown or save it For Review.', 'warning');
      return;
    }
    const record: AttendanceRecord = {
      attendanceId: crypto.randomUUID(),
      attendanceType,
      selfieBlob: compressedSelfie,
      faceDetected,
      multipleFacesDetected,
      suggestedWorkerId: accepted && best ? best.workerId : undefined,
      suggestedWorkerName: accepted && best ? best.workerName : 'Unknown',
      matchDistance: best?.distance,
      matchLabel: best ? labelForDistance(best.distance, settings) : 'Unknown',
      topMatches: matches,
      reviewStatus,
      finalWorkerId: reviewStatus === 'Unknown' || !accepted || !best ? undefined : best.workerId,
      finalWorkerName: reviewStatus === 'Unknown' || !accepted || !best ? undefined : best.workerName,
      createdAt: Date.now(),
      reviewedAt: reviewStatus === 'For Review' ? undefined : Date.now()
    };
    await db.attendanceRecords.add(record);
    await audit('attendance_draft_created', 'attendance', record.attendanceId, {
      attendanceType,
      suggestedWorkerId: record.suggestedWorkerId,
      matchLabel: record.matchLabel,
      matchDistance: record.matchDistance
    });
    if (reviewStatus === 'Approved') await audit('match_confirmed', 'attendance', record.attendanceId, { workerId: record.finalWorkerId });
    if (reviewStatus === 'Rejected') await audit('match_rejected', 'attendance', record.attendanceId, { workerId: record.suggestedWorkerId });
    refreshData();
    notify(reviewStatus === 'For Review' ? 'Attendance draft saved for manual review.' : `Attendance saved as ${reviewStatus}.`, 'success');
  }

  const best = matches[0];
  const thresholdAcceptedBest = isAcceptedMatch(best);
  const stableLiveBest = !liveEnabled || (!!liveIdentity?.stable && liveIdentity.workerId === best?.workerId);
  const acceptedBest = thresholdAcceptedBest && stableLiveBest;
  const displayName = acceptedBest && best ? best.workerName : 'Unknown';
  const displayLabel = acceptedBest && best ? best.matchLabel : 'Unknown';
  const requiredLiveFrames = settings.liveStableFrameCount || 3;
  const qualityReady = faceQuality?.ok ?? false;

  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="eyebrow">Selfie Scan</span>
        <h1>Scan Selfie / Test Photo</h1>
        <p>Local descriptor matching against enrolled workers only. Distance labels are used, never fake certainty percentages.</p>
      </section>

      {!modelReady && <div className="warning-card"><strong>Model setup required</strong><span>{modelMessage}</span></div>}

      <section className="scan-layout">
        <div className="panel-card">
          <div className="form-grid single">
            <label><span>Attendance type</span><select value={attendanceType} onChange={event => setAttendanceType(event.target.value as AttendanceType)}>
              {['Time In', 'Time Out', 'Half-day', 'OT Note', 'Test Scan'].map(type => <option key={type}>{type}</option>)}
            </select></label>
          </div>

          <div className="live-camera-card">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Live Camera Mode</span>
                <h2>Face Tracker</h2>
              </div>
              <b className={liveEnabled ? 'live-on' : 'live-off'}>{liveEnabled ? 'Live' : 'Off'}</b>
            </div>
            <div className="live-video-wrap">
              <video ref={videoRef} muted playsInline />
              {liveBox && (
                <div
                  className={`face-track-box ${qualityReady ? 'quality-ready' : 'quality-hold'}`}
                  style={{
                    left: `${(liveBox.x / liveBoxSize.width) * 100}%`,
                    top: `${(liveBox.y / liveBoxSize.height) * 100}%`,
                    width: `${(liveBox.width / liveBoxSize.width) * 100}%`,
                    height: `${(liveBox.height / liveBoxSize.height) * 100}%`
                  }}
                >
                  <span>
                    {acceptedBest && best
                      ? `${best.workerName} - ${best.matchLabel}`
                      : liveIdentity
                        ? `Tracking ${liveIdentity.streak}/${requiredLiveFrames}`
                        : 'Unknown'}
                  </span>
                </div>
              )}
              {!liveEnabled && <div className="live-placeholder">Camera preview appears here</div>}
            </div>
            <div className="live-status-line">{liveStatus}</div>
            {faceQuality && <QualityPanel quality={faceQuality} />}
            <div className={`auto-draft-panel ${autoDraftEnabled ? 'auto-draft-on' : ''}`}>
              <label className="check-row">
                <input type="checkbox" checked={autoDraftEnabled} onChange={event => setAutoDraftEnabled(event.target.checked)} />
                <span>Auto Draft on stable live lock</span>
              </label>
              <small>{autoDraftStatus}</small>
            </div>
            <div className="action-row">
              <button className="primary-btn" disabled={!modelReady || liveEnabled} onClick={startLiveCamera}>Start Camera</button>
              <button className="ghost-btn" disabled={!liveEnabled} onClick={stopLiveCamera}>Stop Camera</button>
              <button className="ghost-btn" disabled={!liveEnabled || busy} onClick={scanLiveFrame}>Capture & Scan Now</button>
            </div>
          </div>

          <div className="camera-events-card">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Camera Events</span>
                <h2>Recent Local Detections</h2>
              </div>
              <button className="ghost-btn compact-button" onClick={loadRecentCameraEvents}>Refresh</button>
            </div>
            {recentCameraEvents.length ? (
              <div className="camera-event-list">
                {recentCameraEvents.map(event => <CameraEventRow key={event.eventId} event={event} />)}
              </div>
            ) : (
              <div className="empty-state compact-empty"><strong>No camera events yet</strong><span>Start live camera to record local detection events.</span></div>
            )}
          </div>

          <div className="form-grid single">
            <label><span>Take selfie</span><input type="file" accept="image/*" capture="user" onChange={event => handleFile(event.target.files?.[0])} /></label>
            <label><span>Or upload photo</span><input type="file" accept="image/*" onChange={event => handleFile(event.target.files?.[0])} /></label>
          </div>
          {previewUrl ? <img className="large-preview" src={previewUrl} alt="Selfie preview" /> : <div className="empty-state"><strong>No selfie selected</strong><span>Use camera capture or upload a test photo.</span></div>}
          <button className="primary-btn" disabled={busy || !modelReady || !file} onClick={scanSelfie}>{busy ? 'Scanning...' : 'Scan Selfie'}</button>
        </div>

        <div className="panel-card">
          <div className="panel-head">
            <div><span className="eyebrow">Result</span><h2>Match Suggestion</h2></div>
          </div>
          {error && <div className="error-card">{error}</div>}
          {warning && <div className="warning-card compact"><strong>Review warning</strong><span>{warning}</span></div>}
          {best ? (
            <div className="match-result">
              <div className="match-hero">
                <div>
                  <span>{acceptedBest ? 'Best match' : 'Unknown match'}</span>
                  <strong>{displayName}</strong>
                </div>
                <b>{displayLabel}</b>
              </div>
              {!acceptedBest && (
                <div className="warning-card compact">
                  <strong>{thresholdAcceptedBest ? 'Stabilizing live match' : 'Needs manual review'}</strong>
                  <span>
                    {thresholdAcceptedBest
                      ? `Nearest enrolled worker is ${best.workerName}, but live camera needs ${requiredLiveFrames} consistent frames before confirming identity.`
                      : `Nearest enrolled record is outside the match threshold. Distance: ${best.distance}.`}
                  </span>
                </div>
              )}
              <div className="settings-summary">
                <div><span>Distance</span><strong>{best.distance}</strong></div>
                <div><span>Face detected</span><strong>{faceDetected ? 'Yes' : 'No'}</strong></div>
                <div><span>Multiple faces</span><strong>{multipleFacesDetected ? 'Yes' : 'No'}</strong></div>
                <div><span>Live lock</span><strong>{liveEnabled ? (acceptedBest ? 'Stable' : `${liveIdentity?.streak || 0}/${requiredLiveFrames}`) : 'Not required'}</strong></div>
                <div><span>Frame quality</span><strong>{faceQuality ? (faceQuality.ok ? 'Ready' : 'Hold') : 'Waiting'}</strong></div>
              </div>
              {faceQuality && <QualityPanel quality={faceQuality} />}
              <div className="top-matches">
                {matches.map((match, index) => <MatchRow key={match.workerId} match={match} rank={index + 1} accepted={isAcceptedMatch(match)} />)}
              </div>
              <div className="action-row">
                <button className="primary-btn" disabled={!acceptedBest} onClick={() => saveDraft('Approved')}>Confirm Match</button>
                <button className="ghost-btn" onClick={() => saveDraft('Rejected')}>Reject Match</button>
                <button className="ghost-btn" onClick={() => saveDraft('Unknown')}>Mark as Unknown</button>
                <button className="ghost-btn" onClick={() => saveDraft('For Review')}>Save Attendance Draft</button>
              </div>
            </div>
          ) : (
            <div className="empty-state"><strong>No match result yet</strong><span>Run a scan to see top 3 enrolled worker matches.</span></div>
          )}
        </div>
      </section>
    </div>
  );
}

function QualityPanel({ quality }: { quality: FaceQualityReport }) {
  const faceSizePercent = Math.round(quality.faceCoverage * 100);
  const centeredPercent = Math.round(quality.centeredness * 100);
  return (
    <div className={`quality-panel ${quality.ok ? 'quality-ok' : 'quality-warn'}`}>
      <div className="quality-head">
        <strong>{quality.ok ? 'Frame ready' : 'Improve frame'}</strong>
        <span>{quality.summary}</span>
      </div>
      <div className="quality-metrics">
        <div><span>Light</span><b>{quality.brightness}</b></div>
        <div><span>Sharp</span><b>{quality.sharpness}</b></div>
        <div><span>Size</span><b>{faceSizePercent}%</b></div>
        <div><span>Center</span><b>{centeredPercent}%</b></div>
      </div>
      {!!quality.issues.length && (
        <div className="quality-issues">
          {quality.issues.map(issue => <span key={issue}>{issue}</span>)}
        </div>
      )}
    </div>
  );
}

function CameraEventRow({ event }: { event: CameraEvent }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = objectUrl(event.snapshotBlob);
    setUrl(next);
    return () => {
      if (next) URL.revokeObjectURL(next);
    };
  }, [event.snapshotBlob]);
  const time = new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const title = event.workerName || event.eventType;
  const detail = event.workerName
    ? `${event.matchLabel || 'Match'} - distance ${event.matchDistance ?? 'n/a'}`
    : event.matchDistance
      ? `Nearest distance ${event.matchDistance}`
      : event.qualitySummary || 'Local camera event';
  return (
    <article className={`camera-event-row event-${event.eventType.toLowerCase().replace(/\s+/g, '-')}`}>
      {url ? <img src={url} alt={event.eventType} /> : <div className="tiny-image">Event</div>}
      <div>
        <div className="camera-event-title">
          <strong>{title}</strong>
          <span>{time}</span>
        </div>
        <p>{detail}</p>
        {event.qualitySummary && <small>{event.qualitySummary}</small>}
      </div>
    </article>
  );
}

function MatchRow({ match, rank, accepted }: { match: MatchCandidate; rank: number; accepted: boolean }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = objectUrl(match.referencePhotoBlob);
    setUrl(next);
    return () => {
      if (next) URL.revokeObjectURL(next);
    };
  }, [match.referencePhotoBlob]);
  return (
    <article className="match-row">
      {url ? <img src={url} alt={match.workerName} /> : <div className="tiny-image">Face</div>}
      <div>
        <strong>{accepted ? `${rank}. ${match.workerName}` : `${rank}. Unconfirmed enrolled record`}</strong>
        <span>{accepted ? match.matchLabel : 'Not accepted'} - distance {match.distance}</span>
      </div>
    </article>
  );
}
