"""Export the v3 classifier (modelo_fracturas_v3.keras) to ONNX and verify parity.

The exported graph is ONE forward pass: DenseNet121 preprocess_input + backbone + head.
Input is the 448x448 letterboxed RGB image as float32 in [0, 255] (NHWC); output is
P(fracture) for that single view. The TTA of the Keras model (average with the horizontal
mirror) is done by the API with two sequential runs: keeping both branches in one graph
made onnxruntime hold the activations of both at once (~570 MB peak vs ~180 MB).

This script needs TensorFlow, so it is NOT part of the service requirements:

    pip install tensorflow==2.21.0 keras==3.13.2 tf2onnx onnx onnxruntime
    python tools/export_v3_onnx.py --keras modelo_fracturas_v3.keras --out clasificador_v3.onnx
"""
import argparse
import sys

import numpy as np
import onnxruntime as ort
import tensorflow as tf
import keras
import tf2onnx

IMG_SIZE = 448
TOLERANCE = 1e-4


def sample_batch(rng, n):
    """Radiograph-like images (smooth structures plus noise) and a few edge cases."""
    imgs = []
    for _ in range(n):
        base = rng.normal(0, 1, (IMG_SIZE // 8, IMG_SIZE // 8)).astype(np.float32)
        smooth = tf.image.resize(base[..., None], (IMG_SIZE, IMG_SIZE), method="bicubic").numpy()[..., 0]
        img = np.clip(110 + 55 * smooth + rng.normal(0, 12, smooth.shape), 0, 255)
        imgs.append(np.repeat(np.round(img)[..., None], 3, axis=-1))
    imgs.append(np.zeros((IMG_SIZE, IMG_SIZE, 3)))
    imgs.append(np.full((IMG_SIZE, IMG_SIZE, 3), 255.0))
    return np.stack(imgs).astype(np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keras", default="modelo_fracturas_v3.keras")
    parser.add_argument("--out", default="clasificador_v3.onnx")
    parser.add_argument("--samples", type=int, default=24)
    args = parser.parse_args()

    model = keras.models.load_model(args.keras)  # includes TTA: the reference output
    spec = (tf.TensorSpec((None, IMG_SIZE, IMG_SIZE, 3), tf.float32, name="imagen"),)

    # Inference-only graph rebuilt from the trained layers. A direct export drags the
    # random augmentation layers (unsupported by onnxruntime) and leaves the
    # preprocess_input constants as dangling inputs, so they are written explicitly.
    inner = model.get_layer("clasificador")
    base = inner.get_layer("densenet121")
    gap = inner.get_layer("global_average_pooling2d")
    head = inner.get_layer("prob_fractura")

    @tf.function(input_signature=spec)
    def serve(imagen):
        # Constants must be created inside the traced function: captured eager tensors
        # are exported by tf2onnx as missing graph inputs.
        mean = tf.constant([0.485, 0.456, 0.406], tf.float32)
        std = tf.constant([0.229, 0.224, 0.225], tf.float32)
        x = (imagen / 255.0 - mean) / std  # keras.applications.densenet.preprocess_input ("torch" mode)
        return {"prob_fractura": head(gap(base(x, training=False)))}

    tf2onnx.convert.from_function(serve, input_signature=spec, opset=17, output_path=args.out)

    sess = ort.InferenceSession(args.out, providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name

    def p_tta(img):  # exactly what the API does: two sequential runs, image and mirror
        return (sess.run(None, {name: img[None]})[0] + sess.run(None, {name: img[None, :, ::-1].copy()})[0])[0, 0] / 2

    x = sample_batch(np.random.default_rng(42), args.samples)
    p_keras = model.predict(x, verbose=0).ravel()
    p_onnx = np.array([p_tta(img) for img in x])
    diff = float(np.max(np.abs(p_keras - p_onnx)))

    print(f"inputs={[(i.name, i.shape) for i in sess.get_inputs()]} outputs={[(o.name, o.shape) for o in sess.get_outputs()]}")
    print(f"P(fracture) range keras: {p_keras.min():.4f}..{p_keras.max():.4f}")
    print(f"max |keras(TTA) - mean(onnx(x), onnx(mirror x))| = {diff:.2e} (tolerance {TOLERANCE:.0e})")
    sys.exit(0 if diff <= TOLERANCE else 1)


if __name__ == "__main__":
    main()
