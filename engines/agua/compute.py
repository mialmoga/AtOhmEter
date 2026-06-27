"""
AtOhmEter — engines/agua/compute.py
Stable Fluids (Stam 1999) — implementación NumPy

Interface requerida por server.py:
    createEngine(N, render_volume, phase_data) → dict con:
        step()
        refresh()
        seed(name)
        inject(name, data=None)
        applyParams(params)
"""

import numpy as np

def createEngine(N, render_volume, phase_data):
    T = N * N * N

    # ── Parámetros ───────────────────────────────────────────
    P = {
        'VISCOSIDAD':   0.0001,
        'GRAVEDAD':     0.04,
        'TURBULENCIA':  0.15,
        'LUZ_INT':      1.2,
        'LUZ_ANGULO':   0.0,
        'THRESH':       0.04,
        'DT':           0.15,
        'ITER':         16,
    }

    # ── Campos ───────────────────────────────────────────────
    ux = np.zeros((N, N, N), dtype=np.float32)
    uy = np.zeros((N, N, N), dtype=np.float32)
    uz = np.zeros((N, N, N), dtype=np.float32)
    density = np.zeros((N, N, N), dtype=np.float32)
    light   = np.zeros((N, N, N), dtype=np.float32)

    frame_count = [0]

    # ── Condiciones de frontera ───────────────────────────────
    def set_boundary(F, b_type):
        # b_type: 0=escalar, 1=vx, 2=vy, 3=vz
        sx = -1 if b_type == 1 else 1
        sy = -1 if b_type == 2 else 1
        sz = -1 if b_type == 3 else 1
        F[0,  :, :]  = sx * F[1,  :, :]
        F[-1, :, :]  = sx * F[-2, :, :]
        F[:,  0, :]  = sy * F[:,  1, :]
        F[:, -1, :]  = sy * F[:, -2, :]
        F[:, :,  0]  = sz * F[:, :,  1]
        F[:, :, -1]  = sz * F[:, :, -2]

    # ── Difusión (Gauss-Seidel) ───────────────────────────────
    def diffuse(F, F0, diff, b_type):
        a = P['DT'] * diff * (N - 2) ** 2
        c = 1.0 + 6.0 * a
        F[:] = F0
        for _ in range(P['ITER']):
            F[1:-1, 1:-1, 1:-1] = (
                F0[1:-1, 1:-1, 1:-1] + a * (
                    F[2:,  1:-1, 1:-1] + F[:-2, 1:-1, 1:-1] +
                    F[1:-1, 2:,  1:-1] + F[1:-1, :-2, 1:-1] +
                    F[1:-1, 1:-1, 2: ] + F[1:-1, 1:-1, :-2]
                )
            ) / c
            set_boundary(F, b_type)

    # ── Advección semi-Lagrangiana ────────────────────────────
    def advect(F, F0, vx, vy, vz, b_type):
        dt0 = P['DT'] * (N - 2)
        # Coordenadas de la grilla
        ix = np.arange(N)
        x_grid, y_grid, z_grid = np.meshgrid(ix, ix, ix, indexing='ij')

        # Posición hacia atrás
        px = (x_grid - dt0 * vx).clip(0.5, N - 1.5)
        py = (y_grid - dt0 * vy).clip(0.5, N - 1.5)
        pz = (z_grid - dt0 * vz).clip(0.5, N - 1.5)

        x0 = px.astype(np.int32); x1 = (x0 + 1).clip(0, N-1)
        y0 = py.astype(np.int32); y1 = (y0 + 1).clip(0, N-1)
        z0 = pz.astype(np.int32); z1 = (z0 + 1).clip(0, N-1)

        sx = px - x0; sy = py - y0; sz = pz - z0

        # Interpolación trilineal vectorizada
        F[:] = (
            (1-sx) * ((1-sy) * ((1-sz)*F0[x0,y0,z0] + sz*F0[x0,y0,z1]) +
                          sy  * ((1-sz)*F0[x0,y1,z0] + sz*F0[x0,y1,z1])) +
               sx  * ((1-sy) * ((1-sz)*F0[x1,y0,z0] + sz*F0[x1,y0,z1]) +
                          sy  * ((1-sz)*F0[x1,y1,z0] + sz*F0[x1,y1,z1]))
        )
        set_boundary(F, b_type)

    # ── Proyección (incompresibilidad) ────────────────────────
    def project(vx, vy, vz):
        h = 1.0 / (N - 2)
        div = np.zeros((N, N, N), dtype=np.float32)
        p   = np.zeros((N, N, N), dtype=np.float32)

        div[1:-1,1:-1,1:-1] = -0.5 * h * (
            vx[2:, 1:-1, 1:-1] - vx[:-2, 1:-1, 1:-1] +
            vy[1:-1, 2:, 1:-1] - vy[1:-1, :-2, 1:-1] +
            vz[1:-1, 1:-1, 2:] - vz[1:-1, 1:-1, :-2]
        )
        set_boundary(div, 0)

        for _ in range(P['ITER']):
            p[1:-1,1:-1,1:-1] = (
                div[1:-1,1:-1,1:-1] + (
                    p[2:, 1:-1, 1:-1] + p[:-2, 1:-1, 1:-1] +
                    p[1:-1, 2:, 1:-1] + p[1:-1, :-2, 1:-1] +
                    p[1:-1, 1:-1, 2:] + p[1:-1, 1:-1, :-2]
                )
            ) / 6.0
            set_boundary(p, 0)

        ih = 0.5 / h
        vx[1:-1,1:-1,1:-1] -= ih * (p[2:, 1:-1,1:-1] - p[:-2,1:-1,1:-1])
        vy[1:-1,1:-1,1:-1] -= ih * (p[1:-1,2:,1:-1]  - p[1:-1,:-2,1:-1])
        vz[1:-1,1:-1,1:-1] -= ih * (p[1:-1,1:-1,2:]  - p[1:-1,1:-1,:-2])
        set_boundary(vx, 1); set_boundary(vy, 2); set_boundary(vz, 3)

    # ── Fuerzas externas ──────────────────────────────────────
    def apply_forces():
        t   = frame_count[0] * P['DT']
        dt  = P['DT']
        g   = P['GRAVEDAD'] * dt
        trb = P['TURBULENCIA']

        uy[:] -= g

        if trb > 0.001:
            x = np.arange(N).reshape(N, 1, 1)
            y = np.arange(N).reshape(1, N, 1)
            z = np.arange(N).reshape(1, 1, N)
            ux[:] += np.sin(x*0.7 + t*1.1) * np.cos(z*0.9 + t*0.7) * trb * dt * 0.3
            uy[:] += np.sin(y*0.8 + t*0.9) * np.cos(x*1.1 + t*1.3) * trb * dt * 0.15
            uz[:] += np.cos(z*0.6 + t*1.2) * np.sin(y*0.7 + t*0.8) * trb * dt * 0.3

        damp = 1.0 - P['VISCOSIDAD'] * dt * 10.0
        ux[:] *= damp; uy[:] *= damp; uz[:] *= damp

        np.clip(ux, -8.0, 8.0, out=ux)
        np.clip(uy, -8.0, 8.0, out=uy)
        np.clip(uz, -8.0, 8.0, out=uz)

    # ── Luz descendente ───────────────────────────────────────
    def propagate_light():
        light[:] = 0.0
        lux = np.full((N, N), P['LUZ_INT'], dtype=np.float32)
        for y in range(N-2, 0, -1):
            d = density[:, y, :]
            scatter = d * 0.6
            light[:, y, :] = lux * scatter
            lux *= np.maximum(0.0, 1.0 - d * 0.25)

    # ── STEP ─────────────────────────────────────────────────
    def step():
        apply_forces()

        # Velocidad
        ux0 = ux.copy(); uy0 = uy.copy(); uz0 = uz.copy()
        if P['VISCOSIDAD'] > 1e-5:
            diffuse(ux, ux0, P['VISCOSIDAD'], 1)
            diffuse(uy, uy0, P['VISCOSIDAD'], 2)
            diffuse(uz, uz0, P['VISCOSIDAD'], 3)
        project(ux, uy, uz)

        ux0[:] = ux; uy0[:] = uy; uz0[:] = uz
        advect(ux, ux0, ux0, uy0, uz0, 1)
        advect(uy, uy0, ux0, uy0, uz0, 2)
        advect(uz, uz0, ux0, uy0, uz0, 3)
        project(ux, uy, uz)

        # Densidad
        d0 = density.copy()
        diffuse(density, d0, 0.00005, 0)
        d0[:] = density
        advect(density, d0, ux, uy, uz, 0)

        propagate_light()
        frame_count[0] += 1

    # ── REFRESH ───────────────────────────────────────────────
    def refresh():
        max_d = max(density.max(), 0.001)
        max_l = max(light.max(),   0.001)

        speed = np.sqrt(ux**2 + uy**2 + uz**2)
        max_s = max(speed.max(), 0.001)

        vol = np.clip(density / max_d * 0.7 + light / max_l * 0.4, 0, 1)
        ph  = np.clip(speed / max_s * 0.6 + light / max_l * 0.25,  0, 1)

        render_volume[:] = vol.ravel()
        phase_data[:]    = ph.ravel()

    # ── SEMILLAS ──────────────────────────────────────────────
    def _clear():
        ux[:]=0; uy[:]=0; uz[:]=0
        density[:]=0; light[:]=0

    def _fill_density(amount):
        y_idx = np.arange(N).reshape(1, N, 1)
        y_norm = y_idx / (N - 1)
        density[:] = amount * (0.6 + 0.4 * (1.0 - y_norm))

    def seed_reposo():
        _clear(); _fill_density(0.8)
        c = N // 2
        uy[c-2:c+2, c, c-2:c+2] = 0.5

    def seed_ola():
        _clear(); _fill_density(0.85)
        y = np.arange(N)
        strength = np.sin(y / N * np.pi)
        ux[1, :, :] = 3.0 * strength.reshape(N, 1)

    def seed_vortice():
        _clear(); _fill_density(0.75)
        c = N // 2
        x = np.arange(N).reshape(N, 1, 1) - c
        z = np.arange(N).reshape(1, 1, N) - c
        r = np.sqrt(x**2 + z**2) + 0.1
        s = np.exp(-r**2 / (N * 0.15))
        ux[:] =  z / r * s * 2.5
        uz[:] = -x / r * s * 2.5
        uy[:] = s * 0.5

    def seed_lluvia():
        _clear()
        mask = np.random.random((N, N)) < 0.3
        density[:, N-2, :][mask] = 1.0
        uy[:, N-2, :][mask] = -1.5

    _seeds = {
        'reposo':  seed_reposo,
        'ola':     seed_ola,
        'vortice': seed_vortice,
        'lluvia':  seed_lluvia,
    }

    def seed(name):
        fn = _seeds.get(name, seed_reposo)
        fn()
        refresh()

    # ── INYECCIONES ───────────────────────────────────────────
    def inject(name, data=None):
        if name == 'pulso':
            c = N // 2; r = max(2, N // 8)
            x = np.arange(N).reshape(N,1,1) - c
            y = np.arange(N).reshape(1,N,1) - c
            z = np.arange(N).reshape(1,1,N) - c
            dist = np.sqrt(x**2 + y**2 + z**2) + 0.01
            mask = dist <= r
            ux[mask] += (x / dist)[mask] * 5.0
            uy[mask] += (y / dist)[mask] * 5.0
            uz[mask] += (z / dist)[mask] * 5.0
            density[mask] = np.minimum(1.0, density[mask] + 0.5)

        elif name == 'lluvia':
            mask = np.random.random((N, N)) < 0.08
            density[:, N-2, :][mask] = np.minimum(
                1.0, density[:, N-2, :][mask] + 0.8)
            uy[:, N-2, :][mask] -= 1.5

        elif name == 'calma':
            ux[:] *= 0.1; uy[:] *= 0.1; uz[:] *= 0.1

        elif name == 'touch' and data:
            tx = int((data.get('x', 0) * 0.5 + 0.5) * (N-1))
            ty = int((data.get('y', 0) * 0.5 + 0.5) * (N-1))
            tz = int((data.get('z', 0) * 0.5 + 0.5) * (N-1))
            r  = max(1, N // 10)
            x  = np.arange(N).reshape(N,1,1) - tx
            y  = np.arange(N).reshape(1,N,1) - ty
            z  = np.arange(N).reshape(1,1,N) - tz
            dist = np.sqrt(x**2 + y**2 + z**2) + 0.01
            mask = dist <= r
            ux[mask] += (x / dist)[mask] * 3.0
            uy[mask] += (y / dist)[mask] * 3.0
            uz[mask] += (z / dist)[mask] * 3.0
            density[mask] = np.minimum(1.0, density[mask] + 0.3)

        refresh()

    def apply_params(params):
        for k, v in params.items():
            if k in P:
                P[k] = float(v)

    # Inicializar con semilla por defecto
    seed_reposo()
    refresh()

    return {
        'step':         step,
        'refresh':      refresh,
        'seed':         seed,
        'inject':       inject,
        'applyParams':  apply_params,
    }
