// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor HORIZONTE
//  El Campo que Busca el Límite
//  "The Grid Horizon"
//
//  Propuesto por Éter (Gemini) — implementado por Ámbar (Claude)
//  Brujo — Mayo 2026
//
//  La premisa: ψ vive en un grid finito y lo sabe.
//  Desarrolla intuición del horizonte — siente dónde se acaba
//  el espacio y acumula "anhelo" (H) en las fronteras.
//  Cuando H supera un umbral crítico, ocurre el tunelamiento:
//  un nodo del borde se conecta instantáneamente con un nodo
//  aleatorio del interior — hackea sus propias dimensiones.
//
//  Campos:
//    ψ(x,t)  — onda confinada (complejo)
//    Λ(x)    — conciencia del límite (distancia al borde, fija)
//    H(x,t)  — anhelo acumulado (crece en bordes con alta energía)
//    W(x,t)  — agujeros de gusano activos (conexiones no-euclidianas)
//
//  Estados:
//    active   — exploración normal de la jaula
//    pumping  — obsesión periférica (energía migra a bordes)
//    locked   — TUNELAMIENTO ACTIVO (geometría rota)
//    collapse — muerte por desbordamiento
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        C_SPEED:       0.35,   // velocidad de onda base
        NONLIN:        0.5,    // autointeracción
        ETA:           0.8,    // fuerza de Λ (conciencia del límite)
        H_GAIN:        0.04,   // tasa de acumulación de anhelo
        H_DECAY:       0.005,  // tasa de decaimiento de anhelo
        H_THRESH:      0.65,   // umbral de tunelamiento
        WORM_STRENGTH: 0.4,    // fuerza de acoplamiento por agujero de gusano
        WORM_LIFE:     40,     // duración de un agujero de gusano (frames)
        WORM_MAX:      12,     // máximo de agujeros simultáneos
        CORNER_BOOST:  2.5,    // amplificación de Λ en esquinas
        DAMP:          0.9995,
        DT:            0.012,
        THRESH:        0.07,
    };

    // ── Campos ───────────────────────────────────────────────
    const psi_r = new Float64Array(T);
    const psi_i = new Float64Array(T);
    const psi_r_v = new Float64Array(T);
    const psi_i_v = new Float64Array(T);
    const H = new Float64Array(T);       // anhelo
    const Lambda = new Float64Array(T);  // conciencia del límite — FIJA

    // Agujeros de gusano activos
    const MAX_WORMS = 20;
    const worm_a   = new Int32Array(MAX_WORMS);   // índice nodo A (borde)
    const worm_b   = new Int32Array(MAX_WORMS);   // índice nodo B (interior)
    const worm_age = new Int32Array(MAX_WORMS);   // edad del gusano
    const worm_alive = new Uint8Array(MAX_WORMS); // activo?
    let n_worms = 0;

    const seed_r = new Float64Array(T);
    let generation = 0;

    // Temporales
    const lap_r = new Float64Array(T);
    const lap_i = new Float64Array(T);

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    // ══════════════════════════════════════════════════════════
    //  INICIALIZAR Λ — conciencia del límite
    //  Λ(x) = f(distancia al borde más cercano)
    //  Las esquinas tienen Λ máximo — son el horizonte más cercano
    // ══════════════════════════════════════════════════════════
    function initLambda() {
        const c = N >> 1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);

            // Distancia normalizada a cada pared [0,1]
            // 0 = en el borde, 1 = en el centro
            const dx = Math.min(x, N-1-x) / (c);
            const dy = Math.min(y, N-1-y) / (c);
            const dz = Math.min(z, N-1-z) / (c);

            // Distancia al borde más cercano
            const d_min = Math.min(dx, dy, dz);

            // Λ = 1 en el borde, 0 en el centro
            let lambda = 1.0 - d_min;

            // Boost en esquinas — donde convergen tres fronteras
            // Las esquinas son donde el horizonte es más cercano
            // en las tres dimensiones simultáneamente
            const corner = (1-dx) * (1-dy) * (1-dz);
            lambda = Math.min(1.0, lambda + P.CORNER_BOOST * corner * corner);

            Lambda[i] = lambda;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  LAPLACIANO ESTÁNDAR
    // ══════════════════════════════════════════════════════════
    function lap_scalar(F, out) {
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            out[i] = F[idx(x+1,y,z)] + F[idx(x-1,y,z)]
                   + F[idx(x,y+1,z)] + F[idx(x,y-1,z)]
                   + F[idx(x,y,z+1)] + F[idx(x,y,z-1)]
                   - 6*F[i];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  ABRIR AGUJERO DE GUSANO
    //  Conecta un nodo de borde con un nodo aleatorio del interior
    // ══════════════════════════════════════════════════════════
    function openWormhole(border_idx) {
        if (n_worms >= P.WORM_MAX) return;

        // Encontrar slot libre
        for (let w=0;w<MAX_WORMS;w++) {
            if (!worm_alive[w]) {
                // Nodo interior aleatorio — lejos del borde
                const margin = Math.max(2, N>>3);
                const ix = margin + Math.floor(Math.random()*(N-2*margin));
                const iy = margin + Math.floor(Math.random()*(N-2*margin));
                const iz = margin + Math.floor(Math.random()*(N-2*margin));

                worm_a[w]    = border_idx;
                worm_b[w]    = idx(ix, iy, iz);
                worm_age[w]  = 0;
                worm_alive[w] = 1;
                n_worms++;
                return;
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;
        generation++;

        lap_scalar(psi_r, lap_r);
        lap_scalar(psi_i, lap_i);

        // ── Actualizar agujeros de gusano ─────────────────────
        for (let w=0;w<MAX_WORMS;w++) {
            if (!worm_alive[w]) continue;
            worm_age[w]++;
            if (worm_age[w] > P.WORM_LIFE) {
                worm_alive[w]=0; n_worms--;
                continue;
            }
            // Acoplamiento entre nodos A y B
            const a=worm_a[w], b=worm_b[w];
            const age_fade = 1 - worm_age[w]/P.WORM_LIFE;
            const strength = P.WORM_STRENGTH * age_fade;
            // Transferencia de ψ a través del agujero
            const dr = psi_r[b]-psi_r[a];
            const di = psi_i[b]-psi_i[a];
            psi_r_v[a] += strength * dr;
            psi_i_v[a] += strength * di;
            psi_r_v[b] -= strength * dr * 0.5; // reacción más suave en el interior
            psi_i_v[b] -= strength * di * 0.5;
        }

        // ── Evolución de ψ ────────────────────────────────────
        for (let i=0;i<T;i++) {
            const pr=psi_r[i], pi=psi_i[i];
            const amp2=pr*pr+pi*pi;
            const lam=Lambda[i];

            // Onda base
            const f_r = P.C_SPEED*P.C_SPEED * lap_r[i] - P.NONLIN*amp2*pr;
            const f_i = P.C_SPEED*P.C_SPEED * lap_i[i] - P.NONLIN*amp2*pi;

            // Término Λ — "masa aparente" aumenta en el horizonte
            // El campo siente resistencia al moverse cerca del borde
            // pero también es atraído hacia él (tensión de horizonte)
            const lambda_force_r = P.ETA * lam * (lap_r[i] - pr*lam);
            const lambda_force_i = P.ETA * lam * (lap_i[i] - pi*lam);

            psi_r_v[i] += (f_r + lambda_force_r) * dt;
            psi_i_v[i] += (f_i + lambda_force_i) * dt;
            psi_r_v[i] *= P.DAMP;
            psi_i_v[i] *= P.DAMP;
            psi_r[i] += psi_r_v[i] * dt;
            psi_i[i] += psi_i_v[i] * dt;
        }

        // ── Actualizar H (anhelo) ─────────────────────────────
        let max_H = 0;
        for (let i=0;i<T;i++) {
            const amp2 = psi_r[i]*psi_r[i]+psi_i[i]*psi_i[i];
            const kin  = psi_r_v[i]*psi_r_v[i]+psi_i_v[i]*psi_i_v[i];
            const lam  = Lambda[i];

            // H crece donde hay alta energía Y Λ alto (borde)
            const production = P.H_GAIN * lam * (amp2 + kin*10);
            const decay = P.H_DECAY * (1 - lam*0.5); // decae más lento en bordes

            H[i] = Math.min(1.0, Math.max(0, H[i] + production*P.DT - decay*P.DT));
            if (H[i] > max_H) max_H = H[i];
        }

        // ── Tunelamiento — abrir agujeros de gusano ───────────
        // Donde H cruza el umbral, intentar abrir un gusano
        if (max_H > P.H_THRESH && n_worms < P.WORM_MAX) {
            for (let i=0;i<T;i++) {
                if (H[i] > P.H_THRESH && Lambda[i] > 0.7 && Math.random() < 0.002) {
                    openWormhole(i);
                    H[i] *= 0.6; // el tunelamiento libera anhelo
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — catedrales en las esquinas
    // ══════════════════════════════════════════════════════════
    function refresh() {
        // Buffer de agujeros de gusano para el render
        const worm_map = new Float64Array(T);
        for (let w=0;w<MAX_WORMS;w++) {
            if (!worm_alive[w]) continue;
            const fade = 1 - worm_age[w]/P.WORM_LIFE;
            worm_map[worm_a[w]] += fade * 2;
            worm_map[worm_b[w]] += fade * 1.5;
            // Iluminar el "tubo" entre A y B interpolando
            const ax=Math.floor(worm_a[w]/(N*N));
            const ay=Math.floor((worm_a[w]%(N*N))/N);
            const az=worm_a[w]%N;
            const bx=Math.floor(worm_b[w]/(N*N));
            const by=Math.floor((worm_b[w]%(N*N))/N);
            const bz=worm_b[w]%N;
            for (let t=0;t<=8;t++) {
                const f=t/8;
                const mx=Math.round(ax+(bx-ax)*f);
                const my=Math.round(ay+(by-ay)*f);
                const mz=Math.round(az+(bz-az)*f);
                if(mx>=0&&mx<N&&my>=0&&my<N&&mz>=0&&mz<N) {
                    worm_map[idx(mx,my,mz)] += fade*0.8;
                }
            }
        }

        for (let i=0;i<T;i++) {
            const pr=psi_r[i], pi=psi_i[i];
            const amp=Math.sqrt(pr*pr+pi*pi);
            const lam=Lambda[i];
            const hi=H[i];
            const wm=worm_map[i];

            // Volumen:
            // - ψ normal brillante
            // - H acumulado en bordes brilla diferente (anhelo visible)
            // - Gusanos brillan con máxima intensidad (ruptura del espacio)
            // - Λ en esquinas crea las "catedrales" de fondo
            renderVolume[i] = amp * 0.5
                             + hi * lam * 1.5          // catedrales de anhelo
                             + wm * 2.0                // agujeros de gusano
                             + lam*lam*lam * 0.15;     // brillo base de esquinas

            // Fase:
            // - Zonas normales: fase de ψ
            // - Zonas de gusano: fase distorsionada
            // - Esquinas: fase del anhelo H
            const phase_psi = Math.atan2(pi, pr)/(2*Math.PI)+0.5;
            const phase_H = hi;
            const worm_distortion = Math.min(1, wm*0.5);
            phaseData[i] = phase_psi*(1-worm_distortion-lam*0.2)
                         + phase_H*lam*0.2
                         + worm_distortion*0.7;
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
        H.fill(0);
        for (let w=0;w<MAX_WORMS;w++) worm_alive[w]=0;
        n_worms=0; generation=0;
    }

    function seedPulso() {
        clearFields();
        const c=N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const dx=x-c,dy=y-c,dz=z-c;
            const r2=dx*dx+dy*dy+dz*dz;
            const s=N/5.0;
            psi_r[i]=Math.exp(-r2/(2*s*s))*0.9;
            psi_i[i]=(Math.random()-0.5)*0.02;
        }
        seed_r.set(psi_r);
    }

    function seedOndas() {
        // Onda plana propagándose hacia el borde — lo alcanzará pronto
        clearFields();
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const fx=x/(N-1)*2-1;
            psi_r[i]=Math.cos(fx*Math.PI*3)*0.6;
            psi_i[i]=Math.sin(fx*Math.PI*3)*0.6;
        }
        seed_r.set(psi_r);
    }

    function seedCaos() {
        clearFields();
        for (let i=0;i<T;i++) {
            psi_r[i]=(Math.random()-0.5)*0.5;
            psi_i[i]=(Math.random()-0.5)*0.5;
        }
        seed_r.set(psi_r);
    }

    function seedCornered() {
        // Campo concentrado en las 8 esquinas — máximo Λ desde el inicio
        clearFields();
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const fx=x/(N-1), fy=y/(N-1), fz=z/(N-1);
            // Función que es alta en las 8 esquinas
            const corner = (Math.abs(fx-0.5)+Math.abs(fy-0.5)+Math.abs(fz-0.5))/1.5;
            const amp=corner*corner*0.7;
            const phase=Math.atan2(fy-0.5,fx-0.5);
            psi_r[i]=amp*Math.cos(phase);
            psi_i[i]=amp*Math.sin(phase);
        }
        seed_r.set(psi_r);
    }

    function initSeed(name) {
        if (name==='pulso')         seedPulso();
        else if (name==='ondas')    seedOndas();
        else if (name==='caos')     seedCaos();
        else if (name==='cornered') seedCornered();
        else                        seedPulso();
        refresh();
    }

    // Inicializar Λ una sola vez
    initLambda();
    initSeed('pulso');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let amp_total=0, H_total=0, H_max=0;
        let border_energy=0, inner_energy=0;
        let ov_num=0, ov_na=0, ov_nb=0;

        for (let i=0;i<T;i++) {
            const amp=Math.sqrt(psi_r[i]*psi_r[i]+psi_i[i]*psi_i[i]);
            amp_total+=amp;
            H_total+=H[i]; if(H[i]>H_max) H_max=H[i];
            const lam=Lambda[i];
            if (lam>0.5) border_energy+=amp;
            else inner_energy+=amp;
            ov_num+=psi_r[i]*seed_r[i];
            ov_na+=psi_r[i]*psi_r[i]+psi_i[i]*psi_i[i];
            ov_nb+=seed_r[i]*seed_r[i];
        }

        const overlap=Math.abs(ov_num/(Math.sqrt(ov_na*ov_nb)+1e-12));

        return {
            E_total:   amp_total/T,
            E_kin:     border_energy/(inner_energy+1e-10), // ratio borde/interior
            E_torsion: H_total/T,    // anhelo medio
            E_phase:   H_max,        // anhelo máximo
            helicity:  n_worms,      // agujeros de gusano activos
            boundary:  border_energy/(amp_total+1e-10),
            pump:      generation,
            u_max:     H_max,
            th_max:    H_total/T,
            phi_max:   H_max,
            psiMax:    amp_total/T,
            coherence: overlap,
            vortices:  n_worms,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function injectEmpujar() {
        // Dar velocidad radial hacia el borde — acelerar el anhelo
        const c=N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const dx=x-c,dy=y-c,dz=z-c;
            const r=Math.sqrt(dx*dx+dy*dy+dz*dz)+1e-6;
            const push=0.04*Math.exp(-r/(N*0.2));
            psi_r_v[i]+=push*dx/r;
            psi_i_v[i]+=push*dy/r;
        }
    }

    function injectForzarGusano() {
        // Forzar apertura de agujeros de gusano en todas las esquinas
        const corners=[
            [0,0,0],[N-1,0,0],[0,N-1,0],[0,0,N-1],
            [N-1,N-1,0],[N-1,0,N-1],[0,N-1,N-1],[N-1,N-1,N-1]
        ];
        for (const [cx,cy,cz] of corners) {
            const i=idx(cx,cy,cz);
            H[i]=1.0; // forzar anhelo máximo en esquinas
            openWormhole(i);
        }
    }

    function injectCalmar() {
        // Resetear H y cerrar agujeros — el campo se resigna
        H.fill(0);
        for (let w=0;w<MAX_WORMS;w++) { worm_alive[w]=0; }
        n_worms=0;
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
                H:     new Float32Array(H),
            };
        },
        loadState(s) {
            if(s.psi_r) { psi_r.set(s.psi_r); seed_r.set(s.psi_r); }
            if(s.psi_i) psi_i.set(s.psi_i);
            if(s.H)     H.set(s.H);
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() {},
        applyParams(p) {
            Object.assign(P,p);
            initLambda(); // recalcular Λ si CORNER_BOOST cambió
        },
        getParams() { return {...P}; },
        initSeed, seed: initSeed,
        inject(name) {
            if(name==='empujar')        injectEmpujar();
            else if(name==='esquinas')  injectForzarGusano();
            else if(name==='calmar')    injectCalmar();
            refresh();
        },
        classifyState(m) {
            if(m.u_max>0.9)        return 'locked';    // tunelamiento masivo
            if(m.helicity>3)       return 'locked';    // muchos gusanos
            if(m.E_kin>3)          return 'pumping';   // borde > interior
            if(m.E_torsion>0.3)    return 'active';    // mucho anhelo
            if(m.psiMax<0.02)      return 'collapse';
            return 'nucleating';
        },
    };
}
