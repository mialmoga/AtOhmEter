// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor V1 (plantilla con personalidad)
//
//  "El Campo Resonante"
//
//  Un campo oscilante que se excita cuando sus vecinos
//  vibran en fase con él, y se inhibe cuando vibran
//  en antifase. Las estructuras emergen donde la resonancia
//  se auto-sostiene.
//
//  Ecuación:
//  ∂²ψ/∂t² = c²∇²ψ − ω²ψ + κ·C(ψ)·ψ
//
//  Donde C(ψ) = correlación local de fase
//  (cuánto están de acuerdo los vecinos)
//
//  Demuestra:
//  ✓ Campo complejo (amplitud + fase)
//  ✓ Segundo orden temporal (Verlet)
//  ✓ Observable propio (coherencia local)
//  ✓ Estado "locked" cuando hay resonancia sostenida
//  ✓ Inyecciones con efecto visual inmediato
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        C_SPEED:    0.4,   // velocidad de onda
        OMEGA:      0.3,   // frecuencia natural de oscilación
        KAPPA:      0.8,   // acoplamiento de resonancia
        DAMP:       0.999, // amortiguamiento suave
        DT:         0.015,
        THRESH:     0.08,
    };

    // Campo complejo: parte real e imaginaria
    const psi_r = new Float64Array(T);
    const psi_i = new Float64Array(T);
    // Velocidades (segundo orden temporal — Verlet)
    const vel_r = new Float64Array(T);
    const vel_i = new Float64Array(T);
    // Correlación local (observable emergente)
    const coherence_local = new Float64Array(T);
    // Buffer temporal
    const lap_r = new Float64Array(T);
    const lap_i = new Float64Array(T);

    const seed_r = new Float64Array(T); // referencia para overlap

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    function laplaciano(Fr, Fi, outr, outi) {
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            outr[i] = Fr[idx(x+1,y,z)]+Fr[idx(x-1,y,z)]
                     +Fr[idx(x,y+1,z)]+Fr[idx(x,y-1,z)]
                     +Fr[idx(x,y,z+1)]+Fr[idx(x,y,z-1)]-6*Fr[i];
            outi[i] = Fi[idx(x+1,y,z)]+Fi[idx(x-1,y,z)]
                     +Fi[idx(x,y+1,z)]+Fi[idx(x,y-1,z)]
                     +Fi[idx(x,y,z+1)]+Fi[idx(x,y,z-1)]-6*Fi[i];
        }
    }

    // ── Coherencia local: correlación de fase con vecinos ────
    // Mide si los 6 vecinos inmediatos están en fase con el punto
    // +1 = todos en fase (resonancia máxima)
    // -1 = todos en antifase (interferencia destructiva)
    function computeCoherence() {
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            const pr=psi_r[i], pi=psi_i[i];
            const amp=Math.sqrt(pr*pr+pi*pi)+1e-10;

            // Producto punto de fase con cada vecino
            let corr = 0;
            const neighbors = [
                idx(x+1,y,z), idx(x-1,y,z),
                idx(x,y+1,z), idx(x,y-1,z),
                idx(x,y,z+1), idx(x,y,z-1),
            ];
            for (const j of neighbors) {
                const namp = Math.sqrt(psi_r[j]*psi_r[j]+psi_i[j]*psi_i[j])+1e-10;
                // cos(Δφ) — 1 si en fase, -1 si en antifase
                corr += (pr*psi_r[j] + pi*psi_i[j]) / (amp*namp);
            }
            coherence_local[i] = corr / 6.0; // normalizar
        }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;

        laplaciano(psi_r, psi_i, lap_r, lap_i);
        computeCoherence();

        for (let i=0;i<T;i++) {
            const pr=psi_r[i], pi=psi_i[i];
            const amp2=pr*pr+pi*pi;
            const coh=coherence_local[i];

            // ∂²ψ/∂t² = c²∇²ψ − ω²ψ + κ·C(ψ)·ψ
            // Término κ·C·ψ:
            //   Si C > 0 (vecinos en fase) → amplifica ψ (resonancia)
            //   Si C < 0 (vecinos antifase) → inhibe ψ (interferencia)
            const force_r = P.C_SPEED*P.C_SPEED*lap_r[i]
                          - P.OMEGA*P.OMEGA*pr
                          + P.KAPPA*coh*pr;
            const force_i = P.C_SPEED*P.C_SPEED*lap_i[i]
                          - P.OMEGA*P.OMEGA*pi
                          + P.KAPPA*coh*pi;

            vel_r[i] = (vel_r[i] + force_r*dt) * P.DAMP;
            vel_i[i] = (vel_i[i] + force_i*dt) * P.DAMP;
            psi_r[i] += vel_r[i]*dt;
            psi_i[i] += vel_i[i]*dt;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    // ══════════════════════════════════════════════════════════
    function refresh() {
        for (let i=0;i<T;i++) {
            const amp = Math.sqrt(psi_r[i]*psi_r[i]+psi_i[i]*psi_i[i]);
            const coh = coherence_local[i];

            // Volumen: amplitud modulada por coherencia
            // Las zonas en resonancia brillan más
            renderVolume[i] = amp * (0.5 + 0.5*Math.max(0,coh));

            // Fase: ángulo de ψ en [0,1]
            phaseData[i] = Math.atan2(psi_i[i], psi_r[i])/(2*Math.PI)+0.5;
        }
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function seedPulso() {
        psi_r.fill(0); psi_i.fill(0); vel_r.fill(0); vel_i.fill(0);
        const c=N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const dx=x-c,dy=y-c,dz=z-c;
            psi_r[i]=Math.exp(-(dx*dx+dy*dy+dz*dz)/(2*(N/5)**2));
        }
        seed_r.set(psi_r);
    }

    function seedVortice() {
        psi_r.fill(0); psi_i.fill(0); vel_r.fill(0); vel_i.fill(0);
        const c=N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i=idx(x,y,z);
            const dx=x-c,dy=y-c;
            const r=Math.sqrt(dx*dx+dy*dy)+1e-6;
            const amp=Math.exp(-r*r/(N*N*0.08));
            const phase=Math.atan2(dy,dx);
            psi_r[i]=amp*Math.cos(phase);
            psi_i[i]=amp*Math.sin(phase);
        }
        seed_r.set(psi_r);
    }

    function seedRuido() {
        psi_r.fill(0); psi_i.fill(0); vel_r.fill(0); vel_i.fill(0);
        for (let i=0;i<T;i++) {
            psi_r[i]=(Math.random()-0.5)*0.4;
            psi_i[i]=(Math.random()-0.5)*0.4;
        }
        seed_r.set(psi_r);
    }

    function seed(name) {
        if (name==='pulso')        seedPulso();
        else if (name==='vortice') seedVortice();
        else if (name==='ruido')   seedRuido();
        else                       seedPulso();
        computeCoherence();
        refresh();
    }

    seed('pulso');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let amp_total=0, amp_max=0, coh_total=0;
        let resonant=0; // celdas con alta coherencia
        let ov_num=0, ov_na=0, ov_nb=0;

        for (let i=0;i<T;i++) {
            const amp=Math.sqrt(psi_r[i]*psi_r[i]+psi_i[i]*psi_i[i]);
            amp_total+=amp; if(amp>amp_max) amp_max=amp;
            coh_total+=coherence_local[i];
            if(coherence_local[i]>0.7) resonant++;
            ov_num+=psi_r[i]*seed_r[i];
            ov_na+=psi_r[i]*psi_r[i]+psi_i[i]*psi_i[i];
            ov_nb+=seed_r[i]*seed_r[i];
        }

        return {
            E_total:   amp_total/T,
            E_kin:     coh_total/T,       // coherencia media → s-ekin
            E_torsion: resonant/T,        // fracción resonante → s-etorsion
            E_phase:   0,
            helicity:  coh_total/T,
            boundary:  resonant/T,
            pump:      amp_max,
            u_max:     amp_max,
            th_max:    coh_total/T,
            phi_max:   amp_max,
            psiMax:    amp_max,
            coherence: Math.abs(ov_num/(Math.sqrt(ov_na*ov_nb)+1e-12)),
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        if (m.psiMax > 8)       return 'collapse';
        if (m.boundary > 0.5)   return 'locked';    // mucha resonancia
        if (m.coherence > 0.7)  return 'stable';
        if (m.E_total > 0.3)    return 'active';
        if (m.E_total > 0.05)   return 'nucleating';
        return 'vacuum';
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function inject(name) {
        if (name === 'sacudir') {
            for (let i=0;i<T;i++) {
                vel_r[i]+=(Math.random()-0.5)*0.2;
                vel_i[i]+=(Math.random()-0.5)*0.2;
            }
        } else if (name === 'antifase') {
            // Invertir ψ_i → romper la coherencia
            for (let i=0;i<T;i++) psi_i[i] *= -1;
        } else if (name === 'pulso') {
            const cx=Math.floor(Math.random()*N);
            const cy=Math.floor(Math.random()*N);
            const cz=Math.floor(Math.random()*N);
            const r=N>>4;
            for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
                const i=idx(cx+dx,cy+dy,cz+dz);
                psi_r[i]+=0.6; psi_i[i]+=(Math.random()-0.5)*0.1;
            }
        }
        computeCoherence();
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  API PÚBLICA
    // ══════════════════════════════════════════════════════════
    return {
        step, refresh, getMetrics, classifyState, inject, seed,
        initSeed: seed,
        getState() {
            return {
                psi_r: new Float32Array(psi_r),
                psi_i: new Float32Array(psi_i),
            };
        },
        setState(s) {
            if(s.psi_r) { psi_r.set(s.psi_r); seed_r.set(s.psi_r); }
            if(s.psi_i) psi_i.set(s.psi_i);
            computeCoherence();
            refresh();
        },
        loadState(s) { this.setState(s); },
        savePrev() {},
        applyParams(p) { Object.assign(P,p); },
        getParams()    { return {...P}; },
    };
}
