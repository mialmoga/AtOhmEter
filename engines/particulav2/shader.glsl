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
uniform sampler3D uVolume;   // |ψ|·(1-S) — amplitud ordenada
uniform sampler3D uPhase;    // ángulo de ψ en [0,1]

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

// Rueda de colores — ángulo de fase a color
vec3 phaseColor(float angle) {
    // angle en [0,1] → 0..2π
    float a = angle * 6.28318;
    // Paleta: ciclo suave por espacio HSV
    float r = 0.5 + 0.5 * cos(a);
    float g = 0.5 + 0.5 * cos(a - 2.094); // 2π/3
    float b = 0.5 + 0.5 * cos(a - 4.189); // 4π/3
    return vec3(r, g, b);
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

        // Color desde fase — rueda completa de colores
        vec3 col = phaseColor(ph);

        // Las zonas de bajo S (alto orden) brillan con un halo blanco
        // renderVolume ya está modulado por (1-S), así que zonas ordenadas = más brillo
        float order_glow = smoothstep(uThresh * 2.0, uThresh * 5.0, d);
        col = mix(col, vec3(1.0), order_glow * 0.4);

        // Pulso temporal sutil — el campo "respira"
        float pulse = 0.5 + 0.5 * sin(uTime * 1.5 + d * 20.0);
        col += phaseColor(ph + 0.1) * 0.1 * pulse;

        float alpha = smoothstep(uThresh, uThresh * 2.5, d) * 0.08;

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);
        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
