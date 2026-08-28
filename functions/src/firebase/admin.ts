import {
  applicationDefault,
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
