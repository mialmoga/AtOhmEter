// ══════════════════════════════════════════════════════════════
//  shader.glsl — BURBUJA
//
//  El alma del motor: render de membranas jabonosas con iridiscencia
//  por espesor (interferencia de película delgada), halo volumétrico
//  suave, humo translúcido, y soporte de modo UV (fluorescente).
//
//  Datos del motor:
//    uVolume (densidad): membrana + humo
//    uPhase:
//      0.01..0.85 → ESPESOR de membrana → iridiscencia (arcoíris de jabón)
//      0.95       → HUMO (gris/vapor)
//
//  El modo UV se detecta por uThresh muy bajo + se realza en el shader vía
//  saturación; pero como el contrato no pasa el modo, usamos un truco: el
//  motor en UV escribe el espesor con un sesgo que el shader lee como
//  fluorescencia. Aquí simplemente hacemos la iridiscencia vibrante y, si
//  el entorno es oscuro (bloom del shell), ya luce fluorescente.
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
uniform sampler3D uVolume;
uniform sampler3D uPhase;

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

// ── Iridiscencia de película delgada ──────────────────────────
// El color de interferencia depende del espesor óptico. Aproximamos el
// espectro visible con cosenos desfasados según el grosor (thickness).
vec3 thinFilm(float thickness){
    // thickness ~ [0,1] mapeado a varias longitudes de onda de interferencia
    float t = thickness * 12.0; // varias franjas de color
    vec3 col = 0.5 + 0.5 * cos(vec3(t, t - 2.094, t - 4.189) + uTime * 0.2);
    return col;
}

// gradiente del volumen (normal aproximada de la membrana) para reflejo
vec3 gradVol(vec3 p, float e){
    return normalize(vec3(
        sampleVol(p + vec3(e,0,0)) - sampleVol(p - vec3(e,0,0)),
        sampleVol(p + vec3(0,e,0)) - sampleVol(p - vec3(0,e,0)),
        sampleVol(p + vec3(0,0,e)) - sampleVol(p - vec3(0,0,e))
    ) + 1e-5);
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

    float stepSize = 2.0 / 120.0;
    int steps = int(min((tMax - tStart) / stepSize, 128.0));

    vec4 acc = vec4(0.0);

    for(int i = 0; i < 128; i++){
        if(i >= steps) break;

        float t = tStart + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * t;

        float d = sampleVol(pos);
        if(d < uThresh) continue;

        float ph = samplePhase(pos);

        vec3 col;
        float alpha;

        if(ph > 0.9){
            // ── HUMO / vapor — gris translúcido, suave ──
            col = vec3(0.55, 0.58, 0.62);
            alpha = d * 0.04;
        } else {
            // ── MEMBRANA jabonosa — iridiscencia por espesor ──
            float thickness = ph; // 0.01..0.85 = espesor
            col = thinFilm(thickness);

            // realce de borde (Fresnel): la membrana brilla más en los cantos
            vec3 nrm = gradVol(pos, stepSize);
            float fres = pow(1.0 - abs(dot(nrm, rd)), 2.5);
            col += vec3(fres) * 0.6;

            // las membranas finas (espesor bajo) son más brillantes/jabonosas
            float shine = smoothstep(0.0, 0.4, thickness);
            col *= (0.6 + 0.8 * shine);

            alpha = smoothstep(uThresh, uThresh*2.5, d) * 0.09;
            alpha += fres * 0.04; // los bordes son más opacos
        }

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);

        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
