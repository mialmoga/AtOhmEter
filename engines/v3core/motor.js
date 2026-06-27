// ══════════════════════════════════════════════════════════════
//  AtOhmEter Core V3 — Motor Cosserat Bifásico
//  Port from coreV3Plot.py (Brujo + Éter + Velvet + Ámbar)
//
//  Campos:  u(3), u_v(3), θ(3), θ_v(3), φ, φ_prev
//  Integrador: Störmer-Verlet (segundo orden temporal)
//  El grumo no es semilla — es incompatibilidad entre fases.
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, params) {

    const T = N * N * N;

    // ── Parámetros con defaults ──────────────────────────────
    let P = {
        RHO:            params.RHO            ?? 1.0,
        J_INERTIA:      params.J_INERTIA      ?? 0.4,
        MU:             params.MU             ?? 1.5,
        GAMMA_T:        params.GAMMA_T        ?? 0.5,
        ALPHA_C:        params.ALPHA_C        ?? 2.0,
        LAMBDA_DW:      params.LAMBDA_DW      ?? 0.8,
        PHI0:           params.PHI0           ?? 1.0,
        SPIN_COUPLING:  params.SPIN_COUPLING  ?? 0.15,
        PUMP_GAIN:      params.PUMP_GAIN      ?? 0.08,
        DAMP_BULK:      params.DAMP_BULK      ?? 0.9998,
        DAMP_BORDER:    params.DAMP_BORDER    ?? 0.995,
        DX:             params.DX             ?? 0.1,
        DT:             params.DT             ?? 0.008,
        THRESH:         params.THRESH         ?? 0.05,
    };

    const DX2 = P.DX * P.DX;
    const inv2dx = 1.0 / (2 * P.DX);

    // ── Campos Cosserat ──────────────────────────────────────
    // Desplazamiento u (3 componentes)
    const ux = new Float64Array(T);
    const uy = new Float64Array(T);
    const uz = new Float64Array(T);
    // Velocidad de u
    const ux_v = new Float64Array(T);
    const uy_v = new Float64Array(T);
    const uz_v = new Float64Array(T);
    // Torsión θ (3 componentes)
    const thx = new Float64Array(T);
    const thy = new Float64Array(T);
    const thz = new Float64Array(T);
    // Velocidad angular de θ
    const thx_v = new Float64Array(T);
    const thy_v = new Float64Array(T);
    const thz_v = new Float64Array(T);
    // Parámetro de orden bifásico φ
    const phi     = new Float64Array(T);
    const phi_prev = new Float64Array(T);

    // Temporales para fuerzas y derivadas
    const tmp1 = new Float64Array(T);
    const tmp2 = new Float64Array(T);
    const tmp3 = new Float64Array(T);

    // ── Índice 3D → 1D ──────────────────────────────────────
    function idx(x, y, z) {
        return ((x + N) % N) * N * N + ((y + N) % N) * N + ((z + N) % N);
    }

    // ── Laplaciano escalar ───────────────────────────────────
    function lap_scalar(F, out) {
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            out[i] = (
                F[idx(x+1,y,z)] + F[idx(x-1,y,z)] +
                F[idx(x,y+1,z)] + F[idx(x,y-1,z)] +
                F[idx(x,y,z+1)] + F[idx(x,y,z-1)] - 6 * F[i]
            ) / DX2;
        }
    }

    // ── Curl de (Ax, Ay, Az) → (cx, cy, cz) ─────────────────
    function curl3(Ax, Ay, Az, cx, cy, cz) {
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            // curl_x = dAz/dy - dAy/dz
            cx[i] = (Az[idx(x,y+1,z)] - Az[idx(x,y-1,z)]) * inv2dx
                   - (Ay[idx(x,y,z+1)] - Ay[idx(x,y,z-1)]) * inv2dx;
            // curl_y = dAx/dz - dAz/dx
            cy[i] = (Ax[idx(x,y,z+1)] - Ax[idx(x,y,z-1)]) * inv2dx
                   - (Az[idx(x+1,y,z)] - Az[idx(x-1,y,z)]) * inv2dx;
            // curl_z = dAy/dx - dAx/dy
            cz[i] = (Ay[idx(x+1,y,z)] - Ay[idx(x-1,y,z)]) * inv2dx
                   - (Ax[idx(x,y+1,z)] - Ax[idx(x,y-1,z)]) * inv2dx;
        }
    }

    // Temporales para curls
    const curl_th_x = new Float64Array(T);
    const curl_th_y = new Float64Array(T);
    const curl_th_z = new Float64Array(T);
    const curl_u_x  = new Float64Array(T);
    const curl_u_y  = new Float64Array(T);
    const curl_u_z  = new Float64Array(T);

    // Laplacianos
    const lap_ux = new Float64Array(T);
    const lap_uy = new Float64Array(T);
    const lap_uz = new Float64Array(T);
    const lap_thx = new Float64Array(T);
    const lap_thy = new Float64Array(T);
    const lap_thz = new Float64Array(T);
    const lap_phi_arr = new Float64Array(T);

    // Gradientes de φ
    const gphi_x = new Float64Array(T);
    const gphi_y = new Float64Array(T);
    const gphi_z = new Float64Array(T);

    // ── Gradiente escalar ────────────────────────────────────
    function grad_scalar(F, gx, gy, gz) {
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            gx[i] = (F[idx(x+1,y,z)] - F[idx(x-1,y,z)]) * inv2dx;
            gy[i] = (F[idx(x,y+1,z)] - F[idx(x,y-1,z)]) * inv2dx;
            gz[i] = (F[idx(x,y,z+1)] - F[idx(x,y,z-1)]) * inv2dx;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function initGrumo() {
        // φ = tanh(X/w) · tanh(Y/w) · tanh(Z/w) → 8 octantes
        const w = 0.06;
        const c = N >> 1;
        const r = Math.max(2, N >> 3); // radio más grande para ser visible

        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            const fx = (2 * x / (N - 1)) - 1; // -1..+1
            const fy = (2 * y / (N - 1)) - 1;
            const fz = (2 * z / (N - 1)) - 1;
            phi[i] = Math.tanh(fx / w) * Math.tanh(fy / w) * Math.tanh(fz / w);
            phi_prev[i] = phi[i];

            // Ruido mínimo para romper simetría
            phi[i] += (Math.random() - 0.5) * 0.01;

            // u arranca con un empujón radial desde el centro
            const dx = x - c, dy = y - c, dz = z - c;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) + 1e-6;
            const kick = 0.3 * Math.exp(-dist * 0.1);
            ux[i] = kick * dx / dist;
            uy[i] = kick * dy / dist;
            uz[i] = kick * dz / dist;
            ux_v[i] = kick * 2.0 * dx / dist;  // velocidad inicial también
            uy_v[i] = kick * 2.0 * dy / dist;
            uz_v[i] = kick * 2.0 * dz / dist;
            thx_v[i] = 0; thy_v[i] = 0; thz_v[i] = 0;

            // Torsión ortogonal en el centro
            if (Math.abs(dx) <= r && Math.abs(dy) <= r && Math.abs(dz) <= r) {
                thx[i] = Math.PI / 2;
                thy[i] = -Math.PI / 2;
                thz[i] = Math.PI / 3;
            } else {
                thx[i] = 0; thy[i] = 0; thz[i] = 0;
            }
            // Ruido en θ
            thx[i] += (Math.random() - 0.5) * 0.02;
            thy[i] += (Math.random() - 0.5) * 0.02;
            thz[i] += (Math.random() - 0.5) * 0.02;
        }
    }

    function initVacio() {
        for (let i = 0; i < T; i++) {
            ux[i] = 0; uy[i] = 0; uz[i] = 0;
            ux_v[i] = 0; uy_v[i] = 0; uz_v[i] = 0;
            thx[i] = 0; thy[i] = 0; thz[i] = 0;
            thx_v[i] = 0; thy_v[i] = 0; thz_v[i] = 0;
            phi[i] = (Math.random() - 0.5) * 0.01;
            phi_prev[i] = phi[i];
        }
    }

    function initRuido(amp) {
        for (let i = 0; i < T; i++) {
            ux[i] = (Math.random() - 0.5) * amp;
            uy[i] = (Math.random() - 0.5) * amp;
            uz[i] = (Math.random() - 0.5) * amp;
            ux_v[i] = 0; uy_v[i] = 0; uz_v[i] = 0;
            thx[i] = (Math.random() - 0.5) * amp * 0.5;
            thy[i] = (Math.random() - 0.5) * amp * 0.5;
            thz[i] = (Math.random() - 0.5) * amp * 0.5;
            thx_v[i] = 0; thy_v[i] = 0; thz_v[i] = 0;
            phi[i] = (Math.random() - 0.5) * 0.1;
            phi_prev[i] = phi[i];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  PASO DE EVOLUCIÓN — Cosserat + Doble Pozo + Verlet
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;
        const dt2 = dt * dt;

        // Derivadas
        curl3(thx, thy, thz, curl_th_x, curl_th_y, curl_th_z);
        curl3(ux, uy, uz, curl_u_x, curl_u_y, curl_u_z);
        lap_scalar(ux, lap_ux);
        lap_scalar(uy, lap_uy);
        lap_scalar(uz, lap_uz);
        lap_scalar(thx, lap_thx);
        lap_scalar(thy, lap_thy);
        lap_scalar(thz, lap_thz);
        lap_scalar(phi, lap_phi_arr);
        grad_scalar(phi, gphi_x, gphi_y, gphi_z);

        // Magnitud de θ para damping adaptativo
        let th_mag_max = 0;
        for (let i = 0; i < T; i++) {
            const m = Math.sqrt(thx[i]*thx[i] + thy[i]*thy[i] + thz[i]*thz[i]);
            tmp1[i] = m; // th_mag
            if (m > th_mag_max) th_mag_max = m;
        }
        const th_mag_inv = 1.0 / (th_mag_max + 1e-10);

        // Magnitud |∇φ|
        for (let i = 0; i < T; i++) {
            tmp2[i] = Math.sqrt(gphi_x[i]*gphi_x[i] + gphi_y[i]*gphi_y[i] + gphi_z[i]*gphi_z[i]);
        }

        for (let i = 0; i < T; i++) {
            const th_mag_i = tmp1[i];
            const grad_phi_mag_i = tmp2[i];

            // ── Fuerzas sobre u ──────────────────────────────
            // Cosserat: μ·∇²u + 2α·∇×θ + PUMP_GAIN·∇φ·|∇φ|
            const f_ux = P.MU * lap_ux[i] + 2*P.ALPHA_C * curl_th_x[i]
                       + P.PUMP_GAIN * gphi_x[i] * grad_phi_mag_i;
            const f_uy = P.MU * lap_uy[i] + 2*P.ALPHA_C * curl_th_y[i]
                       + P.PUMP_GAIN * gphi_y[i] * grad_phi_mag_i;
            const f_uz = P.MU * lap_uz[i] + 2*P.ALPHA_C * curl_th_z[i]
                       + P.PUMP_GAIN * gphi_z[i] * grad_phi_mag_i;

            // ── Fuerzas sobre θ ──────────────────────────────
            // Cosserat: γ·∇²θ + 2α·(∇×u − 2θ) + spin_coupling·∇φ·|θ|
            const f_thx = P.GAMMA_T * lap_thx[i] + 2*P.ALPHA_C * (curl_u_x[i] - 2*thx[i])
                        + P.SPIN_COUPLING * gphi_x[i] * th_mag_i;
            const f_thy = P.GAMMA_T * lap_thy[i] + 2*P.ALPHA_C * (curl_u_y[i] - 2*thy[i])
                        + P.SPIN_COUPLING * gphi_y[i] * th_mag_i;
            const f_thz = P.GAMMA_T * lap_thz[i] + 2*P.ALPHA_C * (curl_u_z[i] - 2*thz[i])
                        + P.SPIN_COUPLING * gphi_z[i] * th_mag_i;

            // ── Integración velocidad ────────────────────────
            ux_v[i] += (f_ux / P.RHO) * dt;
            uy_v[i] += (f_uy / P.RHO) * dt;
            uz_v[i] += (f_uz / P.RHO) * dt;
            thx_v[i] += (f_thx / P.J_INERTIA) * dt;
            thy_v[i] += (f_thy / P.J_INERTIA) * dt;
            thz_v[i] += (f_thz / P.J_INERTIA) * dt;

            // ── Damping adaptativo ───────────────────────────
            const t_norm = Math.min(1, th_mag_i * th_mag_inv);
            const local_damp = P.DAMP_BORDER + (P.DAMP_BULK - P.DAMP_BORDER) * t_norm;
            ux_v[i] *= local_damp;
            uy_v[i] *= local_damp;
            uz_v[i] *= local_damp;
            thx_v[i] *= local_damp;
            thy_v[i] *= local_damp;
            thz_v[i] *= local_damp;

            // ── Integración posición ─────────────────────────
            ux[i] += ux_v[i] * dt;
            uy[i] += uy_v[i] * dt;
            uz[i] += uz_v[i] * dt;
            thx[i] += thx_v[i] * dt;
            thy[i] += thy_v[i] * dt;
            thz[i] += thz_v[i] * dt;
        }

        // ── Evolución de φ (Störmer-Verlet) ──────────────────
        // Necesitamos spin y pumping — segundo pase
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            const p = phi[i];

            // Potencial doble pozo: -dV/dφ = -4λφ(φ²−1)
            const dV = -4 * P.LAMBDA_DW * p * (p * p - P.PHI0 * P.PHI0);

            // Spin emergente (pseudoescalar de rotación del gradiente)
            const gx0 = gphi_x[i], gy0 = gphi_y[i], gz0 = gphi_z[i];
            const gx_yp = gphi_x[idx(x,y+1,z)];
            const gy_xp = gphi_y[idx(x+1,y,z)];
            const gy_zp = gphi_y[idx(x,y,z+1)];
            const gz_yp = gphi_z[idx(x,y+1,z)];
            const gz_xp = gphi_z[idx(x+1,y,z)];
            const gx_zp = gphi_x[idx(x,y,z+1)];
            const spin = (gx_yp * gy0 - gy_xp * gx0)
                       + (gy_zp * gz0 - gz_yp * gy0)
                       + (gz_xp * gx0 - gx_zp * gz0);

            // Pumping desde fronteras de fase
            const domain_e = tmp2[i]; // |∇φ|
            const pumping = P.PUMP_GAIN * domain_e * Math.tanh(p);

            // Divergencia de θ → acoplamiento φ ↔ torsión
            const div_th = (thx[idx(x+1,y,z)] - thx[idx(x-1,y,z)]
                          + thy[idx(x,y+1,z)] - thy[idx(x,y-1,z)]
                          + thz[idx(x,y,z+1)] - thz[idx(x,y,z-1)]) * inv2dx;

            // Aceleración total de φ
            const phi_acc = P.MU * lap_phi_arr[i] + dV
                          + P.SPIN_COUPLING * spin + pumping
                          + P.ALPHA_C * 0.5 * div_th;

            // Störmer-Verlet: φ_next = 2φ − φ_prev + dt²·acc
            let phi_next = 2 * p - phi_prev[i] + dt2 * phi_acc;

            // Damping leve
            phi_next -= 0.002 * (phi_next - p);

            phi_prev[i] = p;
            phi[i] = phi_next;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — llenar texturas de render
    // ══════════════════════════════════════════════════════════
    function refresh() {
        // renderVolume: combinación visual de los tres campos
        //   - |∇φ| → fronteras de fase (la estructura más visible)
        //   - |θ|  → torsión interna
        //   - |u|  → onda acústica
        // phaseData: φ mapeado a 0..1 para colorear bifásico

        // Primero calcular |∇φ| para las fronteras
        grad_scalar(phi, gphi_x, gphi_y, gphi_z);

        for (let i = 0; i < T; i++) {
            const u_mag = Math.sqrt(ux[i]*ux[i] + uy[i]*uy[i] + uz[i]*uz[i]);
            const th_mag = Math.sqrt(thx[i]*thx[i] + thy[i]*thy[i] + thz[i]*thz[i]);
            const grad_phi_mag = Math.sqrt(gphi_x[i]*gphi_x[i] + gphi_y[i]*gphi_y[i] + gphi_z[i]*gphi_z[i]);

            // Fronteras de fase son la estructura dominante visual
            // + torsión como estructura secundaria
            // + desplazamiento como onda propagándose
            renderVolume[i] = grad_phi_mag * 0.08 + th_mag * 0.5 + u_mag * 2.0;

            // Fase: φ mapeado a 0..1 para el shader
            phaseData[i] = phi[i] * 0.5 + 0.5;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  OBSERVABLES
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let E_kin_u = 0, E_kin_th = 0, E_torsion = 0, E_phase = 0;
        let helic = 0, u_max = 0, th_max = 0, phi_max = 0;
        let boundary_count = 0;
        let pump_sum = 0, pump_count = 0;

        curl3(thx, thy, thz, curl_th_x, curl_th_y, curl_th_z);

        const c = N >> 1;
        const r = Math.max(1, N >> 3);

        for (let i = 0; i < T; i++) {
            // Energía cinética
            E_kin_u += ux_v[i]*ux_v[i] + uy_v[i]*uy_v[i] + uz_v[i]*uz_v[i];
            E_kin_th += thx_v[i]*thx_v[i] + thy_v[i]*thy_v[i] + thz_v[i]*thz_v[i];
            // Energía torsional
            E_torsion += thx[i]*thx[i] + thy[i]*thy[i] + thz[i]*thz[i];
            // Energía de fase
            const p2 = phi[i] * phi[i];
            E_phase += (p2 - P.PHI0*P.PHI0) * (p2 - P.PHI0*P.PHI0);
            // Helicidad
            helic += thx[i]*curl_th_x[i] + thy[i]*curl_th_y[i] + thz[i]*curl_th_z[i];
            // Máximos
            const um = Math.sqrt(ux[i]*ux[i] + uy[i]*uy[i] + uz[i]*uz[i]);
            const tm = Math.sqrt(thx[i]*thx[i] + thy[i]*thy[i] + thz[i]*thz[i]);
            if (um > u_max) u_max = um;
            if (tm > th_max) th_max = tm;
            const ap = Math.abs(phi[i]);
            if (ap > phi_max) phi_max = ap;
            // Frontera
            if (ap < 0.5) boundary_count++;
        }

        // Bombeo: velocidad media de φ en centro
        for (let x = c-r; x < c+r; x++)
        for (let y = c-r; y < c+r; y++)
        for (let z = c-r; z < c+r; z++) {
            const i = idx(x, y, z);
            pump_sum += (phi[i] - phi_prev[i]);
            pump_count++;
        }

        E_kin_u  = 0.5 * P.RHO * E_kin_u / T;
        E_kin_th = 0.5 * P.J_INERTIA * E_kin_th / T;
        E_torsion = 0.5 * P.GAMMA_T * E_torsion / T;
        E_phase = P.LAMBDA_DW * E_phase / T;

        // Mode overlap — ¿el campo sigue siendo el mismo objeto?
        let ov = 0, na = 0, nb = 0;
        for (let i = 0; i < T; i++) {
            ov += phi[i] * phi_seed[i];
            na += phi[i] * phi[i];
            nb += phi_seed[i] * phi_seed[i];
        }
        const mode_overlap = Math.abs(ov / (Math.sqrt(na * nb) + 1e-12));

        return {
            E_total:   E_kin_u + E_kin_th + E_torsion + E_phase,
            E_kin:     E_kin_u + E_kin_th,
            E_torsion,
            E_phase,
            helicity:  helic / T,
            boundary:  boundary_count / T,
            pump:      pump_count > 0 ? pump_sum / (pump_count * P.DT) : 0,
            u_max,
            th_max,
            phi_max,
            psiMax:    u_max,
            vortices:  0,
            coherence: mode_overlap,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function injectPerturbation() {
        const c = N >> 1;
        const r = Math.max(3, N >> 2);
        for (let x = c-r; x <= c+r; x++)
        for (let y = c-r; y <= c+r; y++)
        for (let z = c-r; z <= c+r; z++) {
            const i = idx(x, y, z);
            thx[i] += (Math.random() - 0.5) * 2.0;
            thy[i] += (Math.random() - 0.5) * 2.0;
            thz[i] += (Math.random() - 0.5) * 2.0;
            // También dar velocidad a u para efecto inmediato
            ux_v[i] += (Math.random() - 0.5) * 0.5;
            uy_v[i] += (Math.random() - 0.5) * 0.5;
            uz_v[i] += (Math.random() - 0.5) * 0.5;
        }
    }

    function injectPhaseFlip() {
        // Invertir φ en una esfera — crear nuevo defecto
        const c = N >> 1;
        const r = Math.max(3, N >> 3);
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const dx = x-c, dy = y-c, dz = z-c;
            if (dx*dx + dy*dy + dz*dz < r*r) {
                const i = idx(x, y, z);
                phi[i] *= -1;
                phi_prev[i] *= -1;
                // Inyectar torsión en la nueva frontera
                thx[i] += (Math.random() - 0.5) * 1.0;
                thy[i] += (Math.random() - 0.5) * 1.0;
            }
        }
    }

    function injectWave() {
        // Pulso de desplazamiento radial fuerte
        const c = N >> 1;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const dx = x-c, dy = y-c, dz = z-c;
            const r = Math.sqrt(dx*dx + dy*dy + dz*dz) + 1e-6;
            const amp = 1.0 * Math.exp(-r * 0.1);
            const i = idx(x, y, z);
            ux_v[i] += amp * dx / r;
            uy_v[i] += amp * dy / r;
            uz_v[i] += amp * dz / r;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  INIT según semilla
    // ══════════════════════════════════════════════════════════
    function initSeed(name) {
        if (name === 'grumo')           initGrumo();
        else if (name === 'vacio')      initVacio();
        else if (name === 'ruido')      initRuido(0.1);
        else if (name === 'dirichlet_l0') { seedBessel('dirichlet', 0); }
        else if (name === 'dirichlet_l1') { seedBessel('dirichlet', 1); }
        else if (name === 'neumann_q0')   { seedBessel('neumann', 0); }
        else if (name === 'neumann_q1')   { seedBessel('neumann', 1); }
        else if (name === 'tau_torus')    { seedTorus(); }
        else                            initGrumo();
        refresh();
    }

    // Inicializar con semilla por defecto
    initSeed(params._seed || 'grumo');

    // ── Semilla de referencia para mode overlap ──────────────
    const phi_seed = new Float64Array(phi); // copia del estado inicial

    // ── Semillas Bessel (sin tocar la física) ────────────────
    function seedBessel(bc, l) {
        // Limpiar campos dinámicos — solo geometría en φ y θ
        ux.fill(0); uy.fill(0); uz.fill(0);
        ux_v.fill(0); uy_v.fill(0); uz_v.fill(0);
        thx_v.fill(0); thy_v.fill(0); thz_v.fill(0);

        const c = N >> 1;
        const root = bc === 'dirichlet'
            ? Math.PI * (l + 1)       // j0 nodes at nπ
            : (l + 0.5) * Math.PI;    // Neumann: cos-based

        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            const fx = (x - c) / (c - 1);
            const fy = (y - c) / (c - 1);
            const fz = (z - c) / (c - 1);
            const r = Math.sqrt(fx*fx + fy*fy + fz*fz);

            if (r > 1.0) {
                phi[i] = 0;
            } else if (bc === 'dirichlet') {
                phi[i] = r < 1e-8 ? 1.0 : Math.sin(root * r) / (root * r);
            } else {
                phi[i] = Math.cos(root * r) * Math.exp(-r * r * 1.5);
            }
            phi_prev[i] = phi[i];

            // θ desde el gradiente de φ — solo geometría, sin energía extra
            if (r > 0.01 && r < 1.0) {
                thx[i] = -(fx / r) * phi[i] * 0.3;
                thy[i] = -(fy / r) * phi[i] * 0.3;
                thz[i] = -(fz / r) * phi[i] * 0.3;
            } else {
                thx[i] = 0; thy[i] = 0; thz[i] = 0;
            }
        }
        phi_seed.set(phi);
    }

    function seedTorus() {
        ux.fill(0); uy.fill(0); uz.fill(0);
        ux_v.fill(0); uy_v.fill(0); uz_v.fill(0);
        thx_v.fill(0); thy_v.fill(0); thz_v.fill(0);
        const c = N >> 1;
        const R0 = 0.45, r0 = 0.18;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            const fx = (x-c)/(c-1), fy = (y-c)/(c-1), fz = (z-c)/(c-1);
            const rxy = Math.sqrt(fx*fx + fy*fy);
            const rt = Math.sqrt((rxy-R0)*(rxy-R0) + fz*fz);
            phi[i] = Math.exp(-(rt/r0)*(rt/r0)) * 2 - 1;
            phi_prev[i] = phi[i];
            const angle = Math.atan2(fy, fx);
            thx[i] = -Math.sin(angle) * Math.abs(phi[i]) * 0.4;
            thy[i] =  Math.cos(angle) * Math.abs(phi[i]) * 0.4;
            thz[i] = 0.2 * phi[i];
        }
        phi_seed.set(phi);
    }

    // ══════════════════════════════════════════════════════════
    //  API PÚBLICA
    // ══════════════════════════════════════════════════════════
    return {
        step,
        refresh,
        getMetrics,
        getState() {
            return {
                ux: new Float32Array(ux),
                uy: new Float32Array(uy),
                uz: new Float32Array(uz),
                thx: new Float32Array(thx),
                thy: new Float32Array(thy),
                thz: new Float32Array(thz),
                phi: new Float32Array(phi),
            };
        },
        loadState(s) {
            if (s.ux)  ux.set(s.ux);
            if (s.uy)  uy.set(s.uy);
            if (s.uz)  uz.set(s.uz);
            if (s.thx) thx.set(s.thx);
            if (s.thy) thy.set(s.thy);
            if (s.thz) thz.set(s.thz);
            if (s.phi) { phi.set(s.phi); phi_prev.set(s.phi); }
            // Compat con baker v3 (fields.u_x etc)
            if (s.u_x) ux.set(s.u_x);
            if (s.u_y) uy.set(s.u_y);
            if (s.u_z) uz.set(s.u_z);
            if (s.th_x) thx.set(s.th_x);
            if (s.th_y) thy.set(s.th_y);
            if (s.th_z) thz.set(s.th_z);
            refresh();
        },
        setState(s) { this.loadState(s); },
        savePrev() { /* Verlet usa phi_prev internamente */ },
        applyParams(p) { Object.assign(P, p); },
        getParams() { return { ...P }; },
        initSeed,
        seed: initSeed,

        inject(name) {
            if (name === 'perturbacion')  injectPerturbation();
            else if (name === 'fase_flip') injectPhaseFlip();
            else if (name === 'onda')     injectWave();
            refresh();
        },

        classifyState(m) {
            if (m.phi_max > 10 || m.u_max > 10) return 'collapse';
            if (m.pump && Math.abs(m.pump) > 0.5) return 'pumping';
            if (m.E_total > 2 || m.boundary > 0.15) return 'active';
            if (m.E_torsion > 0.5) return 'torsion';
            if (m.E_total > 0.1) return 'nucleating';
            return 'vacuum';
        },
    };
}
