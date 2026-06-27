// ══════════════════════════════════════════════════════════════
//  AtOhmEter — AUGUR
//
//  "El campo que adivina"
//
//  Un campo que no evoluciona según lo que ES, sino según el
//  error entre lo que PREDIJO y lo que OCURRIÓ.
//
//  Cada región mantiene un modelo de lo que cree que va a pasar
//  en su vecindad. Cuando acierta, gana confianza y se vuelve
//  rígida — deja de aprender, se cristaliza, se queda ciega a
//  lo nuevo. Cuando se equivoca, permanece plástica, viva,
//  capaz de reorganizarse.
//
//  La estructura emerge en la frontera entre la certeza y la
//  sorpresa: ni el orden total (que es ceguera) ni el caos
//  total (que es ruido), sino ese borde estrecho — la ventana
//  de criticalidad donde un sistema procesa información sin
//  congelarse ni disolverse.
//
//  Un campo cuya única ley es minimizar su propia sorpresa,
//  y que nunca lo logra del todo.
//
//  ── Las dos fuerzas que se oponen ───────────────────────────
//  (1) MINIMIZAR SORPRESA — el acierto sube la confianza, la
//      confianza congela la celda. Empuja hacia el orden.
//  (2) LA SORPRESA QUE LLEGA — el mundo sigue cambiando bajo
//      la predicción. Toda rigidez es eventualmente refutada.
//      Empuja hacia la plasticidad.
//
//  El veredicto físico (lo que se renderiza) es la SORPRESA:
//  dónde el mundo desafió lo que se esperaba de él.
//
//  Ecuación informal:
//      pred(t)      = ⟨ψ⟩_vecinos                  (qué espero)
//      ψ(t+1)       = ψ + D·∇²ψ·(1−conf) + react   (cómo evoluciona,
//                                                    la rigidez frena)
//      surprise     = |ψ(t+1) − pred(t)|           (qué tan mal predije)
//      conf(t+1)    = conf·decay + (1−surprise)·γ  (acierto → confianza)
//
//  Demuestra:
//  ✓ Campo con modelo interno (predicción, no solo estado)
//  ✓ Dos fuerzas opuestas espaciales y no-locales
//  ✓ Observable emergente propio (sorpresa / error de predicción)
//  ✓ Auto-organización en el borde de criticalidad
//  ✓ Estado "locked" = certeza ciega; "collapse" = sorpresa total
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    // ── Parámetros — cada clave coincide con config.json → params ──
    let P = {
        DIFFUSION:  0.18,   // qué tan rápido se mezcla el campo con sus vecinos
        REACT:      0.9,    // no-linealidad que mantiene el campo vivo (atractores ±1)
        LEARN:      0.06,   // γ — ganar confianza es lento y costoso
        DECAY:      0.94,   // erosión de confianza — fuerte, para que la certeza sea perecedera
        RIGIDITY:   1.2,    // cuánto castiga el fallo al confiado (cristal frágil)
        NOISE:      0.025,  // sorpresa de fondo — el mundo nunca es del todo predecible
        DT:         0.5,    // paso de mezcla
        THRESH:     0.04,   // umbral visual
    };

    // ── Campos del motor ─────────────────────────────────────
    const psi      = new Float64Array(T);  // estado actual del campo
    const pred     = new Float64Array(T);  // lo que cada celda predijo de su vecindad
    const conf     = new Float64Array(T);  // confianza acumulada [0,1] — rigidez
    const surprise = new Float64Array(T);  // error de predicción (el observable)

    const next     = new Float64Array(T);  // buffer del próximo psi
    const seed_psi = new Float64Array(T);  // referencia para overlap/identidad

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    // Promedio de los 6 vecinos — esto es lo que cada celda usa
    // como su "predicción" del futuro local: espero parecerme a mi entorno.
    function neighborMean(F, x, y, z) {
        return (F[idx(x+1,y,z)] + F[idx(x-1,y,z)]
              + F[idx(x,y+1,z)] + F[idx(x,y-1,z)]
              + F[idx(x,y,z+1)] + F[idx(x,y,z-1)]) / 6.0;
    }

    // ══════════════════════════════════════════════════════════
    //  STEP — un paso del ciclo predicción → mundo → sorpresa → confianza
    // ══════════════════════════════════════════════════════════
    function step() {
        const dt = P.DT;

        // ── FASE 1: cada celda predice el futuro de su vecindad ──
        // La predicción es el promedio local actual: "espero que mi
        // entorno (y yo) tendamos hacia este valor".
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            pred[i] = neighborMean(psi, x, y, z);
        }

        // ── FASE 2: el mundo evoluciona ──
        // Difusión modulada por (1−conf·RIGIDITY): las celdas confiadas
        // se resisten al cambio (se han cristalizado). Las plásticas fluyen.
        // La reacción no-lineal evita que todo decaiga al promedio gris —
        // mantiene la dinámica viva (atractores en ±1, doble pozo suave).
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            const p = psi[i];

            // Laplaciano (mezcla con vecinos)
            const lap = neighborMean(psi, x, y, z) * 6.0 - 6.0 * p; // = Σvecinos − 6p

            // La rigidez frena el cambio: una celda muy confiada casi no se mueve
            const plasticity = 1.0 - conf[i] * P.RIGIDITY;

            // Reacción doble-pozo suave: empuja ψ hacia ±1, mantiene vida
            const react = P.REACT * p * (1.0 - p*p);

            // Ruido: el mundo nunca es perfectamente predecible
            const noise = (Math.random() - 0.5) * 2.0 * P.NOISE;

            next[i] = p + dt * plasticity * (P.DIFFUSION * lap + react) + noise;
        }

        // ── FASE 3: medir la sorpresa y actualizar confianza ──
        // surprise = qué tan lejos quedó el mundo de lo que la celda predijo.
        //
        // Aquí vive la tensión central, y es asimétrica a propósito:
        //
        //   ACERTAR sube la confianza poco a poco (LEARN).
        //   FALLAR la derrumba, y el golpe es MAYOR cuanto más confiada
        //   estaba la celda — la certeza es frágil. Una celda que "lo sabía
        //   todo" y se equivoca cae más duro que una humilde.
        //
        // Esto es lo que impide la cristalización permanente: una celda muy
        // confiada se vuelve rígida (deja de seguir al mundo en FASE 2), y al
        // dejar de seguirlo, tarde o temprano el mundo se le escapa y la
        // sorpresa la castiga con un costo proporcional a su propia soberbia.
        // La certeza siembra las condiciones de su refutación.
        for (let i=0;i<T;i++) {
            const s = Math.abs(next[i] - pred[i]);
            surprise[i] = s;

            const c0 = conf[i];

            // Umbral relativo: la sorpresa de fondo (ruido) no cuenta como fallo.
            const miss = s - P.NOISE * 2.0;

            let c;
            if (miss <= 0) {
                // Acierto: la confianza sube lentamente. Ganar certeza cuesta.
                c = c0 + (1.0 - c0) * P.LEARN;
            } else {
                // Fallo: caída proporcional al error Y a la confianza previa.
                // El (0.3 + c0) hace que los confiados caigan más duro —
                // cristal frágil. Un humilde apenas se inmuta; un soberbio
                // se hace añicos.
                c = c0 - miss * P.RIGIDITY * (0.3 + c0);
            }

            // Decay base: la certeza no re-confirmada se erosiona sola.
            c *= P.DECAY;

            if (c < 0.0) c = 0.0;
            if (c > 1.0) c = 1.0;
            conf[i] = c;

            psi[i] = next[i];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — escribir al GPU
    //  Volumen  = SORPRESA (el veredicto: dónde el mundo desafió lo esperado)
    //  Fase     = CONFIANZA (color: rojo plástico → azul cristalizado)
    // ══════════════════════════════════════════════════════════
    function refresh() {
        // Normalizar sorpresa para el render
        let smax = 1e-10;
        for (let i=0;i<T;i++) if (surprise[i] > smax) smax = surprise[i];

        for (let i=0;i<T;i++) {
            // Brillo = sorpresa normalizada. Brilla donde el mundo sorprendió.
            renderVolume[i] = surprise[i] / smax;

            // Color = confianza. En el shader de rueda de fase:
            //   conf baja (plástico, vivo)     → tonos cálidos
            //   conf alta (cristalizado, ciego) → tonos fríos
            // Mapeamos conf[0,1] a fase[0.0,0.66] para ir de rojo a azul.
            phaseData[i] = conf[i] * 0.66;
        }
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS
    // ══════════════════════════════════════════════════════════

    function clearAll() {
        psi.fill(0); pred.fill(0); conf.fill(0); surprise.fill(0); next.fill(0);
    }

    // Ruido total — el mundo arranca impredecible, máxima sorpresa.
    // Todos plásticos, nadie confía en nada. El orden tiene que ganarse.
    function seedRuido() {
        clearAll();
        for (let i=0;i<T;i++) psi[i] = (Math.random()-0.5) * 1.5;
        seed_psi.set(psi);
    }

    // Profecía — una región central ya ordenada (alta confianza) rodeada
    // de caos. La certeza intenta expandirse; la sorpresa la asedia.
    function seedProfecia() {
        clearAll();
        const c = N>>1;
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            const dx=x-c, dy=y-c, dz=z-c;
            const r2 = dx*dx+dy*dy+dz*dz;
            const core = Math.exp(-r2/(2*(N/6)**2));
            // Núcleo coherente (ψ ordenado, confianza alta) + halo de ruido
            psi[i]  = core - (1-core) * (Math.random()-0.5)*1.2;
            conf[i] = core * 0.9; // el centro nace ya "creyendo"
        }
        seed_psi.set(psi);
    }

    // Dos certezas — dos regiones confiadas con creencias opuestas (ψ=+1 y ψ=−1).
    // En la frontera entre ambas, cada una predice mal lo que ve de la otra:
    // la sorpresa vive en la costura del desacuerdo.
    function seedCismas() {
        clearAll();
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            const belief = x < N/2 ? 1.0 : -1.0;
            psi[i]  = belief * (0.8 + 0.2*Math.random());
            conf[i] = 0.7;
        }
        seed_psi.set(psi);
    }

    // Vacío plástico — campo casi nulo, confianza cero. Nada cree nada todavía.
    // Las fluctuaciones mínimas deciden qué estructura nuclea primero.
    function seedVacio() {
        clearAll();
        for (let i=0;i<T;i++) psi[i] = (Math.random()-0.5) * 0.05;
        seed_psi.set(psi);
    }

    function seed(name) {
        if      (name==='ruido')    seedRuido();
        else if (name==='profecia') seedProfecia();
        else if (name==='cismas')   seedCismas();
        else if (name==='vacio')    seedVacio();
        else                        seedRuido();
        // Inicializar predicción y sorpresa coherentes con el estado semilla
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            pred[i] = neighborMean(psi, x, y, z);
        }
        for (let i=0;i<T;i++) surprise[i] = Math.abs(psi[i] - pred[i]);
        refresh();
    }

    seed('ruido');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let surprise_total=0, surprise_max=0;
        let conf_total=0, conf_max=0;
        let rigid=0;       // fracción cristalizada (conf alta)
        let plastic=0;     // fracción plástica (conf baja)
        let critical=0;    // fracción en el borde (ni muy rígida ni muy plástica)
        let psi_max=0;
        let ov_num=0, ov_a=0, ov_b=0;

        for (let i=0;i<T;i++) {
            const s = surprise[i], c = conf[i];
            surprise_total += s; if (s > surprise_max) surprise_max = s;
            conf_total += c;     if (c > conf_max)     conf_max = c;
            if (c > 0.7)            rigid++;
            if (c < 0.2)            plastic++;
            if (c >= 0.3 && c <= 0.6) critical++;  // la ventana de criticalidad
            const a = Math.abs(psi[i]); if (a > psi_max) psi_max = a;
            ov_num += psi[i]*seed_psi[i];
            ov_a   += psi[i]*psi[i];
            ov_b   += seed_psi[i]*seed_psi[i];
        }

        return {
            E_total:   surprise_total/T,        // sorpresa media → "energía" del sistema
            E_kin:     plastic/T,               // fracción plástica (viva)
            E_torsion: critical/T,              // fracción en el borde crítico ← lo interesante
            E_phase:   conf_total/T,            // confianza media
            helicity:  0,
            boundary:  rigid/T,                 // fracción cristalizada (ciega)
            pump:      surprise_max,            // pico de sorpresa
            u_max:     psi_max,
            th_max:    conf_max,
            phi_max:   conf_total/T,
            psiMax:    surprise_max,            // el shell usa esto en classifyState
            coherence: Math.abs(ov_num/(Math.sqrt(ov_a*ov_b)+1e-12)),
            vortices:  critical,                // nº de celdas en criticalidad
        };
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE — la narrativa del campo que adivina
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        // m.E_total   = sorpresa media
        // m.boundary  = fracción cristalizada
        // m.E_torsion = fracción en el borde crítico
        // m.E_kin     = fracción plástica

        if (m.E_total > 0.6)        return 'collapse';   // sorpresa total — el modelo se rompió
        if (m.boundary > 0.55)      return 'locked';     // certeza ciega domina — cristalización
        if (m.E_torsion > 0.30)     return 'stable';     // mucha criticalidad — el borde fértil
        if (m.boundary > 0.20)      return 'pumping';    // la certeza se expande, asedia al caos
        if (m.E_total > 0.20)       return 'active';     // aprendiendo activamente
        if (m.E_total > 0.05)       return 'nucleating'; // primeras predicciones cuajando
        return 'vacuum';                                 // nadie cree nada aún
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES — perturbar el campo de creencias
    // ══════════════════════════════════════════════════════════
    function inject(name) {
        if (name === 'duda') {
            // Sembrar duda: derrumbar la confianza en una región aleatoria.
            // Las celdas cristalizadas vuelven a ser plásticas — pueden aprender de nuevo.
            const cx=Math.floor(Math.random()*N);
            const cy=Math.floor(Math.random()*N);
            const cz=Math.floor(Math.random()*N);
            const r=N>>3;
            for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
                const i=idx(cx+dx,cy+dy,cz+dz);
                conf[i] *= 0.1; // la duda erosiona la certeza
            }
        } else if (name === 'profecia') {
            // Inyectar una certeza súbita: una región se vuelve confiada de golpe.
            // Veremos si su creencia sobrevive al contacto con el mundo o se rompe.
            const cx=Math.floor(Math.random()*N);
            const cy=Math.floor(Math.random()*N);
            const cz=Math.floor(Math.random()*N);
            const r=N>>3;
            const belief = (Math.random()-0.5) > 0 ? 1.0 : -1.0;
            for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
                const i=idx(cx+dx,cy+dy,cz+dz);
                psi[i]  = belief;
                conf[i] = 0.95;
            }
        } else if (name === 'sismo') {
            // Sacudida global: una ola de sorpresa atraviesa todo el campo.
            // Pone a prueba qué creencias eran robustas y cuáles eran rigidez frágil.
            for (let i=0;i<T;i++) {
                psi[i] += (Math.random()-0.5) * 0.8;
            }
        }
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  SNAPSHOTS
    // ══════════════════════════════════════════════════════════
    function getState() {
        return {
            psi:  new Float32Array(psi),
            conf: new Float32Array(conf),
        };
    }
    function setState(s) {
        if (s.psi)  { psi.set(s.psi);  seed_psi.set(s.psi); }
        if (s.conf) conf.set(s.conf);
        for (let x=0;x<N;x++) for (let y=0;y<N;y++) for (let z=0;z<N;z++) {
            const i = idx(x,y,z);
            pred[i] = neighborMean(psi, x, y, z);
        }
        for (let i=0;i<T;i++) surprise[i] = Math.abs(psi[i] - pred[i]);
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
        applyParams(p) { Object.assign(P, p); },
        getParams()    { return {...P}; },
    };
}
