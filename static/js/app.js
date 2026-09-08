/**
 * App Controller: Conexión SSE, HUD, juego con timer de competencia, modo versus 2P,
 * persistencia de Highscores y apagado limpio del servidor.
 */
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('projectionCanvas');
    const hud = document.getElementById('hudContainer');
    const toast = document.getElementById('toastMsg');
    const statusDot = document.getElementById('statusDot');
    const fpsDisplay = document.getElementById('fpsDisplay');
    const latencyDisplay = document.getElementById('latencyDisplay');
    const faceCountDisplay = document.getElementById('faceCountDisplay');
    const deviceBadge = document.getElementById('deviceBadge');
    const modeBtns = document.querySelectorAll('.mode-btn');

    // Cursors
    const faceCursor = document.getElementById('faceCursorIndicator');
    const faceCursorP2 = document.getElementById('faceCursorIndicatorP2');

    // Paneles
    const quadrantPanel = document.getElementById('quadrantPanel');
    const quadrantOutput = document.getElementById('quadrantOutput');
    const gameControlPanel = document.getElementById('gameControlPanel');
    const gameFloatingOverlay = document.getElementById('gameFloatingOverlay');

    // Elementos del Juego
    const gameTimerValue = document.getElementById('gameTimerValue');
    const scoreP1El = document.getElementById('scoreP1');
    const scoreP2El = document.getElementById('scoreP2');
    const scoreCardP2 = document.getElementById('scoreCardP2');
    const gameBigNotice = document.getElementById('gameBigNotice');
    const gameBigNoticeText = document.getElementById('gameBigNoticeText');

    // Controles de Juego en HUD
    const btnMode1P = document.getElementById('btnMode1P');
    const btnMode2P = document.getElementById('btnMode2P');
    const gameDurationSlider = document.getElementById('gameDurationSlider');
    const timerSettingVal = document.getElementById('timerSettingVal');
    const btnStartGame = document.getElementById('btnStartGame');
    const btnViewHiscores = document.getElementById('btnViewHiscores');

    // Modal Hiscores
    const hiscoresModal = document.getElementById('hiscoresModal');
    const closeHiscoresBtn = document.getElementById('closeHiscoresBtn');
    const hiscoresTableBody = document.getElementById('hiscoresTableBody');
    const btnNewGameFromModal = document.getElementById('btnNewGameFromModal');

    // Controles de Calibración
    const inferenceSizeSelect = document.getElementById('inferenceSizeSelect');
    const gestureResetToggle = document.getElementById('gestureResetToggle');
    const btnShutdown = document.getElementById('btnShutdown');

    const vortexSlider = document.getElementById('vortexRadiusSlider');
    const vortexVal = document.getElementById('vortexVal');
    const windSlider = document.getElementById('windStrengthSlider');
    const windVal = document.getElementById('windVal');
    const speedSlider = document.getElementById('maxSpeedSlider');
    const speedVal = document.getElementById('speedVal');
    const frictionSlider = document.getElementById('frictionSlider');
    const frictionVal = document.getElementById('frictionVal');

    const smoothingSlider = document.getElementById('smoothingSlider');
    const smoothingVal = document.getElementById('smoothingVal');
    const confidenceSlider = document.getElementById('confidenceSlider');
    const confVal = document.getElementById('confVal');
    const btnResetTracking = document.getElementById('btnResetTracking');
    const windOriginSelect = document.getElementById('windOriginSelect');

    // Instanciar motor de partículas
    const engine = new ParticleEngine(canvas);
    window.addEventListener('resize', () => engine.resize());

    // Estado del juego
    let isMultiplayer = false;
    let gameDurationSeconds = 60;
    let timeRemaining = 60;
    let gameTimerInterval = null;
    let gameState = 'idle'; // 'idle', 'countdown', 'playing', 'finished'

    function showToast(msg) {
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function speakText(text) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'es-ES';
            utterance.rate = 1.0;
            window.speechSynthesis.speak(utterance);
        }
    }

    // Callbacks del Motor de Partículas
    window.onParticleResetGesture = () => {
        showToast('🙌 ¡GESTO DETECTADO! REINICIANDO PARTÍCULAS');
    };

    window.onBubblePopped = (p1Score, p2Score, playerHit) => {
        if (scoreP1El) scoreP1El.textContent = p1Score;
        if (scoreP2El) scoreP2El.textContent = p2Score;
    };

    // Sliders de Calibración
    if (vortexSlider) {
        vortexSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.params.vortexRadius = val;
            if (vortexVal) vortexVal.textContent = `${val}px`;
        });
    }

    if (windSlider) {
        windSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.params.windStrength = val;
            if (windVal) windVal.textContent = `${val.toFixed(1)}x`;
        });
    }

    if (speedSlider) {
        speedSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.params.maxSpeed = val;
            if (speedVal) speedVal.textContent = `${val.toFixed(1)}`;
        });
    }

    if (frictionSlider) {
        frictionSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            engine.params.friction = val;
            if (frictionVal) frictionVal.textContent = `${val.toFixed(2)}`;
        });
    }

    // Toggle de Gesto de Reset
    if (gestureResetToggle) {
        gestureResetToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            fetch('/config', {
                method: 'POST',
                body: JSON.stringify({ enable_gesture_reset: enabled })
            }).then(() => {
                showToast(enabled ? 'GESTO RESET: ACTIVADO' : 'GESTO RESET: DESACTIVADO');
            });
        });
    }

    // Calibración de Suavizado 1€ (One Euro Filter)
    const smoothingPresets = {
        1: { label: 'Ultra Rápido', minCutoff: 2.5, beta: 0.020 },
        2: { label: 'Reactivo', minCutoff: 1.8, beta: 0.012 },
        3: { label: 'Equilibrado', minCutoff: 1.2, beta: 0.008 },
        4: { label: 'Estable', minCutoff: 0.8, beta: 0.005 },
        5: { label: 'Ultra Estable (AAC)', minCutoff: 0.5, beta: 0.002 }
    };

    if (smoothingSlider) {
        smoothingSlider.addEventListener('input', (e) => {
            const level = parseInt(e.target.value);
            const preset = smoothingPresets[level] || smoothingPresets[3];
            engine.setSmoothingParams(preset.minCutoff, preset.beta);
            if (smoothingVal) smoothingVal.textContent = preset.label;
            showToast(`PUNTERO (1€): ${preset.label.toUpperCase()}`);
        });
    }

    // Slider de Umbral de Confianza YOLO
    if (confidenceSlider) {
        confidenceSlider.addEventListener('change', (e) => {
            const conf = parseFloat(e.target.value) / 100.0;
            if (confVal) confVal.textContent = `${e.target.value}%`;
            fetch('/config', {
                method: 'POST',
                body: JSON.stringify({ confidence_thresh: conf })
            }).then(() => {
                showToast(`CONFIANZA YOLO: ${e.target.value}%`);
            });
        });
        confidenceSlider.addEventListener('input', (e) => {
            if (confVal) confVal.textContent = `${e.target.value}%`;
        });
    }

    // Botón de Reasignación Manual de Identidades (Reset Tracking)
    if (btnResetTracking) {
        btnResetTracking.addEventListener('click', (e) => {
            e.stopPropagation();
            fetch('/reset_tracking', { method: 'POST' })
                .then(res => res.json())
                .then(() => {
                    engine.initParticles();
                    showToast('🔄 TRACKING REINICIADO (REASIGNANDO JUGADORES)');
                })
                .catch(() => {
                    showToast('Tracking reiniciado.');
                });
        });
    }

    // Selector de Origen de Vector Viento / Manos (Hombros vs Nariz)
    if (windOriginSelect) {
        windOriginSelect.addEventListener('change', (e) => {
            const originMode = e.target.value;
            fetch('/config', {
                method: 'POST',
                body: JSON.stringify({ wind_origin: originMode })
            }).then(() => {
                const label = originMode === 'shoulders' ? 'CENTRO DE HOMBROS' : 'NARIZ';
                showToast(`ORIGEN VIENTO: ${label}`);
            });
        });
    }

    // Selector de Calidad / Inferencia con frame-skip adaptativo
    if (inferenceSizeSelect) {
        inferenceSizeSelect.addEventListener('change', (e) => {
            const sz = parseInt(e.target.value);
            // Si es 192p activar frame_skip=2 para vuelo supersónico
            const skip = (sz === 192) ? 2 : 1;
            fetch('/config', {
                method: 'POST',
                body: JSON.stringify({ inference_size: sz, frame_skip: skip })
            }).then(() => {
                const label = (sz === 192) ? '192p (ULTRA RÁPIDO)' : (sz === 256 ? '256p (TURBO)' : (sz === 384 ? '384p (EQUILIBRADO)' : '640p (ALTA PRECISIÓN)'));
                showToast(`PERFIL YOLO: ${label}`);
            });
        });
    }

    // Botón de Apagado Limpio
    if (btnShutdown) {
        btnShutdown.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('¿Deseas apagar el servidor y liberar la cámara web?')) {
                fetch('/shutdown', { method: 'POST' })
                    .then(res => res.json())
                    .then(data => {
                        document.body.innerHTML = `
                            <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;background:#000;color:#fff;font-family:sans-serif;text-align:center;">
                                <h1 style="color:#00ff88;margin-bottom:12px;">✅ APLICACIÓN DETENIDA CORRECTAMENTE</h1>
                                <p style="font-size:1.2rem;opacity:0.8;">La cámara fue liberada y el proceso se cerró.</p>
                                <p style="margin-top:20px;color:#888;">Ya puedes cerrar esta pestaña del navegador.</p>
                            </div>
                        `;
                    })
                    .catch(() => {
                        showToast('Servidor detenido.');
                    });
            }
        });
    }

    // Selector de Modos de Juego (1P vs 2P)
    if (btnMode1P && btnMode2P) {
        btnMode1P.addEventListener('click', () => {
            isMultiplayer = false;
            engine.setMultiplayer(false);
            btnMode1P.classList.add('active');
            btnMode2P.classList.remove('active');
            if (scoreCardP2) scoreCardP2.classList.add('hidden');
            showToast('MODO: 1 PARTICIPANTE');
        });

        btnMode2P.addEventListener('click', () => {
            isMultiplayer = true;
            engine.setMultiplayer(true);
            btnMode2P.classList.add('active');
            btnMode1P.classList.remove('active');
            if (scoreCardP2) scoreCardP2.classList.remove('hidden');
            showToast('MODO: 2 PARTICIPANTES (VERSUS)');
        });
    }

    // Slider de Duración del Juego
    if (gameDurationSlider) {
        gameDurationSlider.addEventListener('input', (e) => {
            gameDurationSeconds = parseInt(e.target.value);
            if (timerSettingVal) timerSettingVal.textContent = `${gameDurationSeconds}s`;
            if (gameState === 'idle') {
                updateTimerDisplay(gameDurationSeconds);
            }
        });
    }

    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function updateTimerDisplay(sec) {
        if (gameTimerValue) {
            gameTimerValue.textContent = formatTime(sec);
            if (sec <= 10 && gameState === 'playing') {
                gameTimerValue.classList.add('urgent');
            } else {
                gameTimerValue.classList.remove('urgent');
            }
        }
    }

    // Control de Partida de Burbujas
    function startGameCountdown() {
        if (gameState === 'countdown' || gameState === 'playing') return;
        
        gameState = 'countdown';
        engine.initBubbles();
        if (scoreP1El) scoreP1El.textContent = '0';
        if (scoreP2El) scoreP2El.textContent = '0';
        timeRemaining = gameDurationSeconds;
        updateTimerDisplay(timeRemaining);

        if (gameBigNotice) gameBigNotice.classList.remove('hidden');
        let count = 3;
        if (gameBigNoticeText) gameBigNoticeText.textContent = count;
        speakText(`${count}`);

        const countInterval = setInterval(() => {
            count--;
            if (count > 0) {
                if (gameBigNoticeText) gameBigNoticeText.textContent = count;
                speakText(`${count}`);
            } else if (count === 0) {
                if (gameBigNoticeText) gameBigNoticeText.textContent = '¡YA!';
                speakText('¡A jugar!');
            } else {
                clearInterval(countInterval);
                if (gameBigNotice) gameBigNotice.classList.add('hidden');
                beginGameRun();
            }
        }, 1000);
    }

    function beginGameRun() {
        gameState = 'playing';
        if (btnStartGame) btnStartGame.textContent = '⏹ REINICIAR PARTIDA';

        if (gameTimerInterval) clearInterval(gameTimerInterval);
        
        gameTimerInterval = setInterval(() => {
            timeRemaining--;
            updateTimerDisplay(timeRemaining);

            if (timeRemaining === 10) {
                speakText('¡Últimos diez segundos!');
            }

            if (timeRemaining <= 0) {
                clearInterval(gameTimerInterval);
                finishGame();
            }
        }, 1000);
    }

    function finishGame() {
        gameState = 'finished';
        if (btnStartGame) btnStartGame.textContent = '▶ INICIAR PARTIDA';
        
        const p1 = engine.gameScoreP1;
        const p2 = engine.gameScoreP2;

        let winnerText = '';
        let winnerMsg = '';

        if (isMultiplayer) {
            if (p1 > p2) {
                winnerText = `🏆 ¡GANADOR JUGADOR 1! (${p1} vs ${p2})`;
                winnerMsg = '¡Ganador Jugador 1!';
            } else if (p2 > p1) {
                winnerText = `🏆 ¡GANADOR JUGADOR 2! (${p2} vs ${p1})`;
                winnerMsg = '¡Ganador Jugador 2!';
            } else {
                winnerText = `🤝 ¡EMPATE! (${p1} - ${p2})`;
                winnerMsg = '¡Empate!';
            }
        } else {
            winnerText = `🎉 ¡FIN DEL TIEMPO! Puntos: ${p1}`;
            winnerMsg = `¡Fin del tiempo! Reventaste ${p1} burbujas.`;
        }

        if (gameBigNoticeText) gameBigNoticeText.textContent = winnerText;
        if (gameBigNotice) gameBigNotice.classList.remove('hidden');
        speakText(winnerMsg);

        saveHighScore(p1, p2);

        setTimeout(() => {
            if (gameBigNotice) gameBigNotice.classList.add('hidden');
            loadAndShowHiscores();
        }, 3500);
    }

    function saveHighScore(score1, score2) {
        const record = {
            mode: isMultiplayer ? '2 Jugadores (Versus)' : '1 Jugador',
            duration: `${gameDurationSeconds}s`,
            score_p1: score1,
            score_p2: score2,
            winner: isMultiplayer ? (score1 > score2 ? 'Jugador 1' : (score2 > score1 ? 'Jugador 2' : 'Empate')) : 'Jugador 1'
        };

        fetch('/api/hiscores', {
            method: 'POST',
            body: JSON.stringify(record)
        }).catch(err => console.error('Error guardando hiscore:', err));
    }

    function loadAndShowHiscores() {
        fetch('/api/hiscores')
            .then(res => res.json())
            .then(data => {
                const scores = data.scores || [];
                if (hiscoresTableBody) {
                    hiscoresTableBody.innerHTML = '';
                    if (scores.length === 0) {
                        hiscoresTableBody.innerHTML = '<tr><td colspan="6">No hay partidas registradas aún.</td></tr>';
                    } else {
                        scores.forEach((s, idx) => {
                            const tr = document.createElement('tr');
                            const totalScore = s.mode.includes('2') ? `P1: ${s.score_p1} | P2: ${s.score_p2}` : `${s.score_p1}`;
                            tr.innerHTML = `
                                <td><strong>#${idx + 1}</strong></td>
                                <td>${s.mode}</td>
                                <td>${s.duration}</td>
                                <td class="table-score">${totalScore}</td>
                                <td>${s.winner}</td>
                                <td style="font-size:0.75rem;opacity:0.7;">${s.timestamp || '-'}</td>
                            `;
                            hiscoresTableBody.appendChild(tr);
                        });
                    }
                }
                if (hiscoresModal) hiscoresModal.classList.remove('hidden');
            });
    }

    if (btnStartGame) {
        btnStartGame.addEventListener('click', () => {
            if (gameState === 'playing' || gameState === 'countdown') {
                if (gameTimerInterval) clearInterval(gameTimerInterval);
                gameState = 'idle';
                btnStartGame.textContent = '▶ INICIAR PARTIDA';
                if (gameBigNotice) gameBigNotice.classList.add('hidden');
                updateTimerDisplay(gameDurationSeconds);
            } else {
                startGameCountdown();
            }
        });
    }

    if (btnViewHiscores) {
        btnViewHiscores.addEventListener('click', loadAndShowHiscores);
    }

    if (closeHiscoresBtn) {
        closeHiscoresBtn.addEventListener('click', () => {
            if (hiscoresModal) hiscoresModal.classList.add('hidden');
        });
    }

    if (btnNewGameFromModal) {
        btnNewGameFromModal.addEventListener('click', () => {
            if (hiscoresModal) hiscoresModal.classList.add('hidden');
            startGameCountdown();
        });
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
            if (vortexSlider) { vortexSlider.value = p.vortexRadius; if (vortexVal) vortexVal.textContent = `${p.vortexRadius}px`; }
            if (windSlider) { windSlider.value = p.windStrength; if (windVal) windVal.textContent = `${p.windStrength.toFixed(1)}x`; }
            if (speedSlider) { speedSlider.value = p.maxSpeed; if (speedVal) speedVal.textContent = `${p.maxSpeed.toFixed(1)}`; }
            if (frictionSlider) { frictionSlider.value = p.friction; if (frictionVal) frictionVal.textContent = `${p.friction.toFixed(2)}`; }
        }

        // Mostrar / Ocultar Paneles
        if (modeName === 'quadrant') {
            if (quadrantPanel) quadrantPanel.classList.remove('hidden');
            if (gameControlPanel) gameControlPanel.classList.add('hidden');
            if (gameFloatingOverlay) gameFloatingOverlay.classList.add('hidden');
            showToast('MODO 2: TABLERO CUADRANTE ACCESIBLE');
        } else if (modeName === 'bubbles') {
            if (quadrantPanel) quadrantPanel.classList.add('hidden');
            if (gameControlPanel) gameControlPanel.classList.remove('hidden');
            if (gameFloatingOverlay) gameFloatingOverlay.classList.remove('hidden');
            engine.initBubbles();
            updateTimerDisplay(gameDurationSeconds);
            showToast('MODO 3: 🎮 JUEGO DE BURBUJAS');
        } else {
            if (quadrantPanel) quadrantPanel.classList.add('hidden');
            if (gameControlPanel) gameControlPanel.classList.add('hidden');
            if (gameFloatingOverlay) gameFloatingOverlay.classList.add('hidden');
            showToast('MODO 1: SWARM / VÓRTICE');
        }
    }

    modeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            switchMode(btn.dataset.mode);
        });
    });

    // Invertir B/W
    let isInverted = false;
    function toggleInversion() {
        isInverted = !isInverted;
        document.body.classList.toggle('inverted', isInverted);
        engine.setInverted(isInverted);
        showToast(isInverted ? 'MODO DÍA: NEGRO SOBRE BLANCO' : 'MODO NOCHE: BLANCO SOBRE NEGRO');
    }

    // Toggle HUD
    let hudVisible = true;
    function toggleHud() {
        hudVisible = !hudVisible;
        if (hud) hud.classList.toggle('hidden', !hudVisible);
        showToast(hudVisible ? 'HUD VISIBLE' : 'HUD OCULTO (PROYECCIÓN LIMPIA)');
    }

    // Toggle Fullscreen
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => console.log(err));
            showToast('PANTALLA COMPLETA ACTIVADA');
        } else {
            document.exitFullscreen().catch(err => console.log(err));
            showToast('PANTALLA COMPLETA DESACTIVADA');
        }
    }

    // Atajos de teclado (1, 2, 3)
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (key === '1') switchMode('swarm');
        else if (key === '2') switchMode('quadrant');
        else if (key === '3') switchMode('bubbles');
        else if (key === 'i') toggleInversion();
        else if (key === 'h') toggleHud();
        else if (key === 'f') toggleFullscreen();
        else if (e.code === 'Space' && engine.mode === 'bubbles') {
            e.preventDefault();
            startGameCountdown();
        } else if (key === 'r') {
            engine.initParticles();
            if (engine.mode === 'bubbles') engine.initBubbles();
            showToast('REINICIADO');
        }
    });

    // DWELL SELECTION Cuadrante
    let currentHoveredQuad = null;
    let quadDwellStartTime = 0;
    const QUAD_DWELL_TIME = 600;

    function updateInteractiveSelections() {
        const cx = engine.cursor.x;
        const cy = engine.cursor.y;

        // Puntero Player 1
        if (engine.cursor.active && (engine.mode === 'quadrant' || engine.mode === 'bubbles')) {
            if (faceCursor) {
                faceCursor.style.display = 'block';
                faceCursor.style.left = `${cx}px`;
                faceCursor.style.top = `${cy}px`;
            }
        } else {
            if (faceCursor) faceCursor.style.display = 'none';
        }

        // Puntero Player 2
        if (isMultiplayer && engine.cursorP2.active && engine.mode === 'bubbles') {
            if (faceCursorP2) {
                faceCursorP2.style.display = 'block';
                faceCursorP2.style.left = `${engine.cursorP2.x}px`;
                faceCursorP2.style.top = `${engine.cursorP2.y}px`;
            }
        } else {
            if (faceCursorP2) faceCursorP2.style.display = 'none';
        }

        if (engine.mode !== 'quadrant' || !engine.cursor.active) {
            if (currentHoveredQuad) {
                clearQuadDwell(currentHoveredQuad);
                currentHoveredQuad = null;
            }
            return;
        }

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
                hitTarget.classList.add('selected');
                setTimeout(() => hitTarget.classList.remove('selected'), 250);

                const msg = hitTarget.dataset.msg;
                if (msg && quadrantOutput) {
                    quadrantOutput.textContent = `SELECCIONADO: "${msg}"`;
                    speakText(msg);
                }

                quadDwellStartTime = Date.now() + 600;
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

    // Conexión SSE
    let evtSource = null;
    function connectSSE() {
        evtSource = new EventSource('/stream_data');

        evtSource.onopen = () => {
            if (statusDot) statusDot.className = 'status-dot active';
        };

        evtSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                engine.updateTracking(data);

                if (data.fps !== undefined && fpsDisplay) fpsDisplay.textContent = data.fps;
                if (data.inference_ms !== undefined && latencyDisplay) latencyDisplay.textContent = `${data.inference_ms}ms`;
                if (data.faces && faceCountDisplay) faceCountDisplay.textContent = data.faces.length;
                if (data.device && deviceBadge) deviceBadge.textContent = data.device.toUpperCase();

                if (statusDot) {
                    if (data.detected) {
                        statusDot.className = 'status-dot tracking';
                    } else {
                        statusDot.className = 'status-dot active';
                    }
                }
            } catch (err) {
                console.error("Error parseando SSE:", err);
            }
        };

        evtSource.onerror = () => {
            if (statusDot) statusDot.className = 'status-dot';
            evtSource.close();
            setTimeout(connectSSE, 2000);
        };
    }

    connectSSE();

    // Iniciar con modo inicial
    switchMode('swarm');

    // Loop de animación
    function animate() {
        engine.update();
        engine.render();
        updateInteractiveSelections();
        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
});
