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
// ══════════════════════════════════════════════════════════════
//  HBN — Polaritones Fonón-Fotón
//
//  phaseData codificación:
//    0.0  → fonónico puro    (vibración de la red — naranja cálido)
//    0.5  → polaritón híbrido (mitad luz mitad fonón — blanco/cyan)
//    1.0  → fotónico puro    (onda EM libre — violeta frío)
//
//  renderVolume: amplitud total |E| + |Q| normalizada
//
//  Los frentes hiperbólicos se manifiestan como conos/cruces
//  en lugar de esferas — la firma visual del hBN.
// ══════════════════════════════════════════════════════════════

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
uniform vec3      uTouchPos;
uniform float     uTouchActive;
uniform float     uTouchTime;

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

// ── Paleta fonón / polaritón / fotón ──────────────────────────
// Inspirada en las imágenes de nano-FTIR de polaritones en hBN:
// fondos oscuros, frentes brillantes, colores de falso color
vec3 polaritonColor(float ph, float amp) {
    vec3 col;
    if(ph < 0.2) {
        // Fonónico — naranja cálido (vibración térmica de la red)
        col = mix(vec3(0.15, 0.02, 0.0), vec3(1.0, 0.45, 0.05), ph/0.2);
    } else if(ph < 0.45) {
        // Transición fonón→polaritón — rojo/magenta
        col = mix(vec3(1.0, 0.45, 0.05), vec3(0.9, 0.1, 0.6), (ph-0.2)/0.25);
    } else if(ph < 0.55) {
        // Polaritón híbrido — blanco nacarado (el estado más especial)
        // En el experimento real aparece como un punto de máxima intensidad
        float t = (ph - 0.45) / 0.1;
        col = mix(vec3(0.9, 0.1, 0.6), vec3(1.0, 0.98, 0.95), t);
        // Sobrebrillo en el híbrido exacto
        col += vec3(0.3, 0.4, 0.5) * (1.0 - abs(ph - 0.5) * 20.0) * amp;
    } else if(ph < 0.8) {
        // Transición polaritón→fotónico — cyan/azul
        col = mix(vec3(1.0, 0.98, 0.95), vec3(0.05, 0.7, 1.0), (ph-0.55)/0.25);
    } else {
        // Fotónico puro — violeta/ultravioleta
        col = mix(vec3(0.05, 0.7, 1.0), vec3(0.4, 0.1, 0.9), (ph-0.8)/0.2);
    }
    return col;
}

// ── Gradiente para detectar frentes de onda ───────────────────
// Los frentes son las zonas de mayor variación espacial
float waveFront(vec3 pos) {
    float eps = 0.07;
    float dx = sampleVol(pos+vec3(eps,0,0)) - sampleVol(pos-vec3(eps,0,0));
    float dy = sampleVol(pos+vec3(0,eps,0)) - sampleVol(pos-vec3(0,eps,0));
    float dz = sampleVol(pos+vec3(0,0,eps)) - sampleVol(pos-vec3(0,0,eps));
    return length(vec3(dx, dy, dz));
}

// ── Iridiscencia de los frentes hiperbólicos ─────────────────
// Los polaritones reales producen patrones de interferencia
// muy coloridos cuando se observan con s-SNOM
vec3 hyperbolicIri(vec3 pos, float ph, float front) {
    // La fase espacial varía rápidamente en los frentes
    float spatialPhase = pos.x * 8.0 + pos.z * 8.0 + uTime * 0.3;
    // En Y la fase se invierte (eje hiperbólico)
    spatialPhase -= pos.y * 8.0 * 1.5; // amplificado por anisotropía

    float iri_r = 0.5 + 0.5*sin(spatialPhase);
    float iri_g = 0.5 + 0.5*sin(spatialPhase + 2.094);
    float iri_b = 0.5 + 0.5*sin(spatialPhase + 4.189);

    return vec3(iri_r, iri_g, iri_b) * front * 0.5;
}

float boxExit(vec3 ro, vec3 rd, float hs){
    vec3 invD = 1.0/rd;
    vec3 t0 = (-hs-ro)*invD, t1 = (hs-ro)*invD;
    vec3 tm = max(t0,t1);
    return min(min(tm.x,tm.y),tm.z);
}

void main(){
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos - ro);
    float tMax = boxExit(ro, rd, 1.0);
    if(tMax < 0.0) discard;

    float tStart = 0.001;
    if(!all(greaterThan(ro,vec3(-1.0)))||!all(lessThan(ro,vec3(1.0)))){
        vec3 invD = 1.0/rd;
        vec3 t0 = (-1.0-ro)*invD, t1 = (1.0-ro)*invD;
        vec3 tm = min(t0,t1);
        tStart = max(max(tm.x,tm.y),tm.z);
        if(tStart < 0.0) tStart = 0.001;
    }

    float thresh = max(uThresh * 0.25, 0.008);
    float stepSize = 2.0 / 80.0;
    int steps = int(min((tMax - tStart) / stepSize, 128.0));
    vec4 acc = vec4(0.0);

    for(int i = 0; i < 128; i++){
        if(i >= steps) break;
        float tt = tStart + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * tt;

        float d   = sampleVol(pos);
        float ph  = samplePhase(pos);

        if(d < thresh) continue;

        float amp     = smoothstep(thresh, thresh * 6.0, d);
        float front   = waveFront(pos);

        // ── Color base: paleta fonón/polaritón/fotón ──────────
        vec3 col = polaritonColor(ph, amp);

        // ── Amplificar los frentes de onda ────────────────────
        // Los frentes hiperbólicos son la firma visual del hBN —
        // deben ser más brillantes que el interior
        float frontBoost = smoothstep(0.0, 0.3, front);
        col = mix(col * 0.3, col * 2.0, frontBoost);

        // ── Iridiscencia en los frentes ───────────────────────
        vec3 iri = hyperbolicIri(pos, ph, frontBoost);
        col += iri;

        // ── Polaritón híbrido — brillo especial ───────────────
        // Cuando ph ≈ 0.5 el sistema está en el estado más interesante
        float hybridness = 1.0 - abs(ph - 0.5) * 4.0;
        hybridness = max(0.0, hybridness);
        col += vec3(0.8, 0.95, 1.0) * hybridness * amp * 0.6;

        // ── Oscilación temporal visible ───────────────────────
        // Los polaritones oscilan — añadir un pulso de brillo
        float pulse = abs(sin(uTime * 1.8 + length(pos) * 6.0));
        col += col * pulse * amp * 0.2;

        // ── Alpha — los frentes son opacos, el interior tenue ─
        float alpha = mix(amp * 0.02, amp * 0.15, frontBoost);
        alpha *= (1.0 - acc.a);

        acc.rgb += col * alpha;
        acc.a   += alpha;

        if(acc.a > 0.92) break;
    }

    // ── Borde del cubo — reflexión del campo ──────────────────
    float edgeMask = max(max(abs(vLocalPos.x), abs(vLocalPos.y)), abs(vLocalPos.z));
    float edge = smoothstep(0.88, 1.0, edgeMask);
    if(edge > 0.0 && acc.a < 0.25) {
        float edgePh  = samplePhase(vLocalPos * 0.88);
        vec3  edgeCol = polaritonColor(edgePh, 0.3);
        // Arcoíris de interferencia en el borde
        float a = uTime * 0.12 + vLocalPos.x * 3.0 + vLocalPos.y * 2.0;
        edgeCol = mix(edgeCol, vec3(0.5+0.5*sin(a), 0.5+0.5*sin(a+2.1), 0.5+0.5*sin(a+4.2)), 0.4);
        acc.rgb += edgeCol * edge * 0.18 * (1.0 - acc.a);
        acc.a   += edge * 0.08 * (1.0 - acc.a);
    }

    gl_FragColor = clamp(acc, 0.0, 1.0);
}
