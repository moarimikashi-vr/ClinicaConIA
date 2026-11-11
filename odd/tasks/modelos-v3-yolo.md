# Feature: deploy classifier v3 + YOLO detector

Objective: replace the v1 classifier in the IA microservice with v3 (DenseNet121, 448 letterbox, TTA) and add the YOLOv8s ONNX detector; persist suggested regions on the case and draw them in the DICOM viewer.
Branch: claude/repo-latest-changes-83c046 · Delivery: ask-on-risk · Test runner: none in repo (manual smoke scripts + `npm run build` + comparison against Colab notebooks).

## Specs

- S1 Model: `MODEL_FILENAME = 'modelo_fracturas_v3.keras'`; `IMG_SIZE = (448, 448)`; preprocessing "tf.image.resize_with_pad(img, 448, 448) (bilineal, centrado, relleno negro), luego round, clip 0–255 y cast a uint8 → float32".
- S2 Interpretation: "probability_fracture = score; NO 1 - score"; "p < 0.193 → SANO/SUCCESS; p > 0.8152 → FRACTURA DETECTADA/DANGER; si no → REVISIÓN REQUERIDA/WARNING"; same labels, status and analysis_note.
- S3 Detector: load `ort.InferenceSession('yolo_fracturas.onnx')` at startup, copy `detectar_fracturas` from the notebook, add `regiones` (list, confianza ≥ 0.25) to `/predict_local` and `/analyze_firebase`; `'model_version': 'v3+yolo'`.
- S4 Dependencies: `tensorflow==2.21.0`, `keras==3.13.2`, `onnxruntime`, `opencv-python-headless`; remove `numpy<2.0.0`; Python 3.11.9 must stay compatible.
- S5 caseController.js: save `resultado.regiones` on the case document (field `iaRegiones` with model and date) and mention in the Asistente IA comment how many suggested zones there are.
- S6 DicomViewer.jsx: read `iaRegiones` of the case and draw rectangles over the image with the legend "zona sugerida por IA (xx %)" and a button to hide them. Coordinates are original-image pixels.
- S7 Verification: the probability the API computes for an image must match the Colab notebook; compare probability and boxes for one fractured and one healthy test image.
- S8 Model files: download `modelo_fracturas_v3.keras` and `yolo_fracturas.onnx` from Drive into `Backend/api-IAFraturas/` (Git LFS only if > 50 MB).

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1-S4 | inline | done (code) | smoke test 9/9 PASS on Python 3.11 + TF 2.21.0 + Keras 3.13.2 (preprocess == notebook `cargar`, thresholds, startup without models) |
| T2 | S5 | inline | done | `node --check` OK |
| T3 | S6 | inline | done | `vite build` OK; eslint errors only pre-existing |
| T4 | S7-S8 | inline (needs model files from user) | blocked | |
| T5 | deploy on Render + memory check | user | pending | |

## Log

- L1 (2026-11-11): "Modelos v3 + YOLO" — chosen front from `contexto_tesis_claude_code.json` (`actualizacion_modelos_repo`).
- L2: git fetch showed no new commits; base is 3004dcc. Model files are not on disk; notebooks have no saved outputs, so S7 needs a fresh run or a reference value from Colab.
- L3: Notebook inference decodes JPG with `tf.io.decode_image` (v3) and `cv2.imread` (YOLO); the API decodes non-DICOM with `tf.io.decode_image` to match v3.
- L5: Drive C: is full (~40 MB free); local venv and npm caches live in `D:/claude-scratch-clinica` (outside the repo). Next step: user downloads `modelo_fracturas_v3.keras` and `yolo_fracturas.onnx` into `Backend/api-IAFraturas/` to run S7.
- L4: Regions are stored as an array `iaRegiones` of `{archivo, nombre, modelo, fecha, prediction, confidence_fracture, regiones}` (array, not a map keyed by path, because Storage paths contain dots and slashes that break Firestore field paths).
