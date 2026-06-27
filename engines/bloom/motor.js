// ══════════════════════════════════════════════════════════════
//  AtOhmEter — BLOOM
//
//  "Las que se convocan y se apartan"
//  (homenaje al bloom de Velvet — su idea, nuestro campo volumétrico)
//
//  Partículas con PESO que se atraen a donde tocas (o hacia donde inclinas
//  el teléfono — gravedad por giroscopio) pero se REPELEN de cerca. De esa
//  tensión nacen CÉLULAS: cúmulos que se aglutinan sin fundirse del todo,
//  con fronteras nítidas — como en el render de Velvet, donde el cian no se
//  mezcla con el dorado. Cada tipo tiene su peso (los pesados aceleran más
//  al caer) y su color: unas estáticas, otras cambian de tono con su
//  velocidad (las reactivas/cromo).
//
//  ── Las dos fuerzas: ATRACCIÓN vs REPULSIÓN ──────────────────
//  ATRACCIÓN — el toque y la gravedad convocan las partículas a un punto.
//  REPULSIÓN — de cerca se empujan, no se traspasan → forman células.
//  El balance define el modo: mucha repulsión = células marcadas; cero
//  repulsión = se funden (mercurio); saturación = se dividen (mitosis).
//
//  ── Modos (semillas) ─────────────────────────────────────────
//    A · Bloom    — repulsión media → células/cúmulos con fronteras (Velvet).
//    B · Mercurio — repulsión cero → se fusionan en charcos (metaballs).
//    C · Células  — repulsión fuerte → membranas marcadas, tejido que late.
//    D · Mitosis  — los cúmulos densos se DIVIDEN: aglutina→satura→¡parte!→reparte.
//
//  ── Interacciones del shell que estrena ──────────────────────
//    Giroscopio → gravedad (inclinas, ruedan, los pesados aceleran más).
//    Toque      → convocatoria (reutiliza inject('touch',{x,y,z}) del shell).
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        ATRACCION:  0.6,    // fuerza del toque/centro que convoca
        REPULSION:  0.5,    // separación local (define el modo visual)
        GRAVEDAD:   0.0,    // peso base (lo modula el giroscopio vía bindings)
        GRAV_X:     0.0,    // componente X de gravedad (del giro tiltX)
        GRAV_Y:     0.0,    // componente Y de gravedad (del giro tiltY)
        VISCOSIDAD: 0.88,   // qué tan rápido frenan (0.8 pegajoso, 0.98 deslizante)
        DENSIDAD:   0.5,    // cuántas partículas (0..1 → escala con N)
        THRESH:     0.05,
    };

    // ── Partículas como entidades físicas ────────────────────────
    // cada una: posición, velocidad, peso (masa), tipo (color), radio
    let parts = [];
    let mode = 'A';
    let frame = 0;

    // atractor de toque (en coords de grid). active baja solo si no se renueva.
    let touch = { x:N/2, y:N/2, z:N/2, active:0 };

    // tipos de partícula (como Velvet): ligero/pesado/reactivo
    // hue: tono base; reactive: si cambia color con velocidad
    const TYPES = [
        { name:'ligero',   weight:0.5, hue:0.52, reactive:false }, // cian, cae lento
        { name:'pesado',   weight:1.8, hue:0.08, reactive:false }, // naranja/magma, acelera
        { name:'reactivo', weight:1.0, hue:0.0,  reactive:true  }, // color por velocidad
    ];

    function idx(x, y, z) {
        return ((x+N)%N)*N*N + ((y+N)%N)*N + ((z+N)%N);
    }

    function nParticles() {
        // escala con densidad y tamaño del grid (tope para móvil)
        return Math.min(140, Math.round(20 + P.DENSIDAD * (N*1.6)));
    }

    function spawn(n) {
        parts = [];
        for (let i=0;i<n;i++) {
            const t = (Math.random()*TYPES.length)|0;
            parts.push({
                x: N*0.2 + Math.random()*N*0.6,
                y: N*0.2 + Math.random()*N*0.6,
                z: N*0.2 + Math.random()*N*0.6,
                vx:0, vy:0, vz:0,
                type: t,
                r: 2.0 + Math.random()*1.5,
                cluster: 0,   // id de célula (para mitosis)
            });
        }
    }

    // ── repulsión por modo ──
    function repulStrength() {
        const base = P.REPULSION;
        if (mode === 'B') return 0;          // mercurio: sin repulsión, se funden
        if (mode === 'C') return base * 1.5; // células: repulsión fuerte (punto dulce)
        return base;                         // bloom (A) y mitosis (D): media
    }

    // ══════════════════════════════════════════════════════════
    //  STEP — física de partículas
    // ══════════════════════════════════════════════════════════
    function step() {
        frame++;
        const attract = P.ATRACCION;
        const repul = repulStrength();
        const visc = P.VISCOSIDAD;
        const gx = P.GRAV_X, gy = P.GRAV_Y, gBase = P.GRAVEDAD;

        // decaer el toque (si no se renueva, deja de atraer)
        if (touch.active > 0) touch.active -= 0.03;

        const nP = parts.length;
        // repulsión entre vecinos (O(n²) — n es pequeño, ~100)
        for (let i=0;i<nP;i++) {
            const a = parts[i];
            const w = TYPES[a.type].weight;

            // gravedad (giroscopio): los pesados aceleran más
            a.vx += gx * w * 0.5;
            a.vy += (-gy - gBase) * w * 0.5; // gy invertido (pantalla +y=arriba); gBase tira abajo
            // atracción al toque (convocatoria)
            if (touch.active > 0) {
                const dx=touch.x-a.x, dy=touch.y-a.y, dz=touch.z-a.z;
                const d=Math.sqrt(dx*dx+dy*dy+dz*dz)+1e-3;
                const f = attract * touch.active / d;
                a.vx += dx/d*f; a.vy += dy/d*f; a.vz += dz/d*f;
            } else {
                // sin toque: leve atracción al centro para que no se dispersen del todo
                const dx=N/2-a.x, dy=N/2-a.y, dz=N/2-a.z;
                a.vx += dx*0.0006; a.vy += dy*0.0006; a.vz += dz*0.0006;
            }

            // repulsión local con vecinos cercanos
            if (repul > 0) {
                for (let j=i+1;j<nP;j++) {
                    const b = parts[j];
                    const dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z;
                    const d2=dx*dx+dy*dy+dz*dz;
                    const minD = (a.r+b.r);
                    if (d2 < minD*minD && d2 > 1e-6) {
                        const d=Math.sqrt(d2);
                        const push = repul * (1 - d/minD) / d;
                        a.vx += dx*push; a.vy += dy*push; a.vz += dz*push;
                        b.vx -= dx*push; b.vy -= dy*push; b.vz -= dz*push;
                    }
                }
            }
        }

        // integrar + fricción + límites del cubo
        for (const a of parts) {
            a.vx*=visc; a.vy*=visc; a.vz*=visc;
            a.x+=a.vx; a.y+=a.vy; a.z+=a.vz;
            // rebote suave en las paredes
            const m=1.5;
            if(a.x<m){a.x=m;a.vx*=-0.4;} if(a.x>N-m){a.x=N-m;a.vx*=-0.4;}
            if(a.y<m){a.y=m;a.vy*=-0.4;} if(a.y>N-m){a.y=N-m;a.vy*=-0.4;}
            if(a.z<m){a.z=m;a.vz*=-0.4;} if(a.z>N-m){a.z=N-m;a.vz*=-0.4;}
        }

        // ── MITOSIS (modo D): cúmulos densos se dividen ──
        if (mode === 'D' && frame % 8 === 0) {
            mitosis();
        }
    }

    // detectar cúmulos densos y dividirlos empujando mitades opuestas
    function mitosis() {
        // contar vecinos cercanos de cada partícula; si un grupo es muy denso, partir
        for (const a of parts) {
            let near=0, cx=0,cy=0,cz=0;
            for (const b of parts) {
                const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;
                if (dx*dx+dy*dy+dz*dz < 25) { near++; cx+=b.x;cy+=b.y;cz+=b.z; }
            }
            // si demasiado denso, empujar lejos del centro de masa local (división)
            if (near > 8) {
                cx/=near; cy/=near; cz/=near;
                const dx=a.x-cx, dy=a.y-cy, dz=a.z-cz;
                const d=Math.sqrt(dx*dx+dy*dy+dz*dz)+1e-3;
                const kick = 0.8;
                a.vx += dx/d*kick; a.vy += dy/d*kick; a.vz += dz/d*kick;
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    //  REFRESH — pintar partículas como metaballs (glow suave)
    // ══════════════════════════════════════════════════════════
    function refresh() {
        renderVolume.fill(0);
        // el campo se acumula: cada partícula suma un blob gaussiano (metaball)
        for (const a of parts) {
            const r = a.r + 1.5;
            const x0=Math.max(0,(a.x-r)|0), x1=Math.min(N-1,(a.x+r)|0);
            const y0=Math.max(0,(a.y-r)|0), y1=Math.min(N-1,(a.y+r)|0);
            const z0=Math.max(0,(a.z-r)|0), z1=Math.min(N-1,(a.z+r)|0);
            // color: tipo estático, o por velocidad si es reactivo
            const ty = TYPES[a.type];
            let hue = ty.hue;
            if (ty.reactive) {
                const speed = Math.sqrt(a.vx*a.vx+a.vy*a.vy+a.vz*a.vz);
                hue = (0.6 - Math.min(0.6, speed*0.25)); // lento=azul, rápido=rojo
            }
            for (let x=x0;x<=x1;x++) for (let y=y0;y<=y1;y++) for (let z=z0;z<=z1;z++) {
                const dx=x-a.x, dy=y-a.y, dz=z-a.z;
                const d2=dx*dx+dy*dy+dz*dz;
                const blob = Math.exp(-d2/(2*(a.r*0.6)*(a.r*0.6)));
                if (blob > 0.02) {
                    const i=idx(x,y,z);
                    const prev = renderVolume[i];
                    renderVolume[i] = Math.min(1, prev + blob);
                    // el color del más cercano domina (mezcla ponderada simple)
                    if (blob > prev) phaseData[i] = hue;
                }
            }
        }
        texture3D.needsUpdate    = true;
        texturePhase.needsUpdate = true;
    }

    // ══════════════════════════════════════════════════════════
    //  SEMILLAS = MODOS
    // ══════════════════════════════════════════════════════════
    function seed(name) {
        if (name==='mercurio') mode='B';
        else if (name==='celulas') mode='C';
        else if (name==='mitosis') mode='D';
        else mode='A';
        frame=0;
        touch.active=0;
        spawn(nParticles());
        refresh();
    }

    seed('bloom');

    // ══════════════════════════════════════════════════════════
    //  MÉTRICAS
    // ══════════════════════════════════════════════════════════
    function getMetrics() {
        let speedTotal=0, speedMax=0, cmx=0,cmy=0,cmz=0;
        for (const a of parts) {
            const s=Math.sqrt(a.vx*a.vx+a.vy*a.vy+a.vz*a.vz);
            speedTotal+=s; if(s>speedMax)speedMax=s;
            cmx+=a.x; cmy+=a.y; cmz+=a.z;
        }
        const nP=parts.length||1;
        cmx/=nP; cmy/=nP; cmz/=nP;
        // dispersión: qué tan esparcidas están respecto al centro de masa
        let disp=0;
        for (const a of parts){ const dx=a.x-cmx,dy=a.y-cmy,dz=a.z-cmz; disp+=Math.sqrt(dx*dx+dy*dy+dz*dz); }
        disp/=nP;
        // estimar nº de células: clustering simple por distancia
        const clusters = countClusters();
        return {
            E_total:   speedTotal/nP/2,        // velocidad media (actividad)
            E_kin:     speedMax/3,             // velocidad máxima
            E_torsion: clusters/10,            // nº de células (norm)
            E_phase:   disp/(N*0.5),           // dispersión
            helicity:  0,
            boundary:  touch.active,           // si el toque está activo
            pump:      clusters,               // nº de cúmulos
            u_max:     speedMax,
            th_max:    parts.length,
            phi_max:   disp,
            psiMax:    speedMax/3,
            coherence: 1-(disp/(N*0.6)),       // cohesión (1=juntas, 0=dispersas)
            vortices:  clusters,
        };
    }

    // contar cúmulos por unión simple (grid hashing barato)
    function countClusters() {
        if (parts.length===0) return 0;
        const visited = new Set();
        let clusters = 0;
        const R2 = 36; // radio² de pertenencia a un cúmulo (6 celdas) — el que mejor distingue modos
        for (let i=0;i<parts.length;i++) {
            if (visited.has(i)) continue;
            clusters++;
            const stack=[i]; visited.add(i);
            while(stack.length){
                const k=stack.pop();
                for(let j=0;j<parts.length;j++){
                    if(visited.has(j))continue;
                    const dx=parts[k].x-parts[j].x, dy=parts[k].y-parts[j].y, dz=parts[k].z-parts[j].z;
                    if(dx*dx+dy*dy+dz*dz < R2){ visited.add(j); stack.push(j); }
                }
            }
        }
        return clusters;
    }

    // ══════════════════════════════════════════════════════════
    //  CLASSIFY STATE
    // ══════════════════════════════════════════════════════════
    function classifyState(m) {
        if (m.boundary > 0.1)       return 'pumping';    // toque activo, convocando
        if (mode==='D' && m.E_kin>0.4) return 'collapse'; // mitosis dividiendo
        if (m.coherence > 0.7)      return 'locked';     // todas aglutinadas
        if (m.pump > 6)             return 'stable';     // muchas células
        if (m.E_total > 0.15)       return 'active';     // moviéndose
        if (m.E_total > 0.02)       return 'nucleating';
        return 'vacuum';
    }

    // ══════════════════════════════════════════════════════════
    //  INYECCIONES + TOQUE
    // ══════════════════════════════════════════════════════════
    function inject(name, data) {
        if (name === 'touch') {
            // el shell envía coords en [-1,1] → a grid [0,N]
            if (data) {
                touch.x = (data.x*0.5+0.5)*N;
                touch.y = (data.y*0.5+0.5)*N;
                touch.z = (data.z*0.5+0.5)*N;
                touch.active = 1.0;
            }
        } else if (name === 'convocar') {
            // atraer todo al centro
            touch.x=N/2; touch.y=N/2; touch.z=N/2; touch.active=1.5;
        } else if (name === 'dispersar') {
            for (const a of parts){ a.vx+=(Math.random()-0.5)*3; a.vy+=(Math.random()-0.5)*3; a.vz+=(Math.random()-0.5)*3; }
        } else if (name === 'dividir') {
            mitosis(); mitosis();
        }
        // touch no necesita refresh (lo hace el loop), pero las otras sí
        if (name !== 'touch') refresh();
    }

    // ══════════════════════════════════════════════════════════
    //  SNAPSHOTS
    // ══════════════════════════════════════════════════════════
    function getState() {
        return { mode, frame, parts: parts.map(p=>({...p})) };
    }
    function setState(s) {
        if (s.mode) mode = s.mode;
        if (typeof s.frame==='number') frame = s.frame;
        if (s.parts) parts = s.parts.map(p=>({...p}));
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
    };
}
