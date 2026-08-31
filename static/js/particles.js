/**
 * ParticleEngine - Motor de partículas físico optimizado para proyección interactiva B&W
 */
class ParticleEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.numParticles = 2000;
        this.mode = 'swarm'; // 'swarm', 'trails'
        this.isInverted = false;
        
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
            trails: {
                vortexRadius: 155,
                windStrength: 1.5,
                maxSpeed: 8.0,
                friction: 0.88,
                gravity: 0.003
            }
        };

        this.params = { ...this.modeParams.swarm };

        // Cursor interactivo
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

        // Caras detectadas secundarias
        this.faces = [];
        this.lastResetGesture = false;

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
    }

    setInverted(val) {
        this.isInverted = val;
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
        
        if (data.detected && data.primary_cursor) {
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

            // Detección de gesto para reinicio automático (manos juntas)
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
    }

    update() {
        // Suavizado fluido de posición del cursor
        const lerpFactor = 0.35;
        this.cursor.x += (this.cursor.targetX - this.cursor.x) * lerpFactor;
        this.cursor.y += (this.cursor.targetY - this.cursor.y) * lerpFactor;

        const cx = this.cursor.x;
        const cy = this.cursor.y;
        
        // Radio de vórtice calibrado más compacto y controlable
        const influenceRadius = this.params.vortexRadius * (this.cursor.scale ? Math.max(this.cursor.scale * 2.0, 0.7) : 1);
        
        // VECTOR DE VIENTO DIRECCIONAL PROYECTADO DESDE LA NARIZ HACIA LA(S) MANO(S):
        // Si hay una o dos manos activas, el vector resultante empuja las partículas con fuerza
        const handWindX = (this.cursor.windVx || 0) * this.params.windStrength * 5.0;
        const handWindY = (this.cursor.windVy || 0) * this.params.windStrength * 5.0;

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const dx = p.x - cx;
            const dy = p.y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            if (this.mode === 'swarm') {
                // Modo 1: Enjambre & Vórtice orbital con influencia directa de viento e inclinación
                if (this.cursor.active) {
                    if (dist < influenceRadius) {
                        const force = (1 - dist / influenceRadius);
                        
                        // Repulsión si se mueve rápido la cabeza
                        if (this.cursor.speed > 0.8) {
                            p.vx += (dx / dist) * force * 8;
                            p.vy += (dy / dist) * force * 8;
                        } else {
                            // Vórtice rotacional controlado
                            const vortexAngle = Math.atan2(dy, dx) + Math.PI / 2;
                            p.vx += Math.cos(vortexAngle) * force * 2.8;
                            p.vy += Math.sin(vortexAngle) * force * 2.8;
                            
                            // Atracción gravitacional al centro de la cara
                            p.vx += (cx - p.x) * this.params.gravity * force;
                            p.vy += (cy - p.y) * this.params.gravity * force;
                        }

                        // Empuje directo del viento de las manos en el área de influencia
                        p.vx += handWindX * force * 1.6;
                        p.vy += handWindY * force * 1.6;
                    }
                }

                // Corriente de viento ambiental generada por los vectores de las manos
                p.vx += handWindX * 0.25;
                p.vy += handWindY * 0.25;

                // Fricción y límite de velocidad para evitar aceleraciones descontroladas
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
                // Modo 4: Juego de Burbujas - partículas suaves de fondo
                p.x += p.vx * 0.5 + handWindX * 0.1;
                p.y += p.vy * 0.5 + handWindY * 0.1;
                p.vx *= 0.95;
                p.vy *= 0.95;
            }

            // Rebote / reaparición continua en bordes de pantalla
            if (p.x < 0) { p.x = this.width; }
            if (p.x > this.width) { p.x = 0; }
            if (p.y < 0) { p.y = this.height; }
            if (p.y > this.height) { p.y = 0; }
        }

        // Actualizar burbujas del juego
        if (this.mode === 'bubbles') {
            this.updateBubbles();
        }
    }

    initBubbles() {
        this.bubbles = [];
        for (let i = 0; i < 7; i++) {
            this.spawnBubble();
        }
        this.bubbleScore = 0;
        this.popSparks = [];
    }

    spawnBubble() {
        this.bubbles.push({
            x: Math.random() * (this.width - 160) + 80,
            y: this.height + Math.random() * 80 + 30,
            radius: Math.random() * 20 + 35,
            speedY: Math.random() * 1.5 + 1.2,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: Math.random() * 0.04 + 0.02,
            color: '#00ff88',
            popped: false
        });
    }

    updateBubbles() {
        if (!this.bubbles) this.initBubbles();

        const cx = this.cursor.x;
        const cy = this.cursor.y;

        for (let i = this.bubbles.length - 1; i >= 0; i--) {
            const b = this.bubbles[i];
            b.y -= b.speedY;
            b.wobble += b.wobbleSpeed;
            b.x += Math.sin(b.wobble) * 1.2;

            // Detección de colisión con el cursor de la cabeza
            if (this.cursor.active) {
                const dist = Math.hypot(b.x - cx, b.y - cy);
                if (dist < b.radius + 18) {
                    // ¡BURBUJA REVENTADA!
                    this.createBubblePopEffect(b.x, b.y, b.radius);
                    this.bubbles.splice(i, 1);
                    this.spawnBubble();
                    this.bubbleScore++;
                    if (window.onBubblePopped) {
                        window.onBubblePopped(this.bubbleScore);
                    }
                    continue;
                }
            }

            // Si sale por arriba, reaparece abajo
            if (b.y < -b.radius * 2) {
                this.bubbles.splice(i, 1);
                this.spawnBubble();
            }
        }

        // Actualizar chispas de explosión
        if (this.popSparks) {
            for (let i = this.popSparks.length - 1; i >= 0; i--) {
                const s = this.popSparks[i];
                s.x += s.vx;
                s.y += s.vy;
                s.alpha *= 0.92;
                if (s.alpha < 0.05) this.popSparks.splice(i, 1);
            }
        }
    }

    createBubblePopEffect(x, y, radius) {
        if (!this.popSparks) this.popSparks = [];
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
                color: this.isInverted ? '#000000' : '#00ff88'
            });
        }
    }

    render() {
        const ctx = this.ctx;
        const color = this.isInverted ? '#000000' : '#ffffff';
        const trailAlpha = this.mode === 'trails' ? 0.08 : 0.25;

        // Limpiar canvas con estela (trail effect)
        ctx.fillStyle = this.isInverted 
            ? `rgba(255, 255, 255, ${trailAlpha})` 
            : `rgba(0, 0, 0, ${trailAlpha})`;
        ctx.fillRect(0, 0, this.width, this.height);

        // Renderizado de partículas de fondo
        ctx.fillStyle = color;
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            ctx.globalAlpha = p.alpha || 0.8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.baseRadius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        // Renderizar Burbujas del Juego (Modo 4)
        if (this.mode === 'bubbles' && this.bubbles) {
            this.bubbles.forEach(b => {
                ctx.save();
                ctx.strokeStyle = this.isInverted ? 'rgba(0, 0, 0, 0.8)' : 'rgba(0, 255, 136, 0.85)';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
                ctx.stroke();

                // Brillo interno de la burbuja
                ctx.fillStyle = this.isInverted ? 'rgba(0, 0, 0, 0.06)' : 'rgba(0, 255, 136, 0.12)';
                ctx.fill();

                // Destello especular
                ctx.fillStyle = this.isInverted ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.7)';
                ctx.beginPath();
                ctx.arc(b.x - b.radius * 0.35, b.y - b.radius * 0.35, b.radius * 0.2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });

            // Renderizar chispas de reventón
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

        // Dibujar indicador dinámico del cursor facial (solo en modos interactivos)
        if (this.cursor.active && (this.mode === 'quadrant' || this.mode === 'bubbles')) {
            ctx.save();
            ctx.translate(this.cursor.x, this.cursor.y);
            ctx.rotate(this.cursor.tilt);

            // Anillo central con micropulsación
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 18 + Math.sin(Date.now() * 0.008) * 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }
}
