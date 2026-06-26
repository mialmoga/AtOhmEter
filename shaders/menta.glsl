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
uniform sampler3D uVolume;   // grad|φ|*0.08 + |θ|*0.5 + |u|*2.0   (refresh del motor)
uniform sampler3D uPhase;    // φ*0.5 + 0.5  →  0=fase−1, 0.5=pared, 1=fase+1
uniform vec3      uTouchPos;    // toque en local [-1,1]³ (9 = sin toque)
uniform float     uTouchActive;
uniform float     uTouchTime;
uniform float     uRaySteps;    // nº de pasos (configurable desde UI)
uniform float     uStepDiv;     // divisor de paso (configurable desde UI)

// ── Muestreo ────────────────────────────────────────────────
float sampleVol(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uVolume, uvw).r;
}
float samplePhase(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.5;
    return texture(uPhase, uvw).r;
}

// ── Gradiente de fase por diferencias centradas ─────────────
// La normal de la pared de dominio = ∇φ normalizado. La usamos
// para sombrear las paredes como superficies reales.
vec3 phaseGradient(vec3 p, float h){
    float gx = samplePhase(p + vec3(h,0,0)) - samplePhase(p - vec3(h,0,0));
    float gy = samplePhase(p + vec3(0,h,0)) - samplePhase(p - vec3(0,h,0));
    float gz = samplePhase(p + vec3(0,0,h)) - samplePhase(p - vec3(0,0,h));
    return vec3(gx, gy, gz);
}

// ── AABB exit ────────────────────────────────────────────────
float boxExit(vec3 ro, vec3 rd, float hs){
    vec3 invD = 1.0/rd;
    vec3 t0=(-hs-ro)*invD, t1=(hs-ro)*invD;
    vec3 tm=max(t0,t1);
    return min(min(tm.x,tm.y),tm.z);
}

void main(){
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos - ro);

    float tMax = boxExit(ro, rd, 1.0);
    if(tMax < 0.0) discard;

    float tStart = 0.0;
    if(all(greaterThan(ro,vec3(-1.0)))&&all(lessThan(ro,vec3(1.0)))){
        tStart = 0.001;
    } else {
        vec3 invD=1.0/rd;
        vec3 t0=(-1.0-ro)*invD, t1=(1.0-ro)*invD;
        vec3 tmin_v=min(t0,t1);
        tStart=max(max(tmin_v.x,tmin_v.y),tmin_v.z);
        if(tStart<0.0) tStart=0.001;
    }

    // Pasos configurables desde la UI (uRaySteps), sin números mágicos.
    float STEPS = clamp(uRaySteps, 32.0, 192.0);
    float stepSize = 2.0 / clamp(uStepDiv, 16.0, 192.0);
    int   maxI = int(STEPS);

    vec4  acc   = vec4(0.0);
    vec3  light = normalize(vec3(0.4, 1.0, 0.5));
    float h     = stepSize; // paso para el gradiente de fase

    // Paletas — coherentes con el paper.json
    //   fase +1 (phase→1) : azul frío        colA
    //   fase −1 (phase→0) : ámbar             colB
    //   pared   (phase≈.5): verde eléctrico   colWall  (φ≈0, donde vive la energía)
    const vec3 colA    = vec3(0.15, 0.55, 1.00);
    const vec3 colB    = vec3(1.00, 0.45, 0.12);
    const vec3 colWall = vec3(0.25, 1.00, 0.65);

    for(int i = 0; i < 192; i++){
        if(i >= maxI) break;
        float t = tStart + (float(i)+0.5)*stepSize;
        if(t > tMax) break;
        vec3 pos = ro + rd*t;

        float d  = sampleVol(pos);          // densidad de energía del campo
        float ph = samplePhase(pos);        // 0..1 (fase)

        // ── Cercanía a la pared de dominio (φ≈0 ⇒ ph≈0.5) ──────
        // wall = 1 justo en la pared, cae a 0 hacia el bulk de cualquier fase.
        float wall = 1.0 - smoothstep(0.0, 0.22, abs(ph - 0.5));

        // ── Color base: interpola entre las dos fases ──────────
        vec3 col = mix(colB, colA, ph);
        // En la pared, vira a verde: ahí está la frontera energética.
        col = mix(col, colWall, wall * 0.85);

        // ── Sombreado de la pared como superficie ──────────────
        // Normal = ∇φ. Iluminación tipo Lambert + un realce especular suave.
        if(wall > 0.05){
            vec3 n = phaseGradient(pos, h);
            float nl = length(n);
            if(nl > 1e-5){
                n /= nl;
                float diff = 0.4 + 0.6*clamp(dot(n, light)*0.5+0.5, 0.0, 1.0);
                col *= diff;
                // realce en el filo de la pared
                col += colWall * pow(wall, 3.0) * 0.25;
            }
        }

        // ── Opacidad: la pared acumula, el bulk es casi transparente ──
        // El umbral uThresh controla cuánta densidad se necesita para verse.
        float aField = smoothstep(uThresh*0.3, uThresh*2.0, d) * 0.05;
        float aWall  = wall * 0.10;
        float alpha  = aField + aWall;

        // ── Atenuación por densidad hacia la luz (sombra volumétrica) ──
        float dL = sampleVol(pos + light*stepSize*2.0);
        col *= 0.6 + 0.4*exp(-dL*1.4);

        // ── Latido de la pared — ligado a la energía global, no a un k fijo ──
        // Pulsa más cuando uEnergy es alta (sistema activo / bombeando).
        float pulse = 0.5 + 0.5*sin(uTime*2.2 + ph*12.0);
        col += colWall * wall * (0.06 + 0.10*clamp(uEnergy,0.0,1.0)) * pulse;

        // ── Halo de toque interactivo ──────────────────────────
        if(uTouchActive > 0.5){
            float dT = length(pos - uTouchPos);
            float ring = exp(-dT*dT*6.0) * exp(-uTouchTime*2.0);
            col   += vec3(1.0, 0.9, 0.6) * ring * 1.5;
            alpha += ring * 0.15;
        }

        // ── Compositing front-to-back ──────────────────────────
        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);
        if(acc.a > 0.95) break;
    }

    // Viñeta en espacio de PANTALLA — usa la dirección de rayo, no el
    // local space, para que la zona oscura no rote con el cubo al orbitar.
    float edge = clamp(dot(rd, normalize(vLocalPos - uCameraLocal)), 0.0, 1.0);
    acc.rgb *= 0.85 + 0.15*edge;

    gl_FragColor = acc;
}
