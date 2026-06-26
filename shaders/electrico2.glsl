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

float sampleVol(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uVolume,uvw).r;
}
float samplePhase(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.5;
    return texture(uPhase,uvw).r;
}

// Detección de bordes — compara con vecinos para encontrar filamentos
float edgeDetect(vec3 pos, float d, float stepSize){
    float d2 = sampleVol(pos + vec3(stepSize,0,0))
             + sampleVol(pos - vec3(stepSize,0,0))
             + sampleVol(pos + vec3(0,stepSize,0))
             + sampleVol(pos - vec3(0,stepSize,0));
    return abs(d*4.0 - d2) * 2.0;
}

// Paleta eléctrica según fase
// fase 0→0.33: cyan eléctrico, 0.33→0.66: violeta plasma, 0.66→1: verde neón
vec3 electricColor(float intensity, float edge, float phase, float t){
    vec3 baseCol;
    if(phase < 0.33){
        baseCol = vec3(0.0, 0.8, 1.0);   // cyan
    } else if(phase < 0.66){
        baseCol = vec3(0.7, 0.1, 1.0);   // violeta
    } else {
        baseCol = vec3(0.1, 1.0, 0.3);   // verde neón
    }

    // El núcleo es blanco caliente
    vec3 col = mix(baseCol, vec3(1.0), intensity*intensity);

    // Los bordes son más brillantes — el arco eléctrico
    col += baseCol * edge * 3.0;

    // Parpadeo de descarga — rápido e irregular
    float flicker = 0.85 + 0.15*sin(uTime*18.0 + phase*25.0 + intensity*10.0);
    col *= flicker;

    // Corona — halo suave alrededor del filamento
    float corona = exp(-intensity * 4.0) * intensity * 2.0;
    col += baseCol * corona * 0.4;

    return col;
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
        float d=sampleVol(pos);
        if(d<uThresh*0.3) continue; // umbral muy bajo — ver hasta los filamentos tenues

        float ph=samplePhase(pos);
        float intensity=smoothstep(uThresh, uThresh*3.0, d);
        float edge=clamp(edgeDetect(pos, d, 0.04), 0.0, 0.8);

        vec3 col=electricColor(intensity, edge, ph, t);

        // Fondo negro total — el vacío no existe
        float alpha=(intensity*0.05 + edge*0.08) * (1.0-acc.a);
        acc.rgb+=col*alpha;
        acc.a  +=alpha;
        if(acc.a>0.95) break;
    }

    // Fondo negro puro — sin atmósfera
    if(acc.a < 0.01) discard;
    gl_FragColor=acc;
}
