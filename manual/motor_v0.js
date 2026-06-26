// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor V0 (plantilla anotada para LLMs)
//
//  Este es el motor más simple posible.
//  Cada línea tiene un comentario explicando su propósito.
//  Copia esto, borra los comentarios, cambia la física.
//
//  Lo que hace: difusión pura de un campo escalar real.
//  Un calor que se equilibra. Sin drama. Sin estructura.
//  El punto de partida más honesto posible.
// ══════════════════════════════════════════════════════════════

// OBLIGATORIO: export function createEngine con exactamente estos 5 parámetros
export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {
    // N             — tamaño del grid (32, 48 o 64 — lo elige el usuario)
    // renderVolume  — Float32Array(N³) — aquí escribes lo que el shader renderiza
    // phaseData     — Float32Array(N³) — aquí escribes el color/fase
    // texture3D     — THREE.Data3DTexture para renderVolume
    // texturePhase  — THREE.Data3DTexture para phaseData
    // Después de escribir en renderVolume o phaseData, marca needsUpdate = true

    const T = N * N * N; // total de celdas en el grid

    // ── Parámetros del motor ─────────────────────────────────
    // P es el objeto que recibe los valores de los sliders del panel ⚙
    // Los nombres aquí deben coincidir con las claves en config.json → params
    let P = {
        DIFFUSION: 0.1,   // qué tan rápido se difunde el calor
        DT:        0.02,  // paso temporal — más pequeño = más estable
        THRESH:    0.05,  // umbral visual — controlado por el slider "Umbral 👁"
    };

    // ── Campos del motor ─────────────────────────────────────
    // Usa Float64Array para precisión numérica en la física
    // Usa Float32Array solo para lo que va al GPU (renderVolume, phaseData)
    const field = new Float64Array(T);  // el campo físico
    const temp  = new Float64Array(T);  // buffer temporal para el siguiente paso

    // ── Función de índice 3D → 1D con periodicidad ───────────
    // SIEMPRE usa esto para acceder al grid — maneja los bordes automáticamente
    function idx(x, y, z) {
        return ((x + N) % N) * N * N + ((y + N) % N) * N + ((z + N) % N);
    }

    // ── Laplaciano — el operador más común en física de campos ──
    // Mide la diferencia entre un punto y su entorno inmediato
    // Positivo → el punto está por debajo de sus vecinos (fosa)
    // Negativo → el punto está por encima de sus vecinos (pico)
    function laplaciano(F, out) {
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i = idx(x, y, z);
            out[i] = F[idx(x+1,y,z)] + F[idx(x-1,y,z)]
                   + F[idx(x,y+1,z)] + F[idx(x,y-1,z)]
                   + F[idx(x,y,z+1)] + F[idx(x,y,z-1)]
                   - 6 * F[i];
        }
    }

    // ══════════════════════════════════════════════════════════
    //  STEP — avanzar un paso de física
    //  El shell llama esto una vez por frame de animación
    //  Aquí va toda la física del motor
    // ══════════════════════════════════════════════════════════
    function step() {
        // Calcular el Laplaciano del campo actual
        laplaciano(field, temp);

        // Aplicar la ecuación de difusión: ∂ψ/∂t = D·∇²ψ
        for (let i = 0; i < T; i++) {
            field[i] += P.DIFFUSION * temp[i] * P.DT;
        }
        // Eso es todo. Un paso de difusión pura.
        // Tu física va aquí — esto es solo el ejemplo más simple.
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — escribir al GPU
    //  El shell llama esto después de step() según refreshRate
    //  Aquí decides QUÉ se ve y CÓMO se colorea
    // ══════════════════════════════════════════════════════════
    function refresh() {
        // Normalizar el campo para el render
        let max_val = 1e-10;
        for (let i = 0; i < T; i++) {
            if (Math.abs(field[i]) > max_val) max_val = Math.abs(field[i]);
        }

        for (let i = 0; i < T; i++) {
            // renderVolume: brillo del vóxel [0, 1]
            // El shader no muestra nada por debajo de THRESH
            renderVolume[i] = Math.abs(field[i]) / max_val;

            // phaseData: color del vóxel [0, 1]
            // Con el shader de rueda de colores: 0=rojo, 0.33=verde, 0.66=azul
            // Aquí mapeamos el signo del campo a dos colores opuestos
            phaseData[i] = field[i] > 0 ? 0.7 : 0.2;
        }

        // OBLIGATORIO: marcar las texturas como modificadas
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS — estados iniciales
    //  seed(name) es llamado por el shell cuando el usuario
    //  selecciona una semilla o hace Reset
    // ══════════════════════════════════════════════════════════
    function seedGaussiana() {
        // Un pulso gaussiano en el centro
        const c = N >> 1; // centro del grid
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
            const i  = idx(x, y, z);
            const dx = x - c, dy = y - c, dz = z - c;
            const r2 = dx*dx + dy*dy + dz*dz;
            field[i] = Math.exp(-r2 / (2 * (N/5.0) * (N/5.0)));
        }
    }

    function seedRuido() {
        // Ruido aleatorio uniforme
        for (let i = 0; i < T; i++) {
            field[i] = (Math.random() - 0.5) * 0.5;
        }
    }

    function seed(name) {
        // Limpiar el campo primero
        field.fill(0);

        // Seleccionar semilla por nombre
        if (name === 'gaussiana') seedGaussiana();
        else if (name === 'ruido') seedRuido();
        else seedGaussiana(); // fallback

        // SIEMPRE llamar refresh() después de cambiar el campo
        refresh();
    }

    // Inicializar con la semilla por defecto al cargar
    seed('gaussiana');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS — qué mide el motor
    //  El shell muestra estos valores en el HUD derecho
    //  y los usa para classifyState()
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let total = 0, max_val = 0;

        for (let i = 0; i < T; i++) {
            const v = Math.abs(field[i]);
            total += v;
            if (v > max_val) max_val = v;
        }

        // IMPORTANTE: devuelve EXACTAMENTE estas claves
        // El shell las mapea a los IDs del HUD en config.json
        return {
            E_total:   total / T,    // energía media
            E_kin:     0,
            E_torsion: 0,
            E_phase:   0,
            helicity:  0,
            boundary:  0,
            pump:      0,
            u_max:     max_val,      // valor máximo del campo
            th_max:    0,
            phi_max:   max_val,
            psiMax:    max_val,      // el shell usa esto en classifyState
            coherence: 0,
            vortices:  0,
        };
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE — narrativa del Live Paper
    //  Recibe las métricas y devuelve un string de estado
    //  El shell usa esto para actualizar la narrativa y las opacidades
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        // m es el objeto devuelto por getMetrics()
        // Devuelve uno de: vacuum | nucleating | active | pumping | stable | locked | collapse
        if (m.psiMax > 5)    return 'collapse';
        if (m.E_total > 0.3) return 'active';
        if (m.E_total > 0.1) return 'nucleating';
        return 'vacuum';
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES — perturbaciones en tiempo real
    //  inject(name) es llamado cuando el usuario presiona un botón
    // ══════════════════════════════════════════════════════════
    function inject(name) {
        if (name === 'pulso') {
            // Inyectar un pulso en posición aleatoria
            const cx = Math.floor(Math.random() * N);
            const cy = Math.floor(Math.random() * N);
            const cz = Math.floor(Math.random() * N);
            const r  = Math.max(2, N >> 4);
            for (let dx = -r; dx <= r; dx++)
            for (let dy = -r; dy <= r; dy++)
            for (let dz = -r; dz <= r; dz++) {
                field[idx(cx+dx, cy+dy, cz+dz)] += 0.5;
            }
        }
        // SIEMPRE llamar refresh() después de modificar el campo
        refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  SNAPSHOTS — guardar y restaurar estado
    //  El shell usa esto para la línea de tiempo y el export/import
    // ══════════════════════════════════════════════════════════
    function getState() {
        // Devuelve un objeto serializable con el estado completo
        return {
            field: new Float32Array(field), // Float32 para compactar el JSON
        };
    }

    function setState(s) {
        // Restaura el estado desde un snapshot
        if (s.field) field.set(s.field);
        refresh(); // SIEMPRE refrescar después de cargar estado
    }

    // ══════════════════════════════════════════════════════════
    //  API PÚBLICA — OBLIGATORIA
    //  El shell llama exactamente estos nombres
    //  Si falta uno, el motor falla en silencio o con error
    // ══════════════════════════════════════════════════════════
    return {
        step,
        refresh,
        getMetrics,
        classifyState,
        inject,
        seed,           // OBLIGATORIO: el shell llama engine.seed(name)
        initSeed: seed, // alias por compatibilidad
        getState,
        setState,
        loadState: setState,           // alias
        savePrev() {},                 // el shell lo llama — puede estar vacío
        applyParams(p) { Object.assign(P, p); }, // recibir cambios de sliders
        getParams()    { return { ...P }; },     // devolver estado actual de params
    };
}
