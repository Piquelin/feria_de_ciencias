@echo off
title Lanzador - Proyeccion Interactiva YOLO Pose
color 0A

echo ========================================================
echo   PROYECCION INTERACTIVA YOLO POSE - CONFIGURADOR
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
echo [3/3] Verificando e instalando dependencias desde requirements.txt...
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Ocurrio un error al instalar las librerias.
    pause
    exit /b
)

echo.
echo ========================================================
echo   INICIANDO SERVIDOR WEB (Flask + YOLO Pose)
echo ========================================================
echo.
echo   - Accede desde tu navegador a: http://localhost:5001
echo   - Presiona Ctrl+C en esta consola para detener.
echo.

:: Abrir navegador automaticamente despues de 2 segundos
start "" http://localhost:5001

:: Iniciar la aplicacion
python app.py

pause
