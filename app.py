import os
import time
import json
import threading
import cv2
import numpy as np
from flask import Flask, render_template, Response, jsonify, request
from ultralytics import YOLO

app = Flask(__name__)

# Configuración de modelos y cámara
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "app_dual_yolo26", "yolo26n-pose.pt")
if not os.path.exists(MODEL_PATH):
    MODEL_PATH = "yolo11n-pose.pt" # Fallback automático

print(f"Cargando modelo YOLO Pose desde: {MODEL_PATH}")
model = YOLO(MODEL_PATH)

# Estado global de la cámara y tracking
lock = threading.Lock()
camera = None

current_tracking_data = {
    "detected": False,
    "faces": [],  # Lista de rostros detectados con sus keypoints normalizados
    "primary_cursor": {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0},
    "fps": 0.0,
    "timestamp": time.time()
}

prev_cursor = {"x": 0.5, "y": 0.5, "time": time.time()}

# Parámetros de calibración
config = {
    "camera_id": 0,
    "flip_horizontal": True, # Modo espejo para interacción intuitiva
    "confidence_thresh": 0.35,
    "smoothing": 0.45 # Factor de suavizado exponencial
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
    global current_tracking_data, prev_cursor
    cap = get_camera()
    last_frame_time = time.time()
    
    # Valores suavizados
    smooth_x, smooth_y = 0.5, 0.5
    smooth_tilt = 0.0
    smooth_scale = 1.0

    while True:
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
            results = model(frame, conf=config["confidence_thresh"], verbose=False)
            
            now = time.time()
            dt = max(now - last_frame_time, 1e-4)
            last_frame_time = now
            calc_fps = 1.0 / dt

            detected = False
            faces_list = []
            primary = {"x": 0.5, "y": 0.5, "tilt": 0.0, "scale": 1.0, "mouth_open": False, "speed": 0.0}

            if results and len(results) > 0 and results[0].keypoints is not None and len(results[0].keypoints) > 0:
                keypoints_tensor = results[0].keypoints.xyn.cpu().numpy() # [N, 17, 2] normalizado
                confs_tensor = results[0].keypoints.conf.cpu().numpy() if results[0].keypoints.conf is not None else None
                
                # Buscamos el rostro más grande/cercano
                best_area = -1
                best_face_data = None

                for i, kpts in enumerate(keypoints_tensor):
                    # Keypoints COCO Pose:
                    # 0: Nariz, 1: Ojo izq, 2: Ojo der, 3: Oreja izq, 4: Oreja der
                    # 5: Hombro izq, 6: Hombro der, 7: Codo izq, 8: Codo der, 9: Muñeca izq, 10: Muñeca der
                    nose = kpts[0]
                    left_eye = kpts[1]
                    right_eye = kpts[2]
                    left_ear = kpts[3]
                    right_ear = kpts[4]
                    left_wrist = kpts[9] if len(kpts) > 9 else [0, 0]
                    right_wrist = kpts[10] if len(kpts) > 10 else [0, 0]

                    # Detección de gesto: Juntar ambas muñecas/manos (reset gesture)
                    gesture_reset = False
                    if left_wrist[0] > 0 and left_wrist[1] > 0 and right_wrist[0] > 0 and right_wrist[1] > 0:
                        wrist_dist = np.linalg.norm(left_wrist - right_wrist)
                        # Si las dos manos están muy juntas (< 0.12 normalizado)
                        if wrist_dist < 0.12:
                            gesture_reset = True

                    # Si la nariz tiene detección válida
                    if nose[0] > 0 and nose[1] > 0:
                        eye_dist = np.linalg.norm(left_eye - right_eye) if (left_eye[0] > 0 and right_eye[0] > 0) else 0.05
                        ear_dist = np.linalg.norm(left_ear - right_ear) if (left_ear[0] > 0 and right_ear[0] > 0) else eye_dist * 2.0
                        
                        # Inclinación de la cabeza calculada con ojos u orejas
                        raw_tilt = 0.0
                        if left_eye[0] > 0 and right_eye[0] > 0:
                            dx = right_eye[0] - left_eye[0]
                            dy = right_eye[1] - left_eye[1]
                            raw_tilt = float(np.arctan2(dy, dx))
                        elif left_ear[0] > 0 and right_ear[0] > 0:
                            dx = right_ear[0] - left_ear[0]
                            dy = right_ear[1] - left_ear[1]
                            raw_tilt = float(np.arctan2(dy, dx))

                        # Zona muerta pequeña para evitar vibraciones involuntarias cuando la cabeza está recta
                        if abs(raw_tilt) < 0.07:
                            tilt = 0.0
                        else:
                            tilt = float(np.clip(raw_tilt, -1.2, 1.2))

                    # Cálculo de Vectores de Viento: Nariz -> Mano(s)/Muñeca(s)
                    # Limitamos la longitud máxima del vector para evitar que los brazos abajo desbalanceen el viento
                    MAX_VECTOR_LEN = 0.35
                    wind_vx = 0.0
                    wind_vy = 0.0
                    hands_active = 0
                    
                    if left_wrist[0] > 0 and left_wrist[1] > 0:
                        lvx = left_wrist[0] - nose[0]
                        lvy = left_wrist[1] - nose[1]
                        dist_l = np.hypot(lvx, lvy)
                        # Solo cuenta como gesto activo si está a cierta distancia y no colgando pasivamente
                        if dist_l > 0.10:
                            # Normalizar y recortar a longitud máxima
                            scale_l = min(dist_l, MAX_VECTOR_LEN) / dist_l
                            # Atenuar vector si es puramente hacia abajo (brazo en reposo)
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

                    # Limitar vector resultante total
                    total_mag = np.hypot(wind_vx, wind_vy)
                    if total_mag > MAX_VECTOR_LEN:
                        wind_vx = (wind_vx / total_mag) * MAX_VECTOR_LEN
                        wind_vy = (wind_vy / total_mag) * MAX_VECTOR_LEN
                        total_mag = MAX_VECTOR_LEN

                    wind_magnitude = float(total_mag)
                    wind_angle = float(np.arctan2(wind_vy, wind_vx)) if wind_magnitude > 0.03 else 0.0

                    face_obj = {
                        "nose": [float(nose[0]), float(nose[1])],
                        "left_eye": [float(left_eye[0]), float(left_eye[1])],
                        "right_eye": [float(right_eye[0]), float(right_eye[1])],
                        "left_ear": [float(left_ear[0]), float(left_ear[1])],
                        "right_ear": [float(right_ear[0]), float(right_ear[1])],
                        "left_wrist": [float(left_wrist[0]), float(left_wrist[1])],
                        "right_wrist": [float(right_wrist[0]), float(right_wrist[1])],
                        "gesture_reset": gesture_reset,
                        "scale": float(max(eye_dist * 4.0, ear_dist * 2.0, 0.1)),
                        "tilt": tilt,
                        "wind_vx": float(wind_vx),
                        "wind_vy": float(wind_vy),
                        "wind_magnitude": wind_magnitude,
                        "wind_angle": wind_angle,
                        "hands_active": hands_active
                    }
                    faces_list.append(face_obj)

                    # Medida de área aproximada
                    area = face_obj["scale"]
                    if area > best_area:
                        best_area = area
                        best_face_data = face_obj

                if best_face_data:
                    detected = True
                    alpha = config["smoothing"]
                    
                    target_x, target_y = best_face_data["nose"]
                    smooth_x = smooth_x * alpha + target_x * (1.0 - alpha)
                    smooth_y = smooth_y * alpha + target_y * (1.0 - alpha)
                    smooth_tilt = smooth_tilt * alpha + best_face_data["tilt"] * (1.0 - alpha)
                    smooth_scale = smooth_scale * alpha + best_face_data["scale"] * (1.0 - alpha)

                    # Suavizado de vector de viento de manos
                    smooth_wvx = best_face_data["wind_vx"]
                    smooth_wvy = best_face_data["wind_vy"]

                    # Cálculo de velocidad de movimiento
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
                        "gesture_reset": bool(best_face_data.get("gesture_reset", False)),
                        "wind_vx": float(smooth_wvx),
                        "wind_vy": float(smooth_wvy),
                        "wind_magnitude": float(best_face_data["wind_magnitude"]),
                        "wind_angle": float(best_face_data["wind_angle"]),
                        "hands_active": int(best_face_data["hands_active"]),
                        "left_wrist": best_face_data["left_wrist"],
                        "right_wrist": best_face_data["right_wrist"]
                    }

            with lock:
                current_tracking_data = {
                    "detected": detected,
                    "faces": faces_list,
                    "primary_cursor": primary,
                    "fps": round(calc_fps, 1),
                    "timestamp": now
                }

            time.sleep(0.005) # Yield ligero
        except Exception as e:
            print(f"Error en worker de tracking: {e}")
            time.sleep(0.05)

# Iniciar hilo de procesamiento en segundo plano
threading.Thread(target=tracking_worker, daemon=True).start()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/stream_data")
def stream_data():
    """Server-Sent Events (SSE) para enviar las coordenadas faciales con latencia mínima."""
    def event_stream():
        while True:
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
        while True:
            if cap is None or not cap.isOpened():
                time.sleep(0.1)
                continue
            success, frame = cap.read()
            if not success:
                time.sleep(0.03)
                continue
            if config["flip_horizontal"]:
                frame = cv2.flip(frame, 1)
            
            # Dibujar marcas sutiles para calibración
            with lock:
                curr = current_tracking_data
                if curr["detected"]:
                    cx = int(curr["primary_cursor"]["x"] * frame.shape[1])
                    cy = int(curr["primary_cursor"]["y"] * frame.shape[0])
                    tilt = curr["primary_cursor"].get("tilt", 0.0)

                    # Dibujar cursor central (nariz)
                    cv2.circle(frame, (cx, cy), 7, (255, 255, 255), 2)
                    
                    # Dibujar vectores de viento hacia las manos (origen nariz -> destino muñeca)
                    lw = curr["primary_cursor"].get("left_wrist", [0, 0])
                    rw = curr["primary_cursor"].get("right_wrist", [0, 0])
                    
                    if lw[0] > 0 and lw[1] > 0:
                        lx, ly = int(lw[0] * frame.shape[1]), int(lw[1] * frame.shape[0])
                        cv2.circle(frame, (lx, ly), 6, (0, 255, 255), -1)
                        cv2.line(frame, (cx, cy), (lx, ly), (0, 255, 255), 2)

                    if rw[0] > 0 and rw[1] > 0:
                        rx, ry = int(rw[0] * frame.shape[1]), int(rw[1] * frame.shape[0])
                        cv2.circle(frame, (rx, ry), 6, (0, 255, 255), -1)
                        cv2.line(frame, (cx, cy), (rx, ry), (0, 255, 255), 2)

                    # Vector resultante total de viento
                    wvx = curr["primary_cursor"].get("wind_vx", 0.0)
                    wvy = curr["primary_cursor"].get("wind_vy", 0.0)
                    if abs(wvx) > 0.01 or abs(wvy) > 0.01:
                        target_wx = int(cx + wvx * frame.shape[1])
                        target_wy = int(cy + wvy * frame.shape[0])
                        cv2.arrowedLine(frame, (cx, cy), (target_wx, target_wy), (0, 255, 0), 3, tipLength=0.25)

                    # Mostrar si hay gesto de reset activo
                    if curr["primary_cursor"].get("gesture_reset", False):
                        cv2.putText(frame, "GESTO RESET!", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

            ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
            if not ret:
                continue
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
            time.sleep(0.04) # ~25 fps para no sobrecargar el bus de video
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
    return jsonify({"status": "ok", "config": config})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
