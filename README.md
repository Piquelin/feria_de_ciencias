# 📽️ Proyección Interactiva con YOLO Pose & Sistema de Partículas

Aplicación visual interactiva en tiempo real diseñada para **charlas, stands de ferias de ciencias, instalaciones interactivas y demostraciones de Visión Computacional Aplicada**.

Utiliza **YOLO Pose (YOLO26 / YOLO11)** para extraer puntos clave corporales y faciales en tiempo real, gobernando dinámicas de viento físico, comunicación aumentativa y videojuegos interactivos de competencia con soporte para 1 y 2 participantes.

---

## 🌟 Modos de la Aplicación

### `[1] Swarm / Vórtice de Partículas`
- Partículas físicas en órbita alrededor del rostro y guiadas por la inclinación de la cabeza.
- **Vectores de Viento Dinámico por Manos/Brazos:** Al levantar uno o ambos brazos, se proyecta un vector de fuerza direccional (nariz ➔ muñecas) que empuja el enjambre de partículas en tiempo real.
- **Limitador Vectorial & Zona Muerta:** Evita corrientes descendentes accidentales cuando los brazos cuelgan en reposo.

### `[2] Tablero Accesible AAC (Tecnología Asistiva)`
- **Demostración de impacto social:** 4 cuadrantes gigantes (`HOLA`, `GRACIAS`, `AGUA`, `AYUDA`) + barra central (`SÍ` / `NO`).
- **Dwell Time:** Al apuntar con la nariz/cabeza durante 0.6s sobre cualquier tarjeta, se selecciona y se **reproduce en voz alta en español (Text-to-Speech)**.

### `[3] 🎮 Juego de Competencia: Reventar Burbujas`
- **Timer de Competencia:** Temporizador calibrable (30s a 120s, 60s por defecto) con cuenta regresiva sonora y visual (**3... 2... 1... ¡YA!**).
- **Modo 1 Jugador o 2 Jugadores (Versus):**
  - **Jugador 1:** Puntero y partículas en **Verde Neón**.
  - **Jugador 2:** Puntero y partículas en **Naranja Fuego**.
  - Puntuación individual y anuncio de ganador al llegar a 0s.
- **Overlay Permanente para Proyección:** El Timer gigante y los puntajes siguen flotando de forma limpia incluso al ocultar el menú con `[H]`.
- **Registro Local de High Scores:** Almacena automáticamente los récords en `hiscores.json` con tabla de consulta (`🏆 VER RÉCORDS`).

---

## ⚙️ Calibración, Control & Rendimiento

| Control / Atajo | Función |
| :--- | :--- |
| **`[1]`, `[2]`, `[3]`** | Alternar entre Modos Visuales (Swarm, Tablero AAC, Juego Burbujas). |
| **`[Espacio]`** | Iniciar / Reiniciar partida de competencia en el juego de burbujas. |
| **`[H]`** | **Ocultar / Mostrar HUD** (deja la proyección limpia; en modo juego el timer y puntos se mantienen visibles). |
| **`[I]`** | **Invertir B/W** (alterna entre Fondo Negro / Fondo Blanco para proyección con luz ambiental). |
| **`[F]`** | Activar / Salir de **Pantalla Completa**. |
| **`[R]`** | Reiniciar partículas y burbujas. |
| **`🔘 Gesto Reset`** | Toggle en HUD para activar/desactivar el reinicio por manos juntas (puños). Desactivado por defecto. |
| **`⏹️ DETENER APP`** | Botón en el HUD para apagar el servidor y liberar la cámara web limpiamente. |

---

## 🚀 Perfiles de Rendimiento (Optimizados para Laptops)

El panel del HUD incluye un selector de perfiles de velocidad con **indicador de latencia en milisegundos (`ms`)** y **FPS en tiempo real**:

- 🚀 **Ultra Rápido (192p + Frame-Skip):** Inferencia ultraliviana para notebooks modestas (como Intel Core i7-4510U en CPU). Tasa de **35-45+ FPS** con latencia de ~15-20ms.
- ⚡ **Turbo CPU (256p):** Rendimiento ágil y equilibrado (~28-35 FPS).
- ⚖️ **Equilibrado (384p):** Excelente definición y estabilidad (~20-25 FPS).
- 🎯 **Alta Precisión (640p):** Resolución nativa completa para equipos con GPU de alta gama.

---

## 💻 Instalación y Puesta en Marcha

### Requisitos Previos
- Python 3.10, 3.11 o 3.12 instalado.
- Cámara web integrada o USB conectada.

### Opción 1: Windows (1 Clic)
Haz doble clic en:
```bat
run_app.bat
```
*(Crea automáticamente el entorno virtual `venv`, instala dependencias, abre el navegador e inicia el servidor).*

### Opción 2: Linux / macOS / Git Bash
```bash
chmod +x run_app.sh
./run_app.sh
```

### Opción 3: Manual por Terminal
```powershell
# 1. Crear y activar entorno virtual
python -m venv venv
venv\Scripts\activate

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Iniciar servidor
python app.py
```
Abre en tu navegador: **`http://localhost:5001`**

---

## ⚡ Aceleración por GPU (NVIDIA CUDA) - Opcional

Si tu notebook o PC cuenta con GPU NVIDIA y deseas aceleración por hardware:
```powershell
pip uninstall -y torch torchvision torchaudio
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```
Al arrancar, `app.py` detectará la GPU automáticamente, realizará un test de verificación seguro (*warmup*) y mostrará la insignia verde **`CUDA`** en el HUD. Si la GPU es muy antigua o no compatible, conmuta automáticamente a **CPU Optimizada** sin interrumpir la aplicación.
