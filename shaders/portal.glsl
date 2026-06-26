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
//  Shader PORTAL — dos engines simultáneos
//
//  Divide el espacio en dos mitades que se interpolan:
//    Engine A → mitad izquierda / zonas de baja fase
//    Engine B → mitad derecha / zonas de alta fase
//
//  La frontera entre ellos es la "ventana" del portal.
//  uPortalMix oscila animadamente para que la mezcla respire.
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
uniform sampler3D uVolume;    // Engine A — volumen
uniform sampler3D uPhase;     // Engine A — fase
uniform sampler3D uVolumeB;   // Engine B — volumen
uniform sampler3D uPhaseB;    // Engine B — fase
uniform float     uPortalMix; // 0→1 mezcla animada

float sampleA(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uVolume,uvw).r;
}
float sampleAph(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.5;
    return texture(uPhase,uvw).r;
}
float sampleB(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uVolumeB,uvw).r;
}
float sampleBph(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.5;
    return texture(uPhaseB,uvw).r;
}

// Rueda de colores — para colorear cada engine
vec3 phaseToColor(float ph){
    float a=ph*6.28318;
    return vec3(0.5+0.5*cos(a),0.5+0.5*cos(a-2.094),0.5+0.5*cos(a-4.189));
}

// Color de portal en la frontera — brillo donde se tocan los dos mundos
vec3 portalEdge(float frontier, float t){
    float glow=pow(max(0.0,1.0-abs(frontier)*4.0),3.0);
    vec3 edgeCol=mix(vec3(0.3,0.8,1.0),vec3(1.0,0.4,0.8),0.5+0.5*sin(t*2.0));
    return edgeCol*glow*2.5;
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

    float stepSize=2.0/64.0;
    int steps=int(min((tMax-tStart)/stepSize,128.0));
    vec4 acc=vec4(0.0);

    for(int i=0;i<128;i++){
        if(i>=steps) break;
        float t=tStart+(float(i)+0.5)*stepSize;
        vec3 pos=ro+rd*t;

        // Frontera del portal — divide el espacio
        // Plano oscilante en X modulado por uPortalMix
        float split=pos.x + sin(pos.z*2.0+uTime*0.5)*0.15;
        float frontier=split; // positivo=lado B, negativo=lado A

        // Peso de mezcla en este punto
        // La frontera es suave — no un corte duro
        float blend_B=smoothstep(-0.3,0.3,frontier+uPortalMix*0.4-0.2);
        float blend_A=1.0-blend_B;

        float dA=sampleA(pos);
        float dB=sampleB(pos);
        float phA=sampleAph(pos);
        float phB=sampleBph(pos);

        // Cada engine tiene su propio umbral visual
        bool visA=(dA>uThresh && blend_A>0.01);
        bool visB=(dB>uThresh && blend_B>0.01);

        if(!visA && !visB) continue;

        vec3 col=vec3(0.0);
        float alpha=0.0;

        // Contribución Engine A
        if(visA){
            float intA=smoothstep(uThresh,uThresh*3.0,dA);
            vec3 cA=phaseToColor(phA);
            col+=cA*intA*blend_A;
            alpha+=intA*blend_A*0.07;
        }

        // Contribución Engine B — tinte diferente para distinguirlos
        if(visB){
            float intB=smoothstep(uThresh,uThresh*3.0,dB);
            // Rotar la paleta del engine B 180° para diferenciar visualmente
            vec3 cB=phaseToColor(mod(phB+0.5,1.0));
            col+=cB*intB*blend_B;
            alpha+=intB*blend_B*0.07;
        }

        // Brillo en la frontera del portal
        col+=portalEdge(frontier, uTime);

        alpha=clamp(alpha,0.0,0.95);
        acc.rgb+=col*alpha*(1.0-acc.a);
        acc.a  +=alpha*(1.0-acc.a);
        if(acc.a>0.95) break;
    }

    gl_FragColor=acc;
}
