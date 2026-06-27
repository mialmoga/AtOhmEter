// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor AGUA
//  Fluido Incompresible — Método de Stam "Stable Fluids" (1999)
//
//  Física:
//    1. Fuerzas externas (gravedad + turbulencia + touch)
//    2. Advección semi-Lagrangiana (el fluido se arrastra a sí mismo)
//    3. Difusión (viscosidad)
//    4. Proyección (solver de Poisson → incompresibilidad)
//
//  Campos:
//    ux, uy, uz   — velocidad del fluido (3 componentes)
//    density      — tinte/densidad para visualización
//    light        — intensidad de luz acumulada desde arriba
//    pressure     — campo de presión (buffer del solver)
//    divergence   — buffer temporal para proyección
//
//  Touch: inyecta velocidad en el punto de intersección →
//         como meter la mano en el agua.
//
//  Ámbar — 2026 🦝
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    // ── Parámetros ───────────────────────────────────────────
    let P = {
        VISCOSIDAD:   0.0001, // amortiguamiento — 0=agua, 1=miel
        GRAVEDAD:     0.04,   // fuerza hacia -Y
        TURBULENCIA:  0.15,   // ruido de fuerza continuo
        LUZ_INT:      1.2,    // intensidad del rayo entrante
        LUZ_ANGULO:   0.0,    // 0=vertical, 1=diagonal
        THRESH:       0.04,   // umbral de visibilidad
        DT:           0.15,   // timestep
        ITER:         16,     // iteraciones del solver de Poisson
    };

    // ── Campos de velocidad ───────────────────────────────────
    const ux  = new Float32Array(T);
    const uy  = new Float32Array(T);
    const uz  = new Float32Array(T);
    // Buffers dobles para advección
    const ux2 = new Float32Array(T);
    const uy2 = new Float32Array(T);
    const uz2 = new Float32Array(T);

    // ── Campo de densidad (tinte visual) ─────────────────────
    const density  = new Float32Array(T);
    const density2 = new Float32Array(T);

    // ── Campos del solver de presión ─────────────────────────
    const pressure   = new Float32Array(T);
    const pressure2  = new Float32Array(T);
    const divergence = new Float32Array(T);

    // ── Campo de luz acumulada ────────────────────────────────
    const light = new Float32Array(T);

    // ── Utilidades ────────────────────────────────────────────
    function idx(x, y, z) {
        return ((x + N) % N) * N * N + ((y + N) % N) * N + ((z + N) % N);
    }

    // Condiciones de frontera: paredes sólidas en Y (suelo y techo)
    // X y Z son periódicas
    function boundaryY(F, scale) {
        for (let x = 0; x < N; x++)
        for (let z = 0; z < N; z++) {
            F[idx(x, 0,   z)] = scale * F[idx(x, 1,     z)];
            F[idx(x, N-1, z)] = scale * F[idx(x, N-2,   z)];
        }
    }

    function boundaryX(F, scale) {
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            F[idx(0,   y, z)] = scale * F[idx(1,     y, z)];
            F[idx(N-1, y, z)] = scale * F[idx(N-2,   y, z)];
        }
    }

    function boundaryZ(F, scale) {
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++) {
            F[idx(x, y, 0  )] = scale * F[idx(x, y, 1    )];
            F[idx(x, y, N-1)] = scale * F[idx(x, y, N-2  )];
        }
    }

    function setBoundary(F, bType) {
        // bType: 0=escalar, 1=vx, 2=vy, 3=vz
        const sx = bType === 1 ? -1 : 1;
        const sy = bType === 2 ? -1 : 1;
        const sz = bType === 3 ? -1 : 1;
        boundaryX(F, sx);
        boundaryY(F, sy);
        boundaryZ(F, sz);
    }

    // ── 1. DIFUSIÓN (Gauss-Seidel) ────────────────────────────
    function diffuse(F, F0, diff, bType) {
        const a = P.DT * diff * (N - 2) * (N - 2);
        const c = 1.0 + 6.0 * a;
        for (let k = 0; k < P.ITER; k++) {
            for (let x = 1; x < N-1; x++)
            for (let y = 1; y < N-1; y++)
            for (let z = 1; z < N-1; z++) {
                const i = idx(x, y, z);
                F[i] = (F0[i] + a * (
                    F[idx(x+1,y,z)] + F[idx(x-1,y,z)] +
                    F[idx(x,y+1,z)] + F[idx(x,y-1,z)] +
                    F[idx(x,y,z+1)] + F[idx(x,y,z-1)]
                )) / c;
            }
            setBoundary(F, bType);
        }
    }

    // ── 2. ADVECCIÓN semi-Lagrangiana ─────────────────────────
    // Traza el rayo hacia atrás: dónde estaba este voxel hace DT?
    function advect(F, F0, vx, vy, vz, bType) {
        const dt0 = P.DT * (N - 2);
        for (let x = 1; x < N-1; x++)
        for (let y = 1; y < N-1; y++)
        for (let z = 1; z < N-1; z++) {
            const i = idx(x, y, z);
            // Posición hacia atrás
            let px = x - dt0 * vx[i];
            let py = y - dt0 * vy[i];
            let pz = z - dt0 * vz[i];

            // Clamp a los bordes
            px = Math.max(0.5, Math.min(N - 1.5, px));
            py = Math.max(0.5, Math.min(N - 1.5, py));
            pz = Math.max(0.5, Math.min(N - 1.5, pz));

            // Interpolación trilineal
            const x0 = Math.floor(px), x1 = x0 + 1;
            const y0 = Math.floor(py), y1 = y0 + 1;
            const z0 = Math.floor(pz), z1 = z0 + 1;
            const sx = px - x0, sy = py - y0, sz = pz - z0;

            F[i] =
                (1-sx)*((1-sy)*((1-sz)*F0[idx(x0,y0,z0)] + sz*F0[idx(x0,y0,z1)]) +
                           sy *((1-sz)*F0[idx(x0,y1,z0)] + sz*F0[idx(x0,y1,z1)])) +
                   sx *((1-sy)*((1-sz)*F0[idx(x1,y0,z0)] + sz*F0[idx(x1,y0,z1)]) +
                           sy *((1-sz)*F0[idx(x1,y1,z0)] + sz*F0[idx(x1,y1,z1)]));
        }
        setBoundary(F, bType);
    }

    // ── 3. PROYECCIÓN (incompresibilidad) ────────────────────
    // Elimina la parte compresible del campo de velocidad.
    // Resuelve: ∇²p = ∇·u  →  u = u - ∇p
    function project(vx, vy, vz) {
        const h = 1.0 / (N - 2);

        // Calcular divergencia
        for (let x = 1; x < N-1; x++)
        for (let y = 1; y < N-1; y++)
        for (let z = 1; z < N-1; z++) {
            const i = idx(x, y, z);
            divergence[i] = -0.5 * h * (
                vx[idx(x+1,y,z)] - vx[idx(x-1,y,z)] +
                vy[idx(x,y+1,z)] - vy[idx(x,y-1,z)] +
                vz[idx(x,y,z+1)] - vz[idx(x,y,z-1)]
            );
            pressure[i] = 0.0;
        }
        setBoundary(divergence, 0);
        setBoundary(pressure, 0);

        // Resolver Poisson para la presión
        for (let k = 0; k < P.ITER; k++) {
            for (let x = 1; x < N-1; x++)
            for (let y = 1; y < N-1; y++)
            for (let z = 1; z < N-1; z++) {
                const i = idx(x, y, z);
                pressure[i] = (divergence[i] + (
                    pressure[idx(x+1,y,z)] + pressure[idx(x-1,y,z)] +
                    pressure[idx(x,y+1,z)] + pressure[idx(x,y-1,z)] +
                    pressure[idx(x,y,z+1)] + pressure[idx(x,y,z-1)]
                )) / 6.0;
            }
            setBoundary(pressure, 0);
        }

        // Restar gradiente de presión a la velocidad
        for (let x = 1; x < N-1; x++)
        for (let y = 1; y < N-1; y++)
        for (let z = 1; z < N-1; z++) {
            const i = idx(x, y, z);
            vx[i] -= 0.5 * (pressure[idx(x+1,y,z)] - pressure[idx(x-1,y,z)]) / h;
            vy[i] -= 0.5 * (pressure[idx(x,y+1,z)] - pressure[idx(x,y-1,z)]) / h;
            vz[i] -= 0.5 * (pressure[idx(x,y,z+1)] - pressure[idx(x,y,z-1)]) / h;
        }
        setBoundary(vx, 1);
        setBoundary(vy, 2);
        setBoundary(vz, 3);
    }

    // ── 4. FUERZAS EXTERNAS ───────────────────────────────────
    function applyForces() {
        const grav  = P.GRAVEDAD * P.DT;
        const turb  = P.TURBULENCIA;
        const t     = Date.now() * 0.001;

        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);

            // Gravedad — hacia -Y
            uy[i] -= grav;

            // Turbulencia — ruido coherente por espacio y tiempo
            // Usa senos para evitar Math.random() que no es coherente
            if (turb > 0.001) {
                const nx = Math.sin(x * 0.7 + t * 1.1) * Math.cos(z * 0.9 + t * 0.7);
                const ny = Math.sin(y * 0.8 + t * 0.9) * Math.cos(x * 1.1 + t * 1.3);
                const nz = Math.cos(z * 0.6 + t * 1.2) * Math.sin(y * 0.7 + t * 0.8);
                ux[i] += nx * turb * P.DT * 0.3;
                uy[i] += ny * turb * P.DT * 0.15;
                uz[i] += nz * turb * P.DT * 0.3;
            }

            // Amortiguamiento global (viscosidad efectiva)
            const damp = 1.0 - P.VISCOSIDAD * P.DT * 10.0;
            ux[i] *= damp;
            uy[i] *= damp;
            uz[i] *= damp;

            // Clamp de velocidad para estabilidad
            const vmax = 8.0;
            ux[i] = Math.max(-vmax, Math.min(vmax, ux[i]));
            uy[i] = Math.max(-vmax, Math.min(vmax, uy[i]));
            uz[i] = Math.max(-vmax, Math.min(vmax, uz[i]));
        }
    }

    // ── 5. PROPAGACIÓN DE LUZ ─────────────────────────────────
    // Rayo de luz descendiendo desde Y=N-1 hacia Y=0
    // Se dispersa (scattering) según la densidad local del fluido
    function propagateLight() {
        const angulo = P.LUZ_ANGULO;
        const intensidad = P.LUZ_INT;

        light.fill(0);

        for (let x = 1; x < N-1; x++)
        for (let z = 1; z < N-1; z++) {
            let lux = intensidad;
            for (let y = N-2; y >= 1; y--) {
                const i = idx(x, y, z);
                const d = density[i];

                // Scattering: la luz se dispersa en función de la densidad
                // Más denso = más scattering = más visible pero menos transmisión
                const scatter = d * 0.6;
                light[i] = lux * scatter;

                // Absorción — la luz se atenúa al pasar por el fluido
                lux *= Math.max(0.0, 1.0 - d * 0.25);

                // Desplazamiento lateral del rayo según ángulo
                if (angulo > 0.01) {
                    const shift = Math.round(angulo * 2.0);
                    if (y > 1) {
                        // Contribuir al voxel desplazado lateralmente
                        const xi = Math.max(1, Math.min(N-2, x + shift));
                        light[idx(xi, y-1, z)] += lux * 0.3 * angulo;
                    }
                }
            }
        }
    }

    // ── STEP ─────────────────────────────────────────────────
    function step() {
        // 1. Fuerzas externas
        applyForces();

        // 2. Velocidad: difusión → proyección → advección → proyección
        if (P.VISCOSIDAD > 0.00001) {
            ux2.set(ux); uy2.set(uy); uz2.set(uz);
            diffuse(ux, ux2, P.VISCOSIDAD, 1);
            diffuse(uy, uy2, P.VISCOSIDAD, 2);
            diffuse(uz, uz2, P.VISCOSIDAD, 3);
        }
        project(ux, uy, uz);

        ux2.set(ux); uy2.set(uy); uz2.set(uz);
        advect(ux, ux2, ux2, uy2, uz2, 1);
        advect(uy, uy2, ux2, uy2, uz2, 2);
        advect(uz, uz2, ux2, uy2, uz2, 3);
        project(ux, uy, uz);

        // 3. Densidad: difusión → advección
        density2.set(density);
        diffuse(density, density2, 0.00005, 0);
        density2.set(density);
        advect(density, density2, ux, uy, uz, 0);

        // 4. Luz
        propagateLight();
    }

    // ── REFRESH ───────────────────────────────────────────────
    // renderVolume: densidad del fluido modulada por luz
    // phaseData:    velocidad local → color (azul=lento, cian=rápido)
    function refresh() {
        let maxSpeed = 0.001;
        let maxDens  = 0.001;

        for (let i = 0; i < T; i++) {
            const speed = Math.sqrt(ux[i]*ux[i] + uy[i]*uy[i] + uz[i]*uz[i]);
            if (speed  > maxSpeed) maxSpeed = speed;
            if (density[i] > maxDens) maxDens = density[i];
        }

        for (let i = 0; i < T; i++) {
            const d = density[i];
            const l = light[i];
            const speed = Math.sqrt(ux[i]*ux[i] + uy[i]*uy[i] + uz[i]*uz[i]);

            // Volumen: densidad base + contribución de la luz (el rayo se hace visible)
            renderVolume[i] = Math.min(1.0,
                (d / maxDens) * 0.7 +
                l * 0.6
            );

            // Phase: velocidad normalizada → rueda de color
            // 0.0 = muy lento (azul profundo)
            // 0.5 = velocidad media (cian/verde)
            // 1.0 = muy rápido (blanco/amarillo)
            const speedNorm = speed / maxSpeed;
            // Añadir componente de dirección: uy negativo (cayendo) → fase baja
            const dirBias = (uy[i] < 0) ? speedNorm * 0.3 : speedNorm * 0.6;
            phaseData[i] = Math.min(0.99, Math.max(0.0, dirBias + l * 0.25));
        }

        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ── SEMILLAS ──────────────────────────────────────────────
    function clearAll() {
        ux.fill(0); uy.fill(0); uz.fill(0);
        ux2.fill(0); uy2.fill(0); uz2.fill(0);
        density.fill(0); density2.fill(0);
        pressure.fill(0); divergence.fill(0);
        light.fill(0);
    }

    function fillDensity(amount) {
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            // Gradiente vertical: más denso abajo (como agua real)
            const yNorm = y / (N - 1);
            density[i] = amount * (0.6 + 0.4 * (1.0 - yNorm));
        }
    }

    function seedReposo() {
        clearAll();
        fillDensity(0.8);
        // Pequeña perturbación inicial para que arranque
        const c = N >> 1;
        for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
            uy[idx(c+dx, c, c+dz)] = 0.5;
        }
    }

    function seedOla() {
        clearAll();
        fillDensity(0.85);
        // Impulso horizontal — una ola desde un lado
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const strength = Math.sin(y / N * Math.PI); // más fuerte en el centro
            ux[idx(1, y, z)] = 3.0 * strength;
        }
    }

    function seedVortice() {
        clearAll();
        fillDensity(0.75);
        // Campo de velocidad rotacional en el plano XZ
        const c = N >> 1;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            const dx = x - c, dz = z - c;
            const r = Math.sqrt(dx*dx + dz*dz) + 0.1;
            const strength = Math.exp(-r*r / (N*0.15));
            // Rotación en XZ + espiral vertical
            ux[i] =  dz / r * strength * 2.5;
            uz[i] = -dx / r * strength * 2.5;
            uy[i] = strength * 0.5; // componente vertical sube en el centro
        }
    }

    function seedLluvia() {
        clearAll();
        // Sin densidad inicial — las gotas caen desde arriba
        // La densidad se inyecta continuamente en el step
        // Aquí solo inicializamos con gotitas en la capa superior
        for (let x = 1; x < N-1; x++)
        for (let z = 1; z < N-1; z++) {
            if (Math.random() < 0.3) {
                density[idx(x, N-2, z)] = 1.0;
                uy[idx(x, N-2, z)] = -1.0; // caen hacia abajo
            }
        }
    }

    const seedFns = { reposo: seedReposo, ola: seedOla, vortice: seedVortice, lluvia: seedLluvia };

    function initSeed(name) {
        const fn = seedFns[name] || seedReposo;
        fn();
        refresh();
    }

    initSeed('reposo');

    // ── MÉTRICAS ──────────────────────────────────────────────
    function getMetrics() {
        let totalDens = 0, totalSpeed = 0, maxSpeed = 0;
        let totalLight = 0, turbCount = 0;

        for (let i = 0; i < T; i++) {
            totalDens += density[i];
            const speed = Math.sqrt(ux[i]*ux[i] + uy[i]*uy[i] + uz[i]*uz[i]);
            totalSpeed += speed;
            if (speed > maxSpeed) maxSpeed = speed;
            totalLight += light[i];
            if (speed > 0.5) turbCount++;
        }

        const E_total   = totalDens  / T;
        const E_kin     = totalSpeed / T;
        const E_torsion = totalLight / T;
        const E_phase   = turbCount  / T;

        return {
            E_total,
            E_kin,
            E_torsion,
            E_phase,
            helicity:  maxSpeed,
            boundary:  E_total,
            pump:      E_kin > 0.5 ? 1 : 0,
            u_max:     maxSpeed,
            th_max:    E_torsion,
            phi_max:   E_total,
            psiMax:    maxSpeed,
            coherence: E_total,
            vortices:  turbCount,
        };
    }

    // ── INYECCIONES ───────────────────────────────────────────
    function injectTouch(pos) {
        if (!pos) return;
        const tx = Math.round((pos.x * 0.5 + 0.5) * (N - 1));
        const ty = Math.round((pos.y * 0.5 + 0.5) * (N - 1));
        const tz = Math.round((pos.z * 0.5 + 0.5) * (N - 1));
        const r  = Math.max(1, Math.floor(N * 0.1));
        const strength = 3.0;

        for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
            if (dx*dx+dy*dy+dz*dz > r*r) continue;
            const i = idx(tx+dx, ty+dy, tz+dz);
            // Impulso radial desde el punto de toque
            const len = Math.sqrt(dx*dx+dy*dy+dz*dz) + 0.01;
            ux[i] += (dx/len) * strength;
            uy[i] += (dy/len) * strength;
            uz[i] += (dz/len) * strength;
            // También añadir densidad — la mano desplaza el fluido
            density[i] = Math.min(1.0, density[i] + 0.3);
        }
    }

    function injectPulso() {
        // Pulso central — explosión de velocidad radial
        const c = N >> 1;
        const r = Math.max(2, N >> 3);
        for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
            if (dx*dx+dy*dy+dz*dz > r*r) continue;
            const i = idx(c+dx, c+dy, c+dz);
            const len = Math.sqrt(dx*dx+dy*dy+dz*dz) + 0.01;
            ux[i] += (dx/len) * 5.0;
            uy[i] += (dy/len) * 5.0;
            uz[i] += (dz/len) * 5.0;
            density[i] = Math.min(1.0, density[i] + 0.5);
        }
    }

    function injectCalma() {
        // Disipar velocidad gradualmente
        for (let i = 0; i < T; i++) {
            ux[i] *= 0.1;
            uy[i] *= 0.1;
            uz[i] *= 0.1;
        }
    }

    function injectLluvia() {
        // Añadir gotitas desde arriba continuamente
        for (let x = 1; x < N-1; x++)
        for (let z = 1; z < N-1; z++) {
            if (Math.random() < 0.08) {
                const i = idx(x, N-2, z);
                density[i] = Math.min(1.0, density[i] + 0.8);
                uy[i] -= 1.5;
            }
        }
    }

    // ── CLASSIFYSTATE ─────────────────────────────────────────
    function classifyState(m) {
        if (m.E_kin   > 2.0)  return 'active';
        if (m.E_kin   > 0.8)  return 'pumping';
        if (m.E_kin   > 0.2)  return 'stable';
        if (m.E_total > 0.1)  return 'nucleating';
        return 'vacuum';
    }

    // ── API ───────────────────────────────────────────────────
    return {
        step,
        refresh,
        getMetrics,
        classifyState,
        savePrev() {},
        applyParams(p) { Object.assign(P, p); },
        getParams()    { return { ...P }; },
        seed:   initSeed,
        inject(name, data) {
            if      (name === 'touch')  injectTouch(data);
            else if (name === 'pulso')  injectPulso();
            else if (name === 'calma')  injectCalma();
            else if (name === 'lluvia') injectLluvia();
            else if (name === 'reposo') seedReposo();
            else if (name === 'ola')    seedOla();
            else if (name === 'vortice')seedVortice();
        },
        getState() {
            return {
                ux: new Float32Array(ux), uy: new Float32Array(uy), uz: new Float32Array(uz),
                density: new Float32Array(density),
            };
        },
        setState(s) {
            if (s.ux)      ux.set(s.ux);
            if (s.uy)      uy.set(s.uy);
            if (s.uz)      uz.set(s.uz);
            if (s.density) density.set(s.density);
            refresh();
        },
    };
}
