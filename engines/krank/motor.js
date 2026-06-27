// ══════════════════════════════════════════════════════════════
//  AtOhmEter — KRANK
//
//  "El campo que se quiebra"
//
//  Una realidad lisa (un campo de color) que no aguanta su propia
//  tensión. En un punto cede — ¡krank! — y se abre una fractura cuyo
//  borde NO es liso: es fractal, un Mandelbulb que enrosca colas de
//  caballito de mar en tres dimensiones. A través de la grieta no hay
//  vacío: hay OTRA realidad, de otro color, que estaba debajo.
//
//  La grieta crece. Se ramifica. Devora la superficie. Y cuando la
//  realidad de abajo ocupa más de la mitad del volumen, OCURRE LA
//  INVERSIÓN: lo que asomaba por las grietas se vuelve la superficie,
//  y lo que era superficie pasa a ser la realidad oculta. Entonces un
//  nuevo puntito, y ¡krank! otra vez — pero ahora la grieta muestra el
//  color anterior. Azul↔naranja↔azul. Respiración de realidades.
//
//  ── Las dos fuerzas que se oponen: SUPERFICIE vs FRACTURA ─────
//  SUPERFICIE — la realidad de arriba quiere cerrarse, curar la grieta,
//               mantenerse entera y lisa (parámetro CURACION).
//  FRACTURA   — la realidad de abajo empuja por las grietas, las extiende
//               con su borde fractal hasta conquistar (parámetro PRESION).
//  Ninguna gana para siempre: cada inversión las intercambia. Biestable.
//
//  ── Modos (semillas) ─────────────────────────────────────────
//    A · Vigilia  — el ciclo completo, automático y eterno. Respira solo.
//    B · Sísmico  — la superficie está tensa pero estable; TÚ provocas
//                   cada krank con la inyección. Control sobre el caos.
//    C · Babel    — múltiples fracturas de colores distintos (realidades/
//                   dimensiones) crecen a la vez compitiendo. La primera
//                   que cruza el 50% conquista y se vuelve superficie
//                   universal; las demás reinician dentro de ella.
//                   Darwinismo dimensional.
//
//  ── El borde fractal: Mandelbulb / Quaternion Julia ──────────
//  Cada celda evalúa una iteración z→z^power + c en 3D. El conteo de
//  iteraciones hasta escapar define la distancia a la membrana entre
//  realidades — ese es el borde de caballito de mar. El slider FRACTAL
//  recorre el power (2..8); C_PARAM mueve la constante (la forma).
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        FRACTAL:   8,      // power del Mandelbulb (2..8). El "DNA" del quiebre.
        C_PARAM:   0.0,    // desplaza la constante c → cambia la forma del borde
        PRESION:   0.020,  // FRACTURA: velocidad a la que la grieta crece
        CURACION:  0.006,  // SUPERFICIE: cuánto resiste/cura la superficie
        DETALLE:   6,      // iteraciones del fractal (más = borde más fino, más caro)
        DT:        1.0,
        THRESH:    0.06,
    };

    // ── Campos ───────────────────────────────────────────────────
    // membrane[i]: distancia fractal estimada a la grieta (estática por FRACTAL/C).
    //   Valores bajos = cerca del borde fractal; el patrón Mandelbulb vive aquí.
    const membrane = new Float64Array(T);
    // crack[i]: 0..1 — cuánto ha penetrado la fractura en esta celda (dinámico).
    //   0 = superficie intacta; 1 = la otra realidad domina aquí.
    const crack  = new Float64Array(T);
    const cnext  = new Float64Array(T);
    // realityId[i]: en modo Babel, qué realidad (color) ocupa la celda.
    const realityId = new Int8Array(T);

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    // ── Mandelbulb: estima cercanía al borde fractal en (nx,ny,nz)∈[-1,1] ──
    // Devuelve un valor 0..1: ~0 lejos del set (escapa rápido), ~1 dentro/cerca.
    // Usa la fórmula esférica clásica del Mandelbulb con power configurable.
    function mandelbulb(nx, ny, nz, power, cx, cy, cz, maxIter) {
        let x = nx, y = ny, z = nz;
        let dr = 1.0, r = 0.0;
        let iter = 0;
        for (; iter < maxIter; iter++) {
            r = Math.sqrt(x*x + y*y + z*z);
            if (r > 2.0) break;
            // a esféricas
            let theta = Math.acos(z / (r + 1e-9));
            let phi = Math.atan2(y, x);
            dr = Math.pow(r, power - 1.0) * power * dr + 1.0;
            // escalar y rotar
            const zr = Math.pow(r, power);
            theta *= power;
            phi *= power;
            const st = Math.sin(theta);
            x = zr * st * Math.cos(phi) + (nx + cx);
            y = zr * st * Math.sin(phi) + (ny + cy);
            z = zr * Math.cos(theta)    + (nz + cz);
        }
        // distancia estimada (Hart): 0.5*log(r)*r/dr — pequeña cerca del borde
        const dist = 0.5 * Math.log(r + 1e-9) * r / (dr + 1e-9);
        // convertir a "cercanía a la membrana" 0..1
        if (iter >= maxIter) return 1.0;           // dentro del set → corazón de la grieta
        return Math.max(0, Math.min(1, 1.0 - dist * 6.0)); // cerca del borde → alto
    }

    // Recalcular la membrana fractal (estática mientras FRACTAL/C_PARAM/DETALLE no cambien)
    function computeMembrane() {
        const power = Math.max(2, Math.min(8, Math.round(P.FRACTAL)));
        const maxIter = Math.max(2, Math.min(16, Math.round(P.DETALLE)));
        const c = P.C_PARAM;
        // la constante se mueve en una diagonal suave con C_PARAM
        const cx = c * 0.3, cy = c * 0.2, cz = -c * 0.25;
        for (let xi=0;xi<N;xi++) for (let yi=0;yi<N;yi++) for (let zi=0;zi<N;zi++) {
            // mapear a [-1.3,1.3] (un poco más que el set para ver el borde)
            const nx = (xi / (N-1) * 2 - 1) * 1.3;
            const ny = (yi / (N-1) * 2 - 1) * 1.3;
            const nz = (zi / (N-1) * 2 - 1) * 1.3;
            membrane[idx(xi,yi,zi)] = mandelbulb(nx, ny, nz, power, cx, cy, cz, maxIter);
        }
    }

    let mode = 'A';
    let surfaceReality = 0;   // qué realidad es la superficie actual (0,1,2,3...)
    let crackReality   = 1;   // qué realidad asoma por la grieta
    let frame = 0;
    let lastInversion = 0;
    let inversionCount = 0;
    // colores de realidad (índice → tono de fase 0..1 para el shader)
    const realityHue = [0.60, 0.08, 0.33, 0.85, 0.50]; // azul, naranja, verde, magenta, cyan

    // ── Sembrar un puntito de fractura ───────────────────────────
    function seedCrack(rid) {
        // un punto aleatorio donde la membrana fractal es fuerte (para que crezca bonito)
        let best=-1, bestV=-1;
        for (let tries=0; tries<40; tries++) {
            const i = (Math.random()*T)|0;
            if (membrane[i] > bestV) { bestV = membrane[i]; best = i; }
        }
        crack[best] = 1.0;
        realityId[best] = rid;
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        frame++;
        const pres = P.PRESION, cura = P.CURACION;

        // La fractura crece donde ya hay grieta Y la membrana fractal lo permite:
        // crack se propaga a vecinos proporcional a membrane (el borde fractal guía
        // por dónde se ramifica → colas de caballito de mar).
        cnext.set(crack);
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            const ci = crack[i];

            // SUPERFICIE: curación — la grieta tiende a cerrarse sola
            if (ci > 0 && ci < 1) cnext[i] = Math.max(0, cnext[i] - cura);

            if (ci < 0.05) continue; // sin grieta aquí, no propaga

            // FRACTURA: propagación a vecinos, modulada por la membrana fractal
            const nb = [idx(x+1,y,z),idx(x-1,y,z),idx(x,y+1,z),idx(x,y-1,z),idx(x,y,z+1),idx(x,y,z-1)];
            for (let k=0;k<6;k++) {
                const j = nb[k];
                // crece más donde la membrana es alta (borde fractal) → ramificación de caballito
                const push = pres * ci * (0.3 + membrane[j]);
                if (push > 0 && cnext[j] < ci) {
                    cnext[j] = Math.min(1, cnext[j] + push);
                    if (realityId[j] === 0 && crack[j] < 0.05) realityId[j] = realityId[i]; // hereda color
                }
            }
        }
        for (let i=0;i<T;i++) crack[i] = cnext[i];

        // ── ¿Inversión? medir cuánto territorio tiene la fractura ──
        if (mode === 'A') {
            let fractured = 0;
            for (let i=0;i<T;i++) if (crack[i] > 0.5) fractured++;
            const frac = fractured / T;
            if (frac > 0.5) {
                doInversion();
            }
            // si todo se curó (no queda grieta) y no hay inversión, sembrar puntito
            if (frac < 0.001 && frame - lastInversion > 10) {
                seedCrack(crackReality);
            }
        } else if (mode === 'C') {
            // BABEL: contar territorio por realidad; la que domine conquista.
            // Umbral: 35% del volumen O ser mayoría clara cuando >60% está fracturado.
            const counts = {};
            let total = 0;
            for (let i=0;i<T;i++) {
                if (crack[i] > 0.5) { const r = realityId[i]; counts[r]=(counts[r]||0)+1; total++; }
            }
            let leader=-1, leadN=0, secondN=0;
            for (const r in counts) {
                if (counts[r] > leadN) { secondN=leadN; leadN=counts[r]; leader=parseInt(r); }
                else if (counts[r] > secondN) { secondN=counts[r]; }
            }
            const leaderFrac = leadN / T;
            const fracturedFrac = total / T;
            // conquista si: ocupa 35% del cubo, O el cubo está muy fracturado (>55%)
            // y el líder dobla al segundo (mayoría darwiniana clara)
            if (leader >= 0 && (leaderFrac > 0.35 || (fracturedFrac > 0.55 && leadN > secondN * 2))) {
                conquerBabel(leader);
            }
            // mantener varias grietas vivas
            const aliveReals = Object.keys(counts).length;
            if (aliveReals < 3 && frame % 20 === 0) {
                const newR = (Math.random()*realityHue.length)|0;
                seedCrack(newR);
            }
        }
        // modo B: no hay inversión automática ni siembra — todo lo provoca el usuario
    }

    function doInversion() {
        // lo que asomaba por la grieta se vuelve superficie; lo de antes se oculta
        const tmp = surfaceReality;
        surfaceReality = crackReality;
        crackReality = (tmp + 1) % realityHue.length; // rota a un nuevo color oculto
        crack.fill(0);
        realityId.fill(0);
        lastInversion = frame;
        inversionCount++;
        // nuevo puntito que mostrará el nuevo color oculto
        seedCrack(crackReality);
    }

    function conquerBabel(winnerReality) {
        // la realidad ganadora se vuelve superficie universal; reinician las demás
        surfaceReality = winnerReality;
        crack.fill(0);
        realityId.fill(0);
        lastInversion = frame;
        inversionCount++;
        // sembrar 3 nuevas realidades retando a la ganadora
        for (let k=0;k<3;k++) {
            let r; do { r = (Math.random()*realityHue.length)|0; } while (r === winnerReality);
            seedCrack(r);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — brillo = el borde fractal; color = qué realidad
    // ══════════════════════════════════════════════════════════
    function refresh() {
        const surfHue = realityHue[surfaceReality];
        for (let i=0;i<T;i++) {
            const ci = crack[i];
            // color: interpola entre la superficie y la realidad de la grieta
            let hue;
            if (ci > 0.05) {
                const rid = (mode === 'C') ? realityId[i] : crackReality;
                hue = realityHue[rid];
            } else {
                hue = surfHue;
            }
            // brillo: la superficie es tenue y lisa; el borde de la grieta BRILLA
            // (membrane alto = cerca del borde fractal). La grieta abierta muestra
            // la otra realidad a pleno.
            const edge = membrane[i] * (ci > 0.05 ? 1.0 : 0.18); // borde fractal resalta en la grieta
            const body = ci * 0.6;                                // cuerpo de la otra realidad
            const surf = (1 - ci) * 0.10;                         // superficie lisa tenue
            renderVolume[i] = Math.min(1, edge + body + surf);
            phaseData[i] = hue;
        }
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS = MODOS
    // ══════════════════════════════════════════════════════════
    function reset() {
        crack.fill(0); realityId.fill(0);
        frame = 0; lastInversion = 0; inversionCount = 0;
        surfaceReality = 0; crackReality = 1;
    }
    function seedVigilia() {
        mode = 'A'; reset(); computeMembrane();
        seedCrack(crackReality);
    }
    function seedSismico() {
        mode = 'B'; reset(); computeMembrane();
        // sin grieta inicial — el usuario provoca el krank
    }
    function seedBabel() {
        mode = 'C'; reset(); computeMembrane();
        // varias realidades compitiendo desde el inicio
        for (let k=1;k<=3;k++) seedCrack(k % realityHue.length);
    }

    function seed(name) {
        if      (name === 'vigilia') seedVigilia();
        else if (name === 'sismico') seedSismico();
        else if (name === 'babel')   seedBabel();
        else                         seedVigilia();
        refresh();
    }

    computeMembrane();
    seed('vigilia');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let fractured=0, edgeTotal=0, crackEdge=0, membTotal=0;
        let realities = new Set();
        for (let i=0;i<T;i++) {
            const ci = crack[i];
            if (ci > 0.5) { fractured++; realities.add(realityId[i]); }
            membTotal += membrane[i];
            if (membrane[i] > 0.3) edgeTotal++;
            if (ci > 0.05 && ci < 0.95) crackEdge++; // frontera activa de la grieta
        }
        const fracFrac = fractured / T;
        return {
            E_total:   fracFrac,                 // territorio de la fractura [0,1]
            E_kin:     crackEdge / T,            // perímetro activo (frontera creciendo)
            E_torsion: edgeTotal / T,            // densidad del borde fractal
            E_phase:   membTotal / T,            // "energía" media de la membrana
            helicity:  0,
            boundary:  fracFrac,                 // % fracturado (para el HUD)
            pump:      inversionCount,           // cuántas inversiones han ocurrido
            u_max:     mode==='C' ? realities.size : 0, // realidades vivas (Babel)
            th_max:    surfaceReality,
            phi_max:   crackReality,
            psiMax:    fracFrac,
            coherence: 1 - Math.abs(fracFrac - 0.5) * 2, // cerca de 1 en el punto de inversión
            vortices:  fractured,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        const f = m.E_total;
        if (mode === 'C') {
            if (m.u_max >= 3)        return 'pumping';   // muchas realidades compitiendo
            if (f > 0.45)            return 'locked';    // alguien a punto de conquistar
            if (f > 0.1)             return 'active';
            return 'nucleating';
        }
        if (f > 0.5)                 return 'collapse';  // (transitorio) cruzó el umbral → inversión
        if (f > 0.42)                return 'locked';    // punto crítico, a punto de invertir
        if (f > 0.15)                return 'pumping';   // la grieta devora con fuerza
        if (f > 0.03)                return 'active';    // grieta creciendo
        if (f > 0.0005)              return 'nucleating';// el puntito acaba de quebrarse
        return 'vacuum';                                 // superficie intacta (modo B en espera)
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function inject(name) {
        if (name === 'krank') {
            // provocar un quiebre (sobre todo para modo B)
            seedCrack(crackReality);
        } else if (name === 'sembrar') {
            // meter una realidad nueva de color aleatorio (Babel)
            const r = (Math.random()*realityHue.length)|0;
            seedCrack(r);
        } else if (name === 'invertir') {
            // forzar la inversión ya
            if (mode === 'C') {
                // que gane la realidad con más territorio
                const counts={}; for(let i=0;i<T;i++) if(crack[i]>0.5){const r=realityId[i];counts[r]=(counts[r]||0)+1;}
                let win=crackReality,mx=-1; for(const r in counts) if(counts[r]>mx){mx=counts[r];win=parseInt(r);}
                conquerBabel(win);
            } else {
                doInversion();
            }
        }
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  SNAPSHOTS
    // ══════════════════════════════════════════════════════════
    function getState() {
        return {
            mode, surfaceReality, crackReality, frame, inversionCount,
            crack: new Float32Array(crack),
            realityId: new Int8Array(realityId),
        };
    }
    function setState(s) {
        if (s.mode) mode = s.mode;
        if (typeof s.surfaceReality==='number') surfaceReality = s.surfaceReality;
        if (typeof s.crackReality==='number') crackReality = s.crackReality;
        if (typeof s.frame==='number') frame = s.frame;
        if (typeof s.inversionCount==='number') inversionCount = s.inversionCount;
        computeMembrane();
        if (s.crack) crack.set(s.crack);
        if (s.realityId) realityId.set(s.realityId);
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  API PÚBLICA
    // ══════════════════════════════════════════════════════════
    return {
        step, refresh, getMetrics, classifyState, inject, seed,
        initSeed: seed,
        getState, setState,
        loadState(s) { this.setState(s); },
        savePrev() {},
        applyParams(p) {
            const oF=P.FRACTAL, oC=P.C_PARAM, oD=P.DETALLE;
            Object.assign(P, p);
            // si cambió algo que define la membrana fractal, recalcular
            if (P.FRACTAL!==oF || P.C_PARAM!==oC || P.DETALLE!==oD) {
                computeMembrane();
                refresh();
            }
        },
        getParams() { return {...P}; },
    };
}
