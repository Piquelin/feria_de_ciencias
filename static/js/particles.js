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
            }
        };

        this.params = { ...this.modeParams.swarm };

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
        // Reducir la cantidad de partículas si entramos a modo juego de burbujas
        if (newMode === 'bubbles') {
            this.numParticles = 250; // Alivia drásticamente la GPU/CPU integrada
        } else {
            this.numParticles = 1600;
        }
        this.initParticles();
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
            this.cursor.active = true;

            if (pc.gesture_reset && !this.lastResetGesture) {
                this.initParticles();
                if (window.onParticleResetGesture) {
                    window.onParticleResetGesture();
                }
            }
            this.lastResetGesture = !!pc.gesture_reset;
        } else {
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
            this.cursorP2.active = true;
        } else {
            this.cursorP2.active = false;
        }
    }

    update() {
        const lerpFactor = 0.35;
        // Suavizado P1
        this.cursor.x += (this.cursor.targetX - this.cursor.x) * lerpFactor;
        this.cursor.y += (this.cursor.targetY - this.cursor.y) * lerpFactor;

        // Suavizado P2
        if (this.cursorP2.active) {
            this.cursorP2.x += (this.cursorP2.targetX - this.cursorP2.x) * lerpFactor;
            this.cursorP2.y += (this.cursorP2.targetY - this.cursorP2.y) * lerpFactor;
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
    }
}
