// ══════════════════════════════════════════════════════════════
//  shader.glsl — CHLADNI 3D
//
//  Render semántico:
//    BRILLO (densidad) = GRANOS — la arena acumulada. Las figuras
//                        de Chladni: brilla donde la arena se apiló
//                        (los nodos, las superficies quietas).
//    COLOR  (fase)     = VIBRACIÓN — el shader la mapea:
//                          vib baja (nodo, quieto)    → frío/azul
//                          vib alta (antinodo, vibra) → cálido/rojo
//
//  La arena dibuja la forma; el color cuenta dónde el medio vibra.
//  Una figura de Chladni nítida se ve como filamentos brillantes
//  (arena en los nodos) sobre un fondo de color frío.
// ══════════════════════════════════════════════════════════════

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
uniform float     uBoxSize;
uniform float     uTime;
uniform float     uThresh;
uniform float     uEnergy;
uniform sampler3D uVolume;   // granos (la arena)
uniform sampler3D uPhase;    // vibración local [0,1]

float sampleVol(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
    return texture(uVolume, uvw).r;
}

float samplePhase(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
    return texture(uPhase, uvw).r;
}

float boxExit(vec3 ro, vec3 rd, float halfSize){
    vec3 invD = 1.0 / rd;
    vec3 t0 = (-halfSize - ro) * invD;
    vec3 t1 = ( halfSize - ro) * invD;
    vec3 tmax = max(t0, t1);
    return min(min(tmax.x, tmax.y), tmax.z);
}

// ── Paleta de CHLADNI ─────────────────────────────────────────
// vib ∈ [0,1]:
//   vib ≈ 0   (nodo, la arena vive aquí)   → blanco cálido brillante
//   vib medio (transición)                 → ámbar
//   vib alto  (antinodo, la arena huyó)    → azul frío tenue
// La arena (densidad) determina el brillo; la vibración, el matiz.
vec3 chladniColor(float grain, float vib){
    // Color por vibración: nodo cálido → antinodo frío
    vec3 nodeCol     = vec3(1.0, 0.92, 0.72);  // arena en reposo — blanco cálido
    vec3 midCol      = vec3(0.95, 0.6, 0.25);  // ámbar de transición
    vec3 antinodeCol = vec3(0.3, 0.55, 1.0);   // antinodo — azul frío

    vec3 col;
    if(vib < 0.5){
        col = mix(nodeCol, midCol, vib * 2.0);
    } else {
        col = mix(midCol, antinodeCol, (vib - 0.5) * 2.0);
    }

    // El brillo lo lleva la arena. Los nodos poblados destacan.
    return col;
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

    float stepSize = 2.0 / 110.0;
    int steps = int(min((tMax - tStart) / stepSize, 140.0));

    vec4 acc = vec4(0.0);

    for(int i = 0; i < 140; i++){
        if(i >= steps) break;

        float t = tStart + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * t;

        float grain = sampleVol(pos);
        if(grain < uThresh) continue;   // sin arena, nada que mostrar

        float vib = samplePhase(pos);
        vec3 col = chladniColor(grain, vib);

        // La densidad de arena controla la opacidad: los nodos donde se
        // apiló mucha arena son más opacos y forman la figura sólida.
        float alpha = smoothstep(uThresh, uThresh * 4.0, grain) * 0.09;

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);

        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
