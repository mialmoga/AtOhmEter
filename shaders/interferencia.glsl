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

// Espectro visible completo — longitud de onda → RGB
// Aproximación de Bruton (1997) adaptada para GLSL
vec3 wavelengthToRGB(float lambda){
    // lambda en nm, rango [380, 780]
    vec3 col = vec3(0.0);
    if(lambda>=380.0&&lambda<440.0){
        col=vec3(-(lambda-440.0)/60.0, 0.0, 1.0);
    } else if(lambda<490.0){
        col=vec3(0.0, (lambda-440.0)/50.0, 1.0);
    } else if(lambda<510.0){
        col=vec3(0.0, 1.0, -(lambda-510.0)/20.0);
    } else if(lambda<580.0){
        col=vec3((lambda-510.0)/70.0, 1.0, 0.0);
    } else if(lambda<645.0){
        col=vec3(1.0, -(lambda-645.0)/65.0, 0.0);
    } else if(lambda<=780.0){
        col=vec3(1.0, 0.0, 0.0);
    }
    // Factor de intensidad en los extremos
    float factor;
    if(lambda<420.0) factor=0.3+0.7*(lambda-380.0)/40.0;
    else if(lambda>700.0) factor=0.3+0.7*(780.0-lambda)/80.0;
    else factor=1.0;
    return clamp(col*factor, 0.0, 1.0);
}

// Color de interferencia:
// La fase determina la longitud de onda dominante
// La amplitud modula la saturación
// Las franjas de interferencia emergen de la suma
vec3 interferenceColor(float d, float phase, vec3 pos){
    // Longitud de onda base desde la fase [380nm, 780nm]
    float lambda_base = 380.0 + phase * 400.0;

    // Franjas de interferencia — suma de dos "ondas"
    // La diferencia de camino óptico crea las franjas
    float path1 = dot(pos, vec3(1.0, 0.7, 0.5)) * 8.0;
    float path2 = dot(pos, vec3(-0.5, 1.0, 0.8)) * 8.0;
    float optical_path = (path1 - path2) * 0.5 + 0.5; // [0,1]

    // Modulación de longitud de onda por diferencia de camino
    float lambda = lambda_base + optical_path * 80.0;
    lambda = mod(lambda - 380.0, 400.0) + 380.0; // mantener en rango

    vec3 spectral = wavelengthToRGB(lambda);

    // Franjas oscuras donde hay interferencia destructiva
    float fringe = 0.5 + 0.5*sin(optical_path*6.28*4.0 + uTime*0.5);
    spectral *= fringe;

    // La amplitud añade blanco (luz incoherente)
    float coherence = exp(-d*3.0); // alta amplitud = menos coherente
    spectral = mix(spectral, vec3(1.0), coherence*0.3);

    return spectral * (0.5 + 0.5*d);
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
        if(d<uThresh) continue;

        float ph=samplePhase(pos);
        vec3 col=interferenceColor(d, ph, pos);

        float alpha=smoothstep(uThresh,uThresh*4.0,d)*0.065;
        acc.rgb+=col*alpha*(1.0-acc.a);
        acc.a  +=alpha*(1.0-acc.a);
        if(acc.a>0.95) break;
    }

    gl_FragColor=acc;
}
