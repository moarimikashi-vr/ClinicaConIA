"""Tests for the IA microservice (main.py). They use fake ONNX sessions, so no model files are needed.

Run from Backend/api-IAFraturas:  pip install -r requirements-dev.txt && python -m pytest tests -q
"""
import importlib.util
import io
import os
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

API_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def main(tmp_path_factory):
    # Import from an empty cwd so the real model files are not loaded
    cwd = os.getcwd()
    os.chdir(tmp_path_factory.mktemp("cwd"))
    try:
        spec = importlib.util.spec_from_file_location("ia_main", API_DIR / "main.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        os.chdir(cwd)
    assert module.MODEL is None and module.YOLO_SESSION is None
    return module


class _Input:
    name = "imagen"


class FakeClassifier:
    """Returns p_left when the left half of the letterboxed input is the brighter one, else p_right."""

    def __init__(self, p_left, p_right=None):
        self.p_left, self.p_right = p_left, p_left if p_right is None else p_right
        self.shapes = []

    def get_inputs(self):
        return [_Input()]

    def run(self, _, feed):
        x = feed["imagen"]
        self.shapes.append(x.shape)
        left_brighter = x[0, :, :224].mean() >= x[0, :, 224:].mean()
        return [np.array([[self.p_left if left_brighter else self.p_right]], np.float32)]


class FakeYolo:
    def __init__(self, salida=None, error=None):
        self.salida, self.error = salida, error

    def get_inputs(self):
        return [_Input()]

    def run(self, _, feed):
        if self.error:
            raise self.error
        return [self.salida]


@pytest.fixture
def fakes(main, monkeypatch):
    def install(classifier=None, yolo=None):
        monkeypatch.setattr(main, "MODEL", classifier or FakeClassifier(0.5))
        monkeypatch.setattr(main, "YOLO_SESSION", yolo)
    return install


def jpeg_bytes(img, **save_kwargs):
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, "JPEG", **save_kwargs)
    return buf.getvalue()


# --- Classification: thresholds and TTA ---------------------------------------------------

@pytest.mark.parametrize("p, label, status", [
    (0.10, "SANO", "SUCCESS"),
    (0.193, "REVISIÓN REQUERIDA", "WARNING"),
    (0.50, "REVISIÓN REQUERIDA", "WARNING"),
    (0.8152, "REVISIÓN REQUERIDA", "WARNING"),
    (0.90, "FRACTURA DETECTADA", "DANGER"),
])
def test_thresholds_use_probability_of_fracture_directly(main, fakes, p, label, status):
    fakes(FakeClassifier(p))
    img = np.zeros((613, 397, 3), np.uint8)
    out = main.get_prediction_logic((img, img), "x.jpg")
    assert (out["prediction"], out["status"]) == (label, status)
    assert out["confidence_fracture"] == round(p * 100, 2)
    assert out["model_version"] == "v3+yolo"
    assert out["image_size"] == {"width": 397, "height": 613}
    assert out["regiones"] == []


def test_tta_averages_image_and_horizontal_mirror(main, fakes):
    clf = FakeClassifier(p_left=0.9, p_right=0.1)
    fakes(clf)
    img = np.zeros((448, 448, 3), np.uint8)
    img[:, :224] = 255  # left half bright; the mirror has the right half bright
    out = main.get_prediction_logic((img, img), "x.png")
    assert out["raw_score_model"] == pytest.approx(0.5)
    assert clf.shapes == [(1, 448, 448, 3), (1, 448, 448, 3)]


# --- Letterbox ------------------------------------------------------------------------------

def test_letterbox_matches_tf_resize_with_pad_geometry(main):
    x = main.prepare_image(np.full((613, 397, 3), 200, np.uint8))
    assert x.shape == (1, 448, 448, 3) and x.dtype == np.float32
    cols = np.where(x[0, 224, :, 0] > 0)[0]
    # width floor(397 * 448 / 613) = 290, left padding floor((448 - 290.14) / 2) = 78
    assert (cols.min(), cols.max()) == (78, 78 + 290 - 1)
    assert x[0, 0, 0, 0] == 0 and x[0, 224, 200, 0] == 200


def test_letterbox_survives_extreme_aspect_ratio(main):
    x = main.prepare_image(np.full((2000, 1, 3), 255, np.uint8))
    assert x.shape == (1, 448, 448, 3)
    assert x.max() == 255  # the thin strip is still there


# --- YOLO regions -------------------------------------------------------------------------

def yolo_output(*boxes):
    """Boxes as (cx, cy, w, h, conf) in letterboxed 640 coordinates -> raw (1, 5, 8400) output."""
    salida = np.zeros((1, 5, 8400), np.float32)
    for i, caja in enumerate(boxes):
        salida[0, :, i] = caja
    return salida


def test_regions_are_mapped_back_to_original_pixels(main, fakes):
    # 400x800 image -> scale 0.8, letterbox 640x320 with top padding 160
    fakes(yolo=FakeYolo(yolo_output((160, 240, 160, 80, 0.9), (500, 300, 50, 50, 0.1))))
    regiones = main.detectar_fracturas(np.zeros((400, 800, 3), np.uint8))
    assert regiones == [{"confianza": 0.9, "x0": 100.0, "y0": 50.0, "x1": 300.0, "y1": 150.0}]


def test_regions_are_clipped_to_the_image(main, fakes):
    # Box that reaches 20 px into the top padding and 10 px past the right edge
    fakes(yolo=FakeYolo(yolo_output((600, 176, 96, 64, 0.8))))
    (region,) = main.detectar_fracturas(np.zeros((400, 800, 3), np.uint8))
    assert region["y0"] == 0.0 and region["x1"] == 800.0
    assert region["x0"] == pytest.approx(690.0) and region["y1"] == pytest.approx(60.0)


def test_detector_failure_keeps_the_classification(main, fakes):
    fakes(FakeClassifier(0.9), FakeYolo(error=RuntimeError("onnx failure")))
    img = np.zeros((400, 800, 3), np.uint8)
    out = main.get_prediction_logic((img, img), "x.jpg")
    assert out["prediction"] == "FRACTURA DETECTADA"
    assert out["regiones"] == []


# --- Decoding -----------------------------------------------------------------------------

def test_png_is_decoded_exactly_and_shared(main):
    gray = np.tile(np.linspace(0, 255, 397).astype(np.uint8), (613, 1))
    a, b = main.decode_image(cv2.imencode(".png", gray)[1].tobytes(), "x.png")
    assert a is b and np.array_equal(a[..., 0], gray)


def test_cmyk_jpeg_is_decoded(main):
    buf = io.BytesIO()
    Image.new("CMYK", (120, 80), (0, 0, 0, 40)).save(buf, "JPEG")
    a, b = main.decode_image(buf.getvalue(), "x.jpg")
    assert a.shape == b.shape == (80, 120, 3) and a.dtype == np.uint8


def test_exif_orientation_does_not_split_the_two_frames(main):
    img = np.zeros((80, 120, 3), np.uint8)
    exif = Image.Exif()
    exif[0x0112] = 6  # "rotate 90 CW" flag
    a, b = main.decode_image(jpeg_bytes(img, exif=exif), "x.jpg")
    # Both models and the stored coordinates use the raw pixel frame (as tf.io.decode_image does)
    assert a.shape == b.shape == (80, 120, 3)


# --- Endpoints ----------------------------------------------------------------------------

def test_home_reports_versions(main):
    body = TestClient(main.app).get("/").json()
    assert body["status"] == "online" and body["model_version"] == "v3+yolo"


TOKEN = {"X-IA-Token": "test-secret"}


@pytest.fixture
def service_token(main, monkeypatch):
    monkeypatch.setattr(main, "IA_SERVICE_TOKEN", "test-secret")


def test_predict_without_model_returns_500(main, service_token):
    r = TestClient(main.app).post("/predict_local", files={"file": ("x.png", b"123", "image/png")}, headers=TOKEN)
    assert r.status_code == 500


def test_predict_local_returns_classification_and_regions(main, fakes, service_token):
    fakes(FakeClassifier(0.1), FakeYolo(yolo_output((160, 240, 160, 80, 0.9))))
    png = cv2.imencode(".png", np.zeros((400, 800), np.uint8))[1].tobytes()
    r = TestClient(main.app).post("/predict_local", files={"file": ("x.png", png, "image/png")}, headers=TOKEN)
    body = r.json()
    assert r.status_code == 200
    assert body["prediction"] == "SANO" and len(body["regiones"]) == 1


# --- Service authentication and input limits ---------------------------------------------

@pytest.mark.parametrize("route, kwargs", [
    ("/predict_local", {"files": {"file": ("x.png", b"123", "image/png")}}),
    ("/analyze_firebase", {"json": {"path": "casos/u1/123/a.dcm"}}),
])
def test_analysis_endpoints_require_the_service_token(main, fakes, service_token, route, kwargs):
    fakes(FakeClassifier(0.1))
    client = TestClient(main.app)
    assert client.post(route, **kwargs).status_code == 401
    assert client.post(route, headers={"X-IA-Token": "wrong"}, **kwargs).status_code == 401


def test_analysis_is_refused_when_no_token_is_configured(main, fakes, monkeypatch):
    fakes(FakeClassifier(0.1))
    monkeypatch.setattr(main, "IA_SERVICE_TOKEN", "")
    r = TestClient(main.app).post("/analyze_firebase", json={"path": "casos/u1/123/a.dcm"}, headers={"X-IA-Token": ""})
    assert r.status_code == 503


@pytest.mark.parametrize("path", [
    "pacientes/u1/123/a.dcm", "casos/u1/123/../../secret.dcm", "casos/u1/123/sub/a.dcm", "casos/u1/a.dcm", "", 123,
    "casos/u1/123/a.dcm" + chr(10),  # trailing newline
])
def test_analyze_firebase_only_accepts_study_paths(main, fakes, service_token, path):
    fakes(FakeClassifier(0.1))
    r = TestClient(main.app).post("/analyze_firebase", json={"path": path}, headers=TOKEN)
    assert r.status_code == 400


def test_predict_local_rejects_files_over_the_size_limit(main, fakes, service_token, monkeypatch):
    fakes(FakeClassifier(0.1))
    monkeypatch.setattr(main, "MAX_FILE_BYTES", 10)
    r = TestClient(main.app).post("/predict_local", files={"file": ("x.png", b"0" * 11, "image/png")}, headers=TOKEN)
    assert r.status_code == 413


def test_no_wildcard_cors_headers(main):
    r = TestClient(main.app).get("/", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_token_is_checked_before_the_body_is_parsed(main, service_token):
    client = TestClient(main.app)
    r = client.post("/analyze_firebase", content=b"{not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 401
    assert "detail" not in r.text or "json" not in r.text.lower()


def test_api_schema_and_docs_are_not_public(main):
    client = TestClient(main.app)
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/docs").status_code == 404
