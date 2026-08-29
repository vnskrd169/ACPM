import type { Database } from 'firebase-admin/database';

import type { AiProjectTarget } from './contracts.js';
import type { AI_CONTEXT_COLLECTIONS } from './security.js';

export type AiContextCollection = (typeof AI_CONTEXT_COLLECTIONS)[number];
export type SourceRecord = Readonly<Record<string, unknown>>;
export type SourceRecordMap = Readonly<Record<string, SourceRecord>>;

export interface AiSourceReader {
  readProjectCollection(projectId: string, collection: AiContextCollection): Promise<SourceRecordMap>;
  readRootPmosIssues(projectId: string): Promise<SourceRecordMap>;
}

function recordMap(value: unknown): SourceRecordMap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, record]) => record !== null && typeof record === 'object' && !Array.isArray(record))
      .map(([id, record]) => [id, record as SourceRecord])
  );
}

export class FirebaseAiSourceReader implements AiSourceReader {
  constructor(private readonly database: Database) {}

  async readProjectCollection(
    projectId: string,
    collection: AiContextCollection
  ): Promise<SourceRecordMap> {
    if (!projectId.trim()) throw new Error('projectId is required');
    const snapshot = await this.database.ref(`projects/${projectId}/${collection}`).get();
    return recordMap(snapshot.val());
  }

  async readRootPmosIssues(projectId: string): Promise<SourceRecordMap> {
    const snapshot = await this.database
      .ref('pmosIssues')
      .orderByChild('projectId')
      .equalTo(projectId)
      .get();
    return recordMap(snapshot.val());
  }
}

export class InMemoryAiSourceReader implements AiSourceReader {
  constructor(
    private readonly projects: Readonly<Record<string, Partial<Record<AiContextCollection, SourceRecordMap>>>>,
    private readonly rootIssues: SourceRecordMap = {}
  ) {}

  async readProjectCollection(
    projectId: string,
    collection: AiContextCollection
  ): Promise<SourceRecordMap> {
    return this.projects[projectId]?.[collection] ?? {};
  }

  async readRootPmosIssues(projectId: string): Promise<SourceRecordMap> {
    return Object.fromEntries(
      Object.entries(this.rootIssues).filter(([, issue]) => issue.projectId === projectId)
    );
  }
}

export interface EnrolledTargetSource {
  getProjectTarget(projectId: string): Promise<AiProjectTarget | null>;
}
