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
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw,vec3(0.0))) || any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uVolume, uvw).r;
}

float samplePhase(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw,vec3(0.0))) || any(greaterThan(uvw,vec3(1.0)))) return 0.5;
    return texture(uPhase, uvw).r;
}

// Rayleigh-like phase function
float phase(float cosTheta){
    return 0.75 * (1.0 + cosTheta * cosTheta);
}

// AABB box exit for FrontSide rendering
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

    float tStart = 0.0;
    // If camera is inside the box, start from camera
    if(all(greaterThan(ro, vec3(-1.0))) && all(lessThan(ro, vec3(1.0)))) {
        tStart = 0.001;
    } else {
        // Find entry point
        vec3 invD = 1.0 / rd;
        vec3 t0 = (-1.0 - ro) * invD;
        vec3 t1 = ( 1.0 - ro) * invD;
        vec3 tmin = min(t0, t1);
        tStart = max(max(tmin.x, tmin.y), tmin.z);
        if(tStart < 0.0) tStart = 0.001;
    }

    float stepSize = 2.0 / 48.0;
    int steps = int(min((tMax - tStart) / stepSize, 96.0));

    vec4 acc = vec4(0.0);
    vec3 light = normalize(vec3(0.5, 1.0, 0.3));

    for(int i = 0; i < 96; i++){
        if(i >= steps) break;
        float t = tStart + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * t;

        float d = sampleVol(pos);
        if(d < uThresh) continue;

        float ph = samplePhase(pos);  // 0..1, where 0.5 = frontera

        // Color bifásico: fase A (azul/cyan) vs fase B (rojo/ámbar)
        // Frontera (φ≈0 → ph≈0.5) = blanco/verde brillante
        vec3 colA = vec3(0.2, 0.6, 1.0);  // Fase +1 — azul frío
        vec3 colB = vec3(1.0, 0.35, 0.15); // Fase -1 — ámbar caliente
        vec3 colBorder = vec3(0.3, 1.0, 0.6); // Frontera — verde eléctrico

        float border = 1.0 - 2.0 * abs(ph - 0.5); // 1 en frontera, 0 lejos
        border = smoothstep(0.0, 0.5, border);

        vec3 col = mix(colB, colA, ph);
        col = mix(col, colBorder, border * 0.7);

        // Intensidad proporcional a densidad
        float alpha = smoothstep(uThresh, uThresh * 3.0, d) * 0.06;

        // Iluminación volumétrica
        float dL = sampleVol(pos + light * stepSize * 2.0);
        float shadow = exp(-dL * 2.0);
        col *= 0.5 + 0.5 * shadow;

        // Pulso sutil en fronteras
        col += colBorder * border * 0.15 * (0.5 + 0.5 * sin(uTime * 2.0 + d * 10.0));

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);
        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
