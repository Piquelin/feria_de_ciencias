/**
 * OneEuroFilter - Filtro pasabajos adaptativo basado en velocidad (Casiez et al., CHI 2012).
 * Suaviza agresivamente a baja velocidad para eliminar micro-jitter y reduce el retardo a cero
 * a alta velocidad para un seguimiento instantáneo y reactivo.
 */
class OneEuroFilter {
    constructor(minCutoff = 1.2, beta = 0.008, dCutoff = 1.0) {
        this.minCutoff = minCutoff; // Frecuencia de corte mínima (Hz) para reposo
        this.beta = beta;           // Coeficiente de velocidad para dinámicas rápidas
        this.dCutoff = dCutoff;     // Frecuencia de corte para la derivada
        this.xPrev = null;
        this.dxPrev = 0;
        this.tPrev = null;
    }

    alpha(cutoff, dt) {
        const tau = 1.0 / (2.0 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / dt);
    }

    filter(x, t) {
        if (this.xPrev === null || this.tPrev === null) {
            this.xPrev = x;
            this.tPrev = t;
            this.dxPrev = 0;
            return x;
        }

        let dt = (t - this.tPrev) / 1000.0;
        if (dt <= 0.0) {
            dt = 0.016;
        }
        if (dt > 0.4) {
            this.reset();
            this.xPrev = x;
            this.tPrev = t;
            return x;
        }

        // 1. Filtrar derivada (velocidad)
        const dx = (x - this.xPrev) / dt;
        const aD = this.alpha(this.dCutoff, dt);
        const dxHat = aD * dx + (1.0 - aD) * this.dxPrev;

        // 2. Frecuencia de corte adaptativa
        const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);

        // 3. Filtrar señal
        const a = this.alpha(cutoff, dt);
        const xHat = a * x + (1.0 - a) * this.xPrev;

        this.xPrev = xHat;
        this.dxPrev = dxHat;
        this.tPrev = t;

        return xHat;
    }

    reset() {
        this.xPrev = null;
        this.dxPrev = 0;
        this.tPrev = null;
    }
}

/**
 * ParticleEngine - Motor de partículas físico optimizado para proyección interactiva B&W
 * Soporta Modo 1P y 2P, optimización de rendimiento para notebooks y renderizado adaptativo.
 */
class ParticleEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.numParticles = 1800;
        this.mode = 'swarm'; // 'swarm', 'quadrant', 'bubbles'
        this.isInverted = false;
        this.multiplayer = false; // 1P vs 2P
        
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.resize();

        // Filtros One Euro Filter para P1 y P2 (elimina lag y jitter)
        this.filterP1X = new OneEuroFilter(1.2, 0.008);
        this.filterP1Y = new OneEuroFilter(1.2, 0.008);
        this.filterP2X = new OneEuroFilter(1.2, 0.008);
        this.filterP2Y = new OneEuroFilter(1.2, 0.008);

        // Parámetros calibrados por modo
        this.modeParams = {
            swarm: {
                vortexRadius: 155,
                windStrength: 1.5,
                maxSpeed: 8.0,
                friction: 0.88,
                gravity: 0.003
            },
            quadrant: {
                vortexRadius: 120,
                windStrength: 1.0,
                maxSpeed: 5.0,
                friction: 0.90,
                gravity: 0.001
            },
            bubbles: {
                vortexRadius: 100,
                windStrength: 1.0,
                maxSpeed: 6.0,
                friction: 0.92,
                gravity: 0.001
            },
            trails: {
                vortexRadius: 130,
                windStrength: 1.2,
                maxSpeed: 7.0,
                friction: 0.90,
                gravity: 0.002
            }
        };

        this.params = { ...this.modeParams.swarm };

        // Parámetros y estado de Modo 4: Estelas Colaborativas (Multi-persona)
        this.trailDuration = 3.5; // Segundos que persiste la estela (calibrable 1.0s - 10.0s)
        this.pointSize = 16;      // Radio / grosor del punto en píxeles (calibrable 6px - 40px)
        this.trailSource = 'hands'; // 'hands' (vector muñecas + centro hombros como Modo 1) o 'nose' (nariz directa)
        
        // Paleta de colores de alto contraste por jugador (Modo Normal vs Modo Invertido B/W)
        this.trailColors = [
            '#00ffcc', // P1: Cian Neón brillante
            '#ff007f', // P2: Rosa / Magenta eléctrico
            '#ffe600', // P3: Amarillo Neón
            '#00ff66', // P4: Verde Lima brillante
            '#ff6600', // P5: Naranja vívido
            '#aa00ff'  // P6: Púrpura eléctrico
        ];
        this.trailColorsInverted = [
            '#005577', // P1 Invertido
            '#990044', // P2 Invertido
            '#886600', // P3 Invertido
            '#006622', // P4 Invertido
            '#aa3300', // P5 Invertido
            '#550088'  // P6 Invertido
        ];

        // Slots de participantes para dibujo en tiempo real (hasta 6 personas simultáneas)
        this.drawers = [];
        for (let i = 0; i < 6; i++) {
            this.drawers.push({
                id: i,
                active: false,
                targetX: this.width / 2,
                targetY: this.height / 2,
                x: this.width / 2,
                y: this.height / 2,
                filterX: new OneEuroFilter(1.2, 0.008),
                filterY: new OneEuroFilter(1.2, 0.008),
                points: [],      // Array de { x, y, time }
                lastSeen: 0,
                colorIndex: i
            });
        }

        // Jugador 1 (Principal)
        this.cursor = {
            x: this.width / 2,
            y: this.height / 2,
            targetX: this.width / 2,
            targetY: this.height / 2,
            tilt: 0,
            scale: 1,
            speed: 0,
            active: false
        };

        // Jugador 2 (Secundario)
        this.cursorP2 = {
            x: this.width * 0.75,
            y: this.height / 2,
            targetX: this.width * 0.75,
            targetY: this.height / 2,
            tilt: 0,
            scale: 1,
            speed: 0,
            active: false
        };

        this.faces = [];
        this.lastResetGesture = false;

        // Estado del juego
        this.gameScoreP1 = 0;
        this.gameScoreP2 = 0;
        this.gameActive = false;
        this.bubbles = [];
        this.popSparks = [];

        this.initParticles();
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    }

    setMode(newMode) {
        this.mode = newMode;
        if (this.modeParams[newMode]) {
            this.params = { ...this.modeParams[newMode] };
        }
        
        // Optimización de rendimiento para notebooks modestas:
        // Reducir la cantidad de partículas si entramos a modo juego de burbujas o estelas
        if (newMode === 'bubbles') {
            this.numParticles = 250; // Alivia drásticamente la GPU/CPU integrada
        } else if (newMode === 'trails') {
            this.numParticles = 500; // Estética de enjambre suave de fondo sin competir con el dibujo
        } else {
            this.numParticles = 1600;
        }
        this.initParticles();
    }

    setTrailDuration(sec) {
        this.trailDuration = Math.max(0.5, Math.min(15.0, parseFloat(sec) || 3.5));
    }

    setPointSize(px) {
        this.pointSize = Math.max(4, Math.min(60, parseFloat(px) || 16));
    }

    setTrailSource(source) {
        this.trailSource = (source === 'nose') ? 'nose' : 'hands';
    }

    setInverted(val) {
        this.isInverted = val;
    }

    setMultiplayer(enabled) {
        this.multiplayer = enabled;
    }

    initParticles() {
        this.particles = [];
        for (let i = 0; i < this.numParticles; i++) {
            this.particles.push(this.createParticle());
        }
    }

    createParticle() {
        return {
            x: Math.random() * this.width,
            y: Math.random() * this.height,
            vx: (Math.random() - 0.5) * 1.0,
            vy: (Math.random() - 0.5) * 1.0,
            baseRadius: Math.random() * 2.0 + 0.8,
            radius: 1.5,
            alpha: Math.random() * 0.7 + 0.3,
            life: Math.random() * 100,
            maxLife: 100 + Math.random() * 150
        };
    }

    setSmoothingParams(minCutoff, beta) {
        if (this.filterP1X) {
            this.filterP1X.minCutoff = minCutoff;
            this.filterP1X.beta = beta;
            this.filterP1Y.minCutoff = minCutoff;
            this.filterP1Y.beta = beta;
            this.filterP2X.minCutoff = minCutoff;
            this.filterP2X.beta = beta;
            this.filterP2Y.minCutoff = minCutoff;
            this.filterP2Y.beta = beta;
        }
    }

    updateTracking(data) {
        if (!data) return;
        this.faces = data.faces || [];
        
        // Tracking Jugador 1
        if (data.detected && data.primary_cursor && data.primary_cursor.active) {
            const pc = data.primary_cursor;
            this.cursor.targetX = pc.x * this.width;
            this.cursor.targetY = pc.y * this.height;
            this.cursor.tilt = pc.tilt; 
            this.cursor.scale = pc.scale;
            this.cursor.speed = pc.speed;
            this.cursor.windVx = pc.wind_vx || 0.0;
            this.cursor.windVy = pc.wind_vy || 0.0;
            this.cursor.windMag = pc.wind_magnitude || 0.0;
            this.cursor.handsActive = pc.hands_active || 0;

            // Si el cursor acaba de activarse, resetear filtro para responder de inmediato
            if (!this.cursor.active) {
                this.filterP1X.reset();
                this.filterP1Y.reset();
                this.cursor.x = this.cursor.targetX;
                this.cursor.y = this.cursor.targetY;
            }
            this.cursor.active = true;

            if (pc.gesture_reset && !this.lastResetGesture) {
                this.initParticles();
                if (window.onParticleResetGesture) {
                    window.onParticleResetGesture();
                }
            }
            this.lastResetGesture = !!pc.gesture_reset;
        } else {
            if (this.cursor.active) {
                this.filterP1X.reset();
                this.filterP1Y.reset();
            }
            this.cursor.active = false;
            this.lastResetGesture = false;
        }

        // Tracking Jugador 2
        if (data.secondary_cursor && data.secondary_cursor.active) {
            const sc = data.secondary_cursor;
            this.cursorP2.targetX = sc.x * this.width;
            this.cursorP2.targetY = sc.y * this.height;
            this.cursorP2.tilt = sc.tilt;
            this.cursorP2.scale = sc.scale;
            this.cursorP2.speed = sc.speed;

            if (!this.cursorP2.active) {
                this.filterP2X.reset();
                this.filterP2Y.reset();
                this.cursorP2.x = this.cursorP2.targetX;
                this.cursorP2.y = this.cursorP2.targetY;
            }
            this.cursorP2.active = true;
        } else {
            if (this.cursorP2.active) {
                this.filterP2X.reset();
                this.filterP2Y.reset();
            }
            this.cursorP2.active = false;
        }

        // Tracking Multi-persona para Modo Estelas (data.faces contiene todas las detecciones)
        if (this.mode === 'trails') {
            const nowTime = performance.now();
            const faces = (data.faces || []).filter(f => f && f.nose && f.nose[0] > 0);
            
            // Emparejamiento por distancia euclídea mínima entre drawers existentes y caras detectadas
            const assignedDrawers = new Set();
            const assignedFaces = new Set();

            // Función auxiliar para obtener posición de dibujo según trailSource ('hands' o 'nose')
            const getDrawPos = (face) => {
                if (this.trailSource === 'hands') {
                    // Origen base: centro de hombros (wind_origin) si está disponible, o nariz
                    const baseOrigin = face.wind_origin || face.nose;
                    let targetNormX = baseOrigin[0];
                    let targetNormY = baseOrigin[1];

                    // Proyectar hacia adelante con el vector de viento de las muñecas
                    if (face.wind_vx !== undefined && face.wind_vy !== undefined) {
                        targetNormX += face.wind_vx * 0.9;
                        targetNormY += face.wind_vy * 0.9;
                    }
                    // Clampear a pantalla [0, 1]
                    targetNormX = Math.max(0.02, Math.min(0.98, targetNormX));
                    targetNormY = Math.max(0.02, Math.min(0.98, targetNormY));
                    return [targetNormX, targetNormY];
                } else {
                    return [face.nose[0], face.nose[1]];
                }
            };

            for (const d of this.drawers) {
                if (!d.active) continue;
                let bestIdx = -1;
                let bestDist = 0.28; // Umbral de distancia normalizada (~28% de la pantalla)
                for (let i = 0; i < faces.length; i++) {
                    if (assignedFaces.has(i)) continue;
                    const f = faces[i];
                    const dist = Math.hypot(f.nose[0] - d.normFaceX, f.nose[1] - d.normFaceY);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestIdx = i;
                    }
                }
                if (bestIdx !== -1) {
                    const matchedFace = faces[bestIdx];
                    const [px, py] = getDrawPos(matchedFace);
                    d.normFaceX = matchedFace.nose[0];
                    d.normFaceY = matchedFace.nose[1];
                    d.targetX = px * this.width;
                    d.targetY = py * this.height;
                    d.tilt = matchedFace.tilt || 0;
                    d.lastSeen = nowTime;
                    assignedDrawers.add(d.id);
                    assignedFaces.add(bestIdx);
                }
            }

            // Asignar nuevas caras a drawers inactivos
            for (let i = 0; i < faces.length; i++) {
                if (assignedFaces.has(i)) continue;
                const freeDrawer = this.drawers.find(d => !d.active && !assignedDrawers.has(d.id));
                if (freeDrawer) {
                    const f = faces[i];
                    const [px, py] = getDrawPos(f);
                    freeDrawer.active = true;
                    freeDrawer.normFaceX = f.nose[0];
                    freeDrawer.normFaceY = f.nose[1];
                    freeDrawer.targetX = px * this.width;
                    freeDrawer.targetY = py * this.height;
                    freeDrawer.x = freeDrawer.targetX;
                    freeDrawer.y = freeDrawer.targetY;
                    freeDrawer.tilt = f.tilt || 0;
                    freeDrawer.filterX.reset();
                    freeDrawer.filterY.reset();
                    freeDrawer.points = [];
                    freeDrawer.lastSeen = nowTime;
                    assignedDrawers.add(freeDrawer.id);
                    assignedFaces.add(i);
                }
            }

            // Desactivar drawers que llevan más de 650ms sin detectarse
            for (const d of this.drawers) {
                if (d.active && !assignedDrawers.has(d.id)) {
                    if (nowTime - d.lastSeen > 650) {
                        d.active = false;
                        d.filterX.reset();
                        d.filterY.reset();
                    }
                }
            }
        }
    }

    update() {
        const now = performance.now();

        // Suavizado adaptativo One Euro Filter para P1 (cero jitter en reposo, cero lag en movimiento rápido)
        if (this.cursor.active) {
            this.cursor.x = this.filterP1X.filter(this.cursor.targetX, now);
            this.cursor.y = this.filterP1Y.filter(this.cursor.targetY, now);
        }

        // Suavizado adaptativo One Euro Filter para P2
        if (this.cursorP2.active) {
            this.cursorP2.x = this.filterP2X.filter(this.cursorP2.targetX, now);
            this.cursorP2.y = this.filterP2Y.filter(this.cursorP2.targetY, now);
        }

        // Actualización de Drawers en Modo Estelas (filtro OneEuro + acumulación de puntos)
        if (this.mode === 'trails') {
            const maxAge = this.trailDuration * 1000;
            for (const d of this.drawers) {
                if (d.active) {
                    d.x = d.filterX.filter(d.targetX, now);
                    d.y = d.filterY.filter(d.targetY, now);

                    // Registrar punto en la estela si hay suficiente distancia mínima (optimización de memoria)
                    const lastPt = d.points.length > 0 ? d.points[d.points.length - 1] : null;
                    if (!lastPt || Math.hypot(d.x - lastPt.x, d.y - lastPt.y) > 2.5) {
                        d.points.push({ x: d.x, y: d.y, time: now });
                    }
                }

                // Podar puntos que excedan la duración de la estela
                while (d.points.length > 0 && (now - d.points[0].time) > maxAge) {
                    d.points.shift();
                }
            }
        }

        const cx = this.cursor.x;
        const cy = this.cursor.y;
        const influenceRadius = this.params.vortexRadius * (this.cursor.scale ? Math.max(this.cursor.scale * 2.0, 0.7) : 1);
        
        const handWindX = (this.cursor.windVx || 0) * this.params.windStrength * 5.0;
        const handWindY = (this.cursor.windVy || 0) * this.params.windStrength * 5.0;

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const dx = p.x - cx;
            const dy = p.y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            if (this.mode === 'swarm') {
                if (this.cursor.active) {
                    if (dist < influenceRadius) {
                        const force = (1 - dist / influenceRadius);
                        
                        if (this.cursor.speed > 0.8) {
                            p.vx += (dx / dist) * force * 8;
                            p.vy += (dy / dist) * force * 8;
                        } else {
                            const vortexAngle = Math.atan2(dy, dx) + Math.PI / 2;
                            p.vx += Math.cos(vortexAngle) * force * 2.8;
                            p.vy += Math.sin(vortexAngle) * force * 2.8;
                            p.vx += (cx - p.x) * this.params.gravity * force;
                            p.vy += (cy - p.y) * this.params.gravity * force;
                        }

                        p.vx += handWindX * force * 1.6;
                        p.vy += handWindY * force * 1.6;
                    }
                }

                p.vx += handWindX * 0.25;
                p.vy += handWindY * 0.25;

                p.vx *= this.params.friction;
                p.vy *= this.params.friction;

                const curSpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
                if (curSpeed > this.params.maxSpeed) {
                    p.vx = (p.vx / curSpeed) * this.params.maxSpeed;
                    p.vy = (p.vy / curSpeed) * this.params.maxSpeed;
                }

                p.x += p.vx;
                p.y += p.vy;

            } else if (this.mode === 'bubbles') {
                p.x += p.vx * 0.5 + handWindX * 0.1;
                p.y += p.vy * 0.5 + handWindY * 0.1;
                p.vx *= 0.95;
                p.vy *= 0.95;
            } else if (this.mode === 'trails') {
                // En modo estelas, las partículas flotan suavemente y se apartan de los dibujantes activos
                for (const d of this.drawers) {
                    if (d.active) {
                        const ddx = p.x - d.x;
                        const ddy = p.y - d.y;
                        const dDist = Math.hypot(ddx, ddy) || 1;
                        if (dDist < 80) {
                            const repulse = (1 - dDist / 80) * 1.5;
                            p.vx += (ddx / dDist) * repulse;
                            p.vy += (ddy / dDist) * repulse;
                        }
                    }
                }
                p.vx *= 0.92;
                p.vy *= 0.92;
                p.x += p.vx;
                p.y += p.vy;
            }

            if (p.x < 0) { p.x = this.width; }
            if (p.x > this.width) { p.x = 0; }
            if (p.y < 0) { p.y = this.height; }
            if (p.y > this.height) { p.y = 0; }
        }

        if (this.mode === 'bubbles') {
            this.updateBubbles();
        }
    }

    initBubbles() {
        this.bubbles = [];
        const count = this.multiplayer ? 10 : 7;
        for (let i = 0; i < count; i++) {
            this.spawnBubble();
        }
        this.gameScoreP1 = 0;
        this.gameScoreP2 = 0;
        this.popSparks = [];
    }

    spawnBubble() {
        this.bubbles.push({
            x: Math.random() * (this.width - 180) + 90,
            y: this.height + Math.random() * 80 + 30,
            radius: Math.random() * 22 + 34,
            speedY: Math.random() * 1.5 + 1.2,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: Math.random() * 0.04 + 0.02,
            popped: false
        });
    }

    updateBubbles() {
        if (!this.bubbles || this.bubbles.length === 0) this.initBubbles();

        const c1x = this.cursor.x;
        const c1y = this.cursor.y;
        const c2x = this.cursorP2.x;
        const c2y = this.cursorP2.y;

        for (let i = this.bubbles.length - 1; i >= 0; i--) {
            const b = this.bubbles[i];
            b.y -= b.speedY;
            b.wobble += b.wobbleSpeed;
            b.x += Math.sin(b.wobble) * 1.2;

            let hit = false;
            let playerHit = null;

            // Colisión Jugador 1
            if (this.cursor.active) {
                const dist1 = Math.hypot(b.x - c1x, b.y - c1y);
                if (dist1 < b.radius + 20) {
                    hit = true;
                    playerHit = 1;
                }
            }

            // Colisión Jugador 2 (Modo multijugador)
            if (!hit && this.multiplayer && this.cursorP2.active) {
                const dist2 = Math.hypot(b.x - c2x, b.y - c2y);
                if (dist2 < b.radius + 20) {
                    hit = true;
                    playerHit = 2;
                }
            }

            if (hit) {
                const color = (playerHit === 2) ? '#ff9900' : '#00ff88';
                this.createBubblePopEffect(b.x, b.y, b.radius, color);
                this.bubbles.splice(i, 1);
                this.spawnBubble();

                if (playerHit === 1) this.gameScoreP1++;
                if (playerHit === 2) this.gameScoreP2++;

                if (window.onBubblePopped) {
                    window.onBubblePopped(this.gameScoreP1, this.gameScoreP2, playerHit);
                }
                continue;
            }

            if (b.y < -b.radius * 2) {
                this.bubbles.splice(i, 1);
                this.spawnBubble();
            }
        }

        // Actualizar chispas de partículas al reventar
        if (this.popSparks) {
            for (let i = this.popSparks.length - 1; i >= 0; i--) {
                const s = this.popSparks[i];
                s.x += s.vx;
                s.y += s.vy;
                s.alpha *= 0.91;
                if (s.alpha < 0.05) this.popSparks.splice(i, 1);
            }
        }
    }

    createBubblePopEffect(x, y, radius, sparkColor) {
        if (!this.popSparks) this.popSparks = [];
        const baseColor = sparkColor || (this.isInverted ? '#000000' : '#00ff88');
        for (let i = 0; i < 22; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 6 + 2;
            this.popSparks.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: Math.random() * 3 + 1.5,
                alpha: 1.0,
                color: baseColor
            });
        }
    }

    render() {
        const ctx = this.ctx;
        const color = this.isInverted ? '#000000' : '#ffffff';
        const trailAlpha = 0.25;

        // Limpiar canvas con estela (trail effect)
        ctx.fillStyle = this.isInverted 
            ? `rgba(255, 255, 255, ${trailAlpha})` 
            : `rgba(0, 0, 0, ${trailAlpha})`;
        ctx.fillRect(0, 0, this.width, this.height);

        // Renderizado de partículas de ambiente
        ctx.fillStyle = color;
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            ctx.globalAlpha = p.alpha || 0.8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.baseRadius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        // Renderizar Burbujas del Juego
        if (this.mode === 'bubbles' && this.bubbles) {
            this.bubbles.forEach(b => {
                ctx.save();
                ctx.strokeStyle = this.isInverted ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 255, 136, 0.85)';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = this.isInverted ? 'rgba(0, 0, 0, 0.06)' : 'rgba(0, 255, 136, 0.12)';
                ctx.fill();

                ctx.fillStyle = this.isInverted ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.7)';
                ctx.beginPath();
                ctx.arc(b.x - b.radius * 0.35, b.y - b.radius * 0.35, b.radius * 0.2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });

            if (this.popSparks) {
                this.popSparks.forEach(s => {
                    ctx.save();
                    ctx.globalAlpha = s.alpha;
                    ctx.fillStyle = s.color;
                    ctx.beginPath();
                    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                });
            }
        }

        // Puntero Player 1 en Canvas
        if (this.cursor.active && (this.mode === 'quadrant' || this.mode === 'bubbles')) {
            ctx.save();
            ctx.translate(this.cursor.x, this.cursor.y);
            ctx.rotate(this.cursor.tilt);
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, 20 + Math.sin(Date.now() * 0.008) * 3, 0, Math.PI * 2);
            ctx.stroke();
            if (this.multiplayer) {
                ctx.fillStyle = '#00ff88';
                ctx.font = 'bold 12px monospace';
                ctx.fillText('P1', 25, -5);
            }
            ctx.restore();
        }

        // Puntero Player 2 en Canvas (si está activo)
        if (this.multiplayer && this.cursorP2.active && this.mode === 'bubbles') {
            ctx.save();
            ctx.translate(this.cursorP2.x, this.cursorP2.y);
            ctx.rotate(this.cursorP2.tilt);
            ctx.strokeStyle = '#ff9900';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, 20 + Math.sin(Date.now() * 0.008) * 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#ff9900';
            ctx.font = 'bold 12px monospace';
            ctx.fillText('P2', 25, -5);
            ctx.restore();
        }

        // MODO 4: Renderizado de Estelas y Punteros Colaborativos Multi-persona
        if (this.mode === 'trails') {
            const now = performance.now();
            const maxDurationMs = this.trailDuration * 1000;
            const colors = this.isInverted ? this.trailColorsInverted : this.trailColors;
            const baseRadius = this.pointSize;

            for (const d of this.drawers) {
                const color = colors[d.colorIndex % colors.length];

                // 1. Dibujar estela continua con degradé de opacidad y grosor según su antigüedad
                if (d.points.length > 1) {
                    ctx.save();
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.strokeStyle = color;

                    for (let j = 0; j < d.points.length - 1; j++) {
                        const pt1 = d.points[j];
                        const pt2 = d.points[j + 1];
                        const age = now - pt2.time;
                        const lifeRatio = Math.max(0, 1 - (age / maxDurationMs));

                        if (lifeRatio <= 0) continue;

                        ctx.globalAlpha = lifeRatio * 0.88;
                        ctx.lineWidth = Math.max(2, baseRadius * 1.8 * lifeRatio);

                        ctx.beginPath();
                        ctx.moveTo(pt1.x, pt1.y);
                        ctx.lineTo(pt2.x, pt2.y);
                        ctx.stroke();
                    }
                    ctx.restore();
                }

                // 2. Dibujar cursor como ICOSAEDRO 3D GIRANDO si la persona sigue presente
                if (d.active) {
                    ctx.save();
                    ctx.translate(d.x, d.y);

                    // Halo exterior brillante de ambiente
                    ctx.globalAlpha = 0.25;
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(0, 0, baseRadius * 1.5, 0, Math.PI * 2);
                    ctx.fill();

                    // --- Geometría y Rotación 3D del Icosaedro ---
                    const t = now * 0.0018 + d.id * 1.2;
                    const rotX = t * 0.9;
                    const rotY = t * 1.3;
                    const rotZ = (d.tilt || 0) + t * 0.4;
                    const r = baseRadius * 1.25; // Radio escala del icosaedro

                    // Proporción áurea phi
                    const phi = (1 + Math.sqrt(5)) / 2;
                    const normFactor = 1.0 / Math.sqrt(1 + phi * phi);
                    const a = r * normFactor;
                    const b = r * phi * normFactor;

                    // 12 Vértices estándar del icosaedro regular
                    const vertices = [
                        [-a,  b,  0], [ a,  b,  0], [-a, -b,  0], [ a, -b,  0],
                        [ 0, -a,  b], [ 0,  a,  b], [ 0, -a, -b], [ 0,  a, -b],
                        [ b,  0, -a], [ b,  0,  a], [-b,  0, -a], [-b,  0,  a]
                    ];

                    // 30 Aristas del icosaedro que conectan los 12 vértices
                    const edges = [
                        [0, 11], [0, 5], [0, 1], [0, 7], [0, 10],
                        [1, 5], [5, 11], [11, 10], [10, 7], [7, 1],
                        [3, 9], [3, 4], [3, 2], [3, 6], [3, 8],
                        [4, 9], [2, 4], [6, 2], [8, 6], [9, 8],
                        [4, 5], [5, 9], [9, 1], [1, 8], [8, 7],
                        [7, 6], [6, 10], [10, 2], [2, 11], [11, 4]
                    ];

                    // Funciones trigonométricas para matrices de rotación 3D (Euler X -> Y -> Z)
                    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
                    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
                    const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);

                    const projected = vertices.map(v => {
                        // Rotar en eje X
                        let y1 = v[1] * cosX - v[2] * sinX;
                        let z1 = v[1] * sinX + v[2] * cosX;
                        let x1 = v[0];

                        // Rotar en eje Y
                        let x2 = x1 * cosY + z1 * sinY;
                        let z2 = -x1 * sinY + z1 * cosY;
                        let y2 = y1;

                        // Rotar en eje Z
                        let x3 = x2 * cosZ - y2 * sinZ;
                        let y3 = x2 * sinZ + y2 * cosZ;
                        let z3 = z2;

                        // Proyección ortográfica / perspectiva suave
                        const fov = 160;
                        const pScale = fov / (fov + z3);
                        return { x: x3 * pScale, y: y3 * pScale, z: z3 };
                    });

                    // Dibujar las 30 aristas alámbricas con degradé por profundidad Z
                    ctx.save();
                    ctx.lineCap = 'round';
                    for (const edge of edges) {
                        const p1 = projected[edge[0]];
                        const p2 = projected[edge[1]];
                        const avgZ = (p1.z + p2.z) / 2;
                        // Opacidad variable según profundidad (más brillante adelante)
                        const depthAlpha = Math.max(0.35, Math.min(1.0, 0.7 + (avgZ / (r * 2))));

                        ctx.globalAlpha = depthAlpha;
                        ctx.strokeStyle = color;
                        ctx.lineWidth = Math.max(1.5, baseRadius * 0.16);
                        ctx.beginPath();
                        ctx.moveTo(p1.x, p1.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.stroke();
                    }

                    // Vértices frontales como puntos de luz
                    for (const p of projected) {
                        if (p.z > -r * 0.3) {
                            ctx.globalAlpha = Math.max(0.4, Math.min(1.0, 0.7 + p.z / r));
                            ctx.fillStyle = this.isInverted ? '#000000' : '#ffffff';
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, Math.max(1.5, baseRadius * 0.12), 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                    ctx.restore();

                    // Núcleo central pulsante
                    ctx.globalAlpha = 0.9;
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(0, 0, Math.max(2.5, baseRadius * 0.28), 0, Math.PI * 2);
                    ctx.fill();

                    // Etiqueta de Jugador (P1, P2, P3...)
                    ctx.globalAlpha = 1.0;
                    ctx.fillStyle = this.isInverted ? '#000000' : '#ffffff';
                    ctx.font = 'bold 12px monospace';
                    ctx.fillText(`P${d.id + 1}`, baseRadius + 8, 4);

                    ctx.restore();
                }
            }
        }
    }
}
