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

// Caustics — patrones de luz refractada en el fondo
float caustics(vec3 pos, float t){
    vec3 p = pos * 4.0;
    float c = sin(p.x + t*1.1) * sin(p.z + t*0.9)
            + sin(p.x*1.3 - p.z*0.7 + t*1.3)
            + sin(p.x*0.7 + p.z*1.4 - t*0.8);
    return max(0.0, c * 0.33);
}

// Normal de superficie desde gradiente del volumen
vec3 waterNormal(vec3 pos, float d){
    float eps = 0.04;
    float dx = sampleVol(pos+vec3(eps,0,0)) - sampleVol(pos-vec3(eps,0,0));
    float dy = sampleVol(pos+vec3(0,eps,0)) - sampleVol(pos-vec3(0,eps,0));
    float dz = sampleVol(pos+vec3(0,0,eps)) - sampleVol(pos-vec3(0,0,eps));
    return normalize(vec3(dx,dy,dz) + 0.001);
}

// Paleta agua: profundidad azul oscuro → turquesa → espuma blanca
vec3 waterColor(float depth, float foam, float caustic_val, float phase){
    // Color base según profundidad
    vec3 deep    = vec3(0.01, 0.05, 0.18); // abismo azul
    vec3 mid     = vec3(0.02, 0.28, 0.52); // azul tropical
    vec3 shallow = vec3(0.08, 0.65, 0.72); // turquesa claro
    vec3 foam_c  = vec3(0.85, 0.95, 1.00); // espuma blanca

    vec3 col;
    if(depth < 0.4){
        col = mix(deep, mid, depth/0.4);
    } else if(depth < 0.75){
        col = mix(mid, shallow, (depth-0.4)/0.35);
    } else {
        col = mix(shallow, foam_c, (depth-0.75)/0.25);
    }

    // Caustics — luz refractada
    col += vec3(0.3,0.6,0.5) * caustic_val * depth * 0.4;

    // Espuma en las crestas
    col = mix(col, foam_c, foam*0.7);

    // Variación por fase — agua salada vs dulce vs termal
    if(phase < 0.33){
        col *= vec3(1.0, 1.0, 1.05); // azul frío
    } else if(phase < 0.66){
        col *= vec3(0.95, 1.05, 1.0); // verde tropical
    } else {
        col *= vec3(1.05, 0.98, 0.92); // cálido
    }

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
    float prev_d = 0.0;

    for(int i=0;i<128;i++){
        if(i>=steps) break;
        float t=tStart+(float(i)+0.5)*stepSize;
        vec3 pos=ro+rd*t;
        float d=sampleVol(pos);
        if(d<uThresh*0.5) { prev_d=d; continue; }

        float ph=samplePhase(pos);

        // Ondas en superficie — perturbación del normal
        float wave1=sin(pos.x*8.0+uTime*1.2)*0.03;
        float wave2=sin(pos.z*6.0-uTime*0.9+pos.x*3.0)*0.02;
        vec3 wave_pos=pos+vec3(wave1,0,wave2);

        float depth=smoothstep(uThresh*0.5,uThresh*4.0,d);

        // Espuma donde hay cambio rápido de densidad (superficie)
        float foam=abs(d-prev_d)*15.0;
        foam=clamp(foam,0.0,1.0);

        // Caustics
        float caust=caustics(pos, uTime);

        vec3 col=waterColor(depth, foam, caust, ph);

        // Reflexión especular — luz en la superficie
        vec3 normal=waterNormal(pos,d);
        vec3 lightDir=normalize(vec3(0.5,1.0,0.3));
        float spec=pow(max(0.0,dot(reflect(-lightDir,normal),-rd)),32.0);
        col+=vec3(1.0)*spec*0.6*depth;

        // Transparencia — el agua deja pasar luz
        float alpha=depth*0.06*(1.0+foam*2.0);
        acc.rgb+=col*alpha*(1.0-acc.a);
        acc.a  +=alpha*(1.0-acc.a);
        prev_d=d;
        if(acc.a>0.95) break;
    }

    gl_FragColor=acc;
}
