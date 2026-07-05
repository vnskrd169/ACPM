import type { AppSettings, MatchLabel } from '../types';
import type { MatchCandidate } from '../types';

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'default',
  strongMatchThreshold: 0.4,
  possibleMatchThreshold: 0.55,
  liveStableFrameCount: 3,
  liveScanIntervalMs: 850,
  liveAutoDraftCooldownMinutes: 10,
  modelPath: '/models',
  updatedAt: Date.now()
};

export function labelForDistance(distance: number | undefined, settings: AppSettings): MatchLabel {
  if (typeof distance !== 'number' || Number.isNaN(distance)) return 'Unknown';
  if (distance <= settings.strongMatchThreshold) return 'Strong Match';
  if (distance <= settings.possibleMatchThreshold) return 'Possible Match';
  return 'Unknown';
}

export function isAcceptedMatch(match: MatchCandidate | undefined): boolean {
  return !!match && match.matchLabel !== 'Unknown';
}

export function enrollmentStatus(validDescriptorCount: number): 'Failed' | 'Partial' | 'Complete' {
  if (validDescriptorCount >= 3) return 'Complete';
  if (validDescriptorCount > 0) return 'Partial';
  return 'Failed';
}
