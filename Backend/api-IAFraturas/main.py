import hmac
import io
import os
import re
import threading
import cv2
import numpy as np
import onnxruntime as ort
import pydicom
import simplejpeg
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException, Body, Depends, Header
from fastapi.responses import JSONResponse
import firebase_admin
from firebase_admin import credentials, storage

# ==========================================
# ⚙️ CONFIGURACIÓN DEL PROYECTO
# ==========================================
# Clasificador v3 exportado a ONNX desde modelo_fracturas_v3.keras (tools/export_v3_onnx.py):
# una pasada de DenseNet121 con preprocess_input DENTRO del grafo; su salida es P(fractura).
# El TTA del modelo original (promedio con el espejo horizontal) se hace aquí con dos corridas
# seguidas, que necesitan mucha menos memoria que ambas ramas en un solo grafo.
# Se ejecuta con onnxruntime, sin TensorFlow.
MODEL_FILENAME = 'clasificador_v3.onnx'

# Detector YOLOv8s exportado a ONNX (se ejecuta con onnxruntime, sin Ultralytics).
YOLO_FILENAME = 'yolo_fracturas.onnx'
YOLO_CONF_MIN = 0.25
YOLO_IOU = 0.45
YOLO_SIZE = 640

MODEL_VERSION = 'v3+yolo'

# Umbrales calculados en validación (metricas_v3.json -> umbrales_api)
UMBRAL_SANO = 0.193
UMBRAL_FRACTURA = 0.8152

# Nombre de tu archivo de credenciales de Firebase
CREDENTIALS_FILE = 'credentials.json' 

# Nombre de tu Bucket (búscalo en Firebase Storage, suele ser "proyecto.appspot.com")
# ¡IMPORTANTE! No le pongas "gs://" al principio, solo el dominio.
BUCKET_NAME = 'radiodiagnosticoapp.firebasestorage.app' 

# Tamaño de entrada del clasificador v3 (letterbox, igual que en el entrenamiento)
IMG_SIZE = (448, 448)

# ==========================================
# 🚀 INICIALIZACIÓN
# ==========================================
# Sin /docs ni /openapi.json públicos: el servicio solo lo usa el backend
app = FastAPI(title="API de Radiodiagnóstico (Soporte DICOM)", docs_url=None, redoc_url=None, openapi_url=None)

# 1. Sin CORS: este servicio solo lo llama el backend (servidor a servidor), nunca un navegador.

# Secreto compartido con el backend (variable IA_SERVICE_TOKEN en ambos servicios).
# Sin secreto configurado el servicio rechaza los análisis (falla cerrado).
IA_SERVICE_TOKEN = os.environ.get('IA_SERVICE_TOKEN', '')
if not IA_SERVICE_TOKEN:
    print("[AVISO] IA_SERVICE_TOKEN no esta configurado: los endpoints de analisis responderan 503.")

MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB por estudio
# Solo estudios subidos por la plataforma: casos/<uid>/<nss>/<archivo>
STORAGE_PATH_PATTERN = re.compile(r'^casos/[A-Za-z0-9_-]+/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$')


def require_service_token(x_ia_token: str = Header(default='')):
    """Autoriza solo al backend, que envía el secreto compartido en el encabezado X-IA-Token."""
    if not IA_SERVICE_TOKEN:
        raise HTTPException(503, "Servicio de análisis sin configurar.")
    if not hmac.compare_digest(x_ia_token.encode(), IA_SERVICE_TOKEN.encode()):
        raise HTTPException(401, "No autorizado.")


PROTECTED_PATHS = {"/predict_local", "/analyze_firebase"}


@app.middleware("http")
async def check_service_token_first(request, call_next):
    """Valida el secreto antes de leer el cuerpo: sin token no se parsea JSON ni se acepta una subida."""
    if request.url.path in PROTECTED_PATHS:
        if not IA_SERVICE_TOKEN:
            return JSONResponse(status_code=503, content={"detail": "Servicio de análisis sin configurar."})
        token = request.headers.get("x-ia-token", "")
        if not hmac.compare_digest(token.encode(), IA_SERVICE_TOKEN.encode()):
            return JSONResponse(status_code=401, content={"detail": "No autorizado."})
    return await call_next(request)


# 2. Conectar a Firebase
if not firebase_admin._apps:
    try:
        # Prioridad 1: Variables de Entorno (Producción / Render)
        if os.environ.get('FIREBASE_PRIVATE_KEY'):
            print("🔐 Usando credenciales de ENV VARS...")
            cred_dict = {
                "type": "service_account",
                "project_id": os.environ.get('FIREBASE_PROJECT_ID'),
                "private_key_id": "iso-8859-1", # Opcional
                "private_key": os.environ.get('FIREBASE_PRIVATE_KEY').replace('\\n', '\n'),
                "client_email": os.environ.get('FIREBASE_CLIENT_EMAIL'),
                "client_id": "ignored",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_x509_cert_url": "ignored"
            }
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred, {
                'storageBucket': BUCKET_NAME
            })
            print(f"🔥 Firebase conectado (vía ENV) al bucket: {BUCKET_NAME}")
            
        # Prioridad 2: Archivo local json (Desarrollo)
        elif os.path.exists(CREDENTIALS_FILE):
            cred = credentials.Certificate(CREDENTIALS_FILE)
            firebase_admin.initialize_app(cred, {
                'storageBucket': BUCKET_NAME
            })
            print(f"🔥 Firebase conectado (vía JSON) al bucket: {BUCKET_NAME}")
        else:
            print("⚠️ ADVERTENCIA: No se encontraron credenciales (ni ENV ni JSON). La IA no podrá descargar imágenes.")
    except Exception as e:
        print(f"❌ Error conectando Firebase: {e}")

# 3. Cargar el Modelo de IA
# Sin arena de memoria: onnxruntime devuelve la memoria de cada inferencia en lugar de
# reservarla (con arena el proceso crecía a ~1.2 GB; sin ella queda en ~150 MB).
ORT_OPTIONS = ort.SessionOptions()
ORT_OPTIONS.enable_cpu_mem_arena = False
ORT_OPTIONS.enable_mem_pattern = False
INFERENCE_LOCK = threading.Lock()

print("🧠 Cargando cerebro digital...")
try:
    if os.path.exists(MODEL_FILENAME):
        MODEL = ort.InferenceSession(MODEL_FILENAME, ORT_OPTIONS, providers=['CPUExecutionProvider'])
        print("✅ Modelo cargado exitosamente.")
    else:
        print(f"❌ ERROR CRÍTICO: No encuentro el archivo '{MODEL_FILENAME}'")
        MODEL = None
except Exception as e:
    print(f"❌ Error fatal cargando modelo: {e}")
    MODEL = None

# 4. Cargar el detector YOLO (ONNX). Si falta, la API sigue clasificando sin regiones.
try:
    if os.path.exists(YOLO_FILENAME):
        YOLO_SESSION = ort.InferenceSession(YOLO_FILENAME, ORT_OPTIONS, providers=['CPUExecutionProvider'])
        print("✅ Detector YOLO cargado.")
    else:
        print(f"⚠️ No encuentro '{YOLO_FILENAME}': se responderá sin regiones.")
        YOLO_SESSION = None
except Exception as e:
    print(f"❌ Error cargando detector YOLO: {e}")
    YOLO_SESSION = None

# ==========================================
# 🛠️ FUNCIONES DE PROCESAMIENTO
# ==========================================

def process_dicom(dicom_bytes):
    """Convierte un archivo DICOM crudo a una matriz RGB uint8 (alto, ancho, 3)."""
    try:
        # Leer estructura DICOM
        ds = pydicom.dcmread(io.BytesIO(dicom_bytes))

        # Extraer matriz de píxeles
        img_array = ds.pixel_array.astype(float)

        # NORMALIZACIÓN DINÁMICA (Windowing automático)
        # Convierte los 16-bits del hospital a 8-bits para la IA
        scaled_img = (np.maximum(img_array, 0) / img_array.max()) * 255.0
        scaled_img = np.uint8(scaled_img)

        # Asegurar RGB (por si viene en escala de grises simple)
        if scaled_img.ndim == 2:
            scaled_img = np.stack([scaled_img] * 3, axis=-1)

        return scaled_img
    except Exception as e:
        print(f"Error interno procesando DICOM: {e}")
        return None


def decode_image(image_bytes, filename):
    """Devuelve (img_clasificador, img_yolo): matrices RGB uint8 (alto, ancho, 3) del mismo tamaño.

    Cada modelo recibe la imagen decodificada como en su entrenamiento: el notebook v3 usó
    tf.io.decode_image (JPEG con DCT rápida "IFAST", que simplejpeg reproduce bit a bit) y
    YOLO usó cv2.imread (DCT precisa). En DICOM y PNG ambas son la misma matriz.
    Las coordenadas de las regiones se expresan en píxeles de esta matriz, el mismo sistema
    que usa el visor (cornerstone) para el DICOM.
    """
    if filename.lower().endswith('.dcm'):
        print(f"🩻 Procesando radiografía DICOM: {filename}")
        img_rgb = process_dicom(image_bytes)
        if img_rgb is None:
            raise ValueError("El archivo DICOM está corrupto o tiene compresión no soportada.")
        return img_rgb, img_rgb

    if simplejpeg.is_jpeg(image_bytes):
        try:
            img_clasificador = simplejpeg.decode_jpeg(image_bytes, colorspace='RGB', fastdct=True, fastupsample=False)
        except Exception as e:
            print(f"⚠️ simplejpeg no pudo decodificar ({e}); se usa PIL.")
            img_clasificador = np.asarray(Image.open(io.BytesIO(image_bytes)).convert('RGB'))
        # Se ignora la orientación EXIF (como tf.io.decode_image) para que ambos modelos y las
        # coordenadas guardadas compartan el mismo marco de píxeles.
        img_bgr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8),
                               cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img_bgr is None or img_bgr.shape != img_clasificador.shape:
            return img_clasificador, img_clasificador
        return img_clasificador, cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    img_rgb = np.asarray(Image.open(io.BytesIO(image_bytes)).convert('RGB'))
    return img_rgb, img_rgb


def prepare_image(img_rgb):
    """Letterbox a 448x448 equivalente a tf.image.resize_with_pad + round/clip/uint8 del notebook v3.

    Mismo cálculo de escala y relleno que TensorFlow (en float32) y bilineal con centros de
    píxel desplazados medio píxel; difiere de TF en a lo más 1 nivel de gris en < 0.4 % de los
    píxeles. Sin preprocess_input: va dentro del modelo.
    """
    h, w = img_rgb.shape[:2]
    size = IMG_SIZE[0]
    f32 = np.float32
    ratio = max(f32(w) / f32(size), f32(h) / f32(size))
    rh_f, rw_f = f32(h) / ratio, f32(w) / ratio
    # max(1, ...): una imagen extremadamente alargada no puede quedar con un lado de 0 px
    rh, rw = max(1, int(np.floor(rh_f))), max(1, int(np.floor(rw_f)))
    top = max(0, int(np.floor((f32(size) - rh_f) / f32(2))))
    left = max(0, int(np.floor((f32(size) - rw_f) / f32(2))))
    lienzo = np.zeros((size, size, 3), np.float32)  # relleno negro
    lienzo[top:top + rh, left:left + rw] = cv2.resize(img_rgb.astype(np.float32), (rw, rh),
                                                      interpolation=cv2.INTER_LINEAR)
    lienzo = np.clip(np.round(lienzo), 0, 255).astype(np.uint8).astype(np.float32)
    return lienzo[None]  # batch de 1, NHWC, valores 0-255


def detectar_fracturas(img_rgb, conf_min=YOLO_CONF_MIN, iou=YOLO_IOU, size=YOLO_SIZE):
    """Copia de la función verificada en Detector_Fracturas_YOLO.ipynb (sección 9).

    Devuelve [{confianza, x0, y0, x1, y1}] en píxeles de la imagen original, ordenada por confianza.
    A diferencia del notebook, las cajas se recortan a los bordes de la imagen (las que tocan el
    relleno gris del letterbox darían coordenadas negativas o fuera de rango).
    """
    if YOLO_SESSION is None:
        return []
    h0, w0 = img_rgb.shape[:2]
    s = min(size / h0, size / w0); nh, nw = int(round(h0 * s)), int(round(w0 * s))
    lienzo = np.full((size, size, 3), 114, np.uint8)                       # letterbox como Ultralytics
    top, left = (size - nh) // 2, (size - nw) // 2
    lienzo[top:top + nh, left:left + nw] = cv2.resize(img_rgb, (nw, nh), interpolation=cv2.INTER_LINEAR)
    x = lienzo.transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    salida = YOLO_SESSION.run(None, {YOLO_SESSION.get_inputs()[0].name: x})[0][0]  # (5, 8400): cx, cy, w, h, conf
    cx, cy, w, h, conf = salida
    keep = conf >= conf_min
    cajas = np.stack([cx - w / 2, cy - h / 2, w, h], axis=1)[keep]; conf = conf[keep]
    if len(conf) == 0:
        return []
    idx = cv2.dnn.NMSBoxes(cajas.tolist(), conf.tolist(), conf_min, iou)
    def a_original(v, desplazamiento, limite):
        return round(float(np.clip((v - desplazamiento) / s, 0, limite)), 1)

    resultado = []
    for i in np.array(idx).flatten():
        x0, y0, bw, bh = cajas[i]
        resultado.append({'confianza': round(float(conf[i]), 4),
                          'x0': a_original(x0, left, w0), 'y0': a_original(y0, top, h0),
                          'x1': a_original(x0 + bw, left, w0), 'y1': a_original(y0 + bh, top, h0)})
    return sorted(resultado, key=lambda c: -c['confianza'])


def regiones_seguras(img_rgb):
    """El detector solo sugiere dónde mirar: si falla, se responde sin regiones y la
    clasificación ya calculada no se pierde."""
    try:
        return detectar_fracturas(img_rgb)
    except Exception as e:
        print(f"⚠️ Detector YOLO falló, se responde sin regiones: {e}")
        return []


def get_prediction_logic(imagenes, filename_display):
    """Clasificación v3 + regiones sugeridas por YOLO. `imagenes` es la salida de decode_image."""
    img_clasificador, img_yolo = imagenes

    # Inferencia del clasificador con TTA: promedio de P(fractura) de la imagen y su espejo
    x = prepare_image(img_clasificador)
    nombre = MODEL.get_inputs()[0].name
    p_imagen = MODEL.run(None, {nombre: x})[0]
    p_espejo = MODEL.run(None, {nombre: x[:, :, ::-1].copy()})[0]
    score = float((p_imagen[0][0] + p_espejo[0][0]) / 2.0)
    probability_fracture = score

    # UMBRALES DE DECISIÓN (zona de revisión entre ambos)
    label = "REVISIÓN REQUERIDA"
    status_code = "WARNING"

    if probability_fracture > UMBRAL_FRACTURA:
        label = "FRACTURA DETECTADA"
        status_code = "DANGER"
    elif probability_fracture < UMBRAL_SANO:
        label = "SANO"
        status_code = "SUCCESS"

    return {
        "filename": filename_display,
        "prediction": label,
        "status": status_code, # Útil para poner colores en tu Frontend (Rojo/Verde)
        "confidence_fracture": round(probability_fracture * 100, 2),
        "raw_score_model": score,
        "analysis_note": "IA sugiere revisión manual." if status_code == "WARNING" else "IA con alta confianza.",
        # Sugerencias de dónde mirar: no confirman la fractura y su ausencia no la descarta
        "regiones": regiones_seguras(img_yolo),
        "image_size": {"width": int(img_yolo.shape[1]), "height": int(img_yolo.shape[0])},
        "model_version": MODEL_VERSION,
    }

# ==========================================
# 📡 ENDPOINTS (RUTAS DE LA API)
# ==========================================

@app.get("/")
def home():
    return {
        "status": "online",
        "model": MODEL_FILENAME,
        "detector": YOLO_FILENAME if YOLO_SESSION is not None else None,
        "model_version": MODEL_VERSION,
        "support": "JPG, PNG, DICOM",
    }

def analizar(image_bytes, filename):
    """Decodifica y analiza una imagen, una a la vez.

    Las rutas son `def` (no `async def`): FastAPI las corre en su pool de hilos y la inferencia
    (~1 s de CPU) no bloquea el event loop. El candado mantiene una sola inferencia en curso
    para que el pico de memoria no se multiplique con peticiones simultáneas.
    """
    with INFERENCE_LOCK:
        return get_prediction_logic(decode_image(image_bytes, filename), filename)


# --- RUTA 1: Para pruebas rápidas (requiere el mismo secreto que el backend) ---
@app.post("/predict_local", dependencies=[Depends(require_service_token)])
def predict_local(file: UploadFile = File(...)):
    if MODEL is None: raise HTTPException(500, "Modelo no cargado.")

    contents = file.file.read(MAX_FILE_BYTES + 1)
    if len(contents) > MAX_FILE_BYTES:
        raise HTTPException(413, "El archivo supera el tamaño máximo de 50 MB.")
    try:
        return analizar(contents, file.filename)
    except Exception as e:
        print(f"Error analizando imagen local: {e}")
        raise HTTPException(500, "No se pudo analizar la imagen.")

# --- RUTA 2: Para tu sistema real (Conexión Firebase) ---
@app.post("/analyze_firebase", dependencies=[Depends(require_service_token)])
def analyze_firebase(payload: dict = Body(...)):
    """
    Recibe un JSON: { "path": "casos/<uid>/<nss>/<archivo>.dcm" }
    Descarga el archivo de Firebase y lo analiza.
    """
    if MODEL is None: raise HTTPException(500, "Modelo no cargado.")

    file_path = payload.get("path")
    if not isinstance(file_path, str) or not file_path:
        raise HTTPException(400, "Falta el campo 'path' en el JSON.")
    if not STORAGE_PATH_PATTERN.fullmatch(file_path) or '..' in file_path.split('/'):
        raise HTTPException(400, "Ruta de estudio no válida.")

    print(f"📥 Solicitando a Firebase: {file_path}")

    try:
        bucket = storage.bucket()
        blob = bucket.get_blob(file_path)
    except Exception as e:
        print(f"Error Firebase: {e}")
        raise HTTPException(502, "No se pudo consultar el almacenamiento.")
    if blob is None:
        raise HTTPException(404, "El estudio no existe.")
    if blob.size is not None and blob.size > MAX_FILE_BYTES:
        raise HTTPException(413, "El estudio supera el tamaño máximo de 50 MB.")

    try:
        # Descargar a memoria RAM (sin guardar en disco) y analizar
        image_bytes = blob.download_as_bytes()
        return analizar(image_bytes, file_path)
    except Exception as e:
        print(f"Error Firebase/Procesamiento: {e}")
        raise HTTPException(422, "No se pudo procesar la imagen.")
