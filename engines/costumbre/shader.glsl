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
uniform sampler3D uVolume;   // brillo semántico
uniform sampler3D uPhase;    // índice de paleta [0,1]

float sampleVol(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw,vec3(0.0))) || any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uVolume, uvw).r;
}

float samplePhase(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw,vec3(0.0))) || any(greaterThan(uvw,vec3(1.0)))) return 0.5;
    return texture(uPhase, uvw).r;
}

// Paleta semántica de Velvet:
//   ph < 0.1  → negro  (ceguera por saturación)
//   ph ~ 0.2  → azul   (costumbre profunda)
//   ph ~ 0.5  → dorado (frontera activa)
//   ph ~ 0.72 → blanco (novedad pura)
//   ph > 0.8  → violeta (hueco — ψ < N, fantasma inverso)
vec3 semanticColor(float ph) {
    // Negro (ceguera)
    vec3 col_black  = vec3(0.02, 0.02, 0.04);
    // Azul profundo (costumbre)
    vec3 col_blue   = vec3(0.05, 0.15, 0.55);
    // Dorado (frontera activa)
    vec3 col_gold   = vec3(0.95, 0.72, 0.08);
    // Blanco frío (novedad)
    vec3 col_white  = vec3(0.92, 0.97, 1.00);
    // Violeta (hueco — fantasma inverso)
    vec3 col_ghost  = vec3(0.55, 0.10, 0.80);

    vec3 col;
    if (ph < 0.1) {
        // Ceguera — negro
        col = col_black;
    } else if (ph < 0.35) {
        // Costumbre — azul
        float t = (ph - 0.1) / 0.25;
        col = mix(col_black, col_blue, smoothstep(0.0, 1.0, t));
    } else if (ph < 0.62) {
        // Frontera — dorado
        float t = (ph - 0.35) / 0.27;
        col = mix(col_blue, col_gold, smoothstep(0.0, 1.0, t));
    } else if (ph < 0.78) {
        // Novedad — blanco
        float t = (ph - 0.62) / 0.16;
        col = mix(col_gold, col_white, smoothstep(0.0, 1.0, t));
    } else {
        // Hueco / fantasma — violeta
        float t = (ph - 0.78) / 0.22;
        col = mix(col_white, col_ghost, smoothstep(0.0, 1.0, min(1.0, t)));
    }
    return col;
}

float boxExit(vec3 ro, vec3 rd, float halfSize){
    vec3 invD = 1.0 / rd;
    vec3 t0 = (-halfSize - ro) * invD;
    vec3 t1 = ( halfSize - ro) * invD;
    vec3 tmax = max(t0, t1);
    return min(min(tmax.x, tmax.y), tmax.z);
}

void main(){
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos - ro);

    float tMax = boxExit(ro, rd, 1.0);
    if(tMax < 0.0) discard;

    float tStart = 0.001;
    if(!all(greaterThan(ro, vec3(-1.0))) || !all(lessThan(ro, vec3(1.0)))) {
        vec3 invD = 1.0 / rd;
        vec3 t0 = (-1.0 - ro) * invD;
        vec3 t1 = ( 1.0 - ro) * invD;
        vec3 tmin = min(t0, t1);
        tStart = max(max(tmin.x, tmin.y), tmin.z);
        if(tStart < 0.0) tStart = 0.001;
    }

    float stepSize = 2.0 / 64.0;
    int steps = int(min((tMax - tStart) / stepSize, 128.0));

    vec4 acc = vec4(0.0);

    for(int i = 0; i < 128; i++){
        if(i >= steps) break;
        float t = tStart + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * t;

        float d = sampleVol(pos);
        if(d < uThresh) continue;

        float ph = samplePhase(pos);
        vec3 col = semanticColor(ph);

        // Las fronteras (dorado) pulsan levemente
        float is_border = smoothstep(0.35, 0.62, ph) * (1.0 - smoothstep(0.62, 0.78, ph));
        col += vec3(0.3, 0.15, 0.0) * is_border * 0.3 * (0.5 + 0.5*sin(uTime*3.0));

        // Los huecos (violeta) tienen un pulso más lento y triste
        float is_ghost = smoothstep(0.78, 1.0, ph);
        col += vec3(0.2, 0.0, 0.3) * is_ghost * 0.4 * (0.5 + 0.5*sin(uTime*0.8));

        float alpha = smoothstep(uThresh, uThresh * 3.0, d) * 0.07;

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);
        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
