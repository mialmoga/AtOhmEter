// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor PARTÍCULA
//  Particle Life mínimo — versión shell-compatible
//
//  N tipos de partículas con tabla de fuerzas entre tipos.
//  Fuerza = f(dist, tipo_a, tipo_b) — atracción o repulsión.
//  Sin ecuaciones diferenciales complejas. Sin ψ complejo.
//  Solo posición, velocidad, tipo, y la tabla.
//
//  La tabla de fuerzas viene de config.json — editable.
//  El render proyecta densidad de tipos al grid 3D.
//  El color = tipo de partícula dominante en cada celda.
//
//  Ámbar — Viernes Mayo 2026
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;
    const MAX  = 1000;
    const TYPES = 5;

    let P = {
        N_PARTICLES: 600,
        R_MAX:       0.4,    // radio de influencia
        R_MIN:       0.06,   // radio de repulsión dura
        FRICTION:    0.85,
        FORCE_SCALE: 0.015,
        DT:          1.0,
        THRESH:      0.05,
        // Tabla de fuerzas TYPES×TYPES — positivo=atracción, negativo=repulsión
        // Fila=tipo del observador, Col=tipo del otro
        FORCES: [
         //  0      1      2      3      4
          [ 0.5,  -0.3,   0.2,  -0.1,   0.4],  // tipo 0 (rojo)
          [ 0.3,   0.4,  -0.2,   0.5,  -0.3],  // tipo 1 (verde)
          [-0.2,   0.3,   0.3,  -0.4,   0.2],  // tipo 2 (azul)
          [ 0.1,  -0.4,   0.4,   0.2,  -0.2],  // tipo 3 (amarillo)
          [-0.3,   0.2,  -0.1,   0.3,   0.5],  // tipo 4 (cyan)
        ],
    };

    // ── Partículas ───────────────────────────────────────────
    const px = new Float32Array(MAX);
    const py = new Float32Array(MAX);
    const pz = new Float32Array(MAX);
    const vx = new Float32Array(MAX);
    const vy = new Float32Array(MAX);
    const vz = new Float32Array(MAX);
    const type = new Uint8Array(MAX);
    const alive = new Uint8Array(MAX);
    let n_alive = 0;

    // Colores por tipo — para phaseData
    const TYPE_PHASE = [0.0, 0.2, 0.4, 0.6, 0.8]; // rueda de colores

    function spawn(x, y, z, t) {
        for (let s = 0; s < MAX; s++) {
            if (!alive[s]) {
                px[s]=x; py[s]=y; pz[s]=z;
                vx[s]=(Math.random()-0.5)*0.01;
                vy[s]=(Math.random()-0.5)*0.01;
                vz[s]=(Math.random()-0.5)*0.01;
                type[s]=t; alive[s]=1; n_alive++;
                return s;
            }
        }
        return -1;
    }

    // ══════════════════════════════════════════════════════════
    //  STEP — fuerza entre pares
    // ══════════════════════════════════════════════════════════
    function step() {
        const fx = new Float32Array(MAX);
        const fy = new Float32Array(MAX);
        const fz = new Float32Array(MAX);

        for (let a = 0; a < MAX; a++) {
            if (!alive[a]) continue;
            for (let b = 0; b < MAX; b++) {
                if (!alive[b] || a===b) continue;

                let dx = px[b]-px[a];
                let dy = py[b]-py[a];
                let dz = pz[b]-pz[a];

                // Periodicidad — caja [-1,1]
                if (dx > 1) dx-=2; if (dx < -1) dx+=2;
                if (dy > 1) dy-=2; if (dy < -1) dy+=2;
                if (dz > 1) dz-=2; if (dz < -1) dz+=2;

                const dist = Math.sqrt(dx*dx+dy*dy+dz*dz)+1e-8;
                if (dist > P.R_MAX) continue;

                const ta = type[a], tb = type[b];
                const attraction = P.FORCES[ta][tb];

                let force;
                if (dist < P.R_MIN) {
                    // Repulsión dura — evitar superposición
                    force = -1.0 * (P.R_MIN - dist) / P.R_MIN;
                } else {
                    // Fuerza de la tabla — suavizada
                    const t = (dist - P.R_MIN) / (P.R_MAX - P.R_MIN);
                    // Perfil: sube hasta 0.3, luego baja a 0
                    const profile = t < 0.3
                        ? t / 0.3
                        : 1.0 - (t - 0.3) / 0.7;
                    force = attraction * profile;
                }

                fx[a] += force * dx / dist;
                fy[a] += force * dy / dist;
                fz[a] += force * dz / dist;
            }
        }

        // Integrar
        for (let a = 0; a < MAX; a++) {
            if (!alive[a]) continue;
            vx[a] = (vx[a] + fx[a]*P.FORCE_SCALE) * P.FRICTION;
            vy[a] = (vy[a] + fy[a]*P.FORCE_SCALE) * P.FRICTION;
            vz[a] = (vz[a] + fz[a]*P.FORCE_SCALE) * P.FRICTION;
            px[a] += vx[a];
            py[a] += vy[a];
            pz[a] += vz[a];
            // Periodicidad
            if (px[a]> 1) px[a]-=2; if (px[a]<-1) px[a]+=2;
            if (py[a]> 1) py[a]-=2; if (py[a]<-1) py[a]+=2;
            if (pz[a]> 1) pz[a]-=2; if (pz[a]<-1) pz[a]+=2;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    // ══════════════════════════════════════════════════════════
    function refresh() {
        renderVolume.fill(0);
        const phase_acc = new Float32Array(T);
        const weight_acc = new Float32Array(T);

        const splash = Math.max(1, Math.floor(N*0.04));

        for (let a = 0; a < MAX; a++) {
            if (!alive[a]) continue;
            const gx = Math.max(0,Math.min(N-1,Math.floor((px[a]+1)*0.5*(N-1))));
            const gy = Math.max(0,Math.min(N-1,Math.floor((py[a]+1)*0.5*(N-1))));
            const gz = Math.max(0,Math.min(N-1,Math.floor((pz[a]+1)*0.5*(N-1))));
            const ph = TYPE_PHASE[type[a]];

            for (let dx=-splash;dx<=splash;dx++)
            for (let dy=-splash;dy<=splash;dy++)
            for (let dz=-splash;dz<=splash;dz++) {
                const nx=gx+dx,ny=gy+dy,nz=gz+dz;
                if (nx<0||nx>=N||ny<0||ny>=N||nz<0||nz>=N) continue;
                const r2=dx*dx+dy*dy+dz*dz;
                const w=Math.exp(-r2/(splash*splash*0.5));
                const gi=nx*N*N+ny*N+nz;
                renderVolume[gi]+=w;
                phase_acc[gi]+=ph*w;
                weight_acc[gi]+=w;
            }
        }

        let mx=1e-10;
        for (let i=0;i<T;i++) if(renderVolume[i]>mx) mx=renderVolume[i];
        for (let i=0;i<T;i++) {
            renderVolume[i]/=mx;
            phaseData[i]=weight_acc[i]>0 ? phase_acc[i]/weight_acc[i] : 0.5;
        }

        texture3D.needsUpdate=true;
        texturePhase.needsUpdate=true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function clearAll() {
        alive.fill(0); n_alive=0;
        vx.fill(0); vy.fill(0); vz.fill(0);
    }

    function seedMix(n) {
        clearAll();
        for (let k=0;k<n;k++) {
            spawn(
                (Math.random()-0.5)*1.8,
                (Math.random()-0.5)*1.8,
                (Math.random()-0.5)*1.8,
                Math.floor(Math.random()*TYPES)
            );
        }
    }

    function seedStripes(n) {
        clearAll();
        for (let k=0;k<n;k++) {
            const t=Math.floor((k/n)*TYPES);
            spawn(
                (Math.random()-0.5)*1.8,
                (Math.random()-0.5)*1.8,
                (Math.random()-0.5)*1.8,
                t%TYPES
            );
        }
    }

    function seedRings(n) {
        clearAll();
        for (let k=0;k<n;k++) {
            const t=k%TYPES;
            const r=0.3+t*0.12;
            const u=Math.random()*2*Math.PI;
            const v=Math.random()*2*Math.PI;
            spawn(
                r*Math.cos(u)*Math.cos(v),
                r*Math.sin(u)*Math.cos(v),
                r*Math.sin(v),
                t
            );
        }
    }

    function initSeed(name) {
        if (name==='mix')          seedMix(P.N_PARTICLES);
        else if (name==='stripes') seedStripes(P.N_PARTICLES);
        else if (name==='rings')   seedRings(P.N_PARTICLES);
        else                       seedMix(P.N_PARTICLES);
        refresh();
    }

    initSeed('mix');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES + API
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let speed=0, max_speed=0;
        const counts = new Int32Array(TYPES);
        for (let a=0;a<MAX;a++) {
            if (!alive[a]) continue;
            const s=Math.sqrt(vx[a]*vx[a]+vy[a]*vy[a]+vz[a]*vz[a]);
            speed+=s; if(s>max_speed) max_speed=s;
            counts[type[a]]++;
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
            coherence: 1-speed/Math.max(1,max_speed*na),
            vortices:  0,
        };
    }

    return {
        step, refresh, getMetrics,
        getState() {
            const pts=[];
            for(let a=0;a<MAX;a++) if(alive[a]) pts.push({px:px[a],py:py[a],pz:pz[a],t:type[a]});
            return { points:pts };
        },
        loadState(s) {
            clearAll();
            if(s.points) for(const p of s.points) spawn(p.px,p.py,p.pz,p.t||0);
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() {},
        applyParams(p) {
            if (p.FORCES) P.FORCES=p.FORCES;
            Object.assign(P,p);
        },
        getParams() { return { ...P }; },
        initSeed, seed: initSeed,
        inject(name) {
            if (name==='agitar') {
                for(let a=0;a<MAX;a++) if(alive[a]) {
                    vx[a]+=(Math.random()-0.5)*0.1;
                    vy[a]+=(Math.random()-0.5)*0.1;
                    vz[a]+=(Math.random()-0.5)*0.1;
                }
            } else if (name==='nuevo') {
                const t=Math.floor(Math.random()*TYPES);
                for(let k=0;k<30;k++) spawn((Math.random()-0.5)*0.4,(Math.random()-0.5)*0.4,(Math.random()-0.5)*0.4,t);
            } else if (name==='invertir') {
                // Invertir todas las fuerzas
                for(let i=0;i<TYPES;i++) for(let j=0;j<TYPES;j++) P.FORCES[i][j]*=-1;
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
