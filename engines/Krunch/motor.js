// ══════════════════════════════════════════════════════════════
//  AtOhmEter — KRUNCH
//
//  "El cristal que se astilla"
//  (inspiración visual: un render de Velvet — un cubo de cristal azul
//   con grietas de vidrio estrellado abriéndose a un corazón fractal)
//
//  Una realidad de cristal liso. Acumula tensión hasta que en un punto
//  ¡KRUNCH! — se astilla. Pero no se rompe como blob: se estrella como
//  vidrio templado, en VENAS angulosas finas que se bifurcan en líneas
//  rectas. Por las astillas no se ve vacío: se ve OTRA realidad, de otro
//  color, cuyo corazón es una esponja de Menger — cubos dentro de cubos.
//
//  Las astillas crecen, ramifican, devoran el cristal. Cuando la otra
//  realidad ocupa más de la mitad, OCURRE LA INVERSIÓN: lo que asomaba
//  por las grietas se vuelve el cristal, y el cristal viejo pasa a ser
//  el corazón oculto. Nuevo punto de tensión, y ¡KRUNCH! otra vez — pero
//  ahora las astillas muestran el color anterior. Cristal que respira.
//
//  ── Diferencia clave con KRANK (que crecía como espuma) ──────
//  KRANK propagaba la fractura por difusión isótropa a 6 vecinos → blobs.
//  KRUNCH propaga por VENAS ANGULARES: la grieta elige pocas direcciones
//  y avanza RECTO, bifurcándose de vez en cuando. Eso da vidrio estrellado
//  (líneas finas nítidas), no espuma. Y el núcleo es un campo de Menger
//  que se REVELA (es lo que se renderiza), no un mapa de pesos.
//
//  ── Las dos fuerzas: TENSIÓN vs RECOCIDO ─────────────────────
//  TENSIÓN  — el cristal acumula estrés; las astillas se extienden (PRESION).
//  RECOCIDO — el cristal se "sana", las astillas se recierran (CURACION).
//
//  ── Modos (semillas) ─────────────────────────────────────────
//    A · Vigilia — el ciclo de astillado e inversión, automático y eterno.
//    B · Sísmico — el cristal está tenso; TÚ das el golpe (inyección KRUNCH).
//    C · Babel   — varios cristales de colores se astillan y compiten;
//                  el que conquista el volumen se vuelve cristal universal.
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        FRACTAL:   3,      // profundidad de recursión del Menger (1..4). "DNA" del núcleo.
        RAMIFICA:  0.12,   // probabilidad de que una vena se bifurque
        PRESION:   0.9,    // TENSIÓN: cuántas celdas avanza el frente de astillas por paso
        CURACION:  0.003,  // RECOCIDO: cuánto se recierran las astillas
        DETALLE:   3,      // escala del Menger (tamaño de los cubos base)
        DT:        1.0,
        THRESH:    0.06,
    };

    // ── Campos ───────────────────────────────────────────────────
    // core[i]: el campo de Menger (la otra realidad). Estático por FRACTAL/DETALLE.
    //   1 = material del cubo Menger; 0 = hueco recursivo.
    const core   = new Float64Array(T);
    // crack[i]: 0..1 cuánto se ha astillado esta celda (dinámico).
    const crack  = new Float64Array(T);
    // realityId[i]: en Babel, qué realidad (color) ocupa la astilla.
    const realityId = new Int8Array(T);

    // Frente de astillas activas: lista de "puntas" que avanzan en línea recta.
    // Cada punta = {x,y,z, dx,dy,dz, life, rid}. Esto produce VENAS, no difusión.
    let tips = [];

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    // ── Esponja de Menger 3D — el núcleo (la otra realidad) ──────
    // Un punto pertenece al material de Menger si, al escribir sus
    // coordenadas en base 3, en NINGÚN nivel los dos+ ejes caen en el
    // centro (dígito 1) simultáneamente. Da cubos-dentro-de-cubos.
    // depth = niveles de recursión; scale = tamaño del cubo base.
    function mengerValue(xi, yi, zi, depth, scale) {
        // mapear celda a coordenada entera en una grilla de 3^depth
        const size = Math.pow(3, depth);
        let x = Math.floor(xi / N * size);
        let y = Math.floor(yi / N * size);
        let z = Math.floor(zi / N * size);
        for (let d = 0; d < depth; d++) {
            const cx = x % 3, cy = y % 3, cz = z % 3;
            // un hueco de Menger: al menos dos ejes en el centro (1)
            let centers = 0;
            if (cx === 1) centers++;
            if (cy === 1) centers++;
            if (cz === 1) centers++;
            if (centers >= 2) return 0; // hueco
            x = Math.floor(x / 3);
            y = Math.floor(y / 3);
            z = Math.floor(z / 3);
        }
        return 1; // material
    }

    function computeCore() {
        const depth = Math.max(1, Math.min(4, Math.round(P.FRACTAL)));
        const scale = Math.max(1, Math.round(P.DETALLE));
        for (let xi=0;xi<N;xi++) for (let yi=0;yi<N;yi++) for (let zi=0;zi<N;zi++) {
            core[idx(xi,yi,zi)] = mengerValue(xi, yi, zi, depth, scale);
        }
    }

    let mode = 'A';
    let surfaceReality = 0;
    let crackReality   = 1;
    let frame = 0;
    let lastInversion = 0;
    let inversionCount = 0;
    const realityHue = [0.60, 0.08, 0.33, 0.85, 0.50]; // azul, naranja, verde, magenta, cyan

    // 26 direcciones discretas (vecinos incl. diagonales) para venas angulares
    const DIRS = [];
    for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) for (let dz=-1;dz<=1;dz++) {
        if (dx||dy||dz) DIRS.push([dx,dy,dz]);
    }
    // direcciones "rectas" (caras) — preferidas para que las venas sean nítidas
    const AXIAL = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

    function randDir() {
        // sesga hacia ejes (venas rectas), a veces diagonal
        if (Math.random() < 0.7) return AXIAL[(Math.random()*6)|0];
        return DIRS[(Math.random()*DIRS.length)|0];
    }

    // ── Sembrar un punto de astillado: nace una estrella de venas ──
    function seedKrunch(rid) {
        const cx = (Math.random()*N)|0, cy=(Math.random()*N)|0, cz=(Math.random()*N)|0;
        crack[idx(cx,cy,cz)] = 1.0;
        realityId[idx(cx,cy,cz)] = rid;
        // lanzar 3-6 venas iniciales en direcciones distintas (estrella de fractura)
        const n = 3 + ((Math.random()*4)|0);
        for (let k=0;k<n;k++) {
            const d = randDir();
            tips.push({ x:cx, y:cy, z:cz, dx:d[0], dy:d[1], dz:d[2], life: 8 + (Math.random()*12|0), rid });
        }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP
    // ══════════════════════════════════════════════════════════
    function step() {
        frame++;
        const cura = P.CURACION;
        const advance = Math.max(1, Math.round(P.PRESION + 0.5)); // celdas por punta por paso

        // ── Avanzar las venas (frente de astillas) ──
        const newTips = [];
        for (const tip of tips) {
            if (tip.life <= 0) continue;
            for (let s=0;s<advance;s++) {
                tip.x += tip.dx; tip.y += tip.dy; tip.z += tip.dz;
                const i = idx(tip.x, tip.y, tip.z);
                crack[i] = 1.0;
                if (realityId[i] === 0) realityId[i] = tip.rid;
                // halo fino: astillar las 6 celdas adyacentes a la vena, pero
                // SOLO donde el núcleo Menger tiene material (revela el cubo,
                // mantiene el look de vena gruesa-pero-nítida, no espuma).
                const ax=tip.x, ay=tip.y, az=tip.z;
                for (const [hx,hy,hz] of AXIAL) {
                    const j = idx(ax+hx, ay+hy, az+hz);
                    if (core[j] > 0.5 && crack[j] < 0.5) {
                        crack[j] = 0.8;
                        if (realityId[j] === 0) realityId[j] = tip.rid;
                    }
                }
            }
            tip.life--;
            // bifurcación: la vena se parte en dos (vidrio estrellado)
            if (Math.random() < P.RAMIFICA && tip.life > 2) {
                const d = randDir();
                newTips.push({ x:tip.x, y:tip.y, z:tip.z, dx:d[0], dy:d[1], dz:d[2], life: (tip.life*0.8)|0, rid: tip.rid });
            }
            if (tip.life > 0) newTips.push(tip);
        }
        tips = newTips;

        // mientras la fractura siga creciendo (en A y C), van naciendo nuevas
        // venas desde celdas ya astilladas → la grieta se extiende sin volverse
        // espuma (cada vena nueva es una línea, no un relleno).
        if (mode !== 'B' && tips.length < 24 && frame % 2 === 0) {
            // elegir una celda astillada al azar como nuevo origen de vena
            let origin = -1;
            for (let tries=0; tries<12; tries++) {
                const i = (Math.random()*T)|0;
                if (crack[i] > 0.5) { origin = i; break; }
            }
            if (origin >= 0) {
                const ox=(origin/(N*N))|0, oy=((origin/N)|0)%N, oz=origin%N;
                const d = randDir();
                tips.push({ x:ox, y:oy, z:oz, dx:d[0], dy:d[1], dz:d[2], life: 6+(Math.random()*10|0), rid: realityId[origin]||crackReality });
            }
        }

        // ── RECOCIDO: las astillas finas se recierran lentamente ──
        // (solo donde no hay punta activa cerca; da el equilibrio de fuerzas)
        if (cura > 0) {
            for (let i=0;i<T;i++) {
                if (crack[i] > 0 && crack[i] < 1) crack[i] = Math.max(0, crack[i]-cura);
                else if (crack[i] === 1 && Math.random() < cura*0.5) crack[i] = 0.95; // empieza a sanar
            }
        }

        // ── Ciclo de inversión ──
        // El cristal cede cuando la RED de grietas lo atraviesa — no cuando
        // el 50% del volumen es polvo (las venas son líneas, nunca llenarían
        // el volumen). Medimos la extensión espacial: si la grieta abarca
        // suficiente del cubo en las 3 dimensiones, el cristal se parte.
        if (mode === 'A') {
            const ext = crackExtent();
            if (ext.span > 0.62 && ext.count > T * 0.012) doInversion();
            if (ext.count < 2 && tips.length === 0 && frame - lastInversion > 8) {
                seedKrunch(crackReality);
            }
        } else if (mode === 'C') {
            const counts = {}; let total=0;
            const spanById = {};
            for (let i=0;i<T;i++) if (crack[i]>0.5){ const r=realityId[i]; counts[r]=(counts[r]||0)+1; total++; }
            let leader=-1, leadN=0, secondN=0;
            for (const r in counts) {
                if (counts[r]>leadN){ secondN=leadN; leadN=counts[r]; leader=parseInt(r); }
                else if (counts[r]>secondN) secondN=counts[r];
            }
            // en Babel conquista el que tiene más territorio cuando el cristal
            // ya está muy agrietado en conjunto
            if (leader>=0 && total > T*0.025 && leadN > secondN*1.5) {
                conquerBabel(leader);
            }
            if (Object.keys(counts).length < 3 && tips.length < 4 && frame % 18 === 0) {
                seedKrunch((Math.random()*realityHue.length)|0);
            }
        }
        // modo B: todo lo provoca el usuario
    }

    // Extensión espacial de la grieta: bounding box normalizado [0,1] y conteo.
    // span = la mayor dimensión del bounding box (qué tanto del cubo atraviesa).
    function crackExtent() {
        let minx=N,miny=N,minz=N,maxx=-1,maxy=-1,maxz=-1,count=0;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            if (crack[idx(x,y,z)] > 0.5) {
                if(x<minx)minx=x; if(x>maxx)maxx=x;
                if(y<miny)miny=y; if(y>maxy)maxy=y;
                if(z<minz)minz=z; if(z>maxz)maxz=z;
                count++;
            }
        }
        if (count === 0) return { span:0, count:0 };
        const sx=(maxx-minx)/N, sy=(maxy-miny)/N, sz=(maxz-minz)/N;
        return { span: Math.max(sx,sy,sz), count };
    }

    function doInversion() {
        const tmp = surfaceReality;
        surfaceReality = crackReality;
        crackReality = (tmp + 1) % realityHue.length;
        crack.fill(0); realityId.fill(0); tips = [];
        lastInversion = frame; inversionCount++;
        seedKrunch(crackReality);
    }

    function conquerBabel(winner) {
        surfaceReality = winner;
        crack.fill(0); realityId.fill(0); tips = [];
        lastInversion = frame; inversionCount++;
        for (let k=0;k<3;k++) {
            let r; do { r=(Math.random()*realityHue.length)|0; } while (r===winner);
            seedKrunch(r);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    //  COLOR: hue de la realidad (superficie o astilla).
    //  BRILLO: cristal liso = muy tenue; VENA de astilla = brilla nítida;
    //          el núcleo Menger visto por la grieta = cubos luminosos.
    // ══════════════════════════════════════════════════════════
    function refresh() {
        const surfHue = realityHue[surfaceReality];
        for (let i=0;i<T;i++) {
            const ci = crack[i];
            let hue, bright;
            if (ci > 0.05) {
                // astillado: muestra la otra realidad. El núcleo Menger brilla;
                // los huecos del Menger dejan ver más profundo (más tenue).
                const rid = (mode === 'C') ? realityId[i] : crackReality;
                hue = realityHue[rid];
                const menger = core[i];                  // 1 material, 0 hueco
                bright = ci * (0.25 + 0.75 * menger);    // las venas+material brillan
            } else {
                // cristal liso: tenue, con un fantasma sutil del Menger interior
                hue = surfHue;
                bright = 0.06 + 0.04 * core[i];
            }
            renderVolume[i] = Math.min(1, bright);
            phaseData[i] = hue;
        }
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS = MODOS
    // ══════════════════════════════════════════════════════════
    function reset() {
        crack.fill(0); realityId.fill(0); tips = [];
        frame=0; lastInversion=0; inversionCount=0;
        surfaceReality=0; crackReality=1;
    }
    function seedVigilia() { mode='A'; reset(); computeCore(); seedKrunch(crackReality); }
    function seedSismico() { mode='B'; reset(); computeCore(); }
    function seedBabel()   { mode='C'; reset(); computeCore(); for(let k=1;k<=3;k++) seedKrunch(k%realityHue.length); }

    function seed(name) {
        if      (name==='vigilia') seedVigilia();
        else if (name==='sismico') seedSismico();
        else if (name==='babel')   seedBabel();
        else                       seedVigilia();
        refresh();
    }

    computeCore();
    seed('vigilia');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let fractured=0, veins=0, coreShown=0;
        const realities = new Set();
        for (let i=0;i<T;i++) {
            const ci = crack[i];
            if (ci > 0.5) { fractured++; realities.add(realityId[i]); if (core[i]>0.5) coreShown++; }
            if (ci > 0.05 && ci < 0.95) veins++;
        }
        const fracFrac = fractured / T;
        return {
            E_total:   fracFrac,                 // territorio astillado [0,1]
            E_kin:     tips.length / 50,         // venas activas (normalizado)
            E_torsion: coreShown / T,            // cuánto núcleo Menger se ve
            E_phase:   veins / T,                // perímetro de astillas
            helicity:  0,
            boundary:  fracFrac,
            pump:      inversionCount,
            u_max:     mode==='C' ? realities.size : tips.length,
            th_max:    surfaceReality,
            phi_max:   crackReality,
            psiMax:    fracFrac,
            coherence: 1 - Math.abs(fracFrac - 0.5) * 2,
            vortices:  fractured,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        const f = m.E_total;
        if (mode === 'C') {
            if (m.u_max >= 3)  return 'pumping';
            if (f > 0.45)      return 'locked';
            if (f > 0.1)       return 'active';
            return 'nucleating';
        }
        if (f > 0.5)    return 'collapse';
        if (f > 0.42)   return 'locked';
        if (f > 0.15)   return 'pumping';
        if (f > 0.03)   return 'active';
        if (f > 0.0005) return 'nucleating';
        return 'vacuum';
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function inject(name) {
        if (name === 'krunch') {
            seedKrunch(crackReality);
        } else if (name === 'sembrar') {
            seedKrunch((Math.random()*realityHue.length)|0);
        } else if (name === 'invertir') {
            if (mode === 'C') {
                const counts={}; for(let i=0;i<T;i++) if(crack[i]>0.5){const r=realityId[i];counts[r]=(counts[r]||0)+1;}
                let win=crackReality,mx=-1; for(const r in counts) if(counts[r]>mx){mx=counts[r];win=parseInt(r);}
                conquerBabel(win);
            } else doInversion();
        }
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  SNAPSHOTS (para replay)
    // ══════════════════════════════════════════════════════════
    function getState() {
        return {
            mode, surfaceReality, crackReality, frame, inversionCount,
            crack: new Float32Array(crack),
            realityId: new Int8Array(realityId),
            tips: tips.map(t => ({...t})),
        };
    }
    function setState(s) {
        if (s.mode) mode = s.mode;
        if (typeof s.surfaceReality==='number') surfaceReality = s.surfaceReality;
        if (typeof s.crackReality==='number') crackReality = s.crackReality;
        if (typeof s.frame==='number') frame = s.frame;
        if (typeof s.inversionCount==='number') inversionCount = s.inversionCount;
        computeCore();
        if (s.crack) crack.set(s.crack);
        if (s.realityId) realityId.set(s.realityId);
        tips = s.tips ? s.tips.map(t => ({...t})) : [];
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
            const oF=P.FRACTAL, oD=P.DETALLE;
            Object.assign(P, p);
            if (P.FRACTAL!==oF || P.DETALLE!==oD) { computeCore(); refresh(); }
        },
        getParams() { return {...P}; },
    };
}
