"""
app.py — YOLO26 Multi-Vision Explorer v2 (Triple 16:9 & Projection-Ready)
==========================================================================
Servidor de Visión Computacional para Demostraciones y Proyecciones en Auditorios:
- Malla Triple 16:9 interactiva con ranura principal/destacada intercambiable (Pose, Seg, Depth).
- Vistas individuales en formato panorámico 16:9 (1280x720).
- Vista de Proyección dedicada (/projection) optimizada para proyectores HDMI y pantallas 16:9.
- Perfiles de rendimiento para notebooks (Eco Batería, Equilibrado, Alto Rendimiento, Estudio).
"""

import os
import sys
import time
import uuid
import socket
import threading
import signal
import cv2
import numpy as np
import torch
from flask import Flask, render_template, Response, request, jsonify
from ultralytics import YOLO

app = Flask(__name__)

# Configurar hilos de CPU para notebooks
if torch.get_num_threads() > 4:
    torch.set_num_threads(4)

# Optimizar OpenCV
cv2.setUseOptimized(True)

# --- RUTAS DE MODELOS ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SHARED_DIR = os.path.join(BASE_DIR, "..", "app_dual_yolo26")

def resolve_model_path(model_filename, fallback_filename=None):
    candidates = [
        os.path.join(BASE_DIR, model_filename),
        os.path.join(SHARED_DIR, model_filename),
        os.path.join(BASE_DIR, fallback_filename or ""),
        os.path.join(SHARED_DIR, fallback_filename or "")
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return os.path.abspath(p)
    return model_filename

POSE_PATH = resolve_model_path("yolo26n-pose.pt", "yolo11n-pose.pt")
SEG_PATH = resolve_model_path("yolo26n-seg.pt", "yolo11n-seg.pt")
DEPTH_PATH = resolve_model_path("yolo26n-depth.pt")

print(f"📦 [YOLO26 v2] Modelos:\n  - Pose:  {POSE_PATH}\n  - Seg:   {SEG_PATH}\n  - Depth: {DEPTH_PATH}")

# --- CANDADOS Y MULTIHILO ---
STATE_LOCK = threading.Lock()
is_running = True
camera_cap = None

# --- MODELOS EN MEMORIA ---
MODELS = {
    "pose": None,
    "seg": None,
    "depth": None
}

# CPU optimizada para máxima estabilidad
device = "cpu"

# --- PERFILES DE RENDIMIENTO PARA NOTEBOOKS ---
PERFORMANCE_PROFILES = {
    "eco": {
        "name": "🍃 Notebook Eco (Batería)",
        "inference_size": 192,
        "frame_skip": 2,
        "description": "Máxima fluidez en CPUs de bajo consumo (~35-45 FPS)"
    },
    "balanced": {
        "name": "⚡ Notebook Equilibrado (Recomendado)",
        "inference_size": 256,
        "frame_skip": 1,
        "description": "Excelente balance entre precisión y velocidad (~25-35 FPS)"
    },
    "high": {
        "name": "🚀 Alto Rendimiento (Enchufe)",
        "inference_size": 384,
        "frame_skip": 1,
        "description": "Mayor definición de polígonos y keypoints"
    },
    "studio": {
        "name": "🎯 Estudio / Precisión Máxima",
        "inference_size": 480,
        "frame_skip": 1,
        "description": "Máxima resolución de detección"
    }
}

# --- CONFIGURACIÓN GLOBAL ---
CONFIG = {
    "profile": "balanced",
    "inference_size": 256,
    "frame_skip": 1,
    "camera_id": 0,
    "flip_horizontal": True,
    "high_contrast_theme": "dark", # 'dark' | 'light'
    "conf_pose": 0.40,
    "conf_seg": 0.40,
    "mask_alpha": 0.45,
    "depth_alpha": 0.65,
    "depth_colormap": "INFERNO",   # 'INFERNO' | 'TURBO' | 'MAGMA' | 'VIRIDIS' | 'JET' | 'GRAY'
    "view_mode": "triple",         # 'triple' | 'pose' | 'seg' | 'depth'
    "triple_main": "pose",         # 'pose' | 'seg' | 'depth' (Ranura grande en malla 16:9)
    "show_boxes_pose": True,
    "show_skeleton": True,
    "show_boxes_seg": True,
    "show_masks_seg": True,
    "frozen": False,               # Pausa / Freeze para explicar al público
    "contrast_boost": True,        # Doble trazo para visibilidad en proyector
    "models_loaded": False,
}

# --- ESTADO COMPARTIDO ---
STATE = {
    "fps_overall": 0.0,
    "ms_pose": 0.0,
    "ms_seg": 0.0,
    "ms_depth": 0.0,
    "pose_count": 0,
    "seg_count": 0,
    "depth_min": 0.0,
    "depth_max": 0.0,
    "seg_classes": [],
    "camera_mode": "server",
    "active_token": None,
    "token_last_seen": 0,
    "device": device,
    "raw_frame": None,
    "current_frame_triple": None,
    "current_frame_pose": None,
    "current_frame_seg": None,
    "current_frame_depth": None,
    "frozen_frame_triple": None,
    "frozen_frame_pose": None,
    "frozen_frame_seg": None,
    "frozen_frame_depth": None,
}

# Conexiones COCO 17 keypoints
SKELETON_EDGES = [
    (0, 1), (0, 2), (1, 3), (2, 4),           # Cabeza
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),   # Brazos y hombros
    (5, 11), (6, 12), (11, 12),               # Torso
    (11, 13), (13, 15), (12, 14), (14, 16)    # Piernas
]

COLOR_PALETTE_BGR = [
    (0, 255, 128),   # Verde esmeralda neón
    (255, 115, 0),   # Azul eléctrico
    (0, 180, 255),   # Naranja neón
    (255, 0, 200),   # Magenta neón
    (0, 240, 255),   # Amarillo solar
    (200, 0, 255),   # Violeta
    (255, 255, 0),   # Cian puro
    (50, 255, 50),   # Lima
    (255, 60, 0),    # Rojo naranja
    (150, 40, 255)   # Púrpura
]

COLORMAP_MAP = {
    "INFERNO": cv2.COLORMAP_INFERNO,
    "TURBO": cv2.COLORMAP_TURBO,
    "MAGMA": cv2.COLORMAP_MAGMA,
    "VIRIDIS": cv2.COLORMAP_VIRIDIS,
    "JET": cv2.COLORMAP_JET,
    "GRAY": None
}

def get_class_color(cls_id):
    return COLOR_PALETTE_BGR[cls_id % len(COLOR_PALETTE_BGR)]

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = '127.0.0.1'
    finally:
        s.close()
    return local_ip

# ─────────────────────────────────────────────────────────────
# CARGA DE MODELOS YOLO26
# ─────────────────────────────────────────────────────────────
def load_all_models():
    global MODELS
    print("📦 [YOLO26 v2] Cargando modelos...")
    try:
        MODELS["pose"] = YOLO(POSE_PATH)
        print(f"✅ YOLO26-Pose cargado ({POSE_PATH})")
    except Exception as e:
        print(f"⚠️ Error cargando Pose: {e}")

    try:
        MODELS["seg"] = YOLO(SEG_PATH)
        print(f"✅ YOLO26-Seg cargado ({SEG_PATH})")
    except Exception as e:
        print(f"⚠️ Error cargando Seg: {e}")

    try:
        if DEPTH_PATH and os.path.exists(DEPTH_PATH):
            MODELS["depth"] = YOLO(DEPTH_PATH)
            print(f"✅ YOLO26-Depth cargado ({DEPTH_PATH})")
        else:
            print(f"⚠️ Depth model no encontrado en {DEPTH_PATH}")
    except Exception as e:
        print(f"⚠️ Error cargando Depth: {e}")

    CONFIG["models_loaded"] = True
    print("🎯 Modelos listos para inferencia 16:9.")

load_all_models()

# ─────────────────────────────────────────────────────────────
# HILO DE CAPTURA DE CÁMARA (DESACOPLADO)
# ─────────────────────────────────────────────────────────────
def camera_capture_worker():
    global is_running, camera_cap
    backend = cv2.CAP_DSHOW if os.name == 'nt' else cv2.CAP_ANY
    camera_cap = cv2.VideoCapture(CONFIG["camera_id"], backend)

    if not camera_cap.isOpened():
        camera_cap = cv2.VideoCapture(CONFIG["camera_id"])

    if camera_cap.isOpened():
        camera_cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera_cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        camera_cap.set(cv2.CAP_PROP_FPS, 30)
        print("📸 Webcam del servidor lista (640x480 @ 30fps).")
    else:
        print("⚠️ No se detectó webcam local. Modo cámara móvil habilitado.")
        with STATE_LOCK:
            STATE["camera_mode"] = "client"

    while is_running:
        if STATE["camera_mode"] == "server" and camera_cap is not None and camera_cap.isOpened():
            success, frame = camera_cap.read()
            if success and frame is not None:
                if CONFIG["flip_horizontal"]:
                    frame = cv2.flip(frame, 1)
                with STATE_LOCK:
                    STATE["raw_frame"] = frame
            else:
                time.sleep(0.01)
        else:
            time.sleep(0.03)

    if camera_cap is not None and camera_cap.isOpened():
        camera_cap.release()
        print("📸 Webcam liberada.")

# ─────────────────────────────────────────────────────────────
# DIBUJADO DE ALTO CONTRASTE: POSE
# ─────────────────────────────────────────────────────────────
def draw_pose_annotated(frame, results, conf_thresh, show_boxes, show_skel, contrast_boost=True):
    annotated = frame.copy()
    if not results or len(results) == 0:
        return annotated, 0

    res = results[0]
    boxes = res.boxes
    keypoints = res.keypoints
    person_count = 0

    if keypoints is not None and len(keypoints) > 0:
        kpts_list = keypoints.data.cpu().numpy()

        for i, kpts in enumerate(kpts_list):
            box_conf = float(boxes.conf[i]) if (boxes is not None and len(boxes) > i) else 1.0
            if box_conf < conf_thresh:
                continue

            person_count += 1

            # Bounding Box con trazo de alto contraste (Doble Borde)
            if show_boxes and boxes is not None and len(boxes) > i:
                x1, y1, x2, y2 = map(int, boxes.xyxy[i])
                box_color = (0, 255, 200)
                
                if contrast_boost:
                    cv2.rectangle(annotated, (x1-1, y1-1), (x2+1, y2+1), (0, 0, 0), 3)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), box_color, 2)

                tag = f"Persona #{person_count} ({box_conf:.0%})"
                (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
                cv2.rectangle(annotated, (x1, y1 - th - 8), (x1 + tw + 8, y1), (0, 0, 0), -1)
                cv2.rectangle(annotated, (x1, y1 - th - 8), (x1 + tw + 8, y1), box_color, 1)
                cv2.putText(annotated, tag, (x1 + 4, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

            # Esqueleto anatómico con doble trazo (Halo negro + Neón)
            if show_skel:
                for p1_idx, p2_idx in SKELETON_EDGES:
                    if p1_idx < len(kpts) and p2_idx < len(kpts):
                        p1 = kpts[p1_idx]
                        p2 = kpts[p2_idx]
                        c1 = p1[2] if len(p1) > 2 else 1.0
                        c2 = p2[2] if len(p2) > 2 else 1.0

                        if c1 > 0.35 and c2 > 0.35:
                            pt1 = (int(p1[0]), int(p1[1]))
                            pt2 = (int(p2[0]), int(p2[1]))
                            
                            if contrast_boost:
                                cv2.line(annotated, pt1, pt2, (0, 0, 0), 4, cv2.LINE_AA)
                            cv2.line(annotated, pt1, pt2, (255, 120, 0), 2, cv2.LINE_AA)

                for k_idx, pt in enumerate(kpts):
                    conf = pt[2] if len(pt) > 2 else 1.0
                    if conf > 0.35:
                        x, y = int(pt[0]), int(pt[1])
                        if k_idx in [0, 1, 2, 3, 4]:
                            k_col = (0, 255, 255)
                        elif k_idx in [5, 7, 9, 6, 8, 10]:
                            k_col = (0, 240, 0)
                        else:
                            k_col = (0, 100, 255)

                        cv2.circle(annotated, (x, y), 6, (0, 0, 0), -1, cv2.LINE_AA)
                        cv2.circle(annotated, (x, y), 4, k_col, -1, cv2.LINE_AA)
                        cv2.circle(annotated, (x, y), 2, (255, 255, 255), -1, cv2.LINE_AA)

    # Banner superior
    h, w = annotated.shape[:2]
    cv2.rectangle(annotated, (0, 0), (w, 32), (10, 15, 22), -1)
    cv2.rectangle(annotated, (0, 31), (w, 32), (0, 255, 200), 1)
    banner_txt = f"🦴 POSE | {person_count} {'Persona' if person_count == 1 else 'Personas'}"
    cv2.putText(annotated, banner_txt, (12, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 200), 2, cv2.LINE_AA)

    return annotated, person_count

# ─────────────────────────────────────────────────────────────
# DIBUJADO DE ALTO CONTRASTE: SEGMENTACIÓN
# ─────────────────────────────────────────────────────────────
def draw_seg_annotated(frame, results, conf_thresh, alpha, show_boxes, show_masks, contrast_boost=True):
    annotated = frame.copy()
    if not results or len(results) == 0:
        return annotated, 0, []

    res = results[0]
    boxes = res.boxes
    has_masks = hasattr(res, 'masks') and res.masks is not None
    det_count = 0
    detected_classes = []

    mask_overlay = frame.copy()

    if boxes is not None and len(boxes) > 0:
        for i, box in enumerate(boxes):
            conf = float(box.conf[0])
            if conf < conf_thresh:
                continue

            det_count += 1
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            cls_id = int(box.cls[0])
            cls_name = res.names[cls_id]
            detected_classes.append(cls_name)
            color = get_class_color(cls_id)

            if show_masks and has_masks and len(res.masks.xy) > i:
                polygon = res.masks.xy[i].astype(np.int32)
                if len(polygon) > 0:
                    cv2.fillPoly(mask_overlay, [polygon], color)
                    if contrast_boost:
                        cv2.polylines(annotated, [polygon], True, (0, 0, 0), 3, cv2.LINE_AA)
                    cv2.polylines(annotated, [polygon], True, color, 2, cv2.LINE_AA)

            if show_boxes:
                if contrast_boost:
                    cv2.rectangle(annotated, (x1-1, y1-1), (x2+1, y2+1), (0, 0, 0), 3)
                cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                
                label = f"{cls_name} {conf:.0%}"
                (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
                label_y = max(y1, lh + 8)
                cv2.rectangle(annotated, (x1, label_y - lh - 8), (x1 + lw + 6, label_y), (0, 0, 0), -1)
                cv2.rectangle(annotated, (x1, label_y - lh - 8), (x1 + lw + 6, label_y), color, 1)
                cv2.putText(annotated, label, (x1 + 3, label_y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

        if show_masks and has_masks:
            cv2.addWeighted(mask_overlay, alpha, annotated, 1.0 - alpha, 0, annotated)

    h, w = annotated.shape[:2]
    cv2.rectangle(annotated, (0, 0), (w, 32), (10, 15, 22), -1)
    cv2.rectangle(annotated, (0, 31), (w, 32), (255, 140, 0), 1)
    cv2.putText(annotated, f"🎨 SEG | {det_count} {'Objeto' if det_count == 1 else 'Objetos'}", (12, 22), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 160, 20), 2, cv2.LINE_AA)

    return annotated, det_count, list(set(detected_classes))

# ─────────────────────────────────────────────────────────────
# DIBUJADO DE ALTO CONTRASTE: PROFUNDIDAD (DEPTH)
# ─────────────────────────────────────────────────────────────
def draw_depth_annotated(frame, results, alpha, colormap_name):
    annotated = frame.copy()
    h, w = frame.shape[:2]

    if not results or len(results) == 0 or not hasattr(results[0], 'depth') or results[0].depth is None:
        cv2.putText(annotated, "Depth no disponible", (30, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        return annotated, 0.0, 0.0

    depth_data = results[0].depth.data.cpu().numpy()
    if len(depth_data.shape) == 3:
        depth_data = depth_data[0]

    d_min = float(depth_data.min())
    d_max = float(depth_data.max())

    d_range = max(d_max - d_min, 1e-4)
    depth_norm = ((depth_data - d_min) / d_range * 255.0).astype(np.uint8)

    depth_norm = 255 - depth_norm

    if depth_norm.shape[:2] != (h, w):
        depth_norm = cv2.resize(depth_norm, (w, h), interpolation=cv2.INTER_LINEAR)

    cmap_code = COLORMAP_MAP.get(colormap_name, cv2.COLORMAP_INFERNO)
    if cmap_code is not None:
        depth_color = cv2.applyColorMap(depth_norm, cmap_code)
    else:
        depth_color = cv2.cvtColor(depth_norm, cv2.COLOR_GRAY2BGR)

    if alpha < 1.0:
        cv2.addWeighted(depth_color, alpha, annotated, 1.0 - alpha, 0, annotated)
    else:
        annotated = depth_color

    cv2.rectangle(annotated, (0, 0), (w, 32), (10, 15, 22), -1)
    cv2.rectangle(annotated, (0, 31), (w, 32), (255, 0, 200), 1)
    banner_txt = f"🌊 DEPTH | Rango: {d_min:.1f}m - {d_max:.1f}m"
    cv2.putText(annotated, banner_txt, (12, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 200), 2, cv2.LINE_AA)

    return annotated, round(d_min, 2), round(d_max, 2)

# ─────────────────────────────────────────────────────────────
# COMPOSITOR 16:9 PANORÁMICO (PRESERVA PROPORCIONES SIN DEFORMAR)
# ─────────────────────────────────────────────────────────────
def fit_to_canvas(frame, target_w, target_h, bg_color=(8, 12, 18)):
    """Escala el frame preservando exactamente la relación de aspecto (sin deformar ni aplastar)."""
    h, w = frame.shape[:2]
    scale = min(target_w / w, target_h / h)
    new_w = max(int(w * scale), 1)
    new_h = max(int(h * scale), 1)
    resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    
    canvas = np.full((target_h, target_w, 3), bg_color, dtype=np.uint8)
    x_offset = (target_w - new_w) // 2
    y_offset = (target_h - new_h) // 2
    canvas[y_offset:y_offset + new_h, x_offset:x_offset + new_w] = resized
    return canvas

def compose_16_9_triple(frame_main, frame_sub1, frame_sub2, tag_main, tag_sub1, tag_sub2, divider_color, bg_color=(8, 12, 18)):
    """
    Compone un frame panorámico exacto 16:9 (1280x720) sin deformar la geometría de las personas/objetos:
    - Panel Principal (Izquierda): 850 x 720
    - Panel Superior Derecho: 426 x 358
    - Panel Inferior Derecho: 426 x 358
    """
    out = np.full((720, 1280, 3), bg_color, dtype=np.uint8)

    # 1. Panel Principal Grande (850 x 720)
    main_res = fit_to_canvas(frame_main, 850, 720, bg_color)
    cv2.rectangle(main_res, (10, 42), (260, 70), (0, 0, 0), -1)
    cv2.rectangle(main_res, (10, 42), (260, 70), divider_color, 1)
    cv2.putText(main_res, f"★ PRINCIPAL: {tag_main}", (18, 62), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    out[0:720, 0:850] = main_res

    # 2. Divisor Vertical (4px)
    out[0:720, 850:854] = divider_color

    # 3. Sub-panel 1 (Superior Derecho: 426 x 358)
    sub1_res = fit_to_canvas(frame_sub1, 426, 358, bg_color)
    cv2.rectangle(sub1_res, (8, 40), (200, 64), (0, 0, 0), -1)
    cv2.rectangle(sub1_res, (8, 40), (200, 64), (200, 200, 200), 1)
    cv2.putText(sub1_res, tag_sub1, (14, 57), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    out[0:358, 854:1280] = sub1_res

    # 4. Divisor Horizontal (4px)
    out[358:362, 854:1280] = divider_color

    # 5. Sub-panel 2 (Inferior Derecho: 426 x 358)
    sub2_res = fit_to_canvas(frame_sub2, 426, 358, bg_color)
    cv2.rectangle(sub2_res, (8, 40), (200, 64), (0, 0, 0), -1)
    cv2.rectangle(sub2_res, (8, 40), (200, 64), (200, 200, 200), 1)
    cv2.putText(sub2_res, tag_sub2, (14, 57), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    out[362:720, 854:1280] = sub2_res

    return out

def to_16_9_individual(frame, bg_color=(8, 12, 18)):
    """Convierte un frame individual a relación exacta 16:9 (1280x720) sin estirar ni deformar la imagen."""
    return fit_to_canvas(frame, 1280, 720, bg_color)


# ─────────────────────────────────────────────────────────────
# HILO DE INFERENCIA MULTI-MODELO ASÍNCRONO
# ─────────────────────────────────────────────────────────────
def inference_worker():
    global is_running
    frame_count = 0
    last_pose_frame = None
    last_seg_frame = None
    last_depth_frame = None
    last_pose_count = 0
    last_seg_count = 0
    last_seg_classes = []
    last_depth_min, last_depth_max = 0.0, 0.0

    last_pose_results = None
    last_seg_results = None
    last_depth_results = None

    while is_running:
        try:
            with STATE_LOCK:
                raw = STATE["raw_frame"]
                is_frozen = CONFIG["frozen"]
                view_mode = CONFIG["view_mode"]
                triple_main = CONFIG["triple_main"]

            if raw is None or not CONFIG["models_loaded"]:
                time.sleep(0.01)
                continue

            if is_frozen:
                time.sleep(0.04)
                continue

            if STATE["camera_mode"] == "client":
                if STATE["active_token"] and (time.time() - STATE["token_last_seen"] > 8):
                    print("⏰ Cliente móvil desconectado. Regresando a cámara de servidor.")
                    with STATE_LOCK:
                        STATE["camera_mode"] = "server"
                        STATE["active_token"] = None

            frame_input = raw.copy()
            frame_count += 1
            skip = max(CONFIG.get("frame_skip", 1), 1)
            imgsz = CONFIG.get("inference_size", 256)
            contrast = CONFIG.get("contrast_boost", True)

            do_infer = (frame_count % skip == 0)

            # En modo triple procesamos todos los modelos. En modo individual procesamos el activo.
            need_pose = (view_mode == "triple" or view_mode == "pose")
            need_seg = (view_mode == "triple" or view_mode == "seg")
            need_depth = (view_mode == "triple" or view_mode == "depth")

            ms_pose = 0.0
            ms_seg = 0.0
            ms_depth = 0.0

            # 1. Pose
            if need_pose and MODELS["pose"] is not None:
                if do_infer or last_pose_results is None:
                    t0 = time.time()
                    last_pose_results = MODELS["pose"](
                        frame_input, imgsz=imgsz, conf=CONFIG["conf_pose"], verbose=False, device='cpu'
                    )
                    ms_pose = round((time.time() - t0) * 1000, 1)

                last_pose_frame, last_pose_count = draw_pose_annotated(
                    frame_input, last_pose_results, CONFIG["conf_pose"],
                    CONFIG["show_boxes_pose"], CONFIG["show_skeleton"], contrast
                )
            elif last_pose_frame is None:
                last_pose_frame = frame_input

            # 2. Segmentación
            if need_seg and MODELS["seg"] is not None:
                if do_infer or last_seg_results is None:
                    t1 = time.time()
                    last_seg_results = MODELS["seg"](
                        frame_input, imgsz=imgsz, conf=CONFIG["conf_seg"], verbose=False, device='cpu'
                    )
                    ms_seg = round((time.time() - t1) * 1000, 1)

                last_seg_frame, last_seg_count, last_seg_classes = draw_seg_annotated(
                    frame_input, last_seg_results, CONFIG["conf_seg"],
                    CONFIG["mask_alpha"], CONFIG["show_boxes_seg"], CONFIG["show_masks_seg"], contrast
                )
            elif last_seg_frame is None:
                last_seg_frame = frame_input

            # 3. Depth
            if need_depth and MODELS["depth"] is not None:
                if do_infer or last_depth_results is None:
                    t2 = time.time()
                    last_depth_results = MODELS["depth"](frame_input, imgsz=imgsz, verbose=False, device='cpu')
                    ms_depth = round((time.time() - t2) * 1000, 1)

                last_depth_frame, last_depth_min, last_depth_max = draw_depth_annotated(
                    frame_input, last_depth_results, CONFIG["depth_alpha"], CONFIG["depth_colormap"]
                )
            elif last_depth_frame is None:
                last_depth_frame = frame_input

            # 4. Composición de Malla Triple 16:9 con ranura principal alternable
            div_col = (0, 255, 200) if CONFIG["high_contrast_theme"] == "dark" else (2, 132, 199)

            if triple_main == "seg":
                frame_triple = compose_16_9_triple(
                    last_seg_frame, last_pose_frame, last_depth_frame,
                    "SEGMENTACIÓN", "POSE (17 KEYPOINTS)", "DEPTH ESTIMATION", div_col
                )
            elif triple_main == "depth":
                frame_triple = compose_16_9_triple(
                    last_depth_frame, last_pose_frame, last_seg_frame,
                    "DEPTH ESTIMATION", "POSE (17 KEYPOINTS)", "SEGMENTACIÓN", div_col
                )
            else:
                # Pose por defecto
                frame_triple = compose_16_9_triple(
                    last_pose_frame, last_seg_frame, last_depth_frame,
                    "POSE (17 KEYPOINTS)", "SEGMENTACIÓN", "DEPTH ESTIMATION", div_col
                )

            # 5. Vistas individuales 16:9
            frame_pose_169 = to_16_9_individual(last_pose_frame)
            frame_seg_169 = to_16_9_individual(last_seg_frame)
            frame_depth_169 = to_16_9_individual(last_depth_frame)

            # 6. Codificación JPEG optimizada
            jpeg_quality = 82
            _, buf_triple = cv2.imencode('.jpg', frame_triple, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
            _, buf_pose = cv2.imencode('.jpg', frame_pose_169, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
            _, buf_seg = cv2.imencode('.jpg', frame_seg_169, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
            _, buf_depth = cv2.imencode('.jpg', frame_depth_169, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])

            total_ms = max(ms_pose + ms_seg + ms_depth, 1.0)
            calc_fps = round(1000.0 / total_ms, 1)

            with STATE_LOCK:
                STATE["current_frame_triple"] = buf_triple.tobytes()
                STATE["current_frame_pose"] = buf_pose.tobytes()
                STATE["current_frame_seg"] = buf_seg.tobytes()
                STATE["current_frame_depth"] = buf_depth.tobytes()
                STATE["ms_pose"] = ms_pose
                STATE["ms_seg"] = ms_seg
                STATE["ms_depth"] = ms_depth
                STATE["fps_overall"] = calc_fps
                STATE["pose_count"] = last_pose_count
                STATE["seg_count"] = last_seg_count
                STATE["seg_classes"] = last_seg_classes
                STATE["depth_min"] = last_depth_min
                STATE["depth_max"] = last_depth_max

            time.sleep(0.003)

        except Exception as e:
            print(f"⚠️ Error en ciclo de inferencia: {e}")
            time.sleep(0.03)

# Iniciar hilos
threading.Thread(target=camera_capture_worker, daemon=True).start()
threading.Thread(target=inference_worker, daemon=True).start()

# ─────────────────────────────────────────────────────────────
# RUTAS FLASK Y CONTROLADORES
# ─────────────────────────────────────────────────────────────
@app.route('/')
def index():
    local_ip = get_local_ip()
    return render_template(
        'index.html',
        local_ip=local_ip,
        port=5002,
        profiles=PERFORMANCE_PROFILES,
        device=device
    )

@app.route('/projection')
def projection_view():
    local_ip = get_local_ip()
    return render_template(
        'projection.html',
        local_ip=local_ip,
        port=5002,
        device=device
    )

def gen_stream_feed(mode="triple"):
    while is_running:
        with STATE_LOCK:
            if CONFIG["frozen"]:
                if mode == "pose":
                    frame_bytes = STATE["frozen_frame_pose"] or STATE["current_frame_pose"]
                elif mode == "seg":
                    frame_bytes = STATE["frozen_frame_seg"] or STATE["current_frame_seg"]
                elif mode == "depth":
                    frame_bytes = STATE["frozen_frame_depth"] or STATE["current_frame_depth"]
                else:
                    frame_bytes = STATE["frozen_frame_triple"] or STATE["current_frame_triple"]
            else:
                if mode == "pose":
                    frame_bytes = STATE["current_frame_pose"]
                elif mode == "seg":
                    frame_bytes = STATE["current_frame_seg"]
                elif mode == "depth":
                    frame_bytes = STATE["current_frame_depth"]
                else:
                    frame_bytes = STATE["current_frame_triple"]

        if frame_bytes:
            try:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            except GeneratorExit:
                return
        time.sleep(0.033)

@app.route('/video_feed/<mode>')
def video_feed(mode):
    if mode not in ["triple", "pose", "seg", "depth"]:
        mode = "triple"
    return Response(gen_stream_feed(mode), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/video_feed')
def video_feed_default():
    return Response(gen_stream_feed("triple"), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/stats')
def api_stats():
    with STATE_LOCK:
        return jsonify({
            "fps": STATE["fps_overall"],
            "ms_pose": STATE["ms_pose"],
            "ms_seg": STATE["ms_seg"],
            "ms_depth": STATE["ms_depth"],
            "pose_count": STATE["pose_count"],
            "seg_count": STATE["seg_count"],
            "depth_min": STATE["depth_min"],
            "depth_max": STATE["depth_max"],
            "seg_classes": list(STATE["seg_classes"]),
            "camera_mode": STATE["camera_mode"],
            "view_mode": CONFIG["view_mode"],
            "triple_main": CONFIG["triple_main"],
            "profile": CONFIG["profile"],
            "frozen": CONFIG["frozen"],
            "device": STATE["device"],
            "flip": CONFIG["flip_horizontal"],
            "contrast_theme": CONFIG["high_contrast_theme"]
        })

@app.route('/api/config', methods=['POST'])
def api_config():
    data = request.json or {}
    with STATE_LOCK:
        if 'conf_pose' in data:
            CONFIG['conf_pose'] = float(data['conf_pose'])
        if 'conf_seg' in data:
            CONFIG['conf_seg'] = float(data['conf_seg'])
        if 'mask_alpha' in data:
            CONFIG['mask_alpha'] = float(data['mask_alpha'])
        if 'depth_alpha' in data:
            CONFIG['depth_alpha'] = float(data['depth_alpha'])
        if 'depth_colormap' in data:
            CONFIG['depth_colormap'] = str(data['depth_colormap'])
        if 'view_mode' in data:
            CONFIG['view_mode'] = str(data['view_mode'])
        if 'triple_main' in data:
            CONFIG['triple_main'] = str(data['triple_main'])
        if 'show_skeleton' in data:
            CONFIG['show_skeleton'] = bool(data['show_skeleton'])
        if 'show_boxes_pose' in data:
            CONFIG['show_boxes_pose'] = bool(data['show_boxes_pose'])
        if 'show_masks_seg' in data:
            CONFIG['show_masks_seg'] = bool(data['show_masks_seg'])
        if 'show_boxes_seg' in data:
            CONFIG['show_boxes_seg'] = bool(data['show_boxes_seg'])
        if 'flip_horizontal' in data:
            CONFIG['flip_horizontal'] = bool(data['flip_horizontal'])
        if 'high_contrast_theme' in data:
            CONFIG['high_contrast_theme'] = str(data['high_contrast_theme'])
        if 'contrast_boost' in data:
            CONFIG['contrast_boost'] = bool(data['contrast_boost'])

    return jsonify({"status": "ok", "config": CONFIG})

@app.route('/api/profile', methods=['POST'])
def api_profile():
    data = request.json or {}
    profile_key = data.get('profile', 'balanced')
    with STATE_LOCK:
        if profile_key in PERFORMANCE_PROFILES:
            prof = PERFORMANCE_PROFILES[profile_key]
            CONFIG['profile'] = profile_key
            CONFIG['inference_size'] = prof['inference_size']
            CONFIG['frame_skip'] = prof['frame_skip']
        elif profile_key == 'custom':
            CONFIG['profile'] = 'custom'
            if 'inference_size' in data:
                CONFIG['inference_size'] = int(data['inference_size'])
            if 'frame_skip' in data:
                CONFIG['frame_skip'] = int(data['frame_skip'])

    return jsonify({
        "status": "ok",
        "profile": CONFIG['profile'],
        "inference_size": CONFIG['inference_size'],
        "frame_skip": CONFIG['frame_skip']
    })

@app.route('/api/freeze', methods=['POST'])
def api_freeze():
    data = request.json or {}
    with STATE_LOCK:
        if 'frozen' in data:
            CONFIG['frozen'] = bool(data['frozen'])
        else:
            CONFIG['frozen'] = not CONFIG['frozen']

        if CONFIG['frozen']:
            STATE["frozen_frame_triple"] = STATE["current_frame_triple"]
            STATE["frozen_frame_pose"] = STATE["current_frame_pose"]
            STATE["frozen_frame_seg"] = STATE["current_frame_seg"]
            STATE["frozen_frame_depth"] = STATE["current_frame_depth"]

    return jsonify({"status": "ok", "frozen": CONFIG['frozen']})

@app.route('/api/shutdown', methods=['POST'])
def api_shutdown():
    global is_running, camera_cap
    print("\n🛑 Solicitud de apagado recibida.")
    is_running = False
    
    if camera_cap is not None and camera_cap.isOpened():
        camera_cap.release()
        print("📸 Cámara liberada correctamente.")

    def kill_process():
        time.sleep(0.8)
        os.kill(os.getpid(), signal.SIGTERM)

    threading.Thread(target=kill_process, daemon=True).start()
    return jsonify({"status": "ok", "message": "Servidor apagado."})

# --- CLIENTE MÓVIL ---
@app.route('/claim_camera', methods=['POST'])
def claim_camera():
    token = str(uuid.uuid4())[:8]
    with STATE_LOCK:
        STATE['camera_mode'] = 'client'
        STATE['active_token'] = token
        STATE['token_last_seen'] = time.time()
    return jsonify({"status": "ok", "token": token})

@app.route('/release_camera', methods=['POST'])
def release_camera():
    with STATE_LOCK:
        STATE['camera_mode'] = 'server'
        STATE['active_token'] = None
    return jsonify({"status": "ok"})

@app.route('/upload_frame', methods=['POST'])
def upload_frame():
    token = request.headers.get('X-Client-Token')
    if STATE['camera_mode'] != 'client' or token != STATE['active_token']:
        return jsonify({"error": "No autorizado"}), 403

    img_data = request.data
    if not img_data and request.files:
        img_data = request.files.get('frame').read()

    nparr = np.frombuffer(img_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is not None:
        with STATE_LOCK:
            STATE['raw_frame'] = img
            STATE['token_last_seen'] = time.time()
        return jsonify({"status": "ok"})

    return jsonify({"error": "Frame inválido"}), 400

if __name__ == '__main__':
    local_ip = get_local_ip()
    port = 5002
    print("\n" + "=" * 65)
    print("🚀  YOLO26 Multi-Vision Explorer v2 (Triple 16:9)")
    print("=" * 65)
    print(f"🖥️  Panel Operador:    http://localhost:{port}")
    print(f"📽️  Vista Proyección:   http://localhost:{port}/projection")
    print(f"📱  Red Wi-Fi Local:   http://{local_ip}:{port}")
    print("=" * 65 + "\n")

    app.run(host='0.0.0.0', port=port, threaded=True, debug=False)
