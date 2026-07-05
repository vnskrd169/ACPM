import { db } from './db';
import type { AppSettings, MatchCandidate } from '../types';
import { labelForDistance } from '../utils/thresholds';

function euclidean(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = Number(a[i]) - Number(b[i]);
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

export async function findTopMatches(descriptor: number[], settings: AppSettings): Promise<MatchCandidate[]> {
  const [workers, descriptors, photos] = await Promise.all([
    db.workers.toArray(),
    db.faceDescriptors.toArray(),
    db.referencePhotos.toArray()
  ]);
  const eligibleWorkers = workers.filter(worker =>
    worker.consentRecorded &&
    worker.faceEnrollmentStatus !== 'Revoked' &&
    worker.faceEnrollmentStatus !== 'Not Enrolled'
  );
  const workerById = new Map(eligibleWorkers.map(worker => [worker.workerId, worker]));
  const photosByDescriptor = new Map(photos.map(photo => [photo.descriptorId || '', photo]));
  const bestByWorker = new Map<string, MatchCandidate>();

  descriptors.forEach(record => {
    const worker = workerById.get(record.workerId);
    if (!worker) return;
    const distance = euclidean(descriptor, record.vector);
    const existing = bestByWorker.get(worker.workerId);
    if (!existing || distance < existing.distance) {
      const referencePhoto = photosByDescriptor.get(record.descriptorId);
      bestByWorker.set(worker.workerId, {
        workerId: worker.workerId,
        workerName: worker.workerName,
        distance: Number(distance.toFixed(4)),
        matchLabel: labelForDistance(distance, settings),
        referencePhotoId: referencePhoto?.photoId,
        referencePhotoBlob: referencePhoto?.blob
      });
    }
  });

  return [...bestByWorker.values()]
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);
}
