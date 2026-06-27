// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor FRONTERA
//  Geometría Emergente desde Red de Puntos
//
//  El espacio no existe hasta que el campo lo decide.
//
//  No hay grid fijo. Hay puntos que nacen, se mueven,
//  se conectan y mueren. La física ocurre en la red
//  de conexiones. El espacio es consecuencia.
//
//  Cada punto:
//    pos ∈ ℝ³     — posición (emergente, no fundamental)
//    ψ ∈ ℂ        — estado (amplitud + fase)
//    vel ∈ ℝ³     — velocidad de posición
//    connections  — lista de vecinos conectados
//
//  Reglas:
//    - Puntos en fase → se atraen
//    - Puntos en antifase → se repelen
//    - Conexión si dist < R_CONNECT y coherencia > C_THRESH
//    - Nacimiento en zonas densas de conexiones
//    - Muerte por aislamiento o amplitud < eps
//
//  Render: densidad de conexiones → volumen 3D
//  Color: fase promedio de conexiones cercanas
//
//  Ámbar — Viernes Mayo 2026 😈
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        MAX_POINTS:   800,    // número máximo de puntos
        R_CONNECT:    0.35,   // radio de conexión (espacio [-1,1]³)
        C_THRESH:     0.3,    // umbral de coherencia para conectar
        ATTRACT:      0.08,   // fuerza de atracción entre puntos en fase
        REPEL:        0.12,   // fuerza de repulsión en antifase
        PSI_SPEED:    0.6,    // velocidad de evolución de ψ
        PSI_COUPLE:   0.15,   // acoplamiento ψ entre vecinos conectados
        BIRTH_RATE:   0.02,   // probabilidad de nacimiento por zona densa
        DEATH_THRESH: 0.05,   // amplitud mínima para sobrevivir
        ISOLATION:    3,      // conexiones mínimas para no morir
        FRICTION:     0.88,   // fricción de movimiento
        THRESH:       0.08,
    };

    // ── Puntos de la red ─────────────────────────────────────
    // Usamos arrays paralelos para eficiencia
    const MAX = 1200;
    const px = new Float64Array(MAX);   // posición x ∈ [-1,1]
    const py = new Float64Array(MAX);   // posición y
    const pz = new Float64Array(MAX);   // posición z
    const vx = new Float64Array(MAX);   // velocidad x
    const vy = new Float64Array(MAX);   // velocidad y
    const vz = new Float64Array(MAX);   // velocidad z
    const psi_r = new Float64Array(MAX); // ψ real
    const psi_i = new Float64Array(MAX); // ψ imaginario
    const alive = new Uint8Array(MAX);   // 1=vivo, 0=muerto
    const age_p = new Float64Array(MAX); // edad del punto
    const conn_count = new Int32Array(MAX); // número de conexiones

    let n_alive = 0;
    let generation = 0;

    // ── Grid 3D para render ──────────────────────────────────
    // Proyectamos la red de puntos al grid del shell
    function worldToGrid(wx, wy, wz) {
        // [-1,1] → [0, N-1]
        const gx = Math.floor((wx + 1) * 0.5 * (N-1));
        const gy = Math.floor((wy + 1) * 0.5 * (N-1));
        const gz = Math.floor((wz + 1) * 0.5 * (N-1));
        return [
            Math.max(0, Math.min(N-1, gx)),
            Math.max(0, Math.min(N-1, gy)),
            Math.max(0, Math.min(N-1, gz))
        ];
    }

    function gridIdx(x, y, z) {
        return x * N * N + y * N + z;
    }

    // ── Crear un punto nuevo ─────────────────────────────────
    function spawnPoint(x, y, z, r, i, inherited_r, inherited_i) {
        // Buscar slot libre
        for (let s = 0; s < MAX; s++) {
            if (!alive[s]) {
                px[s] = x; py[s] = y; pz[s] = z;
                vx[s] = (Math.random()-0.5)*0.02;
                vy[s] = (Math.random()-0.5)*0.02;
                vz[s] = (Math.random()-0.5)*0.02;
                psi_r[s] = inherited_r !== undefined ? inherited_r*0.7 + (Math.random()-0.5)*0.1 : r;
                psi_i[s] = inherited_i !== undefined ? inherited_i*0.7 + (Math.random()-0.5)*0.1 : i;
                alive[s] = 1;
                age_p[s] = 0;
                conn_count[s] = 0;
                n_alive++;
                return s;
            }
        }
        return -1; // sin espacio
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        generation++;
        const dt = 1.0; // tiempo discreto — una generación

        // Resetear contadores de conexión
        conn_count.fill(0);

        // ── 1. CALCULAR INTERACCIONES ─────────────────────────
        // Para cada par de puntos vivos, calcular fuerzas y
        // acoplamiento de ψ si están conectados
        const forces_x = new Float64Array(MAX);
        const forces_y = new Float64Array(MAX);
        const forces_z = new Float64Array(MAX);
        const dpsi_r = new Float64Array(MAX);
        const dpsi_i = new Float64Array(MAX);

        for (let a = 0; a < MAX; a++) {
            if (!alive[a]) continue;
            for (let b = a+1; b < MAX; b++) {
                if (!alive[b]) continue;

                const dx = px[b]-px[a];
                const dy = py[b]-py[a];
                const dz = pz[b]-pz[a];
                const dist2 = dx*dx+dy*dy+dz*dz;
                const dist = Math.sqrt(dist2) + 1e-8;

                if (dist > P.R_CONNECT * 2.5) continue; // demasiado lejos

                // Coherencia de fase entre a y b
                const phase_a = Math.atan2(psi_i[a], psi_r[a]);
                const phase_b = Math.atan2(psi_i[b], psi_r[b]);
                const phase_diff = phase_a - phase_b;
                const coherence = Math.cos(phase_diff); // 1=en fase, -1=antifase

                // ¿Están conectados?
                const connected = dist < P.R_CONNECT && coherence > P.C_THRESH;

                if (connected) {
                    conn_count[a]++;
                    conn_count[b]++;

                    // Acoplamiento de ψ — los conectados se influencian
                    const couple = P.PSI_COUPLE;
                    dpsi_r[a] += couple * (psi_r[b] - psi_r[a]);
                    dpsi_i[a] += couple * (psi_i[b] - psi_i[a]);
                    dpsi_r[b] += couple * (psi_r[a] - psi_r[b]);
                    dpsi_i[b] += couple * (psi_i[a] - psi_i[b]);
                }

                // Fuerza posicional
                // En fase → atracción; antifase → repulsión
                let force_mag;
                if (coherence > 0) {
                    // Atracción con máximo a dist_opt = R_CONNECT*0.6
                    const dist_opt = P.R_CONNECT * 0.6;
                    force_mag = P.ATTRACT * coherence * (dist - dist_opt) / dist;
                } else {
                    // Repulsión — más fuerte a corta distancia
                    force_mag = -P.REPEL * Math.abs(coherence) / (dist2 + 0.01);
                }

                const fx = force_mag * dx / dist;
                const fy = force_mag * dy / dist;
                const fz = force_mag * dz / dist;

                forces_x[a] += fx; forces_y[a] += fy; forces_z[a] += fz;
                forces_x[b] -= fx; forces_y[b] -= fy; forces_z[b] -= fz;
            }
        }

        // ── 2. EVOLUCIÓN DE ψ + POSICIÓN ─────────────────────
        for (let a = 0; a < MAX; a++) {
            if (!alive[a]) continue;

            // Evolución de ψ — oscilación libre + acoplamiento
            const pr = psi_r[a], pi = psi_i[a];
            const amp = Math.sqrt(pr*pr+pi*pi)+1e-10;

            // Rotación de fase (oscilación libre)
            const omega = P.PSI_SPEED * (0.8 + conn_count[a] * 0.05);
            const cos_w = Math.cos(omega * 0.1);
            const sin_w = Math.sin(omega * 0.1);
            const new_r = pr*cos_w - pi*sin_w + dpsi_r[a];
            const new_i = pr*sin_w + pi*cos_w + dpsi_i[a];

            // Normalización suave de amplitud
            const new_amp = Math.sqrt(new_r*new_r+new_i*new_i)+1e-10;
            const target_amp = Math.min(amp, 1.2); // sin explosión
            psi_r[a] = new_r * target_amp / new_amp;
            psi_i[a] = new_i * target_amp / new_amp;

            // Movimiento de posición
            vx[a] = (vx[a] + forces_x[a] * 0.01) * P.FRICTION;
            vy[a] = (vy[a] + forces_y[a] * 0.01) * P.FRICTION;
            vz[a] = (vz[a] + forces_z[a] * 0.01) * P.FRICTION;

            px[a] += vx[a];
            py[a] += vy[a];
            pz[a] += vz[a];

            // Rebote en las paredes [-1,1]
            if (px[a] > 1)  { px[a] = 1;  vx[a] *= -0.5; }
            if (px[a] < -1) { px[a] = -1; vx[a] *= -0.5; }
            if (py[a] > 1)  { py[a] = 1;  vy[a] *= -0.5; }
            if (py[a] < -1) { py[a] = -1; vy[a] *= -0.5; }
            if (pz[a] > 1)  { pz[a] = 1;  vz[a] *= -0.5; }
            if (pz[a] < -1) { pz[a] = -1; vz[a] *= -0.5; }

            age_p[a] += 0.01;
        }

        // ── 3. MUERTE POR AISLAMIENTO O AMPLITUD ─────────────
        for (let a = 0; a < MAX; a++) {
            if (!alive[a]) continue;
            const amp = Math.sqrt(psi_r[a]*psi_r[a]+psi_i[a]*psi_i[a]);
            const isolated = conn_count[a] < P.ISOLATION && age_p[a] > 0.5;
            if (amp < P.DEATH_THRESH || isolated) {
                alive[a] = 0;
                n_alive--;
            }
        }

        // ── 4. NACIMIENTO EN ZONAS DENSAS ────────────────────
        if (n_alive < P.MAX_POINTS && Math.random() < P.BIRTH_RATE) {
            // Encontrar una zona densa: tomar punto aleatorio vivo
            // y nacer cerca de él heredando su ψ
            const candidates = [];
            for (let a = 0; a < MAX; a++) {
                if (alive[a] && conn_count[a] >= 3) candidates.push(a);
            }
            if (candidates.length > 0) {
                const parent = candidates[Math.floor(Math.random()*candidates.length)];
                const r = P.R_CONNECT * 0.3;
                spawnPoint(
                    px[parent] + (Math.random()-0.5)*r,
                    py[parent] + (Math.random()-0.5)*r,
                    pz[parent] + (Math.random()-0.5)*r,
                    0, 0,
                    psi_r[parent], psi_i[parent]
                );
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — proyectar red al grid 3D
    // ══════════════════════════════════════════════════════════
    function refresh() {
        renderVolume.fill(0);
        phaseData.fill(0.5);

        // Acumular densidad de conexiones en el grid
        const phase_sum = new Float64Array(T);
        const phase_weight = new Float64Array(T);

        // Radio de "splash" en grid — un punto irradia a celdas vecinas
        const splash = Math.max(1, Math.floor(N * 0.04));

        for (let a = 0; a < MAX; a++) {
            if (!alive[a]) continue;
            const [gx, gy, gz] = worldToGrid(px[a], py[a], pz[a]);
            const amp = Math.sqrt(psi_r[a]*psi_r[a]+psi_i[a]*psi_i[a]);
            const phase = Math.atan2(psi_i[a], psi_r[a]);
            const conn_w = 1 + conn_count[a] * 0.3;

            // Splash gaussiano alrededor del punto
            for (let dx=-splash; dx<=splash; dx++)
            for (let dy=-splash; dy<=splash; dy++)
            for (let dz=-splash; dz<=splash; dz++) {
                const nx = gx+dx, ny = gy+dy, nz = gz+dz;
                if (nx<0||nx>=N||ny<0||ny>=N||nz<0||nz>=N) continue;
                const r2 = dx*dx+dy*dy+dz*dz;
                const w = Math.exp(-r2/(splash*splash*0.5)) * amp * conn_w;
                const gi = gridIdx(nx, ny, nz);
                renderVolume[gi] += w;
                phase_sum[gi] += phase * w;
                phase_weight[gi] += w;
            }
        }

        // Normalizar y escribir fase
        let max_vol = 1e-10;
        for (let i = 0; i < T; i++) if (renderVolume[i] > max_vol) max_vol = renderVolume[i];
        for (let i = 0; i < T; i++) {
            renderVolume[i] /= max_vol;
            phaseData[i] = phase_weight[i] > 0
                ? phase_sum[i] / phase_weight[i] / (2*Math.PI) + 0.5
                : 0.5;
        }

        texture3D.needsUpdate = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function clearPoints() {
        alive.fill(0); n_alive = 0; generation = 0;
        px.fill(0); py.fill(0); pz.fill(0);
        vx.fill(0); vy.fill(0); vz.fill(0);
        psi_r.fill(0); psi_i.fill(0);
        age_p.fill(0); conn_count.fill(0);
    }

    function seedNube(n, amp) {
        // Nube aleatoria uniforme
        clearPoints();
        for (let k = 0; k < n; k++) {
            const phase = Math.random()*2*Math.PI;
            spawnPoint(
                (Math.random()-0.5)*1.8,
                (Math.random()-0.5)*1.8,
                (Math.random()-0.5)*1.8,
                amp*Math.cos(phase), amp*Math.sin(phase)
            );
        }
    }

    function seedClusters(n_clusters, points_per) {
        // Grupos de puntos en fase similar
        clearPoints();
        for (let c = 0; c < n_clusters; c++) {
            const cx = (Math.random()-0.5)*1.2;
            const cy = (Math.random()-0.5)*1.2;
            const cz = (Math.random()-0.5)*1.2;
            const phase = c * 2*Math.PI / n_clusters; // cada cluster su propia fase
            for (let k = 0; k < points_per; k++) {
                const r = 0.15;
                spawnPoint(
                    cx+(Math.random()-0.5)*r,
                    cy+(Math.random()-0.5)*r,
                    cz+(Math.random()-0.5)*r,
                    0.8*Math.cos(phase+(Math.random()-0.5)*0.3),
                    0.8*Math.sin(phase+(Math.random()-0.5)*0.3)
                );
            }
        }
    }

    function seedAnillo() {
        // Puntos dispuestos en un toro — ¿la red mantiene la geometría?
        clearPoints();
        const R=0.55, r=0.2, n=200;
        for (let k=0; k<n; k++) {
            const u = k/n*2*Math.PI;
            const v = Math.random()*2*Math.PI;
            const x = (R+r*Math.cos(v))*Math.cos(u);
            const y = (R+r*Math.cos(v))*Math.sin(u);
            const z = r*Math.sin(v);
            spawnPoint(x,y,z,
                0.7*Math.cos(u),
                0.7*Math.sin(u)
            );
        }
    }

    function seedColision() {
        // Dos clusters en trayectorias de colisión
        clearPoints();
        const n = 100;
        for (let k=0; k<n; k++) {
            const r=0.15;
            // Cluster A: izquierda, yendo a la derecha, fase 0
            spawnPoint(-0.7+(Math.random()-0.5)*r,
                       (Math.random()-0.5)*r,
                       (Math.random()-0.5)*r,
                       0.8, 0.1);
            const pa = spawnPoint(-0.7+(Math.random()-0.5)*r,
                       (Math.random()-0.5)*r,
                       (Math.random()-0.5)*r,
                       0.8, 0.1);
            if(pa>=0) vx[pa] = 0.008;

            // Cluster B: derecha, yendo a la izquierda, fase π
            const pb = spawnPoint(0.7+(Math.random()-0.5)*r,
                       (Math.random()-0.5)*r,
                       (Math.random()-0.5)*r,
                       -0.8, 0.0);
            if(pb>=0) vx[pb] = -0.008;
        }
    }

    function seedEspiral() {
        // Espiral helicoidal de puntos
        clearPoints();
        const n=300, turns=3;
        for (let k=0; k<n; k++) {
            const t = k/n;
            const angle = t*turns*2*Math.PI;
            const x = 0.6*Math.cos(angle);
            const y = 0.6*Math.sin(angle);
            const z = (t-0.5)*1.6;
            spawnPoint(x,y,z,
                0.7*Math.cos(angle),
                0.7*Math.sin(angle)
            );
        }
    }

    function initSeed(name) {
        if (name==='nube')           seedNube(400, 0.6);
        else if (name==='clusters')  seedClusters(6, 60);
        else if (name==='anillo')    seedAnillo();
        else if (name==='colision')  seedColision();
        else if (name==='espiral')   seedEspiral();
        else if (name==='ruido')     seedNube(600, 0.3);
        else                         seedClusters(6, 60);
        refresh();
    }

    initSeed('clusters');

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let total_conn=0, max_conn=0;
        let amp_total=0, amp_max=0;
        let phase_var=0, isolated=0;
        let total_speed=0;

        for (let a=0; a<MAX; a++) {
            if (!alive[a]) continue;
            const amp=Math.sqrt(psi_r[a]*psi_r[a]+psi_i[a]*psi_i[a]);
            amp_total+=amp; if(amp>amp_max) amp_max=amp;
            total_conn+=conn_count[a]; if(conn_count[a]>max_conn) max_conn=conn_count[a];
            if(conn_count[a]<P.ISOLATION) isolated++;
            const phase=Math.atan2(psi_i[a],psi_r[a]);
            phase_var+=phase*phase;
            total_speed+=Math.sqrt(vx[a]*vx[a]+vy[a]*vy[a]+vz[a]*vz[a]);
        }
        const na = Math.max(1, n_alive);

        return {
            E_total:   n_alive/P.MAX_POINTS,
            E_kin:     total_speed/na,
            E_torsion: total_conn/na,
            E_phase:   amp_total/na,
            helicity:  max_conn,
            boundary:  isolated/na,
            pump:      generation,
            u_max:     amp_max,
            th_max:    total_conn/na,
            phi_max:   amp_max,
            psiMax:    amp_max,
            coherence: 1-isolated/na,
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function injectPulso() {
        // Nuevo cluster en posición aleatoria
        const cx=(Math.random()-0.5)*1.2;
        const cy=(Math.random()-0.5)*1.2;
        const cz=(Math.random()-0.5)*1.2;
        const phase=Math.random()*2*Math.PI;
        for (let k=0;k<30;k++) {
            spawnPoint(
                cx+(Math.random()-0.5)*0.1,
                cy+(Math.random()-0.5)*0.1,
                cz+(Math.random()-0.5)*0.1,
                0.9*Math.cos(phase), 0.9*Math.sin(phase)
            );
        }
    }

    function injectExplosion() {
        // Dar velocidad radial a todos los puntos desde el centro
        for (let a=0;a<MAX;a++) {
            if (!alive[a]) continue;
            const r=Math.sqrt(px[a]*px[a]+py[a]*py[a]+pz[a]*pz[a])+1e-6;
            vx[a]+=px[a]/r*0.05;
            vy[a]+=py[a]/r*0.05;
            vz[a]+=pz[a]/r*0.05;
        }
    }

    function injectInversion() {
        // Invertir ψ de todos los puntos — contradicción global
        for (let a=0;a<MAX;a++) {
            if (!alive[a]) continue;
            psi_r[a]*=-1; psi_i[a]*=-1;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  API
    // ══════════════════════════════════════════════════════════
    return {
        step, refresh, getMetrics,
        getState() {
            const live = [];
            for (let a=0;a<MAX;a++) {
                if (alive[a]) live.push({
                    px:px[a],py:py[a],pz:pz[a],
                    psi_r:psi_r[a],psi_i:psi_i[a]
                });
            }
            return { points: live, generation };
        },
        loadState(s) {
            clearPoints();
            if (s.points) {
                for (const p of s.points) {
                    spawnPoint(p.px,p.py,p.pz,p.psi_r,p.psi_i);
                }
            }
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() {},
        applyParams(p) { Object.assign(P, p); },
        getParams() { return { ...P }; },
        initSeed, seed: initSeed,
        inject(name) {
            if (name==='pulso')         injectPulso();
            else if (name==='explosion') injectExplosion();
            else if (name==='inversion') injectInversion();
            refresh();
        },
        classifyState(m) {
            if (m.E_total < 0.05)      return 'vacuum';
            if (m.boundary > 0.5)      return 'active';
            if (m.E_torsion < 1)       return 'nucleating';
            if (m.coherence > 0.8)     return 'locked';
            if (m.E_kin > 0.02)        return 'pumping';
            if (m.coherence > 0.6)     return 'stable';
            return 'active';
        },
    };
}
