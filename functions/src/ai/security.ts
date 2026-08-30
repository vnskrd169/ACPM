export const AI_SERVICE_UID = 'acpm-ai-service' as const;
export const AI_NAMESPACE = 'ai' as const;

export const AI_CONTEXT_COLLECTIONS = [
  'tasks',
  'purchaseOrders',
  'deliveries',
  'inventory',
  'materialMovements',
  'purchaseRequests',
  'siteLogs',
  'punchList',
  'pmosIssues'
] as const;

export const AI_WRITABLE_COLLECTIONS = [
  'config',
  'projectTargets',
  'agents',
  'runtimeStatus',
  'uiStatus',
  'conditions',
  'events',
  'runs',
  'findings',
  'recommendations',
  'decisions',
  'actionDrafts',
  'actionDraftEvents',
  'idempotency'
] as const;

// RTDB cannot hide sensitive sibling fields after granting read access to a
// supplier record. Supplier reads stay denied until a safe projection exists.
export const SUPPLIER_CONTEXT_FIELD_ALLOWLIST = [
  'name',
  'specialty',
  'status'
] as const;

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
}

export function isAiContextReadPath(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized === 'pmosIssues' || normalized.startsWith('pmosIssues/')) {
    return true;
  }

  const match = normalized.match(/^projects\/[^/]+\/([^/]+)(?:\/.*)?$/);
  return match !== null && AI_CONTEXT_COLLECTIONS.includes(
    match[1] as (typeof AI_CONTEXT_COLLECTIONS)[number]
  );
}

export function isAiWritePath(path: string): boolean {
  const normalized = normalizePath(path);
  const match = normalized.match(/^ai\/([^/]+)(?:\/.*)?$/);
  return match !== null && AI_WRITABLE_COLLECTIONS.includes(
    match[1] as (typeof AI_WRITABLE_COLLECTIONS)[number]
  );
}

export function assertAiWritePath(path: string): void {
  if (!isAiWritePath(path)) {
    throw new Error(`AI service write denied outside the explicit /${AI_NAMESPACE} namespace`);
  }
}

export function selectSafeSupplierContext(
  supplier: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return Object.fromEntries(
    SUPPLIER_CONTEXT_FIELD_ALLOWLIST
      .filter(field => Object.prototype.hasOwnProperty.call(supplier, field))
      .map(field => [field, supplier[field]])
  );
}
