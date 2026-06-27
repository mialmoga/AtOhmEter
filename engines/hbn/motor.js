// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor HBN
//  Polaritones Fonón-Fotón en Nitruro de Boro Hexagonal
//
//  Física:
//    Dos campos acoplados que se persiguen mutuamente:
//
//    ∂E/∂t = c_eff · L(E) − γ · Q        (campo EM frenado por fonones)
//    ∂Q/∂t = −ω_TO² · Q  + β · E        (fonones excitados por luz)
//
//    donde L(E) es el operador de propagación anisótropo:
//    en hBN real ε⊥ < 0, ε∥ > 0 → relación de dispersión hiperbólica
//    Las ondas solo se propagan en ángulos θ donde tan²θ = −ε⊥/ε∥
//
//  Campos:
//    E[T]  — campo electromagnético (escalar, componente z)
//    Q[T]  — desplazamiento fonónico
//    E2,Q2 — buffers para integración
//
//  Resultado visual:
//    Frentes de onda en forma de cono/cruz en lugar de esferas.
//    Phase codifica mezcla: 0=fonónico, 0.5=polaritón, 1=fotónico
//
//  Ámbar — 2026 🦝
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    // ── Parámetros ───────────────────────────────────────────
    let P = {
        // Físicos
        FREQ:         0.35,   // frecuencia de la fuente (mueve el ángulo del cono)
        ACOPLAMIENTO: 0.4,    // γ = β = acoplamiento fonón-fotón
        AMORT:        0.012,  // amortiguamiento (pérdidas del material)
        ANISO:        2.8,    // anisotropía: ratio |ε⊥/ε∥| del hBN
        C_EFF:        0.5,    // velocidad efectiva de la luz en el medio

        // Numérico
        DT:           0.18,
        THRESH:       0.03,

        // Semilla activa
        MODO:         0,      // 0=hBN, 1=isotrópico, 2=pulso, 3=dosfuentes
    };

    // ── Campos ───────────────────────────────────────────────
    const E  = new Float32Array(T);   // campo EM
    const Q  = new Float32Array(T);   // desplazamiento fonónico
    const dE = new Float32Array(T);   // velocidad de E (∂E/∂t)
    const dQ = new Float32Array(T);   // velocidad de Q (∂Q/∂t)
    const E2 = new Float32Array(T);   // buffer
    const Q2 = new Float32Array(T);   // buffer

    // Fuentes activas: array de {x,y,z,phase,strength}
    let sources = [];
    let frame = 0;

    function idx(x, y, z) {
        return ((x + N) % N) * N * N + ((y + N) % N) * N + ((z + N) % N);
    }

    // ── Operador de propagación anisótropo ────────────────────
    // En un medio hiperbólico el Laplaciano se modifica:
    // L(E) = ε∥·∂²E/∂x² + ε∥·∂²E/∂z² + ε⊥·∂²E/∂y²
    //
    // Con ε∥ > 0 y ε⊥ < 0 (tipo I, banda de Reststrahlen):
    // La propagación en Y es "negativa" → frentes hiperbólicos
    //
    // Implementamos con un factor aniso que controla el ratio
    function laplaceAniso(F, x, y, z) {
        const i  = idx(x, y, z);
        const dx = F[idx(x+1,y,z)] + F[idx(x-1,y,z)] - 2*F[i];
        const dy = F[idx(x,y+1,z)] + F[idx(x,y-1,z)] - 2*F[i];
        const dz = F[idx(x,y,z+1)] + F[idx(x,y,z-1)] - 2*F[i];

        // ε∥ = 1.0 en plano XZ, ε⊥ = −ANISO en eje Y
        // El signo negativo en Y crea la hipérbola
        return dx - P.ANISO * dy + dz;
    }

    // ── STEP ─────────────────────────────────────────────────
    function step() {
        const dt      = P.DT;
        const gamma   = P.ACOPLAMIENTO;  // E → Q
        const beta    = P.ACOPLAMIENTO;  // Q → E
        const omega2  = P.FREQ * P.FREQ; // ω_TO²
        const damp    = P.AMORT;
        const cEff    = P.C_EFF;
        const t       = Date.now() * 0.001;

        // ── Inyectar fuentes continuas ────────────────────────
        for (const src of sources) {
            const i = idx(src.x, src.y, src.z);
            E[i] += Math.sin(t * src.freq * 6.28318 + src.phase) * src.strength * dt;
        }

        // ── Integrar campos ───────────────────────────────────
        for (let x = 1; x < N-1; x++)
        for (let y = 1; y < N-1; y++)
        for (let z = 1; z < N-1; z++) {
            const i = idx(x, y, z);

            // Laplaciano anisótropo del campo EM
            const lap = laplaceAniso(E, x, y, z);

            // ∂²E/∂t² = c²·L(E) − γ·Q − amort·∂E/∂t
            // Usamos integración Verlet: dE es ∂E/∂t
            const d2E = cEff * cEff * lap - gamma * Q[i] - damp * dE[i];
            dE[i] = Math.max(-2.0, Math.min(2.0, dE[i] + d2E * dt));
            E2[i]  = E[i] + dE[i] * dt;

            // ∂²Q/∂t² = −ω_TO²·Q + β·E − amort·∂Q/∂t
            const d2Q = -omega2 * Q[i] + beta * E[i] - damp * dQ[i];
            dQ[i] = Math.max(-2.0, Math.min(2.0, dQ[i] + d2Q * dt));
            Q2[i]  = Q[i] + dQ[i] * dt;
        }

        E.set(E2);
        Q.set(Q2);

        // Normalización periódica — evita acumulación de energía
        if (frame % 30 === 0) {
            let maxE = 0.001;
            for (let i = 0; i < T; i++) if (Math.abs(E[i]) > maxE) maxE = Math.abs(E[i]);
            if (maxE > 2.0) {
                const s = 2.0 / maxE;
                for (let i = 0; i < T; i++) { E[i] *= s; Q[i] *= s; dE[i] *= s; dQ[i] *= s; }
            }
        }
        frame++;
    }

    // ── REFRESH ───────────────────────────────────────────────
    // renderVolume: amplitud total |E| + |Q|
    // phaseData:    mezcla fotón/fonón
    //   0.0 = puramente fonónico (Q domina)
    //   0.5 = polaritón puro (E ≈ Q)
    //   1.0 = puramente fotónico (E domina)
    function refresh() {
        let maxAmp = 0.001;

        for (let i = 0; i < T; i++) {
            const amp = Math.abs(E[i]) + Math.abs(Q[i]);
            if (amp > maxAmp) maxAmp = amp;
        }

        for (let i = 0; i < T; i++) {
            const absE = Math.abs(E[i]);
            const absQ = Math.abs(Q[i]);
            const amp  = absE + absQ;

            // Volumen: amplitud total normalizada
            renderVolume[i] = Math.min(1.0, amp / maxAmp);

            // Phase: ratio fotónico vs fonónico
            // 0 = todo fonónico, 0.5 = híbrido, 1 = todo fotónico
            if (amp < 0.001) {
                phaseData[i] = 0.5; // silencio → polaritón neutro
            } else {
                phaseData[i] = absE / (absE + absQ);
            }
        }

        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ── SEMILLAS ──────────────────────────────────────────────
    function clearAll() {
        E.fill(0); Q.fill(0);
        dE.fill(0); dQ.fill(0);
        E2.fill(0); Q2.fill(0);
        sources = [];
    }

    // Fuente continua en posición dada
    function addSource(x, y, z, freq, strength, phase) {
        sources.push({
            x: Math.round(x), y: Math.round(y), z: Math.round(z),
            freq: freq || P.FREQ,
            strength: strength || 1.0,
            phase: phase || 0.0,
        });
    }

    function seedHBN() {
        // hBN real: fuente central, anisotropía máxima
        clearAll();
        P.ANISO        = 2.8;
        P.ACOPLAMIENTO = 0.4;
        P.FREQ         = 0.35;
        P.C_EFF        = 0.5;
        const c = N >> 1;
        addSource(c, c, c, P.FREQ, 1.2, 0.0);
    }

    function seedIsotropico() {
        // Sin anisotropía — ondas esféricas normales para comparar
        clearAll();
        P.ANISO        = 0.0;  // ε⊥ = ε∥ → isótropo
        P.ACOPLAMIENTO = 0.3;
        P.FREQ         = 0.4;
        P.C_EFF        = 0.6;
        const c = N >> 1;
        addSource(c, c, c, P.FREQ, 1.2, 0.0);
    }

    function seedPulso() {
        // Pulso único — excitación impulsiva, no continua
        clearAll();
        P.ANISO        = 2.8;
        P.ACOPLAMIENTO = 0.5;
        P.C_EFF        = 0.5;
        // Excitación gaussiana inicial en el centro
        const c  = N >> 1;
        const r0 = Math.max(1, N >> 4);
        for (let dx = -r0; dx <= r0; dx++)
        for (let dy = -r0; dy <= r0; dy++)
        for (let dz = -r0; dz <= r0; dz++) {
            const r2 = dx*dx + dy*dy + dz*dz;
            if (r2 > r0*r0) continue;
            const amp = Math.exp(-r2 / (r0 * r0 * 0.5));
            E[idx(c+dx, c+dy, c+dz)] = amp;
            Q[idx(c+dx, c+dy, c+dz)] = amp * 0.5;
        }
        // Sin fuente continua — solo el pulso inicial
    }

    function seedDosFuentes() {
        // Dos fuentes desfasadas — interferencia de polaritones
        clearAll();
        P.ANISO        = 2.5;
        P.ACOPLAMIENTO = 0.4;
        P.FREQ         = 0.35;
        P.C_EFF        = 0.5;
        const c  = N >> 1;
        const sep = Math.max(2, N >> 3);
        addSource(c - sep, c, c, P.FREQ, 1.0, 0.0);          // fuente A
        addSource(c + sep, c, c, P.FREQ, 1.0, Math.PI);       // fuente B — antifase
    }

    const seedFns = {
        hbn:        seedHBN,
        isotropico: seedIsotropico,
        pulso:      seedPulso,
        dosfuentes: seedDosFuentes,
    };

    function initSeed(name) {
        const fn = seedFns[name] || seedHBN;
        fn();
        refresh();
    }

    initSeed('hbn');

    // ── MÉTRICAS ──────────────────────────────────────────────
    function getMetrics() {
        let totalE = 0, totalQ = 0, maxAmp = 0;
        let hybridCount = 0; // voxels con mezcla E≈Q

        for (let i = 0; i < T; i++) {
            const absE = Math.abs(E[i]);
            const absQ = Math.abs(Q[i]);
            totalE += absE;
            totalQ += absQ;
            const amp = absE + absQ;
            if (amp > maxAmp) maxAmp = amp;
            // Cuenta como polaritón si ambos campos son comparables
            if (absE > 0.01 && absQ > 0.01 && Math.abs(absE - absQ) < absE * 0.5) {
                hybridCount++;
            }
        }

        const E_total   = totalE / T;
        const E_kin     = totalQ / T;
        const E_torsion = maxAmp;
        const E_phase   = hybridCount / T;

        return {
            E_total,
            E_kin,
            E_torsion,
            E_phase,
            helicity:  maxAmp,
            boundary:  E_total / (E_total + E_kin + 0.0001),
            pump:      maxAmp > 0.5 ? 1 : 0,
            u_max:     maxAmp,
            th_max:    E_torsion,
            phi_max:   E_phase,
            psiMax:    maxAmp,
            coherence: E_phase,
            vortices:  hybridCount,
        };
    }

    // ── INYECCIONES ───────────────────────────────────────────
    function injectTouch(pos) {
        if (!pos) return;
        const tx = Math.round((pos.x * 0.5 + 0.5) * (N - 1));
        const ty = Math.round((pos.y * 0.5 + 0.5) * (N - 1));
        const tz = Math.round((pos.z * 0.5 + 0.5) * (N - 1));
        // Nueva fuente en el punto tocado
        addSource(tx, ty, tz, P.FREQ, 0.8, Math.random() * 6.28);
    }

    function injectPulso() {
        // Pulso impulsivo en el centro
        const c  = N >> 1;
        const r0 = Math.max(1, N >> 4);
        for (let dx = -r0; dx <= r0; dx++)
        for (let dy = -r0; dy <= r0; dy++)
        for (let dz = -r0; dz <= r0; dz++) {
            const r2 = dx*dx + dy*dy + dz*dz;
            if (r2 > r0*r0) continue;
            const amp = 1.5 * Math.exp(-r2 / (r0*r0*0.5));
            E[idx(c+dx,c+dy,c+dz)] += amp;
            Q[idx(c+dx,c+dy,c+dz)] += amp * 0.5;
        }
    }

    function injectCalma() {
        // Disipar campos y eliminar fuentes extra
        for (let i = 0; i < T; i++) {
            E[i]  *= 0.05;
            Q[i]  *= 0.05;
            dE[i] *= 0.05;
            dQ[i] *= 0.05;
        }
        // Conservar solo la primera fuente (la original de la semilla)
        if (sources.length > 1) sources = [sources[0]];
    }

    // ── CLASSIFYSTATE ─────────────────────────────────────────
    function classifyState(m) {
        if (m.E_phase  > 0.3)  return 'active';   // muchos polaritones híbridos
        if (m.E_total  > 0.05) return 'pumping';  // campo EM establecido
        if (m.E_kin    > 0.02) return 'stable';   // fonones activos
        if (m.u_max    > 0.01) return 'nucleating';
        return 'vacuum';
    }

    // ── API ───────────────────────────────────────────────────
    return {
        step,
        refresh,
        getMetrics,
        classifyState,
        savePrev() {},
        applyParams(p) {
            Object.assign(P, p);
            // Si cambia FREQ, actualizar todas las fuentes existentes
            if (p.FREQ !== undefined) {
                for (const src of sources) src.freq = p.FREQ;
            }
        },
        getParams() { return { ...P }; },
        seed: initSeed,
        inject(name, data) {
            if      (name === 'touch')      injectTouch(data);
            else if (name === 'pulso')      injectPulso();
            else if (name === 'calma')      injectCalma();
            else if (name === 'hbn')        seedHBN();
            else if (name === 'isotropico') seedIsotropico();
            else if (name === 'dosfuentes') seedDosFuentes();
        },
        getState() {
            return {
                E:  new Float32Array(E),
                Q:  new Float32Array(Q),
                dE: new Float32Array(dE),
                dQ: new Float32Array(dQ),
            };
        },
        setState(s) {
            if (s.E)  E.set(s.E);
            if (s.Q)  Q.set(s.Q);
            if (s.dE) dE.set(s.dE);
            if (s.dQ) dQ.set(s.dQ);
            refresh();
        },
    };
}
