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

// Gradiente de densidad — para realce de bordes
// Versión barata: solo 3 samples (no 6)
float densityGradient(vec3 pos, float d){
    float s = 0.05;
    float dx = sampleVol(pos+vec3(s,0,0)) - d;
    float dy = sampleVol(pos+vec3(0,s,0)) - d;
    float dz = sampleVol(pos+vec3(0,0,s)) - d;
    return length(vec3(dx,dy,dz));
}

// Curva de densidad tipo rayos X
// Fondo negro, estructuras densas blancas, bordes realzados
// La fase añade un color tenue — como la coloración falsa en radiología
vec3 xrayColor(float d, float grad, float phase){
    // Transmisión inversa — más denso = más blanco (como rayos X reales)
    float transmission = 1.0 - exp(-d * 4.0);

    // Escala de grises base
    float grey = transmission;

    // Realce de bordes — el gradiente se suma como brillo extra
    float edge_boost = grad * 3.0;
    grey = clamp(grey + edge_boost, 0.0, 1.0);

    // Coloración sutil por fase — muy desaturada, solo una tinta
    // Como las placas radiológicas coloreadas para análisis
    vec3 tint;
    if(phase < 0.25){
        tint = vec3(0.85, 0.92, 1.0);   // azul frío — hueso
    } else if(phase < 0.5){
        tint = vec3(1.0, 0.97, 0.88);   // cálido — tejido
    } else if(phase < 0.75){
        tint = vec3(0.92, 1.0, 0.92);   // verde — contraste
    } else {
        tint = vec3(1.0, 0.90, 0.90);   // rojo — fluido
    }

    // Mezcla: gris puro en zonas de baja densidad,
    // tinte sutil en zonas densas
    vec3 col = mix(vec3(grey), vec3(grey)*tint, transmission*0.35);

    // Los bordes brillan ligeramente en el color de la fase
    col += tint * edge_boost * 0.3;

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

    // Rayos X usa más pasos — queremos ver la estructura interna completa
    float stepSize=2.0/80.0;
    int steps=int(min((tMax-tStart)/stepSize,160.0));
    vec4 acc=vec4(0.0);

    // Acumulación de transmisión (MIP + absorción)
    float max_density=0.0;
    float total_density=0.0;

    for(int i=0;i<160;i++){
        if(i>=steps) break;
        float t=tStart+(float(i)+0.5)*stepSize;
        vec3 pos=ro+rd*t;
        float d=sampleVol(pos);

        // MIP parcial — guarda el máximo local también
        if(d>max_density) max_density=d;
        total_density+=d*stepSize;

        if(d<uThresh*0.5) continue;

        float ph=samplePhase(pos);
        float grad=densityGradient(pos, d);
        vec3 col=xrayColor(d, grad, ph);

        // Alpha más alto que otros shaders — los rayos X acumulan
        float alpha=smoothstep(uThresh*0.5,uThresh*3.0,d)*0.08;
        acc.rgb+=col*alpha*(1.0-acc.a);
        acc.a  +=alpha*(1.0-acc.a);
        if(acc.a>0.98) break;
    }

    // Fondo negro — las placas radiológicas son negras
    if(acc.a < 0.005) discard;
    gl_FragColor=acc;
}
