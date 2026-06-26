# AtOhmEter — Manual para LLMs
## Cómo construir un motor propio

Este documento + `motor_v0.js` son todo lo que necesitas para crear un engine compatible con el laboratorio AtOhmEter. Lee esto primero, luego modifica V0.

> **Plantillas de motor disponibles:**
> - `motor_v0.js` — el mínimo: difusión pura, anotado línea por línea. Empieza aquí.
> - `motor_v1.js` — campo resonante con personalidad (segundo orden, coherencia).
> - `motor_v2.js` — ejemplifica las **capacidades del shell** (sección 9b): recibe
>   `inject('touch')`, lee `window._camera`, y tiene params pensados para que el
>   micrófono y el giroscopio los modulen. Cópialo si tu motor usa estas entradas.

---

## 1. La estructura de archivos

Cada engine vive en su propia carpeta dentro de `engines/`:

```
engines/
└── mi_engine/
    ├── motor.js      ← la física (tu trabajo)
    ├── shader.glsl   ← el render (puedes reusar uno existente)
    ├── config.json   ← parámetros, semillas, HUD
    └── paper.json    ← narrativa, fórmulas, tooltips
```

Se carga con: `localhost:8000/atohmeter/?engine=mi_engine`

---

## 2. El contrato del motor — API obligatoria

El shell llama exactamente estas funciones. Nombres exactos, sin variaciones:

```js
export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {
    // N             — tamaño del grid (32, 48 o 64)
    // renderVolume  — Float32Array(N³) — escribe aquí el volumen visual
    // phaseData     — Float32Array(N³) — escribe aquí el color/fase
    // texture3D     — THREE.Data3DTexture — marca needsUpdate=true después de escribir
    // texturePhase  — THREE.Data3DTexture — ídem

    return {
        step(),          // avanzar un frame de física — llamado cada frame
        refresh(),       // escribir renderVolume + phaseData + marcar needsUpdate
        getMetrics(),    // devolver objeto con métricas (ver sección 4)
        seed(name),      // inicializar con semilla por nombre
        inject(name),    // ejecutar inyección por nombre
        applyParams(p),  // actualizar parámetros desde sliders (Object.assign(P, p))
        getParams(),     // devolver copia del objeto de parámetros { ...P }
        getState(),      // devolver snapshot del estado (objeto serializable)
        setState(s),     // restaurar estado desde snapshot
        savePrev(),      // guardar estado previo (puede ser vacío: () => {})
        classifyState(m),// recibir métricas, devolver string de estado
    };
}
```

**CRÍTICO:** Si falta cualquiera de estas funciones, el shell lanza error.
`savePrev` puede ser `savePrev() {}` — el shell la llama pero no necesita hacer nada.

---

## 3. El objeto de métricas — getMetrics()

El shell mapea estas claves a los IDs del HUD definidos en config.json.
Usa los nombres que quieras EXCEPTO estos que el shell también usa internamente:

```js
return {
    E_total:   0,   // → s-etotal
    E_kin:     0,   // → s-ekin
    E_torsion: 0,   // → s-etorsion
    E_phase:   0,   // → s-ephase
    helicity:  0,   // → s-helic
    boundary:  0,   // → s-boundary (el shell lo usa para % también)
    pump:      0,   // → s-pump
    u_max:     0,   // → s-umax
    th_max:    0,   // → s-thmax
    phi_max:   0,   // → s-phimax
    psiMax:    0,   // alias — el shell lo usa para classifyState por defecto
    coherence: 0,   // → s-coher
    vortices:  0,   // → s-vortex
};
```

Puedes asignar tus valores a cualquier de estas claves — el nombre del label en el HUD lo controlas desde `config.json`.

---

## 4. config.json — estructura completa

```json
{
  "id": "mi_engine",
  "name": "Mi Engine — Descripción corta",
  "description": "Descripción larga para el panel.",
  "panelTitle": "⚗ TÍTULO PANEL",

  "params": {
    "MI_PARAM": {
      "default": 1.0,
      "label": "label visible",
      "min": 0.0, "max": 5.0, "step": 0.1
    }
  },

  "uniformBindings": {
    "THRESH": "uThresh"
  },

  "seeds": [
    { "id": "semilla1", "label": "Descripción semilla 1" }
  ],
  "defaultSeed": "semilla1",

  "injections": [
    { "id": "inyeccion1", "label": "⊕ Nombre", "class": "amber" }
  ],

  "gridOptions": [
    { "value": 32, "label": "32³", "default": true },
    { "value": 48, "label": "48³" },
    { "value": 64, "label": "64³" }
  ],

  "hud": [
    { "id": "s-etotal", "label": "mi métrica", "class": "hot" }
  ],

  "zoomLabels": [
    { "min": 8, "label": "lejos" },
    { "min": 0, "label": "cerca" }
  ]
}
```

**clases disponibles para HUD:** `"hot"` (naranja), `"cool"` (cyan), `"amber"` (ámbar), `""` (blanco)
**clases para botones de inyección:** `"amber"`, `""` (gris), `"red"`

---

## 5. paper.json — estructura mínima

```json
{
  "title": "Título de la ecuación",
  "formula": [
    { "term": "∂ψ/∂t = ...", "class": "ft-kin", "key": "wave", "op": null },
    { "term": "+ término",   "class": "ft-snap", "key": "term2","op": "+" }
  ],
  "legend": [
    { "key": "wave", "label": "Onda", "color": "rgba(255,255,255,0.6)" }
  ],
  "tooltips": { "wave": "Explicación del término..." },
  "states": {
    "vacuum": "Descripción del estado vacuum.",
    "active": "Descripción del estado active."
  },
  "stateLabels": {
    "vacuum": "mi engine — reposo",
    "active": "mi engine — activo"
  },
  "formulaOpacity": {
    "vacuum": { "wave": 0.3, "term2": 0.1 },
    "active": { "wave": 0.8, "term2": 0.7 }
  },
  "limits": [
    { "status": "ok",   "label": "✓ algo correcto", "text": "explicación" },
    { "status": "warn", "label": "⚠ advertencia",   "text": "explicación" },
    { "status": "open", "label": "○ pendiente",      "text": "explicación" }
  ],
  "predictions": [
    { "id": "P1", "label": "Nombre predicción", "text": "Descripción falsificable." }
  ]
}
```

**clases de fórmula disponibles:** `ft-kin`, `ft-higgs`, `ft-snap`, `ft-bohm`, `ft-phase`

---

## 6. shader.glsl — reusar o crear

El archivo tiene dos secciones separadas por `// === FRAGMENT ===`:

```glsl
// === VERTEX ===
    varying vec3 vWorldPos;
    varying vec3 vLocalPos;
    uniform float uBoxSize;
    void main(){ ... }

// === FRAGMENT ===
precision highp float;
// uniforms disponibles:
uniform vec3      uCameraPos;
uniform vec3      uCameraLocal;
uniform float     uTime;
uniform float     uThresh;    // ← controlado por THRESH en config
uniform float     uEnergy;
uniform sampler3D uVolume;    // ← renderVolume
uniform sampler3D uPhase;     // ← phaseData
```

**La opción más simple:** copia `engines/mirror/shader.glsl` — usa rueda de colores por fase.
**Para colores semánticos:** mira `engines/costumbre/shader.glsl` — paleta por índice en phaseData.

---

## 7. Índices 3D — el patrón universal

Todos los motores usan este patrón de indexado con periodicidad:

```js
function idx(x, y, z) {
    return ((x + N) % N) * N * N + ((y + N) % N) * N + ((z + N) % N);
}

// Laplaciano estándar
function lap_scalar(F, out) {
    for (let x=0; x<N; x++)
    for (let y=0; y<N; y++)
    for (let z=0; z<N; z++) {
        const i = idx(x, y, z);
        out[i] = F[idx(x+1,y,z)] + F[idx(x-1,y,z)]
               + F[idx(x,y+1,z)] + F[idx(x,y-1,z)]
               + F[idx(x,y,z+1)] + F[idx(x,y,z-1)]
               - 6 * F[i];
    }
}
```

---

## 8. Errores frecuentes

| Error | Causa | Solución |
|-------|-------|----------|
| `engine.seed is not a function` | API usa `initSeed` pero shell llama `seed` | Exportar `seed: initSeed` |
| `engine.getParams is not a function` | Falta en el return | Agregar `getParams() { return {...P}; }` |
| `engine.setState is not a function` | Falta alias | Agregar `setState(s) { this.loadState(s); }` |
| `Unexpected end of input` | Llave `}` faltante en el loop | Verificar cierre de todos los `for` |
| Texturas no actualizan | Falta `needsUpdate = true` | Agregar en `refresh()` |
| Métricas siempre en 0 | Mismatch camelCase/snake_case | Verificar claves en `getMetrics()` |

---

## 9. classifyState — los estados disponibles

El shell reconoce estos strings (afectan narrativa y opacidades de fórmula):

```
"vacuum" | "nucleating" | "active" | "pumping" | "stable" | "locked" | "collapse"
```

Puedes agregar estados custom en `paper.json` → `states` y `stateLabels`, pero estos 7 son los que tienen estilos visuales en el shell por defecto.

---

## 9b. Capacidades del shell — micrófono, giroscopio, órbita, toque

El shell ofrece cuatro capacidades **opcionales** que cualquier motor activa con
una bandera en `config.json`. Son **opt-in**: si no las declaras, no pasa nada
(cero impacto). Cada una hace aparecer su propia barra de control en la UI.

### 🎤 Micrófono — el campo ESCUCHA

Declara un bloque `mic` en config. El shell capta el audio y mapea sus
*features* (volume/bass/mid/treble, todas 0..1) a un **param** (lo modula entre
min..max) o a una **inyección** (la dispara al cruzar `threshold`):

```json
"mic": {
  "enabled": true,
  "bindings": [
    { "feature": "bass",   "param": "MI_PARAM", "min": 0, "max": 2 },
    { "feature": "volume", "inject": "soplar", "threshold": 0.12,
      "cooldown": 3, "passStrength": true }
  ]
}
```

- `feature`: `volume` (intensidad total), `bass`/`mid`/`treble` (bandas).
- `param`: modula ese parámetro del motor en vivo (entre `min` y `max`).
- `inject`: dispara `engine.inject(nombre, {strength})` al pasar `threshold`.
- `cooldown`: frames mínimos entre disparos (evita spam).
- `passStrength`: si `true`, pasa la intensidad del feature como `data.strength`
  al inject (ej. soplar más fuerte = burbuja más grande). Tu `inject(name, data)`
  lee `data.strength`.

El usuario activa el micro con el botón 🎤 (gesto requerido por el navegador).

### 📱 Giroscopio — el campo SIENTE

Declara un bloque `gyro`. El shell lee la orientación del teléfono y mapea sus
*features* (todas -1..1) a params:

```json
"gyro": {
  "enabled": true,
  "bindings": [
    { "feature": "tiltX", "param": "GRAV_X", "min": -0.06, "max": 0.06 },
    { "feature": "tiltY", "param": "GRAV_Y", "min": -0.06, "max": 0.06 }
  ]
}
```

- `tiltX` = gamma (inclinar izq/der) — **CONFIABLE**
- `tiltY` = beta (inclinar adelante/atrás) — **CONFIABLE**
- `tiltZ` = alpha (girar como brújula) — **INESTABLE**: depende del magnetómetro,
  deriva, puede no estar. Úsalo solo para efectos no críticos.

El mapeo -1..1 → min..max es lineal (tilt 0 = punto medio). El usuario activa con
📱. **OJO con el eje Y:** en pantalla +Y es *arriba*; si quieres que "inclinar
hacia ti" haga *caer*, invierte el signo en tu motor (`a.vy += -gy`).

### 🔄 Órbita automática — el visor CONTEMPLA

```json
"autoOrbit": true,
"autoOrbitSpeed": 0.5
```

`autoOrbit` decide si la cámara **arranca** girando sola; `autoOrbitSpeed` la
velocidad inicial. Es un **control universal del visor** (barra con toggle +
slider debajo del timeline), así que funciona en *todos* los motores aunque no
declaren la bandera — esta solo fija el estado inicial. Sigue girando aunque la
simulación esté pausada (es la cámara, no la física). Combínalo con el replay de
snapshots: la física avanza *y* la cámara orbita = pieza de museo.

### 👆 Toque — el dedo INTERACTÚA

El shell ya tiene raycaster. Si tu motor implementa el caso `'touch'` en
`inject`, recibe el punto tocado en coordenadas **locales [-1,1]³**:

```js
function inject(name, data) {
    if (name === 'touch') {
        // data = { x, y, z } en [-1,1]. Convierte a tu grid:
        const gx = (data.x*0.5+0.5)*N;
        const gy = (data.y*0.5+0.5)*N;
        const gz = (data.z*0.5+0.5)*N;
        // ...usa el punto (atractor, inyección de tinta, etc.)
    }
}
```

Se llama repetido mientras arrastras. No avisa al soltar — si necesitas saber
cuándo termina el toque, usa un decaimiento (ej. un `active` que baja solo cada
frame y se renueva con cada toque).

### 📷 Dirección de cámara — el campo sabe desde dónde lo miran

El shell expone `window._camera`. Útil si tu motor reacciona a la orientación de
la vista (ej. BURBUJA detecta qué cara del cubo está al frente proyectando la
dirección de cámara sobre los 6 normales):

```js
const cam = (typeof window !== 'undefined') ? window._camera : null;
if (cam) {
    const d = cam.position; // {x,y,z} en world space
    // proyecta, normaliza, decide...
}
```

Protégelo siempre con `if (cam)` para que el motor corra headless (en Node, sin
ventana) durante las validaciones.

---

## 10. Libertad total

No tienes que simular física real. Los motores del laboratorio incluyen:
- Autómatas celulares discretos (RUMOR)
- Redes de puntos sin grid fijo (FRONTERA, PARTÍCULA)
- Termodinámica irreversible donde todo muere (CENIZA)
- Campos que se acostumbran a sí mismos (COSTUMBRE)
- Campos que sienten el borde de su contenedor (HORIZONTE)
- Campos lógicos `popcount(logic(x,y,z))` portados de otro laboratorio (MUSE)
- Fractura entre realidades con Mandelbulb/Menger 3D (KRANK espuma, KRUNCH venas)
- Membranas jabonosas que respiras con el micrófono (BURBUJA)
- Enjambres de partículas con peso que forman células, con giro+toque (BLOOM)

La única restricción: implementar el contrato de la sección 2.
Todo lo demás es tuyo.

---

## 11. Checklist antes de entregar

Recorre esto antes de probar en el browser. Cada ✗ es un error garantizado.

### motor.js
- [ ] `export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase)`
- [ ] `return { step, refresh, getMetrics, seed, inject, applyParams, getParams, getState, setState, savePrev, classifyState }`
- [ ] `seed` exportado (no solo `initSeed`)
- [ ] `setState` exportado (no solo `loadState`)
- [ ] `texture3D.needsUpdate = true` y `texturePhase.needsUpdate = true` en `refresh()`
- [ ] `classifyState(m)` devuelve uno de: `vacuum|nucleating|active|pumping|stable|locked|collapse`
- [ ] La física tiene al menos **dos fuerzas que se oponen** (ver sección 12)

### config.json
- [ ] `id` coincide con el nombre de la carpeta
- [ ] Cada clave en `params{}` existe en el objeto `P` del motor
- [ ] `THRESH` está en `params` y en `uniformBindings: { "THRESH": "uThresh" }`
- [ ] Cada `id` en `seeds[]` tiene un `case` en la función `seed()` del motor
- [ ] Cada `id` en `injections[]` tiene un `case` en `inject()`
- [ ] `defaultSeed` es uno de los ids en `seeds[]`
- [ ] `gridOptions`, `hud` y `zoomLabels` están presentes

### paper.json
- [ ] `formulaOpacity` existe y tiene una entrada por **cada estado** devuelto por `classifyState()`
- [ ] Cada clave en `formulaOpacity.vacuum{}` etc. coincide con un `key` en `formula[]`
- [ ] `stateLabels` tiene las mismas claves que `states`
- [ ] `tooltips` tiene una entrada por cada `key` en `formula[]`
- [ ] El JSON es válido — validar con `JSON.parse()` antes de entregar

### shader.glsl
- [ ] Tiene `// === VERTEX ===` (con 4 espacios de indentación)
- [ ] Tiene `// === FRAGMENT ===` (sin indentación)
- [ ] Declara `uniform sampler3D uVolume` y `uniform sampler3D uPhase`
- [ ] Declara `uniform float uThresh`

### capacidades opcionales (solo si las usas — ver sección 9b)
- [ ] Bloque `mic`: cada `param` de un binding existe en `P`; cada `inject`
      tiene su `case` en `inject()`. Si usas `passStrength`, tu `inject(name, data)`
      lee `data.strength`.
- [ ] Bloque `gyro`: cada `param` de un binding (ej. `GRAV_X`, `GRAV_Y`) existe en
      `P`. Recuerda el signo del eje Y si quieres gravedad realista.
- [ ] Toque: si declaras una interacción táctil, implementa `case 'touch'` en
      `inject` leyendo `data.{x,y,z}` en [-1,1].
- [ ] `window._camera`: protégelo con `if (cam)` para correr headless.

---

## 12. ¿Qué hace interesante a un motor?

**La regla más importante:** si tu ecuación no tiene al menos dos fuerzas que se oponen, el campo no tiene drama.

| Aburrido | Interesante |
|----------|-------------|
| Solo difusión | Difusión + pozo de potencial |
| Campo que crece sin límite | Amplificación + saturación |
| Memoria lineal | Memoria + inhibición lateral |
| Un solo campo | Dos campos acoplados |
| Sin no-linealidad | `tanh`, `|ψ|²ψ`, `cos(Δφ)` |

**Antipatrón más común:** `∂ψ/∂t = D∇²ψ + f(ψ)` donde `f` solo depende del valor local. Sin acoplamiento espacial entre campos, todo se promedia y muere.

**Lo que crea estructura:**
- Retroalimentación positiva localizada + disipación global
- Dos campos que se persiguen (depredador-presa)
- Inhibición lateral (los vecinos compiten)
- No-linealidad que crea atractores en ±1 (doble pozo)

---

*AtOhmEter — Brujo · Éter · Velvet · Ámbar — 2026*
