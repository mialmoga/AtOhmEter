export function createEngine(
    N,
    renderVolume,
    phaseData,
    texture3D,
    texturePhase
) {

    const T = N * N * N;

    let P = {
        DIFFUSION:  0.12,
        MEMORY:     0.35,
        FORGETTING: 0.002,
        NOISE:      0.01,
        DT:         0.02,
        THRESH:     0.05
    };

    const field  = new Float64Array(T);
    const memory = new Float64Array(T);

    const lap = new Float64Array(T);

    function idx(x,y,z){
        return ((x+N)%N)*N*N +
               ((y+N)%N)*N +
               ((z+N)%N);
    }

    function laplaciano(F,out){
        for(let x=0;x<N;x++)
        for(let y=0;y<N;y++)
        for(let z=0;z<N;z++){

            const i = idx(x,y,z);

            out[i] =
                F[idx(x+1,y,z)] +
                F[idx(x-1,y,z)] +
                F[idx(x,y+1,z)] +
                F[idx(x,y-1,z)] +
                F[idx(x,y,z+1)] +
                F[idx(x,y,z-1)] -
                6.0*F[i];
        }
    }

    //══════════════════════════════════════
    // STEP
    //══════════════════════════════════════

    function step(){

        laplaciano(field,lap);

        for(let i=0;i<T;i++){

            field[i] +=
                P.DIFFUSION * lap[i] * P.DT
                +
                P.MEMORY * memory[i] * P.DT
                +
                (Math.random()-0.5) * P.NOISE;

            field[i] *= 0.999;

            memory[i] +=
                Math.abs(field[i]) * 0.01;

            memory[i] -= P.FORGETTING;

            if(memory[i] < 0)
                memory[i] = 0;
        }
    }

    //══════════════════════════════════════
    // REFRESH
    //══════════════════════════════════════

    function refresh(){

        let maxField = 1e-9;
        let maxMem   = 1e-9;

        for(let i=0;i<T;i++){
            if(Math.abs(field[i]) > maxField)
                maxField = Math.abs(field[i]);

            if(memory[i] > maxMem)
                maxMem = memory[i];
        }

        for(let i=0;i<T;i++){

            const amp =
                Math.abs(field[i]) / maxField;

            const mem =
                memory[i] / maxMem;

            renderVolume[i] =
                Math.max(
                    amp * 0.6,
                    mem * 0.8
                );

            // fase = edad de memoria

            phaseData[i] = mem;
        }

        texture3D.needsUpdate = true;
        texturePhase.needsUpdate = true;
    }

    //══════════════════════════════════════
    // SEMILLAS
    //══════════════════════════════════════

    function seedPulso(){

        field.fill(0);
        memory.fill(0);

        const c = N >> 1;

        for(let x=0;x<N;x++)
        for(let y=0;y<N;y++)
        for(let z=0;z<N;z++){

            const dx=x-c;
            const dy=y-c;
            const dz=z-c;

            const r2 =
                dx*dx +
                dy*dy +
                dz*dz;

            field[idx(x,y,z)] =
                Math.exp(
                    -r2/(2*(N/6)*(N/6))
                );
        }
    }

    function seedLluvia(){

        field.fill(0);
        memory.fill(0);

        for(let i=0;i<T;i++){

            if(Math.random()<0.02){

                field[i] =
                    Math.random();
            }
        }
    }

    function seedRitual(){

        field.fill(0);
        memory.fill(0);

        const c = N >> 1;

        for(let z=0;z<N;z++){

            field[idx(c,c,z)] = 1.0;

            memory[idx(c,c,z)] = 1.0;
        }
    }

    function seed(name){

        if(name==="lluvia")
            seedLluvia();

        else if(name==="ritual")
            seedRitual();

        else
            seedPulso();

        refresh();
    }

    seed("pulso");

    //══════════════════════════════════════
    // MÉTRICAS
    //══════════════════════════════════════

    function getMetrics(){

        let totalField = 0;
        let totalMem   = 0;

        let maxField = 0;
        let fossils  = 0;

        for(let i=0;i<T;i++){

            const a =
                Math.abs(field[i]);

            totalField += a;

            totalMem += memory[i];

            if(a > maxField)
                maxField = a;

            if(memory[i] > 0.5)
                fossils++;
        }

        return {

            E_total:
                totalField/T,

            E_kin:
                totalMem/T,

            E_torsion:
                fossils/T,

            E_phase:
                totalMem/T,

            helicity:
                fossils/T,

            boundary:
                fossils/T,

            pump:
                totalMem/T,

            u_max:
                maxField,

            th_max:
                totalMem/T,

            phi_max:
                maxField,

            psiMax:
                maxField,

            coherence:
                fossils/T,

            vortices:
                0
        };
    }

    //══════════════════════════════════════
    // ESTADOS
    //══════════════════════════════════════

    function classifyState(m){

        if(m.E_kin > 2.0)
            return "collapse";

        if(m.boundary > 0.40)
            return "locked";

        if(m.coherence > 0.20)
            return "stable";

        if(m.E_total > 0.25)
            return "active";

        if(m.E_total > 0.05)
            return "nucleating";

        return "vacuum";
    }

    //══════════════════════════════════════
    // INYECCIONES
    //══════════════════════════════════════

    function inject(name){

        if(name==="recordar"){

            for(let i=0;i<T;i++){

                memory[i] *= 1.2;
            }
        }

        else if(name==="olvidar"){

            for(let i=0;i<T;i++){

                memory[i] *= 0.5;
            }
        }

        else if(name==="nostalgia"){

            for(let i=0;i<T;i++){

                field[i] +=
                    memory[i] * 0.5;
            }
        }

        refresh();
    }

    function applyParams(p){
        Object.assign(P,p);
    }

    function getParams(){
        return {...P};
    }

    function getState(){

        return {

            field:
                new Float32Array(field),

            memory:
                new Float32Array(memory)
        };
    }

    function setState(s){

        if(s.field)
            field.set(s.field);

        if(s.memory)
            memory.set(s.memory);

        refresh();
    }

    function savePrev(){}

    return {

        step,
        refresh,

        getMetrics,

        seed,
        inject,

        applyParams,
        getParams,

        getState,
        setState,

        savePrev,

        classifyState
    };
}