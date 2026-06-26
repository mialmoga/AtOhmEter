"""
AtOhmEter — engines/v4/compute.py
Motor Cosserat Bifásico V4 — NumPy vectorizado

Campos:  u(3), u_v(3), θ(3), θ_v(3), φ, φ_prev
Integrador: Störmer-Verlet (segundo orden temporal)
"""

import numpy as np

def createEngine(N, render_volume, phase_data):
    T = N * N * N

    # ── Parámetros ───────────────────────────────────────────
    P = {
        'RHO':           1.0,
        'J_INERTIA':     0.4,
        'MU':            1.5,
        'GAMMA_T':       0.5,
        'ALPHA_C':       2.0,
        'LAMBDA_DW':     0.8,
        'PHI0':          1.0,
        'SPIN_COUPLING': 0.15,
        'PUMP_GAIN':     0.08,
        'DAMP_BULK':     0.9998,
        'DAMP_BORDER':   0.995,
        'DX':            0.1,
        'DT':            0.008,
        'THRESH':        0.05,
        'NUCLEUS_R':     3,
        'NUCLEUS_AMP':   0.8,
        'PUMP_FREQ':     0.05,
        '_seed':         'grumo',
    }

    # ── Campos — shape (N,N,N) para operaciones vectorizadas ─
    ux  = np.zeros((N,N,N), dtype=np.float64)
    uy  = np.zeros((N,N,N), dtype=np.float64)
    uz  = np.zeros((N,N,N), dtype=np.float64)
    ux_v= np.zeros((N,N,N), dtype=np.float64)
    uy_v= np.zeros((N,N,N), dtype=np.float64)
    uz_v= np.zeros((N,N,N), dtype=np.float64)
    thx = np.zeros((N,N,N), dtype=np.float64)
    thy = np.zeros((N,N,N), dtype=np.float64)
    thz = np.zeros((N,N,N), dtype=np.float64)
    thx_v=np.zeros((N,N,N), dtype=np.float64)
    thy_v=np.zeros((N,N,N), dtype=np.float64)
    thz_v=np.zeros((N,N,N), dtype=np.float64)
    phi      = np.zeros((N,N,N), dtype=np.float64)
    phi_prev = np.zeros((N,N,N), dtype=np.float64)
    phi_seed = np.zeros((N,N,N), dtype=np.float64)

    pump_t = [0.0]

    # ── Operadores vectorizados con condiciones periódicas ────
    def roll(F, shift, axis):
        return np.roll(F, shift, axis=axis)

    def lap(F, dx2):
        return (roll(F,1,0)+roll(F,-1,0)+
                roll(F,1,1)+roll(F,-1,1)+
                roll(F,1,2)+roll(F,-1,2) - 6*F) / dx2

    def grad(F, inv2dx):
        gx = (roll(F,-1,0) - roll(F,1,0)) * inv2dx
        gy = (roll(F,-1,1) - roll(F,1,1)) * inv2dx
        gz = (roll(F,-1,2) - roll(F,1,2)) * inv2dx
        return gx, gy, gz

    def curl(Ax, Ay, Az, inv2dx):
        cx = (roll(Az,-1,1)-roll(Az,1,1))*inv2dx - (roll(Ay,-1,2)-roll(Ay,1,2))*inv2dx
        cy = (roll(Ax,-1,2)-roll(Ax,1,2))*inv2dx - (roll(Az,-1,0)-roll(Az,1,0))*inv2dx
        cz = (roll(Ay,-1,0)-roll(Ay,1,0))*inv2dx - (roll(Ax,-1,1)-roll(Ax,1,1))*inv2dx
        return cx, cy, cz

    # ── STEP ─────────────────────────────────────────────────
    def step():
        # Escalar DT con N para mantener estabilidad CFL en grillas grandes
        # Con N=32 DT base; con N=64 reducir a la mitad
        dt  = P['DT'] * (32.0 / max(N, 32))
        dt2 = dt * dt
        dx2 = P['DX'] ** 2
        inv2dx = 1.0 / (2 * P['DX'])

        # Derivadas
        c_thx, c_thy, c_thz = curl(thx, thy, thz, inv2dx)
        c_ux,  c_uy,  c_uz  = curl(ux,  uy,  uz,  inv2dx)
        l_ux  = lap(ux,  dx2); l_uy  = lap(uy,  dx2); l_uz  = lap(uz,  dx2)
        l_thx = lap(thx, dx2); l_thy = lap(thy, dx2); l_thz = lap(thz, dx2)
        l_phi = lap(phi, dx2)
        gpx, gpy, gpz = grad(phi, inv2dx)

        th_mag = np.sqrt(thx**2 + thy**2 + thz**2)
        th_mag_max = th_mag.max() + 1e-10
        grad_phi_mag = np.sqrt(gpx**2 + gpy**2 + gpz**2)

        # ── Fuerzas sobre u ───────────────────────────────────
        f_ux = P['MU']*l_ux + 2*P['ALPHA_C']*c_thx + P['PUMP_GAIN']*gpx*grad_phi_mag
        f_uy = P['MU']*l_uy + 2*P['ALPHA_C']*c_thy + P['PUMP_GAIN']*gpy*grad_phi_mag
        f_uz = P['MU']*l_uz + 2*P['ALPHA_C']*c_thz + P['PUMP_GAIN']*gpz*grad_phi_mag

        # ── Fuerzas sobre θ ───────────────────────────────────
        f_thx = P['GAMMA_T']*l_thx + 2*P['ALPHA_C']*(c_ux - 2*thx) + P['SPIN_COUPLING']*gpx*th_mag
        f_thy = P['GAMMA_T']*l_thy + 2*P['ALPHA_C']*(c_uy - 2*thy) + P['SPIN_COUPLING']*gpy*th_mag
        f_thz = P['GAMMA_T']*l_thz + 2*P['ALPHA_C']*(c_uz - 2*thz) + P['SPIN_COUPLING']*gpz*th_mag

        # ── Integración velocidades ───────────────────────────
        ux_v[:] += f_ux / P['RHO']  * dt
        uy_v[:] += f_uy / P['RHO']  * dt
        uz_v[:] += f_uz / P['RHO']  * dt
        thx_v[:]+=f_thx/P['J_INERTIA']*dt
        thy_v[:]+=f_thy/P['J_INERTIA']*dt
        thz_v[:]+=f_thz/P['J_INERTIA']*dt

        # ── Damping adaptativo ────────────────────────────────
        t_norm = np.minimum(1.0, th_mag / th_mag_max)
        local_damp = P['DAMP_BORDER'] + (P['DAMP_BULK'] - P['DAMP_BORDER']) * t_norm
        ux_v[:] *= local_damp; uy_v[:] *= local_damp; uz_v[:] *= local_damp
        thx_v[:]  *= local_damp; thy_v[:] *= local_damp; thz_v[:] *= local_damp

        # ── Integración posición ──────────────────────────────
        ux[:]  += ux_v  * dt; uy[:]  += uy_v  * dt; uz[:]  += uz_v  * dt
        thx[:] += thx_v * dt; thy[:] += thy_v * dt; thz[:] += thz_v * dt

        # ── Bombeo periódico del núcleo ───────────────────────
        if P['_seed'] == 'nucleo_bombeante':
            pump_t[0] += dt
            amp = P['NUCLEUS_AMP'] * np.sin(2*np.pi*P['PUMP_FREQ']*pump_t[0])
            c  = N // 2
            R  = max(2, round(P['NUCLEUS_R']))
            si, so = R+1, R+3

            x_idx = np.arange(N).reshape(N,1,1)
            y_idx = np.arange(N).reshape(1,N,1)
            z_idx = np.arange(N).reshape(1,1,N)
            dx = x_idx - c; dy = y_idx - c; dz = z_idx - c
            r  = np.sqrt(dx**2 + dy**2 + dz**2) + 1e-6

            # Interior del núcleo — fijar φ y θ
            mask_in = (r <= R)  # shape (N,N,N)
            phi[:]      = np.where(mask_in, np.where(dz >= 0, 1.0, -1.0), phi)
            phi_prev[:] = np.where(mask_in, phi, phi_prev)
            thx[:] = np.where(mask_in,  np.pi*0.5*(dy/(R+1e-6)) * np.ones((N,N,N)), thx)
            thy[:] = np.where(mask_in, -np.pi*0.5*(dx/(R+1e-6)) * np.ones((N,N,N)), thy)
            thz[:] = np.where(mask_in,  np.pi*0.3, thz)

            # Shell del núcleo — inyectar velocidad radial
            mask_sh = (r >= si) & (r <= so)
            ux_v[:] += np.where(mask_sh, amp*(dx/r)*dt, 0.0)
            uy_v[:] += np.where(mask_sh, amp*(dy/r)*dt, 0.0)
            uz_v[:] += np.where(mask_sh, amp*(dz/r)*dt, 0.0)

        # ── Evolución de φ (Störmer-Verlet) ──────────────────
        p = phi.copy()
        dV = -4 * P['LAMBDA_DW'] * p * (p**2 - P['PHI0']**2)

        # Spin emergente — pseudoescalar del gradiente
        gx0,gy0,gz0 = gpx, gpy, gpz
        gx_yp = np.roll(gpx,-1,1); gy_xp = np.roll(gpy,-1,0)
        gy_zp = np.roll(gpy,-1,2); gz_yp = np.roll(gpz,-1,1)
        gz_xp = np.roll(gpz,-1,0); gx_zp = np.roll(gpx,-1,2)
        spin = (gx_yp*gy0 - gy_xp*gx0) + (gy_zp*gz0 - gz_yp*gy0) + (gz_xp*gx0 - gx_zp*gz0)

        pumping = P['PUMP_GAIN'] * grad_phi_mag * np.tanh(p)

        div_th = (roll(thx,-1,0)-roll(thx,1,0) +
                  roll(thy,-1,1)-roll(thy,1,1) +
                  roll(thz,-1,2)-roll(thz,1,2)) * inv2dx

        phi_acc = P['MU']*l_phi + dV + P['SPIN_COUPLING']*spin + pumping + P['ALPHA_C']*0.5*div_th

        phi_next = 2*p - phi_prev + dt2*phi_acc
        phi_next -= 0.002 * (phi_next - p)

        phi_prev[:] = p
        phi[:]      = phi_next

    # ── REFRESH ───────────────────────────────────────────────
    def refresh():
        inv2dx = 1.0 / (2 * P['DX'])
        gpx, gpy, gpz = grad(phi, inv2dx)
        u_mag        = np.sqrt(ux**2 + uy**2 + uz**2)
        th_mag       = np.sqrt(thx**2 + thy**2 + thz**2)
        grad_phi_mag = np.sqrt(gpx**2 + gpy**2 + gpz**2)

        vol = grad_phi_mag*0.08 + th_mag*0.5 + u_mag*2.0
        ph  = phi*0.5 + 0.5

        render_volume[:] = vol.ravel().astype(np.float32)
        phase_data[:]    = np.clip(ph, 0, 1).ravel().astype(np.float32)

    # ── MÉTRICAS ──────────────────────────────────────────────
    def get_metrics():
        inv2dx = 1.0 / (2 * P['DX'])
        c_thx, c_thy, c_thz = curl(thx, thy, thz, inv2dx)

        E_kin_u  = 0.5 * P['RHO']       * float(np.mean(ux_v**2+uy_v**2+uz_v**2))
        E_kin_th = 0.5 * P['J_INERTIA'] * float(np.mean(thx_v**2+thy_v**2+thz_v**2))
        E_torsion= 0.5 * P['GAMMA_T']   * float(np.mean(thx**2+thy**2+thz**2))
        p2 = phi**2
        E_phase  = P['LAMBDA_DW'] * float(np.mean((p2 - P['PHI0']**2)**2))
        helic    = float(np.mean(thx*c_thx + thy*c_thy + thz*c_thz))
        boundary = float(np.mean(np.abs(phi) < 0.5))
        u_max    = float(np.sqrt(ux**2+uy**2+uz**2).max())
        th_max   = float(np.sqrt(thx**2+thy**2+thz**2).max())
        phi_max  = float(np.abs(phi).max())

        c  = N // 2; r = max(1, N // 8)
        sl = slice(c-r, c+r)
        pump = float(np.mean(phi[sl,sl,sl] - phi_prev[sl,sl,sl])) / P['DT']

        # Mode overlap
        na = float(np.sum(phi**2)); nb = float(np.sum(phi_seed**2))
        ov = float(np.sum(phi * phi_seed))
        overlap = abs(ov / (np.sqrt(na*nb) + 1e-12))

        return {
            'E_total':   E_kin_u + E_kin_th + E_torsion + E_phase,
            'E_kin':     E_kin_u + E_kin_th,
            'E_torsion': E_torsion,
            'E_phase':   E_phase,
            'helicity':  helic,
            'boundary':  boundary,
            'pump':      pump,
            'u_max':     u_max,
            'th_max':    th_max,
            'phi_max':   phi_max,
            'psiMax':    u_max,
            'vortices':  0,
            'coherence': overlap,
        }

    # ── SEMILLAS ──────────────────────────────────────────────
    def _clear_dynamic():
        for F in [ux,uy,uz,ux_v,uy_v,uz_v,thx_v,thy_v,thz_v]:
            F[:] = 0

    def seed_grumo():
        w = 0.06
        c = N // 2
        r = max(2, N // 8)
        x_idx = np.arange(N).reshape(N,1,1)
        y_idx = np.arange(N).reshape(1,N,1)
        z_idx = np.arange(N).reshape(1,1,N)
        fx = (2*x_idx/(N-1)) - 1
        fy = (2*y_idx/(N-1)) - 1
        fz = (2*z_idx/(N-1)) - 1
        phi[:] = np.tanh(fx/w) * np.tanh(fy/w) * np.tanh(fz/w)
        phi[:] += (np.random.rand(N,N,N)-0.5)*0.01
        phi_prev[:] = phi

        dx = x_idx - c; dy = y_idx - c; dz = z_idx - c
        dist = np.sqrt(dx**2+dy**2+dz**2) + 1e-6
        kick = 0.3 * np.exp(-dist * 0.1)
        ux[:] = kick * dx/dist; uy[:] = kick * dy/dist; uz[:] = kick * dz/dist
        ux_v[:] = kick*2.0*dx/dist; uy_v[:] = kick*2.0*dy/dist; uz_v[:] = kick*2.0*dz/dist

        mask = (np.abs(dx)<=r) & (np.abs(dy)<=r) & (np.abs(dz)<=r)
        thx[:] = np.where(mask, np.pi/2,  0) + (np.random.rand(N,N,N)-0.5)*0.02
        thy[:] = np.where(mask,-np.pi/2,  0) + (np.random.rand(N,N,N)-0.5)*0.02
        thz[:] = np.where(mask, np.pi/3,  0) + (np.random.rand(N,N,N)-0.5)*0.02
        thx_v[:] = 0; thy_v[:] = 0; thz_v[:] = 0
        phi_seed[:] = phi

    def seed_vacio():
        for F in [ux,uy,uz,ux_v,uy_v,uz_v,thx,thy,thz,thx_v,thy_v,thz_v]:
            F[:] = 0
        phi[:] = (np.random.rand(N,N,N)-0.5)*0.01
        phi_prev[:] = phi; phi_seed[:] = phi

    def seed_ruido(amp=0.1):
        for F,a in [(ux,amp),(uy,amp),(uz,amp)]:
            F[:] = (np.random.rand(N,N,N)-0.5)*a
        for F in [ux_v,uy_v,uz_v]: F[:]=0
        for F,a in [(thx,amp*0.5),(thy,amp*0.5),(thz,amp*0.5)]:
            F[:] = (np.random.rand(N,N,N)-0.5)*a
        for F in [thx_v,thy_v,thz_v]: F[:]=0
        phi[:] = (np.random.rand(N,N,N)-0.5)*0.1
        phi_prev[:] = phi; phi_seed[:] = phi

    def seed_bessel(bc, l):
        _clear_dynamic()
        c = N // 2
        root = np.pi*(l+1) if bc=='dirichlet' else (l+0.5)*np.pi
        x_idx = np.arange(N).reshape(N,1,1)
        y_idx = np.arange(N).reshape(1,N,1)
        z_idx = np.arange(N).reshape(1,1,N)
        fx = (x_idx-c)/(c-1); fy = (y_idx-c)/(c-1); fz = (z_idx-c)/(c-1)
        r  = np.sqrt(fx**2+fy**2+fz**2)
        with np.errstate(invalid='ignore', divide='ignore'):
            if bc == 'dirichlet':
                safe_r = np.where(r < 1e-8, 1e-8, r)
                p = np.where(r > 1.0, 0.0, np.where(r < 1e-8, 1.0, np.sin(root*safe_r)/(root*safe_r)))
            else:
                p = np.where(r > 1.0, 0.0, np.cos(root*r)*np.exp(-r**2*1.5))
            phi[:] = p; phi_prev[:] = p
            mask = (r > 0.01) & (r < 1.0)
            safe_r2 = np.where(r < 1e-8, 1e-8, r)
            thx[:] = np.where(mask, -(fx/safe_r2)*phi*0.3, 0)
            thy[:] = np.where(mask, -(fy/safe_r2)*phi*0.3, 0)
            thz[:] = np.where(mask, -(fz/safe_r2)*phi*0.3, 0)
        phi_seed[:] = phi

    def seed_nucleo_bombeante():
        _clear_dynamic()
        c  = N // 2
        R  = max(2, round(P['NUCLEUS_R']))
        x_idx = np.arange(N).reshape(N,1,1)
        y_idx = np.arange(N).reshape(1,N,1)
        z_idx = np.arange(N).reshape(1,1,N)
        dx = x_idx-c; dy = y_idx-c; dz = z_idx-c
        r  = np.sqrt(dx**2+dy**2+dz**2) + 1e-6
        mask_in  = r <= R
        mask_out = (r > R) & (r < N*0.45)
        phi[:]  = np.where(mask_in, np.where(dz>=0, 1.0, -1.0),
                  np.where(mask_out, 0.0, 1.0))
        phi_prev[:] = phi
        thx[:] = np.where(mask_in,  np.pi*0.5*(dy/(R+1e-6)), 0)
        thy[:] = np.where(mask_in, -np.pi*0.5*(dx/(R+1e-6)), 0)
        thz[:] = np.where(mask_in,  np.pi*0.3, 0)
        P['_seed'] = 'nucleo_bombeante'
        pump_t[0] = 0.0
        phi_seed[:] = phi

    def seed_torus():
        _clear_dynamic()
        c = N//2; R0=0.45; r0=0.18
        x_idx=np.arange(N).reshape(N,1,1)
        y_idx=np.arange(N).reshape(1,N,1)
        z_idx=np.arange(N).reshape(1,1,N)
        fx=(x_idx-c)/(c-1); fy=(y_idx-c)/(c-1); fz=(z_idx-c)/(c-1)
        rxy=np.sqrt(fx**2+fy**2)
        rt=np.sqrt((rxy-R0)**2+fz**2)
        phi[:]=np.exp(-(rt/r0)**2)*2-1; phi_prev[:]=phi
        angle=np.arctan2(fy,fx)
        thx[:] = -np.sin(angle)*np.abs(phi)*0.4
        thy[:] =  np.cos(angle)*np.abs(phi)*0.4
        thz[:] =  0.2*phi
        phi_seed[:] = phi

    _seeds = {
        'grumo':             seed_grumo,
        'vacio':             seed_vacio,
        'ruido':             seed_ruido,
        'dirichlet_l0':      lambda: seed_bessel('dirichlet', 0),
        'dirichlet_l1':      lambda: seed_bessel('dirichlet', 1),
        'neumann_q0':        lambda: seed_bessel('neumann', 0),
        'neumann_q1':        lambda: seed_bessel('neumann', 1),
        'tau_torus':         seed_torus,
        'nucleo_bombeante':  seed_nucleo_bombeante,
    }

    def seed(name):
        fn = _seeds.get(name, seed_grumo)
        if name != 'nucleo_bombeante':
            P['_seed'] = name
        fn()
        refresh()

    # ── INYECCIONES ───────────────────────────────────────────
    def inject(name, data=None):
        c = N//2; r = max(3, N//4)
        sl = slice(c-r, c+r)

        if name == 'perturbacion':
            thx[sl,sl,sl] += (np.random.rand(2*r,2*r,2*r)-0.5)*2.0
            thy[sl,sl,sl] += (np.random.rand(2*r,2*r,2*r)-0.5)*2.0
            thz[sl,sl,sl] += (np.random.rand(2*r,2*r,2*r)-0.5)*2.0
            ux_v[sl,sl,sl] += (np.random.rand(2*r,2*r,2*r)-0.5)*0.5
            uy_v[sl,sl,sl] += (np.random.rand(2*r,2*r,2*r)-0.5)*0.5
            uz_v[sl,sl,sl] += (np.random.rand(2*r,2*r,2*r)-0.5)*0.5

        elif name == 'fase_flip':
            r2 = max(3, N//8)
            x_idx=np.arange(N).reshape(N,1,1)
            y_idx=np.arange(N).reshape(1,N,1)
            z_idx=np.arange(N).reshape(1,1,N)
            dist2=(x_idx-c)**2+(y_idx-c)**2+(z_idx-c)**2
            mask = (dist2 < r2**2).astype(np.float64)
            phi[:]      *= np.where(mask, -1.0, 1.0)
            phi_prev[:] *= np.where(mask, -1.0, 1.0)
            noise = (np.random.rand(N,N,N)-0.5) * 1.0
            thx[:] += mask * noise
            thy[:] += mask * (np.random.rand(N,N,N)-0.5) * 1.0

        elif name == 'onda':
            x_idx=np.arange(N).reshape(N,1,1)
            y_idx=np.arange(N).reshape(1,N,1)
            z_idx=np.arange(N).reshape(1,1,N)
            dx=x_idx-c; dy=y_idx-c; dz=z_idx-c
            r_ = np.sqrt(dx**2+dy**2+dz**2)+1e-6
            amp = 1.0*np.exp(-r_*0.1)
            ux_v[:] += amp*dx/r_
            uy_v[:] += amp*dy/r_
            uz_v[:] += amp*dz/r_

        elif name == 'touch' and data:
            tx=int((data.get('x',0)*0.5+0.5)*(N-1))
            ty=int((data.get('y',0)*0.5+0.5)*(N-1))
            tz=int((data.get('z',0)*0.5+0.5)*(N-1))
            r_t = max(1, N//8)
            x_idx=np.arange(N).reshape(N,1,1)
            y_idx=np.arange(N).reshape(1,N,1)
            z_idx=np.arange(N).reshape(1,1,N)
            dx=x_idx-tx; dy=y_idx-ty; dz=z_idx-tz
            r_ = np.sqrt(dx**2+dy**2+dz**2)+1e-6
            mask = r_ <= r_t
            ux_v[mask] += (dx/r_)[mask]*2.0
            uy_v[mask] += (dy/r_)[mask]*2.0
            uz_v[mask] += (dz/r_)[mask]*2.0

        refresh()

    def apply_params(params):
        for k,v in params.items():
            P[k] = v

    def classify_state(m):
        if m['phi_max'] > 10 or m['u_max'] > 10: return 'collapse'
        if m['pump'] and abs(m['pump']) > 0.5:    return 'pumping'
        if m['E_total'] > 2 or m['boundary'] > 0.15: return 'active'
        if m['E_torsion'] > 0.5:                  return 'torsion'
        if m['E_total'] > 0.1:                    return 'nucleating'
        return 'vacuum'

    # Inicializar
    seed_grumo()
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
