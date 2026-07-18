import { vi, beforeEach } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = String(val); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', { value: true, writable: true });

// Set up PMOS globals
beforeEach(() => {
  (window as any)._currentUser = {
    uid: 'test-uid',
    name: 'Test User',
    role: 'apm',
    projects: { 'project-1': true, 'project-2': true },
  };
  (window as any).PMOS_CONFIG = {
    faceAttendanceEnabled: false,
    photoProvider: 'firebase-storage',
    maxPhotoSize: 20 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  };
  (window as any).APP_VERSION = '1.0.0';
  (window as any).PMOS_VERSION = '1.0.0';
  (window as any).CACHE_VERSION = 'acpm-pmos-v1';
  (window as any).PMOS_SCHEMA_VERSION = '1.0';
  (window as any).PMOS_STATUS_WORKFLOW = ['Draft', 'New', 'Reviewed', 'In Progress', 'Waiting', 'Done', 'Archived'];
  (window as any).PMOS_MATERIAL_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Partially Approved', 'Rejected', 'For Procurement', 'Ordered', 'Partially Delivered', 'Delivered', 'Cancelled', 'Archived'];
  (window as any).PMOS_ISSUE_STATUSES = ['Open', 'Assigned', 'In Progress', 'For Verification', 'Closed', 'Reopened', 'Archived'];
  (window as any).PMOS_TASK_STATUSES = ['Open', 'In Progress', 'Waiting', 'Done', 'Cancelled', 'Archived'];
  (window as any).PMOS_MEETING_STATUSES = ['Draft', 'Submitted', 'Reviewed', 'Action Required', 'Closed', 'Archived'];
});

// Export escapeHtml helper used across tests
export function escapeHtml(text: any): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
