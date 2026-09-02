// app.js — Control Maestro para YOLO26 Multi-Vision Explorer v2 (16:9 & Malla Triple)

let currentViewMode = 'triple'; // 'triple' | 'pose' | 'seg' | 'depth'
let currentTripleMain = 'pose';  // 'pose' | 'seg' | 'depth'
let clientToken = null;
let localMediaStream = null;
let uploadInterval = null;
let projectionWindow = null;

document.addEventListener('DOMContentLoaded', () => {
    initViewTabs();
    initFeaturedSlotChips();
    initPerformanceProfiles();
    initThemeToggle();
    initFreezeButton();
    initSliders();
    initSwitches();
    initProjectionLauncher();
    initMobileStream();
    initShutdownButtons();
    startStatsPolling();
    updateCardHighlighting();
});

// 1. Selector de Pestañas de Visualización (Malla Triple vs Individuales)
function initViewTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const videoStream = document.getElementById('mainVideoStream');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            currentViewMode = tab.dataset.mode;
            videoStream.src = `/video_feed/${currentViewMode}?t=${Date.now()}`;
            
            sendConfig({ view_mode: currentViewMode });
            updateOverlayLabels();
            updateCardHighlighting();
        });
    });
}

// 2. Selector de Ranura Principal en Malla Triple
function initFeaturedSlotChips() {
    const chips = document.querySelectorAll('#featuredSlotGroup .btn-chip');

    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            currentTripleMain = chip.dataset.main;
            sendConfig({ triple_main: currentTripleMain });
            updateOverlayLabels();
            updateCardHighlighting();
        });
    });
}

function updateOverlayLabels() {
    const viewModeTag = document.getElementById('viewModeTag');
    if (!viewModeTag) return;

    if (currentViewMode === 'triple') {
        const mainName = currentTripleMain === 'seg' ? 'Segmentación' : (currentTripleMain === 'depth' ? 'Depth' : 'Pose');
        viewModeTag.className = 'overlay-tag tag-triple';
        viewModeTag.textContent = `⚡ Malla Triple 16:9 (${mainName} Principal)`;
    } else if (currentViewMode === 'pose') {
        viewModeTag.className = 'overlay-tag tag-pose';
        viewModeTag.textContent = `🦴 Solo Pose (16:9 Completo)`;
    } else if (currentViewMode === 'seg') {
        viewModeTag.className = 'overlay-tag tag-seg';
        viewModeTag.textContent = `🎨 Solo Segmentación (16:9 Completo)`;
    } else if (currentViewMode === 'depth') {
        viewModeTag.className = 'overlay-tag tag-depth';
        viewModeTag.textContent = `🌊 Solo Depth Estimation (16:9 Completo)`;
    }
}

// Actualizar visibilidad y resaltado de paneles en la barra lateral
function updateCardHighlighting() {
    const cardPose = document.getElementById('cardPoseSettings');
    const cardSeg = document.getElementById('cardSegSettings');
    const cardDepth = document.getElementById('cardDepthSettings');
    const featuredGroup = document.getElementById('featuredSlotGroup');

    if (!cardPose || !cardSeg || !cardDepth) return;

    if (currentViewMode === 'triple') {
        if (featuredGroup) featuredGroup.style.display = 'block';
        cardPose.style.opacity = '1';
        cardPose.style.filter = 'none';
        cardSeg.style.opacity = '1';
        cardSeg.style.filter = 'none';
        cardDepth.style.opacity = '1';
        cardDepth.style.filter = 'none';
    } else {
        if (featuredGroup) featuredGroup.style.display = 'none';
        
        cardPose.style.opacity = currentViewMode === 'pose' ? '1' : '0.35';
        cardPose.style.filter = currentViewMode === 'pose' ? 'none' : 'grayscale(80%)';

        cardSeg.style.opacity = currentViewMode === 'seg' ? '1' : '0.35';
        cardSeg.style.filter = currentViewMode === 'seg' ? 'none' : 'grayscale(80%)';

        cardDepth.style.opacity = currentViewMode === 'depth' ? '1' : '0.35';
        cardDepth.style.filter = currentViewMode === 'depth' ? 'none' : 'grayscale(80%)';
    }
}

// 3. Perfiles de Rendimiento para Notebooks
function initPerformanceProfiles() {
    const profileSelect = document.getElementById('profileSelect');
    const profileBadge = document.getElementById('profileBadge');

    if (!profileSelect) return;

    profileSelect.addEventListener('change', async (e) => {
        const selectedProfile = e.target.value;
        try {
            const res = await fetch('/api/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profile: selectedProfile })
            });
            const data = await res.json();
            if (profileBadge) {
                profileBadge.textContent = selectedProfile.toUpperCase();
            }
        } catch (err) {
            console.error('Error cambiando perfil:', err);
        }
    });
}

// 4. Tema de Alto Contraste (Auditorio Claro vs Neón Oscuro)
function initThemeToggle() {
    const btnTheme = document.getElementById('btnThemeToggle');
    if (!btnTheme) return;

    btnTheme.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('theme-light');
        const theme = isLight ? 'light' : 'dark';
        btnTheme.innerHTML = isLight ? '🌙 Modo Neón' : '☀️ Alto Contraste';
        sendConfig({ high_contrast_theme: theme });
    });
}

// 5. Botón de Congelar Imagen (Freeze)
function initFreezeButton() {
    const btnFreeze = document.getElementById('btnFreeze');
    const freezeBanner = document.getElementById('freezeBanner');

    if (!btnFreeze) return;

    btnFreeze.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/freeze', { method: 'POST' });
            const data = await res.json();
            btnFreeze.classList.toggle('active', data.frozen);
            if (freezeBanner) freezeBanner.classList.toggle('active', data.frozen);
            btnFreeze.innerHTML = data.frozen ? '▶️ Reanudar' : '⏸️ Congelar';
        } catch (err) {
            console.error('Error congelando frame:', err);
        }
    });
}

// 6. Sliders de Ajuste en Vivo
function initSliders() {
    const sliderPose = document.getElementById('confPoseSlider');
    const valPose = document.getElementById('confPoseVal');
    const sliderSeg = document.getElementById('confSegSlider');
    const valSeg = document.getElementById('confSegVal');
    const sliderAlpha = document.getElementById('alphaSlider');
    const valAlpha = document.getElementById('alphaVal');
    const sliderDepthAlpha = document.getElementById('depthAlphaSlider');
    const valDepthAlpha = document.getElementById('depthAlphaVal');
    const selectColormap = document.getElementById('depthColormapSelect');

    if (sliderPose) {
        sliderPose.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (valPose) valPose.textContent = `${Math.round(val * 100)}%`;
            sendConfig({ conf_pose: val });
        });
    }

    if (sliderSeg) {
        sliderSeg.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (valSeg) valSeg.textContent = `${Math.round(val * 100)}%`;
            sendConfig({ conf_seg: val });
        });
    }

    if (sliderAlpha) {
        sliderAlpha.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (valAlpha) valAlpha.textContent = `${Math.round(val * 100)}%`;
            sendConfig({ mask_alpha: val });
        });
    }

    if (sliderDepthAlpha) {
        sliderDepthAlpha.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (valDepthAlpha) valDepthAlpha.textContent = `${Math.round(val * 100)}%`;
            sendConfig({ depth_alpha: val });
        });
    }

    if (selectColormap) {
        selectColormap.addEventListener('change', (e) => {
            sendConfig({ depth_colormap: e.target.value });
        });
    }
}

// 7. Switches de Configuración
function initSwitches() {
    const toggleSkeleton = document.getElementById('toggleSkeleton');
    const toggleBoxPose = document.getElementById('toggleBoxPose');
    const toggleMasks = document.getElementById('toggleMasks');
    const toggleBoxSeg = document.getElementById('toggleBoxSeg');
    const toggleFlip = document.getElementById('toggleFlip');
    const toggleContrast = document.getElementById('toggleContrast');

    if (toggleSkeleton) {
        toggleSkeleton.addEventListener('change', (e) => sendConfig({ show_skeleton: e.target.checked }));
    }
    if (toggleBoxPose) {
        toggleBoxPose.addEventListener('change', (e) => sendConfig({ show_boxes_pose: e.target.checked }));
    }
    if (toggleMasks) {
        toggleMasks.addEventListener('change', (e) => sendConfig({ show_masks_seg: e.target.checked }));
    }
    if (toggleBoxSeg) {
        toggleBoxSeg.addEventListener('change', (e) => sendConfig({ show_boxes_seg: e.target.checked }));
    }
    if (toggleFlip) {
        toggleFlip.addEventListener('change', (e) => sendConfig({ flip_horizontal: e.target.checked }));
    }
    if (toggleContrast) {
        toggleContrast.addEventListener('change', (e) => sendConfig({ contrast_boost: e.target.checked }));
    }
}

// 8. Lanzador de Ventana de Proyección 16:9
function initProjectionLauncher() {
    const btnLaunchProjection = document.getElementById('btnLaunchProjection');
    if (!btnLaunchProjection) return;

    btnLaunchProjection.addEventListener('click', () => {
        if (!projectionWindow || projectionWindow.closed) {
            projectionWindow = window.open(
                '/projection',
                'YOLO26_Projection_Window',
                'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no'
            );
        } else {
            projectionWindow.focus();
        }
    });
}

// 9. Conexión de Cámara Móvil
function initMobileStream() {
    const btnClaim = document.getElementById('btnClaimCamera');
    const btnRelease = document.getElementById('btnReleaseCamera');

    if (!btnClaim) return;

    btnClaim.addEventListener('click', async () => {
        try {
            const res = await fetch('/claim_camera', { method: 'POST' });
            const data = await res.json();
            clientToken = data.token;

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
                audio: false
            });
            localMediaStream = stream;

            const videoTrack = stream.getVideoTracks()[0];
            const imageCapture = new ImageCapture(videoTrack);

            btnClaim.style.display = 'none';
            btnRelease.style.display = 'block';

            uploadInterval = setInterval(async () => {
                try {
                    const blob = await imageCapture.takePhoto();
                    await fetch('/upload_frame', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'image/jpeg',
                            'X-Client-Token': clientToken
                        },
                        body: blob
                    });
                } catch (e) {
                    console.error("Error enviando frame móvil:", e);
                }
            }, 60);

        } catch (err) {
            alert("No se pudo acceder a la cámara del dispositivo: " + err.message);
        }
    });

    if (btnRelease) {
        btnRelease.addEventListener('click', async () => {
            if (uploadInterval) clearInterval(uploadInterval);
            if (localMediaStream) localMediaStream.getTracks().forEach(t => t.stop());

            await fetch('/release_camera', { method: 'POST' });
            btnClaim.style.display = 'block';
            btnRelease.style.display = 'none';
        });
    }
}

// 10. Apagado Limpio
function initShutdownButtons() {
    const btnHeader = document.getElementById('btnHeaderShutdown');
    const btnSidebar = document.getElementById('btnShutdown');

    const handleShutdown = async (btn) => {
        if (!confirm('¿Deseas detener el servidor y liberar la cámara web?')) return;

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏹️ Apagando...';
        }

        try {
            await fetch('/api/shutdown', { method: 'POST' });
        } catch (e) {}

        document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#090c12;color:#00ffcc;font-family:'Outfit',sans-serif;text-align:center;padding:2rem;">
                <div style="background:rgba(255,255,255,0.05);border:2px solid rgba(0,255,204,0.4);border-radius:16px;padding:3rem;max-width:550px;box-shadow:0 0 30px rgba(0,255,204,0.2);">
                    <div style="font-size:3.5rem;margin-bottom:1rem;">⏹️</div>
                    <h1 style="font-size:2rem;color:#ffffff;margin-bottom:0.8rem;">Servidor Detenido</h1>
                    <p style="color:#94a3b8;font-size:1.1rem;line-height:1.6;">La cámara web ha sido liberada y el proceso se ha cerrado limpiamente.</p>
                    <p style="color:#64748b;margin-top:1.5rem;font-size:0.9rem;">Puedes cerrar esta ventana de forma segura.</p>
                </div>
            </div>
        `;
    };

    if (btnHeader) btnHeader.addEventListener('click', () => handleShutdown(btnHeader));
    if (btnSidebar) btnSidebar.addEventListener('click', () => handleShutdown(btnSidebar));
}

// 11. Envío Asíncrono de Configuración
function sendConfig(payload) {
    fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).catch(err => console.error("Error actualizando config:", err));
}

// 12. Polling de Métricas en Vivo
function startStatsPolling() {
    const statFps = document.getElementById('statFps');
    const statMsPose = document.getElementById('statMsPose');
    const statMsSeg = document.getElementById('statMsSeg');
    const statMsDepth = document.getElementById('statMsDepth');
    const statDetections = document.getElementById('statDetections');
    const cameraModeBadge = document.getElementById('cameraModeBadge');
    const segClassesContainer = document.getElementById('segClassesContainer');

    setInterval(async () => {
        try {
            const res = await fetch('/api/stats');
            if (!res.ok) return;
            const data = await res.json();

            if (statFps) statFps.textContent = `${data.fps} FPS`;
            if (statMsPose) statMsPose.textContent = `${data.ms_pose} ms`;
            if (statMsSeg) statMsSeg.textContent = `${data.ms_seg} ms`;
            if (statMsDepth) statMsDepth.textContent = `${data.ms_depth} ms`;

            if (statDetections) {
                statDetections.textContent = `${data.pose_count}p / ${data.seg_count}obj`;
            }

            if (cameraModeBadge) {
                if (data.camera_mode === 'client') {
                    cameraModeBadge.textContent = '📱 Cámara Móvil';
                    cameraModeBadge.style.color = '#38bdf8';
                } else {
                    cameraModeBadge.textContent = '🖥️ Webcam Servidor';
                    cameraModeBadge.style.color = '';
                }
            }

            if (segClassesContainer) {
                if (data.seg_classes && data.seg_classes.length > 0) {
                    segClassesContainer.innerHTML = data.seg_classes
                        .map(cls => `<span class="class-tag">${cls}</span>`)
                        .join('');
                } else {
                    segClassesContainer.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">Esperando detecciones...</span>';
                }
            }

        } catch (e) {}
    }, 250);
}
