// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor PALIMPSESTO
//  Campo con Estratigrafía Temporal
//
//  Cada punto del espacio carga una pila de estados pasados.
//  El presente evoluciona influenciado por todos sus fantasmas.
//  Las estructuras que persisten se graban en el sustrato.
//  Los grabados atraen al campo de vuelta hacia ellos.
//
//  La memoria no es un parámetro — es física emergente.
//
//  Campos:
//    ψ(x,t)   — estado presente (complejo)
//    M(x)     — memoria acumulada (suma ponderada del pasado)
//    A(x)     — antigüedad — cuánto tiempo lleva algo grabado
//    E(x)     — eco — la diferencia entre presente y memoria
//
//  Dinámica:
//    ψ evoluciona como onda + atracción hacia M
//    M se actualiza con ψ actual (escritura lenta)
//    A crece donde ψ ≈ M (refuerzo de lo persistente)
//    E = |ψ - M| — el olvido activo, la novedad
//
//  Lo nuevo lucha contra lo grabado.
//  Lo persistente se vuelve gravitacional.
//  El olvido es la única libertad.
//
//  Ámbar — Viernes Mayo 2026 😈
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        // Dinámica de ψ
        C_SPEED:      0.35,   // velocidad de propagación
        NONLIN:       0.6,    // autointeracción |ψ|²ψ
        DAMP:         0.9994, // amortiguamiento base
        DT:           0.012,

        // Escritura de memoria
        WRITE_RATE:   0.015,  // qué tan rápido se escribe M ← ψ
        WRITE_THRESH: 0.1,    // amplitud mínima para escribir en M

        // Atracción gravitacional hacia la memoria
        GRAVITY:      0.4,    // fuerza con que M atrae a ψ
        GRAVITY_REACH:1.5,    // radio de influencia de M (en unidades de celda)

        // Antigüedad
        AGE_RATE:     0.005,  // qué tan rápido crece A donde ψ ≈ M
        AGE_DECAY:    0.002,  // qué tan rápido decae A donde ψ ≠ M

        // Olvido activo
        FORGET:       0.003,  // tasa de borrado de M (entropía espontánea)
        FORGET_BOOST: 2.0,    // multiplicador de olvido en zonas de alto eco E

        // Novedad
        NOVELTY:      0.3,    // cuánto repele ψ alejarse de M (exploración)

        THRESH:       0.06,
    };

    // ── Campos principales ───────────────────────────────────
    const psi_r = new Float64Array(T);   // ψ real
    const psi_i = new Float64Array(T);   // ψ imaginaria
    const psi_r_v = new Float64Array(T); // velocidad
    const psi_i_v = new Float64Array(T);

    const M_r = new Float64Array(T);     // memoria real
    const M_i = new Float64Array(T);     // memoria imaginaria
    const A = new Float64Array(T);       // antigüedad [0,1]
    const E = new Float64Array(T);       // eco (diferencia presente-memoria)

    // Temporales
    const lap_r = new Float64Array(T);
    const lap_i = new Float64Array(T);
    const lap_M_r = new Float64Array(T);
    const lap_M_i = new Float64Array(T);

    // Referencia para overlap
    const seed_r = new Float64Array(T);

    function idx(x, y, z) {
        return ((x + N) % N) * N * N + ((y + N) % N) * N + ((z + N) % N);
    }

    function lap_scalar(F, out) {
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

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;

        lap_scalar(psi_r, lap_r);
        lap_scalar(psi_i, lap_i);
        lap_scalar(M_r, lap_M_r);
        lap_scalar(M_i, lap_M_i);

        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);

            const pr = psi_r[i], pi = psi_i[i];
            const mr = M_r[i],   mi = M_i[i];
            const age = A[i];
            const amp2 = pr*pr + pi*pi;

            // ── ECO: diferencia entre presente y memoria ──────
            const er = pr - mr, ei = pi - mi;
            const echo = Math.sqrt(er*er + ei*ei);
            E[i] = echo;

            // ── 1. GRAVEDAD MNÉMICA ───────────────────────────
            // La memoria atrae al presente
            // La fuerza es proporcional a la antigüedad (lo grabado
            // profundamente atrae más fuerte — como un surco)
            const gravity_strength = P.GRAVITY * (1 + age * 3.0);
            const grav_r = (mr - pr) * gravity_strength;
            const grav_i = (mi - pi) * gravity_strength;

            // ── 2. NOVEDAD: repulsión si me alejo demasiado ───
            // El eco alto genera una fuerza de retorno
            // (el campo "sabe" que se está alejando de su historia)
            const novelty_force = P.NOVELTY * echo * echo;
            const nov_r = -er * novelty_force * 0.5;
            const nov_i = -ei * novelty_force * 0.5;

            // ── 3. ONDA BASE + AUTOINTERACCIÓN ────────────────
            const wave_r = P.C_SPEED * P.C_SPEED * lap_r[i] - P.NONLIN * amp2 * pr;
            const wave_i = P.C_SPEED * P.C_SPEED * lap_i[i] - P.NONLIN * amp2 * pi;

            // ── 4. INFLUENCIA DE LA MEMORIA ESPACIAL ──────────
            // El Laplaciano de M representa cómo fluye la memoria
            // en el espacio — las memorias "se difunden" y atraen
            const mem_field_r = P.GRAVITY * 0.3 * lap_M_r[i] * (1 + age);
            const mem_field_i = P.GRAVITY * 0.3 * lap_M_i[i] * (1 + age);

            // ── Integración ───────────────────────────────────
            const total_r = wave_r + grav_r + nov_r + mem_field_r;
            const total_i = wave_i + grav_i + nov_i + mem_field_i;

            psi_r_v[i] += total_r * dt;
            psi_i_v[i] += total_i * dt;

            // Damping modulado por antigüedad
            // Lo que persiste en zonas de alta antigüedad → menos damping
            const local_damp = P.DAMP + (1 - P.DAMP) * age * 0.5;
            psi_r_v[i] *= local_damp;
            psi_i_v[i] *= local_damp;

            psi_r[i] += psi_r_v[i] * dt;
            psi_i[i] += psi_i_v[i] * dt;
        }

        // ── ACTUALIZACIÓN DE MEMORIA (escritura lenta) ────────
        for (let i = 0; i < T; i++) {
            const pr = psi_r[i], pi = psi_i[i];
            const amp = Math.sqrt(pr*pr + pi*pi);
            const mr = M_r[i], mi = M_i[i];

            // Solo escribe en memoria si la amplitud supera el umbral
            // (los susurros no dejan huella)
            if (amp > P.WRITE_THRESH) {
                M_r[i] += P.WRITE_RATE * (pr - mr);
                M_i[i] += P.WRITE_RATE * (pi - mi);
            }

            // Olvido espontáneo — la memoria decae siempre
            // Más fuerte donde el eco es alto (lo que cambió se olvida más rápido)
            const echo = E[i];
            const forget_rate = P.FORGET * (1 + P.FORGET_BOOST * echo);
            M_r[i] *= (1 - forget_rate);
            M_i[i] *= (1 - forget_rate);

            // ── ANTIGÜEDAD ────────────────────────────────────
            // Crece donde el presente ≈ memoria (persistencia)
            // Decae donde el presente ≠ memoria (cambio)
            const er = pr - M_r[i], ei = pi - M_i[i];
            const new_echo = Math.sqrt(er*er + ei*ei);
            if (new_echo < 0.1 && amp > P.WRITE_THRESH) {
                A[i] = Math.min(1.0, A[i] + P.AGE_RATE);
            } else {
                A[i] = Math.max(0.0, A[i] - P.AGE_DECAY * (1 + new_echo));
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    // ══════════════════════════════════════════════════════════
    function refresh() {
        let max_amp = 1e-10, max_age = 1e-10;
        for (let i = 0; i < T; i++) {
            const a = Math.sqrt(psi_r[i]*psi_r[i] + psi_i[i]*psi_i[i]);
            if (a > max_amp) max_amp = a;
            if (A[i] > max_age) max_age = A[i];
        }

        for (let i = 0; i < T; i++) {
            const pr = psi_r[i], pi = psi_i[i];
            const amp = Math.sqrt(pr*pr + pi*pi);
            const age = A[i];
            const echo = E[i];

            // Volumen: amplitud + antigüedad brillan diferente
            // Los surcos antiguos son visibles aunque el campo sea débil
            const mem_amp = Math.sqrt(M_r[i]*M_r[i] + M_i[i]*M_i[i]);
            renderVolume[i] = amp * 0.6 + mem_amp * age * 0.6 + echo * 0.2;

            // Fase: mezcla de la fase actual y la memoria
            // Las zonas de alta antigüedad muestran la fase "grabada"
            const phase_now = Math.atan2(pi, pr);
            const phase_mem = Math.atan2(M_i[i], M_r[i]);
            const blend = age; // 0=presente, 1=memoria
            const phase_blend = phase_now * (1-blend) + phase_mem * blend;
            phaseData[i] = phase_blend / (2 * Math.PI) + 0.5;
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
        M_r.fill(0); M_i.fill(0);
        A.fill(0); E.fill(0);
    }

    function seedVirgen() {
        // Sin memoria — campo nuevo en sustrato vacío
        clearFields();
        const c = N >> 1;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x,y,z);
            const dx=x-c, dy=y-c, dz=z-c;
            const r2 = dx*dx+dy*dy+dz*dz;
            const s = N/5.0;
            psi_r[i] = Math.exp(-r2/(2*s*s));
            psi_i[i] = 0;
        }
        seed_r.set(psi_r);
    }

    function seedCicatriz() {
        // Memoria fuerte pre-grabada, campo débil
        // El presente es atraído por el pasado que nunca vivió
        clearFields();
        const c = N >> 1;
        // Grabar una estructura toroidal en la memoria
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x,y,z);
            const fx=(x-c)/(c-1), fy=(y-c)/(c-1), fz=(z-c)/(c-1);
            const rxy = Math.sqrt(fx*fx+fy*fy);
            const rt = Math.sqrt((rxy-0.5)*(rxy-0.5)+fz*fz);
            const mem = Math.exp(-(rt/0.15)*(rt/0.15));
            const angle = Math.atan2(fy, fx);
            M_r[i] = mem * Math.cos(angle);
            M_i[i] = mem * Math.sin(angle);
            A[i] = mem * 0.9; // alta antigüedad — cicatriz vieja
            // Campo inicial casi nulo
            psi_r[i] = (Math.random()-0.5)*0.02;
            psi_i[i] = (Math.random()-0.5)*0.02;
        }
        seed_r.set(psi_r);
    }

    function seedTrauma() {
        // Campo fuerte en contradicción con memoria fuerte
        // El presente lucha contra su propio pasado
        clearFields();
        const c = N >> 1, s = N/5.0;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x,y,z);
            const dx=x-c, dy=y-c, dz=z-c;
            const r2 = dx*dx+dy*dy+dz*dz;
            const amp = Math.exp(-r2/(2*s*s));
            // Memoria apunta en una dirección
            M_r[i] = amp * 0.8;
            M_i[i] = 0;
            A[i] = amp * 0.7;
            // Presente apunta en la dirección opuesta (trauma = contradicción)
            psi_r[i] = -amp * 0.9;
            psi_i[i] = amp * 0.3 * (Math.random()-0.5);
        }
        seed_r.set(psi_r);
    }

    function seedAmnesia() {
        // Campo activo, memoria borrada
        // ¿Puede reconstruir estructuras desde cero?
        clearFields();
        for (let i = 0; i < T; i++) {
            const amp = Math.random() * 0.4;
            const phase = Math.random() * 2 * Math.PI;
            psi_r[i] = amp * Math.cos(phase);
            psi_i[i] = amp * Math.sin(phase);
        }
        seed_r.set(psi_r);
    }

    function seedEcos() {
        // Tres capas de memoria superpuestas con diferentes antigüedades
        // Como estratos geológicos — el pasado más remoto está más grabado
        clearFields();
        const c = N >> 1;

        // Estrato 1: memoria muy antigua (A≈0.9) — esfera central
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x,y,z);
            const dx=x-c, dy=y-c, dz=z-c;
            const r = Math.sqrt(dx*dx+dy*dy+dz*dz)/(N*0.15);
            if (r < 1) {
                M_r[i] += Math.exp(-r*r) * 0.8;
                A[i] = Math.max(A[i], Math.exp(-r*r) * 0.9);
            }
        }
        // Estrato 2: memoria media (A≈0.5) — anillo
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x,y,z);
            const fx=(x-c)/(c-1), fy=(y-c)/(c-1), fz=(z-c)/(c-1);
            const rxy = Math.sqrt(fx*fx+fy*fy);
            const rt = Math.sqrt((rxy-0.45)*(rxy-0.45)+fz*fz);
            if (rt < 0.2) {
                const angle = Math.atan2(fy, fx);
                M_r[i] += Math.cos(angle) * (1-rt/0.2) * 0.6;
                M_i[i] += Math.sin(angle) * (1-rt/0.2) * 0.6;
                A[i] = Math.max(A[i], (1-rt/0.2) * 0.5);
            }
        }
        // Estrato 3: memoria reciente (A≈0.2) — ruido difuso
        for (let i = 0; i < T; i++) {
            M_r[i] += (Math.random()-0.5) * 0.1;
            A[i] = Math.max(0, Math.min(1, A[i] + (Math.random()-0.5)*0.05));
        }
        // Campo inicial: ruido débil
        for (let i = 0; i < T; i++) {
            psi_r[i] = (Math.random()-0.5) * 0.05;
            psi_i[i] = (Math.random()-0.5) * 0.05;
        }
        seed_r.set(psi_r);
    }

    function initSeed(name) {
        if (name === 'virgen')        seedVirgen();
        else if (name === 'cicatriz') seedCicatriz();
        else if (name === 'trauma')   seedTrauma();
        else if (name === 'amnesia')  seedAmnesia();
        else if (name === 'ecos')     seedEcos();
        else                          seedVirgen();
        refresh();
    }

    initSeed('virgen');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let amp_total=0, amp_max=0, mem_total=0;
        let age_total=0, echo_total=0, echo_max=0;
        let deep_memory=0; // celdas con A > 0.5
        let ov_num=0, ov_na=0, ov_nb=0;

        for (let i = 0; i < T; i++) {
            const pr=psi_r[i], pi=psi_i[i];
            const amp = Math.sqrt(pr*pr+pi*pi);
            const mem = Math.sqrt(M_r[i]*M_r[i]+M_i[i]*M_i[i]);
            amp_total += amp;
            if (amp > amp_max) amp_max = amp;
            mem_total += mem;
            age_total += A[i];
            echo_total += E[i];
            if (E[i] > echo_max) echo_max = E[i];
            if (A[i] > 0.5) deep_memory++;
            ov_num += pr * seed_r[i];
            ov_na += pr*pr+pi*pi;
            ov_nb += seed_r[i]*seed_r[i];
        }

        const overlap = Math.abs(ov_num/(Math.sqrt(ov_na*ov_nb)+1e-12));

        return {
            E_total:   amp_total/T,
            E_kin:     mem_total/T,
            E_torsion: age_total/T,
            E_phase:   echo_total/T,
            helicity:  echo_max,   // → s-helic en HUD
            boundary:  deep_memory/T,
            pump:      echo_total/T,
            u_max:     amp_max,
            th_max:    age_total/T,
            phi_max:   amp_max,
            psiMax:    amp_max,
            coherence: overlap,
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function injectOlvido() {
        // Borrar memoria en zona central — amnesia localizada
        const c=N>>1, r=N>>3;
        for (let x=c-r;x<=c+r;x++)
        for (let y=c-r;y<=c+r;y++)
        for (let z=c-r;z<=c+r;z++) {
            const i=idx(x,y,z);
            M_r[i]*=0.05; M_i[i]*=0.05; A[i]*=0.05;
        }
    }

    function injectImpacto() {
        // Pulso fuerte en el centro — nuevo evento que lucha contra la memoria
        const c=N>>1, r=N>>4;
        const phase = Math.random()*2*Math.PI;
        for (let x=c-r;x<=c+r;x++)
        for (let y=c-r;y<=c+r;y++)
        for (let z=c-r;z<=c+r;z++) {
            const i=idx(x,y,z);
            psi_r[i] += Math.cos(phase)*1.5;
            psi_i[i] += Math.sin(phase)*1.5;
            psi_r_v[i] = 0; psi_i_v[i] = 0;
        }
    }

    function injectConsolidar() {
        // Copiar el estado actual a la memoria con alta antigüedad
        // "Consolidar" lo que está pasando ahora como recuerdo fuerte
        for (let i=0;i<T;i++) {
            M_r[i] = psi_r[i]*0.8 + M_r[i]*0.2;
            M_i[i] = psi_i[i]*0.8 + M_i[i]*0.2;
            const amp = Math.sqrt(psi_r[i]*psi_r[i]+psi_i[i]*psi_i[i]);
            if (amp > P.WRITE_THRESH) {
                A[i] = Math.min(1.0, A[i] + 0.3);
            }
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
                M_r:   new Float32Array(M_r),
                M_i:   new Float32Array(M_i),
                A:     new Float32Array(A),
            };
        },
        loadState(s) {
            if (s.psi_r) { psi_r.set(s.psi_r); seed_r.set(s.psi_r); }
            if (s.psi_i) psi_i.set(s.psi_i);
            if (s.M_r)   M_r.set(s.M_r);
            if (s.M_i)   M_i.set(s.M_i);
            if (s.A)     A.set(s.A);
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() {},
        applyParams(p) { Object.assign(P, p); },
        getParams() { return { ...P }; },
        initSeed, seed: initSeed,
        inject(name) {
            if (name === 'olvido')        injectOlvido();
            else if (name === 'impacto')  injectImpacto();
            else if (name === 'consolidar') injectConsolidar();
            refresh();
        },
        classifyState(m) {
            if (m.u_max > 15)           return 'collapse';
            if (m.boundary > 0.4)       return 'locked';      // memoria profunda extensa
            if (m.E_phase > 0.5)        return 'active';      // alto eco — mucho cambio
            if (m.coherence > 0.7)      return 'stable';
            if (m.E_torsion > 0.3)      return 'pumping';     // alta antigüedad promedio
            if (m.E_total < 0.02)       return 'vacuum';
            return 'nucleating';
        },
    };
}
