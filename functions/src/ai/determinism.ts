import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function stableDigest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}_${stableDigest(value).slice(0, 24)}`;
}

export function conditionKey(parts: Readonly<{
  projectId: string;
  eventType: string;
  logicalSource: string;
  logicalRecordId: string;
}>): string {
  return deterministicId('condition', parts);
}
