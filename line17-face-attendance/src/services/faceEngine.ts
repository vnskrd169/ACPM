import * as faceapi from '@vladmandic/face-api';
import type { FaceAnalysisResult, FaceBox, FaceQualityReport, ModelStatus } from '../types';
import { blobToImage } from '../utils/imageUtils';

const MODEL_NAME = 'ssd_mobilenetv1-face_landmark_68-face_recognition';

let loadedModelPath = '';
let lastError = '';

export function getModelName(): string {
  return MODEL_NAME;
}

export function getLastModelError(): string {
  return lastError;
}

export function isModelReady(modelPath: string): boolean {
  return loadedModelPath === modelPath && faceapi.nets.ssdMobilenetv1.isLoaded && faceapi.nets.faceLandmark68Net.isLoaded && faceapi.nets.faceRecognitionNet.isLoaded;
}

export async function loadModels(modelPath: string, onStatus?: (status: ModelStatus, message: string) => void): Promise<void> {
  if (isModelReady(modelPath)) {
    onStatus?.('ready', 'Face models loaded.');
    return;
  }
  try {
    lastError = '';
    loadedModelPath = '';
    onStatus?.('loading', 'Loading local face models...');
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelPath)
    ]);
    loadedModelPath = modelPath;
    onStatus?.('ready', 'Face models loaded.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastError = `Could not load face models from "${modelPath}". Place the model manifest and shard files in public/models, or update Settings. ${message}`;
    onStatus?.('error', lastError);
    throw new Error(lastError);
  }
}

export async function analyzeFace(blob: Blob, modelPath: string): Promise<FaceAnalysisResult> {
  if (!isModelReady(modelPath)) {
    await loadModels(modelPath);
  }
  const image = await blobToImage(blob);
  return analyzeFaceInput(image, modelPath);
}

export async function analyzeFaceElement(input: HTMLImageElement | HTMLVideoElement, modelPath: string): Promise<FaceAnalysisResult> {
  if (!isModelReady(modelPath)) {
    await loadModels(modelPath);
  }
  return analyzeFaceInput(input, modelPath);
}

async function analyzeFaceInput(input: HTMLImageElement | HTMLVideoElement, modelPath: string): Promise<FaceAnalysisResult> {
  if (!isModelReady(modelPath)) {
    await loadModels(modelPath);
  }
  const detections = await faceapi
    .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  const imageSize = {
    width: input instanceof HTMLVideoElement ? input.videoWidth : input.naturalWidth || input.width,
    height: input instanceof HTMLVideoElement ? input.videoHeight : input.naturalHeight || input.height
  };

  if (!detections.length) {
    return {
      ok: false,
      faceDetected: false,
      multipleFacesDetected: false,
      faceCount: 0,
      imageSize,
      error: 'No face detected. Use a clearer photo with one visible face.'
    };
  }

  const first = detections[0];
  const box = first.detection.box;
  const primaryBox = { x: box.x, y: box.y, width: box.width, height: box.height };
  const quality = evaluateFaceQuality(input, imageSize, primaryBox, detections.length);
  if (Math.min(box.width, box.height) < 80) {
    return {
      ok: false,
      faceDetected: true,
      multipleFacesDetected: detections.length > 1,
      faceCount: detections.length,
      primaryBox,
      quality,
      imageSize,
      error: 'Face is too small. Move closer and retake the photo.'
    };
  }

  return {
    ok: true,
    faceDetected: true,
    multipleFacesDetected: detections.length > 1,
    faceCount: detections.length,
    descriptor: Array.from(first.descriptor),
    primaryBox,
    quality,
    imageSize,
    warning: buildWarning(quality, detections.length)
  };
}

function buildWarning(quality: FaceQualityReport, faceCount: number): string | undefined {
  const warnings = [
    faceCount > 1 ? 'Multiple faces detected. The first detected face was used; manual review is required.' : '',
    ...quality.issues
  ].filter(Boolean);
  return warnings.length ? warnings.join(' ') : undefined;
}

function evaluateFaceQuality(
  input: HTMLImageElement | HTMLVideoElement,
  imageSize: { width: number; height: number },
  box: FaceBox,
  faceCount: number
): FaceQualityReport {
  const sample = sampleImageQuality(input, imageSize);
  const faceCoverage = Math.min(box.width / imageSize.width, box.height / imageSize.height);
  const faceCenterX = box.x + box.width / 2;
  const faceCenterY = box.y + box.height / 2;
  const offsetX = Math.abs(faceCenterX - imageSize.width / 2) / (imageSize.width / 2);
  const offsetY = Math.abs(faceCenterY - imageSize.height / 2) / (imageSize.height / 2);
  const centeredness = Math.max(0, 1 - Math.hypot(offsetX, offsetY) / Math.SQRT2);
  const issues: string[] = [];

  if (sample.brightness < 45) issues.push('Lighting is too dark.');
  if (sample.brightness > 220) issues.push('Lighting is too bright.');
  if (sample.sharpness < 8) issues.push('Frame looks blurry.');
  if (faceCoverage < 0.13) issues.push('Face is too far from the camera.');
  if (faceCoverage > 0.82) issues.push('Face is too close to the camera.');
  if (centeredness < 0.45) issues.push('Face is not centered.');
  if (faceCount > 1) issues.push('Only one face should be visible.');

  return {
    ok: issues.length === 0,
    summary: issues.length ? issues[0] : 'Frame quality ready.',
    issues,
    brightness: roundMetric(sample.brightness),
    sharpness: roundMetric(sample.sharpness),
    faceCoverage: roundMetric(faceCoverage),
    centeredness: roundMetric(centeredness)
  };
}

function sampleImageQuality(input: HTMLImageElement | HTMLVideoElement, imageSize: { width: number; height: number }): { brightness: number; sharpness: number } {
  const canvas = document.createElement('canvas');
  const sampleWidth = 160;
  const sampleHeight = Math.max(1, Math.round((imageSize.height / imageSize.width) * sampleWidth));
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { brightness: 128, sharpness: 99 };
  context.drawImage(input, 0, 0, sampleWidth, sampleHeight);
  const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const gray = new Float32Array(sampleWidth * sampleHeight);
  let luminanceTotal = 0;
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const offset = pixel * 4;
    const luminance = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
    gray[pixel] = luminance;
    luminanceTotal += luminance;
  }
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 1; y < sampleHeight - 1; y += 1) {
    for (let x = 1; x < sampleWidth - 1; x += 1) {
      const index = y * sampleWidth + x;
      const edge = Math.abs(gray[index] - gray[index - 1]) + Math.abs(gray[index] - gray[index + sampleWidth]);
      edgeTotal += edge;
      edgeCount += 1;
    }
  }
  return {
    brightness: luminanceTotal / gray.length,
    sharpness: edgeCount ? edgeTotal / edgeCount : 99
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}
