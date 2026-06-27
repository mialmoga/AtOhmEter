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

// ── Paleta de CHLADNI — color por FUENTE ─────────────────────
// La fase codifica fuente dominante + vibración en 3 bandas:
//   banda 0 (0.00–0.33) → fuente 1 → rojo cálido
//   banda 1 (0.33–0.66) → fuente 2 → verde
//   banda 2 (0.66–1.00) → fuente 3 → azul
// Dentro de cada banda, la posición codifica la vibración local
// (nodo → tenue/oscuro, antinodo → brillante/saturado).
// Así cada fuente tiñe su región y las interferencias se distinguen:
// donde dos fuentes compiten, sus colores se encuentran en el espacio.
vec3 chladniColor(float grain, float phase){
    // Decodificar banda (fuente) y posición dentro de banda (vibración)
    float scaled = phase * 3.0;
    float band   = floor(scaled);          // 0, 1 o 2 → fuente
    float vibN   = fract(scaled);           // [0,1) → vibración

    // Color base por fuente
    vec3 col1 = vec3(1.0, 0.4, 0.25);   // fuente 1 — rojo cálido
    vec3 col2 = vec3(0.4, 1.0, 0.45);   // fuente 2 — verde
    vec3 col3 = vec3(0.35, 0.6, 1.0);   // fuente 3 — azul

    vec3 srcCol = col1;
    if (band > 1.5)      srcCol = col3;
    else if (band > 0.5) srcCol = col2;

    // La vibración modula: nodo (vibN bajo) = el color puro y limpio donde
    // la arena reposa; antinodo (vibN alto) = más claro, lavado hacia blanco
    // (zona agitada). Así dentro de cada color se lee nodo vs antinodo.
    vec3 col = mix(srcCol, vec3(1.0, 0.95, 0.85), vibN * 0.6);

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

        float phaseEnc = samplePhase(pos); // fuente dominante + vibración codificadas
        vec3 col = chladniColor(grain, phaseEnc);

        // La densidad de arena controla la opacidad: los nodos donde se
        // apiló mucha arena son más opacos y forman la figura sólida.
        float alpha = smoothstep(uThresh, uThresh * 4.0, grain) * 0.09;

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);

        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
