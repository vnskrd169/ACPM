import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FirebaseAiPipelineStore } from './ai/firebase-store.js';
import { FirebaseActionDraftStore } from './ai/firebase-action-draft-store.js';
import { FirebaseDecisionWorkflowStore } from './ai/firebase-decision-store.js';
import {
  createActionDraftFromDecision,
  mapActionDraftError,
  reviewActionDraft
} from './ai/action-draft-workflow.js';
import {
  mapDecisionWorkflowError,
  submitHumanDecision
} from './ai/decision-workflow.js';
import { OpenAIProvider } from './ai/providers/openai.js';
import { aiConfigSchema } from './ai/schemas.js';
import { FirebaseAiSourceReader } from './ai/source-reader.js';
import {
  runStagingManualAiDryRun,
  STAGING_PROJECT_ID,
  StagingManualError,
  stagingManualInputSchema
} from './ai/staging-manual.js';
import { getAiDatabase, readAiActorProfile } from './firebase/admin.js';

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const STAGING_DATABASE_URL =
  'https://acpm-project-system-qa-default-rtdb.asia-southeast1.firebasedatabase.app';
const MANAGEMENT_ROLES = new Set(['boss', 'owner', 'admin']);

function runtimeProjectId(): string {
  return process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';
}

export const stagingManualAiDryRun = onCall({
  region: 'asia-southeast1',
  enforceAppCheck: true,
  secrets: [OPENAI_API_KEY],
  timeoutSeconds: 120,
  memory: '512MiB',
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1
}, async request => {
  if (runtimeProjectId() !== STAGING_PROJECT_ID) {
    throw new HttpsError('failed-precondition', 'staging_environment_required');
  }
  const role = typeof request.auth?.token.role === 'string' ? request.auth.token.role : '';
  if (!request.auth || !MANAGEMENT_ROLES.has(role)) {
    throw new HttpsError('permission-denied', 'management_auth_required');
  }

  const parsedInput = stagingManualInputSchema.safeParse(request.data);
  if (!parsedInput.success) throw new HttpsError('invalid-argument', 'invalid_manual_ai_request');

  const database = getAiDatabase({ databaseURL: STAGING_DATABASE_URL });
  const configSnapshot = await database.ref('ai/config').get();
  const parsedConfig = aiConfigSchema.safeParse(configSnapshot.val());
  if (!parsedConfig.success) throw new HttpsError('failed-precondition', 'valid_ai_config_required');

  const store = new FirebaseAiPipelineStore(database);
  const sourceReader = new FirebaseAiSourceReader(database);
  const provider = new OpenAIProvider({
    apiKey: OPENAI_API_KEY.value(),
    maxAttempts: parsedConfig.data.maxAttempts
  });

  try {
    return await runStagingManualAiDryRun(parsedInput.data, {
      runtimeProjectId: runtimeProjectId(),
      config: parsedConfig.data,
      store,
      sourceReader,
      provider,
      now: Date.now()
    });
  } catch (error) {
    if (error instanceof StagingManualError) {
      throw new HttpsError('failed-precondition', error.code);
    }
    throw new HttpsError('internal', 'staging_ai_run_failed');
  }
});

export const submitAiDecision = onCall({
  region: 'asia-southeast1',
  enforceAppCheck: false,
  timeoutSeconds: 30,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 5,
  concurrency: 10
}, async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');

  let profile: Record<string, unknown> | null;
  try {
    profile = await readAiActorProfile(request.auth.uid);
  } catch {
    throw new HttpsError('internal', 'actor_verification_failed');
  }

  const database = getAiDatabase();
  const decisionStore = new FirebaseDecisionWorkflowStore(database);
  const draftStore = new FirebaseActionDraftStore(database);
  const actor = {
    uid: request.auth.uid,
    role: typeof profile?.role === 'string' ? profile.role.trim().toLowerCase() : '',
    status: typeof profile?.status === 'string' ? profile.status.trim().toLowerCase() : ''
  };
  try {
    const result = await submitHumanDecision(request.data, actor, decisionStore, Date.now());
    const draft = result.status === 'resolved'
      ? await createActionDraftFromDecision(result.decisionId, draftStore)
      : { draftId: null, created: false };
    return { ...result, actionDraftId: draft.draftId, actionDraftCreated: draft.created };
  } catch (error) {
    const actionDraftMapped = mapActionDraftError(error);
    if (actionDraftMapped.safeCode !== 'action_draft_request_failed') {
      throw new HttpsError(actionDraftMapped.httpsCode, actionDraftMapped.safeCode);
    }
    const mapped = mapDecisionWorkflowError(error);
    throw new HttpsError(mapped.httpsCode, mapped.safeCode);
  }
});

export const reviewAiActionDraft = onCall({
  region: 'asia-southeast1',
  enforceAppCheck: false,
  timeoutSeconds: 30,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 5,
  concurrency: 10
}, async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');

  let profile: Record<string, unknown> | null;
  try {
    profile = await readAiActorProfile(request.auth.uid);
  } catch {
    throw new HttpsError('internal', 'actor_verification_failed');
  }

  try {
    return await reviewActionDraft(request.data, {
      uid: request.auth.uid,
      role: typeof profile?.role === 'string' ? profile.role.trim().toLowerCase() : '',
      status: typeof profile?.status === 'string' ? profile.status.trim().toLowerCase() : ''
    }, new FirebaseActionDraftStore(getAiDatabase()), Date.now());
  } catch (error) {
    const mapped = mapActionDraftError(error);
    throw new HttpsError(mapped.httpsCode, mapped.safeCode);
  }
});
