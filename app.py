import os
import time
import json
import threading
import signal
import cv2
import numpy as np
import torch
from flask import Flask, render_template, Response, jsonify, request
from ultralytics import YOLO

app = Flask(__name__)

# Configurar hilos de CPU para no saturar CPUs modestas (i7-4510U)
if torch.get_num_threads() > 4:
    torch.set_num_threads(4)

# Configuración de modelos y aceleración de hardware
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "app_dual_yolo26", "yolo26n-pose.pt")
if not os.path.exists(MODEL_PATH):
    MODEL_PATH = "yolo11n-pose.pt" # Fallback automático

print(f"Cargando modelo YOLO Pose desde: {MODEL_PATH}")
model = YOLO(MODEL_PATH)

# Detección y verificación REAL de CUDA con warmup
device = "cpu"
if torch.cuda.is_available():
    try:
        gpu_name = torch.cuda.get_device_name(0)
        print(f"Detectada GPU: {gpu_name}. Verificando compatibilidad de kernels CUDA...")
        dummy_img = np.zeros((320, 320, 3), dtype=np.uint8)
        _ = model(dummy_img, device="cuda", imgsz=320, verbose=False)
        device = "cuda"
        print(f"✅ Aceleración CUDA activada correctamente en {gpu_name}!")
    except Exception as e:
        print(f"⚠️ GPU detectada pero no compatible con estos kernels CUDA ({e}). Usando CPU optimizada.")
        device = "cpu"
else:
    print("CUDA no disponible en el sistema. Usando CPU.")

# Ruta para archivo de High Scores local
HISCORES_FILE = os.path.join(os.path.dirname(__file__), "hiscores.json")
if not os.path.exists(HISCORES_FILE):
    try:
        with open(HISCORES_FILE, "w", encoding="utf-8") as f:
            json.dump([], f)
    except Exception as e:
        print(f"Error inicializando hiscores.json: {e}")

# Estado global de la cámara y tracking
lock = threading.Lock()
camera = None
is_running = True
latest_preview_frame = None

# Estado de persistencia espacial para P1 y P2 (evita saltos entre personas)
MAX_MATCH_DIST = 0.28   # Radio de búsqueda normalizado
MAX_LOST_FRAMES = 10    # Ventana de tolerancia temporal (~350-400ms a 25-30 FPS)
tracker_state = {
    "p1": {"active": False, "pos": None, "scale": 1.0, "lost_frames": 0},
    "p2": {"active": False, "pos": None, "scale": 1.0, "lost_frames": 0}
}

current_tracking_data = {
    "detected": False,
    "faces": [],
    "primary_cursor": {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0},
    "secondary_cursor": {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0, "active": False},
    "fps": 0.0,
    "inference_ms": 0.0,
    "timestamp": time.time(),
    "device": device
}

prev_cursor = {"x": 0.5, "y": 0.5, "time": time.time()}
prev_cursor_p2 = {"x": 0.5, "y": 0.5, "time": time.time()}

# Parámetros de calibración y optimización
config = {
    "camera_id": 0,
    "flip_horizontal": True,
    "confidence_thresh": 0.35,
    "smoothing": 0.0, # 0.0 por defecto: bypass en backend para eliminar lag; el suavizado adaptativo lo hace 1€ Filter en JS
    "enable_gesture_reset": False,
    "inference_size": 256 if device == "cpu" else 384, # 256 en CPU para máxima velocidad
    "frame_skip": 1, # 1: procesa cada frame, 2: procesa 1 de cada 2 frames (duplica FPS)
    "wind_origin": "shoulders", # "shoulders": centro de los hombros (intuitivo), "nose": nariz
}

def get_camera():
    global camera
    if camera is None or not camera.isOpened():
        camera = cv2.VideoCapture(config["camera_id"], cv2.CAP_DSHOW if os.name == 'nt' else cv2.CAP_ANY)
        camera.set(cv2.CAP_PROP_BUFFERSIZE, 1) # Evita acumular frames viejos en buffer del driver
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        camera.set(cv2.CAP_PROP_FPS, 30)
    return camera

def tracking_worker():
    global current_tracking_data, prev_cursor, prev_cursor_p2, is_running
    cap = get_camera()
    last_frame_time = time.time()
    
    # Valores suavizados P1
    smooth_x, smooth_y = 0.5, 0.5
    smooth_tilt = 0.0
    smooth_scale = 1.0

    # Valores suavizados P2
    smooth_x_p2, smooth_y_p2 = 0.5, 0.5
    smooth_tilt_p2 = 0.0
    smooth_scale_p2 = 1.0

    frame_counter = 0
    last_results = None

    while is_running:
        try:
            if cap is None or not cap.isOpened():
                time.sleep(0.1)
                cap = get_camera()
                continue

            success, frame = cap.read()
            if not success:
                time.sleep(0.01)
                continue

            if config["flip_horizontal"]:
                frame = cv2.flip(frame, 1)

            with lock:
                latest_preview_frame = frame.copy()

            frame_counter += 1
            skip_rate = max(config.get("frame_skip", 1), 1)

            t_infer_start = time.time()
            img_sz = config.get("inference_size", 384)

            # Ejecutar inferencia según tasa de frame skip
            if frame_counter % skip_rate == 0 or last_results is None:
                results = model(frame, imgsz=img_sz, conf=config["confidence_thresh"], verbose=False, device=device)
                last_results = results
            else:
                results = last_results

            infer_ms = round((time.time() - t_infer_start) * 1000, 1)

            now = time.time()
            dt = max(now - last_frame_time, 1e-4)
            last_frame_time = now
            calc_fps = 1.0 / dt

            detected = False
            faces_list = []
            primary = {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0, "active": False}
            secondary = {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0, "active": False}

            if results and len(results) > 0 and results[0].keypoints is not None and len(results[0].keypoints) > 0:
                keypoints_tensor = results[0].keypoints.xyn.cpu().numpy()
                parsed_faces = []

                for i, kpts in enumerate(keypoints_tensor):
                    nose = kpts[0]
                    left_eye = kpts[1]
                    right_eye = kpts[2]
                    left_ear = kpts[3]
                    right_ear = kpts[4]
                    left_shoulder = kpts[5] if len(kpts) > 5 else [0, 0]
                    right_shoulder = kpts[6] if len(kpts) > 6 else [0, 0]
                    left_wrist = kpts[9] if len(kpts) > 9 else [0, 0]
                    right_wrist = kpts[10] if len(kpts) > 10 else [0, 0]

                    gesture_reset = False
                    if config.get("enable_gesture_reset", False):
                        if left_wrist[0] > 0 and left_wrist[1] > 0 and right_wrist[0] > 0 and right_wrist[1] > 0:
                            wrist_dist = np.linalg.norm(left_wrist - right_wrist)
                            if wrist_dist < 0.12:
                                gesture_reset = True

                    if nose[0] > 0 and nose[1] > 0:
                        eye_dist = np.linalg.norm(left_eye - right_eye) if (left_eye[0] > 0 and right_eye[0] > 0) else 0.05
                        ear_dist = np.linalg.norm(left_ear - right_ear) if (left_ear[0] > 0 and right_ear[0] > 0) else eye_dist * 2.0
                        
                        raw_tilt = 0.0
                        if left_eye[0] > 0 and right_eye[0] > 0:
                            dx = right_eye[0] - left_eye[0]
                            dy = right_eye[1] - left_eye[1]
                            raw_tilt = float(np.arctan2(dy, dx))
                        elif left_ear[0] > 0 and right_ear[0] > 0:
                            dx = right_ear[0] - left_ear[0]
                            dy = right_ear[1] - left_ear[1]
                            raw_tilt = float(np.arctan2(dy, dx))

                        if abs(raw_tilt) < 0.07:
                            tilt = 0.0
                        else:
                            tilt = float(np.clip(raw_tilt, -1.2, 1.2))

                        # Determinar origen para el vector de viento (manos)
                        wind_origin_mode = config.get("wind_origin", "shoulders")
                        if wind_origin_mode == "shoulders":
                            has_ls = left_shoulder[0] > 0 and left_shoulder[1] > 0
                            has_rs = right_shoulder[0] > 0 and right_shoulder[1] > 0
                            if has_ls and has_rs:
                                origin_x = float((left_shoulder[0] + right_shoulder[0]) / 2.0)
                                origin_y = float((left_shoulder[1] + right_shoulder[1]) / 2.0)
                            elif has_ls:
                                origin_x = float(left_shoulder[0])
                                origin_y = float(left_shoulder[1])
                            elif has_rs:
                                origin_x = float(right_shoulder[0])
                                origin_y = float(right_shoulder[1])
                            else:
                                # Fallback a pecho estimado si no se detectan hombros
                                origin_x = float(nose[0])
                                origin_y = float(nose[1] + eye_dist * 1.8)
                        else:
                            origin_x = float(nose[0])
                            origin_y = float(nose[1])

                        MAX_VECTOR_LEN = 0.35
                        wind_vx = 0.0
                        wind_vy = 0.0
                        hands_active = 0
                        
                        if left_wrist[0] > 0 and left_wrist[1] > 0:
                            lvx = left_wrist[0] - origin_x
                            lvy = left_wrist[1] - origin_y
                            dist_l = np.hypot(lvx, lvy)
                            if dist_l > 0.08:
                                scale_l = min(dist_l, MAX_VECTOR_LEN) / dist_l
                                downward_factor = 0.5 if lvy > 0.15 and abs(lvx) < 0.15 else 1.0
                                wind_vx += lvx * scale_l * downward_factor
                                wind_vy += lvy * scale_l * downward_factor
                                hands_active += 1

                        if right_wrist[0] > 0 and right_wrist[1] > 0:
                            rvx = right_wrist[0] - origin_x
                            rvy = right_wrist[1] - origin_y
                            dist_r = np.hypot(rvx, rvy)
                            if dist_r > 0.08:
                                scale_r = min(dist_r, MAX_VECTOR_LEN) / dist_r
                                downward_factor = 0.5 if rvy > 0.15 and abs(rvx) < 0.15 else 1.0
                                wind_vx += rvx * scale_r * downward_factor
                                wind_vy += rvy * scale_r * downward_factor
                                hands_active += 1

                        total_mag = np.hypot(wind_vx, wind_vy)
                        if total_mag > MAX_VECTOR_LEN:
                            wind_vx = (wind_vx / total_mag) * MAX_VECTOR_LEN
                            wind_vy = (wind_vy / total_mag) * MAX_VECTOR_LEN
                            total_mag = MAX_VECTOR_LEN

                        wind_magnitude = float(total_mag)
                        wind_angle = float(np.arctan2(wind_vy, wind_vx)) if wind_magnitude > 0.03 else 0.0

                        face_scale = float(max(eye_dist * 4.0, ear_dist * 2.0, 0.1))

                        face_obj = {
                            "nose": [float(nose[0]), float(nose[1])],
                            "left_eye": [float(left_eye[0]), float(left_eye[1])],
                            "right_eye": [float(right_eye[0]), float(right_eye[1])],
                            "left_ear": [float(left_ear[0]), float(left_ear[1])],
                            "right_ear": [float(right_ear[0]), float(right_ear[1])],
                            "left_shoulder": [float(left_shoulder[0]), float(left_shoulder[1])],
                            "right_shoulder": [float(right_shoulder[0]), float(right_shoulder[1])],
                            "wind_origin": [float(origin_x), float(origin_y)],
                            "left_wrist": [float(left_wrist[0]), float(left_wrist[1])],
                            "right_wrist": [float(right_wrist[0]), float(right_wrist[1])],
                            "gesture_reset": gesture_reset,
                            "scale": face_scale,
                            "tilt": tilt,
                            "wind_vx": float(wind_vx),
                            "wind_vy": float(wind_vy),
                            "wind_magnitude": wind_magnitude,
                            "wind_angle": wind_angle,
                            "hands_active": hands_active
                        }
                        parsed_faces.append(face_obj)

                matched_p1_face = None
                matched_p2_face = None

                if parsed_faces:
                    faces_list = parsed_faces

                    # Si el usuario hace el gesto de puños / manos juntas, resetear tracking
                    if any(f.get("gesture_reset", False) for f in parsed_faces):
                        tracker_state["p1"]["active"] = False
                        tracker_state["p1"]["pos"] = None
                        tracker_state["p2"]["active"] = False
                        tracker_state["p2"]["pos"] = None

                    # 1. Matching por proximidad espacial para tracks activos (Nearest Neighbor)
                    active_tracks = []
                    if tracker_state["p1"]["active"] and tracker_state["p1"]["pos"] is not None:
                        active_tracks.append("p1")
                    if tracker_state["p2"]["active"] and tracker_state["p2"]["pos"] is not None:
                        active_tracks.append("p2")

                    candidate_pairs = []
                    for t_id in active_tracks:
                        t_pos = tracker_state[t_id]["pos"]
                        for f_idx, face in enumerate(parsed_faces):
                            f_pos = face["nose"]
                            dist = float(np.hypot(f_pos[0] - t_pos[0], f_pos[1] - t_pos[1]))
                            if dist <= MAX_MATCH_DIST:
                                candidate_pairs.append((dist, t_id, f_idx))

                    candidate_pairs.sort(key=lambda x: x[0])
                    assigned_tracks = set()
                    assigned_faces = set()

                    for dist, t_id, f_idx in candidate_pairs:
                        if t_id not in assigned_tracks and f_idx not in assigned_faces:
                            assigned_tracks.add(t_id)
                            assigned_faces.add(f_idx)
                            face = parsed_faces[f_idx]
                            tracker_state[t_id]["pos"] = face["nose"]
                            tracker_state[t_id]["scale"] = face["scale"]
                            tracker_state[t_id]["lost_frames"] = 0
                            tracker_state[t_id]["active"] = True
                            if t_id == "p1":
                                matched_p1_face = face
                            else:
                                matched_p2_face = face

                    # Manejo de tolerancia a pérdidas momentáneas para tracks no emparejados
                    for t_id in ["p1", "p2"]:
                        if tracker_state[t_id]["active"] and t_id not in assigned_tracks:
                            tracker_state[t_id]["lost_frames"] += 1
                            if tracker_state[t_id]["lost_frames"] > MAX_LOST_FRAMES:
                                tracker_state[t_id]["active"] = False
                                tracker_state[t_id]["pos"] = None

                    # Rostros no asignados por proximidad
                    unassigned_faces = [f for i, f in enumerate(parsed_faces) if i not in assigned_faces]
                    unassigned_faces.sort(key=lambda f: f["scale"], reverse=True)

                    # Promover P2 a P1 si P1 se fue y P2 sigue presente
                    if not tracker_state["p1"]["active"] and tracker_state["p2"]["active"] and matched_p2_face is not None and not unassigned_faces:
                        tracker_state["p1"] = tracker_state["p2"].copy()
                        matched_p1_face = matched_p2_face
                        tracker_state["p2"]["active"] = False
                        tracker_state["p2"]["pos"] = None
                        matched_p2_face = None

                    # Si P1 no está activo y hay rostros disponibles, asignar el más grande a P1
                    if not tracker_state["p1"]["active"] and unassigned_faces:
                        p1_new_face = unassigned_faces.pop(0)
                        tracker_state["p1"]["active"] = True
                        tracker_state["p1"]["pos"] = p1_new_face["nose"]
                        tracker_state["p1"]["scale"] = p1_new_face["scale"]
                        tracker_state["p1"]["lost_frames"] = 0
                        matched_p1_face = p1_new_face

                    # Si P2 no está activo y quedan rostros disponibles, asignar a P2
                    if not tracker_state["p2"]["active"] and unassigned_faces:
                        p2_new_face = unassigned_faces.pop(0)
                        tracker_state["p2"]["active"] = True
                        tracker_state["p2"]["pos"] = p2_new_face["nose"]
                        tracker_state["p2"]["scale"] = p2_new_face["scale"]
                        tracker_state["p2"]["lost_frames"] = 0
                        matched_p2_face = p2_new_face
                else:
                    for t_id in ["p1", "p2"]:
                        if tracker_state[t_id]["active"]:
                            tracker_state[t_id]["lost_frames"] += 1
                            if tracker_state[t_id]["lost_frames"] > MAX_LOST_FRAMES:
                                tracker_state[t_id]["active"] = False
                                tracker_state[t_id]["pos"] = None

                alpha = config.get("smoothing", 0.0)

                # Construir cursor P1
                if matched_p1_face is not None:
                    detected = True
                    target_x, target_y = matched_p1_face["nose"]
                    if alpha > 0.0:
                        smooth_x = smooth_x * alpha + target_x * (1.0 - alpha)
                        smooth_y = smooth_y * alpha + target_y * (1.0 - alpha)
                        smooth_tilt = smooth_tilt * alpha + matched_p1_face["tilt"] * (1.0 - alpha)
                        smooth_scale = smooth_scale * alpha + matched_p1_face["scale"] * (1.0 - alpha)
                    else:
                        smooth_x, smooth_y = target_x, target_y
                        smooth_tilt = matched_p1_face["tilt"]
                        smooth_scale = matched_p1_face["scale"]

                    dx = smooth_x - prev_cursor["x"]
                    dy = smooth_y - prev_cursor["y"]
                    cursor_speed = np.sqrt(dx*dx + dy*dy) / dt
                    prev_cursor = {"x": smooth_x, "y": smooth_y, "time": now}

                    primary = {
                        "x": float(smooth_x),
                        "y": float(smooth_y),
                        "tilt": float(smooth_tilt),
                        "scale": float(smooth_scale),
                        "speed": float(cursor_speed),
                        "gesture_reset": bool(matched_p1_face.get("gesture_reset", False)),
                        "wind_vx": float(matched_p1_face["wind_vx"]),
                        "wind_vy": float(matched_p1_face["wind_vy"]),
                        "wind_magnitude": float(matched_p1_face["wind_magnitude"]),
                        "wind_angle": float(matched_p1_face["wind_angle"]),
                        "wind_origin": matched_p1_face.get("wind_origin", [float(smooth_x), float(smooth_y)]),
                        "hands_active": int(matched_p1_face["hands_active"]),
                        "left_wrist": matched_p1_face["left_wrist"],
                        "right_wrist": matched_p1_face["right_wrist"],
                        "active": True
                    }

                # Construir cursor P2
                if matched_p2_face is not None:
                    detected = True
                    target_x_p2, target_y_p2 = matched_p2_face["nose"]
                    if alpha > 0.0:
                        smooth_x_p2 = smooth_x_p2 * alpha + target_x_p2 * (1.0 - alpha)
                        smooth_y_p2 = smooth_y_p2 * alpha + target_y_p2 * (1.0 - alpha)
                        smooth_tilt_p2 = smooth_tilt_p2 * alpha + matched_p2_face["tilt"] * (1.0 - alpha)
                        smooth_scale_p2 = smooth_scale_p2 * alpha + matched_p2_face["scale"] * (1.0 - alpha)
                    else:
                        smooth_x_p2, smooth_y_p2 = target_x_p2, target_y_p2
                        smooth_tilt_p2 = matched_p2_face["tilt"]
                        smooth_scale_p2 = matched_p2_face["scale"]

                    dx2 = smooth_x_p2 - prev_cursor_p2["x"]
                    dy2 = smooth_y_p2 - prev_cursor_p2["y"]
                    cursor_speed_p2 = np.sqrt(dx2*dx2 + dy2*dy2) / dt
                    prev_cursor_p2 = {"x": smooth_x_p2, "y": smooth_y_p2, "time": now}

                    secondary = {
                        "x": float(smooth_x_p2),
                        "y": float(smooth_y_p2),
                        "tilt": float(smooth_tilt_p2),
                        "scale": float(smooth_scale_p2),
                        "speed": float(cursor_speed_p2),
                        "wind_origin": matched_p2_face.get("wind_origin", [float(smooth_x_p2), float(smooth_y_p2)]),
                        "active": True
                    }

            with lock:
                current_tracking_data = {
                    "detected": detected,
                    "faces": faces_list,
                    "primary_cursor": primary,
                    "secondary_cursor": secondary,
                    "fps": round(calc_fps, 1),
                    "inference_ms": infer_ms,
                    "timestamp": now,
                    "device": device
                }

            time.sleep(0.002)
        except Exception as e:
            print(f"Error en worker de tracking: {e}")
            time.sleep(0.05)

# Iniciar hilo de procesamiento en segundo plano
tracking_thread = threading.Thread(target=tracking_worker, daemon=True)
tracking_thread.start()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/stream_data")
def stream_data():
    """Server-Sent Events (SSE) para enviar las coordenadas faciales con latencia mínima."""
    def event_stream():
        while is_running:
            with lock:
                data_json = json.dumps(current_tracking_data)
            yield f"data: {data_json}\n\n"
            time.sleep(0.016)
    return Response(event_stream(), mimetype="text/event-stream")

@app.route("/video_feed")
def video_feed():
    """Feed de video opcional en miniatura para calibración y alineación en vivo (desacoplado sin cap.read concurrentes)."""
    def gen():
        while is_running:
            with lock:
                if latest_preview_frame is None:
                    frame = None
                else:
                    frame = latest_preview_frame.copy()
                curr = current_tracking_data
            
            if frame is None:
                time.sleep(0.04)
                continue
            
            if curr["detected"]:
                if curr["primary_cursor"].get("active", False):
                    p1_c = curr["primary_cursor"]
                    cx = int(p1_c["x"] * frame.shape[1])
                    cy = int(p1_c["y"] * frame.shape[0])
                    cv2.circle(frame, (cx, cy), 7, (0, 255, 136), 2)
                    cv2.putText(frame, "P1", (cx + 10, cy - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 136), 2)

                    # Visualización del origen y vector de viento en la miniatura de calibración
                    if p1_c.get("hands_active", 0) > 0 and p1_c.get("wind_magnitude", 0) > 0.02:
                        wor = p1_c.get("wind_origin", [p1_c["x"], p1_c["y"]])
                        ox = int(wor[0] * frame.shape[1])
                        oy = int(wor[1] * frame.shape[0])
                        wvx = int(p1_c.get("wind_vx", 0) * frame.shape[1] * 1.5)
                        wvy = int(p1_c.get("wind_vy", 0) * frame.shape[0] * 1.5)
                        cv2.circle(frame, (ox, oy), 4, (0, 255, 255), -1)
                        cv2.arrowedLine(frame, (ox, oy), (ox + wvx, oy + wvy), (0, 255, 255), 2, tipLength=0.25)

                if curr["secondary_cursor"].get("active", False):
                    cx2 = int(curr["secondary_cursor"]["x"] * frame.shape[1])
                    cy2 = int(curr["secondary_cursor"]["y"] * frame.shape[0])
                    cv2.circle(frame, (cx2, cy2), 7, (0, 165, 255), 2)
                    cv2.putText(frame, "P2", (cx2 + 10, cy2 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 165, 255), 2)

            ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 55])
            if not ret:
                continue
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
            time.sleep(0.05)
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route("/reset_tracking", methods=["POST"])
def reset_tracking():
    global tracker_state
    tracker_state["p1"]["active"] = False
    tracker_state["p1"]["pos"] = None
    tracker_state["p1"]["lost_frames"] = 0
    tracker_state["p2"]["active"] = False
    tracker_state["p2"]["pos"] = None
    tracker_state["p2"]["lost_frames"] = 0
    return jsonify({"status": "ok", "message": "Tracking reseteado correctamente"})

@app.route("/config", methods=["POST"])
def update_config():
    global config
    req = request.get_json(force=True)
    if "smoothing" in req:
        config["smoothing"] = float(req["smoothing"])
    if "confidence_thresh" in req:
        config["confidence_thresh"] = float(req["confidence_thresh"])
    if "flip_horizontal" in req:
        config["flip_horizontal"] = bool(req["flip_horizontal"])
    if "enable_gesture_reset" in req:
        config["enable_gesture_reset"] = bool(req["enable_gesture_reset"])
    if "inference_size" in req:
        config["inference_size"] = int(req["inference_size"])
    if "frame_skip" in req:
        config["frame_skip"] = int(req["frame_skip"])
    if "wind_origin" in req:
        config["wind_origin"] = str(req["wind_origin"])
    return jsonify({"status": "ok", "config": config})

@app.route("/api/hiscores", methods=["GET", "POST"])
def hiscores():
    """Manejo de High Scores locales persistentes."""
    if request.method == "POST":
        try:
            record = request.get_json(force=True)
            record["timestamp"] = time.strftime("%Y-%m-%d %H:%M:%S")
            scores = []
            if os.path.exists(HISCORES_FILE):
                with open(HISCORES_FILE, "r", encoding="utf-8") as f:
                    scores = json.load(f)
            scores.append(record)
            scores.sort(key=lambda s: s.get("score_p1", 0) + s.get("score_p2", 0), reverse=True)
            scores = scores[:50]
            with open(HISCORES_FILE, "w", encoding="utf-8") as f:
                json.dump(scores, f, indent=2)
            return jsonify({"status": "ok", "scores": scores})
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500
    else:
        try:
            scores = []
            if os.path.exists(HISCORES_FILE):
                with open(HISCORES_FILE, "r", encoding="utf-8") as f:
                    scores = json.load(f)
            return jsonify({"status": "ok", "scores": scores})
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/shutdown", methods=["POST"])
def shutdown():
    """Detiene limpiamente la aplicación liberando la cámara y el servidor."""
    global is_running, camera
    print("\n🛑 Solicitud de apagado recibida desde el HUD...")
    is_running = False
    
    def stop_server():
        time.sleep(0.5)
        if camera is not None and camera.isOpened():
            camera.release()
            print("Cámara liberada.")
        os.kill(os.getpid(), signal.SIGTERM)

    threading.Thread(target=stop_server).start()
    return jsonify({"status": "ok", "message": "Servidor apagándose. Puedes cerrar la ventana."})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
