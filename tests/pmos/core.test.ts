import { describe, it, expect, beforeAll, vi } from 'vitest';
import { escapeHtml } from './setup';

// Load acpm-shell.js to test exported helpers
beforeAll(async () => {
  // Load acpm-shell.js into the jsdom environment
  await import('../../acpm-shell.js');
});

describe('PMOS Core Helpers', () => {
  describe('escapeHtml', () => {
    it('escapes HTML special characters', () => {
      const result = escapeHtml('<script>alert("xss")</script>');
      expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('returns empty string for null/undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('leaves normal text unchanged', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('pmosNormalizeRecord', () => {
    it('creates a normalized record with defaults', () => {
      const record = (window as any).pmosNormalizeRecord(
        { note: 'Test', category: 'General' },
        'pmosUpdates',
        'project-1',
        'Test Project'
      );
      expect(record).toBeDefined();
      expect(record.id).toBeTruthy();
      expect(record.clientGeneratedId).toBeTruthy();
      expect(record.projectId).toBe('project-1');
      expect(record.projectName).toBe('Test Project');
      expect(record.collection).toBe('pmosUpdates');
      expect(record.schemaVersion).toBe('1.0');
      expect(record.note).toBe('Test');
      expect(record.status).toBe('New');
    });

    it('preserves existing ID when provided', () => {
      const record = (window as any).pmosNormalizeRecord(
        { id: 'custom-id', note: 'Test' },
        'pmosUpdates',
        'p1',
        'P1'
      );
      expect(record.id).toBe('custom-id');
    });

    it('defaults archived to false', () => {
      const record = (window as any).pmosNormalizeRecord({}, 'pmosUpdates', 'p1', 'P1');
      expect(record.archived).toBe(false);
    });

    it('preserves archive fields when provided', () => {
      const record = (window as any).pmosNormalizeRecord(
        { archived: true, archivedAt: 1000, archivedBy: 'test', archiveReason: 'Test' },
        'pmosUpdates',
        'p1',
        'P1'
      );
      expect(record.archived).toBe(true);
      expect(record.archivedAt).toBe(1000);
      expect(record.archiveReason).toBe('Test');
    });

    it('preserves draft flag', () => {
      const record = (window as any).pmosNormalizeRecord(
        { draft: true },
        'pmosUpdates',
        'p1',
        'P1'
      );
      expect(record.draft).toBe(true);
    });
  });

  describe('pmosUuid', () => {
    it('generates unique UUIDs', () => {
      const uuid1 = (window as any).pmosUuid();
      const uuid2 = (window as any).pmosUuid();
      expect(uuid1).not.toBe(uuid2);
    });

    it('starts with pmos_', () => {
      const uuid = (window as any).pmosUuid();
      expect(uuid.startsWith('pmos_')).toBe(true);
    });

    it('generates different values on consecutive calls', () => {
      const ids = new Set(Array.from({ length: 10 }, () => (window as any).pmosUuid()));
      expect(ids.size).toBe(10);
    });
  });

  describe('pmosDedupKey', () => {
    it('returns ID when present', () => {
      const key = (window as any).pmosDedupKey({ id: 'abc', collection: 'pmosUpdates', projectId: 'p1' });
      expect(key).toBe('abc');
    });

    it('falls back to clientGeneratedId', () => {
      const key = (window as any).pmosDedupKey({ clientGeneratedId: 'xyz', collection: 'pmosUpdates', projectId: 'p1' });
      expect(key).toBe('xyz');
    });

    it('generates composite key when no ID', () => {
      const key = (window as any).pmosDedupKey({ collection: 'pmosUpdates', projectId: 'p1', createdAt: 1000 });
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });
  });

  describe('pmosDeduplicate', () => {
    it('removes duplicate records by ID', () => {
      const records = [
        { id: '1', collection: 'pmosUpdates', projectId: 'p1' },
        { id: '2', collection: 'pmosUpdates', projectId: 'p1' },
        { id: '1', collection: 'pmosUpdates', projectId: 'p1' },
      ];
      const deduped = (window as any).pmosDeduplicate(records);
      expect(deduped.length).toBe(2);
    });

    it('returns empty array for empty input', () => {
      const deduped = (window as any).pmosDeduplicate([]);
      expect(deduped.length).toBe(0);
    });

    it('preserves unique records', () => {
      const records = [
        { id: '1', collection: 'pmosUpdates', projectId: 'p1' },
        { id: '2', collection: 'pmosUpdates', projectId: 'p2' },
      ];
      const deduped = (window as any).pmosDeduplicate(records);
      expect(deduped.length).toBe(2);
    });
  });

  describe('pmosSafeFileName', () => {
    it('replaces spaces with hyphens', () => {
      const name = (window as any).pmosSafeFileName('my photo.jpg');
      expect(name).toBe('my-photo.jpg');
    });

    it('removes path traversal characters', () => {
      const name = (window as any).pmosSafeFileName('../../etc/passwd');
      expect(name).toBe('etc-passwd.jpg');
    });

    it('truncates long base names', () => {
      const long = 'a'.repeat(100) + '.jpg';
      const name = (window as any).pmosSafeFileName(long);
      expect(name.length).toBeLessThanOrEqual(80);
      expect(name.endsWith('.jpg')).toBe(true);
    });

    it('defaults to photo.jpg for empty input', () => {
      const name = (window as any).pmosSafeFileName();
      expect(name).toBe('photo.jpg');
    });

    it('handles special characters', () => {
      const name = (window as any).pmosSafeFileName('hello!@#$%world.PNG');
      expect(name).toBe('hello-world.jpg');
    });
  });

  describe('pmosStoragePath', () => {
    it('generates a valid storage path', () => {
      const path = (window as any).pmosStoragePath('project-1', 'issues', 'file123', 'photo.jpg');
      expect(path).toContain('pmos/project-1/issues/');
      expect(path).toContain('file123-photo.jpg');
    });
  });

  describe('pmosValidTransitions', () => {
    it('returns all statuses after current status', () => {
      const workflow = ['Draft', 'New', 'Reviewed', 'Done', 'Archived'];
      const transitions = (window as any).pmosValidTransitions('Reviewed', workflow);
      expect(transitions).toEqual(['Reviewed', 'Done', 'Archived']);
    });

    it('returns full workflow for unknown status', () => {
      const workflow = ['Draft', 'New', 'Done'];
      const transitions = (window as any).pmosValidTransitions('Unknown', workflow);
      expect(transitions).toEqual(['Draft', 'New', 'Done']);
    });

    it('returns all statuses from the first one', () => {
      const workflow = ['Draft', 'New', 'Done'];
      const transitions = (window as any).pmosValidTransitions('Draft', workflow);
      expect(transitions).toEqual(['Draft', 'New', 'Done']);
    });
  });

  describe('pmosNotifIdempotencyKey', () => {
    it('generates consistent keys for same inputs', () => {
      const key1 = (window as any).pmosNotifIdempotencyKey('quick_update_submitted', 'p1', 'record-1');
      const key2 = (window as any).pmosNotifIdempotencyKey('quick_update_submitted', 'p1', 'record-1');
      expect(key1).toBe(key2);
    });

    it('generates different keys for different actions', () => {
      const key1 = (window as any).pmosNotifIdempotencyKey('quick_update_submitted', 'p1', 'record-1');
      const key2 = (window as any).pmosNotifIdempotencyKey('issue_submitted', 'p1', 'record-1');
      expect(key1).not.toBe(key2);
    });
  });

  describe('pmosGetDraft / pmosSaveDraft / pmosClearDraft', () => {
    it('returns null for missing draft', () => {
      const draft = (window as any).pmosGetDraft('quick');
      expect(draft).toBeNull();
    });

    it('saves and retrieves a draft', () => {
      (window as any).pmosSaveDraft('quick', { category: 'General', note: 'Test' });
      const draft = (window as any).pmosGetDraft('quick');
      expect(draft).not.toBeNull();
      expect(draft.category).toBe('General');
      expect(draft.note).toBe('Test');
      expect(draft._draftSavedAt).toBeDefined();
    });

    it('clears a draft', () => {
      (window as any).pmosSaveDraft('quick', { note: 'Test' });
      (window as any).pmosClearDraft('quick');
      const draft = (window as any).pmosGetDraft('quick');
      expect(draft).toBeNull();
    });

    it('handles different module keys independently', () => {
      (window as any).pmosSaveDraft('quick', { note: 'Quick' });
      (window as any).pmosSaveDraft('sitelog', { note: 'Site' });
      expect((window as any).pmosGetDraft('quick').note).toBe('Quick');
      expect((window as any).pmosGetDraft('sitelog').note).toBe('Site');
    });
  });
});
