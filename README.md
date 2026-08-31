<<<<<<< HEAD
# feria_de_ciencias
repo para guardar las aplicaciones que vamos a usar en la feria de ciencisa en la plaza de San Martin
=======
# 📽️ Proyección Interactiva con YOLO Pose & Sistema de Partículas

Aplicación visual interactiva en tiempo real diseñada para charlas, stands de ferias, instalaciones interactivas y demostraciones de **Visión Computacional Aplicada**.

Utiliza **YOLO Pose (YOLO26 / YOLO11)** para extraer puntos clave corporales y faciales en tiempo real, gobernando dinámicas de viento físico, comunicación aumentativa y videojuegos asistivos.

---

## 🌟 Características y Modos

1. **Vectores de Viento por Brazos / Puños:**
   - Vector dinámico con origen en la nariz y destino en la(s) muñeca(s)/mano(s).
   - **Suma Vectorial con Dos Manos:** Levantar ambos brazos calcula la fuerza y dirección resultante de viento.
   - **Control de Desbalance (Vector Cap):** Longitud máxima limitada (`0.35`) y atenuación de brazos en reposo para evitar corrientes descendentes involuntarias.
   - **Calibración Global:** Fricción `0.88`, Velocidad máxima `8.0`, Fuerza de viento `1.5x`, Radio `155px`.
   - **Reinicio por Gesto:** Juntar ambas manos/muñecas frente a la cámara (🙌) reinicia el enjambre o el juego.

2. **3 Modos para la Demostración / Feria:**
   - `[1] Swarm / Vórtice`: Partículas en órbita alrededor del rostro impulsadas con precisión por los vectores de las manos.
   - `[2] Cuadrante Accesible (AAC)`: **Demostración de Impacto Real (Tecnología Asistiva)**. 4 grandes zonas (HOLA, GRACIAS, AGUA, AYUDA) + SÍ/NO central. Al mirar/apuntar con la cabeza hacia una zona durante solo 0.6s, el sistema la selecciona y la **reproduce en voz alta (Text-to-Speech en español)**.
   - `[3] 🎮 Juego: Reventar Burbujas`: Burbujas flotantes que el usuario debe **tocar y reventar con la nariz/cabeza**, con contador de puntuación y explosiones de chispas en tiempo real.

3. **Optimización para Proyección:**
   - `[I] Invertir B/W`: Alterna al instante entre **Fondo Negro con Partículas Blancas** y **Fondo Blanco con Tinta Negra Sólida**.
   - `[F] Pantalla Completa`: Vista limpia y sin bordes.
   - `[H] Ocultar HUD`: Esconde los controles y sliders para proyección artística inmersiva pura.
   - `[R] o Gesto 🙌`: Reiniciar partículas o juego.

---

## 🚀 Instalación y Ejecución en otra Notebook

### Opción A (Recomendada en Windows - 1 Clic)
Simplemente haz doble clic en:
```bat
run_app.bat
```
*(El script creará automáticamente el entorno virtual `venv`, instalará los requerimientos, abrirá el navegador y levantará el servidor).*

### Opción B (Linux / macOS / Git Bash)
```bash
chmod +x run_app.sh
./run_app.sh
```

### Opción C (Manual con Terminal)
1. Clona el repositorio y entra en la carpeta:
```bash
git clone <URL_DEL_REPOSITORIO>
cd app_yolo_projection
```
2. Crea y activa tu entorno virtual:
```bash
python -m venv venv
# En Windows:
venv\Scripts\activate
# En Linux/Mac:
source venv/bin/activate
```
3. Instala las dependencias:
```bash
pip install -r requirements.txt
```
4. Ejecuta la aplicación:
```bash
python app.py
```
5. Abre en tu navegador: **http://localhost:5001**

>>>>>>> d9fdcf1 (Initial commit: Proyeccion Interactiva YOLO Pose & Modos Feria de Ciencias)
