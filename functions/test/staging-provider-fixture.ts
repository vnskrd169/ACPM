import { InMemoryAiSourceReader, type SourceRecordMap } from '../src/ai/source-reader.js';
import { InMemoryAiPipelineStore } from '../src/ai/store.js';
import { enabledTarget, NOW, taskEvent } from './helpers.js';

export const STAGING_QA_FIXTURE_PROJECT_ID = 'ai-provider-staging-qa-v1';
export const STAGING_QA_FIXTURE_EVENT_ID = 'event-staging-provider-overdue-task';

export function createStagingProviderFixture() {
  const projectSources: Record<string, SourceRecordMap> = {
    tasks: {
      'task-overdue': {
        title: 'Synthetic staging overdue task',
        status: 'in_progress',
        dueDate: '2026-08-28',
        materialRelevant: false
      }
    },
    inventory: {
      'cement-low': {
        itemKey: 'synthetic-cement',
        description: 'Synthetic cement',
        qtyOnHand: 2,
        reorderPoint: 5
      }
    },
    pmosIssues: {
      'issue-new': {
        clientGeneratedId: 'synthetic-issue-1',
        type: 'quality',
        description: 'Synthetic QA issue',
        status: 'open',
        createdAt: NOW - 1000
      }
    }
  };
  const store = new InMemoryAiPipelineStore({
    [STAGING_QA_FIXTURE_PROJECT_ID]: enabledTarget()
  });
  store.events.set(STAGING_QA_FIXTURE_EVENT_ID, taskEvent({
    projectId: STAGING_QA_FIXTURE_PROJECT_ID,
    sourcePath: `projects/${STAGING_QA_FIXTURE_PROJECT_ID}/tasks`,
    sourceRecordId: 'task-overdue'
  }));

  return {
    store,
    sourceReader: new InMemoryAiSourceReader({
      [STAGING_QA_FIXTURE_PROJECT_ID]: projectSources
    }),
    projectSources,
    cleanup() {
      store.targets.clear();
      store.conditions.clear();
      store.events.clear();
      store.runs.clear();
      store.findings.clear();
      store.recommendations.clear();
      store.decisions.clear();
      for (const key of Object.keys(projectSources)) delete projectSources[key];
    }
  };
}
