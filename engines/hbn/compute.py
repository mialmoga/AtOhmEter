"""
AtOhmEter — engines/hbn/compute.py
Polaritones Fonón-Fotón en hBN — NumPy vectorizado

Campos: E (EM escalar), Q (fonónico), dE, dQ (velocidades)
Integrador: Verlet con clamp y normalización periódica
"""

import numpy as np
import time

def createEngine(N, render_volume, phase_data):
    T = N * N * N

    # ── Parámetros ───────────────────────────────────────────
    P = {
        'FREQ':         0.35,
        'ACOPLAMIENTO': 0.4,
        'AMORT':        0.012,
        'ANISO':        2.8,
        'C_EFF':        0.5,
        'DT':           0.18,
        'THRESH':       0.03,
    }

    # ── Campos ───────────────────────────────────────────────
    E  = np.zeros((N,N,N), dtype=np.float32)
    Q  = np.zeros((N,N,N), dtype=np.float32)
    dE = np.zeros((N,N,N), dtype=np.float32)
    dQ = np.zeros((N,N,N), dtype=np.float32)

    sources = []   # lista de dicts {x,y,z,freq,strength,phase}
    frame   = [0]

    # ── Laplaciano anisótropo ─────────────────────────────────
    # L(E) = ∂²E/∂x² − ANISO·∂²E/∂y² + ∂²E/∂z²
    # El signo negativo en Y crea la hiperbolicidad
    def lap_aniso(F):
        dx2 = (np.roll(F,-1,0) + np.roll(F,1,0) - 2*F)
        dy2 = (np.roll(F,-1,1) + np.roll(F,1,1) - 2*F)
        dz2 = (np.roll(F,-1,2) + np.roll(F,1,2) - 2*F)
        return dx2 - P['ANISO'] * dy2 + dz2

    # ── STEP ─────────────────────────────────────────────────
    def step():
        dt     = P['DT']
        gamma  = P['ACOPLAMIENTO']
        omega2 = P['FREQ'] ** 2
        damp   = P['AMORT']
        cEff   = P['C_EFF']
        t      = time.time()

        # Inyectar fuentes continuas
        for src in sources:
            val = np.sin(t * src['freq'] * 6.28318 + src['phase']) * src['strength'] * dt
            E[src['x'], src['y'], src['z']] += val

        # Laplaciano anisótropo
        lap = lap_aniso(E)

        # ∂²E/∂t² = c²·L(E) − γ·Q − amort·∂E/∂t
        d2E = cEff**2 * lap - gamma * Q - damp * dE
        dE[:] = np.clip(dE + d2E * dt, -2.0, 2.0)
        E[:]  = E + dE * dt

        # ∂²Q/∂t² = −ω²·Q + β·E − amort·∂Q/∂t
        d2Q = -omega2 * Q + gamma * E - damp * dQ
        dQ[:] = np.clip(dQ + d2Q * dt, -2.0, 2.0)
        Q[:]  = Q + dQ * dt

        # Normalización periódica — evita acumulación
        if frame[0] % 30 == 0:
            maxE = max(float(np.abs(E).max()), 0.001)
            if maxE > 2.0:
                s = 2.0 / maxE
                E[:] *= s; Q[:] *= s; dE[:] *= s; dQ[:] *= s

        frame[0] += 1

    # ── REFRESH ───────────────────────────────────────────────
    def refresh():
        absE = np.abs(E); absQ = np.abs(Q)
        amp  = absE + absQ
        maxAmp = max(float(amp.max()), 0.001)

        vol = np.minimum(1.0, amp / maxAmp)
        ph  = np.where(amp < 0.001, 0.5, absE / (amp + 1e-8))

        render_volume[:] = vol.ravel()
        phase_data[:]    = ph.ravel()

    # ── SEMILLAS ──────────────────────────────────────────────
    def clear_all():
        E[:]=0; Q[:]=0; dE[:]=0; dQ[:]=0
        sources.clear()

    def add_source(x, y, z, freq=None, strength=1.0, phase=0.0):
        sources.append({
            'x': int(round(x)), 'y': int(round(y)), 'z': int(round(z)),
            'freq':     freq or P['FREQ'],
            'strength': strength,
            'phase':    phase,
        })

    def seed_hbn():
        clear_all()
        P['ANISO']=2.8; P['ACOPLAMIENTO']=0.4; P['FREQ']=0.35; P['C_EFF']=0.5
        c = N // 2
        add_source(c, c, c, P['FREQ'], 1.2, 0.0)

    def seed_isotropico():
        clear_all()
        P['ANISO']=0.0; P['ACOPLAMIENTO']=0.3; P['FREQ']=0.4; P['C_EFF']=0.6
        c = N // 2
        add_source(c, c, c, P['FREQ'], 1.2, 0.0)

    def seed_pulso():
        clear_all()
        P['ANISO']=2.8; P['ACOPLAMIENTO']=0.5; P['C_EFF']=0.5
        c  = N // 2
        r0 = max(1, N // 4)
        x_idx = np.arange(N).reshape(N,1,1)
        y_idx = np.arange(N).reshape(1,N,1)
        z_idx = np.arange(N).reshape(1,1,N)
        dx = x_idx-c; dy = y_idx-c; dz = z_idx-c
        r2 = dx**2 + dy**2 + dz**2
        mask = r2 <= r0**2
        amp = np.exp(-r2.astype(float) / (r0**2 * 0.5))
        E[:] = np.where(mask, amp, 0).astype(np.float32)
        Q[:] = (E * 0.5)

    def seed_dos_fuentes():
        clear_all()
        P['ANISO']=2.5; P['ACOPLAMIENTO']=0.4; P['FREQ']=0.35; P['C_EFF']=0.5
        c   = N // 2
        sep = max(2, N // 8)
        add_source(c-sep, c, c, P['FREQ'], 1.0, 0.0)
        add_source(c+sep, c, c, P['FREQ'], 1.0, np.pi)

    _seeds = {
        'hbn':        seed_hbn,
        'isotropico': seed_isotropico,
        'pulso':      seed_pulso,
        'dosfuentes': seed_dos_fuentes,
    }

    def seed(name):
        fn = _seeds.get(name, seed_hbn)
        fn()
        frame[0] = 0
        refresh()

    # ── INYECCIONES ───────────────────────────────────────────
    def inject(name, data=None):
        c  = N // 2
        r0 = max(1, N // 4)

        if name == 'pulso':
            x_idx = np.arange(N).reshape(N,1,1)
            y_idx = np.arange(N).reshape(1,N,1)
            z_idx = np.arange(N).reshape(1,1,N)
            r2 = (x_idx-c)**2 + (y_idx-c)**2 + (z_idx-c)**2
            mask = r2 <= r0**2
            amp  = (1.5 * np.exp(-r2.astype(float)/(r0**2*0.5))).astype(np.float32)
            E[:] += np.where(mask, amp, 0)
            Q[:] += np.where(mask, amp*0.5, 0)

        elif name == 'calma':
            E[:] *= 0.05; Q[:] *= 0.05
            dE[:]*= 0.05; dQ[:]*= 0.05
            # Conservar solo la primera fuente
            if len(sources) > 1:
                first = sources[0]
                sources.clear()
                sources.append(first)

        elif name == 'touch' and data:
            tx = int((data.get('x',0)*0.5+0.5)*(N-1))
            ty = int((data.get('y',0)*0.5+0.5)*(N-1))
            tz = int((data.get('z',0)*0.5+0.5)*(N-1))
            add_source(tx, ty, tz, P['FREQ'], 0.8, float(np.random.rand()*6.28))

        refresh()

    def apply_params(params):
        for k, v in params.items():
            P[k] = float(v)
        # Actualizar frecuencia en fuentes existentes
        if 'FREQ' in params:
            for src in sources:
                src['freq'] = P['FREQ']

    def classify_state(m):
        if m['E_phase']  > 0.3:  return 'active'
        if m['E_total']  > 0.05: return 'pumping'
        if m['E_kin']    > 0.02: return 'stable'
        if m['u_max']    > 0.01: return 'nucleating'
        return 'vacuum'

    def get_metrics():
        absE = np.abs(E); absQ = np.abs(Q)
        totalE = float(absE.mean()); totalQ = float(absQ.mean())
        maxAmp = float((absE+absQ).max())
        hybrid = int(((absE>0.01) & (absQ>0.01) & (np.abs(absE-absQ) < absE*0.5)).sum())
        return {
            'E_total':   totalE,
            'E_kin':     totalQ,
            'E_torsion': maxAmp,
            'E_phase':   hybrid / T,
            'helicity':  maxAmp,
            'boundary':  totalE / (totalE + totalQ + 1e-4),
            'pump':      1 if maxAmp > 0.5 else 0,
            'u_max':     maxAmp,
            'th_max':    maxAmp,
            'phi_max':   hybrid / T,
            'psiMax':    maxAmp,
            'coherence': hybrid / T,
            'vortices':  hybrid,
        }

    # Inicializar
    seed_hbn()
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
