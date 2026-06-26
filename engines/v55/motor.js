// ═══════════════════════════════════════════════════════════
// AtOhmEter Engine V5.5 — Campo Complejo ψ ∈ ℂ³
// Motor: snap variacional + Bohm + feedback helicoidal
// Exporta: { init, step, seed, getState, updateTextures, applyParams }
// ═══════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

const EXTENT = 2.5;
const DX   = (2*EXTENT) / (N-1);
const TOTAL = N*N*N;
const EPS   = 1e-9;
const INV2DX = 1/(2*DX);
const INVDX2 = 1/(DX*DX);

let U  = new Float32Array(TOTAL);
let Ui = new Float32Array(TOTAL);
let V  = new Float32Array(TOTAL);
let Vi = new Float32Array(TOTAL);
let W  = new Float32Array(TOTAL);
let Wi = new Float32Array(TOTAL);

let curlX  = new Float32Array(TOTAL);
let curlXi = new Float32Array(TOTAL);
let curlY  = new Float32Array(TOTAL);
let curlYi = new Float32Array(TOTAL);
let curlZ  = new Float32Array(TOTAL);
let curlZi = new Float32Array(TOTAL);
let curlMag = new Float32Array(TOTAL);

let crossX  = new Float32Array(TOTAL);
let crossXi = new Float32Array(TOTAL);
let crossY  = new Float32Array(TOTAL);
let crossYi = new Float32Array(TOTAL);
let crossZ  = new Float32Array(TOTAL);
let crossZi = new Float32Array(TOTAL);

let snapX  = new Float32Array(TOTAL);
let snapXi = new Float32Array(TOTAL);
let snapY  = new Float32Array(TOTAL);
let snapYi = new Float32Array(TOTAL);
let snapZ  = new Float32Array(TOTAL);
let snapZi = new Float32Array(TOTAL);

let logRho     = new Float32Array(TOTAL);
let bohmScalar = new Float32Array(TOTAL);


// ── Parámetros — Velvet V5.5 calibration ──────────────────────
let ETA    = 0.32;   // snap
let LAMBDA = 0.08;   // Higgs
let PHI0   = 1.0;    // densidad equilibrio
let GAMMA  = 0.15;   // phase coupling
let THETA0 = 0.0;    // fase del vacío
let BOHM_C = 0.6;    // Bohm (Velvet: reducir)
let DT     = 0.0015; // timestep (Velvet: más bajo con ETA alto)
let THRESH = 0.15;
let HELIC_FEEDBACK = 0.05;  // feedback helicoidal
let DAMP_BASE  = 0.992;    // damping vacío
let DAMP_VORT  = 0.9995;   // damping vórtices
let DAMP_THRESH= 0.3;      // umbral curl para protección
let VORTEX_THRESH = 0.5;   // umbral para contar vórtices (separado del visual)
let paused = true;          // arranca pausado
let frameCount = 0;
let maxEnergy  = 1.0;
const EPS_RHO  = 1e-9;
let currentSeed = 'grumo';  // semilla activa

// Buffers para métrica de persistencia C(x,t) = |⟨ψ(t),ψ(t-Δt)⟩|
let prevU  = new Float32Array(TOTAL);
let prevUi = new Float32Array(TOTAL);
let prevV  = new Float32Array(TOTAL);
let prevVi = new Float32Array(TOTAL);
let prevW  = new Float32Array(TOTAL);
let prevWi = new Float32Array(TOTAL);
let coherenceJS = 0.0;  // C global promedio

function idx(i,j,k){ return i*N*N + j*N + k; }

function get(arr,i,j,k){
    i=((i%N)+N)%N; j=((j%N)+N)%N; k=((k%N)+N)%N;
    return arr[idx(i,j,k)];
}

function initGrumo(){
    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        const X=-1+i*2/(N-1), Y=-1+j*2/(N-1), Z=-1+k*2/(N-1);
        const env=Math.exp(-10*(X*X+Y*Y+Z*Z));
        U[n]=-Y*env;  Ui[n]=0;
        V[n]= X*env;  Vi[n]=0;
        W[n]=0.5*Z*env; Wi[n]=0;
    }
}

function initNoise(amplitude=0.02){
    for(let n=0;n<TOTAL;n++){
        U[n]+=(Math.random()-0.5)*amplitude; Ui[n]+=(Math.random()-0.5)*amplitude*0.1;
        V[n]+=(Math.random()-0.5)*amplitude; Vi[n]+=(Math.random()-0.5)*amplitude*0.1;
        W[n]+=(Math.random()-0.5)*amplitude; Wi[n]+=(Math.random()-0.5)*amplitude*0.1;
    }
}

function injectHelical(cx=N/2,cy=N/2,cz=N/2,amplitude=0.8,radius=3.0){
    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const di=i-cx,dj=j-cy,dk=k-cz;
        const r=Math.sqrt(di*di+dj*dj+dk*dk);
        const env=Math.exp(-r*r/(radius*radius));
        if(env<0.01) continue;
        const phi=Math.atan2(dj,di), theta=Math.atan2(Math.sqrt(di*di+dj*dj),dk);
        const n=idx(i,j,k);
        U[n]+=amplitude*env*(-Math.sin(phi)*Math.cos(theta)-Math.sin(phi*2)*0.3);
        V[n]+=amplitude*env*( Math.cos(phi)*Math.cos(theta)+Math.cos(phi*2)*0.3);
        W[n]+=amplitude*env*(-Math.sin(theta)*0.5);
    }
}

function injectPerturbation(){
    injectHelical(
        Math.floor(N/4+Math.random()*N/2),
        Math.floor(N/4+Math.random()*N/2),
        Math.floor(N/4+Math.random()*N/2), 0.4, 2.0);
}

function gx(r,i,j,k){ return (get(r,i+1,j,k)-get(r,i-1,j,k))*INV2DX; }
function gy(r,i,j,k){ return (get(r,i,j+1,k)-get(r,i,j-1,k))*INV2DX; }
function gz(r,i,j,k){ return (get(r,i,j,k+1)-get(r,i,j,k-1))*INV2DX; }
function lap(r,i,j,k){
    const v=get(r,i,j,k);
    return ((get(r,i+1,j,k)-2*v+get(r,i-1,j,k))+
            (get(r,i,j+1,k)-2*v+get(r,i,j-1,k))+
            (get(r,i,j,k+1)-2*v+get(r,i,j,k-1)))*INVDX2;
}

// Curl standalone — para recalcular visualización sin evolucionar
function computeCurl(){
    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        curlX[n]  = gy(W,i,j,k)  - gz(V,i,j,k);
        curlXi[n] = gy(Wi,i,j,k) - gz(Vi,i,j,k);
        curlY[n]  = gz(U,i,j,k)  - gx(W,i,j,k);
        curlYi[n] = gz(Ui,i,j,k) - gx(Wi,i,j,k);
        curlZ[n]  = gx(V,i,j,k)  - gy(U,i,j,k);
        curlZi[n] = gx(Vi,i,j,k) - gy(Ui,i,j,k);
        curlMag[n]=Math.sqrt(curlX[n]**2+curlXi[n]**2+curlY[n]**2+
                             curlYi[n]**2+curlZ[n]**2+curlZi[n]**2);
    }
}

function stepEvolve(){
    for(let n=0;n<TOTAL;n++){
        const rho=Math.max(U[n]**2+Ui[n]**2+V[n]**2+Vi[n]**2+W[n]**2+Wi[n]**2, EPS_RHO);
        logRho[n]=Math.log(rho);
    }

    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        const glx=gx(logRho,i,j,k), gly=gy(logRho,i,j,k), glz=gz(logRho,i,j,k);
        bohmScalar[n]=-(BOHM_C/4)*(lap(logRho,i,j,k)+0.5*(glx*glx+gly*gly+glz*glz));
    }

    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        curlX[n]  = gy(W,i,j,k)  - gz(V,i,j,k);
        curlXi[n] = gy(Wi,i,j,k) - gz(Vi,i,j,k);
        curlY[n]  = gz(U,i,j,k)  - gx(W,i,j,k);
        curlYi[n] = gz(Ui,i,j,k) - gx(Wi,i,j,k);
        curlZ[n]  = gx(V,i,j,k)  - gy(U,i,j,k);
        curlZi[n] = gx(Vi,i,j,k) - gy(Ui,i,j,k);
        curlMag[n]=Math.sqrt(curlX[n]**2+curlXi[n]**2+curlY[n]**2+
                             curlYi[n]**2+curlZ[n]**2+curlZi[n]**2);
    }

    for(let n=0;n<TOTAL;n++){
        const ur=U[n],ui=Ui[n], vr=V[n],vi=Vi[n], wr=W[n],wi=Wi[n];
        const cxr=curlX[n],cxi=curlXi[n], cyr=curlY[n],cyi=curlYi[n], czr=curlZ[n],czi=curlZi[n];
        crossX[n] =(vr*czr-vi*czi)-(wr*cyr-wi*cyi);
        crossXi[n]=(vr*czi+vi*czr)-(wr*cyi+wi*cyr);
        crossY[n] =(wr*cxr-wi*cxi)-(ur*czr-ui*czi);
        crossYi[n]=(wr*cxi+wi*cxr)-(ur*czi+ui*czr);
        crossZ[n] =(ur*cyr-ui*cyi)-(vr*cxr-vi*cxi);
        crossZi[n]=(ur*cyi+ui*cyr)-(vr*cxi+vi*cxr);
    }

    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        snapX[n] =gy(crossZ,i,j,k) -gz(crossY,i,j,k);
        snapXi[n]=gy(crossZi,i,j,k)-gz(crossYi,i,j,k);
        snapY[n] =gz(crossX,i,j,k) -gx(crossZ,i,j,k);
        snapYi[n]=gz(crossXi,i,j,k)-gx(crossZi,i,j,k);
        snapZ[n] =gx(crossY,i,j,k) -gy(crossX,i,j,k);
        snapZi[n]=gx(crossYi,i,j,k)-gy(crossXi,i,j,k);
    }

    const pcr=GAMMA*Math.cos(-THETA0), pci=GAMMA*Math.sin(-THETA0);

    // Clamp para evitar NaN
    const clampF = (val) => Math.max(-100.0, Math.min(100.0, val));

    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        const ur=U[n],ui=Ui[n], vr=V[n],vi=Vi[n], wr=W[n],wi=Wi[n];
        const rho=Math.max(ur*ur+ui*ui+vr*vr+vi*vi+wr*wr+wi*wi, EPS_RHO);
        const Vp=LAMBDA*(rho-PHI0*PHI0);

        // Bohm dependiente de densidad — Velvet: Qeff = Q/(1+α·ρ)
        // Vacío → Bohm fuerte, núcleo compacto → Bohm suave
        const Q=bohmScalar[n] / (1.0 + 0.5*rho);

        // Helicidad local = Re(ψ*·curl(ψ)) en este punto
        const hLocal = (ur*curlX[n]+ui*curlXi[n])
                      +(vr*curlY[n]+vi*curlYi[n])
                      +(wr*curlZ[n]+wi*curlZi[n]);

        // Feedback helicoidal — penaliza destruir helicidad
        // Actúa como un potencial extra que favorece alineación ψ ∥ curl(ψ)
        const hFb = HELIC_FEEDBACK * hLocal;

        const lapUr=lap(U,i,j,k),  lapUi=lap(Ui,i,j,k);
        const lapVr=lap(V,i,j,k),  lapVi=lap(Vi,i,j,k);
        const lapWr=lap(W,i,j,k),  lapWi=lap(Wi,i,j,k);

        // F = -½∇²ψ + V'ψ + phase_coupling + snap + Bohm + helic_feedback·curl
        const FUr=-0.5*lapUr + Vp*ur + (pcr*ur-pci*ui) + ETA*snapX[n]  + Q*ur + hFb*curlX[n];
        const FUi=-0.5*lapUi + Vp*ui + (pcr*ui+pci*ur) + ETA*snapXi[n] + Q*ui + hFb*curlXi[n];
        const FVr=-0.5*lapVr + Vp*vr + (pcr*vr-pci*vi) + ETA*snapY[n]  + Q*vr + hFb*curlY[n];
        const FVi=-0.5*lapVi + Vp*vi + (pcr*vi+pci*vr) + ETA*snapYi[n] + Q*vi + hFb*curlYi[n];
        const FWr=-0.5*lapWr + Vp*wr + (pcr*wr-pci*wi) + ETA*snapZ[n]  + Q*wr + hFb*curlZ[n];
        const FWi=-0.5*lapWi + Vp*wi + (pcr*wi+pci*wr) + ETA*snapZi[n] + Q*wi + hFb*curlZi[n];

        // DAMP adaptativo — Velvet: protege vórtices, disipa ruido
        const curlLocal = curlMag[n];
        const t = Math.min(1, Math.max(0, (curlLocal - DAMP_THRESH*0.5) / (DAMP_THRESH*0.5 + 0.01)));
        const localDamp = DAMP_BASE + (DAMP_VORT - DAMP_BASE) * t;

        U[n]  = (U[n]  + DT * clampF(FUi))  * localDamp;
        Ui[n] = (Ui[n] + DT * clampF(-FUr)) * localDamp;
        V[n]  = (V[n]  + DT * clampF(FVi))  * localDamp;
        Vi[n] = (Vi[n] + DT * clampF(-FVr)) * localDamp;
        W[n]  = (W[n]  + DT * clampF(FWi))  * localDamp;
        Wi[n] = (Wi[n] + DT * clampF(-FWr)) * localDamp;
    }
}

// ═══════════════════════════════════════════════════════════
//  HAMILTONIANO COMPLETO — 4 componentes de energía
//  H = E_kin + E_higgs + E_torsion  (E_vortex = proxy legacy)
// ═══════════════════════════════════════════════════════════
let E_kin = 0, E_higgs = 0, E_torsion = 0, E_vortex = 0, E_total = 0;

function computeFullHamiltonian(){
    let ek=0, eh=0, et=0, ev=0;
    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);

        // |ψ|² = ρ
        const rho = U[n]**2+Ui[n]**2+V[n]**2+Vi[n]**2+W[n]**2+Wi[n]**2;

        // E_higgs = λ(ρ - φ₀²)²
        const dRho = rho - PHI0*PHI0;
        eh += LAMBDA * dRho * dRho;

        // E_vortex = |∇×ψ|² (proxy legacy)
        ev += curlMag[n] * curlMag[n];

        // E_torsion = |ψ×(∇×ψ)|²
        // Ya tenemos cross calculado en stepEvolve, pero se sobreescribe.
        // Calculamos inline aquí:
        const ur=U[n],ui=Ui[n], vr=V[n],vi=Vi[n], wr=W[n],wi=Wi[n];
        const cxr=curlX[n],cxi=curlXi[n];
        const cyr=curlY[n],cyi=curlYi[n];
        const czr=curlZ[n],czi=curlZi[n];
        // cross_x = ψ_y*curl_z - ψ_z*curl_y (complejo)
        const crXr=(vr*czr-vi*czi)-(wr*cyr-wi*cyi);
        const crXi=(vr*czi+vi*czr)-(wr*cyi+wi*cyr);
        const crYr=(wr*cxr-wi*cxi)-(ur*czr-ui*czi);
        const crYi=(wr*cxi+wi*cxr)-(ur*czi+ui*czr);
        const crZr=(ur*cyr-ui*cyi)-(vr*cxr-vi*cxi);
        const crZi=(ur*cyi+ui*cyr)-(vr*cxi+vi*cxr);
        et += crXr**2+crXi**2+crYr**2+crYi**2+crZr**2+crZi**2;

        // E_kin = |∇ψ|² (gradientes por componente)
        const gUr=gx(U,i,j,k),  gUi=gx(Ui,i,j,k);
        const gVr=gx(V,i,j,k),  gVi=gx(Vi,i,j,k);
        const gWr=gx(W,i,j,k),  gWi=gx(Wi,i,j,k);
        const gUry=gy(U,i,j,k), gUiy=gy(Ui,i,j,k);
        const gVry=gy(V,i,j,k), gViy=gy(Vi,i,j,k);
        const gWry=gy(W,i,j,k), gWiy=gy(Wi,i,j,k);
        const gUrz=gz(U,i,j,k), gUiz=gz(Ui,i,j,k);
        const gVrz=gz(V,i,j,k), gViz=gz(Vi,i,j,k);
        const gWrz=gz(W,i,j,k), gWiz=gz(Wi,i,j,k);
        ek += gUr**2+gUi**2+gVr**2+gVi**2+gWr**2+gWi**2
             +gUry**2+gUiy**2+gVry**2+gViy**2+gWry**2+gWiy**2
             +gUrz**2+gUiz**2+gVrz**2+gViz**2+gWrz**2+gWiz**2;
    }
    const inv = 1/TOTAL;
    E_kin     = ek * inv;
    E_higgs   = eh * inv;
    E_torsion = et * inv;
    E_vortex  = ev * inv;
    E_total   = E_kin + E_higgs + E_torsion;
}

// Legacy — mantener para compatibilidad con el loop
function computeEnergy(){
    computeFullHamiltonian();
    return E_vortex; // proxy legacy para comparación
}

// C(x,t) = |⟨ψ(t),ψ(t-Δt)⟩| / (|ψ(t)|·|ψ(t-Δt)|) — persistencia de Velvet
function computeCoherence(){
    let sumC=0, count=0;
    for(let n=0;n<TOTAL;n++){
        // |ψ(t)|²
        const mag2 = U[n]**2+Ui[n]**2+V[n]**2+Vi[n]**2+W[n]**2+Wi[n]**2;
        // |ψ(t-Δt)|²
        const pmag2= prevU[n]**2+prevUi[n]**2+prevV[n]**2+prevVi[n]**2+prevW[n]**2+prevWi[n]**2;
        if(mag2 < 1e-12 || pmag2 < 1e-12) continue;
        // Re(⟨ψ(t),ψ(t-Δt)⟩) = Σ (Re·Re + Im·Im) por componente
        const dot = U[n]*prevU[n]+Ui[n]*prevUi[n]
                  +V[n]*prevV[n]+Vi[n]*prevVi[n]
                  +W[n]*prevW[n]+Wi[n]*prevWi[n];
        sumC += Math.abs(dot) / (Math.sqrt(mag2)*Math.sqrt(pmag2));
        count++;
    }
    return count > 0 ? sumC/count : 0;
}

// Guardar estado actual como "frame anterior" para la próxima medición
function savePrevField(){
    prevU.set(U);  prevUi.set(Ui);
    prevV.set(V);  prevVi.set(Vi);
    prevW.set(W);  prevWi.set(Wi);
}

function countVortices(){
    let c=0,p=false;
    for(let n=0;n<TOTAL;n++){
        const a=curlMag[n]>VORTEX_THRESH;
        if(a&&!p)c++;
        p=a;
    }
    return Math.floor(c*0.3);
}

function computeHelicity(){
    let h=0;
    for(let n=0;n<TOTAL;n++){
        h+=(U[n]*curlX[n]+Ui[n]*curlXi[n])
          +(V[n]*curlY[n]+Vi[n]*curlYi[n])
          +(W[n]*curlZ[n]+Wi[n]*curlZi[n]);
    }
    return h/TOTAL;
}

function computePsiMax(){
    let m=0;
    for(let n=0;n<TOTAL;n++){
        const mag=U[n]**2+Ui[n]**2+V[n]**2+Vi[n]**2+W[n]**2+Wi[n]**2;
        if(mag>m) m=mag;
    }
    return Math.sqrt(m);
}

// texturas recibidas del shell (index.html)

function updateTextures(){
    let maxRho=EPS_RHO;
    for(let n=0;n<TOTAL;n++){
        const rho=U[n]**2+Ui[n]**2+V[n]**2+Vi[n]**2+W[n]**2+Wi[n]**2;
        if(rho>maxRho) maxRho=rho;
    }
    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        const xi=-1+i*2/(N-1), yi=-1+j*2/(N-1), zi=-1+k*2/(N-1);
        const horizon=Math.max(0,Math.min(1,1.5-Math.sqrt(xi*xi+yi*yi+zi*zi)));
        const rho=U[n]**2+Ui[n]**2+V[n]**2+Vi[n]**2+W[n]**2+Wi[n]**2;
        renderVolume[n]=Math.min(1,rho/maxRho)*horizon;
        phaseData[n]=(Math.atan2(Ui[n],U[n])+Math.PI)/(2*Math.PI);
    }
    texture3D.needsUpdate=true;
    texturePhase.needsUpdate=true;
}

// ── API pública ──────────────────────────────────────────────
return {
    // Inicializar con una semilla
    seed(name) {
        for(let n=0;n<TOTAL;n++) U[n]=Ui[n]=V[n]=Vi[n]=W[n]=Wi[n]=0;
        if(name==='grumo')     { initGrumo(); initNoise(0.01); }
        else if(name==='helicoidal') { injectHelical(N/2,N/2,N/2,1.0,4.0); initNoise(0.005); }
        else if(name==='ruido') { initNoise(0.15); }
        // vacio: todo en cero
        computeCurl();
        updateTextures();
    },

    // Un paso de evolución
    step() { stepEvolve(); },

    // Recalcular derivados sin evolucionar (para visualización)
    refresh() { computeCurl(); updateTextures(); },

    // Aplicar parámetros externos (desde slider o snapshot)
    applyParams(p) {
        if(p.ETA !== undefined) ETA = p.ETA;
        if(p.LAMBDA !== undefined) LAMBDA = p.LAMBDA;
        if(p.BOHM_C !== undefined) BOHM_C = p.BOHM_C;
        if(p.HELIC_FEEDBACK !== undefined) HELIC_FEEDBACK = p.HELIC_FEEDBACK;
        if(p.DAMP_BASE !== undefined) DAMP_BASE = p.DAMP_BASE;
        if(p.DAMP_VORT !== undefined) DAMP_VORT = p.DAMP_VORT;
        if(p.GAMMA !== undefined) GAMMA = p.GAMMA;
        if(p.DT !== undefined) DT = p.DT;
        if(p.THRESH !== undefined) THRESH = p.THRESH;
        if(p.VORTEX_THRESH !== undefined) VORTEX_THRESH = p.VORTEX_THRESH;
    },

    // Obtener métricas actuales
    getMetrics() {
        computeFullHamiltonian();
        return {
            E_total, E_kin, E_higgs, E_torsion, E_vortex,
            helicity: computeHelicity(),
            psiMax: computePsiMax(),
            vortices: countVortices(),
            coherence: computeCoherence(),
        };
    },

    // Guardar campo previo para coherencia (llamar después de step)
    savePrev() { savePrevField(); },

    // Estado completo para snapshot
    getState() {
        return {
            U: new Float32Array(U), Ui: new Float32Array(Ui),
            V: new Float32Array(V), Vi: new Float32Array(Vi),
            W: new Float32Array(W), Wi: new Float32Array(Wi),
        };
    },

    // Restaurar estado desde snapshot
    setState(s) {
        U.set(s.U); Ui.set(s.Ui);
        V.set(s.V); Vi.set(s.Vi);
        W.set(s.W); Wi.set(s.Wi);
        computeCurl(); updateTextures();
    },

    // Parámetros actuales
    getParams() {
        return { ETA, LAMBDA, BOHM_C, HELIC_FEEDBACK, DAMP_BASE,
                 DAMP_VORT, GAMMA, DT, THRESH, VORTEX_THRESH };
    },

    // Para inyecciones en vivo
    inject(name) {
        if(name==='perturbacion') { injectPerturbation(); computeCurl(); updateTextures(); }
        if(name==='helicoidal')   { injectHelical(N/2,N/2,N/2,0.9,3.0); computeCurl(); updateTextures(); }
        if(name==='ruido')        { initNoise(0.05); computeCurl(); updateTextures(); }
    },

    // Clasificar estado narrativo desde métricas (lógica propia del motor)
    classifyState(m) {
        if(m.psiMax > 8 || (m.phi_max && m.phi_max > 8)) return 'collapse';
        if(m.E_total > 5 || m.vortices > 5) return 'stable';
        if(m.E_total > 1) return 'active';
        if(m.E_total > 0.1) return 'nucleating';
        return 'vacuum';
    },
};

} // end createEngine
