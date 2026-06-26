// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor V2 (plantilla de capacidades del shell)
//
//  "El Campo Sensible"
//
//  V0 enseña el contrato mínimo. V1 enseña personalidad física.
//  V2 enseña a CONECTAR EL MOTOR CON EL MUNDO: el micrófono, el
//  giroscopio, el toque, y la dirección de la cámara.
//
//  Lo que hace: un campo de partículas-semilla que difunden calor.
//  Pero el calor responde a tus entradas:
//    · TOCAS la pantalla    → inyectas calor en ese punto (inject 'touch')
//    · INCLINAS el teléfono  → el calor "cae" hacia donde inclinas (gyro)
//    · SOPLAS / haces ruido  → sube la difusión (mic modula un param)
//    · GIRAS la cámara       → el motor sabe desde dónde lo miras (window._camera)
//
//  Esto NO es física seria — es el ejemplo más claro posible de cómo
//  enchufar cada capacidad. Copia las partes que necesites.
//
//  Para que estas capacidades se activen, el config.json del motor debe
//  declarar los bloques "mic" y "gyro" y (para el toque) el shell ya trae
//  el raycaster. Ver manual_LLM.md sección 9b.
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    // ── Parámetros ───────────────────────────────────────────────
    // DIFUSION lo modulará el MICRÓFONO (binding en config: volume → DIFUSION).
    // GRAV_X / GRAV_Y los modulará el GIROSCOPIO (tiltX → GRAV_X, tiltY → GRAV_Y).
    let P = {
        DIFUSION:  0.12,   // velocidad de difusión — el micro la sube con el ruido
        GRAV_X:    0.0,    // inclinación izq/der — del giroscopio (tiltX)
        GRAV_Y:    0.0,    // inclinación ad/atrás — del giroscopio (tiltY)
        FUERZA:    0.6,    // intensidad del calor que inyecta el toque
        DECAY:     0.985,  // el calor se enfría poco a poco
        DT:        1.0,
        THRESH:    0.06,
    };

    const heat = new Float64Array(T);   // el campo de "calor"
    const tmp  = new Float64Array(T);

    // atractor de toque: un punto que inyecta calor mientras está activo.
    // 'active' decae solo cada frame; cada toque lo renueva. Así sabemos
    // cuándo el dedo dejó de tocar (el shell no avisa al soltar).
    let touch = { x: N/2, y: N/2, z: N/2, active: 0 };

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    function laplaciano(F, out) {
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            out[i] = F[idx(x+1,y,z)]+F[idx(x-1,y,z)]
                   + F[idx(x,y+1,z)]+F[idx(x,y-1,z)]
                   + F[idx(x,y,z+1)]+F[idx(x,y,z-1)] - 6*F[i];
        }
    }

    // ── Leer la cámara (window._camera) ──────────────────────────
    // Devuelve la dirección normalizada desde el centro hacia la cámara,
    // o null si no hay ventana (headless). SIEMPRE protege con if(cam).
    function cameraDir() {
        const cam = (typeof window !== 'undefined') ? window._camera : null;
        if (!cam) return null;
        const p = cam.position;
        const len = Math.hypot(p.x, p.y, p.z) + 1e-9;
        return { x: p.x/len, y: p.y/len, z: p.z/len };
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        // 1. Difusión normal (DIFUSION puede venir alta si el micro capta ruido)
        laplaciano(heat, tmp);
        for (let i=0;i<T;i++) heat[i] += P.DIFUSION * tmp[i] * P.DT;

        // 2. Gravedad del GIROSCOPIO: el calor "cae" desplazándose hacia donde
        //    inclinas. Desplazamos el campo una fracción según GRAV_X/GRAV_Y.
        //    (Ejemplo simple: empujar el calor en la dirección del tilt.)
        const gx = P.GRAV_X, gy = P.GRAV_Y;
        if (Math.abs(gx) > 1e-4 || Math.abs(gy) > 1e-4) {
            for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
                const i = idx(x,y,z);
                // tomar calor del vecino "cuesta arriba" (flujo hacia el tilt)
                // OJO eje Y: pantalla +y = arriba; invertimos gy para que
                // "inclinar hacia ti" haga caer el calor hacia abajo.
                const src = heat[idx(x - Math.sign(gx), y - Math.sign(-gy), z)];
                heat[i] += (src - heat[i]) * (Math.abs(gx)+Math.abs(gy)) * 2.0;
            }
        }

        // 3. Inyección del TOQUE: mientras el dedo toca (active>0), metemos
        //    calor en el punto tocado. active decae solo → sabemos cuándo soltó.
        if (touch.active > 0) {
            const r = Math.max(2, N>>4);
            for (let dx=-r;dx<=r;dx++) for (let dy=-r;dy<=r;dy++) for (let dz=-r;dz<=r;dz++) {
                const i = idx((touch.x+dx)|0, (touch.y+dy)|0, (touch.z+dz)|0);
                heat[i] += P.FUERZA * touch.active * 0.1;
            }
            touch.active -= 0.04; // decae — si no se renueva, el toque "termina"
        }

        // 4. Enfriamiento global
        for (let i=0;i<T;i++) heat[i] *= P.DECAY;
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    // ══════════════════════════════════════════════════════════
    function refresh() {
        // color: si la cámara está disponible, teñimos según el ángulo de vista
        // (ejemplo de uso de window._camera para algo visual). Si no, fase fija.
        const dir = cameraDir();
        const baseHue = dir ? (Math.atan2(dir.z, dir.x)/(2*Math.PI)+0.5) : 0.6;

        let maxv = 1e-9;
        for (let i=0;i<T;i++) if (heat[i] > maxv) maxv = heat[i];

        for (let i=0;i<T;i++) {
            renderVolume[i] = Math.max(0, heat[i] / maxv);
            phaseData[i] = baseHue; // un color que cambia con el ángulo de cámara
        }
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════
    function seed(name) {
        heat.fill(0);
        touch.active = 0;
        if (name === 'vacio') {
            // empezar frío — todo el calor vendrá de tus toques
        } else {
            // semilla por defecto: un punto caliente en el centro
            const c = N>>1;
            for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
                const dx=x-c,dy=y-c,dz=z-c;
                heat[idx(x,y,z)] = Math.exp(-(dx*dx+dy*dy+dz*dz)/(2*(N/6)**2));
            }
        }
        refresh();
    }

    seed('centro');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let total=0, max=0;
        for (let i=0;i<T;i++){ const v=heat[i]; total+=v; if(v>max)max=v; }
        return {
            E_total:   total/T,
            E_kin:     0, E_torsion: 0, E_phase: 0, helicity: 0,
            boundary:  touch.active,    // si el toque está activo (para el HUD)
            pump:      0,
            u_max:     max,
            th_max:    0, phi_max: max,
            psiMax:    max,
            coherence: 0, vortices: 0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        if (m.boundary > 0.1)  return 'pumping';     // dedo tocando
        if (m.psiMax > 3)      return 'collapse';
        if (m.E_total > 0.15)  return 'active';
        if (m.E_total > 0.02)  return 'nucleating';
        return 'vacuum';
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES — incluyendo el caso 'touch' del shell
    // ══════════════════════════════════════════════════════════
    function inject(name, data) {
        if (name === 'touch') {
            // ── EL TOQUE ──
            // El shell envía data = {x,y,z} en coords LOCALES [-1,1].
            // Convertir a coords de grid [0,N] y activar el atractor.
            if (data) {
                touch.x = (data.x*0.5+0.5) * N;
                touch.y = (data.y*0.5+0.5) * N;
                touch.z = (data.z*0.5+0.5) * N;
                touch.active = 1.0; // renovar — mientras toques, sigue caliente
            }
            // no hace falta refresh aquí: el loop lo hará tras step()
            return;
        }
        if (name === 'soplar') {
            // ── inyección que el MICRÓFONO puede disparar ──
            // Si el binding usa passStrength, data.strength trae la intensidad.
            const s = (data && typeof data.strength === 'number') ? data.strength : 0.5;
            const cx=Math.random()*N|0, cy=Math.random()*N|0, cz=Math.random()*N|0;
            heat[idx(cx,cy,cz)] += s * 2.0; // soplar más fuerte = más calor
        } else if (name === 'enfriar') {
            for (let i=0;i<T;i++) heat[i] *= 0.5;
        }
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  SNAPSHOTS + API
    // ══════════════════════════════════════════════════════════
    function getState() { return { heat: new Float32Array(heat) }; }
    function setState(s) { if (s.heat) heat.set(s.heat); refresh(); }

    return {
        step, refresh, getMetrics, classifyState, inject, seed,
        initSeed: seed,
        getState, setState,
        loadState(s){ this.setState(s); },
        savePrev(){},
        applyParams(p){ Object.assign(P,p); },
        getParams(){ return {...P}; },
    };
}
