# 🚀 YOLO26 Multi-Vision Explorer v2 (Malla Triple 16:9 & Proyección)

Aplicación interactiva de Visión Computacional para **charlas, auditorios y proyecciones en pantallas 16:9**. Permite desplegar simultáneamente los 3 modelos principales de **YOLOv26** (Pose de 17 keypoints, Segmentación COCO y Estimación Métrica de Profundidad Depth) en una **Malla Triple panorámica 16:9**, alternando libremente cuál modelo va en el panel principal grande, o proyectando cualquiera de ellos de forma individual a pantalla completa.

---

## 🌟 Características de la Versión 16:9 (v2.1)

1. **⚡ Malla Triple Panorámica 16:9 (1280x720)**:
   - **Panel Principal Grande (Izquierda)**: Ranura de alta visibilidad (850x720) para el modelo protagonista.
   - **Paneles Secundarios Apilados (Derecha)**: Dos ranuras compactas (426x358 cada una) para los otros 2 modelos de apoyo.
   - **Intercambio Dinámico de Ranura Principal**:
     - 🦴 **Pose Principal** (Seg y Depth a la derecha)
     - 🎨 **Segmentación Principal** (Pose y Depth a la derecha)
     - 🌊 **Depth Principal** (Pose y Seg a la derecha)
     - *Atajo en proyector: Tecla **`[T]`** o **`[Tab]`** para rotar al instante.*

2. **🔍 Vistas Individuales en 16:9**:
   - `[1]` **Malla Triple (16:9)**
   - `[2]` **Solo Pose (16:9 Completo)**
   - `[3]` **Solo Segmentación (16:9 Completo)**
   - `[4]` **Solo Depth Estimation (16:9 Completo)**

3. **☀️ Modos de Alto Contraste para Proyectores**:
   - **Doble Trazo en Anotaciones**: Halo oscuro + núcleo neón brillante para legibilidad total ante cualquier iluminación ambiental.
   - **Tema Auditorio Diurno (Fondo Claro)** y **Tema Neón Cyber-Dark** alternables con la tecla **`[C]`**.

4. **⏸️ Congelamiento / Pausa Explicativa (`[Espacio]`)**:
   - Congela el frame analizado en vivo para explicar al público sin perder la detección.

5. **🛑 Botones de Cierre Rápido y Limpieza**:
   - Botón rojo en Navbar: **`[🛑 Cerrar App]`**.
   - En Proyector: Botón **`[✕ Cerrar]`** y atajo **`[Q]`** o **`[Esc]`**.
   - Libera la webcam inmediatamente y finaliza los hilos de inferencia.

---

## 🎮 Atajos de Teclado en Modo Proyección (`/projection`)

| Tecla | Acción | Descripción |
| :--- | :--- | :--- |
| **`[1]`** | **Malla Triple 16:9** | Vista comparativa panorámica de los 3 modelos |
| **`[2]`** | **Solo Pose** | Expande YOLO26 Pose a 16:9 completo |
| **`[3]`** | **Solo Segmentación** | Expande YOLO26 Segmentación a 16:9 completo |
| **`[4]`** | **Solo Depth** | Expande YOLO26 Depth Estimation a 16:9 completo |
| **`[T]` o `[Tab]`** | **Rotar Principal** | Rota el modelo protagonista en la ranura grande |
| **`[Espacio]`** | **Pausa / Freeze** | Congela / Reanuda el video en vivo |
| **`[C]`** | **Alto Contraste** | Alterna entre Modo Neón y Modo Auditorio Claro |
| **`[M]`** | **Espejo (Mirror)** | Invierte horizontalmente la cámara |
| **`[F]`** | **Pantalla Completa** | Activa / desactiva pantalla completa 16:9 |
| **`[H]`** | **Ocultar / Mostrar OSD**| Oculta métricas para dejar video limpio |
| **`[Q]` / `[Esc]`** | **Salir** | Cierra la ventana de proyección |

---

## 🚀 Inicio Rápido

Haz doble clic en:
```bat
run_app.bat
```

- **Panel de Control:** `http://localhost:5002`
- **Vista de Proyección 16:9:** `http://localhost:5002/projection`
