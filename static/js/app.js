/**
 * App Controller: Conexión SSE, HUD, atajos de teclado y loop de animación
 */
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('projectionCanvas');
    const hud = document.getElementById('hudContainer');
    const toast = document.getElementById('toastMsg');
    const statusDot = document.getElementById('statusDot');
    const fpsDisplay = document.getElementById('fpsDisplay');
    const faceCountDisplay = document.getElementById('faceCountDisplay');
    const modeBtns = document.querySelectorAll('.mode-btn');

    // Instanciar motor de partículas
    const engine = new ParticleEngine(canvas);

    // Ajustar tamaño al redimensionar ventana
    window.addEventListener('resize', () => engine.resize());

    // Mensajes flotantes informativos
    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // Callback cuando se detecta el gesto de juntar los dos brazos/muñecas
    window.onParticleResetGesture = () => {
        showToast('🙌 ¡GESTO DETECTADO! REINICIANDO PARTÍCULAS');
    };

    // Conectar Sliders de Calibración en Vivo
    const vortexSlider = document.getElementById('vortexRadiusSlider');
    const vortexVal = document.getElementById('vortexVal');
    const windSlider = document.getElementById('windStrengthSlider');
    const windVal = document.getElementById('windVal');
    const speedSlider = document.getElementById('maxSpeedSlider');
    const speedVal = document.getElementById('speedVal');
    const frictionSlider = document.getElementById('frictionSlider');
    const frictionVal = document.getElementById('frictionVal');

    if (vortexSlider) {
        vortexSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.params.vortexRadius = val;
            vortexVal.textContent = `${val}px`;
        });
    }

    if (windSlider) {
        windSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.params.windStrength = val;
            windVal.textContent = `${val.toFixed(1)}x`;
        });
    }

    if (speedSlider) {
        speedSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.params.maxSpeed = val;
            speedVal.textContent = `${val.toFixed(1)}`;
        });
    }

    if (frictionSlider) {
        frictionSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.params.friction = val;
            frictionVal.textContent = `${val.toFixed(2)}`;
        });
    }

    // Elementos de Modos Interactivos
    const quadrantPanel = document.getElementById('quadrantPanel');
    const quadrantOutput = document.getElementById('quadrantOutput');
    const gameHudPanel = document.getElementById('gameHudPanel');
    const gameScoreEl = document.getElementById('gameScore');
    const faceCursor = document.getElementById('faceCursorIndicator');

    // Callback de reventar burbuja
    window.onBubblePopped = (score) => {
        if (gameScoreEl) gameScoreEl.textContent = score;
    };

    function speakText(text) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'es-ES';
            utterance.rate = 0.95;
            window.speechSynthesis.speak(utterance);
        }
        showToast(`🔊 ${text}`);
    }

    // Selector de Modos Visuales
    function switchMode(modeName) {
        engine.setMode(modeName);
        modeBtns.forEach(btn => {
            if (btn.dataset.mode === modeName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Actualizar sliders del HUD
        if (engine.modeParams[modeName]) {
            const p = engine.modeParams[modeName];
            if (vortexSlider) { vortexSlider.value = p.vortexRadius; vortexVal.textContent = `${p.vortexRadius}px`; }
            if (windSlider) { windSlider.value = p.windStrength; windVal.textContent = `${p.windStrength.toFixed(1)}x`; }
            if (speedSlider) { speedSlider.value = p.maxSpeed; speedVal.textContent = `${p.maxSpeed.toFixed(1)}`; }
            if (frictionSlider) { frictionSlider.value = p.friction; frictionVal.textContent = `${p.friction.toFixed(2)}`; }
        }

        // Mostrar / Ocultar Paneles
        if (modeName === 'quadrant') {
            quadrantPanel.classList.remove('hidden');
            gameHudPanel.classList.add('hidden');
            showToast('MODO 3: TABLERO CUADRANTE ACCESIBLE (SEÑALA CON LA CABEZA)');
        } else if (modeName === 'bubbles') {
            quadrantPanel.classList.add('hidden');
            gameHudPanel.classList.remove('hidden');
            engine.initBubbles();
            showToast('MODO 4: 🎮 JUEGO: ¡REVIENTA BURBUJAS CON LA NARIZ!');
        } else {
            quadrantPanel.classList.add('hidden');
            gameHudPanel.classList.add('hidden');
            showToast(`MODO: ${modeName.toUpperCase()}`);
        }
    }

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    // Invertir esquema B&W (Fondo Negro / Fondo Blanco para luz solar)
    let isInverted = false;
    function toggleInversion() {
        isInverted = !isInverted;
        document.body.classList.toggle('inverted', isInverted);
        engine.setInverted(isInverted);
        showToast(isInverted ? 'MODO DÍA: NEGRO SOBRE BLANCO' : 'MODO NOCHE: BLANCO SOBRE NEGRO');
    }

    // Toggle HUD para limpieza total en proyector
    let hudVisible = true;
    function toggleHud() {
        hudVisible = !hudVisible;
        hud.classList.toggle('hidden', !hudVisible);
        showToast(hudVisible ? 'HUD VISIBLE' : 'HUD OCULTO (MODO PROYECCIÓN)');
    }

    // Toggle Pantalla Completa
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => console.log(err));
            showToast('PANTALLA COMPLETA ACTIVADA');
        } else {
            document.exitFullscreen().catch(err => console.log(err));
            showToast('PANTALLA COMPLETA DESACTIVADA');
        }
    }

    // Manejo de atajos de teclado
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (key === '1') switchMode('swarm');
        else if (key === '2') switchMode('quadrant');
        else if (key === '3') switchMode('bubbles');
        else if (key === 'i') toggleInversion();
        else if (key === 'h') toggleHud();
        else if (key === 'f') toggleFullscreen();
        else if (key === 'r') {
            engine.initParticles();
            if (engine.mode === 'bubbles') engine.initBubbles();
            showToast('REINICIADO');
        }
    });

    // DWELL SELECTION para el Tablero Cuadrante Accesible
    let currentHoveredQuad = null;
    let quadDwellStartTime = 0;
    const QUAD_DWELL_TIME = 600; // 600ms para seleccionar cuadrante grande con la cabeza

    function updateInteractiveSelections() {
        const cx = engine.cursor.x;
        const cy = engine.cursor.y;

        // Mostrar / Ocultar puntero visual según el modo
        if (engine.cursor.active && (engine.mode === 'quadrant' || engine.mode === 'bubbles')) {
            faceCursor.style.display = 'block';
            faceCursor.style.left = `${cx}px`;
            faceCursor.style.top = `${cy}px`;
        } else {
            faceCursor.style.display = 'none';
        }

        if (engine.mode !== 'quadrant' || !engine.cursor.active) {
            if (currentHoveredQuad) {
                clearQuadDwell(currentHoveredQuad);
                currentHoveredQuad = null;
            }
            return;
        }

        // Detectar colisión con tarjetas de cuadrantes y botones centrales
        const allTargets = document.querySelectorAll('.quadrant-card, .quad-center-btn');
        let hitTarget = null;

        allTargets.forEach(card => {
            const rect = card.getBoundingClientRect();
            if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
                hitTarget = card;
            }
        });

        if (hitTarget) {
            if (currentHoveredQuad !== hitTarget) {
                if (currentHoveredQuad) clearQuadDwell(currentHoveredQuad);
                currentHoveredQuad = hitTarget;
                quadDwellStartTime = Date.now();
                hitTarget.classList.add('targeted');
            }

            const elapsed = Date.now() - quadDwellStartTime;
            const progress = Math.min(elapsed / QUAD_DWELL_TIME, 1.0);
            const fill = hitTarget.querySelector('.dwell-fill');
            if (fill) fill.style.width = `${progress * 100}%`;

            if (progress >= 1.0) {
                // Selección completada
                hitTarget.classList.add('selected');
                setTimeout(() => hitTarget.classList.remove('selected'), 250);

                const msg = hitTarget.dataset.msg;
                if (msg) {
                    quadrantOutput.textContent = `SELECCIONADO: "${msg}"`;
                    speakText(msg);
                }

                quadDwellStartTime = Date.now() + 600; // Cooldown para evitar disparos repetidos
                if (fill) fill.style.width = '0%';
            }
        } else {
            if (currentHoveredQuad) {
                clearQuadDwell(currentHoveredQuad);
                currentHoveredQuad = null;
            }
        }
    }

    function clearQuadDwell(el) {
        el.classList.remove('targeted', 'selected');
        const fill = el.querySelector('.dwell-fill');
        if (fill) fill.style.width = '0%';
    }

    // Conexión SSE con Backend Python Flask
    let evtSource = null;
    function connectSSE() {
        evtSource = new EventSource('/stream_data');

        evtSource.onopen = () => {
            statusDot.className = 'status-dot active';
        };

        evtSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                engine.updateTracking(data);

                // Actualizar métricas del HUD
                if (data.fps !== undefined) fpsDisplay.textContent = data.fps;
                if (data.faces) faceCountDisplay.textContent = data.faces.length;

                if (data.detected) {
                    statusDot.className = 'status-dot tracking';
                } else {
                    statusDot.className = 'status-dot active';
                }
            } catch (err) {
                console.error("Error parseando SSE:", err);
            }
        };

        evtSource.onerror = () => {
            statusDot.className = 'status-dot';
            evtSource.close();
            setTimeout(connectSSE, 2000); // Reintentar reconexión
        };
    }

    connectSSE();

    // Loop de animación 60 FPS
    function animate() {
        engine.update();
        engine.render();
        updateInteractiveSelections();
        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
});
