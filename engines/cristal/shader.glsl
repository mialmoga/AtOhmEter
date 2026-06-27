// === VERTEX ===
    varying vec3 vWorldPos;
    varying vec3 vLocalPos;
    uniform float uBoxSize;
    void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vLocalPos = position / uBoxSize;
        gl_Position = projectionMatrix * viewMatrix * wp;
    }


// === FRAGMENT ===
// ══════════════════════════════════════════════════════════════
//  CRISTAL — Cristalización Emergente
//
//  phaseData codificación:
//    [0.00 - 0.45] → líquido  (valor = temperatura local)
//    [0.50]        → hielo    (blanco-azul, dendrítico)
//    [0.62]        → cuarzo   (transparente, prismas)
//    [0.74]        → bismuto  (iridiscente, escalonado)
//    [0.86]        → sal      (cúbico, blanco puro)
// ══════════════════════════════════════════════════════════════

precision highp float;
precision highp sampler3D;

varying vec3 vWorldPos;
varying vec3 vLocalPos;

uniform vec3      uCameraPos;
uniform vec3      uCameraLocal;
uniform float     uTime;
uniform float     uThresh;
uniform float     uEnergy;
uniform sampler3D uVolume;
uniform sampler3D uPhase;
uniform vec3      uTouchPos;
uniform float     uTouchActive;
uniform float     uTouchTime;

// ── Constantes globales ───────────────────────────────────────
#define SALT_GRID 12.0
#define EPS 0.055

float sampleVol(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uVolume,uvw).r;
}
float samplePhase(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uPhase,uvw).r;
}

// ── Estado: qué fracción del voxel es cristal ────────────────
float crystalFraction(float ph){
    return smoothstep(0.46, 0.54, ph);
}

// ── Normales ─────────────────────────────────────────────────
vec3 facetNormal(vec3 pos){
    float dx=sampleVol(pos+vec3(EPS,0,0))-sampleVol(pos-vec3(EPS,0,0));
    float dy=sampleVol(pos+vec3(0,EPS,0))-sampleVol(pos-vec3(0,EPS,0));
    float dz=sampleVol(pos+vec3(0,0,EPS))-sampleVol(pos-vec3(0,0,EPS));
    vec3 n=vec3(dx,dy,dz);
    // Cuantización: produce facetas planas
    n=normalize(floor(n*3.0+0.5)/3.0+0.001);
    return n;
}

vec3 smoothNormal(vec3 pos){
    float dx=sampleVol(pos+vec3(EPS,0,0))-sampleVol(pos-vec3(EPS,0,0));
    float dy=sampleVol(pos+vec3(0,EPS,0))-sampleVol(pos-vec3(0,EPS,0));
    float dz=sampleVol(pos+vec3(0,0,EPS))-sampleVol(pos-vec3(0,0,EPS));
    return normalize(vec3(dx,dy,dz)+0.001);
}

// ── Dispersión prismática ─────────────────────────────────────
vec3 prismDispersion(vec3 rd, vec3 normal, float ior_base){
    float cosi=abs(dot(rd,normal));
    float r_c=sqrt(max(0.0,1.0-(1.0-cosi*cosi)/((ior_base+0.025)*(ior_base+0.025))));
    float g_c=sqrt(max(0.0,1.0-(1.0-cosi*cosi)/(ior_base*ior_base)));
    float b_c=sqrt(max(0.0,1.0-(1.0-cosi*cosi)/((ior_base-0.025)*(ior_base-0.025))));
    return clamp(vec3(r_c,g_c,b_c),0.0,1.0);
}

// ── Color del líquido ─────────────────────────────────────────
vec3 liquidColor(float intensity, float ph){
    float t=intensity;
    vec3 col;
    if(t<0.25)      col=mix(vec3(0.0,0.01,0.06),  vec3(0.02,0.08,0.28), t/0.25);
    else if(t<0.55) col=mix(vec3(0.02,0.08,0.28), vec3(0.05,0.45,0.85), (t-0.25)/0.3);
    else if(t<0.8)  col=mix(vec3(0.05,0.45,0.85), vec3(0.3,0.92,1.0),   (t-0.55)/0.25);
    else            col=mix(vec3(0.3,0.92,1.0),    vec3(0.92,0.97,1.0),  (t-0.8)/0.2);
    float spark=abs(sin(ph*18.0+uTime*0.4))*0.1;
    col+=vec3(0.3,0.6,1.0)*spark*t;
    return col;
}

// ── HIELO ─────────────────────────────────────────────────────
vec3 iceColor(float density, vec3 normal, vec3 rd, vec3 pos){
    vec3 deep=vec3(0.1,0.4,0.9);
    vec3 pale=vec3(0.75,0.88,1.0);
    float internal=abs(sin(pos.x*9.0+uTime*0.15))
                  *abs(sin(pos.z*7.3+uTime*0.12))
                  *abs(sin(pos.y*11.0+uTime*0.08));
    vec3 col=mix(deep,pale,internal);
    // Especular duro
    vec3 L=normalize(vec3(0.4,1.0,0.3));
    float spec=pow(max(0.0,dot(reflect(-L,normal),-rd)),60.0);
    col+=vec3(1.0)*spec*2.0;
    // Prisma
    vec3 disp=prismDispersion(rd,normal,1.31);
    col+=disp*spec*0.8;
    // Ambient azulado para que sea visible aunque no haya spec
    col+=vec3(0.05,0.12,0.3)*density;
    return col;
}

// ── CUARZO ────────────────────────────────────────────────────
vec3 quartzColor(float density, vec3 normal, vec3 rd, vec3 pos, float ph){
    float t=fract(ph*10.0);
    vec3 tint=mix(vec3(0.9,0.95,1.0),vec3(0.85,0.7,0.9),t);
    vec3 l1=normalize(vec3(0.5,1.0,0.3));
    vec3 l2=normalize(vec3(-0.6,0.4,-0.5));
    float s1=pow(max(0.0,dot(reflect(-l1,normal),-rd)),60.0);
    float s2=pow(max(0.0,dot(reflect(-l2,normal),-rd)),30.0);
    vec3 col=tint*(0.08+density*0.2);
    col+=tint*s1*2.5;
    col+=vec3(0.6,0.5,1.0)*s2*0.8;
    col+=prismDispersion(rd,normal,1.55)*s1*1.5;
    float incl=sin(pos.x*13.0+pos.z*7.0)*sin(pos.y*11.0);
    col+=tint*max(0.0,incl)*density*0.2;
    return col;
}

// ── BISMUTO ───────────────────────────────────────────────────
vec3 bismuthColor(float density, vec3 normal, vec3 rd, vec3 pos, float ph){
    float angle=abs(dot(-rd,normal));
    float thickness=0.5+0.5*sin(pos.x*8.0+pos.y*6.0+pos.z*7.0);
    float p1=thickness*angle*10.0+uTime*0.05;
    float p2=thickness*angle*14.0+uTime*0.04;
    float p3=thickness*angle*7.0 +uTime*0.06;
    vec3 iri=vec3(0.5+0.5*sin(p1), 0.5+0.5*sin(p2+1.2), 0.5+0.5*sin(p3+2.8));
    vec3 metal=vec3(0.7,0.72,0.75);
    vec3 L=normalize(vec3(0.3,1.0,0.4));
    float spec=pow(max(0.0,dot(reflect(-L,normal),-rd)),40.0);
    float fr=pow(max(0.0,1.0-angle),2.5);
    vec3 col=metal*(0.15+density*0.2);
    col=mix(col,iri*1.2,fr*0.85+0.15);
    col+=vec3(1.0)*spec*1.2;
    // Ambient para visibilidad base
    col+=iri*0.15*density;
    return col;
}

// ── SAL ───────────────────────────────────────────────────────
vec3 saltColor(float density, vec3 normal, vec3 rd, vec3 pos){
    vec3 base=vec3(0.95,0.97,1.0);
    vec3 L1=normalize(vec3(0.5,1.0,0.3));
    vec3 L2=normalize(vec3(-0.5,0.8,-0.4));
    float s1=pow(max(0.0,dot(reflect(-L1,normal),-rd)),80.0);
    float s2=pow(max(0.0,dot(reflect(-L2,normal),-rd)),40.0);
    vec3 col=base*(0.12+density*0.3);
    col+=vec3(1.0)*s1*2.5;
    col+=vec3(0.9,0.95,1.0)*s2;
    float edge=abs(sin(pos.x*SALT_GRID))*abs(sin(pos.z*SALT_GRID));
    col+=vec3(1.0)*edge*density*0.35;
    return col;
}

// ── Fresnel ───────────────────────────────────────────────────
float fresnel(vec3 rd, vec3 n, float power){
    return pow(max(0.0,1.0-abs(dot(rd,n))),power);
}

float boxExit(vec3 ro,vec3 rd,float hs){
    vec3 invD=1.0/rd;
    vec3 t0=(-hs-ro)*invD,t1=(hs-ro)*invD;
    vec3 tm=max(t0,t1);
    return min(min(tm.x,tm.y),tm.z);
}

void main(){
    vec3 ro=uCameraLocal;
    vec3 rd=normalize(vLocalPos-ro);
    float tMax=boxExit(ro,rd,1.0);
    if(tMax<0.0) discard;

    float tStart=0.001;
    if(!all(greaterThan(ro,vec3(-1.0)))||!all(lessThan(ro,vec3(1.0)))){
        vec3 invD=1.0/rd;
        vec3 t0=(-1.0-ro)*invD,t1=(1.0-ro)*invD;
        vec3 tm=min(t0,t1);
        tStart=max(max(tm.x,tm.y),tm.z);
        if(tStart<0.0) tStart=0.001;
    }

    // Umbral muy permisivo para que funcione con cualquier motor via &shader=
    float thresh = max(uThresh * 0.3, 0.015);

    float stepSize=2.0/72.0;
    int steps=int(min((tMax-tStart)/stepSize,128.0));
    vec4 acc=vec4(0.0);

    for(int i=0;i<128;i++){
        if(i>=steps) break;
        float tt=tStart+(float(i)+0.5)*stepSize;
        vec3 pos=ro+rd*tt;
        float d=sampleVol(pos);
        if(d < thresh) continue;

        float ph=samplePhase(pos);
        float density=smoothstep(thresh, thresh*6.0, d);
        float cFrac=crystalFraction(ph);

        vec3 col;
        float alpha;

        if(cFrac < 0.05){
            // ── LÍQUIDO ───────────────────────────────────────
            vec3 n=smoothNormal(pos);
            float fr=fresnel(rd,n,3.0);
            col=liquidColor(density,ph);
            col+=vec3(0.4,0.85,1.0)*fr*0.4*density;
            alpha=density*0.055;

        } else if(cFrac > 0.95){
            // ── CRISTAL PURO ──────────────────────────────────
            vec3 n=facetNormal(pos);
            if(ph<0.56)      col=iceColor(density,n,rd,pos);
            else if(ph<0.68) col=quartzColor(density,n,rd,pos,ph);
            else if(ph<0.80) col=bismuthColor(density,n,rd,pos,ph);
            else             col=saltColor(density,n,rd,pos);

            // Alpha más alto para que el cristal sea visible
            // spec ya está incluido en cada función de color
            vec3 Ls=normalize(vec3(0.5,1.0,0.3));
            vec3 ns=facetNormal(pos);
            float spec=pow(max(0.0,dot(reflect(-Ls,ns),-rd)),50.0);
            alpha=(density*0.06+spec*0.2)*(1.0-acc.a);

        } else {
            // ── FRENTE DE CRISTALIZACIÓN ──────────────────────
            vec3 nS=smoothNormal(pos);
            vec3 nF=facetNormal(pos);
            vec3 n=normalize(mix(nS,nF,cFrac));

            vec3 colL=liquidColor(density,ph);
            vec3 colC;
            if(ph<0.56)      colC=iceColor(density,n,rd,pos);
            else if(ph<0.68) colC=quartzColor(density,n,rd,pos,ph);
            else if(ph<0.80) colC=bismuthColor(density,n,rd,pos,ph);
            else             colC=saltColor(density,n,rd,pos);

            col=mix(colL,colC,cFrac);
            // El frente brilla — nucleación libera energía
            float glow=cFrac*(1.0-cFrac)*4.0;
            col+=vec3(0.8,0.95,1.0)*glow*0.5;
            alpha=density*mix(0.055,0.045,cFrac);
        }

        acc.rgb+=col*alpha*(1.0-acc.a);
        acc.a  +=alpha*(1.0-acc.a);
        if(acc.a>0.95) break;
    }

    // ── Borde del cubo ────────────────────────────────────────
    float edgeMask=max(max(abs(vLocalPos.x),abs(vLocalPos.y)),abs(vLocalPos.z));
    float edge=smoothstep(0.88,1.0,edgeMask);
    if(edge>0.0 && acc.a<0.2){
        float edgePh=samplePhase(vLocalPos*0.9);
        vec3 edgeCol;
        if(edgePh<0.5){
            edgeCol=vec3(0.05,0.15,0.4); // líquido — azul oscuro
        } else if(edgePh<0.56){
            edgeCol=vec3(0.7,0.88,1.0);  // hielo
        } else if(edgePh<0.68){
            edgeCol=vec3(0.9,0.8,1.0);   // cuarzo
        } else if(edgePh<0.80){
            // bismuto — arcoíris animado
            float a=uTime*0.08+vLocalPos.x*2.0+vLocalPos.y*1.5;
            edgeCol=vec3(0.5+0.5*sin(a),0.5+0.5*sin(a+2.1),0.5+0.5*sin(a+4.2));
        } else {
            edgeCol=vec3(0.97,0.98,1.0); // sal
        }
        acc.rgb+=edgeCol*edge*0.15*(1.0-acc.a);
        acc.a  +=edge*0.07*(1.0-acc.a);
    }

    gl_FragColor=clamp(acc,0.0,1.0);
}
