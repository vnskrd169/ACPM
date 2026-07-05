import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const targetDir = join(root, 'public', 'models');
const baseUrl = 'https://unpkg.com/@vladmandic/face-api@1.7.15/model';

const files = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin'
];

mkdirSync(targetDir, { recursive: true });

function download(file) {
  const url = `${baseUrl}/${file}`;
  const target = join(targetDir, file);
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed for ${file}: HTTP ${response.statusCode}`));
        response.resume();
        return;
      }
      const stream = createWriteStream(target);
      response.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        console.log(`saved public/models/${file}`);
        resolve();
      });
      stream.on('error', reject);
    });
    request.on('error', reject);
  });
}

for (const file of files) {
  await download(file);
}

console.log('Face models are ready in public/models.');
