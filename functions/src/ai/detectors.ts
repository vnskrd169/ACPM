export type DetectorIneligibleReason =
  | 'missing_expected_delivery_date'
  | 'invalid_expected_delivery_date'
  | 'missing_remaining_quantity'
  | 'delivery_complete_or_inactive'
  | 'not_overdue'
  | 'missing_stock_quantity'
  | 'missing_reorder_point'
  | 'stock_above_reorder_point'
  | 'missing_due_date'
  | 'invalid_due_date'
  | 'task_complete_or_inactive'
  | 'missing_created_at'
  | 'before_activation';

export type DetectorResult =
  | { eligible: true; reason: null }
  | { eligible: false; reason: DetectorIneligibleReason };

export interface MaterialDeliveryCandidate {
  expectedDeliveryDate?: string | null;
  promisedDeliveryDate?: string | null;
  remainingQuantity: number | null;
  status?: string | null;
  deliveryStatus?: string | null;
}

export interface MaterialStockCandidate {
  qtyOnHand: number | null;
  reorderPoint: number | null;
}

export interface TaskCandidate {
  dueDate: string | null;
  status?: string | null;
}

export interface SiteIssueCandidate {
  createdAt: number | null;
}

const TERMINAL_DELIVERY_STATUSES = new Set([
  'fully_delivered',
  'delivered',
  'closed',
  'cancelled',
  'archived'
]);

const TERMINAL_TASK_STATUSES = new Set([
  'completed',
  'done',
  'closed',
  'cancelled',
  'archived'
]);

function normalizedStatus(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

function isCanonicalIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Detects an overdue material delivery using only an explicitly stored
 * expected/promised date. It intentionally has no PO date, request-needed
 * date, supplier-history, or actual-delivery-date input to infer from.
 */
export function detectMaterialDeliveryOverdue(
  candidate: Readonly<MaterialDeliveryCandidate>,
  todayIso: string
): DetectorResult {
  const expectedDate = candidate.expectedDeliveryDate ?? candidate.promisedDeliveryDate ?? null;
  if (!expectedDate) return { eligible: false, reason: 'missing_expected_delivery_date' };
  if (!isCanonicalIsoDate(expectedDate) || !isCanonicalIsoDate(todayIso)) {
    return { eligible: false, reason: 'invalid_expected_delivery_date' };
  }

  const status = normalizedStatus(candidate.status);
  const deliveryStatus = normalizedStatus(candidate.deliveryStatus);
  if (TERMINAL_DELIVERY_STATUSES.has(status) || TERMINAL_DELIVERY_STATUSES.has(deliveryStatus)) {
    return { eligible: false, reason: 'delivery_complete_or_inactive' };
  }
  if (candidate.remainingQuantity === null || !Number.isFinite(candidate.remainingQuantity)) {
    return { eligible: false, reason: 'missing_remaining_quantity' };
  }
  if (candidate.remainingQuantity <= 0) {
    return { eligible: false, reason: 'delivery_complete_or_inactive' };
  }
  if (expectedDate >= todayIso) return { eligible: false, reason: 'not_overdue' };
  return { eligible: true, reason: null };
}

export function detectMaterialStockLow(
  candidate: Readonly<MaterialStockCandidate>
): DetectorResult {
  if (candidate.qtyOnHand === null || !Number.isFinite(candidate.qtyOnHand)) {
    return { eligible: false, reason: 'missing_stock_quantity' };
  }
  if (candidate.reorderPoint === null || !Number.isFinite(candidate.reorderPoint)) {
    return { eligible: false, reason: 'missing_reorder_point' };
  }
  if (candidate.qtyOnHand > candidate.reorderPoint) {
    return { eligible: false, reason: 'stock_above_reorder_point' };
  }
  return { eligible: true, reason: null };
}

export function detectTaskOverdue(
  candidate: Readonly<TaskCandidate>,
  todayIso: string
): DetectorResult {
  if (!candidate.dueDate) return { eligible: false, reason: 'missing_due_date' };
  if (!isCanonicalIsoDate(candidate.dueDate) || !isCanonicalIsoDate(todayIso)) {
    return { eligible: false, reason: 'invalid_due_date' };
  }
  if (TERMINAL_TASK_STATUSES.has(normalizedStatus(candidate.status))) {
    return { eligible: false, reason: 'task_complete_or_inactive' };
  }
  if (candidate.dueDate >= todayIso) return { eligible: false, reason: 'not_overdue' };
  return { eligible: true, reason: null };
}

export function detectSiteIssueCreated(
  candidate: Readonly<SiteIssueCandidate>,
  activationAt: number
): DetectorResult {
  if (candidate.createdAt === null || !Number.isFinite(candidate.createdAt)) {
    return { eligible: false, reason: 'missing_created_at' };
  }
  if (candidate.createdAt < activationAt) {
    return { eligible: false, reason: 'before_activation' };
  }
  return { eligible: true, reason: null };
}
