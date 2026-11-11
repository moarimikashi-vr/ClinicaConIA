import io
import os
import cv2
import numpy as np
import onnxruntime as ort
import tensorflow as tf
import keras
import pydicom
from fastapi import FastAPI, File, UploadFile, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
import firebase_admin
from firebase_admin import credentials, storage

# ==========================================
# ⚙️ CONFIGURACIÓN DEL PROYECTO
# ==========================================
# Clasificador v3: DenseNet121 con preprocess_input y TTA (imagen + espejo) DENTRO del modelo.
# Su salida es directamente P(fractura).
MODEL_FILENAME = 'modelo_fracturas_v3.keras'

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
app = FastAPI(title="API de Radiodiagnóstico (Soporte DICOM)")

# 1. Configurar CORS (Permitir peticiones desde tu Frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
print("🧠 Cargando cerebro digital...")
try:
    if os.path.exists(MODEL_FILENAME):
        MODEL = keras.models.load_model(MODEL_FILENAME)
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
        YOLO_SESSION = ort.InferenceSession(YOLO_FILENAME, providers=['CPUExecutionProvider'])
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
    """Devuelve la imagen original como matriz RGB uint8 (alto, ancho, 3).

    Las coordenadas de las regiones de YOLO se expresan en píxeles de esta matriz,
    que es el mismo sistema que usa el visor (cornerstone) para el DICOM.
    """
    if filename.lower().endswith('.dcm'):
        print(f"🩻 Procesando radiografía DICOM: {filename}")
        img_rgb = process_dicom(image_bytes)
        if img_rgb is None:
            raise ValueError("El archivo DICOM está corrupto o tiene compresión no soportada.")
        return img_rgb

    # JPG/PNG: mismo decodificador que el notebook de entrenamiento v3
    return tf.io.decode_image(image_bytes, channels=3, expand_animations=False).numpy()


def prepare_image(img_rgb):
    """Letterbox a 448x448 igual que el notebook v3 (sin preprocess_input: va dentro del modelo)."""
    img = tf.image.resize_with_pad(img_rgb, IMG_SIZE[0], IMG_SIZE[1])  # bilineal, centrado, relleno negro
    img = tf.cast(tf.clip_by_value(tf.round(img), 0, 255), tf.uint8)
    img = tf.cast(img, tf.float32)
    return tf.expand_dims(img, 0)  # batch de 1


def detectar_fracturas(img_rgb, conf_min=YOLO_CONF_MIN, iou=YOLO_IOU, size=YOLO_SIZE):
    """Copia de la función verificada en Detector_Fracturas_YOLO.ipynb (sección 9).

    Devuelve [{confianza, x0, y0, x1, y1}] en píxeles de la imagen original, ordenada por confianza.
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
    resultado = []
    for i in np.array(idx).flatten():
        x0, y0, bw, bh = cajas[i]
        resultado.append({'confianza': round(float(conf[i]), 4),
                          'x0': round(float((x0 - left) / s), 1), 'y0': round(float((y0 - top) / s), 1),
                          'x1': round(float((x0 + bw - left) / s), 1), 'y1': round(float((y0 + bh - top) / s), 1)})
    return sorted(resultado, key=lambda c: -c['confianza'])


def get_prediction_logic(img_rgb, filename_display):
    """Clasificación v3 + regiones sugeridas por YOLO."""

    # Inferencia del clasificador: la salida YA es P(fractura) (promedio con el espejo)
    prediction = MODEL.predict(prepare_image(img_rgb), verbose=0)
    score = float(prediction[0][0])
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
        "regiones": detectar_fracturas(img_rgb),
        "image_size": {"width": int(img_rgb.shape[1]), "height": int(img_rgb.shape[0])},
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

# --- RUTA 1: Para pruebas rápidas desde tu PC ---
@app.post("/predict_local")
async def predict_local(file: UploadFile = File(...)):
    if MODEL is None: raise HTTPException(500, "Modelo no cargado.")

    try:
        contents = await file.read()
        img_rgb = decode_image(contents, file.filename)
        return get_prediction_logic(img_rgb, file.filename)
    except Exception as e:
        raise HTTPException(500, f"Error analizando imagen: {str(e)}")

# --- RUTA 2: Para tu sistema real (Conexión Firebase) ---
@app.post("/analyze_firebase")
async def analyze_firebase(payload: dict = Body(...)):
    """
    Recibe un JSON: { "path": "pacientes/juan/radio_torax.dcm" }
    Descarga el archivo de Firebase y lo analiza.
    """
    if MODEL is None: raise HTTPException(500, "Modelo no cargado.")

    file_path = payload.get("path")
    if not file_path:
        raise HTTPException(400, "Falta el campo 'path' en el JSON.")

    print(f"📥 Solicitando a Firebase: {file_path}")

    try:
        # Acceder al Bucket
        bucket = storage.bucket()
        blob = bucket.blob(file_path)

        # Descargar a memoria RAM (sin guardar en disco)
        image_bytes = blob.download_as_bytes()

        # Procesar (pasamos path para detectar extensión) y predecir
        img_rgb = decode_image(image_bytes, file_path)
        return get_prediction_logic(img_rgb, file_path)

    except Exception as e:
        print(f"Error Firebase/Procesamiento: {e}")
        # Retornamos error 404 si no existe la imagen, o 500 si falló el análisis
        raise HTTPException(404, detail=f"No se pudo procesar la imagen: {str(e)}")
