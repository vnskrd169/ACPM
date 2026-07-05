# Face Model Files

Put the local `@vladmandic/face-api` model files in this folder.

Required files for the default engine used by this app:

```text
ssd_mobilenetv1_model-weights_manifest.json
ssd_mobilenetv1_model.bin
face_landmark_68_model-weights_manifest.json
face_landmark_68_model.bin
face_recognition_model-weights_manifest.json
face_recognition_model.bin
```

Default model path in the app:

```text
/models
```

If the files are missing, enrollment and scanning are disabled with a setup error. Recognition results are never faked.

You can download the required local model files with:

```bash
pnpm download-models
```

Source: `@vladmandic/face-api@1.7.15/model` on UNPKG.
