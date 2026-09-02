@echo off
title Lanzador - YOLO26 Multi-Vision Explorer v2 (Dual & Proyeccion)
color 0B

echo ========================================================
echo   YOLO26 MULTI-VISION EXPLORER v2 - LANZADOR
echo   (Pose + Segmentacion / Depth + Vista Proyeccion)
echo ========================================================
echo.

:: 1. Verificar si Python esta instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no se encuentra instalado o no esta en el PATH.
    echo Por favor instala Python 3.10 o superior desde https://www.python.org/
    pause
    exit /b
)

:: 2. Crear entorno virtual si no existe
if not exist "venv" (
    echo [1/3] Creando entorno virtual 'venv'...
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] No se pudo crear el entorno virtual.
        pause
        exit /b
    )
    echo [OK] Entorno virtual creado exitosamente.
) else (
    echo [OK] Entorno virtual existente detectado.
)

:: 3. Activar entorno virtual
echo [2/3] Activando entorno virtual...
call venv\Scripts\activate.bat

:: 4. Instalar o actualizar requerimientos
echo [3/3] Verificando dependencias desde requirements.txt...
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo [ERROR] Ocurrio un error al verificar las librerias.
    pause
    exit /b
)

echo.
echo ========================================================
echo   INICIANDO SERVIDOR WEB (Puerto 5002)
echo ========================================================
echo.
echo   - Panel Operador:   http://localhost:5002
echo   - Vista Proyeccion: http://localhost:5002/projection
echo.

:: Abrir navegador automaticamente
timeout /t 2 /nobreak >nul
start "" http://localhost:5002

:: Iniciar la aplicacion Flask
python app.py
pause
