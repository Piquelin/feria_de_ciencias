#!/usr/bin/env bash

echo "========================================================"
echo "  YOLO26 MULTI-VISION EXPLORER v2 - LANZADOR (Bash)"
echo "  (Pose + Segmentacion / Depth + Vista Proyeccion)"
echo "========================================================"
echo ""

# 1. Verificar Python 3
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] python3 no esta instalado o no se encuentra en el PATH."
    exit 1
fi

# 2. Entorno virtual
if [ ! -d "venv" ]; then
    echo "[1/3] Creando entorno virtual 'venv'..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "[ERROR] Fallo al crear entorno virtual."
        exit 1
    fi
fi

# 3. Activar venv
echo "[2/3] Activando entorno virtual..."
source venv/bin/activate

# 4. Dependencias
echo "[3/3] Verificando dependencias..."
pip install -r requirements.txt --quiet

echo ""
echo "========================================================"
echo "  INICIANDO SERVIDOR WEB (Puerto 5002)"
echo "========================================================"
echo "  - Panel Operador:   http://localhost:5002"
echo "  - Vista Proyeccion: http://localhost:5002/projection"
echo ""

python3 app.py
