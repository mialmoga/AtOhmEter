// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor ESPEJO
//  Un campo que se observa a sí mismo
//
//  Dos campos acoplados:
//    ψ — campo físico oscilante (complejo: ψ_r + iψ_i)
//    S — campo epistémico: entropía local de ψ
//
//  Dinámica:
//    ψ evoluciona como una onda modulada por S
//    S se calcula desde la distribución local de |ψ|
//    Donde S es alto (caos) → ψ se amortigua → orden emerge
//    Donde S es bajo (orden) → ψ oscila libre → se propaga
//
//  El sistema busca activamente estados de mínima entropía.
//  Las estructuras estables son atractores epistémicos.
//  No hay partículas — hay regiones donde el campo
//  aprendió a reconocerse a sí mismo.
//
//  Ámbar — Mayo 2026
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    // ── Parámetros ───────────────────────────────────────────
    let P = {
        // Campo físico ψ
        C_SPEED:     0.4,    // velocidad de propagación base
        NONLIN:      0.8,    // autointeracción |ψ|²ψ (tipo Gross-Pitaevskii)
        // Campo epistémico S
        S_RADIUS:    2,      // radio de vecindario para calcular S (en celdas)
        S_GAIN:      1.2,    // cuánto S amortigua ψ (alto = más autoorganización)
        S_INERTIA:   0.85,   // S cambia lentamente (memoria)
        // Acoplamiento ψ→S→ψ
        CURIOSITY:   0.3,    // ψ tiende hacia regiones de S alto (exploración)
        ORDER_BIAS:  0.5,    // atracción hacia mínimos de S (explotación)
        // Dinámica
        DT:          0.015,
        DAMP:        0.9992,
        THRESH:      0.1,
    };

    // ── Campos ───────────────────────────────────────────────
    const psi_r = new Float64Array(T);  // parte real de ψ
    const psi_i = new Float64Array(T);  // parte imaginaria de ψ
    const psi_r_v = new Float64Array(T); // velocidad (segundo orden)
    const psi_i_v = new Float64Array(T);

    const S = new Float64Array(T);       // entropía local
    const S_prev = new Float64Array(T);  // S anterior (inercia)

    // Referencia para overlap
    const psi_r_seed = new Float64Array(T);

    // Temporales
    const lap_r = new Float64Array(T);
    const lap_i = new Float64Array(T);
    const lap_S = new Float64Array(T);
    const grad_S_x = new Float64Array(T);
    const grad_S_y = new Float64Array(T);
    const grad_S_z = new Float64Array(T);

    // ── Índice ───────────────────────────────────────────────
    function idx(x, y, z) {
        return ((x + N) % N) * N * N + ((y + N) % N) * N + ((z + N) % N);
    }

    function lap_scalar(F, out) {
        const inv = 1.0;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            out[i] = F[idx(x+1,y,z)] + F[idx(x-1,y,z)]
                   + F[idx(x,y+1,z)] + F[idx(x,y-1,z)]
                   + F[idx(x,y,z+1)] + F[idx(x,y,z-1)]
                   - 6 * F[i];
        }
    }

    function grad_scalar(F, gx, gy, gz) {
        const inv2 = 0.5;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            gx[i] = (F[idx(x+1,y,z)] - F[idx(x-1,y,z)]) * inv2;
            gy[i] = (F[idx(x,y+1,z)] - F[idx(x,y-1,z)]) * inv2;
            gz[i] = (F[idx(x,y,z+1)] - F[idx(x,y,z-1)]) * inv2;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  ENTROPÍA LOCAL — el corazón del motor
    //
    //  Para cada punto, miramos el vecindario (radio r).
    //  Binificamos |ψ| en 8 cubos y calculamos H de Shannon.
    //  S alto = vecindario caótico, S bajo = vecindario ordenado.
    // ══════════════════════════════════════════════════════════
    function computeEntropy() {
        const r = Math.max(1, Math.floor(P.S_RADIUS));
        const bins = 8;

        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);

            // Recolectar |ψ| en el vecindario
            let max_amp = 1e-10;
            let count = 0;
            const hist = new Float64Array(bins);

            for (let dx = -r; dx <= r; dx++)
            for (let dy = -r; dy <= r; dy++)
            for (let dz = -r; dz <= r; dz++) {
                const j = idx(x+dx, y+dy, z+dz);
                const amp = Math.sqrt(psi_r[j]*psi_r[j] + psi_i[j]*psi_i[j]);
                if (amp > max_amp) max_amp = amp;
                count++;
            }

            // Segunda pasada: histograma normalizado
            for (let dx = -r; dx <= r; dx++)
            for (let dy = -r; dy <= r; dy++)
            for (let dz = -r; dz <= r; dz++) {
                const j = idx(x+dx, y+dy, z+dz);
                const amp = Math.sqrt(psi_r[j]*psi_r[j] + psi_i[j]*psi_i[j]);
                const bin = Math.min(bins-1, Math.floor((amp / max_amp) * bins));
                hist[bin]++;
            }

            // Entropía de Shannon
            let H = 0;
            for (let b = 0; b < bins; b++) {
                if (hist[b] > 0) {
                    const p = hist[b] / count;
                    H -= p * Math.log2(p);
                }
            }

            // Normalizar a [0,1] — máxima entropía = log2(bins) = 3
            const H_norm = H / Math.log2(bins);

            // Inercia — S no salta bruscamente
            S[i] = P.S_INERTIA * S_prev[i] + (1 - P.S_INERTIA) * H_norm;
        }

        S_prev.set(S);
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;
        const dt2 = dt * dt;

        // 1. Entropía local desde el estado actual de ψ
        computeEntropy();

        // 2. Gradiente de S — ψ lo usa para navegar
        grad_scalar(S, grad_S_x, grad_S_y, grad_S_z);
        lap_scalar(psi_r, lap_r);
        lap_scalar(psi_i, lap_i);
        lap_scalar(S, lap_S);

        // 3. Evolución de ψ
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);

            const pr = psi_r[i], pi = psi_i[i];
            const amp2 = pr*pr + pi*pi;
            const si = S[i];

            // ── Onda base: ∂²ψ/∂t² = c²∇²ψ ──────────────────
            let force_r = P.C_SPEED * P.C_SPEED * lap_r[i];
            let force_i = P.C_SPEED * P.C_SPEED * lap_i[i];

            // ── Autointeracción tipo GP: −λ|ψ|²ψ ─────────────
            // Empuja ψ hacia amplitud de equilibrio
            force_r -= P.NONLIN * amp2 * pr;
            force_i -= P.NONLIN * amp2 * pi;

            // ── Amortiguamiento por entropía ─────────────────
            // Donde S es alto (caos), la onda se frena
            // Donde S es bajo (orden), la onda corre libre
            // S actúa como viscosidad local adaptativa
            const entropy_damp = 1.0 - P.S_GAIN * si;
            force_r += entropy_damp * P.C_SPEED * lap_r[i] * 0.3;
            force_i += entropy_damp * P.C_SPEED * lap_i[i] * 0.3;

            // ── Curiosidad: ψ se mueve hacia ∇S ──────────────
            // El campo "explora" — fluye hacia zonas de alta entropía
            // (el gradiente de entropía actúa como un potencial de atracción)
            const gsx = grad_S_x[i], gsy = grad_S_y[i], gsz = grad_S_z[i];
            // Rotación de fase por ∇S (la curiosidad es compleja — rota la fase)
            const S_rot = P.CURIOSITY * (gsx*gsx + gsy*gsy + gsz*gsz) * 0.1;
            force_r += -S_rot * pi;  // rotación en espacio complejo
            force_i +=  S_rot * pr;

            // ── Orden: ψ se aleja de ∇S (hacia mínimos) ──────
            // El campo "explota" — busca zonas de baja entropía
            // (tensión entre curiosidad y orden)
            const lap_s_i = lap_S[i];
            force_r += P.ORDER_BIAS * lap_s_i * pr;
            force_i += P.ORDER_BIAS * lap_s_i * pi;

            // ── Integración Verlet ────────────────────────────
            psi_r_v[i] += force_r * dt;
            psi_i_v[i] += force_i * dt;
            psi_r_v[i] *= P.DAMP;
            psi_i_v[i] *= P.DAMP;
            psi_r[i] += psi_r_v[i] * dt;
            psi_i[i] += psi_i_v[i] * dt;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    // ══════════════════════════════════════════════════════════
    function refresh() {
        let max_amp = 1e-10;
        for (let i = 0; i < T; i++) {
            const a = Math.sqrt(psi_r[i]*psi_r[i] + psi_i[i]*psi_i[i]);
            if (a > max_amp) max_amp = a;
        }
        const inv_max = 1.0 / max_amp;

        for (let i = 0; i < T; i++) {
            const amp = Math.sqrt(psi_r[i]*psi_r[i] + psi_i[i]*psi_i[i]);
            // Volumen: amplitud modulada por (1 - S) — lo ordenado brilla más
            renderVolume[i] = amp * inv_max * (1.0 - S[i] * 0.7);
            // Fase: ángulo de ψ en [0,1] — colores = orientación de fase
            const angle = Math.atan2(psi_i[i], psi_r[i]);
            phaseData[i] = angle / (2 * Math.PI) + 0.5;
        }

        texture3D.needsUpdate = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function clearFields() {
        psi_r.fill(0); psi_i.fill(0);
        psi_r_v.fill(0); psi_i_v.fill(0);
        S.fill(0.5); S_prev.fill(0.5);
    }

    function seedRuido(amp) {
        clearFields();
        for (let i = 0; i < T; i++) {
            psi_r[i] = (Math.random()-0.5) * amp;
            psi_i[i] = (Math.random()-0.5) * amp;
        }
        psi_r_seed.set(psi_r);
    }

    function seedPulso() {
        // Un único pulso gaussiano en el centro — máxima coherencia inicial
        clearFields();
        const c = N >> 1;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            const dx = x-c, dy = y-c, dz = z-c;
            const r2 = dx*dx + dy*dy + dz*dz;
            const sigma = N / 6.0;
            const amp = Math.exp(-r2 / (2*sigma*sigma));
            psi_r[i] = amp;
            psi_i[i] = 0;
        }
        psi_r_seed.set(psi_r);
    }

    function seedEspiral() {
        // Vórtice — fase gira 2π alrededor del eje Z
        clearFields();
        const c = N >> 1;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            const dx = x-c, dy = y-c, dz = z-c;
            const r = Math.sqrt(dx*dx + dy*dy) + 1e-6;
            const angle = Math.atan2(dy, dx);
            const height = Math.exp(-dz*dz / (N*N*0.05));
            const radial = Math.exp(-r*r / (N*N*0.08));
            psi_r[i] = Math.cos(angle) * radial * height;
            psi_i[i] = Math.sin(angle) * radial * height;
        }
        psi_r_seed.set(psi_r);
    }

    function seedCaos() {
        // Tres vórtices desfasados — alta entropía inicial
        clearFields();
        const centers = [
            [N*0.33, N*0.5, N*0.5],
            [N*0.66, N*0.33, N*0.5],
            [N*0.5, N*0.66, N*0.5],
        ];
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            let sr = 0, si = 0;
            centers.forEach(([cx, cy, cz], k) => {
                const dx = x-cx, dy = y-cy, dz = z-cz;
                const r = Math.sqrt(dx*dx+dy*dy) + 1e-6;
                const angle = Math.atan2(dy, dx) + k * 2 * Math.PI / 3;
                const amp = Math.exp(-(dx*dx+dy*dy+dz*dz)/(N*N*0.04));
                sr += Math.cos(angle) * amp;
                si += Math.sin(angle) * amp;
            });
            psi_r[i] = sr; psi_i[i] = si;
        }
        psi_r_seed.set(psi_r);
    }

    function seedEspejos() {
        // Dos pulsos en fase opuesta — máxima tensión inicial
        clearFields();
        const offsets = [N*0.33, N*0.66];
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            const dx0 = x - offsets[0], dx1 = x - offsets[1];
            const dy = y - N/2, dz = z - N/2;
            const r2 = N*N*0.03;
            const a0 = Math.exp(-(dx0*dx0+dy*dy+dz*dz)/r2);
            const a1 = Math.exp(-(dx1*dx1+dy*dy+dz*dz)/r2);
            psi_r[i] = a0 - a1;  // fases opuestas
            psi_i[i] = (Math.random()-0.5) * 0.05;
        }
        psi_r_seed.set(psi_r);
    }

    function initSeed(name) {
        if (name === 'pulso')         seedPulso();
        else if (name === 'espiral')  seedEspiral();
        else if (name === 'caos')     seedCaos();
        else if (name === 'espejos')  seedEspejos();
        else if (name === 'ruido')    seedRuido(0.3);
        else                          seedPulso();
        // Inicializar S desde el estado inicial
        computeEntropy();
        S_prev.set(S);
        refresh();
    }

    initSeed('pulso');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let E_kin = 0, E_campo = 0, S_total = 0, S_max = 0;
        let amp_max = 0, phase_var = 0;
        let S_low_count = 0; // zonas de orden
        let overlap_num = 0, overlap_na = 0, overlap_nb = 0;

        for (let i = 0; i < T; i++) {
            const pr = psi_r[i], pi = psi_i[i];
            const amp2 = pr*pr + pi*pi;
            const amp = Math.sqrt(amp2);

            E_kin += psi_r_v[i]*psi_r_v[i] + psi_i_v[i]*psi_i_v[i];
            E_campo += amp2 + P.NONLIN * amp2 * amp2 * 0.5;
            S_total += S[i];
            if (S[i] > S_max) S_max = S[i];
            if (amp > amp_max) amp_max = amp;
            if (S[i] < 0.3) S_low_count++; // zonas ordenadas

            // Varianza de fase
            const angle = Math.atan2(pi, pr);
            phase_var += angle * angle;

            // Mode overlap
            overlap_num += pr * psi_r_seed[i];
            overlap_na += amp2;
            overlap_nb += psi_r_seed[i]*psi_r_seed[i];
        }

        const S_avg = S_total / T;
        const mode_overlap = Math.abs(overlap_num / (Math.sqrt(overlap_na * overlap_nb) + 1e-12));

        return {
            E_total:   (E_kin + E_campo) / T,
            E_kin:     E_kin / T,
            E_torsion: S_avg,        // reutilizar slot para S_avg
            E_phase:   E_campo / T,
            helicity:  phase_var / T,
            boundary:  S_low_count / T,
            pump:      S_max,
            u_max:     amp_max,
            th_max:    S_avg,
            phi_max:   amp_max,
            psiMax:    amp_max,
            coherence: mode_overlap,
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function injectPulso() {
        const c = N >> 1;
        const r = N >> 3;
        for (let x = c-r; x <= c+r; x++)
        for (let y = c-r; y <= c+r; y++)
        for (let z = c-r; z <= c+r; z++) {
            const i = idx(x, y, z);
            psi_r_v[i] += (Math.random()-0.5) * 0.5;
            psi_i_v[i] += (Math.random()-0.5) * 0.5;
        }
    }

    function injectEspejo() {
        // Reflejar ψ_i → −ψ_i (inversión de fase imaginaria)
        for (let i = 0; i < T; i++) psi_i[i] *= -1;
    }

    function injectReset() {
        // Resetear S a 0.5 — el campo "olvida" su historia epistémica
        S.fill(0.5); S_prev.fill(0.5);
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
                S:     new Float32Array(S),
            };
        },
        loadState(s) {
            if (s.psi_r) { psi_r.set(s.psi_r); psi_r_seed.set(s.psi_r); }
            if (s.psi_i) psi_i.set(s.psi_i);
            if (s.S) { S.set(s.S); S_prev.set(s.S); }
            else { computeEntropy(); S_prev.set(S); }
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() {},
        applyParams(p) { Object.assign(P, p); },
        getParams() { return { ...P }; },
        initSeed,
        seed: initSeed,
        inject(name) {
            if (name === 'pulso')  injectPulso();
            else if (name === 'espejo') injectEspejo();
            else if (name === 'olvido') injectReset();
            refresh();
        },
        classifyState(m) {
            if (m.u_max > 20) return 'collapse';
            if (m.boundary > 0.4) return 'locked';       // mucho orden
            if (m.coherence > 0.7) return 'stable';
            if (m.E_torsion < 0.2) return 'nucleating';  // S bajo = ordenando
            if (m.pump > 0.7) return 'active';            // S alto = caótico
            if (m.E_kin > 0.5) return 'pumping';
            return 'vacuum';
        },
    };
}
