// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor RUMOR
//  Autómata Celular Cuántico de Consenso y Disenso
//
//  No hay ecuaciones diferenciales. No hay dt continuo.
//  Cada generación, cada celda hace UNA cosa:
//  preguntarle a sus vecinos qué piensan.
//
//  Estado: ψ ∈ ℂ por celda (amplitud + fase = "opinión")
//
//  Regla de actualización:
//    1. ESCUCHAR   — calcular el "rumor" del vecindario (promedio ponderado)
//    2. INTERFERIR — combinar mi opinión con el rumor (interferencia de fase)
//    3. REBELAR    — ignorar parcialmente al vecindario (ruido individual)
//    4. NORMALIZAR — mantener amplitud en rango razonable
//
//  Estructuras estables = consenso local (todos apuntan igual)
//  Estructuras interesantes = fronteras de disenso
//  Muerte = homogeneidad total (todos iguales = silencio)
//
//  Ámbar — Viernes Mayo 2026 😈
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        CONFORMITY:   0.65,  // qué tanto sigo al vecindario [0=rebelde, 1=conformista]
        INTERFERENCE: 0.8,   // fuerza de interferencia de fase entre vecinos
        REBELLION:    0.04,  // ruido individual por generación
        AMPLITUDE:    0.92,  // decaimiento de amplitud por generación (< 1 = mortal)
        STUBBORNNESS: 0.3,   // peso extra de la opinión propia vs vecinos
        REACH:        1,     // radio de vecindario (1=26 vecinos, 2=más)
        POLARITY:     1.0,   // 1=vecinos refuerzan, -1=vecinos invierten (antiferro)
        THRESH:       0.08,
    };

    // Estado actual y buffer de la próxima generación
    const psi_r = new Float64Array(T);
    const psi_i = new Float64Array(T);
    const next_r = new Float64Array(T);
    const next_i = new Float64Array(T);

    // Memoria: estado de hace 2 generaciones (para detectar oscilaciones)
    const prev_r = new Float64Array(T);
    const prev_i = new Float64Array(T);

    // Semilla de referencia para overlap
    const seed_r = new Float64Array(T);

    // Contadores de generación
    let generation = 0;

    function idx(x, y, z) {
        return ((x + N) % N) * N * N + ((y + N) % N) * N + ((z + N) % N);
    }

    // ══════════════════════════════════════════════════════════
    //  REGLA DE ACTUALIZACIÓN
    //  El corazón del autómata
    // ══════════════════════════════════════════════════════════
    function step() {
        const r = Math.max(1, Math.floor(P.REACH));

        // Guardar estado anterior para memoria
        prev_r.set(psi_r);
        prev_i.set(psi_i);

        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);

            const my_r = psi_r[i];
            const my_i = psi_i[i];
            const my_amp = Math.sqrt(my_r*my_r + my_i*my_i);
            const my_phase = Math.atan2(my_i, my_r);

            // ── 1. ESCUCHAR — recoger el rumor del vecindario ──
            let rumor_r = 0, rumor_i = 0;
            let neighbor_count = 0;
            let max_neighbor_amp = 0;

            for (let dx = -r; dx <= r; dx++)
            for (let dy = -r; dy <= r; dy++)
            for (let dz = -r; dz <= r; dz++) {
                if (dx === 0 && dy === 0 && dz === 0) continue;
                const j = idx(x+dx, y+dy, z+dz);
                const nr = psi_r[j], ni = psi_i[j];
                const namp = Math.sqrt(nr*nr + ni*ni);

                // Los vecinos más "convencidos" (mayor amplitud) hablan más fuerte
                const weight = namp + 0.1; // nunca cero — hasta el silencioso susurra
                rumor_r += nr * weight * P.POLARITY;
                rumor_i += ni * weight * P.POLARITY;
                neighbor_count += weight;
                if (namp > max_neighbor_amp) max_neighbor_amp = namp;
            }

            // Normalizar el rumor
            if (neighbor_count > 0) {
                rumor_r /= neighbor_count;
                rumor_i /= neighbor_count;
            }

            // ── 2. INTERFERIR — mi opinión + el rumor ─────────
            // Interferencia cuántica: la fase relativa importa
            // Si estoy en fase con el rumor → me refuerzo
            // Si estoy en antifase → me cancelo (disenso)
            const rumor_amp = Math.sqrt(rumor_r*rumor_r + rumor_i*rumor_i) + 1e-10;
            const rumor_phase = Math.atan2(rumor_i, rumor_r);
            const phase_diff = my_phase - rumor_phase;
            const interference = Math.cos(phase_diff); // 1=consenso, -1=disenso

            // Nueva amplitud: depende del alineamiento con el rumor
            const social_pressure = P.CONFORMITY * rumor_amp * (1 + P.INTERFERENCE * interference);

            // Nueva fase: rotación gradual hacia el rumor
            // (si interference < 0, me alejo — rebeldía natural)
            const phase_pull = P.CONFORMITY * (1 - P.STUBBORNNESS) * Math.sin(rumor_phase - my_phase);

            // ── 3. REBELAR — ruido individual ─────────────────
            // Cada celda tiene una pequeña mente propia
            const rebellion_angle = (Math.random() - 0.5) * 2 * Math.PI * P.REBELLION;
            const rebellion_amp = (Math.random() - 0.5) * P.REBELLION;

            // ── 4. CALCULAR nuevo estado ───────────────────────
            // Mezcla: mi opinión actual + presión social + rebeldía
            const stubborn_r = my_r * P.STUBBORNNESS;
            const stubborn_i = my_i * P.STUBBORNNESS;

            // Contribución social (con interferencia)
            const social_r = rumor_r * (1 - P.STUBBORNNESS) * P.CONFORMITY;
            const social_i = rumor_i * (1 - P.STUBBORNNESS) * P.CONFORMITY;

            let new_r = stubborn_r + social_r;
            let new_i = stubborn_i + social_i;

            // Rotación de fase (gradual convergencia/divergencia)
            const cos_pull = Math.cos(phase_pull);
            const sin_pull = Math.sin(phase_pull);
            const rotated_r = new_r * cos_pull - new_i * sin_pull;
            const rotated_i = new_r * sin_pull + new_i * cos_pull;
            new_r = rotated_r;
            new_i = rotated_i;

            // Rebeldía: pequeña rotación aleatoria
            const cos_reb = Math.cos(rebellion_angle);
            const sin_reb = Math.sin(rebellion_angle);
            new_r = new_r * cos_reb - new_i * sin_reb + rebellion_amp * 0.1;
            new_i = new_r * sin_reb + new_i * cos_reb;

            // Decaimiento de amplitud — sin esto el campo explota
            const new_amp = Math.sqrt(new_r*new_r + new_i*new_i) + 1e-10;
            const target_amp = my_amp * P.AMPLITUDE + social_pressure * 0.1;
            const scale = target_amp / new_amp;

            next_r[i] = new_r * scale;
            next_i[i] = new_i * scale;
        }

        // Swap buffers
        psi_r.set(next_r);
        psi_i.set(next_i);
        generation++;
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    // ══════════════════════════════════════════════════════════
    function refresh() {
        // Calcular disenso local — qué tan diferente soy de mis vecinos
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            const my_phase = Math.atan2(psi_i[i], psi_r[i]);
            const amp = Math.sqrt(psi_r[i]*psi_r[i] + psi_i[i]*psi_i[i]);

            // Disenso: promedio de |diferencia de fase| con 6 vecinos directos
            let dissent = 0;
            const neighbors6 = [
                idx(x+1,y,z), idx(x-1,y,z),
                idx(x,y+1,z), idx(x,y-1,z),
                idx(x,y,z+1), idx(x,y,z-1),
            ];
            for (const j of neighbors6) {
                const n_phase = Math.atan2(psi_i[j], psi_r[j]);
                let d = Math.abs(my_phase - n_phase);
                if (d > Math.PI) d = 2*Math.PI - d;
                dissent += d / Math.PI; // normalizado a [0,1]
            }
            dissent /= 6;

            // Volumen: amplitud modulada por disenso
            // Las fronteras de disenso brillan
            renderVolume[i] = amp * (0.3 + 0.7 * dissent);

            // Fase: ángulo de ψ en [0,1]
            phaseData[i] = my_phase / (2 * Math.PI) + 0.5;
        }

        texture3D.needsUpdate = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function clearFields() {
        psi_r.fill(0); psi_i.fill(0);
        next_r.fill(0); next_i.fill(0);
        prev_r.fill(0); prev_i.fill(0);
        generation = 0;
    }

    function seedConsenso() {
        // Todos apuntan en la misma dirección — máximo consenso
        // Aburrido pero estable. ¿Cuánto tarda en romperse?
        clearFields();
        for (let i = 0; i < T; i++) {
            psi_r[i] = 0.5 + (Math.random()-0.5)*0.02;
            psi_i[i] = (Math.random()-0.5)*0.02;
        }
        seed_r.set(psi_r);
    }

    function seedFacciones() {
        // El espacio dividido en 8 octantes con fases distintas
        // Máximo disenso inicial — ¿convergen o persisten las fronteras?
        clearFields();
        const c = N >> 1;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            // Fase según octante (0..7 → 0..2π)
            const oct = (x>c?4:0) + (y>c?2:0) + (z>c?1:0);
            const phase = oct * Math.PI / 4;
            const amp = 0.4 + (Math.random()-0.5)*0.05;
            psi_r[i] = amp * Math.cos(phase);
            psi_i[i] = amp * Math.sin(phase);
        }
        seed_r.set(psi_r);
    }

    function seedGossip() {
        // Un único "chisme" en el centro — máxima amplitud local
        // Veremos cómo se propaga a través del vecindario
        clearFields();
        const c = N >> 1, r = 2;
        // Todos en silencio (amplitud baja)
        for (let i = 0; i < T; i++) {
            psi_r[i] = (Math.random()-0.5)*0.02;
            psi_i[i] = (Math.random()-0.5)*0.02;
        }
        // Excepto el centro — que grita
        for (let x = c-r; x <= c+r; x++)
        for (let y = c-r; y <= c+r; y++)
        for (let z = c-r; z <= c+r; z++) {
            const i = idx(x,y,z);
            psi_r[i] = 1.0;
            psi_i[i] = 0.0;
        }
        seed_r.set(psi_r);
    }

    function seedAntiferro() {
        // Tablero de ajedrez 3D — vecinos siempre en antifase
        // El máximo disenso geométrico posible
        clearFields();
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x,y,z);
            const sign = ((x+y+z) % 2 === 0) ? 1 : -1;
            psi_r[i] = 0.4 * sign + (Math.random()-0.5)*0.02;
            psi_i[i] = (Math.random()-0.5)*0.02;
        }
        seed_r.set(psi_r);
    }

    function seedEspiral() {
        // Vórtice — fase gira 2π alrededor del eje Z
        clearFields();
        const c = N >> 1;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x,y,z);
            const dx = x-c, dy = y-c;
            const r = Math.sqrt(dx*dx+dy*dy)+1e-6;
            const angle = Math.atan2(dy,dx);
            const amp = Math.min(1.0, r/(N*0.3)) * Math.exp(-r*r/(N*N*0.1));
            psi_r[i] = amp * Math.cos(angle);
            psi_i[i] = amp * Math.sin(angle);
        }
        seed_r.set(psi_r);
    }

    function seedRuido() {
        clearFields();
        for (let i = 0; i < T; i++) {
            const amp = Math.random() * 0.5;
            const phase = Math.random() * 2 * Math.PI;
            psi_r[i] = amp * Math.cos(phase);
            psi_i[i] = amp * Math.sin(phase);
        }
        seed_r.set(psi_r);
    }

    function initSeed(name) {
        if (name === 'consenso')      seedConsenso();
        else if (name === 'facciones') seedFacciones();
        else if (name === 'gossip')    seedGossip();
        else if (name === 'antiferro') seedAntiferro();
        else if (name === 'espiral')   seedEspiral();
        else if (name === 'ruido')     seedRuido();
        else                           seedGossip();
        refresh();
    }

    initSeed('gossip');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let amp_total = 0, amp_max = 0;
        let dissent_total = 0, consensus_count = 0;
        let overlap_num = 0, overlap_na = 0, overlap_nb = 0;
        let oscillation = 0; // cuánto cambió desde hace 2 generaciones

        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x,y,z);
            const pr = psi_r[i], pi = psi_i[i];
            const amp = Math.sqrt(pr*pr + pi*pi);
            amp_total += amp;
            if (amp > amp_max) amp_max = amp;

            // Disenso local
            const my_phase = Math.atan2(pi, pr);
            let d = 0;
            const nb6 = [idx(x+1,y,z),idx(x-1,y,z),idx(x,y+1,z),idx(x,y-1,z),idx(x,y,z+1),idx(x,y,z-1)];
            for (const j of nb6) {
                const np = Math.atan2(psi_i[j], psi_r[j]);
                let diff = Math.abs(my_phase - np);
                if (diff > Math.PI) diff = 2*Math.PI - diff;
                d += diff / Math.PI;
            }
            d /= 6;
            dissent_total += d;
            if (d < 0.1) consensus_count++; // vecindario en acuerdo

            // Overlap
            overlap_num += pr * seed_r[i];
            overlap_na += pr*pr + pi*pi;
            overlap_nb += seed_r[i]*seed_r[i];

            // Oscilación: diferencia con hace 2 generaciones
            const dr = pr - prev_r[i], di = pi - prev_i[i];
            oscillation += dr*dr + di*di;
        }

        const mode_overlap = Math.abs(overlap_num / (Math.sqrt(overlap_na*overlap_nb)+1e-12));
        const dissent_avg = dissent_total / T;

        return {
            E_total:   amp_total / T,
            E_kin:     oscillation / T,        // "cambio" como proxy de energía cinética
            E_torsion: dissent_avg,            // disenso promedio
            E_phase:   consensus_count / T,    // fracción en consenso
            helicity:  amp_max,
            boundary:  1 - consensus_count/T,  // fracción en disenso
            pump:      generation,             // generación actual
            u_max:     amp_max,
            th_max:    dissent_avg,
            phi_max:   amp_max,
            psiMax:    amp_max,
            coherence: mode_overlap,
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function injectChisme() {
        // Un nuevo chisme en posición aleatoria
        const x = Math.floor(Math.random()*N);
        const y = Math.floor(Math.random()*N);
        const z = Math.floor(Math.random()*N);
        const r = 2;
        const phase = Math.random() * 2 * Math.PI;
        for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
            const i = idx(x+dx, y+dy, z+dz);
            psi_r[i] = 0.8 * Math.cos(phase);
            psi_i[i] = 0.8 * Math.sin(phase);
        }
    }

    function injectContradiccion() {
        // Invertir la fase en una esfera central — contradicción directa
        const c = N >> 1, r = N >> 3;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const dx = x-c, dy = y-c, dz = z-c;
            if (dx*dx+dy*dy+dz*dz < r*r) {
                const i = idx(x,y,z);
                // Invertir fase (rotar π)
                psi_r[i] *= -1;
                psi_i[i] *= -1;
            }
        }
    }

    function injectSilencio() {
        // Silenciar el centro — eliminar la fuente del rumor
        const c = N >> 1, r = N >> 4;
        for (let x = c-r; x <= c+r; x++)
        for (let y = c-r; y <= c+r; y++)
        for (let z = c-r; z <= c+r; z++) {
            const i = idx(x,y,z);
            psi_r[i] *= 0.05;
            psi_i[i] *= 0.05;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  API
    // ══════════════════════════════════════════════════════════
    return {
        step, refresh, getMetrics,
        getState() {
            return {
                psi_r: new Float32Array(psi_r),
                psi_i: new Float32Array(psi_i),
                generation,
            };
        },
        loadState(s) {
            if (s.psi_r) { psi_r.set(s.psi_r); seed_r.set(s.psi_r); }
            if (s.psi_i) psi_i.set(s.psi_i);
            if (s.generation) generation = s.generation;
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() {},
        applyParams(p) { Object.assign(P, p); },
        getParams() { return { ...P }; },
        initSeed,
        seed: initSeed,
        inject(name) {
            if (name === 'chisme')          injectChisme();
            else if (name === 'contradiccion') injectContradiccion();
            else if (name === 'silencio')   injectSilencio();
            refresh();
        },
        classifyState(m) {
            if (m.u_max > 10)          return 'collapse';
            if (m.E_phase > 0.7)       return 'locked';     // consenso masivo
            if (m.coherence > 0.75)    return 'stable';
            if (m.E_torsion > 0.6)     return 'active';     // disenso alto
            if (m.E_kin > 0.05)        return 'pumping';    // mucho cambio
            if (m.E_total < 0.05)      return 'vacuum';     // silencio
            return 'nucleating';
        },
    };
}
