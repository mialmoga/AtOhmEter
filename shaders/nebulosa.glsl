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

uniform vec3    uCameraPos;
uniform vec3    uCameraLocal;
uniform float   uTime;
uniform float   uThresh;
uniform float   uEnergy;
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

// Hash para estrellas
float hash(vec3 p){
    p=fract(p*vec3(127.1,311.7,74.7));
    p+=dot(p,p+19.5);
    return fract(p.x*p.y*p.z);
}

// Paleta nebulosa: negro → púrpura → rosa → dorado → blanco estelar
// La fase cambia el "tipo" de nebulosa — emisión vs reflexión
vec3 nebulosaColor(float t, float phase) {
    // Dos paletas — mezcla según fase
    // Paleta A: emisión (hidrógeno) — rosa/rojo
    vec3 emitA, emitB, emitC;
    if (phase < 0.33) {
        // Nebulosa de emisión (rojo/rosa)
        emitA = vec3(0.08, 0.0, 0.12);
        emitB = vec3(0.6, 0.05, 0.35);
        emitC = vec3(1.0, 0.3, 0.5);
    } else if (phase < 0.66) {
        // Nebulosa de reflexión (azul/púrpura)
        emitA = vec3(0.02, 0.0, 0.1);
        emitB = vec3(0.15, 0.1, 0.6);
        emitC = vec3(0.4, 0.5, 1.0);
    } else {
        // Nebulosa planetaria (verde/dorado)
        emitA = vec3(0.0, 0.05, 0.02);
        emitB = vec3(0.1, 0.45, 0.2);
        emitC = vec3(0.9, 0.85, 0.1);
    }

    vec3 col;
    if (t < 0.3) {
        col = mix(emitA, emitB, t/0.3);
    } else if (t < 0.75) {
        col = mix(emitB, emitC, (t-0.3)/0.45);
    } else {
        // Núcleo estelar — blanco caliente
        col = mix(emitC, vec3(1.0,0.98,0.95), (t-0.75)/0.25);
    }

    // Centelleo temporal — filamentos de gas
    float filament = 0.5+0.5*sin(uTime*0.7+phase*20.0+t*8.0);
    col *= 0.85 + 0.15*filament;

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

        // Estrellas de fondo — puntos de luz en el vacío
        float star=hash(floor(pos*80.0));
        if(d < uThresh) {
            if(star>0.997) {
                // Estrella — destellos blancos/azulados
                float blink=0.7+0.3*sin(uTime*3.0+star*100.0);
                vec3 starCol=mix(vec3(0.8,0.9,1.0),vec3(1.0,0.95,0.8),star*2.0-1.0);
                acc.rgb+=starCol*blink*0.015*(1.0-acc.a);
                acc.a  +=0.005*(1.0-acc.a);
            }
            continue;
        }

        float ph=samplePhase(pos);
        float intensity=smoothstep(uThresh,uThresh*6.0,d);
        vec3 col=nebulosaColor(intensity,ph);

        // Scattering anisótropo — la luz se dispersa en la nebulosa
        float d_light=sampleVol(pos+normalize(vec3(0.5,1.0,0.3))*stepSize*4.0);
        float scatter=exp(-d_light*2.0);
        col*=0.4+0.6*scatter;

        float alpha=intensity*0.045;
        acc.rgb+=col*alpha*(1.0-acc.a);
        acc.a  +=alpha*(1.0-acc.a);
        if(acc.a>0.95) break;
    }

    gl_FragColor=acc;
}
