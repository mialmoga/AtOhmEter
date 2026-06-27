// ═══════════════════════════════════════════════════════════
// AtOhmEter Engine — INK
// Navier-Stokes incompresible + advección de color RGB
// Toque del dedo → fuerza local en el fluido
// Mezcla aditiva de colores → blanco donde se cruzan
//
// API: createEngine(N, renderVolume, phaseData, texture3D, texturePhase)
// ═══════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

const TOTAL = N * N * N;
const EPS   = 1e-9;

// ── Parámetros ───────────────────────────────────────────────
let P = {
    VISCOSITY:   0.00001,  // viscosidad cinemática del fluido
    DIFFUSION:   0.00001,  // difusión de la tinta
    FORCE_SCALE: 8.0,      // fuerza del toque táctil
    DECAY:       0.995,    // decay de velocidad por frame
    DT:          0.016,    // timestep
    INK_RADIUS:  0.15,     // radio de inyección de tinta
    THRESH:      0.01,     // umbral visual
};

// ── Campos de velocidad ──────────────────────────────────────
let vx  = new Float32Array(TOTAL);
let vy  = new Float32Array(TOTAL);
let vz  = new Float32Array(TOTAL);
let vx0 = new Float32Array(TOTAL);
let vy0 = new Float32Array(TOTAL);
let vz0 = new Float32Array(TOTAL);

// ── Campos de color RGB (tinta) ──────────────────────────────
let r   = new Float32Array(TOTAL);
let g   = new Float32Array(TOTAL);
let b   = new Float32Array(TOTAL);
let r0  = new Float32Array(TOTAL);
let g0  = new Float32Array(TOTAL);
let b0  = new Float32Array(TOTAL);

// ── Presión y divergencia ────────────────────────────────────
let p   = new Float32Array(TOTAL);
let div = new Float32Array(TOTAL);

// ── Temporales para savePrev ─────────────────────────────────
let prev_r = new Float32Array(TOTAL);
let prev_g = new Float32Array(TOTAL);
let prev_b = new Float32Array(TOTAL);

let frameN = 0;

// ── Indexado con wrap periódico ──────────────────────────────
function idx(x, y, z) {
    return ((x + N) % N) * N * N + ((y + N) % N) * N + ((z + N) % N);
}

// ── Difusión via Gauss-Seidel ────────────────────────────────
function diffuse(x, x0, diff, dt, iter = 4) {
    const a = dt * diff * (N - 2) * (N - 2);
    for (let k = 0; k < iter; k++) {
        for (let i = 1; i < N - 1; i++)
        for (let j = 1; j < N - 1; j++)
        for (let l = 1; l < N - 1; l++) {
            const n = idx(i, j, l);
            x[n] = (x0[n] + a * (
                x[idx(i-1,j,l)] + x[idx(i+1,j,l)] +
                x[idx(i,j-1,l)] + x[idx(i,j+1,l)] +
                x[idx(i,j,l-1)] + x[idx(i,j,l+1)]
            )) / (1 + 6 * a);
        }
    }
}

// ── Proyección (mantener incompresibilidad) ──────────────────
function project(vx, vy, vz, p, div, iter = 4) {
    const h = 1.0 / N;
    for (let i = 1; i < N - 1; i++)
    for (let j = 1; j < N - 1; j++)
    for (let l = 1; l < N - 1; l++) {
        const n = idx(i,j,l);
        div[n] = -0.5 * h * (
            vx[idx(i+1,j,l)] - vx[idx(i-1,j,l)] +
            vy[idx(i,j+1,l)] - vy[idx(i,j-1,l)] +
            vz[idx(i,j,l+1)] - vz[idx(i,j,l-1)]
        );
        p[n] = 0;
    }
    for (let k = 0; k < iter; k++) {
        for (let i = 1; i < N - 1; i++)
        for (let j = 1; j < N - 1; j++)
        for (let l = 1; l < N - 1; l++) {
            const n = idx(i,j,l);
            p[n] = (div[n] +
                p[idx(i-1,j,l)] + p[idx(i+1,j,l)] +
                p[idx(i,j-1,l)] + p[idx(i,j+1,l)] +
                p[idx(i,j,l-1)] + p[idx(i,j,l+1)]
            ) / 6;
        }
    }
    for (let i = 1; i < N - 1; i++)
    for (let j = 1; j < N - 1; j++)
    for (let l = 1; l < N - 1; l++) {
        const n = idx(i,j,l);
        vx[n] -= 0.5 * (p[idx(i+1,j,l)] - p[idx(i-1,j,l)]) / h;
        vy[n] -= 0.5 * (p[idx(i,j+1,l)] - p[idx(i,j-1,l)]) / h;
        vz[n] -= 0.5 * (p[idx(i,j,l+1)] - p[idx(i,j,l-1)]) / h;
    }
}

// ── Advección (semi-Lagrangiana) ─────────────────────────────
function advect(d, d0, vx, vy, vz, dt) {
    const dt0 = dt * (N - 2);
    for (let i = 1; i < N - 1; i++)
    for (let j = 1; j < N - 1; j++)
    for (let l = 1; l < N - 1; l++) {
        const n = idx(i,j,l);
        let x = i - dt0 * vx[n];
        let y = j - dt0 * vy[n];
        let z = l - dt0 * vz[n];
        // Clamp
        x = Math.max(0.5, Math.min(N - 1.5, x));
        y = Math.max(0.5, Math.min(N - 1.5, y));
        z = Math.max(0.5, Math.min(N - 1.5, z));
        const i0 = Math.floor(x), i1 = i0 + 1;
        const j0 = Math.floor(y), j1 = j0 + 1;
        const l0 = Math.floor(z), l1 = l0 + 1;
        const sx1 = x - i0, sx0 = 1 - sx1;
        const sy1 = y - j0, sy0 = 1 - sy1;
        const sz1 = z - l0, sz0 = 1 - sz1;
        d[n] =
            sx0*(sy0*(sz0*d0[idx(i0,j0,l0)] + sz1*d0[idx(i0,j0,l1)]) +
                 sy1*(sz0*d0[idx(i0,j1,l0)] + sz1*d0[idx(i0,j1,l1)])) +
            sx1*(sy0*(sz0*d0[idx(i1,j0,l0)] + sz1*d0[idx(i1,j0,l1)]) +
                 sy1*(sz0*d0[idx(i1,j1,l0)] + sz1*d0[idx(i1,j1,l1)]));
    }
}

// ── Paso de velocidad ────────────────────────────────────────
function velStep(dt) {
    // Difundir
    diffuse(vx0, vx, P.VISCOSITY, dt);
    diffuse(vy0, vy, P.VISCOSITY, dt);
    diffuse(vz0, vz, P.VISCOSITY, dt);
    project(vx0, vy0, vz0, p, div);
    // Advectar
    advect(vx, vx0, vx0, vy0, vz0, dt);
    advect(vy, vy0, vx0, vy0, vz0, dt);
    advect(vz, vz0, vx0, vy0, vz0, dt);
    project(vx, vy, vz, p, div);
    // Decay
    for (let n = 0; n < TOTAL; n++) {
        vx[n] *= P.DECAY;
        vy[n] *= P.DECAY;
        vz[n] *= P.DECAY;
    }
}

// ── Paso de densidad (color) ─────────────────────────────────
function densStep(dt) {
    // Añadir fuentes (r0, g0, b0 son las fuentes de este frame)
    for (let n = 0; n < TOTAL; n++) {
        r[n] += dt * r0[n];
        g[n] += dt * g0[n];
        b[n] += dt * b0[n];
    }
    // Difundir
    diffuse(r0, r, P.DIFFUSION, dt);
    diffuse(g0, g, P.DIFFUSION, dt);
    diffuse(b0, b, P.DIFFUSION, dt);
    // Advectar
    advect(r, r0, vx, vy, vz, dt);
    advect(g, g0, vx, vy, vz, dt);
    advect(b, b0, vx, vy, vz, dt);
    // Decay de tinta
    for (let n = 0; n < TOTAL; n++) {
        r[n] = Math.max(0, r[n] * P.DECAY);
        g[n] = Math.max(0, g[n] * P.DECAY);
        b[n] = Math.max(0, b[n] * P.DECAY);
        // Limpiar fuentes
        r0[n] = g0[n] = b0[n] = 0;
    }
}

// ── Semillas ─────────────────────────────────────────────────
function seedClear() {
    vx.fill(0); vy.fill(0); vz.fill(0);
    vx0.fill(0); vy0.fill(0); vz0.fill(0);
    r.fill(0); g.fill(0); b.fill(0);
    r0.fill(0); g0.fill(0); b0.fill(0);
    p.fill(0); div.fill(0);
}

function seedInk() {
    seedClear();
    const c = Math.floor(N / 2);
    const rad = Math.max(1, Math.floor(N * P.INK_RADIUS));
    // Tres manchas de color en posiciones distintas
    const sources = [
        { cx: c - N/4, cy: c, cz: c, dr: 1, dg: 0, db: 0 }, // Rojo
        { cx: c + N/4, cy: c, cz: c, dr: 0, dg: 0, db: 1 }, // Azul
        { cx: c, cy: c - N/4, cz: c, dr: 0, dg: 1, db: 0 }, // Verde
    ];
    for (const s of sources) {
        for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
        for (let l = 0; l < N; l++) {
            const dx = i - s.cx, dy = j - s.cy, dz = l - s.cz;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (dist < rad) {
                const n = idx(i, j, l);
                const w = 1 - dist / rad;
                r[n] += s.dr * w;
                g[n] += s.dg * w;
                b[n] += s.db * w;
            }
        }
    }
}

function seedSwirl() {
    seedClear();
    const c = N / 2;
    for (let i = 1; i < N-1; i++)
    for (let j = 1; j < N-1; j++)
    for (let l = 1; l < N-1; l++) {
        const n = idx(i,j,l);
        const dx = i - c, dy = j - c, dz = l - c;
        const dist = Math.sqrt(dx*dx+dy*dy+dz*dz)+EPS;
        // Velocidad tangencial → vórtice
        vx[n] = -dy / dist * 0.3;
        vy[n] =  dx / dist * 0.3;
        vz[n] =  Math.sin(dist * 0.3) * 0.1;
        // Color por ángulo
        const angle = Math.atan2(dy, dx);
        r[n] = 0.5 + 0.5 * Math.sin(angle);
        g[n] = 0.5 + 0.5 * Math.sin(angle + 2.094);
        b[n] = 0.5 + 0.5 * Math.sin(angle + 4.189);
        r[n] *= Math.exp(-dist*dist/(N*N*0.05));
        g[n] *= Math.exp(-dist*dist/(N*N*0.05));
        b[n] *= Math.exp(-dist*dist/(N*N*0.05));
    }
}

// ── Inyección táctil (llamada desde el shell via inject) ──────
function injectAt(nx, ny, nz, fscale, cr, cg, cb) {
    // nx,ny,nz: posición normalizada [-1,1]
    const cx = Math.floor((nx + 1) * 0.5 * N);
    const cy = Math.floor((ny + 1) * 0.5 * N);
    const cz = Math.floor((nz + 1) * 0.5 * N);
    const rad = Math.max(1, Math.floor(N * P.INK_RADIUS * 0.5));

    for (let i = Math.max(1,cx-rad); i < Math.min(N-1,cx+rad); i++)
    for (let j = Math.max(1,cy-rad); j < Math.min(N-1,cy+rad); j++)
    for (let l = Math.max(1,cz-rad); l < Math.min(N-1,cz+rad); l++) {
        const dx = i-cx, dy = j-cy, dz = l-cz;
        const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
        if (dist < rad) {
            const n = idx(i,j,l);
            const w = (1 - dist/rad) * fscale;
            vx[n] += (Math.random()-0.5) * w * P.FORCE_SCALE;
            vy[n] += (Math.random()-0.5) * w * P.FORCE_SCALE;
            vz[n] += (Math.random()-0.5) * w * P.FORCE_SCALE;
            r0[n] += cr * w * 3;
            g0[n] += cg * w * 3;
            b0[n] += cb * w * 3;
        }
    }
}

// ── Actualizar texturas ──────────────────────────────────────
function refresh() {
    for (let n = 0; n < TOTAL; n++) {
        // renderVolume: densidad total de tinta
        const density = Math.min(1, r[n] + g[n] + b[n]);
        renderVolume[n] = density;
        // phaseData: codificar color en un solo float via hue
        // Rojo=0.0, Verde=0.33, Azul=0.66, Blanco→1.0
        const total = r[n] + g[n] + b[n] + EPS;
        const hue = (r[n]*0.0 + g[n]*0.33 + b[n]*0.66) / total;
        // Si hay mezcla (blanco), empujar hacia 1.0
        const whiteness = Math.min(1, r[n]) * Math.min(1, g[n]) * Math.min(1, b[n]) * 8;
        phaseData[n] = Math.min(1, hue + whiteness);
    }
    texture3D.needsUpdate    = true;
    texturePhase.needsUpdate = true;
}

// ── API ──────────────────────────────────────────────────────
return {

    seed(name) {
        if (name === 'swirl') seedSwirl();
        else                  seedInk();
        refresh();
    },

    step() {
        velStep(P.DT);
        densStep(P.DT);
        frameN++;
    },

    refresh() { refresh(); },

    savePrev() {
        prev_r.set(r); prev_g.set(g); prev_b.set(b);
    },

    applyParams(params) {
        for (const k of Object.keys(params)) {
            if (k in P) P[k] = params[k];
        }
        if (params.THRESH !== undefined && window._uniforms?.uThresh) {
            window._uniforms.uThresh.value = params.THRESH;
        }
    },

    getParams() { return { ...P }; },

    getMetrics() {
        let totalR = 0, totalG = 0, totalB = 0;
        let maxV = 0, totalVort = 0;
        for (let n = 0; n < TOTAL; n++) {
            totalR += r[n]; totalG += g[n]; totalB += b[n];
            const spd = vx[n]*vx[n]+vy[n]*vy[n]+vz[n]*vz[n];
            if (spd > maxV) maxV = spd;
        }
        const inv = 1 / TOTAL;
        // Coherencia: qué tanto se parece el color actual al previo
        let coher = 0, cn = 0;
        for (let n = 0; n < TOTAL; n++) {
            const m1 = r[n]+g[n]+b[n];
            const m2 = prev_r[n]+prev_g[n]+prev_b[n];
            if (m1 < EPS || m2 < EPS) continue;
            coher += (r[n]*prev_r[n]+g[n]*prev_g[n]+b[n]*prev_b[n])/(m1*m2);
            cn++;
        }
        return {
            E_total:   totalR*inv + totalG*inv + totalB*inv,
            E_kin:     Math.sqrt(maxV),
            E_higgs:   totalR * inv,
            E_torsion: totalG * inv,
            E_phase:   totalB * inv,
            helicity:  0,
            psiMax:    Math.sqrt(maxV),
            vortices:  frameN,
            coherence: cn > 0 ? coher / cn : 0,
            pump:      0,
            boundary:  0,
        };
    },

    getState() {
        return {
            vx: new Float32Array(vx), vy: new Float32Array(vy), vz: new Float32Array(vz),
            r:  new Float32Array(r),  g:  new Float32Array(g),  b:  new Float32Array(b),
        };
    },

    setState(s) {
        if (s.vx) vx.set(s.vx);
        if (s.vy) vy.set(s.vy);
        if (s.vz) vz.set(s.vz);
        if (s.r)  r.set(s.r);
        if (s.g)  g.set(s.g);
        if (s.b)  b.set(s.b);
        refresh();
    },

    // Inyección táctil — llamada desde el shell con posición del raycaster
    inject(name, params) {
        if (name === 'touch' && params) {
            // params: { x, y, z, color } donde color es 'red'|'green'|'blue'|'random'
            const col = params.color || 'random';
            const cr = col==='red'   || col==='random' ? (col==='random'?Math.random():1) : 0;
            const cg = col==='green' || col==='random' ? (col==='random'?Math.random():1) : 0;
            const cb = col==='blue'  || col==='random' ? (col==='random'?Math.random():1) : 0;
            injectAt(params.x||0, params.y||0, params.z||0, 1.0, cr, cg, cb);
        } else if (name === 'rojo')   { injectAt(0, 0, 0, 2, 1, 0, 0); }
        else if (name === 'verde')    { injectAt(-0.5, 0, 0, 2, 0, 1, 0); }
        else if (name === 'azul')     { injectAt(0.5, 0, 0, 2, 0, 0, 1); }
        else if (name === 'perturb')  {
            // Perturbación aleatoria que agita el fluido
            for (let n = 0; n < TOTAL; n++) {
                vx[n] += (Math.random()-0.5)*0.5;
                vy[n] += (Math.random()-0.5)*0.5;
                vz[n] += (Math.random()-0.5)*0.5;
            }
        }
    },
};

} // createEngine
