// ══════════════════════════════════════════════════════════════
//  AtOhmEter — BURBUJA
//
//  "El cubo de jabón que respira con tu aliento"
//
//  Un cubo de película jabonosa. SOPLAS al micrófono y nacen burbujas.
//  Pero el cubo no es uniforme: cada CARA reacciona distinto al soplido.
//  Giras el cubo (orbitando la cámara) para poner al frente la cara que
//  quieres, y soplas:
//    · Frente  — orificio normal → burbuja de tamaño proporcional al soplido
//    · Lados   — orificios chiquitos → muchas burbujas pequeñas
//    · Otro    — la burbuja se rellena de HUMO (vapor dentro)
//    · Arriba  — una sola burbuja del tamaño de toda la cara
//    · Abajo   — espuma (cúmulo de burbujitas)
//
//  Las membranas tienen iridiscencia por espesor (física real de película
//  delgada: el color depende del grosor). Flotan con gravedad suave. Y
//  REVIENTAN: al inflarse el espesor baja, y si cruza el mínimo crítico,
//  ¡pop! El slider TENSIÓN decide qué tan frágiles son.
//
//  ── Las dos fuerzas: INFLADO vs TENSIÓN ──────────────────────
//  INFLADO  — el aire soplado infla la membrana; crece, el espesor baja.
//  TENSIÓN  — la tensión superficial quiere cerrar y estabilizar; si gana,
//             la burbuja se asienta; si el inflado la vence, revienta.
//
//  ── Modos (semillas) ─────────────────────────────────────────
//    A · Normal — luz natural, iridiscencia de jabón real.
//    B · UV     — luz negra: las membranas brillan fluorescentes neón.
//
//  El motor mantiene dos campos: 'film' (espesor de membrana) y 'smoke'
//  (vapor dentro de las burbujas). Las burbujas son entidades (centro,
//  radio, espesor, humo) que escriben sobre los campos en refresh.
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        SOPLIDO:    1.0,    // sensibilidad al micro (cuánto infla el aire)
        TENSION:    0.5,    // fragilidad: alta = revientan pequeñas, baja = crecen más
        HUMO:       0.6,    // densidad del vapor dentro de las burbujas
        GRAVEDAD:   0.015,  // qué tan rápido flotan/caen
        IRIDISCENCIA: 1.0,  // intensidad del arcoíris por espesor
        DT:         1.0,
        THRESH:     0.05,
    };

    // Campos que ve el shader
    const film  = new Float64Array(T);  // espesor de membrana [0,1]
    const smoke = new Float64Array(T);  // vapor [0,1]

    // Burbujas como entidades (más barato que simular el campo entero)
    // cada una: posición (centro), radio, espesor, humo interno, cara de origen
    let bubbles = [];
    let mode = 'A';           // A normal, B UV
    let frame = 0;
    let currentFace = 0;      // cara detectada al frente (0..5)
    let faceChanged = false;  // para el indicador
    let lastFace = -1;

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    // Los 6 normales de las caras del cubo y su "comportamiento de soplido"
    const FACES = [
        { normal:[ 0, 0, 1], name:'frente · orificio normal',  behavior:'normal' },
        { normal:[ 0, 0,-1], name:'atrás · humo',               behavior:'humo'   },
        { normal:[ 1, 0, 0], name:'derecha · burbujitas',       behavior:'chico'  },
        { normal:[-1, 0, 0], name:'izquierda · burbujitas',     behavior:'chico'  },
        { normal:[ 0, 1, 0], name:'arriba · burbuja gigante',   behavior:'gigante'},
        { normal:[ 0,-1, 0], name:'abajo · espuma',             behavior:'espuma' },
    ];

    // Detectar qué cara está al frente, leyendo la cámara que expone el shell.
    function detectFace() {
        const cam = (typeof window !== 'undefined') ? window._camera : null;
        if (!cam) return currentFace;
        // dirección desde el centro del cubo hacia la cámara
        const dx = cam.position.x, dy = cam.position.y, dz = cam.position.z;
        const len = Math.sqrt(dx*dx+dy*dy+dz*dz) + 1e-9;
        const vx = dx/len, vy = dy/len, vz = dz/len;
        // la cara cuyo normal mejor se alinea con la vista
        let best = 0, bestDot = -2;
        for (let i=0;i<6;i++) {
            const n = FACES[i].normal;
            const dot = n[0]*vx + n[1]*vy + n[2]*vz;
            if (dot > bestDot) { bestDot = dot; best = i; }
        }
        return best;
    }

    // Punto de origen de una burbuja según la cara (en coords de grid)
    function faceOrigin(faceIdx) {
        const n = FACES[faceIdx].normal;
        const c = N/2;
        const off = N*0.32; // cerca de la cara, no en el borde exacto
        // pequeño jitter en el plano de la cara
        const j = () => (Math.random()-0.5) * N * 0.4;
        let ox = c + n[0]*off, oy = c + n[1]*off, oz = c + n[2]*off;
        // dispersar en el plano perpendicular al normal
        if (Math.abs(n[0])>0.5) { oy += j(); oz += j(); }
        else if (Math.abs(n[1])>0.5) { ox += j(); oz += j(); }
        else { ox += j(); oy += j(); }
        return [ox, oy, oz];
    }

    // Crear una burbuja según el comportamiento de la cara y la fuerza del soplido
    function blow(strength) {
        const face = currentFace;
        const beh = FACES[face].behavior;
        const s = strength * P.SOPLIDO;
        const [ox,oy,oz] = faceOrigin(face);

        if (beh === 'normal') {
            bubbles.push(mkBubble(ox,oy,oz, N*0.10 + s*N*0.18, 0.0, face));
        } else if (beh === 'chico') {
            const n = 2 + (Math.random()*3|0);
            for (let k=0;k<n;k++){ const [a,b,c]=faceOrigin(face); bubbles.push(mkBubble(a,b,c, N*0.05+s*N*0.06, 0.0, face)); }
        } else if (beh === 'humo') {
            bubbles.push(mkBubble(ox,oy,oz, N*0.10 + s*N*0.16, P.HUMO, face));
        } else if (beh === 'gigante') {
            // burbuja grande pero no tan grande que reviente al instante
            bubbles.push(mkBubble(N/2,N/2,N/2, N*0.16 + s*N*0.12, 0.0, face));
        } else if (beh === 'espuma') {
            const n = 4 + (Math.random()*5|0);
            for (let k=0;k<n;k++){ const [a,b,c]=faceOrigin(face); bubbles.push(mkBubble(a,b,c, N*0.04+s*N*0.05, 0.0, face)); }
        }
        if (bubbles.length > 120) bubbles.splice(0, bubbles.length-120); // tope
    }

    function mkBubble(x,y,z,r,humo,face) {
        return {
            x,y,z, r,
            vr: 0,                          // velocidad de crecimiento
            thick: 1.0,                     // espesor de la membrana [0,1]
            humo,                           // vapor interno [0,1]
            face,
            popped: false,
            age: 0,
            phase: Math.random()*6.28,      // para iridiscencia variada
        };
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        frame++;
        // detectar la cara que se mira (para el próximo soplido + indicador)
        const f = detectFace();
        faceChanged = (f !== lastFace);
        lastFace = currentFace = f;

        const grav = P.GRAVEDAD;
        const tension = P.TENSION;

        for (const b of bubbles) {
            if (b.popped) continue;
            b.age++;
            // flotación suave hacia arriba (burbujas de jabón)
            b.y += grav * N * 0.5;
            b.r += b.vr;
            b.vr *= 0.9;
            // el espesor objetivo baja cuanto más grande es la burbuja, pero
            // la membrana llega a ese espesor GRADUALMENTE (drena despacio),
            // así la burbuja vive un rato antes de adelgazar hasta reventar.
            const bigness = b.r / (N*0.30);
            // objetivo de espesor: las grandes son MUCHO más finas
            const targetThick = Math.max(0, 1.0 - bigness*bigness*0.9);
            b.thick += (targetThick - b.thick) * 0.12;
            // goteo constante (evaporación): la tensión lo acelera notablemente.
            // esto garantiza que TODA burbuja muere; grandes y tensas, antes.
            b.thick -= (0.004 + tension * 0.045);
            b.thick = Math.max(0, b.thick);
            const critical = 0.05 + tension * 0.30;
            if (b.thick < critical && b.age > 3) {
                b.popped = true;
                b._releaseSmoke = b.humo;
                b._popAge = 0;
            }
            b.humo *= 0.985;
        }
        // limpiar reventadas (tras mostrar el reventón unos frames)
        for (const b of bubbles) { if (b.popped && b._popAge !== undefined) b._popAge++; }
        bubbles = bubbles.filter(b => !b.popped || (b._popAge < 6 || b._releaseSmoke > 0.01));
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — pintar las burbujas en los campos film + smoke
    // ══════════════════════════════════════════════════════════
    function refresh() {
        film.fill(0);
        // el humo se queda (se disipa solo), no lo limpiamos del todo
        for (let i=0;i<T;i++) smoke[i] *= 0.96;

        for (const b of bubbles) {
            // pintar membrana: una cáscara esférica (alta densidad en r≈radio)
            const r = b.r;
            const x0=Math.max(0,(b.x-r-1)|0), x1=Math.min(N-1,(b.x+r+1)|0);
            const y0=Math.max(0,(b.y-r-1)|0), y1=Math.min(N-1,(b.y+r+1)|0);
            const z0=Math.max(0,(b.z-r-1)|0), z1=Math.min(N-1,(b.z+r+1)|0);
            for (let x=x0;x<=x1;x++) for (let y=y0;y<=y1;y++) for (let z=z0;z<=z1;z++) {
                const dx=x-b.x, dy=y-b.y, dz=z-b.z;
                const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
                const i=idx(x,y,z);
                if (!b.popped) {
                    // cáscara: pico de densidad en la superficie de la esfera
                    const shell = Math.exp(-Math.pow(dist - r, 2) / (2*1.2*1.2));
                    if (shell > 0.02) {
                        // film guarda el espesor (para iridiscencia); nos quedamos con el máximo
                        const v = shell * b.thick;
                        if (v > film[i]) film[i] = v;
                    }
                    // humo interno: llena el volumen dentro de la burbuja
                    if (b.humo > 0.01 && dist < r*0.92) {
                        smoke[i] = Math.max(smoke[i], b.humo * (1 - dist/r));
                    }
                } else if (b._releaseSmoke > 0.01) {
                    // burbuja reventada soltando humo: nube que se expande
                    if (dist < r*1.2) smoke[i] = Math.max(smoke[i], b._releaseSmoke*0.5*(1-dist/(r*1.2)));
                }
            }
            if (b.popped) b._releaseSmoke *= 0.7;
        }

        // escribir a las texturas:
        // renderVolume = membrana + humo (lo que se ve)
        // phaseData = espesor (para iridiscencia en el shader) o marca de humo
        for (let i=0;i<T;i++) {
            const f = film[i], s = smoke[i];
            renderVolume[i] = Math.min(1, f + s*0.7);
            // phase: codifica si es membrana (espesor → iridiscencia) o humo.
            // 0.0-0.85 = espesor de membrana (rueda de iridiscencia)
            // 0.9-1.0 = humo (gris/vapor)
            if (f >= s*0.7 && f > 0.01) {
                phaseData[i] = Math.min(0.85, f * P.IRIDISCENCIA);
            } else if (s > 0.01) {
                phaseData[i] = 0.95; // marca de humo
            } else {
                phaseData[i] = 0;
            }
        }
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS = MODOS (Normal / UV)
    // ══════════════════════════════════════════════════════════
    function seedNormal() { mode='A'; bubbles=[]; film.fill(0); smoke.fill(0); frame=0;
        // un par de burbujas iniciales para que no arranque vacío
        currentFace = detectFace();
        blow(0.5); blow(0.4);
    }
    function seedUV() { mode='B'; bubbles=[]; film.fill(0); smoke.fill(0); frame=0;
        currentFace = detectFace();
        blow(0.5); blow(0.4);
    }

    function seed(name) {
        if (name==='uv') seedUV();
        else seedNormal();
        refresh();
    }

    seed('normal');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let alive=0, popped=0, totalR=0, maxR=0, totalThick=0, smokeTotal=0;
        for (const b of bubbles) {
            if (b.popped) { popped++; continue; }
            alive++; totalR+=b.r; if(b.r>maxR)maxR=b.r; totalThick+=b.thick;
        }
        for (let i=0;i<T;i++) smokeTotal += smoke[i];
        return {
            E_total:   alive / 30,                  // nº de burbujas vivas (norm)
            E_kin:     popped / 10,                 // reventadas recientes
            E_torsion: smokeTotal / T,              // densidad de humo
            E_phase:   alive ? totalThick/alive : 0,// espesor medio (fragilidad)
            helicity:  0,
            boundary:  alive ? (totalR/alive)/(N*0.3) : 0, // tamaño medio norm
            pump:      maxR / (N*0.3),              // burbuja más grande
            u_max:     maxR,
            th_max:    currentFace,                 // cara actual (para HUD)
            phi_max:   alive,
            psiMax:    maxR / (N*0.3),
            coherence: alive ? totalThick/alive : 0,
            vortices:  alive,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        const alive = m.vortices;
        if (alive === 0)            return 'vacuum';      // sin burbujas — sopla
        if (m.E_kin > 0.3)          return 'collapse';    // reventando varias
        if (m.pump > 0.85)          return 'locked';      // una burbuja enorme (a punto de pop)
        if (m.E_torsion > 0.1)      return 'pumping';     // mucho humo
        if (alive > 12)             return 'stable';      // espuma poblada
        if (alive > 3)              return 'active';      // varias flotando
        return 'nucleating';                              // las primeras
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function inject(name, data) {
        if (name === 'soplar') {
            // soplido manual (por si no hay micro) — fuerza media-alta
            blow(0.7);
        } else if (name === 'soplido_mic') {
            // viene del MicEngine: data.strength es el volumen del micro
            const s = (data && typeof data.strength === 'number') ? data.strength : 0.5;
            if (s > 0.04) blow(s);
        } else if (name === 'reventar') {
            for (const b of bubbles) if (!b.popped && b.age>2) { b.popped=true; b._releaseSmoke=b.humo; }
        } else if (name === 'vapor') {
            // inyectar humo suelto en el centro
            const c=N/2;
            for(let dx=-N/6;dx<=N/6;dx++)for(let dy=-N/6;dy<=N/6;dy++)for(let dz=-N/6;dz<=N/6;dz++){
                const i=idx(c+dx,c+dy,c+dz); if(i>=0&&i<T) smoke[i]=Math.min(1,smoke[i]+0.4);
            }
        }
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  API + indicador de cara
    // ══════════════════════════════════════════════════════════
    function getFaceInfo() {
        return { face: currentFace, name: FACES[currentFace].name, changed: faceChanged };
    }

    function getState() {
        return { mode, bubbles: bubbles.map(b=>({...b})), frame };
    }
    function setState(s) {
        if (s.mode) mode = s.mode;
        if (s.bubbles) bubbles = s.bubbles.map(b=>({...b}));
        if (typeof s.frame==='number') frame = s.frame;
        refresh();
    }

    return {
        step, refresh, getMetrics, classifyState, inject, seed,
        initSeed: seed,
        getState, setState,
        loadState(s){ this.setState(s); },
        savePrev(){},
        applyParams(p){ Object.assign(P,p); },
        getParams(){ return {...P}; },
        getFaceInfo,   // el shell puede leer esto para el indicador de cara
        getMode(){ return mode; },
    };
}
