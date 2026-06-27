// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor PARTÍCULA V2
//  Particle Life con ψ complejo y herencia de fase
//
//  V1 → V2:
//    + ψ ∈ ℂ por partícula (amplitud + fase propia)
//    + La fuerza depende de la coherencia de fase entre pares
//    + Las partículas heredan fase al nacer (mitosis de ψ)
//    + Tabla editable desde sliders (F00..F44 como params)
//    + Nacimiento/muerte dinámico por energía local
//    + N=64 disponible
//    + Render: colores continuos por fase real de ψ
//
//  La fase no es decoración — es física.
//  Dos partículas del mismo tipo pueden repelerse
//  si sus fases son opuestas.
//
//  Ámbar — Viernes Mayo 2026 😈
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;
    const MAX   = 1200;
    const TYPES = 5;

    let P = {
        N_PARTICLES:  700,
        R_MAX:        0.38,
        R_MIN:        0.055,
        FRICTION:     0.87,
        FORCE_SCALE:  0.014,
        PSI_OMEGA:    0.08,   // velocidad de rotación de fase propia
        PSI_COUPLE:   0.12,   // acoplamiento de fase entre vecinos
        PHASE_WEIGHT: 0.6,    // cuánto pesa la fase en la fuerza [0=ignorar, 1=total]
        BIRTH_ENERGY: 0.018,  // energía cinética mínima para nacer
        DEATH_SPEED:  0.0008, // velocidad mínima para sobrevivir
        THRESH:       0.05,
        // Tabla de fuerzas — 25 entradas editables desde config
        F00: 0.5,  F01:-0.3, F02: 0.2, F03:-0.1, F04: 0.4,
        F10: 0.3,  F11: 0.4, F12:-0.2, F13: 0.5, F14:-0.3,
        F20:-0.2,  F21: 0.3, F22: 0.3, F23:-0.4, F24: 0.2,
        F30: 0.1,  F31:-0.4, F32: 0.4, F33: 0.2, F34:-0.2,
        F40:-0.3,  F41: 0.2, F42:-0.1, F43: 0.3, F44: 0.5,
    };

    // Reconstruir matriz desde params planos
    function getForces() {
        return [
            [P.F00,P.F01,P.F02,P.F03,P.F04],
            [P.F10,P.F11,P.F12,P.F13,P.F14],
            [P.F20,P.F21,P.F22,P.F23,P.F24],
            [P.F30,P.F31,P.F32,P.F33,P.F34],
            [P.F40,P.F41,P.F42,P.F43,P.F44],
        ];
    }

    // ── Partículas ───────────────────────────────────────────
    const px = new Float32Array(MAX);
    const py = new Float32Array(MAX);
    const pz = new Float32Array(MAX);
    const vx = new Float32Array(MAX);
    const vy = new Float32Array(MAX);
    const vz = new Float32Array(MAX);
    const psi_r = new Float32Array(MAX); // fase ψ real
    const psi_i = new Float32Array(MAX); // fase ψ imaginaria
    const type  = new Uint8Array(MAX);
    const alive = new Uint8Array(MAX);
    const energy_local = new Float32Array(MAX); // energía cinética local
    let n_alive = 0;

    // Fases base por tipo — separadas 2π/TYPES
    const TYPE_BASE_PHASE = Array.from({length:TYPES}, (_,i) => i*2*Math.PI/TYPES);

    function spawn(x, y, z, t, pr, pi) {
        for (let s = 0; s < MAX; s++) {
            if (!alive[s]) {
                px[s]=x; py[s]=y; pz[s]=z;
                vx[s]=(Math.random()-0.5)*0.008;
                vy[s]=(Math.random()-0.5)*0.008;
                vz[s]=(Math.random()-0.5)*0.008;
                type[s]=t;
                // ψ: heredar si se pasa, si no usar fase base del tipo + ruido
                if (pr !== undefined) {
                    psi_r[s] = pr + (Math.random()-0.5)*0.1;
                    psi_i[s] = pi + (Math.random()-0.5)*0.1;
                } else {
                    const base = TYPE_BASE_PHASE[t];
                    psi_r[s] = Math.cos(base + (Math.random()-0.5)*0.3);
                    psi_i[s] = Math.sin(base + (Math.random()-0.5)*0.3);
                }
                // Normalizar ψ
                const amp = Math.sqrt(psi_r[s]*psi_r[s]+psi_i[s]*psi_i[s])+1e-8;
                psi_r[s]/=amp; psi_i[s]/=amp;
                alive[s]=1; energy_local[s]=0; n_alive++;
                return s;
            }
        }
        return -1;
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        const FORCES = getForces();
        const fx = new Float32Array(MAX);
        const fy = new Float32Array(MAX);
        const fz = new Float32Array(MAX);
        const dpsi_r = new Float32Array(MAX);
        const dpsi_i = new Float32Array(MAX);
        energy_local.fill(0);

        for (let a = 0; a < MAX; a++) {
            if (!alive[a]) continue;

            for (let b = a+1; b < MAX; b++) {
                if (!alive[b]) continue;

                let dx=px[b]-px[a], dy=py[b]-py[a], dz=pz[b]-pz[a];
                // Periodicidad
                if(dx>1)dx-=2;if(dx<-1)dx+=2;
                if(dy>1)dy-=2;if(dy<-1)dy+=2;
                if(dz>1)dz-=2;if(dz<-1)dz+=2;
                const dist=Math.sqrt(dx*dx+dy*dy+dz*dz)+1e-8;
                if(dist>P.R_MAX) continue;

                const ta=type[a], tb=type[b];

                // ── Coherencia de fase ψ ──────────────────────
                // cos(φₐ − φ_b) — 1=en fase, -1=antifase
                const phase_coherence = psi_r[a]*psi_r[b] + psi_i[a]*psi_i[b];

                // ── Fuerza de la tabla × modulación de fase ───
                const base_force_a = FORCES[ta][tb];
                const base_force_b = FORCES[tb][ta];

                // PHASE_WEIGHT=0: solo tabla. PHASE_WEIGHT=1: solo fase.
                const eff_a = base_force_a*(1-P.PHASE_WEIGHT) + base_force_a*phase_coherence*P.PHASE_WEIGHT;
                const eff_b = base_force_b*(1-P.PHASE_WEIGHT) + base_force_b*phase_coherence*P.PHASE_WEIGHT;

                let fa, fb;
                if (dist < P.R_MIN) {
                    // Repulsión dura — independiente de fase
                    const rep = -(P.R_MIN-dist)/P.R_MIN;
                    fa=rep; fb=rep;
                } else {
                    const t=(dist-P.R_MIN)/(P.R_MAX-P.R_MIN);
                    const profile=t<0.3 ? t/0.3 : 1-(t-0.3)/0.7;
                    fa=eff_a*profile;
                    fb=eff_b*profile;
                }

                const nx=dx/dist, ny=dy/dist, nz=dz/dist;
                fx[a]+=fa*nx; fy[a]+=fa*ny; fz[a]+=fa*nz;
                fx[b]-=fb*nx; fy[b]-=fb*ny; fz[b]-=fb*nz;

                // ── Acoplamiento de ψ entre vecinos ───────────
                if (dist < P.R_MAX * 0.5) {
                    const strength = P.PSI_COUPLE * (1 - dist/(P.R_MAX*0.5));
                    dpsi_r[a] += strength*(psi_r[b]-psi_r[a]);
                    dpsi_i[a] += strength*(psi_i[b]-psi_i[a]);
                    dpsi_r[b] += strength*(psi_r[a]-psi_r[b]);
                    dpsi_i[b] += strength*(psi_i[a]-psi_i[b]);
                }

                // Energía local acumulada
                const e = (fa*fa+fb*fb)*0.5;
                energy_local[a]+=e; energy_local[b]+=e;
            }
        }

        // ── Integración + evolución de ψ ─────────────────────
        for (let a = 0; a < MAX; a++) {
            if (!alive[a]) continue;

            // Velocidad y posición
            vx[a]=(vx[a]+fx[a]*P.FORCE_SCALE)*P.FRICTION;
            vy[a]=(vy[a]+fy[a]*P.FORCE_SCALE)*P.FRICTION;
            vz[a]=(vz[a]+fz[a]*P.FORCE_SCALE)*P.FRICTION;
            px[a]+=vx[a]; py[a]+=vy[a]; pz[a]+=vz[a];
            if(px[a]>1)px[a]-=2;if(px[a]<-1)px[a]+=2;
            if(py[a]>1)py[a]-=2;if(py[a]<-1)py[a]+=2;
            if(pz[a]>1)pz[a]-=2;if(pz[a]<-1)pz[a]+=2;

            // Evolución de ψ — rotación libre + acoplamiento
            const pr=psi_r[a], pi=psi_i[a];
            const omega=P.PSI_OMEGA*(1+type[a]*0.1);
            const cos_w=Math.cos(omega), sin_w=Math.sin(omega);
            let new_r=pr*cos_w-pi*sin_w+dpsi_r[a];
            let new_i=pr*sin_w+pi*cos_w+dpsi_i[a];
            const amp=Math.sqrt(new_r*new_r+new_i*new_i)+1e-8;
            psi_r[a]=new_r/amp; psi_i[a]=new_i/amp; // ψ normalizado en S¹
        }

        // ── Nacimiento y muerte ───────────────────────────────
        // Muerte: velocidad muy baja (atrapado) o sin vecinos
        for (let a=0;a<MAX;a++) {
            if (!alive[a]) continue;
            const speed=Math.sqrt(vx[a]*vx[a]+vy[a]*vy[a]+vz[a]*vz[a]);
            // Solo matar si velocidad muy baja Y energía local muy baja
            if (speed < P.DEATH_SPEED && energy_local[a] < 1e-5) {
                alive[a]=0; n_alive--;
            }
        }

        // Nacimiento: en zona de alta energía, heredando tipo y ψ del padre
        if (n_alive < P.N_PARTICLES && Math.random() < 0.03) {
            // Buscar partícula con alta energía local como candidata a padre
            let best=-1, best_e=P.BIRTH_ENERGY;
            for (let a=0;a<MAX;a++) {
                if (alive[a] && energy_local[a]>best_e) { best_e=energy_local[a]; best=a; }
            }
            if (best>=0) {
                const r=P.R_MIN*2;
                spawn(
                    px[best]+(Math.random()-0.5)*r,
                    py[best]+(Math.random()-0.5)*r,
                    pz[best]+(Math.random()-0.5)*r,
                    type[best],
                    psi_r[best], psi_i[best]  // herencia de ψ
                );
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — color = fase real de ψ (rueda completa)
    // ══════════════════════════════════════════════════════════
    function refresh() {
        renderVolume.fill(0);
        const phase_acc=new Float32Array(T);
        const weight_acc=new Float32Array(T);
        const splash=Math.max(1,Math.floor(N*0.045));

        for (let a=0;a<MAX;a++) {
            if (!alive[a]) continue;
            const gx=Math.max(0,Math.min(N-1,Math.floor((px[a]+1)*0.5*(N-1))));
            const gy=Math.max(0,Math.min(N-1,Math.floor((py[a]+1)*0.5*(N-1))));
            const gz=Math.max(0,Math.min(N-1,Math.floor((pz[a]+1)*0.5*(N-1))));
            // Fase real de ψ (no el tipo) — colores continuos
            const phase=Math.atan2(psi_i[a],psi_r[a])/(2*Math.PI)+0.5;
            const speed=Math.sqrt(vx[a]*vx[a]+vy[a]*vy[a]+vz[a]*vz[a]);
            const brightness=0.5+speed*20; // las rápidas brillan más

            for(let dx=-splash;dx<=splash;dx++)
            for(let dy=-splash;dy<=splash;dy++)
            for(let dz=-splash;dz<=splash;dz++) {
                const nx=gx+dx,ny=gy+dy,nz=gz+dz;
                if(nx<0||nx>=N||ny<0||ny>=N||nz<0||nz>=N) continue;
                const r2=dx*dx+dy*dy+dz*dz;
                const w=Math.exp(-r2/(splash*splash*0.5))*brightness;
                const gi=nx*N*N+ny*N+nz;
                renderVolume[gi]+=w;
                phase_acc[gi]+=phase*w;
                weight_acc[gi]+=w;
            }
        }

        let mx=1e-10;
        for(let i=0;i<T;i++) if(renderVolume[i]>mx) mx=renderVolume[i];
        for(let i=0;i<T;i++) {
            renderVolume[i]/=mx;
            phaseData[i]=weight_acc[i]>0 ? phase_acc[i]/weight_acc[i] : 0.5;
        }
        texture3D.needsUpdate=true;
        texturePhase.needsUpdate=true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function clearAll() { alive.fill(0); n_alive=0; vx.fill(0); vy.fill(0); vz.fill(0); }

    function seedMix(n) {
        clearAll();
        for(let k=0;k<n;k++) spawn((Math.random()-0.5)*1.8,(Math.random()-0.5)*1.8,(Math.random()-0.5)*1.8,Math.floor(Math.random()*TYPES));
    }
    function seedClusters(n) {
        clearAll();
        for(let c=0;c<TYPES;c++) {
            const cx=(Math.random()-0.5)*1.2, cy=(Math.random()-0.5)*1.2, cz=(Math.random()-0.5)*1.2;
            for(let k=0;k<n/TYPES;k++) spawn(cx+(Math.random()-0.5)*0.2,cy+(Math.random()-0.5)*0.2,cz+(Math.random()-0.5)*0.2,c);
        }
    }
    function seedRings(n) {
        clearAll();
        for(let k=0;k<n;k++) {
            const t=k%TYPES, r=0.25+t*0.13;
            const u=Math.random()*2*Math.PI, v=Math.random()*2*Math.PI;
            spawn(r*Math.cos(u)*Math.cos(v),r*Math.sin(u)*Math.cos(v),r*Math.sin(v),t);
        }
    }
    function seedVortex(n) {
        // Partículas en hélice — fase ψ gira con la posición
        clearAll();
        for(let k=0;k<n;k++) {
            const t=k%TYPES;
            const angle=k/n*6*Math.PI;
            const r=0.4+Math.random()*0.3;
            const x=r*Math.cos(angle), y=r*Math.sin(angle), z=(k/n-0.5)*1.6;
            const s=spawn(x,y,z,t);
            if(s>=0) { vx[s]=-y*0.01; vy[s]=x*0.01; } // velocidad tangencial
        }
    }

    function initSeed(name) {
        if(name==='mix')          seedMix(P.N_PARTICLES);
        else if(name==='clusters') seedClusters(P.N_PARTICLES);
        else if(name==='rings')    seedRings(P.N_PARTICLES);
        else if(name==='vortex')   seedVortex(P.N_PARTICLES);
        else                       seedMix(P.N_PARTICLES);
        refresh();
    }

    initSeed('clusters');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let speed=0, max_speed=0, coherence_sum=0;
        const counts=new Int32Array(TYPES);
        let births=0;
        for(let a=0;a<MAX;a++) {
            if(!alive[a]) continue;
            const s=Math.sqrt(vx[a]*vx[a]+vy[a]*vy[a]+vz[a]*vz[a]);
            speed+=s; if(s>max_speed) max_speed=s;
            counts[type[a]]++;
            coherence_sum+=psi_r[a]*psi_r[a]; // proxy de coherencia de fase
        }
        const na=Math.max(1,n_alive);
        return {
            E_total:   n_alive/P.N_PARTICLES,
            E_kin:     speed/na,
            E_torsion: counts[0]/na,
            E_phase:   counts[1]/na,
            helicity:  counts[2]/na,
            boundary:  counts[3]/na,
            pump:      counts[4]/na,
            u_max:     max_speed,
            th_max:    speed/na,
            phi_max:   max_speed,
            psiMax:    max_speed,
            coherence: coherence_sum/na,
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    return {
        step, refresh, getMetrics,
        getState() {
            const pts=[];
            for(let a=0;a<MAX;a++) if(alive[a]) pts.push({px:px[a],py:py[a],pz:pz[a],t:type[a],pr:psi_r[a],pi:psi_i[a]});
            return { points:pts };
        },
        loadState(s) {
            clearAll();
            if(s.points) for(const p of s.points) spawn(p.px,p.py,p.pz,p.t||0,p.pr,p.pi);
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() {},
        applyParams(p) { Object.assign(P,p); },
        getParams() { return {...P}; },
        initSeed, seed: initSeed,
        inject(name) {
            if(name==='agitar') {
                for(let a=0;a<MAX;a++) if(alive[a]) {
                    vx[a]+=(Math.random()-0.5)*0.08;
                    vy[a]+=(Math.random()-0.5)*0.08;
                    vz[a]+=(Math.random()-0.5)*0.08;
                }
            } else if(name==='nuevo') {
                const t=Math.floor(Math.random()*TYPES);
                for(let k=0;k<40;k++) spawn((Math.random()-0.5)*0.5,(Math.random()-0.5)*0.5,(Math.random()-0.5)*0.5,t);
            } else if(name==='invertir') {
                // Invertir tabla completa
                P.F00*=-1;P.F01*=-1;P.F02*=-1;P.F03*=-1;P.F04*=-1;
                P.F10*=-1;P.F11*=-1;P.F12*=-1;P.F13*=-1;P.F14*=-1;
                P.F20*=-1;P.F21*=-1;P.F22*=-1;P.F23*=-1;P.F24*=-1;
                P.F30*=-1;P.F31*=-1;P.F32*=-1;P.F33*=-1;P.F34*=-1;
                P.F40*=-1;P.F41*=-1;P.F42*=-1;P.F43*=-1;P.F44*=-1;
            } else if(name==='sincronizar') {
                // Sincronizar fase ψ dentro de cada tipo
                const avg_r=new Float32Array(TYPES), avg_i=new Float32Array(TYPES), cnt=new Float32Array(TYPES);
                for(let a=0;a<MAX;a++) if(alive[a]){avg_r[type[a]]+=psi_r[a];avg_i[type[a]]+=psi_i[a];cnt[type[a]]++;}
                for(let t=0;t<TYPES;t++) if(cnt[t]>0){avg_r[t]/=cnt[t];avg_i[t]/=cnt[t];}
                for(let a=0;a<MAX;a++) if(alive[a]){
                    psi_r[a]=avg_r[type[a]]+(Math.random()-0.5)*0.05;
                    psi_i[a]=avg_i[type[a]]+(Math.random()-0.5)*0.05;
                    const amp=Math.sqrt(psi_r[a]*psi_r[a]+psi_i[a]*psi_i[a])+1e-8;
                    psi_r[a]/=amp;psi_i[a]/=amp;
                }
            }
            refresh();
        },
        classifyState(m) {
            if(m.E_total<0.1)    return 'vacuum';
            if(m.E_kin>0.015)    return 'active';
            if(m.coherence>0.8)  return 'locked';
            if(m.E_kin>0.005)    return 'pumping';
            return 'stable';
        },
    };
}
