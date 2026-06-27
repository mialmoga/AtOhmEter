// ══════════════════════════════════════════════════════════════
//  AtOhmEter — MUSE
//
//  "El campo que nos inspiró otro laboratorio"
//
//  ── Crédito / inspiración ───────────────────────────────────
//  Este motor nace del diálogo con ŚN1E (Światło NOTREAL 1 ENGINE),
//  de Rafał Piotr Jakub Borkowski (2026) — https://tempolux.life/sn1e
//
//  En ŚN1E el "campo" que sienten las partículas no se calcula con
//  física: se GENERA con lógica booleana sobre las coordenadas. Cada
//  punto del espacio toma sus coordenadas discretizadas, les aplica
//  uno de los 16 operadores lógicos (AND, OR, XOR, NOR...), cuenta los
//  bits encendidos (popcount), y eso es el "voltaje" del campo ahí.
//  Un universo entero emergente de una sola operación de bits — sin
//  simular nada. El patrón ya vive en la aritmética; las partículas
//  solo lo revelan. Es platónico, atemporal, determinista.
//
//  MUSE toma esa idea (con todos los honores) y la lleva a 3D dentro
//  del caparazón procesual de AtOhmEter, donde preguntamos algo que
//  ŚN1E no pregunta: ¿qué pasa cuando el TIEMPO toca ese campo eterno?
//
//  ── Las dos fuerzas que se oponen: REVELACIÓN vs DERIVA ──────
//  REVELACIÓN — el paisaje lógico atrae; quiere que todo caiga en su
//               patrón. El orden atemporal imponiéndose.
//  DERIVA     — el tiempo erosiona; difusión, flujo y mutación de la
//               regla despegan las cosas del patrón puro.
//
//  El balance lo decide el MODO (semilla):
//    A · Atlas   — revelación pura. El campo ES el patrón lógico,
//                  estático. ŚN1E en 3D. La deriva es cero.
//    B · Terreno — el patrón lógico es el paisaje fijo; un polvo
//                  difunde y es atraído por su gradiente. Las dos
//                  fuerzas en tensión. El polvo dibuja la estructura.
//    C · Deriva  — la REGLA misma muta en el tiempo. El campo persigue
//                  un blanco móvil. La deriva gana terreno.
//
//  Geometría (cómo se combinan 3 ejes con un operador binario):
//    i  · encadenado  — logic(logic(wx,wy),wz)   (purista, fiel a ŚN1E)
//    ii · tres planos — Σ popcount sobre los 3 planos (isotrópico, rico)
//
//  El slider REGLA recorre los 16 operadores: es el "DNA" de Borkowski
//  hecho perilla. Mover esa perilla es recorrer su atlas, vivo.
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        RULE:       6,     // operador lógico 0-15 (6 = XOR). El "DNA" de Borkowski.
        GEOM:       0,     // 0 = encadenado (i), 1 = tres planos (ii)
        BITS:       5,     // resolución lógica del campo (zoom de Borkowski)
        DIFUSION:   0.15,  // (modo B) deriva: el polvo se esparce
        ATRACCION:  0.6,   // (modo B) revelación: el polvo cae al patrón
        MUTACION:   0.01,  // (modo C) qué tan rápido deriva la regla
        DT:         0.5,
        THRESH:     0.05,
    };

    // Campo lógico base (el paisaje de Borkowski, computado)
    const field = new Float64Array(T);   // V(x,y,z) ∈ [-1,1] aprox
    // Polvo (modo B) — materia que difunde sobre el paisaje
    const dust  = new Float64Array(T);
    const dnext = new Float64Array(T);

    // Estado de la regla en modo C (puede ser fraccionaria durante la deriva)
    let ruleFloat = 6.0;     // regla actual como float (para interpolar)
    let ruleTarget = 6.0;    // regla destino hacia la que deriva
    let tAccum = 0.0;

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    // ── applyLogic — el corazón de Borkowski ─────────────────────
    // Una de 16 operaciones lógicas sobre a,b. mask 0-15 = codificación
    // de 4 bits del mapa de Karnaugh:
    //   bit0 = NOR  (~a & ~b)
    //   bit1 = NIMPL(~a &  b)
    //   bit2 = NIMP ( a & ~b)
    //   bit3 = AND  ( a &  b)
    // XOR=0110(6), OR=1110(14), AND=1000(8), XNOR=1001(9), etc.
    function applyLogic(a, b, mask, bm) {
        let r = 0;
        if (mask & 1) r |= ((~a & bm) & (~b & bm));
        if (mask & 2) r |= ((~a & bm) & b);
        if (mask & 4) r |= (a & (~b & bm));
        if (mask & 8) r |= (a & b);
        return r >>> 0;
    }

    function popcount(x) {
        x = x >>> 0;
        let c = 0;
        while (x) { x &= x - 1; c++; }
        return c;
    }

    // Voltaje lógico en una celda, según geometría y regla.
    // ruleMask se pasa explícito para que modo C pueda usar regla mutante.
    function logicVoltage(wx, wy, wz, ruleMask, bits) {
        const bm = (1 << bits) - 1;
        if (P.GEOM < 0.5) {
            // i — encadenado: logic(logic(wx,wy),wz)
            const inner = applyLogic(wx, wy, ruleMask, bm);
            const outer = applyLogic(inner, wz, ruleMask, bm);
            const pc = popcount(outer);
            return (2 * pc - bits) / bits; // [-1,1]
        } else {
            // ii — tres planos: suma de popcounts de los 3 planos
            const pcxy = popcount(applyLogic(wx, wy, ruleMask, bm));
            const pcyz = popcount(applyLogic(wy, wz, ruleMask, bm));
            const pcxz = popcount(applyLogic(wx, wz, ruleMask, bm));
            // cada uno en [0,bits], suma en [0,3*bits] → centrar y normalizar
            const sum = pcxy + pcyz + pcxz;
            return (2 * sum - 3 * bits) / (3 * bits); // [-1,1]
        }
    }

    // Recalcular el campo lógico completo con la regla dada.
    // (modo A: regla fija; modo C: regla mutante por frame)
    function computeField(ruleMask) {
        const bits = Math.max(1, Math.min(12, Math.round(P.BITS)));
        const p = 1 << bits;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            // discretizar coordenada [0,N) → entero [0, 2^bits)
            const wx = Math.min(p-1, (x / N * p) | 0);
            const wy = Math.min(p-1, (y / N * p) | 0);
            const wz = Math.min(p-1, (z / N * p) | 0);
            field[idx(x,y,z)] = logicVoltage(wx, wy, wz, ruleMask, bits);
        }
    }

    let mode = 'A';

    // ══════════════════════════════════════════════════════════
    //  STEP — depende del modo
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;
        tAccum += dt;

        if (mode === 'A') {
            // ATLAS — revelación pura. El campo es el patrón, estático.
            // No evoluciona; solo "respira" levísimo para no estar muerto:
            // un parpadeo temporal sutil que no altera la estructura.
            // (computeField ya se llamó en seed; aquí no recalculamos)
            return;
        }

        if (mode === 'B') {
            // TERRENO — el polvo difunde (deriva) y cae al patrón (revelación).
            // field es el paisaje fijo. El polvo se mueve por dos fuerzas.
            const diff = P.DIFUSION, attr = P.ATRACCION;
            dnext.set(dust);
            for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
                const i = idx(x,y,z);
                const di = dust[i];
                if (di <= 1e-7) continue;
                const vi = field[i];

                const nb = [idx(x+1,y,z),idx(x-1,y,z),idx(x,y+1,z),idx(x,y-1,z),idx(x,y,z+1),idx(x,y,z-1)];
                let weights = [0,0,0,0,0,0], wsum = 0;
                for (let k=0;k<6;k++) {
                    // Revelación: el polvo prefiere vecinos con MENOR voltaje
                    // (los valles del patrón lógico). dv>0 si el vecino es más bajo.
                    const dv = vi - field[nb[k]];
                    const w = attr * Math.max(0, dv) + diff;  // atracción + difusión base
                    weights[k] = w; wsum += w;
                }
                if (wsum <= 0) continue;
                const moveTotal = Math.min(di * 0.5, di * wsum);
                for (let k=0;k<6;k++) {
                    const moved = moveTotal * (weights[k] / wsum);
                    dnext[i] -= moved;
                    dnext[nb[k]] += moved;
                }
            }
            for (let i=0;i<T;i++) dust[i] = Math.max(0, dnext[i]);
            return;
        }

        if (mode === 'C') {
            // DERIVA — la regla muta en el tiempo. El campo persigue un blanco.
            // ruleFloat deriva hacia ruleTarget; al llegar, elige nuevo destino.
            const speed = P.MUTACION;
            const d = ruleTarget - ruleFloat;
            if (Math.abs(d) < 0.02) {
                // llegó: nuevo destino aleatorio entre los 16 operadores
                ruleTarget = Math.floor(Math.random() * 16);
            } else {
                ruleFloat += Math.sign(d) * Math.min(Math.abs(d), speed);
            }
            // La regla efectiva es la entera más cercana, pero interpolamos el
            // campo entre la regla baja y la alta para que la mutación sea suave.
            const rLow = Math.floor(ruleFloat) & 15;
            const rHigh = Math.ceil(ruleFloat) & 15;
            const frac = ruleFloat - Math.floor(ruleFloat);
            const bits = Math.max(1, Math.min(12, Math.round(P.BITS)));
            const p = 1 << bits;
            for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
                const wx = Math.min(p-1, (x / N * p) | 0);
                const wy = Math.min(p-1, (y / N * p) | 0);
                const wz = Math.min(p-1, (z / N * p) | 0);
                const vLow  = logicVoltage(wx,wy,wz, rLow, bits);
                const vHigh = logicVoltage(wx,wy,wz, rHigh, bits);
                field[idx(x,y,z)] = vLow * (1-frac) + vHigh * frac;
            }
            P.RULE = rLow; // reflejar en el HUD
            return;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH
    //  Modo A/C: brillo = |campo lógico|, color = signo/valor del campo
    //  Modo B:   brillo = polvo acumulado, color = paisaje lógico debajo
    // ══════════════════════════════════════════════════════════
    function refresh() {
        if (mode === 'B') {
            let dmax = 1e-10;
            for (let i=0;i<T;i++) if (dust[i] > dmax) dmax = dust[i];
            for (let i=0;i<T;i++) {
                renderVolume[i] = dust[i] / dmax;       // polvo = brillo
                phaseData[i]    = field[i] * 0.5 + 0.5; // paisaje lógico = color
            }
        } else {
            // A y C: el campo lógico mismo es lo que se ve
            for (let i=0;i<T;i++) {
                const v = field[i];
                renderVolume[i] = Math.abs(v);          // intensidad del patrón
                phaseData[i]    = v * 0.5 + 0.5;        // signo/valor → color [0,1]
            }
        }
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS = MODOS
    // ══════════════════════════════════════════════════════════
    function seedAtlas() {
        mode = 'A';
        computeField(P.RULE & 15);
    }
    function seedTerreno() {
        mode = 'B';
        computeField(P.RULE & 15);
        // sembrar polvo uniforme que luego caerá al patrón
        for (let i=0;i<T;i++) dust[i] = 0.5 + 0.1*Math.random();
    }
    function seedDeriva() {
        mode = 'C';
        ruleFloat = P.RULE & 15;
        ruleTarget = Math.floor(Math.random() * 16);
        computeField(P.RULE & 15);
    }

    function seed(name) {
        if      (name === 'atlas')   seedAtlas();
        else if (name === 'terreno') seedTerreno();
        else if (name === 'deriva')  seedDeriva();
        else                         seedAtlas();
        refresh();
    }

    seed('atlas');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let f_total=0, f_abs=0, f_max=0, f_min=0;
        let structured=0;   // celdas con |campo| alto (patrón fuerte)
        let dust_total=0, dust_max=0, dust_conc=0;

        for (let i=0;i<T;i++) {
            const v = field[i];
            f_total += v; f_abs += Math.abs(v);
            if (v > f_max) f_max = v;
            if (v < f_min) f_min = v;
            if (Math.abs(v) > 0.5) structured++;
            const d = dust[i];
            dust_total += d; if (d > dust_max) dust_max = d;
        }
        // concentración del polvo: cuántas celdas tienen polvo notable
        if (mode === 'B') {
            const mean = dust_total / T;
            for (let i=0;i<T;i++) if (dust[i] > mean * 1.5) dust_conc++;
        }

        const structFrac = structured / T;
        return {
            E_total:   f_abs / T,               // "energía" = intensidad media del patrón
            E_kin:     mode==='B' ? dust_total/T : 0,
            E_torsion: structFrac,              // fracción estructurada
            E_phase:   (f_max - f_min) / 2,     // rango/contraste del campo
            helicity:  0,
            boundary:  mode==='B' ? dust_conc/T : structFrac,
            pump:      ruleFloat,               // (modo C) la regla actual mutante
            u_max:     f_max,
            th_max:    P.RULE,                  // operador actual
            phi_max:   dust_max,
            psiMax:    Math.max(Math.abs(f_max), Math.abs(f_min)),
            coherence: structFrac,
            vortices:  structured,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        if (mode === 'C') {
            // en deriva, el estado refleja cuánta estructura sobrevive a la mutación
            if (m.E_torsion > 0.35) return 'pumping';   // mutando con estructura rica
            if (m.E_torsion > 0.12) return 'active';     // mutando, estructura media
            return 'collapse';                           // la mutación destruyó el patrón
        }
        if (mode === 'B') {
            if (m.boundary > 0.10) return 'locked';      // polvo asentado en el patrón
            if (m.boundary > 0.04) return 'stable';      // figura formándose
            if (m.E_kin > 0.2)     return 'active';      // polvo aún moviéndose
            return 'nucleating';
        }
        // modo A — Atlas: el patrón es lo que es, estático
        if (m.E_total > 0.6)  return 'locked';    // patrón denso y fuerte
        if (m.E_total > 0.3)  return 'stable';    // patrón claro
        if (m.E_total > 0.08) return 'active';    // patrón tenue
        if (m.E_total > 0.01) return 'nucleating';
        return 'vacuum';                          // operador trivial (campo casi plano)
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES
    // ══════════════════════════════════════════════════════════
    function inject(name) {
        if (name === 'transmutar') {
            // saltar la REGLA a un operador aleatorio de golpe
            P.RULE = Math.floor(Math.random() * 16);
            if (mode === 'C') { ruleFloat = P.RULE; ruleTarget = Math.floor(Math.random()*16); }
            computeField(P.RULE & 15);
        } else if (name === 'sembrar') {
            // (modo B) inyectar polvo en una región aleatoria
            if (mode === 'B') {
                const cx=Math.floor(Math.random()*N), cy=Math.floor(Math.random()*N), cz=Math.floor(Math.random()*N);
                const r = N>>3;
                for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
                    dust[idx(cx+dx,cy+dy,cz+dz)] += 1.0;
                }
            }
        } else if (name === 'cuantizar') {
            // subir bits de golpe (zoom de resolución de Borkowski)
            P.BITS = Math.min(8, Math.round(P.BITS) + 1);
            computeField(P.RULE & 15);
        }
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  SNAPSHOTS
    // ══════════════════════════════════════════════════════════
    function getState() {
        return {
            mode,
            rule: P.RULE,
            ruleFloat,
            dust: mode==='B' ? new Float32Array(dust) : null,
        };
    }
    function setState(s) {
        if (s.mode) mode = s.mode;
        if (typeof s.rule === 'number') P.RULE = s.rule;
        if (typeof s.ruleFloat === 'number') ruleFloat = s.ruleFloat;
        computeField(P.RULE & 15);
        if (s.dust && mode==='B') dust.set(s.dust);
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
            const oldRule = P.RULE, oldGeom = P.GEOM, oldBits = P.BITS;
            Object.assign(P, p);
            // Si cambió algo que define el paisaje, recalcular (en A y B;
            // en C el step lo recalcula solo cada frame).
            if (mode !== 'C' && (P.RULE !== oldRule || P.GEOM !== oldGeom || P.BITS !== oldBits)) {
                computeField(P.RULE & 15);
                refresh();
            }
        },
        getParams() { return {...P}; },
    };
}
