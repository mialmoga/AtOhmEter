// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor COLORS
//  Cubo de Agua con Luces RGB
//
//  Un cubo de fluido que se tiñe de luz.
//  Tres proyecciones de luz R/G/B desde diferentes ángulos.
//  Donde se cruzan → luz blanca aditiva.
//  El fluido tiene perturbaciones tipo agua con cáustics.
//  El toque perturba la superficie del fluido.
//  La inyección "sono" dispara un destello de sonoluminiscencia.
//
//  Campos:
//    fluid[T]   — densidad del fluido (ondas, perturbaciones)
//    vel[T]     — velocidad del fluido
//    light_r[T] — intensidad de luz R acumulada en cada punto
//    light_g[T] — intensidad de luz G
//    light_b[T] — intensidad de luz B
//    sono[T]    — campo de sonoluminiscencia (burbuja + destello)
//
//  La física del fluido es una ecuación de ondas amortiguada
//  con término no-lineal para generar cáustics realistas.
//
//  Ámbar — Mayo 2026 😈
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        // Fluido
        WAVE_SPEED:   0.35,   // velocidad de propagación de ondas
        DAMPING:      0.9985, // amortiguamiento
        NONLIN:       0.3,    // no-linealidad (genera cáustics)
        SURFACE_TENS: 0.15,   // tensión superficial

        // Luces RGB
        LIGHT_R_X:   -0.7,   // posición X de la luz roja [-1,1]
        LIGHT_G_X:    0.0,   // posición X de la luz verde
        LIGHT_B_X:    0.7,   // posición X de la luz azul
        LIGHT_SPREAD: 0.6,   // apertura del cono de luz
        LIGHT_SPEED:  0.08,  // qué tan rápido se propaga la luz

        // Sonoluminiscencia
        SONO_DECAY:   0.92,  // decaimiento del destello
        SONO_RADIUS:  0.12,  // radio de la burbuja

        // Interacción táctil
        TOUCH_FORCE:  1.2,   // fuerza de la perturbación táctil
        TOUCH_RADIUS: 0.25,  // radio de la perturbación

        DT:     0.015,
        THRESH: 0.04,
    };

    // ── Campos ───────────────────────────────────────────────
    const fluid   = new Float64Array(T);
    const vel     = new Float64Array(T);
    const light_r = new Float64Array(T);
    const light_g = new Float64Array(T);
    const light_b = new Float64Array(T);
    const sono    = new Float64Array(T); // sonoluminiscencia

    // Estado de sonoluminiscencia
    let sono_active = false;
    let sono_pos    = { x:0, y:0, z:0 };
    let sono_phase  = 0; // 0=burbuja creciendo, 1=colapsando, 2=destello

    const lap_f = new Float64Array(T);

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    function lap_scalar(F, out) {
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            out[i] = F[idx(x+1,y,z)] + F[idx(x-1,y,z)]
                   + F[idx(x,y+1,z)] + F[idx(x,y-1,z)]
                   + F[idx(x,y,z+1)] + F[idx(x,y,z-1)]
                   - 6*F[i];
        }
    }

    // ── Propagación de luz volumétrica ───────────────────────
    // Cada luz "baña" el volumen desde su posición de origen
    // La densidad del fluido dispersa la luz (scattering)
    function propagateLights() {
        const c = N >> 1;

        // Posiciones de las tres lámparas en espacio de grid
        const lamps = [
            { F: light_r, gx: Math.floor((P.LIGHT_R_X * 0.5 + 0.5) * (N-1)), gy: N-1, gz: c },
            { F: light_g, gx: Math.floor((P.LIGHT_G_X * 0.5 + 0.5) * (N-1)), gy: N-1, gz: c },
            { F: light_b, gx: Math.floor((P.LIGHT_B_X * 0.5 + 0.5) * (N-1)), gy: N-1, gz: c },
        ];

        for (const lamp of lamps) {
            // Inyectar luz en la posición de la lámpara
            const r = Math.max(2, Math.floor(N*0.08));
            for (let dx=-r;dx<=r;dx++) for (let dz=-r;dz<=r;dz++) {
                const d2=dx*dx+dz*dz;
                if(d2>r*r) continue;
                const i=idx(lamp.gx+dx, N-1, lamp.gz+dz);
                lamp.F[i]=1.0;
            }

            // Difundir la luz hacia abajo con scattering del fluido
            for (let x=0;x<N;x++) for (let y=N-2;y>=0;y--) for (let z=0;z<N;z++) {
                const i=idx(x,y,z);
                const above=lamp.F[idx(x,y+1,z)];
                const scatter=1.0 - Math.abs(fluid[i])*0.3;
                lamp.F[i]=Math.max(lamp.F[i], above*scatter*0.96);
            }

            // Decay suave
            for (let i=0;i<T;i++) lamp.F[i]*=0.98;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt=P.DT;
        lap_scalar(fluid, lap_f);

        // ── Ecuación de ondas + no-linealidad (cáustics) ──────
        for (let i=0;i<T;i++) {
            const f=fluid[i];
            // Onda base
            const wave = P.WAVE_SPEED*P.WAVE_SPEED * lap_f[i];
            // No-linealidad — simula cáustics (variación de índice de refracción)
            const nonlin = -P.NONLIN * f * f * f;
            // Tensión superficial — estabiliza frecuencias altas
            const tension = -P.SURFACE_TENS * lap_f[i] * Math.abs(f);

            vel[i] = (vel[i] + (wave + nonlin + tension)*dt) * P.DAMPING;
            fluid[i] += vel[i]*dt;

            // Clamp suave
            if(fluid[i]>2) fluid[i]=2;
            if(fluid[i]<-2) fluid[i]=-2;
        }

        // ── Propagación de luces ──────────────────────────────
        propagateLights();

        // ── Sonoluminiscencia ─────────────────────────────────
        if (sono_active) {
            sono_phase += dt * 0.8;
            const c=N>>1;
            const sx=Math.floor((sono_pos.x*0.5+0.5)*(N-1));
            const sy=Math.floor((sono_pos.y*0.5+0.5)*(N-1));
            const sz=Math.floor((sono_pos.z*0.5+0.5)*(N-1));
            const r=Math.floor(P.SONO_RADIUS*N);

            // Fase 0-1: burbuja creciendo (cavitación)
            // Fase 1-2: colapso + destello de luz
            // Fase 2+: decaimiento
            if (sono_phase < 1.0) {
                // Burbuja — cavidad en el fluido
                for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
                    const d2=dx*dx+dy*dy+dz*dz;
                    if(d2>r*r) continue;
                    const i=idx(sx+dx,sy+dy,sz+dz);
                    const strength=(1-Math.sqrt(d2)/r)*sono_phase;
                    fluid[i] -= strength*0.3;
                    sono[i]=strength;
                }
            } else if (sono_phase < 1.3) {
                // Destello — luz blanca explosiva
                const flash=1-(sono_phase-1)/0.3;
                const r2=r*2;
                for(let dx=-r2;dx<=r2;dx++) for(let dy=-r2;dy<=r2;dy++) for(let dz=-r2;dz<=r2;dz++) {
                    const d2=dx*dx+dy*dy+dz*dz;
                    if(d2>r2*r2) continue;
                    const i=idx(sx+dx,sy+dy,sz+dz);
                    const dist=Math.sqrt(d2)/r2;
                    const intensity=flash*Math.exp(-dist*2);
                    sono[i]=intensity;
                    // Onda de choque en el fluido
                    vel[i]+=intensity*0.4*(dx+dy+dz)/(Math.sqrt(d2)+1);
                }
            } else {
                // Decaimiento
                for(let i=0;i<T;i++) sono[i]*=P.SONO_DECAY;
                if(sono_phase>3) { sono_active=false; sono_phase=0; sono.fill(0); }
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    // ══════════════════════════════════════════════════════════
    function refresh() {
        for (let i=0;i<T;i++) {
            const f=fluid[i];
            const r=light_r[i];
            const g=light_g[i];
            const b=light_b[i];
            const s=sono[i];

            // Volumen: intensidad total de luz + sonoluminiscencia
            const light_total = r + g + b;
            renderVolume[i] = Math.abs(f)*0.2 + light_total*0.6 + s*1.5;

            // Fase: codifica el color RGB en [0,1]
            // Usamos una codificación que el shader puede decodificar:
            // El color dominante determina la fase
            // 0.0=rojo, 0.33=verde, 0.66=azul, 0.5=blanco (mezcla)
            // Normalizar RGB
            const total=r+g+b+1e-8;
            const rn=r/total, gn=g/total, bn=b/total;

            // Ángulo en rueda de colores según dominancia RGB
            // R=0°, G=120°, B=240°
            let hue = (rn*0 + gn*0.333 + bn*0.666);
            // Si hay mezcla equilibrada → blanco (fase=0.5)
            const balance = 1 - Math.max(Math.abs(rn-gn), Math.abs(gn-bn), Math.abs(rn-bn));
            hue = hue*(1-balance) + 0.5*balance;

            // Sonoluminiscencia → blanco puro
            phaseData[i] = s > 0.1 ? 0.5 : hue;
        }

        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function clearFields() {
        fluid.fill(0); vel.fill(0);
        light_r.fill(0); light_g.fill(0); light_b.fill(0);
        sono.fill(0); sono_active=false; sono_phase=0;
    }

    function seedCalma() {
        clearFields();
        // Fluido en reposo con pequeñas perturbaciones aleatorias
        for(let i=0;i<T;i++) {
            fluid[i]=(Math.random()-0.5)*0.05;
        }
    }

    function seedOndas() {
        clearFields();
        // Ondas concéntricas desde el centro
        const c=N>>1;
        for(let x=0;x<N;x++) for(let y=0;y<N;y++) for(let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const dx=x-c,dy=y-c,dz=z-c;
            const r=Math.sqrt(dx*dx+dy*dy+dz*dz);
            fluid[i]=Math.sin(r*0.8)*Math.exp(-r*0.08)*0.4;
        }
    }

    function seedTurbulencia() {
        clearFields();
        // Campo de velocidad turbulento
        for(let i=0;i<T;i++) {
            fluid[i]=(Math.random()-0.5)*0.3;
            vel[i]=(Math.random()-0.5)*0.1;
        }
    }

    function initSeed(name) {
        if(name==='calma')          seedCalma();
        else if(name==='ondas')     seedOndas();
        else if(name==='turbulencia') seedTurbulencia();
        else                        seedCalma();
        refresh();
    }

    initSeed('calma');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let f_total=0, f_max=0, v_total=0;
        let r_total=0, g_total=0, b_total=0;
        let white_zones=0;

        for(let i=0;i<T;i++) {
            const fa=Math.abs(fluid[i]);
            f_total+=fa; if(fa>f_max) f_max=fa;
            v_total+=Math.abs(vel[i]);
            r_total+=light_r[i];
            g_total+=light_g[i];
            b_total+=light_b[i];
            // Zona blanca: las tres luces presentes
            if(light_r[i]>0.1 && light_g[i]>0.1 && light_b[i]>0.1) white_zones++;
        }

        return {
            E_total:   f_total/T,
            E_kin:     v_total/T,
            E_torsion: r_total/T,
            E_phase:   g_total/T,
            helicity:  b_total/T,
            boundary:  white_zones/T,
            pump:      sono_active ? 1 : 0,
            u_max:     f_max,
            th_max:    v_total/T,
            phi_max:   f_max,
            psiMax:    f_max,
            coherence: white_zones/T,
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES + TOUCH
    // ══════════════════════════════════════════════════════════
    function injectTouch(pos) {
        if(!pos) return;
        const c=N>>1;
        // Convertir coordenadas [-1,1] a índices de grid
        const tx=Math.floor((pos.x*0.5+0.5)*(N-1));
        const ty=Math.floor((pos.y*0.5+0.5)*(N-1));
        const tz=Math.floor((pos.z*0.5+0.5)*(N-1));
        const r=Math.floor(P.TOUCH_RADIUS*N);

        for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
            const d2=dx*dx+dy*dy+dz*dz;
            if(d2>r*r) continue;
            const i=idx(tx+dx,ty+dy,tz+dz);
            const strength=(1-Math.sqrt(d2)/r)*P.TOUCH_FORCE;
            vel[i]+=strength*(Math.random()-0.5)*0.5;
            fluid[i]+=strength*0.2;
        }
    }

    function injectSono() {
        // Dispara sonoluminiscencia en posición aleatoria dentro del cubo
        sono_active=true;
        sono_phase=0;
        sono_pos={
            x:(Math.random()-0.5)*0.6,
            y:(Math.random()-0.5)*0.6,
            z:(Math.random()-0.5)*0.6,
        };
    }

    function injectPulso() {
        const c=N>>1, r=N>>3;
        for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
            const i=idx(c+dx,c+dy,c+dz);
            vel[i]+=(Math.random()-0.5)*0.8;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  API
    // ══════════════════════════════════════════════════════════
    return {
        step, refresh, getMetrics,
        getState() {
            return {
                fluid: new Float32Array(fluid),
                vel:   new Float32Array(vel),
            };
        },
        loadState(s) {
            if(s.fluid) fluid.set(s.fluid);
            if(s.vel)   vel.set(s.vel);
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev()  {},
        applyParams(p) { Object.assign(P,p); },
        getParams()    { return {...P}; },
        initSeed, seed: initSeed,
        inject(name, data) {
            if(name==='touch')       injectTouch(data);
            else if(name==='sono')   injectSono();
            else if(name==='pulso')  injectPulso();
            else if(name==='calma')  { fluid.fill(0); vel.fill(0); }
            refresh();
        },
        classifyState(m) {
            if(m.pump>0.5)         return 'locked';    // sono activo
            if(m.coherence>0.15)   return 'pumping';   // mucho blanco
            if(m.E_kin>0.05)       return 'active';
            if(m.E_total>0.02)     return 'nucleating';
            return 'vacuum';
        },
    };
}
