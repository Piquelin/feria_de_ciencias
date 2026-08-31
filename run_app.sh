#!/usr/bin/env bash
# Script Bash para Linux / macOS / Git Bash en Windows

set -e

echo "========================================================"
echo "  PROYECCIÓN INTERACTIVA YOLO POSE - LANZADOR BASH"
echo "========================================================"

# Verificar Python
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo "[ERROR] Python no encontrado en el PATH."
    exit 1
fi

PY_CMD=$(command -v python3 || command -v python)

# Crear entorno virtual si no existe
if [ ! -d "venv" ]; then
    echo "[1/3] Creando entorno virtual 'venv'..."
    $PY_CMD -m venv venv
    echo "[OK] Entorno virtual creado."
else
    echo "[OK] Entorno virtual existente detectado."
fi

# Activar entorno
echo "[2/3] Activando entorno virtual..."
if [ -f "venv/Scripts/activate" ]; then
    source venv/Scripts/activate
elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

# Instalar dependencias
echo "[3/3] Instalando dependencias de requirements.txt..."
pip install --upgrade pip --quiet
pip install -r requirements.txt

echo ""
echo "========================================================"
echo "  INICIANDO SERVIDOR WEB (http://localhost:5001)"
echo "========================================================"
echo ""

python app.py
