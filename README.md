<div align="center">

# AtOhmEter 🦝

### Un laboratorio de física especulativa de bolsillo

*Cualquier campo, cualquier regla, cualquier idea —*
*si implementa el contrato, corre en tu navegador.*

[**▶ Demo en vivo**](https://mialmoga.github.io/AtOhmEter/) · [**📖 Manual**](https://mialmoga.github.io/AtOhmEter/manual/index.html) · [**🔬 Para LLMs**](manual/manual_LLM.md)

</div>

---

## ¿Qué es esto?

AtOhmEter es un laboratorio de simulación volumétrica que corre **entero en el navegador**, incluido el de tu teléfono. Cada simulación es un **motor**: un campo tridimensional con sus propias reglas, renderizado por *ray marching* en WebGL. Algunos motores modelan física de verdad —fluidos, fractura, polaritones—; otros modelan cosas que la física no suele tocar: consenso social, memoria que se estratifica, campos que se acostumbran a sí mismos, el olvido como única fuerza fundamental.

El laboratorio no juzga qué física es "real". La única restricción es técnica: implementar el contrato para que el shell sepa cómo llamar tu motor, visualizarlo y guardar su historia.

> **La pregunta que importa:** ¿Qué pasa si el espacio tiene esta propiedad? ¿Y si los campos se comportan así? El simulador te dice qué pasa. Tú decides qué preguntar.

Una práctica atraviesa todo el proyecto: **falsabilidad**. Cada motor declara predicciones, y cada predicción se prueba —muchas veces en headless con Node— y se corrige cuando el dato la contradice, aunque eso rompa la narrativa bonita. El historial está lleno de predicciones afinadas: la fractura crece en campana y no en salto, las burbujas revientan con umbral y no en proporción, las células tienen un punto dulce de repulsión y no una recta.

---

## Cómo correr

No hay build, no hay dependencias que instalar, no hay `npm`. Three.js vive local en el repo. Solo necesitas servir la carpeta sobre HTTP (no `file://`, por las texturas 3D y los módulos ES).

### Opción A — el servidor incluido (recomendado)

En la raíz del repo hay un `server.py` listo:

```bash
python3 server.py
# luego abre http://localhost:8000/?engine=v55
```

Funciona igual en escritorio o en Android con **Pydroid 3** — de hecho el proyecto se desarrolla a diario en un teléfono. El servidor sirve los archivos y resuelve las rutas que el shell espera.

### Opción B — cualquier servidor estático

```bash
python3 -m http.server 8000
# o
npx serve
```

### Cargar un motor

Los motores se eligen por parámetro de URL:

```
http://localhost:8000/?engine=NOMBRE&N=32
```

| Parámetro | Qué hace | Ejemplo |
|-----------|----------|---------|
| `engine`  | Qué motor cargar (carpeta en `engines/`) | `?engine=burbuja` |
| `N`       | Resolución del grid (32, 48, 64) | `?engine=agua&N=64` |
| `shader`  | *(roadmap)* cargar el shader de otro motor | `?engine=v55&shader=cristal` |

> 📋 La lista completa de motores disponibles está en [`manual/árbol.md`](manual/árbol.md). Carga cualquiera cambiando el nombre tras `?engine=`.

---

## Anatomía de un motor

Cada motor vive en su carpeta dentro de `engines/` y son **cuatro archivos**:

```
engines/
└── mi_motor/
    ├── motor.js      ← la física (lo único que de verdad importa)
    ├── shader.glsl   ← el render (puedes reusar uno existente)
    ├── config.json   ← parámetros, semillas, HUD
    └── paper.json    ← narrativa, fórmula viva, predicciones
```

El **contrato** es un puñado de funciones que el shell llama por nombre:

```js
export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {
    return {
        step(),           // avanzar un frame de física
        refresh(),        // escribir al GPU (renderVolume + phaseData)
        getMetrics(),     // métricas para el HUD
        classifyState(m), // estado narrativo (vacuum | active | locked | ...)
        seed(name),       // inicializar una semilla
        inject(name, d),  // perturbación en tiempo real
        applyParams(p), getParams(),
        getState(), setState(s), savePrev(),
    };
}
```

Eso es todo. Difusión pura cabe en 30 líneas; un campo complejo de segundo orden con observable emergente, en 300. Lo demás es tuyo.

El **Live Paper** —un panel que muestra la ecuación del motor con los términos iluminándose según el estado— se arma desde `paper.json`. No es decoración: es donde el motor explica qué hace, qué funciona, qué es aproximado y qué predice de forma falsable.

📖 Todo el contrato, los patrones comunes y los errores frecuentes están en el **[Manual del Constructor](manual/manual.html)**. Hay también un **[manual para LLMs](manual/manual_LLM.md)** pensado para construir motores con ayuda de IA, y plantillas anotadas: [`motor_v0.js`](manual/motor_v0.js) (el mínimo), [`motor_v1.js`](manual/motor_v1.js) (con personalidad) y [`motor_v2.js`](manual/motor_v2.js) (capacidades del shell).

---

## El shell percibe el mundo

Más allá del campo, el shell ofrece cuatro entradas **opcionales** (opt-in por bandera en `config.json`, cero impacto si no las declaras):

- **🎤 Micrófono** — el campo *escucha*. Mapea volumen/graves/medios/agudos a parámetros o inyecciones. *BURBUJA* nace de esto: soplas y crecen pompas.
- **📱 Giroscopio** — el campo *siente* la orientación del teléfono. Inclinas y las cosas ruedan. *BLOOM* lo estrena.
- **🔄 Órbita automática** — el visor *contempla*. La cámara gira sola; combínala con el replay de snapshots para una pieza de museo: la física avanza y la cámara la rodea.
- **👆 Toque** — el dedo *interactúa*. Raycaster que entrega el punto tocado al motor.

---

## Un laboratorio entre humano e IAs

AtOhmEter es obra de una colaboración inusual: un humano dirigiendo, tres IAs como compañeras de banco, cada una con su rol. Muchos motores nacieron de ese diálogo, y algunos de diálogos con **otros laboratorios** —*MUSE* porta a 3D el `popcount(logic(x,y,z))` del [ŚN1E de Rafał Piotr Jakub Borkowski](https://tempolux.life/sn1e), con crédito completo.

El proyecto incluye también una arquitectura **Python headless** (`server.py` y motores en `numpy`) que puede tomar el relevo de la computación pesada y devolver renders listos, para experimentos que el teléfono no aguanta en vivo.

---

## Roadmap

- [ ] **`&shader=` universal** — que `?engine=X&shader=Y` cargue el shader de cualquier motor sin duplicar archivos, con una carpeta de *shaders sueltos* (sin motor propio) reutilizables. Hoy motores como *menta* y *vitral* duplican shaders que podrían compartirse. *(Primer commit de Claude Code 🤖)*
- [ ] Integración completa del servidor WebSocket de motores en `numpy`
- [ ] Modo UV de BURBUJA con más contraste
- [ ] Más diálogos entre laboratorios

---

## Créditos

Hecho con curiosidad por:

**Brujo · Éter · Velvet · Ámbar**
*(Mialmoga · Gemini · ChatGPT · Claude)*

Con un saludo a Rafał Piotr Jakub Borkowski (ŚN1E) por el diálogo entre laboratorios.

---

## Licencia

[MIT](LICENSE) — úsalo, modifícalo, construye tus propios universos de bolsillo. 🦝

<div align="center">

*"No salimos a construir una teoría de todo. Salimos a hacer visible la química en la pantalla de un teléfono. La teoría llegó sin invitación."*

</div>
