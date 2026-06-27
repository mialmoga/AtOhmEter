// ═══════════════════════════════════════════════════════════
//  AtOhmEter — V56 shader (extraído de V5.6-3)
//  Campo ψ ∈ ℂ³ (plasma por fase) + mano volumétrica de plasma
//
//  Este motor CONSUME la mano: si el shell tiene HandEngine activo,
//  escribe uHandBones[21]/uHandActive y la mano se renderiza como
//  un volumen de plasma fundido con el campo (no la tapa, se suma).
// ═══════════════════════════════════════════════════════════

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

// ── Mano volumétrica ─────────────────────────────────
uniform vec3  uHandBones[21];   // landmarks en espacio local [-1,1]
uniform bool  uHandActive;      // si false, skip todo el cálculo

// Segmentos de hueso: pares (A, B) de índices en uHandBones
// 20 huesos de la mano según topología MediaPipe
// Palma: 0-1,0-5,0-17,5-9,9-13,13-17
// Pulgar: 1-2,2-3,3-4
// Índice: 5-6,6-7,7-8
// Medio: 9-10,10-11,11-12
// Anular: 13-14,14-15,15-16
// Meñique: 17-18,18-19,19-20

// Distancia de punto p al segmento AB
float sdCapsule(vec3 p, vec3 A, vec3 B, float r) {
    vec3 ab = B - A;
    float t = clamp(dot(p - A, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - (A + t * ab)) - r;
}

// Metaball suave basada en SDF de cápsula
// Retorna densidad [0,1]: máximo en el centro del hueso, cae gaussianamente
float boneDensity(vec3 p, vec3 A, vec3 B, float radius) {
    vec3 ab = B - A;
    float t = clamp(dot(p - A, ab) / dot(ab, ab), 0.0, 1.0);
    float d = length(p - (A + t * ab));
    // Gaussiana: e^(-d²/r²) — suave, sin artefactos de hard threshold
    float nd = d / radius;
    return exp(-nd * nd * 3.5);
}

// Densidad total de la mano = suma de metaballs de todos los huesos
// Satura en 1.0 para evitar overflow en el compositing
float handField(vec3 p) {
    if (!uHandActive) return 0.0;

    // Radio base de los huesos en espacio local (escala del cubo [-1,1])
    // Los huesos de la palma son más gruesos que las falanges distales
    float r = 0.055;

    float d = 0.0;

    // Palma
    d += boneDensity(p, uHandBones[0],  uHandBones[1],  r * 1.2);
    d += boneDensity(p, uHandBones[0],  uHandBones[5],  r * 1.2);
    d += boneDensity(p, uHandBones[0],  uHandBones[17], r * 1.2);
    d += boneDensity(p, uHandBones[5],  uHandBones[9],  r * 1.1);
    d += boneDensity(p, uHandBones[9],  uHandBones[13], r * 1.1);
    d += boneDensity(p, uHandBones[13], uHandBones[17], r * 1.1);

    // Pulgar
    d += boneDensity(p, uHandBones[1], uHandBones[2], r * 1.0);
    d += boneDensity(p, uHandBones[2], uHandBones[3], r * 0.9);
    d += boneDensity(p, uHandBones[3], uHandBones[4], r * 0.75);

    // Índice
    d += boneDensity(p, uHandBones[5], uHandBones[6], r * 0.95);
    d += boneDensity(p, uHandBones[6], uHandBones[7], r * 0.85);
    d += boneDensity(p, uHandBones[7], uHandBones[8], r * 0.70);

    // Medio
    d += boneDensity(p, uHandBones[9],  uHandBones[10], r * 0.95);
    d += boneDensity(p, uHandBones[10], uHandBones[11], r * 0.85);
    d += boneDensity(p, uHandBones[11], uHandBones[12], r * 0.70);

    // Anular
    d += boneDensity(p, uHandBones[13], uHandBones[14], r * 0.90);
    d += boneDensity(p, uHandBones[14], uHandBones[15], r * 0.80);
    d += boneDensity(p, uHandBones[15], uHandBones[16], r * 0.65);

    // Meñique
    d += boneDensity(p, uHandBones[17], uHandBones[18], r * 0.85);
    d += boneDensity(p, uHandBones[18], uHandBones[19], r * 0.75);
    d += boneDensity(p, uHandBones[19], uHandBones[20], r * 0.60);

    return clamp(d, 0.0, 1.0);
}

// Paleta plasma de la mano — núcleo blanco/cian, corona magenta, halo azul
vec3 handPlasmaColor(float d, float t) {
    // d: densidad [0,1], t: tiempo para shimmer
    float shimmer = 0.5 + 0.5 * sin(t * 3.1 + d * 18.0);
    vec3 core  = vec3(0.85, 1.0,  1.0 );  // cian blanco — núcleo
    vec3 mid   = vec3(0.9,  0.15, 0.95);  // magenta     — corona
    vec3 outer = vec3(0.05, 0.2,  0.8 );  // azul índigo — halo externo
    vec3 col;
    if (d > 0.6) col = mix(mid,   core,  (d - 0.6) / 0.4);
    else         col = mix(outer, mid,   d / 0.6);
    // Shimmer sutil en la corona
    col += vec3(0.0, 0.3, 0.4) * shimmer * smoothstep(0.3, 0.7, d) * 0.25;
    return col;
}

// ── Campo ψ ──────────────────────────────────────────
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
vec3 volGrad(vec3 p){
    float e = 0.06;
    return vec3(
        sampleVol(p+vec3(e,0,0)) - sampleVol(p-vec3(e,0,0)),
        sampleVol(p+vec3(0,e,0)) - sampleVol(p-vec3(0,e,0)),
        sampleVol(p+vec3(0,0,e)) - sampleVol(p-vec3(0,0,e))
    ) / (2.0*e);
}
vec3 phaseColor(float ph, float density){
    vec3 c0 = vec3(1.0,  0.35, 0.1);
    vec3 c1 = vec3(0.1,  0.7,  1.0);
    vec3 c2 = vec3(0.8,  0.2,  1.0);
    vec3 col;
    if(ph < 0.5) col = mix(c0, c1, ph*2.0);
    else         col = mix(c1, c2, (ph-0.5)*2.0);
    col += vec3(1.2, 1.0, 0.6) * smoothstep(0.75, 1.0, density) * 0.5;
    return col;
}

void main(){
    vec3 rayDir = normalize(vLocalPos - uCameraLocal);
    vec3 rayPos = vLocalPos + rayDir * 0.002;

    int   STEPS    = 96;
    float stepSize = 3.46 / float(STEPS);

    vec4 col     = vec4(0.0);
    vec4 handCol = vec4(0.0);  // acumular mano por separado para compositing

    for(int i=0; i<96; i++){
        if(col.a > 0.95) break;
        vec3 p = rayPos + rayDir * float(i) * stepSize;
        if(any(greaterThan(abs(p), vec3(1.0)))) break;

        // ── Campo ψ ──────────────────────────────────
        float density = sampleVol(p);
        float vacuum  = density * 0.12 + density*density * 0.2;
        col.rgb += vec3(0.1, 0.2, 0.5) * vacuum * (1.0-col.a);
        col.a   += vacuum * 0.6 * (1.0-col.a);

        if(density > uThresh){
            float phase  = samplePhase(p);
            vec3  grad   = volGrad(p);
            float gMag   = length(grad);
            vec3  normal = gMag > 0.001 ? -normalize(grad) : vec3(0,1,0);
            float diff   = max(0.0, dot(normal, normalize(vec3(0.5,1.0,0.8)))) * 0.6 + 0.4;
            vec3  baseCol = phaseColor(phase, density);
            float excess  = (density - uThresh) / (1.0 - uThresh + 0.001);
            float alpha   = smoothstep(0.0, 0.4, excess) * 0.4;
            col.rgb += baseCol * diff * alpha * (1.0-col.a);
            col.a   += alpha * (1.0-col.a);
        }
        if(density > uThresh * 1.6){
            float core  = smoothstep(uThresh*1.6, 1.0, density);
            float phase = samplePhase(p);
            col.rgb += phaseColor(phase, 1.0) * core * 0.15 * (1.0-col.a);
            col.a   += core * 0.1 * (1.0-col.a);
        }

        // ── Mano volumétrica (aditiva sobre el campo) ─
        if(uHandActive) {
            float hd = handField(p);
            if(hd > 0.015) {
                vec3  hcol  = handPlasmaColor(hd, uTime);
                // Contribución aditiva: más brillante donde la mano
                // coincide con vórtices del campo (intersección energética)
                float boost = 1.0 + density * 2.5;
                float halpha = hd * 0.55 * stepSize * 18.0;
                handCol.rgb += hcol * boost * halpha * (1.0 - handCol.a);
                handCol.a   += halpha * (1.0 - handCol.a);
            }
        }
    }

    // Compositar mano sobre campo — modo aditivo suave
    // La mano no tapa el campo, se funde con él
    col.rgb += handCol.rgb * (1.0 - col.a * 0.4);
    col.a    = clamp(col.a + handCol.a * 0.7, 0.0, 1.0);

    if(col.a < 0.002) discard;
    gl_FragColor = col;
}
