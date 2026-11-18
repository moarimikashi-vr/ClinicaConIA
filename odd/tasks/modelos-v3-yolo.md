# Feature: deploy classifier v3 + YOLO detector

Objective: replace the v1 classifier in the IA microservice with v3 (DenseNet121, 448 letterbox, TTA) and add the YOLOv8s ONNX detector; persist suggested regions on the case and draw them in the DICOM viewer.
Branch: claude/repo-latest-changes-83c046 · Delivery: ask-on-risk · Test runner: none in repo (manual smoke scripts + `npm run build` + comparison against Colab notebooks).

## Specs

- S1 Model: `MODEL_FILENAME = 'modelo_fracturas_v3.keras'`; `IMG_SIZE = (448, 448)`; preprocessing "tf.image.resize_with_pad(img, 448, 448) (bilineal, centrado, relleno negro), luego round, clip 0–255 y cast a uint8 → float32".
- S2 Interpretation: "probability_fracture = score; NO 1 - score"; "p < 0.193 → SANO/SUCCESS; p > 0.8152 → FRACTURA DETECTADA/DANGER; si no → REVISIÓN REQUERIDA/WARNING"; same labels, status and analysis_note.
- S3 Detector: load `ort.InferenceSession('yolo_fracturas.onnx')` at startup, copy `detectar_fracturas` from the notebook, add `regiones` (list, confianza ≥ 0.25) to `/predict_local` and `/analyze_firebase`; `'model_version': 'v3+yolo'`.
- S4 Dependencies (rewritten after L7): no TensorFlow in the service; v3 is served as `clasificador_v3.onnx` with `onnxruntime`, plus `opencv-python-headless` and `simplejpeg`; remove `numpy<2.0.0`; Python 3.11.9 must stay compatible. Export script `tools/export_v3_onnx.py` must prove parity with the `.keras` (TTA and preprocess_input included).
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
| T4 | S7-S8 | inline | done locally; Colab comparison on real FracAtlas images still pending | export parity 3.9e-7; e2e notebook vs API max 1.9e-4; smoke 14/14; peak 338 MB |
| T5 | deploy on Render + memory check | user | pending | |

## Log

- L1 (2026-11-11): "Modelos v3 + YOLO" — chosen front from `contexto_tesis_claude_code.json` (`actualizacion_modelos_repo`).
- L2: git fetch showed no new commits; base is 3004dcc. Model files are not on disk; notebooks have no saved outputs, so S7 needs a fresh run or a reference value from Colab.
- L3: Notebook inference decodes JPG with `tf.io.decode_image` (v3) and `cv2.imread` (YOLO); the API decodes non-DICOM with `tf.io.decode_image` to match v3.
- L5: Drive C: is full (~40 MB free); local venv and npm caches live in `D:/claude-scratch-clinica` (outside the repo). Next step: user downloads `modelo_fracturas_v3.keras` and `yolo_fracturas.onnx` into `Backend/api-IAFraturas/` to run S7.
- L6 (2026-11-11): user: "ya meti, los archivos" (placed in main checkout; copied to worktree, untracked). sha256 prefixes: v3 1e66061d0dec7c43 (73.4 MB), onnx fd65d5e3991f4856 (44.7 MB). Both load with TF 2.21 / Keras 3.13.2; smoke test 9/9 PASS with real models; TTA flip invariance |p(x)-p(flip x)| = 1.6e-4; first inference 21 s; RSS 480 MB after load, 744 MB peak after one inference -> exceeds Render free 512 MB. No FracAtlas test images on disk, so S7 still needs reference images + Colab probabilities. Pending decision: export v3 to ONNX and drop TensorFlow from the service.
- L7 (2026-11-11): user: "Sí, a ONNX". Export: direct `model.export(format="onnx")` fails (random augmentation ops); tf2onnx `from_function` leaves captured constants as inputs. Fix: inference-only graph rebuilt from trained layers (densenet121, GAP, prob_fractura) with preprocess_input constants created inside the traced function. ONNX vs .keras max diff 3.9e-7; mirror diff 0. JPEG: `tf.io.decode_image` uses IFAST DCT; `simplejpeg(fastdct=True)` is bit-exact, PIL/cv2 differ up to 9 levels -> classifier uses simplejpeg, YOLO keeps cv2 (as in its notebook). Numpy letterbox vs TF: max 1 level on < 0.4 % pixels. End-to-end notebook pipeline vs API: max |Δp| 1.9e-4. v1 model removed from the tree; `.keras` source ignored.
- L8: Memory. ORT default arena grew to ~1.2 GB; without arena/mem pattern RSS stays ~150 MB but the TTA graph peaked at ~570 MB (both branches alive). Exporting one forward pass and doing TTA in the API with two sequential runs: identical p, full pipeline (2880x2304 JPG) RSS 220 MB stable, peak 338 MB, ~1.3 s per analysis on this PC.
- L9 (2026-11-12): user: "Revisar este cambio". Gentle AI review (resilience + reliability) of 83aa76f..0b301c8 approved and acknowledged (lineage review-d877207870b741da, authority burned). First attempt failed on an expired `claude` CLI OAuth session; relaunched after user login. 11 non-blocking findings recorded as follow-ups: YOLO runtime errors discard the classification; iaRegiones arrayUnion shares the update with lastComment fields; JPEG dual decode (CMYK, cv2 None, EXIF orientation); letterbox zero dimension on extreme aspect ratios; blocking inference in async endpoints; unpinned deps; boxes not clipped; viewer picks the oldest entry; no automated tests.
- L10 (2026-11-14): user: "Sí, corregilos". Added `tests/test_main.py` (17 tests, fake ORT sessions, no model files) + `requirements-dev.txt`. RED observed for 4 findings (extreme aspect ratio, box clipping, YOLO failure isolation, EXIF orientation); CMYK JPEG already decoded by simplejpeg 1.9.0 (kept as regression test). Fixes: `regiones_seguras` wrapper, PIL fallback + `IMREAD_IGNORE_ORIENTATION` + same-shape guard, `max(1, ...)` in letterbox, clipped boxes, sync `def` routes + `INFERENCE_LOCK`, pinned requirements, separate sanitized `iaRegiones` update, viewer picks newest entry by path then by name. GREEN 17/17; e2e parity unchanged (1.9e-4); peak 331 MB; vite build OK.
- L11 (2026-11-14): review of c335a2e (reliability lens, lineage review-e29dcb1f27cbb0e3) approved and acknowledged. Advisory follow-ups: drop zero-area boxes after clipping; make the EXIF test check pixel layout; no JS tests for the controller isolation; viewer `fecha` comparison relies on ISO strings (true today: `new Date().toISOString()`). Branch pushed; PR https://github.com/moarimikashi-vr/ClinicaConIA/pull/1 opened against main (no CI checks configured).
- L12 (2026-11-14): user: "Sí, en vivo". DicomViewer listens to the case document with Firestore onSnapshot (same pattern as CasoDetalle) instead of a one-shot GET, so regions appear when the async analysis finishes. vite build OK; eslint unchanged (7 pre-existing errors).
- L4: Regions are stored as an array `iaRegiones` of `{archivo, nombre, modelo, fecha, prediction, confidence_fracture, regiones}` (array, not a map keyed by path, because Storage paths contain dots and slashes that break Firestore field paths).
