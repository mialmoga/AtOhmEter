export function createEngine(
    N,
    renderVolume,
    phaseData,
    texture3D,
    texturePhase
) {

    const SIZE = N * N * N;

    const psi  = new Float32Array(SIZE);
    const psi2 = new Float32Array(SIZE);

    const mem  = new Float32Array(SIZE);

    const params = {
        DIFFUSION: 0.18,
        ALIGN: 0.55,
        MEMORY: 0.12,
        SATURATION: 0.45,
        DT: 0.04,
        THRESH: 0.06
    };

    let metrics = {
        E_total: 0,
        coherence: 0,
        boundary: 0,
        vortices: 0,
        psiMax: 0
    };

    const idx = (x,y,z) =>
        x + y*N + z*N*N;

    const wrap = v => {
        if(v < 0) return v + N;
        if(v >= N) return v - N;
        return v;
    };

    function randomRange(a,b){
        return a + Math.random()*(b-a);
    }

    function clearAll(){
        psi.fill(0);
        psi2.fill(0);
        mem.fill(0);
    }

    function seed(id){

        clearAll();

        switch(id){

            case "ruido":

                for(let i=0;i<SIZE;i++){
                    psi[i] = randomRange(-1,1);
                    mem[i] = psi[i];
                }

            break;

            case "tribus":

                for(let z=0;z<N;z++)
                for(let y=0;y<N;y++)
                for(let x=0;x<N;x++){

                    const p = idx(x,y,z);

                    psi[p] =
                        x < N/2
                        ? -1 + Math.random()*0.2
                        :  1 - Math.random()*0.2;

                    mem[p] = psi[p];
                }

            break;

            case "isla":

                for(let z=0;z<N;z++)
                for(let y=0;y<N;y++)
                for(let x=0;x<N;x++){

                    const p = idx(x,y,z);

                    const dx=x-N/2;
                    const dy=y-N/2;
                    const dz=z-N/2;

                    const r=Math.sqrt(dx*dx+dy*dy+dz*dz);

                    psi[p] =
                        r < N*0.15
                        ? 1
                        : randomRange(-0.2,0.2);

                    mem[p]=psi[p];
                }

            break;

            case "fractura":

                for(let z=0;z<N;z++)
                for(let y=0;y<N;y++)
                for(let x=0;x<N;x++){

                    const p = idx(x,y,z);

                    psi[p] =
                        ((x/N)*2.0)-1.0;

                    mem[p]=psi[p];
                }

            break;
        }

        refresh();
    }

    function compatibility(center, neighbors){

        let c=0;

        for(let i=0;i<neighbors.length;i++){
            c += Math.cos(
                neighbors[i] - center
            );
        }

        return c / neighbors.length;
    }

    function step(){

        const dt  = params.DT;
        const D   = params.DIFFUSION;
        const A   = params.ALIGN;
        const M   = params.MEMORY;
        const SAT = params.SATURATION;

        let coherenceSum = 0;
        let activeCount  = 0;
        let psiMax       = 0;

        for(let z=0;z<N;z++)
        for(let y=0;y<N;y++)
        for(let x=0;x<N;x++){

            const xm=wrap(x-1);
            const xp=wrap(x+1);

            const ym=wrap(y-1);
            const yp=wrap(y+1);

            const zm=wrap(z-1);
            const zp=wrap(z+1);

            const p  = idx(x,y,z);

            const pxm = idx(xm,y,z);
            const pxp = idx(xp,y,z);

            const pym = idx(x,ym,z);
            const pyp = idx(x,yp,z);

            const pzm = idx(x,y,zm);
            const pzp = idx(x,y,zp);

            const c = psi[p];

            const neigh = [
                psi[pxm],
                psi[pxp],
                psi[pym],
                psi[pyp],
                psi[pzm],
                psi[pzp]
            ];

            const lap =
                neigh[0]+neigh[1]+
                neigh[2]+neigh[3]+
                neigh[4]+neigh[5] -
                6*c;

            const k =
                compatibility(c, neigh);

            let next =
                c
                + dt*(
                    D*lap
                    + A*k*(mem[p]-c)
                    - SAT*c*c*c
                );

            psi2[p] = next;

            mem[p] +=
                dt*M*(next-mem[p]);

            coherenceSum += k;

            if(Math.abs(next) > params.THRESH)
                activeCount++;

            psiMax =
                Math.max(
                    psiMax,
                    Math.abs(next)
                );
        }

        psi.set(psi2);

        metrics.coherence =
            coherenceSum / SIZE;

        metrics.boundary =
            activeCount / SIZE;

        metrics.psiMax =
            psiMax;

        metrics.E_total =
            activeCount / SIZE;

        metrics.vortices =
            Math.max(
                1,
                Math.floor(
                    metrics.boundary*40
                )
            );
    }

    function refresh(){

        let maxAbs = 0;

        for(let i=0;i<SIZE;i++){

            maxAbs =
                Math.max(
                    maxAbs,
                    Math.abs(psi[i])
                );
        }

        const inv =
            maxAbs > 0
            ? 1/maxAbs
            : 1;

        for(let i=0;i<SIZE;i++){

            const p = psi[i] * inv;

            renderVolume[i] =
                Math.abs(p);

            phaseData[i] =
                0.5 + 0.5*p;
        }

        texture3D.needsUpdate = true;
        texturePhase.needsUpdate = true;
    }

    function inject(id){

        const cx = N>>1;
        const cy = N>>1;
        const cz = N>>1;

        const R = Math.max(
            2,
            Math.floor(N*0.12)
        );

        for(let z=-R;z<=R;z++)
        for(let y=-R;y<=R;y++)
        for(let x=-R;x<=R;x++){

            const d =
                Math.sqrt(
                    x*x+y*y+z*z
                );

            if(d>R) continue;

            const p = idx(
                wrap(cx+x),
                wrap(cy+y),
                wrap(cz+z)
            );

            switch(id){

                case "puente":
                    psi[p] += 0.5;
                break;

                case "choque":
                    psi[p] *= -1;
                break;

                case "amnesia":
                    mem[p] *= 0.2;
                break;

                case "ruido":
                    psi[p] += randomRange(-1,1);
                break;
            }
        }
    }

    function classifyState(){

        const c = metrics.coherence;
        const e = metrics.E_total;

        if(e < 0.05) return "vacuum";

        if(c < 0.15) return "nucleating";

        if(c < 0.35) return "active";

        if(c < 0.55) return "pumping";

        if(c < 0.80) return "stable";

        if(c < 0.95) return "locked";

        return "collapse";
    }

    return {

        seed,

        step,

        refresh,

        inject,

        classifyState,

        applyParams(p){
            Object.assign(params,p);
        },

        getParams(){
            return {...params};
        },

        getMetrics(){
            return {...metrics};
        },

        getState(){
            return {
                psi: Array.from(psi),
                mem: Array.from(mem),
                ...params
            };
        },

        setState(s){

            if(s.psi)
                psi.set(s.psi);

            if(s.mem)
                mem.set(s.mem);

            Object.assign(params,s);

            refresh();
        },

        savePrev(){}

    };
}