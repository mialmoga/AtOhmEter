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
    vec3 uvw = p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uVolume,uvw).r;
}

float samplePhase(vec3 p){
    vec3 uvw = p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.5;
    return texture(uPhase,uvw).r;
}

// Paleta criogénica: negro → azul profundo → cyan → blanco cristalino
vec3 crioColor(float t, float phase) {
    // La fase añade destellos de color — cristales de hielo
    float crystal = abs(sin(phase * 12.0 + uTime * 0.3)) * 0.15;

    vec3 col;
    if (t < 0.25) {
        // Vacío oscuro → azul medianoche
        col = mix(vec3(0.0, 0.01, 0.06),
                  vec3(0.02, 0.08, 0.28),
                  t / 0.25);
    } else if (t < 0.55) {
        // Azul medianoche → azul eléctrico
        col = mix(vec3(0.02, 0.08, 0.28),
                  vec3(0.05, 0.45, 0.85),
                  (t-0.25)/0.3);
    } else if (t < 0.8) {
        // Azul eléctrico → cyan frío
        col = mix(vec3(0.05, 0.45, 0.85),
                  vec3(0.3, 0.92, 1.0),
                  (t-0.55)/0.25);
    } else {
        // Cyan → blanco cristalino
        col = mix(vec3(0.3, 0.92, 1.0),
                  vec3(0.92, 0.97, 1.0),
                  (t-0.8)/0.2);
    }

    // Destello de cristal — la estructura interna brilla
    col += vec3(0.2, 0.5, 1.0) * crystal * t;

    // Pulso muy lento y suave — el frío es casi inmóvil
    float pulse = 1.0 + 0.04*sin(uTime*0.4 + phase*6.0);
    return col * pulse;
}

// Fresnel — las superficies frías reflejan en los bordes
float fresnel(vec3 rd, vec3 normal, float power) {
    return pow(1.0 - abs(dot(rd, normal)), power);
}

float boxExit(vec3 ro, vec3 rd, float hs){
    vec3 invD=1.0/rd;
    vec3 t0=(-hs-ro)*invD, t1=(hs-ro)*invD;
    vec3 tm=max(t0,t1);
    return min(min(tm.x,tm.y),tm.z);
}

void main(){
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos-ro);
    float tMax = boxExit(ro,rd,1.0);
    if(tMax<0.0) discard;

    float tStart=0.001;
    if(!all(greaterThan(ro,vec3(-1.0)))||!all(lessThan(ro,vec3(1.0)))){
        vec3 invD=1.0/rd;
        vec3 t0=(-1.0-ro)*invD, t1=(1.0-ro)*invD;
        vec3 tm=min(t0,t1);
        tStart=max(max(tm.x,tm.y),tm.z);
        if(tStart<0.0) tStart=0.001;
    }

    float stepSize=2.0/64.0;
    int steps=int(min((tMax-tStart)/stepSize,128.0));
    vec4 acc=vec4(0.0);
    vec3 prev_pos = ro;

    for(int i=0;i<128;i++){
        if(i>=steps) break;
        float t=tStart+(float(i)+0.5)*stepSize;
        vec3 pos=ro+rd*t;
        float d=sampleVol(pos);
        if(d<uThresh) { prev_pos=pos; continue; }

        float ph=samplePhase(pos);
        float intensity=smoothstep(uThresh,uThresh*5.0,d);

        // Normal aproximada desde gradiente del volumen
        float dx=sampleVol(pos+vec3(0.05,0,0))-sampleVol(pos-vec3(0.05,0,0));
        float dy=sampleVol(pos+vec3(0,0.05,0))-sampleVol(pos-vec3(0,0.05,0));
        float dz=sampleVol(pos+vec3(0,0,0.05))-sampleVol(pos-vec3(0,0,0.05));
        vec3 normal=normalize(vec3(dx,dy,dz)+0.001);

        float fr=fresnel(rd,normal,3.0);
        vec3 col=crioColor(intensity,ph);
        // El efecto fresnel añade un borde luminoso cyan en las aristas
        col+=vec3(0.4,0.9,1.0)*fr*0.5*intensity;

        float alpha=intensity*0.065;
        acc.rgb+=col*alpha*(1.0-acc.a);
        acc.a  +=alpha*(1.0-acc.a);
        if(acc.a>0.95) break;
    }

    gl_FragColor=acc;
}
