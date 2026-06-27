// ═══════════════════════════════════════════════════════════
//  AtOhmEter Engine V56 — Campo Complejo ψ ∈ ℂ³ (rama V5.6-3)
//
//  "La hélice que se desintegra"
//
//  Misma ecuación base que V5.5 (Schrödinger ℂ³ + snap variacional
//  + Bohm + Higgs + phase coupling), pero en la rama V5.6-3 la
//  semilla helicoidal NUCLEA y luego SE DESINTEGRA:
//    · LAMBDA alto (0.3) — potencial Higgs fuerte
//    · Bohm crudo, sin atenuar por densidad
//    · DAMP uniforme (0.995) — NO protege vórtices
//    · sin feedback helicoidal — nada sostiene la helicidad
//  El resultado es una progresión: vacío → nucleación → estructura
//  transitoria → desintegración. Esa transitoriedad es la física
//  propia de esta rama (no un bug — la rama V5.5 la "arregla" con
//  damping adaptativo + feedback; aquí la conservamos a propósito).
//
//  CAPACIDAD NUEVA — primer motor que consume la cámara (MediaPipe):
//  setHand(landmarks, active) recibe los 21 landmarks crudos del
//  shell (HandEngine) y hace DOS cosas, igual que el V5.6-3 original:
//    1. escribe uHandBones[21]/uHandActive → mano de plasma en shader
//    2. inyecta cada articulación como perturbación helicoidal al campo
//
//  Exporta el contrato completo del shell.
// ═══════════════════════════════════════════════════════════

export function createEngine(N, renderVolume, phaseData, texture3D, texturePhase) {

const EXTENT = 2.5;
const DX   = (2*EXTENT) / (N-1);
const TOTAL = N*N*N;
const EPS_RHO = 1e-9;
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

// ── Parámetros — calibración V5.6-3 (rama que se desintegra) ──
let ETA    = 0.15;   // snap
let LAMBDA = 0.3;    // potencial Higgs — controla energía total (alto → desintegra)
const PHI0   = 1.0;  // densidad de equilibrio
const GAMMA  = 0.15; // phase coupling
const THETA0 = 0.0;  // fase del vacío
let BOHM_C = 1.0;    // Bohm (crudo, sin atenuar — distingue de V5.5)
let DT     = 0.003;  // más conservador con LAMBDA alto
let THRESH = 0.15;
const DAMP = 0.995;  // viscosidad del vacío — UNIFORME (no protege vórtices)
let VORTEX_THRESH = 0.5;   // umbral para contar vórtices
let HAND_GAIN = 0.15;      // ganancia de la inyección de mano — suave por defecto
                            // (la mano ACARICIA el campo; subir para que lo detone 🌬️→💥)
let frameCount = 0;
let currentSeed = 'grumo';

// Buffers para métrica de persistencia C(x,t) = |⟨ψ(t),ψ(t-Δt)⟩|
let prevU  = new Float32Array(TOTAL);
let prevUi = new Float32Array(TOTAL);
let prevV  = new Float32Array(TOTAL);
let prevVi = new Float32Array(TOTAL);
let prevW  = new Float32Array(TOTAL);
let prevWi = new Float32Array(TOTAL);

function idx(i,j,k){ return i*N*N + j*N + k; }

function get(arr,i,j,k){
    i=((i%N)+N)%N; j=((j%N)+N)%N; k=((k%N)+N)%N;
    return arr[idx(i,j,k)];
}

// ── Semillas ─────────────────────────────────────────────────
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

// Semilla helicoidal — un nudo de torsión (720° topológico) que el
// integrador de esta rama deja desintegrar con el tiempo
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

// ── Operadores diferenciales ─────────────────────────────────
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

// ── Evolución — integrador V5.6-3 (DAMP uniforme, sin feedback) ──
function stepEvolve(){
    // log(ρ) para la presión de Bohm
    for(let n=0;n<TOTAL;n++){
        const rho=Math.max(U[n]**2+Ui[n]**2+V[n]**2+Vi[n]**2+W[n]**2+Wi[n]**2, EPS_RHO);
        logRho[n]=Math.log(rho);
    }

    // Bohm crudo: Q = -(BOHM_C/4)·[∇²log ρ + ½|∇log ρ|²]
    // (en V5.6-3 NO se atenúa por densidad — esa es la diferencia con V5.5)
    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        const glx=gx(logRho,i,j,k), gly=gy(logRho,i,j,k), glz=gz(logRho,i,j,k);
        bohmScalar[n]=-(BOHM_C/4)*(lap(logRho,i,j,k)+0.5*(glx*glx+gly*gly+glz*glz));
    }

    // curl(ψ)
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

    // cross = ψ × curl(ψ)  (complejo)
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

    // snap = ∇×(cross) = ∇×[ψ×(∇×ψ)]  (forma variacional correcta)
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

    // FIX ANTIPETATEO: Límite de fuerza para evitar la singularidad NaN
    const clampF = (val) => Math.max(-100.0, Math.min(100.0, val));

    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        const ur=U[n],ui=Ui[n], vr=V[n],vi=Vi[n], wr=W[n],wi=Wi[n];
        const rho=Math.max(ur*ur+ui*ui+vr*vr+vi*vi+wr*wr+wi*wi, EPS_RHO);
        const Vp=LAMBDA*(rho-PHI0*PHI0);
        const Q=bohmScalar[n];

        const lapUr=lap(U,i,j,k),  lapUi=lap(Ui,i,j,k);
        const lapVr=lap(V,i,j,k),  lapVi=lap(Vi,i,j,k);
        const lapWr=lap(W,i,j,k),  lapWi=lap(Wi,i,j,k);

        // F = -½∇²ψ + V'ψ + phase_coupling + snap + Bohm
        const FUr=-0.5*lapUr + Vp*ur + (pcr*ur-pci*ui) + ETA*snapX[n]  + Q*ur;
        const FUi=-0.5*lapUi + Vp*ui + (pcr*ui+pci*ur) + ETA*snapXi[n] + Q*ui;
        const FVr=-0.5*lapVr + Vp*vr + (pcr*vr-pci*vi) + ETA*snapY[n]  + Q*vr;
        const FVi=-0.5*lapVi + Vp*vi + (pcr*vi+pci*vr) + ETA*snapYi[n] + Q*vi;
        const FWr=-0.5*lapWr + Vp*wr + (pcr*wr-pci*wi) + ETA*snapZ[n]  + Q*wr;
        const FWi=-0.5*lapWi + Vp*wi + (pcr*wi+pci*wr) + ETA*snapZi[n] + Q*wi;

        // Integración estabilizada — Schrödinger: ∂ψ/∂t = -i·F
        // DAMP uniforme (la rama V5.6-3 no protege vórtices → desintegración)
        U[n]  = (U[n]  + DT * clampF(FUi))  * DAMP;
        Ui[n] = (Ui[n] + DT * clampF(-FUr)) * DAMP;
        V[n]  = (V[n]  + DT * clampF(FVi))  * DAMP;
        Vi[n] = (Vi[n] + DT * clampF(-FVr)) * DAMP;
        W[n]  = (W[n]  + DT * clampF(FWi))  * DAMP;
        Wi[n] = (Wi[n] + DT * clampF(-FWr)) * DAMP;
    }
    frameCount++;
}

// ═══════════════════════════════════════════════════════════
//  HAMILTONIANO COMPLETO — componentes de energía
// ═══════════════════════════════════════════════════════════
let E_kin = 0, E_higgs = 0, E_torsion = 0, E_vortex = 0, E_total = 0;

function computeFullHamiltonian(){
    let ek=0, eh=0, et=0, ev=0;
    for(let i=0;i<N;i++) for(let j=0;j<N;j++) for(let k=0;k<N;k++){
        const n=idx(i,j,k);
        const rho = U[n]**2+Ui[n]**2+V[n]**2+Vi[n]**2+W[n]**2+Wi[n]**2;

        // E_higgs = λ(ρ - φ₀²)²
        const dRho = rho - PHI0*PHI0;
        eh += LAMBDA * dRho * dRho;

        // E_vortex = |∇×ψ|² (proxy legacy)
        ev += curlMag[n] * curlMag[n];

        // E_torsion = |ψ×(∇×ψ)|² — recalculado inline
        const ur=U[n],ui=Ui[n], vr=V[n],vi=Vi[n], wr=W[n],wi=Wi[n];
        const cxr=curlX[n],cxi=curlXi[n];
        const cyr=curlY[n],cyi=curlYi[n];
        const czr=curlZ[n],czi=curlZi[n];
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

// C(x,t) = |⟨ψ(t),ψ(t-Δt)⟩| — persistencia (cae al desintegrarse)
function computeCoherence(){
    let sumC=0, count=0;
    for(let n=0;n<TOTAL;n++){
        const mag2 = U[n]**2+Ui[n]**2+V[n]**2+Vi[n]**2+W[n]**2+Wi[n]**2;
        const pmag2= prevU[n]**2+prevUi[n]**2+prevV[n]**2+prevVi[n]**2+prevW[n]**2+prevWi[n]**2;
        if(mag2 < 1e-12 || pmag2 < 1e-12) continue;
        const dot = U[n]*prevU[n]+Ui[n]*prevUi[n]
                  +V[n]*prevV[n]+Vi[n]*prevVi[n]
                  +W[n]*prevW[n]+Wi[n]*prevWi[n];
        sumC += Math.abs(dot) / (Math.sqrt(mag2)*Math.sqrt(pmag2));
        count++;
    }
    return count > 0 ? sumC/count : 0;
}

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

// ── Texturas para el GPU ─────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════
//  MANO — el motor consume los landmarks crudos del shell
//  (HandEngine). Hace DOS cosas, como el V5.6-3 original:
//    1. escribe uHandBones[21]/uHandActive en el shader
//    2. inyecta cada articulación como perturbación helicoidal
// ═══════════════════════════════════════════════════════════

// Amplitud diferenciada: puntas de dedo > nudillos > muñeca
const HAND_AMP = [
    0.12, 0.14, 0.16, 0.20, 0.30,  // muñeca + pulgar (tip alto)
    0.14, 0.16, 0.20, 0.32,        // índice (tip máximo)
    0.14, 0.16, 0.20, 0.28,        // medio
    0.13, 0.15, 0.18, 0.25,        // anular
    0.12, 0.14, 0.17, 0.23,        // meñique
];

// EMA smoothing interno — evita jitter frame a frame
let _handSmoothed = Array.from({length:21}, () => ({x:0,y:0,z:0}));
let _handHasFirst = false;
const _HAND_ALPHA = 0.18;
let _handFrameSkip = 0;
const _HAND_SKIP_EVERY = 3;   // inyectar al campo 1 de cada 3 frames (ligero)
let _handActive = false;
let _handVisible = false;     // ¿mostrar la mano de plasma? lo controla el botón Vol.Mano

// Landmark normalizado [0,1] → volumen [-1,1]
// x: espejo horizontal (selfie), y: invertido (arriba=+1), z amplificado
function landmarkToVolume(lm) {
    return {
        x: (1.0 - lm.x) * 2.0 - 1.0,
        y: (1.0 - lm.y) * 2.0 - 1.0,
        z: lm.z * 5.0,
    };
}

// Inyectar perturbación helicoidal en una coordenada de volumen
function injectHandJoint(vx, vy, vz, amplitude) {
    const ci = Math.round((vx + 1.0) * 0.5 * (N - 1));
    const cj = Math.round((vy + 1.0) * 0.5 * (N - 1));
    const ck = Math.round((vz + 1.0) * 0.5 * (N - 1));
    const ii = Math.max(1, Math.min(N - 2, ci));
    const jj = Math.max(1, Math.min(N - 2, cj));
    const kk = Math.max(1, Math.min(N - 2, ck));
    injectHelical(ii, jj, kk, amplitude * HAND_GAIN, N * 0.11);
}

// Escribir los huesos suavizados en el uniform del shader.
// IMPORTANTE: el motor NO toca uHandActive — ese flag lo controla el
// botón Vol.Mano del shell. El motor solo mantiene los huesos al día
// para que, cuando el usuario encienda el plasma, ya estén actualizados.
// Así la mano volumétrica no aparece "siempre": solo cuando se pide.
function writeHandUniforms() {
    const u = (typeof window !== 'undefined') ? window._uniforms : null;
    if (!u || !u.uHandBones) return;
    if (!_handVisible) return;  // _handVisible lo fija el shell vía setHandVisible
    for (let i = 0; i < 21; i++) {
        const s = _handSmoothed[i];
        u.uHandBones.value[i].set(
            (1.0 - s.x) * 2.0 - 1.0,
            (1.0 - s.y) * 2.0 - 1.0,
            s.z * 5.0
        );
    }
}

// setHand(landmarks, active) — contrato motor↔shell (gemelo de Mic/Gyro)
//   landmarks: array de 21 {x,y,z} normalizados [0,1], o null
//   active:    bool — la cámara está entregando una mano
function setHand(landmarks, active) {
    _handActive = !!(active && landmarks && landmarks.length >= 21);

    if (!_handActive) {
        _handHasFirst = false;
        writeHandUniforms();
        return;
    }

    // EMA smoothing
    const a = _HAND_ALPHA;
    for (let i = 0; i < 21; i++) {
        const r = landmarks[i];
        const s = _handSmoothed[i];
        if (!_handHasFirst) { s.x = r.x; s.y = r.y; s.z = r.z; }
        else {
            s.x = s.x*(1-a) + r.x*a;
            s.y = s.y*(1-a) + r.y*a;
            s.z = s.z*(1-a) + r.z*a;
        }
    }
    _handHasFirst = true;

    // 1. mano de plasma en el shader (siempre — incluso pausado)
    writeHandUniforms();

    // 2. inyección al campo (1 de cada N frames para no saturar)
    _handFrameSkip++;
    if (_handFrameSkip >= _HAND_SKIP_EVERY) {
        _handFrameSkip = 0;
        for (let i = 0; i < 21; i++) {
            const v = landmarkToVolume(landmarks[i]);
            injectHandJoint(v.x, v.y, v.z, HAND_AMP[i]);
        }
        computeCurl();
    }
}

// ── API pública ──────────────────────────────────────────────
return {
    seed(name) {
        currentSeed = name;
        for(let n=0;n<TOTAL;n++) U[n]=Ui[n]=V[n]=Vi[n]=W[n]=Wi[n]=0;
        if(name==='grumo')           { initGrumo(); initNoise(0.01); }
        else if(name==='helicoidal') { injectHelical(N/2,N/2,N/2,1.0,4.0); initNoise(0.005); }
        else if(name==='ruido')      { initNoise(0.15); }
        // vacio: todo en cero
        frameCount = 0;
        computeCurl();
        updateTextures();
    },

    step() { stepEvolve(); },

    refresh() { computeCurl(); updateTextures(); },

    applyParams(p) {
        if(p.ETA !== undefined) ETA = p.ETA;
        if(p.LAMBDA !== undefined) LAMBDA = p.LAMBDA;
        if(p.BOHM_C !== undefined) BOHM_C = p.BOHM_C;
        if(p.DT !== undefined) DT = p.DT;
        if(p.THRESH !== undefined) THRESH = p.THRESH;
        if(p.VORTEX_THRESH !== undefined) VORTEX_THRESH = p.VORTEX_THRESH;
        if(p.HAND_GAIN !== undefined) HAND_GAIN = p.HAND_GAIN;
    },

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

    savePrev() { savePrevField(); },

    getState() {
        return {
            U: new Float32Array(U), Ui: new Float32Array(Ui),
            V: new Float32Array(V), Vi: new Float32Array(Vi),
            W: new Float32Array(W), Wi: new Float32Array(Wi),
        };
    },

    setState(s) {
        U.set(s.U); Ui.set(s.Ui);
        V.set(s.V); Vi.set(s.Vi);
        W.set(s.W); Wi.set(s.Wi);
        computeCurl(); updateTextures();
    },
    loadState(s) { this.setState(s); },

    getParams() {
        return { ETA, LAMBDA, BOHM_C, DT, THRESH, VORTEX_THRESH, HAND_GAIN };
    },

    inject(name) {
        if(name==='perturbacion') { injectPerturbation(); computeCurl(); updateTextures(); }
        else if(name==='helicoidal') { injectHelical(N/2,N/2,N/2,0.9,3.0); computeCurl(); updateTextures(); }
        else if(name==='ruido') { initNoise(0.05); computeCurl(); updateTextures(); }
    },

    // ── Contrato de la mano (HandEngine del shell) ──
    setHand,

    // El shell enciende/apaga la mano de plasma volumétrica (botón Vol.Mano).
    // Cuando se apaga, limpia uHandActive para que el shader no la dibuje.
    setHandVisible(v) {
        _handVisible = !!v;
        const u = (typeof window !== 'undefined') ? window._uniforms : null;
        if (u && u.uHandActive) u.uHandActive.value = _handVisible;
        if (_handVisible) writeHandUniforms();
    },

    classifyState(m) {
        // vacío → nucleación → estructura transitoria → desintegración
        if(m.psiMax > 8) return 'collapse';
        if(m.E_total > 5 || m.vortices > 5) return 'stable';
        if(m.E_total > 1) return 'active';
        if(m.E_total > 0.1) return 'nucleating';
        return 'vacuum';
    },
};

} // end createEngine
