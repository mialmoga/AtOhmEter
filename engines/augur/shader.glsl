// ══════════════════════════════════════════════════════════════
//  shader.glsl — AUGUR
//
//  Render semántico:
//    BRILLO (densidad)  = SORPRESA — brilla donde el mundo desafió
//                         lo que la celda esperaba.
//    COLOR  (fase)      = CONFIANZA — la fase codifica conf·0.66:
//                           cálido (rojo/ámbar) = plástico, vivo, aprende
//                           frío   (cian/azul)  = cristalizado, rígido, ciego
//
//  La paleta cuenta la historia del campo: las zonas que brillan
//  intenso y cálido son el borde fértil (sorpresa alta, aún plástico);
//  las zonas frías y apagadas son certeza muerta.
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
uniform sampler3D uVolume;   // sorpresa
uniform sampler3D uPhase;    // confianza·0.66

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

// ── Paleta de AUGUR ───────────────────────────────────────────
// conf ∈ [0,1] (la fase llega como conf·0.66, la des-escalamos).
//   conf baja  → ámbar/rojo cálido (plástico, vivo, el borde fértil)
//   conf media → blanco-verdoso     (criticalidad)
//   conf alta  → cian/azul frío      (cristalizado, certeza ciega)
// surprise modula el brillo.
vec3 augurColor(float surprise, float phase){
    float conf = phase / 0.66; // des-escalar a [0,1]

    // Gradiente cálido → frío según confianza
    vec3 plastic = vec3(1.0, 0.45, 0.15);  // ámbar cálido — aprende
    vec3 critic  = vec3(0.6, 1.0, 0.7);    // verde-blanco — el borde
    vec3 rigid   = vec3(0.25, 0.6, 1.0);   // azul frío — cristalizado

    vec3 col;
    if(conf < 0.5){
        col = mix(plastic, critic, conf * 2.0);
    } else {
        col = mix(critic, rigid, (conf - 0.5) * 2.0);
    }

    // La sorpresa intensifica: el borde fértil arde
    float glow = smoothstep(uThresh, uThresh * 4.0, surprise);
    return col * (0.3 + 0.7 * glow);
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

    float stepSize = 2.0 / 96.0;
    int steps = int(min((tMax - tStart) / stepSize, 128.0));

    vec4 acc = vec4(0.0);

    for(int i = 0; i < 128; i++){
        if(i >= steps) break;

        float t = tStart + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * t;

        float surprise = sampleVol(pos);
        if(surprise < uThresh) continue;

        float phase = samplePhase(pos);
        vec3 col = augurColor(surprise, phase);

        // Alpha proporcional a la sorpresa — el borde fértil es más denso visualmente
        float alpha = smoothstep(uThresh, uThresh * 3.0, surprise) * 0.07;

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);

        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
