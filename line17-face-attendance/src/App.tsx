import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shell } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { EnrollWorker } from './pages/EnrollWorker';
import { SelfieScan } from './pages/SelfieScan';
import { CameraMonitor } from './pages/CameraMonitor';
import { AttendanceRecords } from './pages/AttendanceRecords';
import { Workers } from './pages/Workers';
import { Settings } from './pages/Settings';
import { getSettings } from './services/db';
import { loadModels } from './services/faceEngine';
import type { AppSettings, ModelStatus, ToastMessage } from './types';
import { DEFAULT_SETTINGS } from './utils/thresholds';

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [modelMessage, setModelMessage] = useState('Models have not been loaded yet.');
  const [dataVersion, setDataVersion] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const toast = { id: crypto.randomUUID(), text, type };
    setToasts(current => [...current, toast]);
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== toast.id)), 3600);
  }, []);

  const refreshData = useCallback(() => setDataVersion(value => value + 1), []);

  const refreshSettings = useCallback(async () => {
    const next = await getSettings();
    setSettings(next);
    return next;
  }, []);

  const loadFaceModels = useCallback(async (path?: string) => {
    const targetPath = path || settings.modelPath;
    try {
      await loadModels(targetPath, (status, message) => {
        setModelStatus(status);
        setModelMessage(message);
      });
    } catch (error) {
      setModelStatus('error');
      setModelMessage(error instanceof Error ? error.message : String(error));
    }
  }, [settings.modelPath]);

  useEffect(() => {
    refreshSettings().then(next => loadFaceModels(next.modelPath));
  }, [loadFaceModels, refreshSettings]);

  const pageProps = useMemo(() => ({
    settings,
    modelReady: modelStatus === 'ready',
    modelStatus,
    modelMessage,
    notify,
    refreshData,
    refreshSettings,
    loadFaceModels,
    dataVersion
  }), [settings, modelStatus, modelMessage, notify, refreshData, refreshSettings, loadFaceModels, dataVersion]);

  return (
    <Shell activePage={page} modelStatus={modelStatus} modelMessage={modelMessage} toasts={toasts} onNavigate={setPage}>
      {page === 'dashboard' && <Dashboard {...pageProps} onNavigate={setPage} />}
      {page === 'enroll' && <EnrollWorker {...pageProps} />}
      {page === 'scan' && <SelfieScan {...pageProps} />}
      {page === 'monitor' && <CameraMonitor {...pageProps} />}
      {page === 'attendance' && <AttendanceRecords {...pageProps} />}
      {page === 'workers' && <Workers {...pageProps} />}
      {page === 'settings' && <Settings {...pageProps} />}
    </Shell>
  );
}
