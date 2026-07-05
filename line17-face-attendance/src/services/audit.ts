import { db } from './db';

export async function audit(action: string, targetType: string, targetId: string, details: Record<string, unknown> = {}): Promise<void> {
  await db.auditLogs.add({
    logId: crypto.randomUUID(),
    action,
    targetType,
    targetId,
    details,
    createdAt: Date.now()
  });
}
