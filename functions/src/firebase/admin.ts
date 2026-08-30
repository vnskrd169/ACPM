import {
  applicationDefault,
  deleteApp,
  getApp,
  getApps,
  initializeApp,
  type App,
  type AppOptions
} from 'firebase-admin/app';
import { getDatabase, type Database } from 'firebase-admin/database';

import { AI_SERVICE_UID } from '../ai/security.js';

const AI_ADMIN_APP_NAME = 'acpm-ai-restricted';

export interface AiAdminOptions {
  databaseURL?: string;
}

export function getAiAdminApp(options: AiAdminOptions = {}): App {
  if (getApps().some(app => app.name === AI_ADMIN_APP_NAME)) {
    return getApp(AI_ADMIN_APP_NAME);
  }

  const appOptions: AppOptions = {
    credential: applicationDefault(),
    databaseAuthVariableOverride: {
      uid: AI_SERVICE_UID
    }
  };

  if (options.databaseURL !== undefined) {
    appOptions.databaseURL = options.databaseURL;
  }

  return initializeApp(appOptions, AI_ADMIN_APP_NAME);
}

export function getAiDatabase(options: AiAdminOptions = {}): Database {
  return getDatabase(getAiAdminApp(options));
}

export async function readAiActorProfile(
  uid: string,
  options: AiAdminOptions = {}
): Promise<Record<string, unknown> | null> {
  if (!uid || /[.#$\[\]\/]/.test(uid)) return null;
  const actorApp = initializeApp({
    credential: applicationDefault(),
    ...(options.databaseURL !== undefined ? { databaseURL: options.databaseURL } : {}),
    databaseAuthVariableOverride: { uid }
  }, `acpm-ai-actor-${crypto.randomUUID()}`);
  try {
    const snapshot = await getDatabase(actorApp).ref(`users/${uid}`).get();
    return snapshot.exists() ? snapshot.val() as Record<string, unknown> : null;
  } finally {
    await deleteApp(actorApp);
  }
}
