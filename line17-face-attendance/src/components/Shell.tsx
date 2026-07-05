import type { ReactNode } from 'react';
import type { ModelStatus, ToastMessage } from '../types';

interface ShellProps {
  activePage: string;
  modelStatus: ModelStatus;
  modelMessage: string;
  toasts: ToastMessage[];
  onNavigate: (page: string) => void;
  children: ReactNode;
}

const navItems = [
  ['dashboard', 'Dashboard'],
  ['enroll', 'Enroll Worker'],
  ['scan', 'Selfie Scan'],
  ['monitor', 'Camera Monitor'],
  ['attendance', 'Attendance Records'],
  ['workers', 'Workers'],
  ['settings', 'Settings']
];

export function Shell({ activePage, modelStatus, modelMessage, toasts, onNavigate, children }: ShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">17</div>
          <div>
            <div className="brand-name">Line17 Face Attendance</div>
            <div className="brand-sub">Local-first worker attendance</div>
          </div>
        </div>
        <nav className="nav-list" aria-label="Main navigation">
          {navItems.map(([key, label]) => (
            <button key={key} className={activePage === key ? 'active' : ''} onClick={() => onNavigate(key)}>
              {label}
            </button>
          ))}
        </nav>
        <div className={`model-pill model-${modelStatus}`}>
          <span>Model</span>
          <strong>{modelStatus === 'ready' ? 'Ready' : modelStatus === 'loading' ? 'Loading' : modelStatus === 'error' ? 'Missing' : 'Idle'}</strong>
        </div>
      </aside>
      <main className="main-content">
        <div className="top-strip">
          <div>
            <strong>AI-assisted only</strong>
            <span>Manual review is required before attendance is accepted.</span>
          </div>
          <div className={`model-status status-${modelStatus}`}>{modelMessage || 'Model status unavailable.'}</div>
        </div>
        {children}
      </main>
      <div className="toast-stack" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>{toast.text}</div>
        ))}
      </div>
    </div>
  );
}
