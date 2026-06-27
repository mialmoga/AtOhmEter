// ══════════════════════════════════════════════════════════════
//  AtOhmEter — CHLADNI 3D
//
//  "La forma del sonido"
//
//  Casi nunca vemos el sonido como lo que es: presión que se
//  propaga por un medio. Lo vemos como una línea de osciloscopio
//  — una rebanada. Aquí no.
//
//  Tres fuentes pulsan presión real en el sustrato. La presión
//  se propaga (ecuación de onda de verdad), rebota en las paredes
//  del cubo, e interfiere consigo misma. Donde las ondas caben
//  exactamente en la caja, forman ondas ESTACIONARIAS — los modos
//  propios de la cavidad. Donde no caben, tiemblan en turbulencia.
//
//  La estacionariedad no se programa: EMERGE. Solo ciertas
//  frecuencias resuenan; las demás se quedan inestables. Afinar
//  un oscilador a una frecuencia modal congela la figura; desafinarlo
//  la deshace.
//
//  Y para verlo: un medio GRANULAR. Como la arena en una placa de
//  Chladni, los granos huyen de donde el medio vibra fuerte
//  (antinodos) y quedan atrapados donde está quieto (nodos). La
//  arena no dibuja la onda — dibuja dónde la onda NO se mueve.
//  Las superficies nodales en 3D. Las figuras de Chladni reales.
//
//  ── Las dos fuerzas que se oponen (en los granos) ───────────
//  (1) LA VIBRACIÓN expulsa: los granos son empujados fuera de
//      los antinodos (alta amplitud vibratoria).
//  (2) LA QUIETUD recoge: los granos se acumulan y atrapan en
//      los nodos (amplitud cero). La estructura es el equilibrio.
//
//  El campo de presión es honesto (ecuación de onda real). La
//  arena es lo que lo hace visible.
//
//  Ecuación del medio:
//      ∂²p/∂t² = c²∇²p  +  Σ fuentes_i(x, t)     (onda + pulsos)
//      vib(x)   = ⟨p²⟩  (RMS local — amplitud vibratoria)
//      grano:   migra hacia ∇(−vib)  +  difusión   (huye del ruido)
//
//  Demuestra:
//  ✓ Ecuación de onda real de segundo orden (Verlet)
//  ✓ Ondas estacionarias EMERGENTES (modos de la cavidad)
//  ✓ Medio granular con dinámica propia (Chladni 3D)
//  ✓ Tres fuentes con posición, frecuencia, forma y ganancia
//  ✓ Capacidad de sonido (config.sound → Web Audio en el shell)
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    // ── Parámetros — cada clave coincide con config.json → params ──
    // Tres fuentes (1,2,3), cada una con: posición XYZ, pitch, forma, gain.
    let P = {
        // Fuente 1
        S1_X: 0.5, S1_Y: 0.5, S1_Z: 0.5, S1_PITCH: 4.0,  S1_WAVE: 0.0, S1_GAIN: 1.0,
        // Fuente 2 (apagada por gain=0 en modo 1)
        S2_X: 0.3, S2_Y: 0.7, S2_Z: 0.5, S2_PITCH: 6.0,  S2_WAVE: 0.0, S2_GAIN: 0.0,
        // Fuente 3
        S3_X: 0.7, S3_Y: 0.3, S3_Z: 0.5, S3_PITCH: 8.0,  S3_WAVE: 0.0, S3_GAIN: 0.0,
        // Globales
        C_SPEED:   0.6,   // velocidad de onda (CFL: mantener c·DT/DX < 1)
        DAMP:      0.9995,// amortiguamiento del medio (cercano a 1 = resuena más)
        GRAIN_MIG: 0.5,   // qué tan rápido migran los granos hacia los nodos
        GRAIN_DIFF:0.02,  // difusión de granos (los desparrama un poco)
        VIB_MEM:   0.96,  // memoria del campo de vibración (RMS suavizado)
        DT:        0.6,   // paso temporal
        THRESH:    0.04,  // umbral visual
    };

    // ── Campos del motor ─────────────────────────────────────
    const p     = new Float64Array(T);  // presión actual
    const p_vel = new Float64Array(T);  // velocidad de presión (∂p/∂t) — Verlet
    const lap   = new Float64Array(T);  // laplaciano (buffer)
    const vib   = new Float64Array(T);  // amplitud vibratoria local (RMS suavizado)
    const grain = new Float64Array(T);  // densidad de granos (la arena — lo que se ve)
    const gnext = new Float64Array(T);  // buffer de granos

    let phase_t = 0.0; // reloj de fase para los osciladores de las fuentes

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    function laplaciano(F, out) {
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            out[i] = F[idx(x+1,y,z)]+F[idx(x-1,y,z)]
                   + F[idx(x,y+1,z)]+F[idx(x,y-1,z)]
                   + F[idx(x,y,z+1)]+F[idx(x,y,z-1)] - 6*F[i];
        }
    }

    // ── Forma de onda barrible: sin → saw → square según w ∈ [0,1] ──
    // w=0   → seno puro
    // w=0.5 → diente de sierra
    // w=1   → cuadrada
    // Interpola entre las tres para que el slider de "forma" sea continuo.
    function waveShape(angle, w) {
        const s = Math.sin(angle);                                  // seno
        // diente de sierra en [-1,1] a partir de la fase normalizada
        const ph = ((angle/(2*Math.PI)) % 1.0 + 1.0) % 1.0;
        const saw = 2.0*ph - 1.0;                                   // sierra
        const sq  = s >= 0 ? 1.0 : -1.0;                            // cuadrada
        if (w < 0.5) {
            const t = w * 2.0;
            return s*(1-t) + saw*t;
        } else {
            const t = (w - 0.5) * 2.0;
            return saw*(1-t) + sq*t;
        }
    }

    // Posición de una fuente en índices de grid
    function srcIdx(fx, fy, fz) {
        const x = Math.max(1, Math.min(N-2, Math.round(fx*(N-1))));
        const y = Math.max(1, Math.min(N-2, Math.round(fy*(N-1))));
        const z = Math.max(1, Math.min(N-2, Math.round(fz*(N-1))));
        return idx(x,y,z);
    }

    // Inyectar el pulso de las tres fuentes en la presión.
    // Cada fuente oscila a su PITCH con su WAVE, escalada por su GAIN.
    // La frecuencia angular = PITCH; el tiempo es phase_t.
    // La fuente no es un punto: empuja una pequeña gaussiana, para acoplar
    // energía suficiente al medio y sostener la onda estacionaria.
    function driveSources() {
        const sources = [
            [P.S1_X,P.S1_Y,P.S1_Z, P.S1_PITCH, P.S1_WAVE, P.S1_GAIN],
            [P.S2_X,P.S2_Y,P.S2_Z, P.S2_PITCH, P.S2_WAVE, P.S2_GAIN],
            [P.S3_X,P.S3_Y,P.S3_Z, P.S3_PITCH, P.S3_WAVE, P.S3_GAIN],
        ];
        const r = 2; // radio del acople de la fuente
        for (const [fx,fy,fz,pitch,wave,gain] of sources) {
            if (gain <= 0.0001) continue;
            // PITCH controla la frecuencia espacial del modo; lo escalamos para
            // que el rango de sliders (1-12) recorra modos visibles de la caja.
            const drive = waveShape(phase_t * pitch * 0.6, wave) * gain * 3.5;
            const cx = Math.max(r, Math.min(N-1-r, Math.round(fx*(N-1))));
            const cy = Math.max(r, Math.min(N-1-r, Math.round(fy*(N-1))));
            const cz = Math.max(r, Math.min(N-1-r, Math.round(fz*(N-1))));
            for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
                const rr2 = dx*dx+dy*dy+dz*dz;
                if (rr2 > r*r) continue;
                const i = idx(cx+dx,cy+dy,cz+dz);
                p[i] += drive * Math.exp(-rr2/(2*0.8*0.8));
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;
        phase_t += dt;

        // ── 1. Las fuentes empujan presión ──
        driveSources();

        // ── 2. La onda se propaga: ∂²p/∂t² = c²∇²p ──
        // Verlet de segundo orden (la misma estructura del v4).
        laplaciano(p, lap);
        const c2 = P.C_SPEED * P.C_SPEED;
        for (let i=0;i<T;i++) {
            const accel = c2 * lap[i];
            p_vel[i] = (p_vel[i] + accel * dt) * P.DAMP;
            p[i]    += p_vel[i] * dt;
        }

        // ── 3. Actualizar el campo de vibración (envolvente de amplitud) ──
        // vib mide cuánto vibra cada celda. NO usamos promedio temporal simple
        // porque una oscilación rápida promedia a cero y borraría la señal.
        // Usamos una ENVOLVENTE: vib persigue el pico de |p| y decae despacio.
        // Así los antinodos (gran oscilación) mantienen vib alto, los nodos
        // (sin oscilación) lo mantienen en cero. Eso revela el patrón estacionario.
        const mem = P.VIB_MEM;
        for (let i=0;i<T;i++) {
            const amp = Math.abs(p[i]);          // amplitud instantánea
            // envolvente: sube rápido al pico, baja lento (memoria)
            vib[i] = Math.max(amp, vib[i]*mem);
        }

        // ── 4. Los granos migran hacia los nodos (vibración mínima) ──
        // Cada grano huye de donde el medio vibra. Esquema de transporte:
        // para cada celda, repartimos parte de su arena hacia los vecinos
        // MÁS TRANQUILOS (menor vib), proporcional a cuánto más tranquilos son.
        // Eso vacía los antinodos y apila la arena en los nodos.
        const mig = P.GRAIN_MIG, diff = P.GRAIN_DIFF;
        gnext.set(grain);
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            const gi = grain[i];
            if (gi <= 1e-6) continue;
            const vi = vib[i];

            const nb = [idx(x+1,y,z),idx(x-1,y,z),idx(x,y+1,z),idx(x,y-1,z),idx(x,y,z+1),idx(x,y,z-1)];

            // Calcular "atractividad" de cada vecino: más tranquilo = más atractivo
            let weights = [0,0,0,0,0,0];
            let wsum = 0;
            for (let k=0;k<6;k++) {
                const dv = vi - vib[nb[k]];        // >0 si el vecino vibra menos
                const w = Math.max(0, dv) * mig + diff;  // migración dirigida + difusión base
                weights[k] = w;
                wsum += w;
            }
            if (wsum <= 0) continue;

            // Mover una fracción de la arena, repartida según los pesos.
            // Cap al 50% para estabilidad (no vaciar la celda de golpe).
            const moveTotal = Math.min(gi * 0.5, gi * wsum);
            for (let k=0;k<6;k++) {
                const frac = weights[k] / wsum;
                const moved = moveTotal * frac;
                gnext[i]     -= moved;
                gnext[nb[k]] += moved;
            }
        }
        for (let i=0;i<T;i++) grain[i] = Math.max(0, gnext[i]);
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    //  Volumen = GRANOS (la arena — las figuras de Chladni)
    //  Fase    = FUENTE DOMINANTE + VIBRACIÓN, codificadas juntas.
    //            La fase se divide en 3 bandas (una por fuente). La banda
    //            dice QUÉ fuente domina esa celda (color RGB en el shader);
    //            la posición dentro de la banda codifica la vibración local.
    //            Versión "C": la fuente dominante es la más cercana ponderada
    //            por su gain — barato, sin rastrear tres ondas separadas.
    // ══════════════════════════════════════════════════════════
    function dominantSource(x, y, z) {
        // Devuelve el índice de fuente (0,1,2) que más "pesa" en esta celda:
        // mayor gain / distancia². Las fuentes apagadas (gain 0) no cuentan.
        const srcs = [
            [P.S1_X,P.S1_Y,P.S1_Z, P.S1_GAIN],
            [P.S2_X,P.S2_Y,P.S2_Z, P.S2_GAIN],
            [P.S3_X,P.S3_Y,P.S3_Z, P.S3_GAIN],
        ];
        let best = 0, bestW = -1;
        const fx = x/(N-1), fy = y/(N-1), fz = z/(N-1);
        for (let s=0;s<3;s++) {
            const [sx,sy,sz,g] = srcs[s];
            if (g <= 0.0001) continue;
            const d2 = (fx-sx)**2 + (fy-sy)**2 + (fz-sz)**2 + 0.01;
            const w = g / d2;
            if (w > bestW) { bestW = w; best = s; }
        }
        return best;
    }

    function refresh() {
        let gmax = 1e-10, vmax = 1e-10;
        for (let i=0;i<T;i++) {
            if (grain[i] > gmax) gmax = grain[i];
            if (vib[i]   > vmax) vmax = vib[i];
        }
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            // Brillo = densidad de granos. La arena acumulada brilla.
            renderVolume[i] = grain[i] / gmax;

            // Vibración normalizada [0,1]. Reescalada con raíz para usar más
            // rango visible: la mayoría de celdas tienen vib baja, sqrt las
            // levanta para que el color recorra de nodo a antinodo de verdad.
            const vn = Math.sqrt(Math.min(1.0, vib[i] / vmax));

            // Codificar: banda de fuente (0,1,2) + vibración dentro de banda.
            // Cada banda ocupa 1/3 del rango. Dentro de la banda, vn ∈ [0,1]
            // mapea a [0, 0.33). Así el shader saca: banda → color de fuente,
            // resto → intensidad de vibración (nodo↔antinodo).
            const src = dominantSource(x,y,z);
            phaseData[i] = (src + vn * 0.999) / 3.0;
        }
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS — los tres modos
    // ══════════════════════════════════════════════════════════

    function fillGrainsUniform() {
        // Arena repartida por todo el cubo — lista para migrar a los nodos.
        for (let i=0;i<T;i++) grain[i] = 0.5 + 0.1*Math.random();
    }

    function clearWave() {
        p.fill(0); p_vel.fill(0); vib.fill(0); phase_t = 0.0;
    }

    // Modo 1 — una sola fuente centrada. El patrón nodal más simple.
    function seedModo1() {
        clearWave();
        P.S1_GAIN = 1.0; P.S2_GAIN = 0.0; P.S3_GAIN = 0.0;
        P.S1_X=0.5; P.S1_Y=0.5; P.S1_Z=0.5;
        fillGrainsUniform();
    }

    // Modo 2 — dos fuentes. La interferencia de dos crea patrones más ricos.
    function seedModo2() {
        clearWave();
        P.S1_GAIN = 1.0; P.S2_GAIN = 1.0; P.S3_GAIN = 0.0;
        P.S1_X=0.35; P.S1_Y=0.5; P.S1_Z=0.5;
        P.S2_X=0.65; P.S2_Y=0.5; P.S2_Z=0.5;
        fillGrainsUniform();
    }

    // Modo 3 — tres fuentes en triángulo. Interferencia espacial compleja.
    function seedModo3() {
        clearWave();
        P.S1_GAIN = 1.0; P.S2_GAIN = 1.0; P.S3_GAIN = 1.0;
        P.S1_X=0.5;  P.S1_Y=0.3; P.S1_Z=0.5;
        P.S2_X=0.3;  P.S2_Y=0.7; P.S2_Z=0.5;
        P.S3_X=0.7;  P.S3_Y=0.7; P.S3_Z=0.5;
        fillGrainsUniform();
    }

    function seed(name) {
        if      (name==='modo1') seedModo1();
        else if (name==='modo2') seedModo2();
        else if (name==='modo3') seedModo3();
        else                     seedModo1();
        refresh();
    }

    seed('modo1');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let p_energy=0, vib_total=0, vib_max=0;
        let grain_total=0;
        let nodal=0;     // celdas en nodo (vib baja pero con granos = figura)
        let antinodal=0; // celdas en antinodo (vib alta)
        let p_max=0;

        // Necesitamos vmax para normalizar el conteo nodal
        let vmax=1e-10;
        for (let i=0;i<T;i++) if (vib[i]>vmax) vmax=vib[i];

        for (let i=0;i<T;i++) {
            const pe = p[i]*p[i];
            p_energy += pe;
            const a = Math.abs(p[i]); if (a>p_max) p_max=a;
            vib_total += vib[i]; if (vib[i]>vib_max) vib_max=vib[i];
            grain_total += grain[i];
            const vn = vib[i]/vmax;
            if (vn < 0.15 && grain[i] > 0.6) nodal++;   // nodo poblado de arena
            if (vn > 0.6) antinodal++;
        }

        // "Estacionariedad": qué tan concentrada está la arena en pocos nodos.
        // Si la figura es estable, los granos se apilan; si es turbulenta, se
        // reparten. Medimos la fracción de arena en celdas nodales.
        const stationarity = nodal / T;

        return {
            E_total:   p_energy/T,          // energía acústica media
            E_kin:     vib_total/T,         // vibración media
            E_torsion: stationarity,        // estacionariedad (figura formada) ← clave
            E_phase:   antinodal/T,         // fracción antinodal (zonas vibrantes)
            helicity:  0,
            boundary:  nodal/T,             // fracción nodal poblada (la figura)
            pump:      vib_max,             // pico de vibración
            u_max:     p_max,               // pico de presión
            th_max:    grain_total/T,       // densidad media de arena
            phi_max:   vib_max,
            psiMax:    p_max,               // el shell usa esto en classifyState
            coherence: stationarity,        // reusamos como medida de figura estable
            vortices:  nodal,               // nº de celdas nodales pobladas
        };
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        if (m.psiMax > 12)         return 'collapse';   // presión divergente (inestable)
        if (m.E_torsion > 0.06)    return 'locked';     // figura estacionaria estable ◉
        if (m.E_torsion > 0.025)   return 'stable';     // figura formándose
        if (m.E_total > 0.5)       return 'pumping';    // mucha energía acústica, aún turbulenta
        if (m.E_total > 0.1)       return 'active';     // el sonido llena el cubo
        if (m.E_total > 0.01)      return 'nucleating'; // primeras ondas
        return 'vacuum';                                // silencio
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES — las escalas del sonido
    // ══════════════════════════════════════════════════════════
    function inject(name) {
        if (name === 'subsonico') {
            // Subsónico: un pulso lento y enorme de gran amplitud — una
            // expansión que sacude todo el campo y reordena la arena.
            const cx=N>>1, cy=N>>1, cz=N>>1;
            const r=N>>2;
            for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
                const rr = Math.sqrt(dx*dx+dy*dy+dz*dz);
                if (rr > r) continue;
                const i=idx(cx+dx,cy+dy,cz+dz);
                p[i] += 2.5 * Math.exp(-rr*rr/(2*(r/2)**2)); // gaussiana grande
            }
        } else if (name === 'supersonico') {
            // Supersónico: ruido de alta frecuencia — agitación fina, apenas
            // apreciable, que perturba la arena en los bordes de las figuras.
            for (let i=0;i<T;i++) {
                p_vel[i] += (Math.random()-0.5) * 0.4;
            }
        } else if (name === 'silencio') {
            // Silencio: relaja el campo. La presión se amortigua de golpe y la
            // arena se asienta donde quedó — congela la figura actual.
            for (let i=0;i<T;i++) {
                p[i]     *= 0.2;
                p_vel[i] *= 0.1;
            }
        }
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  SNAPSHOTS
    // ══════════════════════════════════════════════════════════
    function getState() {
        return {
            p:     new Float32Array(p),
            grain: new Float32Array(grain),
            vib:   new Float32Array(vib),
        };
    }
    function setState(s) {
        if (s.p)     p.set(s.p);
        if (s.grain) grain.set(s.grain);
        if (s.vib)   vib.set(s.vib);
        p_vel.fill(0);
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  API PÚBLICA
    // ══════════════════════════════════════════════════════════
    return {
        step, refresh, getMetrics, classifyState, inject, seed,
        initSeed: seed,
        getState, setState,
        loadState(s) { this.setState(s); },
        savePrev() {},
        applyParams(p2) { Object.assign(P, p2); },
        getParams()    { return {...P}; },
        // Canal opcional de audio: el shell lee esto para sincronizar el
        // sintetizador con las fuentes reales del motor. Devuelve el estado
        // de cada voz (frecuencia, forma, ganancia) — el shell lo enruta a
        // Web Audio. Si el shell no lo usa, no pasa nada.
        getAudioVoices() {
            return [
                { freq: P.S1_PITCH, wave: P.S1_WAVE, gain: P.S1_GAIN },
                { freq: P.S2_PITCH, wave: P.S2_WAVE, gain: P.S2_GAIN },
                { freq: P.S3_PITCH, wave: P.S3_WAVE, gain: P.S3_GAIN },
            ];
        },
    };
}
