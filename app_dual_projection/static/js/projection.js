// projection.js — Lógica de la Vista de Proyección Panorámica 16:9 (Teclado, OSD & Sincronización)

let currentMode = 'triple';   // 'triple' | 'pose' | 'seg' | 'depth'
let currentTripleMain = 'pose'; // 'pose' | 'seg' | 'depth'
let isFrozen = false;
let hudVisible = true;
let isLightMode = false;
let toastTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
    initKeyboardShortcuts();
    initProjectionStats();
    initProjectionClose();
    showToast('PROYECCIÓN 16:9 ([F] Pantalla Completa | [1-4] Modos | [T] Rotar Principal | [Q] Salir)');
});

// 1. Atajos de Teclado para el Presentador en Proyector
function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        const key = e.key.toUpperCase();

        if (e.key === 'Tab') {
            e.preventDefault();
            rotateTripleMain();
            return;
        }

        switch (key) {
            case 'F':
                toggleFullscreen();
                break;
            case 'H':
                toggleOSD();
                break;
            case '1':
                switchMode('triple', '⚡ MALLA TRIPLE 16:9');
                break;
            case '2':
                switchMode('pose', '🦴 SOLO POSE (16:9)');
                break;
            case '3':
                switchMode('seg', '🎨 SOLO SEGMENTACIÓN (16:9)');
                break;
            case '4':
                switchMode('depth', '🌊 SOLO DEPTH (16:9)');
                break;
            case 'T':
                rotateTripleMain();
                break;
            case ' ':
                e.preventDefault();
                toggleFreeze();
                break;
            case 'C':
                toggleTheme();
                break;
            case 'M':
                toggleMirror();
                break;
            case 'Q':
            case 'ESCAPE':
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else if (key === 'Q') {
                    closeProjectionWindow();
                }
                break;
            default:
                break;
        }
    });
}

// 2. Cambio de Modo de Visualización
function switchMode(mode, title) {
    currentMode = mode;
    const stream = document.getElementById('projectionVideoStream');
    if (stream) {
        stream.src = `/video_feed/${mode}?t=${Date.now()}`;
    }

    const osdModeName = document.getElementById('osdModeName');
    if (osdModeName) osdModeName.textContent = title;

    showToast(`MODO: ${title}`);
    sendConfig({ view_mode: mode });
}

// 3. Rotar Ranura Principal en Malla Triple (Pose -> Seg -> Depth)
async function rotateTripleMain() {
    const order = ['pose', 'seg', 'depth'];
    const nextIdx = (order.indexOf(currentTripleMain) + 1) % order.length;
    currentTripleMain = order[nextIdx];

    const names = { pose: 'POSE (17 KEYPOINTS)', seg: 'SEGMENTACIÓN COCO', depth: 'DEPTH ESTIMATION' };

    await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            view_mode: 'triple',
            triple_main: currentTripleMain 
        })
    });

    if (currentMode !== 'triple') {
        switchMode('triple', `⚡ MALLA TRIPLE 16:9 (${names[currentTripleMain]})`);
    } else {
        const osdModeName = document.getElementById('osdModeName');
        if (osdModeName) osdModeName.textContent = `⚡ MALLA TRIPLE 16:9 (${names[currentTripleMain]})`;
        showToast(`PRINCIPAL: ${names[currentTripleMain]}`);
    }
}

// 4. Congelar / Pausar Frame en Vivo (Freeze)
async function toggleFreeze() {
    try {
        const res = await fetch('/api/freeze', { method: 'POST' });
        const data = await res.json();
        isFrozen = data.frozen;

        const banner = document.getElementById('freezeBanner');
        if (banner) banner.classList.toggle('active', isFrozen);

        showToast(isFrozen ? '⏸️ FRAME CONGELADO (PAUSA)' : '▶️ TRANSMISIÓN EN VIVO');
    } catch (e) {
        console.error('Error congelando frame:', e);
    }
}

// 5. Alternar Tema Alto Contraste (Neón Oscuro vs Auditorio Claro)
function toggleTheme() {
    isLightMode = !isLightMode;
    document.body.classList.toggle('theme-light', isLightMode);
    const theme = isLightMode ? 'light' : 'dark';
    showToast(isLightMode ? '☀️ TEMA: ALTO CONTRASTE (AUDITORIO)' : '🌙 TEMA: NEÓN CYBER-DARK');
    sendConfig({ high_contrast_theme: theme });
}

// 6. Alternar Espejo Horizontal (Mirror)
async function toggleMirror() {
    try {
        const statsRes = await fetch('/api/stats');
        const stats = await statsRes.json();
        const nextFlip = !stats.flip;

        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flip_horizontal: nextFlip })
        });

        showToast(nextFlip ? '🪞 MODO ESPEJO: ACTIVADO' : '🎥 MODO ESPEJO: DESACTIVADO');
    } catch (e) {
        console.error('Error cambiando flip:', e);
    }
}

// 7. Pantalla Completa Nativa
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error activando pantalla completa: ${err.message}`);
        });
        showToast('📺 PANTALLA COMPLETA 16:9');
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
            showToast('🗗 PANTALLA NORMAL');
        }
    }
}

// 8. Ocultar / Mostrar OSD y Atajos
function toggleOSD() {
    hudVisible = !hudVisible;
    const osd = document.getElementById('projectionOSD');
    const shortcuts = document.getElementById('projectionShortcuts');

    if (osd) osd.classList.toggle('hidden', !hudVisible);
    if (shortcuts) shortcuts.classList.toggle('hidden', !hudVisible);

    showToast(hudVisible ? '👁️ HUD & MÉTRICAS VISIBLES' : '🙈 HUD OCULTO');
}

// 9. Notificación Toast Flotante
function showToast(msg) {
    const toast = document.getElementById('toastNotice');
    if (!toast) return;

    if (toastTimeout) clearTimeout(toastTimeout);

    toast.textContent = msg;
    toast.classList.add('show');

    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 2200);
}

// 10. Cerrar Ventana de Proyección o Apagar
function initProjectionClose() {
    const btnClose = document.getElementById('btnProjectionClose');
    if (btnClose) {
        btnClose.addEventListener('click', closeProjectionWindow);
    }
}

function closeProjectionWindow() {
    if (window.opener) {
        window.close();
    } else {
        showToast('Presiona [F] para salir de pantalla completa o cierra esta pestaña');
    }
}

// 11. Envío Asíncrono de Configuración
function sendConfig(payload) {
    fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(err => console.error("Error actualizando config:", err));
}

// 12. Polling de Métricas OSD para la Audiencia
function initProjectionStats() {
    const osdFps = document.getElementById('osdFps');
    const osdLat = document.getElementById('osdLat');
    const osdCount = document.getElementById('osdCount');

    setInterval(async () => {
        try {
            const res = await fetch('/api/stats');
            if (!res.ok) return;
            const data = await res.json();

            if (osdFps) osdFps.textContent = `${Math.round(data.fps)}`;
            if (osdLat) osdLat.textContent = `${Math.round(data.ms_pose + data.ms_seg + data.ms_depth)}ms`;

            if (osdCount) {
                osdCount.textContent = `${data.pose_count}p / ${data.seg_count}obj`;
            }
        } catch (e) {}
    }, 250);
}
