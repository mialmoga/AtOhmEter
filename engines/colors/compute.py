"""
AtOhmEter — engines/colors/compute.py
Cubo de Agua con Luces RGB — NumPy vectorizado

Campos: fluid, vel, light_r, light_g, light_b, sono
Física: ecuación de ondas amortiguada + propagación de luz volumétrica
"""

import numpy as np

def createEngine(N, render_volume, phase_data):
    T = N * N * N

    # ── Parámetros ───────────────────────────────────────────
    P = {
        'WAVE_SPEED':   0.35,
        'DAMPING':      0.9985,
        'NONLIN':       0.3,
        'SURFACE_TENS': 0.15,
        'LIGHT_R_X':   -0.7,
        'LIGHT_R_X2':  -0.7,
        'LIGHT_G_X':    0.0,
        'LIGHT_G_X2':   0.0,
        'LIGHT_B_X':    0.7,
        'LIGHT_B_X2':   0.7,
        'LIGHT_SPREAD': 0.6,
        'LIGHT_SPEED':  0.08,
        'SONO_DECAY':   0.92,
        'SONO_RADIUS':  0.12,
        'TOUCH_FORCE':  1.2,
        'TOUCH_RADIUS': 0.25,
        'DT':           0.015,
        'THRESH':       0.04,
    }

    # ── Campos ───────────────────────────────────────────────
    fluid   = np.zeros((N,N,N), dtype=np.float64)
    vel     = np.zeros((N,N,N), dtype=np.float64)
    light_r = np.zeros((N,N,N), dtype=np.float64)
    light_g = np.zeros((N,N,N), dtype=np.float64)
    light_b = np.zeros((N,N,N), dtype=np.float64)
    sono    = np.zeros((N,N,N), dtype=np.float64)

    sono_state = {'active': False, 'phase': 0.0, 'x': 0, 'y': 0, 'z': 0}

    # ── Laplaciano vectorizado ────────────────────────────────
    def lap(F):
        return (np.roll(F,-1,0)+np.roll(F,1,0)+
                np.roll(F,-1,1)+np.roll(F,1,1)+
                np.roll(F,-1,2)+np.roll(F,1,2) - 6*F)

    # ── Propagación de luces volumétricas ─────────────────────
    def propagate_lights():
        c = N // 2
        r = max(2, int(N * P['LIGHT_SPREAD'] * 0.15))

        lamps = [
            (light_r, P['LIGHT_R_X'], P['LIGHT_R_X2']),
            (light_g, P['LIGHT_G_X'], P['LIGHT_G_X2']),
            (light_b, P['LIGHT_B_X'], P['LIGHT_B_X2']),
        ]

        for F, xTop, xBot in lamps:
            # Inyectar luz en techo (Y=N-1)
            gxTop = int((xTop * 0.5 + 0.5) * (N-1))
            x_idx = np.arange(N) - gxTop
            z_idx = np.arange(N) - c
            xx, zz = np.meshgrid(x_idx, z_idx, indexing='ij')
            mask_top = (xx**2 + zz**2) <= r**2
            xs = np.clip(np.arange(N), 0, N-1)
            zs = np.clip(np.arange(N), 0, N-1)
            for dx in range(-r, r+1):
                for dz in range(-r, r+1):
                    if dx*dx + dz*dz > r*r: continue
                    px = max(0, min(N-1, gxTop + dx))
                    pz = max(0, min(N-1, c    + dz))
                    F[px, N-1, pz] = 1.0

            # Difundir hacia abajo
            for y in range(N-2, -1, -1):
                t      = y / (N-1)
                xBeam  = xTop*t + xBot*(1-t)
                xAbove = xTop*((y+1)/(N-1)) + xBot*(1-(y+1)/(N-1))
                shift  = int(round(((xBeam - xAbove)*0.5)*(N-1)))

                above  = np.roll(F[:, y+1, :], -shift, axis=0)
                scatter = 1.0 - np.abs(fluid[:, y, :]) * 0.3
                F[:, y, :] = np.maximum(F[:, y, :], above * scatter * 0.96)

            F[:] *= 0.98

    # ── STEP ─────────────────────────────────────────────────
    def step():
        dt = P['DT']
        l  = lap(fluid)

        wave    =  P['WAVE_SPEED']**2 * l
        nonlin  = -P['NONLIN'] * fluid**3
        tension = -P['SURFACE_TENS'] * l * np.abs(fluid)

        vel[:]   = (vel + (wave + nonlin + tension)*dt) * P['DAMPING']
        fluid[:] = np.clip(fluid + vel*dt, -2.0, 2.0)

        propagate_lights()

        # Sonoluminiscencia
        s = sono_state
        if s['active']:
            s['phase'] += dt * 0.8
            sx, sy, sz = s['x'], s['y'], s['z']
            r = max(1, int(P['SONO_RADIUS'] * N))

            x_idx = np.arange(N).reshape(N,1,1)
            y_idx = np.arange(N).reshape(1,N,1)
            z_idx = np.arange(N).reshape(1,1,N)
            dx = x_idx-sx; dy = y_idx-sy; dz = z_idx-sz
            d2 = dx**2 + dy**2 + dz**2

            if s['phase'] < 1.0:
                mask = d2 <= r**2
                dist = np.sqrt(d2.astype(float))
                strength = np.where(mask, (1-dist/r)*s['phase'], 0)
                fluid[:] -= strength * 0.3
                sono[:]   = strength

            elif s['phase'] < 1.3:
                r2   = r * 2
                mask = d2 <= r2**2
                flash = 1 - (s['phase']-1)/0.3
                dist  = np.sqrt(d2.astype(float))
                intensity = np.where(mask, flash*np.exp(-dist/r2*2), 0)
                sono[:]   = intensity
                norm = np.sqrt(d2.astype(float)) + 1
                vel[:] += intensity * 0.4 * (dx+dy+dz) / norm

            else:
                sono[:] *= P['SONO_DECAY']
                if s['phase'] > 3:
                    s['active'] = False
                    s['phase']  = 0.0
                    sono[:] = 0

    # ── REFRESH ───────────────────────────────────────────────
    def refresh():
        r = light_r; g = light_g; b = light_b; s = sono

        light_total = r + g + b
        vol = np.abs(fluid)*0.2 + light_total*0.6 + s*1.5

        total = r + g + b + 1e-8
        rn = r/total; gn = g/total; bn = b/total
        hue = rn*0 + gn*0.333 + bn*0.666
        balance = 1 - np.maximum(np.maximum(np.abs(rn-gn), np.abs(gn-bn)), np.abs(rn-bn))
        hue = hue*(1-balance) + 0.5*balance
        ph  = np.where(s > 0.1, 0.5, hue)

        render_volume[:] = vol.ravel().astype(np.float32)
        phase_data[:]    = ph.ravel().astype(np.float32)

    # ── SEMILLAS ──────────────────────────────────────────────
    def clear_fields():
        for F in [fluid,vel,light_r,light_g,light_b,sono]: F[:]=0
        sono_state['active']=False; sono_state['phase']=0.0

    def seed_calma():
        clear_fields()
        fluid[:] = (np.random.rand(N,N,N)-0.5)*0.05

    def seed_ondas():
        clear_fields()
        c = N//2
        x_idx=np.arange(N).reshape(N,1,1)
        y_idx=np.arange(N).reshape(1,N,1)
        z_idx=np.arange(N).reshape(1,1,N)
        r = np.sqrt((x_idx-c)**2+(y_idx-c)**2+(z_idx-c)**2)
        fluid[:] = np.sin(r*0.8)*np.exp(-r*0.08)*0.4

    def seed_turbulencia():
        clear_fields()
        fluid[:] = (np.random.rand(N,N,N)-0.5)*0.3
        vel[:]   = (np.random.rand(N,N,N)-0.5)*0.1

    _seeds = {
        'calma':       seed_calma,
        'ondas':       seed_ondas,
        'turbulencia': seed_turbulencia,
    }

    def seed(name):
        fn = _seeds.get(name, seed_calma)
        fn()
        refresh()

    # ── INYECCIONES ───────────────────────────────────────────
    def inject(name, data=None):
        if name == 'touch' and data:
            tx = int((data.get('x',0)*0.5+0.5)*(N-1))
            ty = int((data.get('y',0)*0.5+0.5)*(N-1))
            tz = int((data.get('z',0)*0.5+0.5)*(N-1))
            r  = max(1, int(P['TOUCH_RADIUS']*N))
            x_idx=np.arange(N).reshape(N,1,1)
            y_idx=np.arange(N).reshape(1,N,1)
            z_idx=np.arange(N).reshape(1,1,N)
            d2 = (x_idx-tx)**2+(y_idx-ty)**2+(z_idx-tz)**2
            mask = d2 <= r**2
            dist = np.sqrt(d2.astype(float))
            strength = np.where(mask, (1-dist/r)*P['TOUCH_FORCE'], 0)
            vel[:]   += strength*(np.random.rand(N,N,N)-0.5)*0.5
            fluid[:] += strength*0.2

        elif name == 'sono':
            sono_state['active'] = True
            sono_state['phase']  = 0.0
            sono_state['x'] = int(N//2 + (np.random.rand()-0.5)*0.6*(N-1))
            sono_state['y'] = int(N//2 + (np.random.rand()-0.5)*0.6*(N-1))
            sono_state['z'] = int(N//2 + (np.random.rand()-0.5)*0.6*(N-1))

        elif name == 'pulso':
            c=N//2; r=N//8
            x_idx=np.arange(N).reshape(N,1,1)
            y_idx=np.arange(N).reshape(1,N,1)
            z_idx=np.arange(N).reshape(1,1,N)
            mask = (x_idx-c)**2+(y_idx-c)**2+(z_idx-c)**2 <= r**2
            vel[:] += np.where(mask, (np.random.rand(N,N,N)-0.5)*0.8, 0)

        elif name == 'calma':
            fluid[:]=0; vel[:]=0

        refresh()

    def get_metrics():
        fa = np.abs(fluid)
        white = ((light_r>0.1)&(light_g>0.1)&(light_b>0.1)).sum()
        return {
            'E_total':   float(fa.mean()),
            'E_kin':     float(np.abs(vel).mean()),
            'E_torsion': float(light_r.mean()),
            'E_phase':   float(light_g.mean()),
            'helicity':  float(light_b.mean()),
            'boundary':  float(white)/T,
            'pump':      1 if sono_state['active'] else 0,
            'u_max':     float(fa.max()),
            'th_max':    float(np.abs(vel).mean()),
            'phi_max':   float(fa.max()),
            'psiMax':    float(fa.max()),
            'coherence': float(white)/T,
            'vortices':  0,
        }

    def classify_state(m):
        if m['pump'] > 0.5:       return 'locked'
        if m['coherence'] > 0.15: return 'pumping'
        if m['E_kin'] > 0.05:     return 'active'
        if m['E_total'] > 0.02:   return 'nucleating'
        return 'vacuum'

    def apply_params(params):
        for k,v in params.items():
            P[k] = float(v)

    seed_calma()
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
