import { describe, expect, it } from 'vitest';

import { reconcileProject } from '../src/ai/reconciler.js';
import { InMemoryAiSourceReader, type SourceRecordMap } from '../src/ai/source-reader.js';
import { InMemoryAiPipelineStore } from '../src/ai/store.js';
import { enabledConfig, enabledTarget, NOW } from './helpers.js';

function setup(sources: Record<string, SourceRecordMap> = {}, rootIssues: SourceRecordMap = {}) {
  const store = new InMemoryAiPipelineStore({ 'project-1': enabledTarget() });
  const sourceReader = new InMemoryAiSourceReader({ 'project-1': sources }, rootIssues);
  return { store, sourceReader };
}

describe('deterministic project reconciliation', () => {
  it('does nothing when global AI or the explicit target is disabled', async () => {
    const first = setup({ tasks: { task1: { dueDate: '2026-01-01', status: 'open' } } });
    await expect(reconcileProject('project-1', NOW, {
      ...first,
      config: enabledConfig({ enabled: false })
    })).resolves.toMatchObject({ status: 'skipped', reason: 'ai_disabled' });
    expect(first.store.events.size).toBe(0);

    const second = setup();
    second.store.targets.set('project-1', enabledTarget({ enabled: false }));
    await expect(reconcileProject('project-1', NOW, {
      ...second,
      config: enabledConfig()
    })).resolves.toMatchObject({ status: 'skipped', reason: 'target_disabled' });
  });

  it('detects an overdue active task and suppresses terminal tasks', async () => {
    const dependencies = setup({
      tasks: {
        overdue: { title: 'Overdue', dueDate: '2026-08-28', status: 'in_progress' },
        done: { title: 'Done', dueDate: '2026-08-01', status: 'completed' },
        cancelled: { title: 'Cancelled', dueDate: '2026-08-01', status: 'cancelled' }
      }
    });
    const result = await reconcileProject('project-1', NOW, {
      ...dependencies,
      config: enabledConfig()
    });
    expect(result.eventIds).toHaveLength(1);
    expect(result.suppressions.filter(item => item.reason === 'task_complete_or_inactive')).toHaveLength(2);
  });

  it('detects low stock only with an explicit numeric threshold', async () => {
    const dependencies = setup({
      inventory: {
        low: { itemKey: 'cement', qtyOnHand: 2, reorderPoint: 2 },
        unknown: { itemKey: 'rebar', qtyOnHand: 2 },
        healthy: { itemKey: 'sand', qtyOnHand: 5, threshold: 2 }
      }
    });
    const result = await reconcileProject('project-1', NOW, {
      ...dependencies,
      config: enabledConfig()
    });
    expect(result.eventIds).toHaveLength(1);
    expect(result.suppressions.map(item => item.reason)).toContain('missing_reorder_point');
    expect(result.suppressions.map(item => item.reason)).toContain('stock_above_reorder_point');
  });

  it('suppresses delivery overdue without an explicit promised or expected date', async () => {
    const dependencies = setup({
      purchaseOrders: {
        legacy: {
          date: '2026-01-01',
          neededDate: '2026-01-15',
          remainingQuantity: 5,
          status: 'ordered'
        }
      }
    });
    const result = await reconcileProject('project-1', NOW, {
      ...dependencies,
      config: enabledConfig()
    });
    expect(result.eventIds).toEqual([]);
    expect(result.suppressions).toContainEqual(expect.objectContaining({
      eventType: 'material_delivery_overdue',
      reason: 'missing_expected_delivery_date'
    }));
  });

  it('blocks historical issue flood and detects nested issues after activation', async () => {
    const dependencies = setup({
      punchList: {
        historical: { issue: 'Old', status: 'open', createdAt: NOW - 20_000 }
      },
      siteLogs: {
        log1: {
          issues: {
            fresh: { description: 'Fresh issue', status: 'open', createdAt: NOW - 1000 }
          }
        }
      }
    });
    const result = await reconcileProject('project-1', NOW, {
      ...dependencies,
      config: enabledConfig()
    });
    expect(result.eventIds).toHaveLength(1);
    expect(result.suppressions).toContainEqual(expect.objectContaining({ reason: 'before_activation' }));
  });

  it('normalizes duplicate root and project fallback PMOS issues into one condition', async () => {
    const issue = {
      projectId: 'project-1',
      clientGeneratedId: 'logical-issue-1',
      issue: 'Duplicate source',
      status: 'Open',
      createdAt: NOW - 1000
    };
    const dependencies = setup({ pmosIssues: { fallback: issue } }, { root: issue });
    const result = await reconcileProject('project-1', NOW, {
      ...dependencies,
      config: enabledConfig()
    });
    expect(result.eventIds).toHaveLength(1);
    expect(dependencies.store.conditions.size).toBe(1);
    expect(dependencies.store.events.size).toBe(1);
  });

  it('creates once, remains stable, clears, and opens a new recurrence cycle', async () => {
    const tasks: Record<string, Record<string, unknown>> = {
      task1: { dueDate: '2026-08-28', status: 'in_progress' }
    };
    const dependencies = setup({ tasks });
    const deps = { ...dependencies, config: enabledConfig() };

    const first = await reconcileProject('project-1', NOW, deps);
    const second = await reconcileProject('project-1', NOW + 1, deps);
    expect(second.eventIds).toEqual(first.eventIds);
    expect(dependencies.store.events.size).toBe(1);

    tasks.task1.status = 'completed';
    const cleared = await reconcileProject('project-1', NOW + 2, deps);
    expect(cleared.resolvedConditionKeys).toHaveLength(1);
    expect([...dependencies.store.events.values()][0]?.status).toBe('resolved');

    tasks.task1.status = 'in_progress';
    const recurrence = await reconcileProject('project-1', NOW + 3, deps);
    expect(recurrence.eventIds[0]).not.toBe(first.eventIds[0]);
    expect(dependencies.store.events.size).toBe(2);
  });

  it('concurrent and repeated reconciliation converge on one event', async () => {
    const dependencies = setup({
      tasks: { task1: { dueDate: '2026-08-28', status: 'in_progress' } }
    });
    const deps = { ...dependencies, config: enabledConfig() };
    const [left, right] = await Promise.all([
      reconcileProject('project-1', NOW, deps),
      reconcileProject('project-1', NOW, deps)
    ]);
    expect(left.eventIds).toEqual(right.eventIds);
    expect(dependencies.store.events.size).toBe(1);
    expect(dependencies.store.conditions.size).toBe(1);
  });
});
