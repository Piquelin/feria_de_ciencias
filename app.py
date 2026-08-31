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

# Detección automática de CUDA (GeForce 840M u otra GPU)
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Dispositivo de inferencia seleccionado: {device.upper()}")
if device == "cuda":
    try:
        model.to("cuda")
        print(f"GPU detectada: {torch.cuda.get_device_name(0)}")
    except Exception as e:
        print(f"No se pudo mover modelo a CUDA, usando CPU: {e}")
        device = "cpu"

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

current_tracking_data = {
    "detected": False,
    "faces": [],  # Lista de rostros detectados con sus keypoints normalizados
    "primary_cursor": {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0},
    "secondary_cursor": {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0, "active": False},
    "fps": 0.0,
    "timestamp": time.time()
}

prev_cursor = {"x": 0.5, "y": 0.5, "time": time.time()}
prev_cursor_p2 = {"x": 0.5, "y": 0.5, "time": time.time()}

# Parámetros de calibración y optimización
config = {
    "camera_id": 0,
    "flip_horizontal": True, # Modo espejo para interacción intuitiva
    "confidence_thresh": 0.35,
    "smoothing": 0.45, # Factor de suavizado exponencial
    "enable_gesture_reset": False, # Desactivado por defecto a petición
    "inference_size": 384, # 320 (Turbo), 384 (Óptimo para 840M/i7), 640 (Alta precisión)
}

def get_camera():
    global camera
    if camera is None or not camera.isOpened():
        camera = cv2.VideoCapture(config["camera_id"], cv2.CAP_DSHOW if os.name == 'nt' else cv2.CAP_ANY)
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

    while is_running:
        try:
            if cap is None or not cap.isOpened():
                time.sleep(0.1)
                cap = get_camera()
                continue

            success, frame = cap.read()
            if not success:
                time.sleep(0.02)
                continue

            if config["flip_horizontal"]:
                frame = cv2.flip(frame, 1)

            h, w, _ = frame.shape
            
            # Inferencia optimizada con tamaño de imagen calibrable para acelerar en GPUs y CPUs modestas
            img_sz = config.get("inference_size", 384)
            results = model(frame, imgsz=img_sz, conf=config["confidence_thresh"], verbose=False, device=device)
            
            now = time.time()
            dt = max(now - last_frame_time, 1e-4)
            last_frame_time = now
            calc_fps = 1.0 / dt

            detected = False
            faces_list = []
            primary = {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0, "active": False}
            secondary = {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0, "active": False}

            if results and len(results) > 0 and results[0].keypoints is not None and len(results[0].keypoints) > 0:
                keypoints_tensor = results[0].keypoints.xyn.cpu().numpy() # [N, 17, 2] normalizado
                
                parsed_faces = []

                for i, kpts in enumerate(keypoints_tensor):
                    nose = kpts[0]
                    left_eye = kpts[1]
                    right_eye = kpts[2]
                    left_ear = kpts[3]
                    right_ear = kpts[4]
                    left_wrist = kpts[9] if len(kpts) > 9 else [0, 0]
                    right_wrist = kpts[10] if len(kpts) > 10 else [0, 0]

                    # Gesto de juntar muñecas/manos (solo si está habilitado en config)
                    gesture_reset = False
                    if config.get("enable_gesture_reset", False):
                        if left_wrist[0] > 0 and left_wrist[1] > 0 and right_wrist[0] > 0 and right_wrist[1] > 0:
                            wrist_dist = np.linalg.norm(left_wrist - right_wrist)
                            if wrist_dist < 0.12:
                                gesture_reset = True

                    # Si la nariz tiene detección válida
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

                        # Vectores de viento: Nariz -> Muñecas
                        MAX_VECTOR_LEN = 0.35
                        wind_vx = 0.0
                        wind_vy = 0.0
                        hands_active = 0
                        
                        if left_wrist[0] > 0 and left_wrist[1] > 0:
                            lvx = left_wrist[0] - nose[0]
                            lvy = left_wrist[1] - nose[1]
                            dist_l = np.hypot(lvx, lvy)
                            if dist_l > 0.10:
                                scale_l = min(dist_l, MAX_VECTOR_LEN) / dist_l
                                downward_factor = 0.5 if lvy > 0.15 and abs(lvx) < 0.15 else 1.0
                                wind_vx += lvx * scale_l * downward_factor
                                wind_vy += lvy * scale_l * downward_factor
                                hands_active += 1

                        if right_wrist[0] > 0 and right_wrist[1] > 0:
                            rvx = right_wrist[0] - nose[0]
                            rvy = right_wrist[1] - nose[1]
                            dist_r = np.hypot(rvx, rvy)
                            if dist_r > 0.10:
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

                # Ordenar por escala (rostro más cercano primero) o posición X
                if parsed_faces:
                    parsed_faces.sort(key=lambda f: f["scale"], reverse=True)
                    faces_list = parsed_faces
                    detected = True
                    alpha = config["smoothing"]

                    # JUGADOR 1 (Rostro principal)
                    p1_face = parsed_faces[0]
                    target_x, target_y = p1_face["nose"]
                    smooth_x = smooth_x * alpha + target_x * (1.0 - alpha)
                    smooth_y = smooth_y * alpha + target_y * (1.0 - alpha)
                    smooth_tilt = smooth_tilt * alpha + p1_face["tilt"] * (1.0 - alpha)
                    smooth_scale = smooth_scale * alpha + p1_face["scale"] * (1.0 - alpha)

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
                        "gesture_reset": bool(p1_face.get("gesture_reset", False)),
                        "wind_vx": float(p1_face["wind_vx"]),
                        "wind_vy": float(p1_face["wind_vy"]),
                        "wind_magnitude": float(p1_face["wind_magnitude"]),
                        "wind_angle": float(p1_face["wind_angle"]),
                        "hands_active": int(p1_face["hands_active"]),
                        "left_wrist": p1_face["left_wrist"],
                        "right_wrist": p1_face["right_wrist"],
                        "active": True
                    }

                    # JUGADOR 2 (Segundo rostro si existe)
                    if len(parsed_faces) > 1:
                        p2_face = parsed_faces[1]
                        target_x_p2, target_y_p2 = p2_face["nose"]
                        smooth_x_p2 = smooth_x_p2 * alpha + target_x_p2 * (1.0 - alpha)
                        smooth_y_p2 = smooth_y_p2 * alpha + target_y_p2 * (1.0 - alpha)
                        smooth_tilt_p2 = smooth_tilt_p2 * alpha + p2_face["tilt"] * (1.0 - alpha)
                        smooth_scale_p2 = smooth_scale_p2 * alpha + p2_face["scale"] * (1.0 - alpha)

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
                            "active": True
                        }

            with lock:
                current_tracking_data = {
                    "detected": detected,
                    "faces": faces_list,
                    "primary_cursor": primary,
                    "secondary_cursor": secondary,
                    "fps": round(calc_fps, 1),
                    "timestamp": now,
                    "device": device
                }

            time.sleep(0.005) # Yield ligero
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
            time.sleep(0.016) # ~60 Hz de actualización al navegador
    return Response(event_stream(), mimetype="text/event-stream")

@app.route("/video_feed")
def video_feed():
    """Feed de video opcional en miniatura para calibración y alineación en vivo."""
    def gen():
        cap = get_camera()
        while is_running:
            if cap is None or not cap.isOpened():
                time.sleep(0.1)
                continue
            success, frame = cap.read()
            if not success:
                time.sleep(0.03)
                continue
            if config["flip_horizontal"]:
                frame = cv2.flip(frame, 1)
            
            with lock:
                curr = current_tracking_data
                if curr["detected"]:
                    # P1 Indicator (Verde)
                    if curr["primary_cursor"].get("active", False):
                        cx = int(curr["primary_cursor"]["x"] * frame.shape[1])
                        cy = int(curr["primary_cursor"]["y"] * frame.shape[0])
                        cv2.circle(frame, (cx, cy), 7, (0, 255, 136), 2)
                        cv2.putText(frame, "P1", (cx + 10, cy - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 136), 2)

                    # P2 Indicator (Naranja)
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
            time.sleep(0.05) # ~20 fps para miniatura
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')

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
            # Ordenar por puntaje total descendente
            scores.sort(key=lambda s: s.get("score_p1", 0) + s.get("score_p2", 0), reverse=True)
            scores = scores[:50] # Guardar top 50
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
