"""
AtOhmEter — engines/cristal/compute.py
Cristalización Emergente — NumPy vectorizado

Optimización clave: los kernels de vecindad por mineral se precalculan
como arrays 3D y la propagación usa scipy.ndimage.convolve en lugar
de loops por voxel — de O(N³·r³) a O(N³·log N).
"""

import numpy as np
try:
    from scipy.ndimage import convolve
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

def createEngine(N, render_volume, phase_data):
    T = N * N * N

    # ── Parámetros ───────────────────────────────────────────
    P = {
        'TEMPERATURA':    25.0,
        'HUMEDAD':        80.0,
        'TENSION_SUP':    0.6,
        'VEL_NUCLEACION': 0.7,
        'IMPUREZAS':      0.25,
        'MINERAL':        0,
        'HEAT_DIFF':      0.08,
        'HEAT_LOSS':      0.002,
        'DT':             0.016,
        'THRESH':         0.05,
    }

    # ── Campos ───────────────────────────────────────────────
    crystal = np.zeros((N,N,N), dtype=np.float32)
    liquid  = np.zeros((N,N,N), dtype=np.float32)
    heat    = np.zeros((N,N,N), dtype=np.float32)

    # ── Precalcular kernels de vecindad por mineral ───────────
    # Cada kernel es un array 3D de pesos que define la anisotropía
    # del frente de cristalización para cada mineral.
    # Se usa convolución en lugar de loops por voxel.

    def build_kernel(mineral, radius):
        size = 2*radius + 1
        k = np.zeros((size, size, size), dtype=np.float32)
        for dx in range(-radius, radius+1):
            for dy in range(-radius, radius+1):
                for dz in range(-radius, radius+1):
                    if dx==0 and dy==0 and dz==0:
                        continue
                    ax=abs(dx); ay=abs(dy); az=abs(dz)
                    r2=dx*dx+dy*dy+dz*dz
                    if r2==0: continue

                    if mineral==0:  # HIELO — hexagonal en XZ, dendrítico
                        angle = np.arctan2(dz, dx)
                        hex_  = abs(np.cos(angle * 3.0))
                        dendrite = hex_*hex_
                        plane = max(0.0, 1.0 - ay*0.4)
                        w = max(0.0, dendrite*plane/r2)
                    elif mineral==1:  # BISMUTO — hopper, esquinas
                        isCorner = 1.2 if ((ax>0 and ay>0) or (ay>0 and az>0) or (ax>0 and az>0)) else 0.6
                        w = isCorner / r2
                    elif mineral==2:  # CUARZO — prismático, eje Y
                        angle = np.arctan2(dz, dx)
                        hex_  = abs(np.cos(angle * 3.0))
                        prism = hex_*0.8 + ay*1.4
                        w = max(0.0, prism/r2)
                    elif mineral==3:  # SAL — cúbico, solo ortogonales
                        w = 1.0 if (ax+ay+az==1) else 0.0
                    else:
                        w = 1.0/r2

                    k[dx+radius, dy+radius, dz+radius] = w

        # Normalizar
        total = k.sum()
        if total > 0:
            k /= total
        return k

    # Precalcular kernels para r=1 y r=2
    _kernels = {}
    for m in range(4):
        _kernels[(m, 1)] = build_kernel(m, 1)
        _kernels[(m, 2)] = build_kernel(m, 2)

    # Ruido de impurezas determinista — precalculado
    x_idx = np.arange(N).reshape(N,1,1)
    y_idx = np.arange(N).reshape(1,N,1)
    z_idx = np.arange(N).reshape(1,1,N)
    _noise_base = (np.sin(x_idx*127.1 + y_idx*311.7 + z_idx*74.7)*0.5+0.5).astype(np.float32)

    # ── Convolución con fallback manual si no hay scipy ───────
    def convolve_crystal(C, kernel):
        if HAS_SCIPY:
            return convolve(C, kernel, mode='wrap')
        else:
            # Fallback: convolución manual con np.roll
            # Solo para kernels de radio 1
            r = kernel.shape[0] // 2
            result = np.zeros_like(C)
            for dx in range(-r, r+1):
                for dy in range(-r, r+1):
                    for dz in range(-r, r+1):
                        w = kernel[dx+r, dy+r, dz+r]
                        if w > 0:
                            result += w * np.roll(np.roll(np.roll(C, -dx, 0), -dy, 1), -dz, 2)
            return result

    # ── Difusión de calor ─────────────────────────────────────
    def diffuse_heat():
        diff = P['HEAT_DIFF'] * P['DT']
        lap  = (np.roll(heat,-1,0)+np.roll(heat,1,0)+
                np.roll(heat,-1,1)+np.roll(heat,1,1)+
                np.roll(heat,-1,2)+np.roll(heat,1,2) - 6*heat)
        conductivity = 1.0 - crystal * 0.4
        new_heat = heat + diff * lap * conductivity
        new_heat -= P['HEAT_LOSS'] * (new_heat - P['TEMPERATURA']/100.0) * P['DT']
        heat[:] = np.clip(new_heat, 0.0, 1.0)

    # ── Propagación del frente de cristalización ──────────────
    def propagate_crystal():
        mineral   = int(P['MINERAL']) % 4
        temp_crit = P['TEMPERATURA'] / 100.0
        vel_nuc   = P['VEL_NUCLEACION'] * P['DT'] * 20.0
        impurity  = P['IMPUREZAS']
        radius    = 2 if P['TENSION_SUP'] > 0.5 else 1

        # Suma ponderada de cristal en vecindad — una sola convolución
        kernel = _kernels[(mineral, radius)]
        crystal_neighbor = convolve_crystal(crystal, kernel)

        # Condiciones para cristalización
        supercool = np.maximum(0.0, temp_crit - heat) / max(temp_crit, 1e-8)
        noise     = _noise_base * impurity
        rate      = vel_nuc * supercool * (crystal_neighbor + noise * 0.1)

        # Máscaras
        can_crystallize = (liquid > 0.01) & (heat < temp_crit * 0.95)
        can_melt        = (heat > temp_crit * 1.1) & (crystal > 0)

        # Cristalización
        delta = np.minimum(liquid, rate) * can_crystallize
        crystal[:] = np.minimum(1.0, crystal + delta)
        liquid[:]  = np.maximum(0.0, liquid  - delta)
        heat[:]    = np.minimum(1.0, heat    + delta * 0.3)  # calor latente

        # Fusión
        melt = np.minimum(crystal, (heat - temp_crit) * P['DT'] * 2.0) * can_melt
        crystal[:] = np.maximum(0.0, crystal - melt)
        liquid[:]  = np.minimum(1.0, liquid  + melt)
        heat[:]    = np.maximum(0.0, heat    - melt * 0.2)   # endotérmica

    # ── STEP — 4 substeps como en el JS ──────────────────────
    def step():
        for _ in range(4):
            diffuse_heat()
            propagate_crystal()

    # ── REFRESH ───────────────────────────────────────────────
    def refresh():
        mineral_phase = [0.50, 0.74, 0.62, 0.86]  # hielo, bismuto, cuarzo, sal
        cp = mineral_phase[int(P['MINERAL']) % 4]

        vol = crystal * 0.9 + liquid * 0.4

        # Phase codificada por estado
        ph = np.where(
            crystal < 0.05,
            heat * 0.45,
            np.where(
                crystal > 0.95,
                cp,
                crystal * cp + (1-crystal) * heat * 0.45
            )
        )

        render_volume[:] = np.clip(vol, 0, 1).ravel()
        phase_data[:]    = np.clip(ph,  0, 1).ravel()

    # ── SEMILLAS ──────────────────────────────────────────────
    def clear_fields():
        crystal[:]=0; liquid[:]=0; heat[:]=0

    def fill_liquid():
        humedad = P['HUMEDAD'] / 100.0
        mask = np.random.rand(N,N,N) < humedad
        liquid[:] = np.where(mask, 0.8 + np.random.rand(N,N,N)*0.2, 0.0)
        heat[:]   = P['TEMPERATURA']/100.0 + (np.random.rand(N,N,N)-0.5)*0.05
        heat[:]   = np.clip(heat, 0, 1)

    def seed_nuclei(count):
        xs = np.random.randint(0, N, count)
        ys = np.random.randint(0, N, count)
        zs = np.random.randint(0, N, count)
        crystal[xs, ys, zs] = 1.0
        liquid[xs,  ys, zs] = 0.0
        heat[xs,    ys, zs] = 0.0

    def seed_hielo():
        clear_fields(); fill_liquid()
        P['MINERAL'] = 0
        seed_nuclei(6)
        heat[:] *= 0.3

    def seed_bismuto():
        clear_fields(); fill_liquid()
        P['MINERAL'] = 1
        c = N//2
        crystal[c-1:c+2, c-1:c+2, c-1:c+2] = 1.0
        liquid[c-1:c+2,  c-1:c+2, c-1:c+2] = 0.0
        heat[c-1:c+2,    c-1:c+2, c-1:c+2] = 0.0
        heat[:] *= 0.5

    def seed_cuarzo():
        clear_fields(); fill_liquid()
        P['MINERAL'] = 2
        mask_base = np.random.rand(N, N) < 0.3
        xs, zs = np.where(mask_base)
        crystal[xs, 0, zs] = 1.0
        liquid[xs,  0, zs] = 0.0
        heat[xs,    0, zs] = 0.0
        y_idx = np.arange(N).reshape(1,N,1)
        heat[:] = (y_idx/(N-1)) * (P['TEMPERATURA']/100.0)

    def seed_sal():
        clear_fields(); fill_liquid()
        P['MINERAL'] = 3
        step_s = max(3, N//5)
        xs = np.arange(0, N, step_s)
        ys = np.arange(0, N, step_s)
        zs = np.arange(0, N, step_s)
        xx, yy, zz = np.meshgrid(xs, ys, zs, indexing='ij')
        crystal[xx, yy, zz] = 1.0
        liquid[xx,  yy, zz] = 0.0
        heat[xx,    yy, zz] = 0.0
        heat[:] *= 0.4

    _seeds = {
        'hielo':   seed_hielo,
        'bismuto': seed_bismuto,
        'cuarzo':  seed_cuarzo,
        'sal':     seed_sal,
    }

    def seed(name):
        fn = _seeds.get(name.lower(), seed_hielo)
        fn()
        refresh()

    # ── INYECCIONES ───────────────────────────────────────────
    def inject(name, data=None):
        if name == 'touch' and data:
            tx = int((data.get('x',0)*0.5+0.5)*(N-1))
            ty = int((data.get('y',0)*0.5+0.5)*(N-1))
            tz = int((data.get('z',0)*0.5+0.5)*(N-1))
            r  = max(1, int(N*0.08))
            x_idx = np.arange(N).reshape(N,1,1)
            y_idx = np.arange(N).reshape(1,N,1)
            z_idx = np.arange(N).reshape(1,1,N)
            mask = (x_idx-tx)**2+(y_idx-ty)**2+(z_idx-tz)**2 <= r**2
            crystal[:] = np.where(mask, np.minimum(1.0, crystal+0.8), crystal)
            liquid[:]  = np.where(mask, np.maximum(0.0, liquid-0.8),  liquid)
            heat[:]    = np.where(mask, 0.0, heat)

        elif name == 'pulso':
            c = N//2; r = max(2, N//4)
            x_idx = np.arange(N).reshape(N,1,1)
            y_idx = np.arange(N).reshape(1,N,1)
            z_idx = np.arange(N).reshape(1,1,N)
            mask = (x_idx-c)**2+(y_idx-c)**2+(z_idx-c)**2 <= r**2
            crystal[:] = np.where(mask, 1.0, crystal)
            liquid[:]  = np.where(mask, 0.0, liquid)
            heat[:]    = np.where(mask, 0.0, heat)

        elif name == 'calma':
            heat[:] = np.minimum(1.0, heat + 0.5)
            melt_mask = heat > P['TEMPERATURA']/100.0 * 1.2
            liquid[:] = np.where(melt_mask, np.minimum(1.0, liquid+crystal), liquid)
            crystal[:] = np.where(melt_mask, 0.0, crystal)

        elif name in ('hielo','bismuto','cuarzo','sal'):
            _seeds[name]()

        refresh()

    def get_metrics():
        frac = float(crystal.mean())
        nuclei = int((crystal > 0.9).sum())
        return {
            'E_total':   frac,
            'E_kin':     float(liquid.mean()),
            'E_torsion': float(heat.mean()),
            'E_phase':   nuclei / T,
            'helicity':  float(crystal.max()),
            'boundary':  frac,
            'pump':      1 if frac > 0.8 else 0,
            'u_max':     float(crystal.max()),
            'th_max':    float(heat.mean()),
            'phi_max':   float(crystal.max()),
            'psiMax':    float(crystal.max()),
            'coherence': frac,
            'vortices':  nuclei,
        }

    def classify_state(m):
        if m['E_total'] > 0.85: return 'locked'
        if m['E_total'] > 0.5:  return 'pumping'
        if m['E_total'] > 0.15: return 'active'
        if m['E_total'] > 0.01: return 'nucleating'
        return 'vacuum'

    def apply_params(params):
        for k, v in params.items():
            P[k] = float(v) if k != 'MINERAL' else int(float(v)) % 4

    seed_hielo()
    refresh()

    return {
        'step':          step,
        'refresh':       refresh,
        'seed':          seed,
        'inject':        inject,
        'applyParams':   apply_params,
        'getMetrics':    get_metrics,
        'classifyState': classify_state,
    }
