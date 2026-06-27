// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor CENIZA
//  Termodinámica Irreversible
//
//  Todo muere. Sin excepciones.
//
//  Tres campos acoplados:
//    T(x,t)  — temperatura local (energía disponible)
//    ψ(x,t)  — campo de orden (lo que intenta organizarse)
//    σ(x,t)  — entropía acumulada (SOLO SUBE. Nunca baja.)
//
//  La segunda ley es la única ley que importa aquí.
//
//  Dinámica:
//    ψ se organiza donde T es alta (hay energía para hacerlo)
//    Cada acto de organización consume T y produce σ
//    T se difunde pero se disipa — el calor se pierde
//    σ se acumula, endurece el medio, frena a ψ
//    Cuando T→0, ψ se congela en lo que sea que logró
//
//  Pregunta: ¿qué sobrevive? ¿qué forma tiene el universo
//  cuando se acaba el combustible?
//
//  La respuesta depende de la semilla.
//  El final no.
//
//  Ámbar — Viernes Mayo 2026 😈
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        // Temperatura
        T_INIT:       2.0,    // temperatura inicial
        T_DIFFUSION:  0.08,   // qué tan rápido se difunde el calor
        T_DISSIPATION:0.0008, // pérdida de calor al "exterior" (inevitable)
        T_FLOOR:      0.001,  // temperatura mínima — el cero absoluto

        // Campo ψ
        C_SPEED:      0.4,    // velocidad de onda de ψ
        ORDER_GAIN:   1.2,    // cuánto puede organizarse ψ por unidad de T
        PSI_FREEZE:   0.98,   // ψ se "congela" donde T < T_FREEZE
        T_FREEZE:     0.05,   // umbral de congelamiento

        // Entropía σ
        S_PRODUCTION: 0.4,    // cuánta σ produce cada acto de organización
        S_COUPLING:   0.6,    // cuánto σ frena a ψ (resistencia del medio endurecido)
        S_DIFFUSION:  0.01,   // σ se difunde levemente (mezcla termodinámica)

        // Inyecciones de calor
        HEAT_AMP:     0.5,    // amplitud de inyección de calor

        THRESH:       0.08,
        DT:           0.015,
    };

    // ── Campos ───────────────────────────────────────────────
    const psi_r = new Float64Array(T);
    const psi_i = new Float64Array(T);
    const psi_r_v = new Float64Array(T);
    const psi_i_v = new Float64Array(T);
    const temp = new Float64Array(T);      // T — temperatura
    const sigma = new Float64Array(T);     // σ — entropía acumulada
    const frozen = new Float64Array(T);    // qué tan congelado está ψ [0,1]

    // Temporales
    const lap_r = new Float64Array(T);
    const lap_i = new Float64Array(T);
    const lap_T = new Float64Array(T);
    const lap_S = new Float64Array(T);

    // Referencia para overlap
    const seed_r = new Float64Array(T);

    // Métricas globales
    let total_heat = 0;
    let total_sigma = 0;
    let generation = 0;

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    function lap_scalar(F, out) {
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            out[i]=F[idx(x+1,y,z)]+F[idx(x-1,y,z)]
                  +F[idx(x,y+1,z)]+F[idx(x,y-1,z)]
                  +F[idx(x,y,z+1)]+F[idx(x,y,z-1)]-6*F[i];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP — la segunda ley en acción
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;
        generation++;

        lap_scalar(psi_r, lap_r);
        lap_scalar(psi_i, lap_i);
        lap_scalar(temp, lap_T);
        lap_scalar(sigma, lap_S);

        total_heat = 0;
        total_sigma = 0;

        for (let i=0;i<T;i++) {
            const pr=psi_r[i], pi=psi_i[i];
            const amp2=pr*pr+pi*pi;
            const Ti=temp[i];
            const Si=sigma[i];

            // ── Congelamiento ─────────────────────────────────
            // Donde T es baja, ψ se inmoviliza progresivamente
            const freeze_factor = Ti < P.T_FREEZE
                ? Math.max(0, Ti/P.T_FREEZE)
                : 1.0;
            frozen[i] = 1 - freeze_factor;

            // ── Evolución de ψ ────────────────────────────────
            // La onda solo puede moverse donde hay calor
            // y donde la entropía no ha solidificado el medio
            const mobility = freeze_factor * Math.max(0, 1 - P.S_COUPLING*Si);

            // Fuerza: onda base
            const f_r = P.C_SPEED*P.C_SPEED * lap_r[i];
            const f_i = P.C_SPEED*P.C_SPEED * lap_i[i];

            // Organización: ψ intenta reducir su propio Laplaciano
            // (hacer estructuras más suaves) — CONSUME temperatura
            const order_r = P.ORDER_GAIN * Ti * lap_r[i];
            const order_i = P.ORDER_GAIN * Ti * lap_i[i];

            // Cuánta organización ocurre realmente
            const org_r = order_r * mobility;
            const org_i = order_i * mobility;

            // Energía consumida en organización → genera σ
            const org_energy = Math.abs(org_r*pr + org_i*pi) * dt;

            // Integración de ψ
            psi_r_v[i] += (f_r + org_r) * dt * mobility;
            psi_i_v[i] += (f_i + org_i) * dt * mobility;

            // Amortiguamiento — más σ = más resistencia
            const damp = 0.9998 - Si*0.003;
            psi_r_v[i] *= Math.max(0.9, damp);
            psi_i_v[i] *= Math.max(0.9, damp);

            // Congelar velocidad donde T→0
            psi_r_v[i] *= (0.98 + 0.02*freeze_factor);
            psi_i_v[i] *= (0.98 + 0.02*freeze_factor);

            psi_r[i] += psi_r_v[i] * dt;
            psi_i[i] += psi_i_v[i] * dt;

            // ── Evolución de T ────────────────────────────────
            // Difusión de calor (se equilibra)
            let dT = P.T_DIFFUSION * lap_T[i];

            // Disipación inevitable — el calor se pierde
            // (segunda ley: el calor fluye al "exterior")
            dT -= P.T_DISSIPATION * (Ti - P.T_FLOOR);

            // Cada acto de organización consume T
            dT -= org_energy * P.ORDER_GAIN;

            // El movimiento de ψ también disipa calor
            const kinetic = psi_r_v[i]*psi_r_v[i]+psi_i_v[i]*psi_i_v[i];
            dT -= kinetic * 0.1;

            temp[i] = Math.max(P.T_FLOOR, Ti + dT*dt);
            total_heat += temp[i];

            // ── Evolución de σ — SOLO SUBE ────────────────────
            // Producción: por organización y por disipación de calor
            const dSigma = P.S_PRODUCTION * org_energy
                         + P.T_DISSIPATION * Ti * 0.5  // disipación también produce σ
                         + P.S_DIFFUSION * lap_S[i];   // difusión espacial

            // σ NUNCA baja — la segunda ley es absoluta
            sigma[i] = Math.min(1.0, Si + Math.max(0, dSigma)*dt);
            total_sigma += sigma[i];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    // ══════════════════════════════════════════════════════════
    function refresh() {
        for (let i=0;i<T;i++) {
            const pr=psi_r[i], pi=psi_i[i];
            const amp=Math.sqrt(pr*pr+pi*pi);
            const Ti=temp[i];
            const Si=sigma[i];
            const fr=frozen[i];

            // Volumen: lo que brilla es ψ modulado por temperatura
            // Las zonas frías pero con ψ congelado brillan diferente
            const hot_glow  = amp * Ti * 3.0;         // caliente y activo
            const cold_glow = amp * fr * Si * 0.5;    // congelado en σ
            renderVolume[i] = hot_glow + cold_glow;

            // Fase: mezcla de fase de ψ y temperatura
            // Las zonas calientes muestran la fase viva
            // Las zonas frías muestran la "ceniza" — σ normalizado
            const phase_psi = Math.atan2(pi, pr)/(2*Math.PI) + 0.5;
            const phase_ash = Si; // σ → color de ceniza
            phaseData[i] = phase_psi*(1-fr) + phase_ash*fr;
        }
        texture3D.needsUpdate=true;
        texturePhase.needsUpdate=true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function clearFields() {
        psi_r.fill(0); psi_i.fill(0);
        psi_r_v.fill(0); psi_i_v.fill(0);
        sigma.fill(0); frozen.fill(0);
        total_heat=0; total_sigma=0; generation=0;
    }

    function initTemp(profile) {
        // Perfiles de temperatura inicial
        const c=N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const fx=(x-c)/(c-1), fy=(y-c)/(c-1), fz=(z-c)/(c-1);
            const r=Math.sqrt(fx*fx+fy*fy+fz*fz);

            if (profile==='uniforme') {
                temp[i] = P.T_INIT;
            } else if (profile==='estrella') {
                // Caliente en el centro, frío afuera
                temp[i] = P.T_INIT * Math.exp(-r*r*2);
            } else if (profile==='nebulosa') {
                // Múltiples fuentes de calor
                const blobs = [[0.4,0,0],[-0.4,0,0],[0,0.4,0],[0,-0.4,0],[0,0,0.4]];
                let t=P.T_FLOOR;
                for (const [bx,by,bz] of blobs) {
                    const dr=Math.sqrt((fx-bx)**2+(fy-by)**2+(fz-bz)**2);
                    t+=P.T_INIT*0.5*Math.exp(-dr*dr*8);
                }
                temp[i]=t;
            } else if (profile==='cascaras') {
                // Capas concéntricas de calor y frío
                const shells = Math.sin(r*Math.PI*4)*0.5+0.5;
                temp[i] = P.T_FLOOR + P.T_INIT*shells;
            }
        }
    }

    function seedEstrella() {
        clearFields();
        initTemp('estrella');
        const c=N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const fx=(x-c)/(c-1), fy=(y-c)/(c-1), fz=(z-c)/(c-1);
            const r=Math.sqrt(fx*fx+fy*fy+fz*fz)+1e-6;
            const amp=Math.exp(-r*r*1.5)*0.8;
            const phase=Math.atan2(fy,fx);
            psi_r[i]=amp*Math.cos(phase);
            psi_i[i]=amp*Math.sin(phase);
        }
        seed_r.set(psi_r);
    }

    function seedNebulosa() {
        clearFields();
        initTemp('nebulosa');
        for (let i=0;i<T;i++) {
            const amp=Math.random()*0.4;
            const phase=Math.random()*2*Math.PI;
            psi_r[i]=amp*Math.cos(phase);
            psi_i[i]=amp*Math.sin(phase);
        }
        seed_r.set(psi_r);
    }

    function seedCascaras() {
        clearFields();
        initTemp('cascaras');
        const c=N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const fx=(x-c)/(c-1), fy=(y-c)/(c-1), fz=(z-c)/(c-1);
            const r=Math.sqrt(fx*fx+fy*fy+fz*fz);
            psi_r[i]=Math.sin(r*Math.PI*3)*0.6;
            psi_i[i]=Math.cos(r*Math.PI*3)*0.3;
        }
        seed_r.set(psi_r);
    }

    function seedUniforme() {
        // Todo caliente uniformemente — máxima vida inicial
        clearFields();
        initTemp('uniforme');
        for (let i=0;i<T;i++) {
            psi_r[i]=(Math.random()-0.5)*0.3;
            psi_i[i]=(Math.random()-0.5)*0.3;
        }
        seed_r.set(psi_r);
    }

    function seedFrio() {
        // Casi frío desde el inicio — ¿puede organizarse algo antes de morir?
        clearFields();
        for (let i=0;i<T;i++) temp[i]=P.T_INIT*0.15 + Math.random()*0.05;
        for (let i=0;i<T;i++) {
            psi_r[i]=(Math.random()-0.5)*0.5;
            psi_i[i]=(Math.random()-0.5)*0.5;
        }
        seed_r.set(psi_r);
    }

    function initSeed(name) {
        if (name==='estrella')       seedEstrella();
        else if (name==='nebulosa')  seedNebulosa();
        else if (name==='cascaras')  seedCascaras();
        else if (name==='uniforme')  seedUniforme();
        else if (name==='frio')      seedFrio();
        else                         seedEstrella();
        refresh();
    }

    initSeed('estrella');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let T_avg=0, T_max=0, S_avg=0, S_max=0;
        let amp_total=0, frozen_count=0;
        let ov_num=0, ov_na=0, ov_nb=0;

        for (let i=0;i<T;i++) {
            T_avg+=temp[i]; if(temp[i]>T_max) T_max=temp[i];
            S_avg+=sigma[i]; if(sigma[i]>S_max) S_max=sigma[i];
            const amp=Math.sqrt(psi_r[i]*psi_r[i]+psi_i[i]*psi_i[i]);
            amp_total+=amp;
            if(frozen[i]>0.8) frozen_count++;
            ov_num+=psi_r[i]*seed_r[i];
            ov_na+=psi_r[i]*psi_r[i]+psi_i[i]*psi_i[i];
            ov_nb+=seed_r[i]*seed_r[i];
        }

        const overlap=Math.abs(ov_num/(Math.sqrt(ov_na*ov_nb)+1e-12));

        return {
            E_total:   T_avg/T,        // temperatura media — el "pulso vital"
            E_kin:     amp_total/T,    // amplitud media de ψ
            E_torsion: S_avg/T,        // entropía media — irreversible
            E_phase:   T_max,          // temperatura máxima
            helicity:  S_max,          // entropía máxima
            boundary:  frozen_count/T, // fracción congelada
            pump:      generation,
            u_max:     T_max,
            th_max:    S_avg/T,
            phi_max:   T_max,
            psiMax:    T_max,
            coherence: overlap,
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function injectCalor() {
        // Inyectar calor en zona aleatoria — prórroga de vida
        const cx=Math.random()*2-1, cy=Math.random()*2-1, cz=Math.random()*2-1;
        const c=N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const fx=(x-c)/(c-1), fy=(y-c)/(c-1), fz=(z-c)/(c-1);
            const r2=(fx-cx)**2+(fy-cy)**2+(fz-cz)**2;
            temp[i]+=P.HEAT_AMP*Math.exp(-r2*8);
            if(temp[i]>P.T_INIT*2) temp[i]=P.T_INIT*2;
        }
    }

    function injectViento() {
        // Dar velocidad aleatoria a ψ — agitar lo congelado
        for (let i=0;i<T;i++) {
            if (frozen[i]<0.5) { // solo las zonas no tan congeladas
                psi_r_v[i]+=(Math.random()-0.5)*0.3;
                psi_i_v[i]+=(Math.random()-0.5)*0.3;
            }
        }
    }

    function injectReset() {
        // Reset completo de σ y temperatura — empezar de nuevo
        // (esto viola la segunda ley — es la trampa, el cheat code)
        sigma.fill(0); frozen.fill(0);
        initTemp('uniforme');
        generation=0;
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
                temp:  new Float32Array(temp),
                sigma: new Float32Array(sigma),
            };
        },
        loadState(s) {
            if(s.psi_r) { psi_r.set(s.psi_r); seed_r.set(s.psi_r); }
            if(s.psi_i) psi_i.set(s.psi_i);
            if(s.temp)  temp.set(s.temp);
            if(s.sigma) sigma.set(s.sigma);
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() {},
        applyParams(p) { Object.assign(P,p); },
        getParams() { return {...P}; },
        initSeed, seed: initSeed,
        inject(name) {
            if(name==='calor')         injectCalor();
            else if(name==='viento')   injectViento();
            else if(name==='reset_s')  injectReset();
            refresh();
        },
        classifyState(m) {
            if(m.E_total < P.T_FLOOR*2) return 'locked';   // todo congelado
            if(m.boundary > 0.7)        return 'stable';   // mayoría congelada
            if(m.E_torsion > 0.6)       return 'active';   // alta entropía
            if(m.E_total > P.T_INIT*0.7) return 'pumping'; // aún caliente
            if(m.E_total > 0.1)         return 'nucleating';
            return 'vacuum';
        },
    };
}
