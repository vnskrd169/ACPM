import { useEffect, useState } from 'react';
import { audit } from '../services/audit';
import { clearAllData, exportBackup, importBackup, saveSettings } from '../services/db';
import type { AppSettings, ModelStatus, ToastMessage } from '../types';
import { downloadJson } from '../utils/imageUtils';

interface SettingsProps {
  settings: AppSettings;
  modelStatus: ModelStatus;
  modelMessage: string;
  notify: (text: string, type?: ToastMessage['type']) => void;
  refreshData: () => void;
  refreshSettings: () => Promise<AppSettings>;
  loadFaceModels: (path?: string) => Promise<void>;
}

export function Settings({ settings, modelStatus, modelMessage, notify, refreshData, refreshSettings, loadFaceModels }: SettingsProps) {
  const [strong, setStrong] = useState(settings.strongMatchThreshold);
  const [possible, setPossible] = useState(settings.possibleMatchThreshold);
  const [stableFrames, setStableFrames] = useState(settings.liveStableFrameCount);
  const [scanInterval, setScanInterval] = useState(settings.liveScanIntervalMs);
  const [autoDraftCooldown, setAutoDraftCooldown] = useState(settings.liveAutoDraftCooldownMinutes);
  const [modelPath, setModelPath] = useState(settings.modelPath);

  useEffect(() => {
    setStrong(settings.strongMatchThreshold);
    setPossible(settings.possibleMatchThreshold);
    setStableFrames(settings.liveStableFrameCount);
    setScanInterval(settings.liveScanIntervalMs);
    setAutoDraftCooldown(settings.liveAutoDraftCooldownMinutes);
    setModelPath(settings.modelPath);
  }, [settings]);

  async function persistSettings() {
    if (strong <= 0 || possible <= 0 || strong >= possible) {
      notify('Strong threshold must be lower than possible threshold.', 'error');
      return;
    }
    await saveSettings({
      id: 'default',
      strongMatchThreshold: Number(strong),
      possibleMatchThreshold: Number(possible),
      liveStableFrameCount: Math.max(1, Math.round(Number(stableFrames) || 3)),
      liveScanIntervalMs: Math.max(350, Math.round(Number(scanInterval) || 850)),
      liveAutoDraftCooldownMinutes: Math.max(1, Math.round(Number(autoDraftCooldown) || 10)),
      modelPath: modelPath.trim() || '/models',
      updatedAt: Date.now()
    });
    await audit('settings_updated', 'settings', 'default', { strong, possible, stableFrames, scanInterval, autoDraftCooldown, modelPath });
    await refreshSettings();
    notify('Settings saved.', 'success');
  }

  async function exportJson() {
    const payload = await exportBackup();
    downloadJson(`line17-face-attendance-backup-${new Date().toISOString().slice(0, 10)}.json`, payload);
    await audit('backup_exported', 'settings', 'default', {});
  }

  async function importJson(file?: File) {
    if (!file) return;
    const text = await file.text();
    await importBackup(JSON.parse(text));
    await audit('backup_imported', 'settings', 'default', { fileName: file.name });
    await refreshSettings();
    refreshData();
    notify('Backup imported.', 'success');
  }

  async function clearData() {
    const phrase = window.prompt('Type DELETE LOCAL DATA to clear all workers, descriptors, attendance, camera events, settings, and audit logs.');
    if (phrase !== 'DELETE LOCAL DATA') return;
    await clearAllData();
    await refreshSettings();
    refreshData();
    notify('All local data cleared.', 'warning');
  }

  return (
    <div className="page-stack">
      <section className="page-title">
        <span className="eyebrow">Settings</span>
        <h1>Local Model and Data Settings</h1>
        <p>This system is an AI-assisted attendance tool. Manual review is required.</p>
      </section>

      <section className="panel-card">
        <div className="form-grid">
          <label><span>Strong match threshold</span><input type="number" step="0.01" value={strong} onChange={event => setStrong(Number(event.target.value))} /></label>
          <label><span>Possible match threshold</span><input type="number" step="0.01" value={possible} onChange={event => setPossible(Number(event.target.value))} /></label>
          <label><span>Live stable frames</span><input type="number" min="1" max="10" value={stableFrames} onChange={event => setStableFrames(Number(event.target.value))} /></label>
          <label><span>Live scan interval ms</span><input type="number" min="350" step="50" value={scanInterval} onChange={event => setScanInterval(Number(event.target.value))} /></label>
          <label><span>Auto draft cooldown minutes</span><input type="number" min="1" max="240" value={autoDraftCooldown} onChange={event => setAutoDraftCooldown(Number(event.target.value))} /></label>
          <label className="full-row"><span>Model path</span><input value={modelPath} onChange={event => setModelPath(event.target.value)} /></label>
        </div>
        <div className={`model-setup status-${modelStatus}`}>
          <strong>Model status: {modelStatus}</strong>
          <span>{modelMessage}</span>
          <small>Place model manifests and shards in <code>public/models</code>. Default runtime path is <code>/models</code>.</small>
        </div>
        <div className="action-row">
          <button className="primary-btn" onClick={persistSettings}>Save Settings</button>
          <button className="ghost-btn" onClick={() => loadFaceModels(modelPath)}>Reload Models</button>
        </div>
      </section>

      <section className="split-grid">
        <div className="panel-card">
          <div className="panel-head">
            <div><span className="eyebrow">Backup</span><h2>Export / Import JSON</h2></div>
          </div>
          <p className="muted-text">Backups include workers, descriptors, local preview images, attendance records, camera events, settings, and audit logs.</p>
          <div className="action-row">
            <button className="primary-btn" onClick={exportJson}>Export JSON Backup</button>
            <label className="file-button">Import JSON Backup<input type="file" accept="application/json" onChange={event => importJson(event.target.files?.[0])} /></label>
          </div>
        </div>
        <div className="panel-card danger-zone">
          <div className="panel-head">
            <div><span className="eyebrow">Danger Zone</span><h2>Clear Local Data</h2></div>
          </div>
          <p className="muted-text">This deletes local IndexedDB data in this browser only. There is no backend recovery.</p>
          <button className="danger-btn" onClick={clearData}>Clear All Local Data</button>
        </div>
      </section>
    </div>
  );
}
