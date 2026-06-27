// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor COSTUMBRE
//  El Campo que se Acostumbra
//
//  Propuesto por Velvet (GPT) — implementado por Ámbar (Claude)
//  Brujo — Mayo 2026
//
//  Hipótesis:
//  Un sistema no cambia por energía absoluta.
//  Cambia por diferencia respecto a lo que ya considera normal.
//
//  No existe energía. No existe memoria explícita.
//  No existe deseo. Existe costumbre.
//  El universo deja de reaccionar a lo persistente.
//
//  Ecuación:
//  ∂ψ/∂t = α∇²ψ + β(ψ−N) − γ|ψ−N|²(ψ−N) + δ∇N
//  Ṅ = μ(ψ−N)
//
//  Donde:
//    ψ — campo presente
//    N — normalidad local (baseline adaptativo)
//    α — difusión
//    β — sensibilidad a novedad
//    γ — saturación por sobreestimulación
//    δ — deriva hacia zonas aún sorprendentes
//    μ — velocidad de habituación
//
//  Leyes:
//    1. Habituación: lo persistente deja de sentirse
//    2. Recuperación: lo habitual que desaparece deja hueco
//    3. Ceguera: exceso continuo apaga la respuesta
//    4. Novedad periférica: las fronteras son los lugares más vivos
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        ALPHA:    0.4,    // difusión de ψ
        BETA:     1.2,    // sensibilidad a novedad (ψ−N)
        GAMMA:    0.8,    // saturación por sobreestimulación
        DELTA:    0.3,    // deriva hacia zonas sorprendentes (∇N)
        MU:       0.008,  // velocidad de habituación (Ṅ = μ(ψ−N))
        DT:       0.015,
        THRESH:   0.05,
    };

    // ── Campos ───────────────────────────────────────────────
    const psi   = new Float64Array(T);  // campo presente (real)
    const N_arr = new Float64Array(T);  // normalidad / baseline adaptativo
    const nov   = new Float64Array(T);  // novedad = |ψ − N| (para render)

    // Temporales
    const lap_psi = new Float64Array(T);
    const gNx     = new Float64Array(T);
    const gNy     = new Float64Array(T);
    const gNz     = new Float64Array(T);

    const seed_psi = new Float64Array(T);

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    function lap_scalar(F, out) {
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            out[i] = F[idx(x+1,y,z)] + F[idx(x-1,y,z)]
                   + F[idx(x,y+1,z)] + F[idx(x,y-1,z)]
                   + F[idx(x,y,z+1)] + F[idx(x,y,z-1)]
                   - 6*F[i];
        }
    }

    function grad_scalar(F, gx, gy, gz) {
        const h = 0.5;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            gx[i] = (F[idx(x+1,y,z)] - F[idx(x-1,y,z)]) * h;
            gy[i] = (F[idx(x,y+1,z)] - F[idx(x,y-1,z)]) * h;
            gz[i] = (F[idx(x,y,z+1)] - F[idx(x,y,z-1)]) * h;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;

        lap_scalar(psi, lap_psi);
        grad_scalar(N_arr, gNx, gNy, gNz);

        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            const p = psi[i];
            const n = N_arr[i];
            const diff = p - n;          // novedad local
            const diff2 = diff * diff;

            // ── ∂ψ/∂t ────────────────────────────────────────
            // α∇²ψ — difusión base
            const diffusion = P.ALPHA * lap_psi[i];

            // β(ψ−N) — amplificación de novedad
            // Lo diferente se amplifica
            const novelty_amp = P.BETA * diff;

            // −γ|ψ−N|²(ψ−N) — saturación
            // Demasiada novedad produce ceguera
            const saturation = -P.GAMMA * diff2 * diff;

            // δ∇N — deriva hacia zonas sorprendentes
            // ψ fluye hacia donde N tiene gradiente (fronteras de costumbre)
            // La magnitud de ∇N indica dónde hay fronteras activas
            const grad_mag = Math.sqrt(gNx[i]*gNx[i] + gNy[i]*gNy[i] + gNz[i]*gNz[i]);
            const drift = P.DELTA * grad_mag * Math.sign(diff + 1e-10);

            psi[i] += (diffusion + novelty_amp + saturation + drift) * dt;

            // ── Ṅ = μ(ψ−N) — habituación ─────────────────────
            // N persigue lentamente a ψ
            // Lo que persiste se vuelve normal
            N_arr[i] += P.MU * diff * dt;

            // Novedad para render
            nov[i] = Math.abs(diff);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — shader propio: azul/blanco/dorado/negro
    // ══════════════════════════════════════════════════════════
    function refresh() {
        // Calcular magnitud de ∇N (fronteras activas)
        grad_scalar(N_arr, gNx, gNy, gNz);

        let max_nov = 1e-10, max_grad = 1e-10;
        for (let i=0;i<T;i++) {
            if (nov[i] > max_nov) max_nov = nov[i];
            const gm = Math.sqrt(gNx[i]*gNx[i]+gNy[i]*gNy[i]+gNz[i]*gNz[i]);
            if (gm > max_grad) max_grad = gm;
        }

        for (let i=0;i<T;i++) {
            const p     = psi[i];
            const n     = N_arr[i];
            const diff  = p - n;
            const nov_n = nov[i] / max_nov;           // novedad normalizada
            const grad_n = Math.sqrt(
                gNx[i]*gNx[i]+gNy[i]*gNy[i]+gNz[i]*gNz[i]
            ) / (max_grad + 1e-10);                   // frontera normalizada
            const habit  = 1.0 - nov_n;               // costumbre = inverso de novedad
            const excess  = Math.min(1, nov_n*nov_n*3); // ceguera por exceso

            // renderVolume:
            // - Alta novedad (blanco) → brilla mucho
            // - Frontera activa (dorado) → brilla medio
            // - Costumbre profunda (azul) → brilla poco
            // - Ceguera por saturación (negro) → casi no brilla
            renderVolume[i] = nov_n * 0.7
                            + grad_n * 0.5
                            + Math.abs(p) * 0.2
                            - excess * 0.3;
            renderVolume[i] = Math.max(0, renderVolume[i]);

            // phaseData codifica el TIPO de actividad (no fase de ψ):
            // 0.0  = ceguera por saturación (negro en shader)
            // 0.25 = costumbre profunda (azul)
            // 0.5  = frontera activa (dorado)
            // 0.75 = novedad pura (blanco)
            // 1.0  = hueco post-habituación (violeta)
            if (excess > 0.7) {
                phaseData[i] = 0.02;           // ceguera → negro
            } else if (nov_n < 0.1) {
                phaseData[i] = 0.2;            // costumbre → azul
            } else if (grad_n > 0.5) {
                phaseData[i] = 0.5;            // frontera → dorado
            } else if (diff < -0.1) {
                phaseData[i] = 0.85;           // hueco (ψ < N) → violeta
            } else {
                phaseData[i] = 0.72;           // novedad → blanco
            }
        }

        texture3D.needsUpdate = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SHADER PROPIO — mapeo de phaseData a colores semánticos
    //  (inyectado via phaseData como índice de paleta)
    // ══════════════════════════════════════════════════════════
    // La paleta se implementa en el fragment shader:
    // ph < 0.1  → negro  (ceguera)
    // ph ~ 0.2  → azul   (costumbre)
    // ph ~ 0.5  → dorado (frontera)
    // ph ~ 0.72 → blanco (novedad)
    // ph > 0.8  → violeta (hueco)

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function clearFields() {
        psi.fill(0); N_arr.fill(0); nov.fill(0);
    }

    function seedPulso() {
        // Pulso gaussiano sobre N=0 — todo nuevo para el sistema
        clearFields();
        const c = N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            const dx=x-c, dy=y-c, dz=z-c;
            const r2 = dx*dx+dy*dy+dz*dz;
            psi[i] = Math.exp(-r2/(2*(N/5.0)**2)) * 0.8;
            N_arr[i] = 0; // sin costumbre previa
        }
        seed_psi.set(psi);
    }

    function seedHabituado() {
        // ψ ≈ N — el sistema ya se acostumbró a lo que hay
        // Perturbación mínima — ¿puede despertar?
        clearFields();
        for (let i=0;i<T;i++) {
            const val = (Math.random()-0.5)*0.6;
            psi[i]   = val;
            N_arr[i] = val + (Math.random()-0.5)*0.02; // N ≈ ψ
        }
        seed_psi.set(psi);
    }

    function seedFronteras() {
        // Dos regiones con valores distintos — frontera activa entre ellas
        clearFields();
        const c = N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            const val = x < c ? 0.6 : -0.4;
            psi[i]   = val + (Math.random()-0.5)*0.05;
            N_arr[i] = val; // ya habituado a cada región
        }
        seed_psi.set(psi);
    }

    function seedAdiccion() {
        // Campo de alta amplitud uniforme sobre N=0
        // El sistema será sobreestimulado inmediatamente
        clearFields();
        for (let i=0;i<T;i++) {
            psi[i]   = (Math.random()-0.5)*1.8; // amplitud muy alta
            N_arr[i] = 0;
        }
        seed_psi.set(psi);
    }

    function seedDespertar() {
        // N alta (muy habituado), ψ bajo (el estímulo desapareció)
        // Debería aparecer hueco negativo — "el fantasma inverso" de Velvet
        clearFields();
        for (let i=0;i<T;i++) {
            N_arr[i] = 0.5 + (Math.random()-0.5)*0.1; // normalidad alta
            psi[i]   = (Math.random()-0.5)*0.05;        // ψ casi cero
        }
        seed_psi.set(psi);
    }

    function initSeed(name) {
        if (name==='pulso')        seedPulso();
        else if (name==='habituado')  seedHabituado();
        else if (name==='fronteras')  seedFronteras();
        else if (name==='adiccion')   seedAdiccion();
        else if (name==='despertar')  seedDespertar();
        else                          seedPulso();
        refresh();
    }

    initSeed('pulso');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let nov_total=0, nov_max=0;
        let habit_deep=0;  // celdas con nov < 0.05
        let blind_count=0; // celdas con nov > 0.8 (saturación)
        let border_count=0;
        let ov_num=0, ov_na=0, ov_nb=0;

        grad_scalar(N_arr, gNx, gNy, gNz);

        for (let i=0;i<T;i++) {
            const n = nov[i];
            nov_total += n;
            if (n > nov_max) nov_max = n;
            if (n < 0.05)  habit_deep++;
            if (n > 0.8)   blind_count++;
            const gm = Math.sqrt(gNx[i]*gNx[i]+gNy[i]*gNy[i]+gNz[i]*gNz[i]);
            if (gm > 0.3)  border_count++;
            ov_num += psi[i]*seed_psi[i];
            ov_na  += psi[i]*psi[i];
            ov_nb  += seed_psi[i]*seed_psi[i];
        }

        const overlap = Math.abs(ov_num/(Math.sqrt(ov_na*ov_nb)+1e-12));

        return {
            E_total:   nov_total/T,        // novedad media
            E_kin:     nov_max,            // novedad máxima
            E_torsion: habit_deep/T,       // fracción habituada
            E_phase:   blind_count/T,      // fracción ciega
            helicity:  border_count/T,     // fracción en frontera activa
            boundary:  habit_deep/T,
            pump:      blind_count/T,
            u_max:     nov_max,
            th_max:    nov_total/T,
            phi_max:   nov_max,
            psiMax:    nov_max,
            coherence: overlap,
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function injectNovedad() {
        // Pulso nuevo en zona habituada — despertar local
        const cx=(Math.random()-0.5)*1.2;
        const cy=(Math.random()-0.5)*1.2;
        const cz=(Math.random()-0.5)*1.2;
        const c=N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const fx=(x-c)/(c-1), fy=(y-c)/(c-1), fz=(z-c)/(c-1);
            const r2=(fx-cx)**2+(fy-cy)**2+(fz-cz)**2;
            psi[i] += 0.7*Math.exp(-r2*8);
        }
    }

    function injectResetN() {
        // Resetear N a 0 — todo vuelve a ser extraordinario
        // La predicción P5 de Velvet: despertar
        N_arr.fill(0);
    }

    function injectApagar() {
        // Apagar ψ en zona central — crear el "hueco"
        // La predicción P1 de Velvet: fantasma inverso
        const c=N>>1, r=N>>3;
        for (let x=c-r;x<=c+r;x++) for (let y=c-r;y<=c+r;y++) for (let z=c-r;z<=c+r;z++) {
            psi[idx(x,y,z)] *= 0.02;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  API
    // ══════════════════════════════════════════════════════════
    return {
        step, refresh, getMetrics,
        getState() {
            return {
                psi:   new Float32Array(psi),
                N_arr: new Float32Array(N_arr),
            };
        },
        loadState(s) {
            if(s.psi)   { psi.set(s.psi); seed_psi.set(s.psi); }
            if(s.N_arr) N_arr.set(s.N_arr);
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() {},
        applyParams(p) { Object.assign(P,p); },
        getParams() { return {...P}; },
        initSeed, seed: initSeed,
        inject(name) {
            if(name==='novedad')       injectNovedad();
            else if(name==='reset_n')  injectResetN();
            else if(name==='apagar')   injectApagar();
            refresh();
        },
        classifyState(m) {
            if(m.E_phase > 0.4)        return 'locked';    // mayoría ciega
            if(m.E_torsion > 0.6)      return 'stable';    // mayoría habituada
            if(m.helicity > 0.3)       return 'active';    // muchas fronteras
            if(m.E_total > 0.3)        return 'pumping';   // alta novedad
            if(m.E_total > 0.05)       return 'nucleating';
            return 'vacuum';
        },
    };
}
