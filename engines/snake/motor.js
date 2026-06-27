// ══════════════════════════════════════════════════════════════
//  AtOhmEter — Motor SNAKE 3D
//  La Serpiente Cuántica
//
//  La serpiente ES el campo.
//  Su cuerpo escribe en renderVolume.
//  La comida pulsa en phaseData.
//  Los botones de inyección son el control.
//
//  Controles (6 direcciones en 3D):
//    girar_iz  — rotar dirección actual a la izquierda
//    girar_der — rotar dirección actual a la derecha
//    subir     — cambiar dirección hacia arriba (eje Y+)
//    bajar     — cambiar dirección hacia abajo (eje Y-)
//    auto      — toggle modo autopiloto (BFS hacia comida)
//
//  El autopilot usa BFS para encontrar el camino más corto
//  a la comida evitando colisiones con el cuerpo.
//
//  Ámbar — Mayo 2026 😈
// ══════════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

    const T = N * N * N;

    let P = {
        SPEED:       4,     // frames entre pasos (menor = más rápido)
        GROW:        3,     // celdas que crece al comer
        FOOD_COUNT:  3,     // comidas simultáneas en el campo
        AUTO:        0,     // 0=manual, 1=autopiloto
        THRESH:      0.05,
    };

    // ── Estado del juego ─────────────────────────────────────
    let snake = [];          // array de {x,y,z} — cabeza primero
    let foods = [];          // array de {x,y,z}
    let direction = {x:1,y:0,z:0}; // dirección actual
    let next_dir  = {x:1,y:0,z:0}; // dirección pendiente
    let grow_pending = 0;    // celdas pendientes de crecer
    let score = 0;
    let lives = 3;
    let level = 1;
    let frame_count = 0;
    let game_over = false;
    let paused_game = false;

    // Mapa de ocupación rápido
    const occupied = new Uint8Array(T);

    function idx(x, y, z) {
        x = ((x % N) + N) % N;
        y = ((y % N) + N) % N;
        z = ((z % N) + N) % N;
        return x * N * N + y * N + z;
    }

    function posToIdx(p) { return idx(p.x, p.y, p.z); }

    // ── Inicialización ───────────────────────────────────────
    function initGame() {
        snake = [];
        foods = [];
        occupied.fill(0);
        grow_pending = 0;
        score = 0;
        lives = 3;
        level = 1;
        frame_count = 0;
        game_over = false;

        // Serpiente inicial — 4 celdas en el centro
        const c = Math.floor(N/2);
        for (let i = 3; i >= 0; i--) {
            const seg = {x: c-i, y: c, z: c};
            snake.push(seg);
            occupied[posToIdx(seg)] = 1;
        }

        direction = {x:1,y:0,z:0};
        next_dir  = {x:1,y:0,z:0};

        // Comida inicial
        for (let i=0;i<P.FOOD_COUNT;i++) spawnFood();
    }

    function spawnFood() {
        // Buscar celda libre aleatoria
        let attempts = 0;
        while (attempts < 200) {
            const x = Math.floor(Math.random()*N);
            const y = Math.floor(Math.random()*N);
            const z = Math.floor(Math.random()*N);
            if (!occupied[idx(x,y,z)]) {
                foods.push({x,y,z});
                occupied[idx(x,y,z)] = 2; // 2 = comida
                return;
            }
            attempts++;
        }
    }

    // ── Autopiloto — BFS hacia comida más cercana ────────────
    function autopilotDir() {
        if (foods.length === 0) return direction;

        // Encontrar comida más cercana (distancia Manhattan)
        let target = foods[0];
        let best_dist = Infinity;
        for (const f of foods) {
            const d = Math.abs(f.x-snake[0].x) + Math.abs(f.y-snake[0].y) + Math.abs(f.z-snake[0].z);
            if (d < best_dist) { best_dist=d; target=f; }
        }

        // BFS desde la cabeza
        const head = snake[0];
        const dirs6 = [
            {x:1,y:0,z:0},{x:-1,y:0,z:0},
            {x:0,y:1,z:0},{x:0,y:-1,z:0},
            {x:0,y:0,z:1},{x:0,y:0,z:-1},
        ];

        const visited = new Uint8Array(T);
        const from = new Int32Array(T).fill(-1);
        const queue = [];

        visited[posToIdx(head)] = 1;
        queue.push({...head, from_idx: -1, from_dir: null});

        let found = null;
        let qi = 0;

        while (qi < queue.length && !found) {
            const cur = queue[qi++];
            for (const d of dirs6) {
                const nx = ((cur.x+d.x)%N+N)%N;
                const ny = ((cur.y+d.y)%N+N)%N;
                const nz = ((cur.z+d.z)%N+N)%N;
                const ni = idx(nx,ny,nz);
                if (visited[ni]) continue;
                // Evitar cuerpo (pero no comida)
                if (occupied[ni]===1) continue;
                visited[ni]=1;
                from[ni] = posToIdx(cur);
                queue.push({x:nx,y:ny,z:nz,from_idx:posToIdx(cur),first_dir:cur.first_dir||d});
                if (nx===target.x && ny===target.y && nz===target.z) {
                    found = queue[queue.length-1];
                    break;
                }
            }
        }

        if (found && found.first_dir) return found.first_dir;

        // Sin camino — elegir dirección aleatoria válida
        const valid = dirs6.filter(d => {
            const nx=((head.x+d.x)%N+N)%N;
            const ny=((head.y+d.y)%N+N)%N;
            const nz=((head.z+d.z)%N+N)%N;
            return occupied[idx(nx,ny,nz)]!==1;
        });
        return valid.length>0 ? valid[Math.floor(Math.random()*valid.length)] : direction;
    }

    // ── STEP ─────────────────────────────────────────────────
    function step() {
        if (game_over || paused_game) return;

        frame_count++;
        const speed = Math.max(1, Math.floor(P.SPEED));
        if (frame_count % speed !== 0) return;

        // Autopiloto
        if (P.AUTO > 0.5) {
            next_dir = autopilotDir();
        }

        // No permitir reversa
        if (next_dir.x !== -direction.x || next_dir.y !== -direction.y || next_dir.z !== -direction.z) {
            direction = {...next_dir};
        }

        // Nueva cabeza
        const head = snake[0];
        const new_head = {
            x: ((head.x + direction.x) % N + N) % N,
            y: ((head.y + direction.y) % N + N) % N,
            z: ((head.z + direction.z) % N + N) % N,
        };

        const ni = posToIdx(new_head);

        // Colisión con cuerpo
        if (occupied[ni] === 1) {
            lives--;
            if (lives <= 0) {
                game_over = true;
                return;
            }
            // Perder vida — reiniciar serpiente
            for (const seg of snake) occupied[posToIdx(seg)] = 0;
            snake = snake.slice(0, 4);
            for (const seg of snake) occupied[posToIdx(seg)] = 1;
            grow_pending = 0;
            return;
        }

        // ¿Comió?
        const food_idx = foods.findIndex(f => f.x===new_head.x && f.y===new_head.y && f.z===new_head.z);
        if (food_idx >= 0) {
            foods.splice(food_idx, 1);
            occupied[ni] = 0; // limpiar marca de comida
            score += 10 * level;
            grow_pending += P.GROW;
            // Subir nivel cada 5 comidas
            if (score > 0 && score % (50*level) === 0) level++;
            spawnFood();
        }

        // Mover serpiente
        snake.unshift(new_head);
        occupied[ni] = 1;

        if (grow_pending > 0) {
            grow_pending--;
        } else {
            const tail = snake.pop();
            occupied[posToIdx(tail)] = 0;
        }
    }

    // ── REFRESH ──────────────────────────────────────────────
    function refresh() {
        renderVolume.fill(0);
        phaseData.fill(0.5);

        if (game_over) {
            // Game over — parpadeo rojo
            const blink = Math.sin(Date.now()*0.005) > 0 ? 1 : 0;
            for (let i=0;i<T;i++) {
                renderVolume[i]=blink*0.3;
                phaseData[i]=0.0; // rojo en la rueda
            }
            texture3D.needsUpdate=true;
            texturePhase.needsUpdate=true;
            return;
        }

        const splash = Math.max(1, Math.floor(N*0.025));

        // Dibujar cuerpo de la serpiente
        for (let s=0; s<snake.length; s++) {
            const seg = snake[s];
            const is_head = s===0;
            const t = 1 - s/snake.length; // gradiente cabeza→cola

            // Cabeza más brillante, cola más tenue
            const brightness = is_head ? 1.0 : 0.3 + 0.7*t;
            // Color: cabeza=cyan, cuerpo=verde, cola=verde oscuro
            const phase = is_head ? 0.55 : 0.38 + t*0.1;

            for (let dx=-splash;dx<=splash;dx++)
            for (let dy=-splash;dy<=splash;dy++)
            for (let dz=-splash;dz<=splash;dz++) {
                const nx=seg.x+dx, ny=seg.y+dy, nz=seg.z+dz;
                if(nx<0||nx>=N||ny<0||ny>=N||nz<0||nz>=N) continue;
                const r2=dx*dx+dy*dy+dz*dz;
                const w=Math.exp(-r2/(splash*splash*0.5))*brightness;
                const gi=nx*N*N+ny*N+nz;
                if(w>renderVolume[gi]) {
                    renderVolume[gi]=w;
                    phaseData[gi]=phase;
                }
            }
        }

        // Dibujar comida — pulso brillante
        const pulse = 0.7 + 0.3*Math.sin(Date.now()*0.004);
        for (const food of foods) {
            const fsplash = splash+1;
            for (let dx=-fsplash;dx<=fsplash;dx++)
            for (let dy=-fsplash;dy<=fsplash;dy++)
            for (let dz=-fsplash;dz<=fsplash;dz++) {
                const nx=food.x+dx, ny=food.y+dy, nz=food.z+dz;
                if(nx<0||nx>=N||ny<0||ny>=N||nz<0||nz>=N) continue;
                const r2=dx*dx+dy*dy+dz*dz;
                const w=Math.exp(-r2/(fsplash*fsplash*0.4))*pulse;
                const gi=nx*N*N+ny*N+nz;
                if(w>renderVolume[gi]) {
                    renderVolume[gi]=w;
                    phaseData[gi]=0.08; // rojo/naranja en rueda de colores
                }
            }
        }

        texture3D.needsUpdate=true;
        texturePhase.needsUpdate=true;
    }

    // ── CONTROLES ─────────────────────────────────────────────
    // Sistema de rotación de dirección en 3D
    // Girar izquierda/derecha rota la dirección actual 90°
    // Subir/bajar cambia al eje Y

    // Vector "arriba" relativo a la dirección actual
    function rotateLeft(d) {
        // Rotar 90° a la izquierda en el plano horizontal actual
        if (d.y !== 0) {
            // Moviéndonos verticalmente — girar en XZ
            return {x: -d.z, y: 0, z: d.x};
        }
        // Plano XZ — girar
        return {x: d.z, y: 0, z: -d.x};
    }

    function rotateRight(d) {
        if (d.y !== 0) {
            return {x: d.z, y: 0, z: -d.x};
        }
        return {x: -d.z, y: 0, z: d.x};
    }

    // Init
    initGame();

    // ── OBSERVABLES ───────────────────────────────────────────
    function getMetrics() {
        return {
            E_total:   score,
            E_kin:     snake.length,
            E_torsion: lives,
            E_phase:   level,
            helicity:  foods.length,
            boundary:  grow_pending,
            pump:      game_over ? 0 : 1,
            u_max:     score,
            th_max:    snake.length,
            phi_max:   level,
            psiMax:    score,
            coherence: P.AUTO > 0.5 ? 1 : 0,
            vortices:  0,
        };
    }

    // ── API ───────────────────────────────────────────────────
    return {
        step, refresh, getMetrics,
        getState() {
            return { score, lives, level, snake_len: snake.length };
        },
        setState(s) {},
        loadState(s) {},
        savePrev() {},
        applyParams(p) { Object.assign(P, p); },
        getParams() { return {...P}; },
        seed(name) {
            initGame();
            if (name==='auto') P.AUTO=1;
            else P.AUTO=0;
            refresh();
        },
        initSeed(name) { this.seed(name); },
        inject(name) {
            if (game_over) { initGame(); refresh(); return; }
            if (name==='iz')    next_dir = rotateLeft(direction);
            else if (name==='der')   next_dir = rotateRight(direction);
            else if (name==='sub')   next_dir = {x:0,y:-1,z:0};
            else if (name==='arr')   next_dir = {x:0,y:1,z:0};
            else if (name==='auto')  P.AUTO = P.AUTO > 0.5 ? 0 : 1;
            else if (name==='reset') initGame();
        },
        classifyState(m) {
            if (game_over)        return 'collapse';
            if (P.AUTO > 0.5)     return 'locked';    // autopiloto
            if (m.E_total > 100)  return 'pumping';   // alta puntuación
            if (m.E_kin > 15)     return 'active';    // serpiente larga
            if (m.E_total > 0)    return 'nucleating';
            return 'vacuum';
        },
    };
}
