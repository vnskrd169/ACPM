import { describe, expect, it } from 'vitest';

import type { MaterialDeliveryCandidate } from '../src/ai/detectors.js';
import {
  detectMaterialDeliveryOverdue,
  detectMaterialStockLow,
  detectSiteIssueCreated,
  detectTaskOverdue
} from '../src/ai/detectors.js';

describe('safe deterministic detectors', () => {
  it('suppresses delivery overdue when no canonical expected date exists', () => {
    const legacyFieldsOnly = {
      date: '2026-01-01',
      neededDate: '2026-01-05',
      lastDeliveryDate: '2026-01-10',
      remainingQuantity: 10,
      status: 'ordered'
    } as MaterialDeliveryCandidate;

    expect(detectMaterialDeliveryOverdue(legacyFieldsOnly, '2026-02-01')).toEqual({
      eligible: false,
      reason: 'missing_expected_delivery_date'
    });
  });

  it('detects delivery overdue only from an explicit expected or promised date', () => {
    expect(detectMaterialDeliveryOverdue({
      expectedDeliveryDate: '2026-01-31',
      remainingQuantity: 4,
      status: 'ordered'
    }, '2026-02-01')).toEqual({ eligible: true, reason: null });

    expect(detectMaterialDeliveryOverdue({
      promisedDeliveryDate: '2026-01-31',
      remainingQuantity: 4,
      status: 'ordered'
    }, '2026-02-01')).toEqual({ eligible: true, reason: null });
  });

  it('does not flag a future, invalid, or completed delivery', () => {
    expect(detectMaterialDeliveryOverdue({
      expectedDeliveryDate: '2026-02-01',
      remainingQuantity: 4
    }, '2026-02-01').reason).toBe('not_overdue');
    expect(detectMaterialDeliveryOverdue({
      expectedDeliveryDate: '2026-02-31',
      remainingQuantity: 4
    }, '2026-03-01').reason).toBe('invalid_expected_delivery_date');
    expect(detectMaterialDeliveryOverdue({
      expectedDeliveryDate: '2026-01-01',
      remainingQuantity: 0
    }, '2026-02-01').reason).toBe('delivery_complete_or_inactive');
  });

  it('detects low stock only with explicit numeric stock and threshold', () => {
    expect(detectMaterialStockLow({ qtyOnHand: 2, reorderPoint: 3 })).toEqual({
      eligible: true,
      reason: null
    });
    expect(detectMaterialStockLow({ qtyOnHand: 4, reorderPoint: 3 }).reason).toBe('stock_above_reorder_point');
    expect(detectMaterialStockLow({ qtyOnHand: 0, reorderPoint: null }).reason).toBe('missing_reorder_point');
  });

  it('detects only active tasks whose explicit due date is before today', () => {
    expect(detectTaskOverdue({ dueDate: '2026-01-31', status: 'in_progress' }, '2026-02-01')).toEqual({
      eligible: true,
      reason: null
    });
    expect(detectTaskOverdue({ dueDate: '2026-01-31', status: 'completed' }, '2026-02-01').reason).toBe('task_complete_or_inactive');
    expect(detectTaskOverdue({ dueDate: null, status: 'in_progress' }, '2026-02-01').reason).toBe('missing_due_date');
  });

  it('suppresses historical site issues created before activation', () => {
    expect(detectSiteIssueCreated({ createdAt: 1999 }, 2000).reason).toBe('before_activation');
    expect(detectSiteIssueCreated({ createdAt: 2000 }, 2000)).toEqual({ eligible: true, reason: null });
    expect(detectSiteIssueCreated({ createdAt: null }, 2000).reason).toBe('missing_created_at');
  });
});
