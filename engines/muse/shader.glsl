// ══════════════════════════════════════════════════════════════
//  shader.glsl — MUSE
//
//  Inspirado por ŚN1E de Rafał P. J. Borkowski (https://tempolux.life/sn1e)
//
//  Render semántico:
//    BRILLO (densidad):
//      modo A/C → intensidad del patrón lógico |V|
//      modo B   → densidad de polvo acumulado
//    COLOR (fase): el valor del campo lógico V mapeado a [0,1]
//      V negativo (0.0) → frío/violeta (bits apagados, "0")
//      V cero     (0.5) → neutro tenue
//      V positivo (1.0) → cálido/ámbar (bits encendidos, "1")
//
//  La paleta evoca un atlas de circuito: el patrón booleano dibujado
//  en luz, polaridad fría↔cálida según el signo del voltaje lógico.
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
uniform sampler3D uVolume;   // intensidad (patrón |V| o polvo)
uniform sampler3D uPhase;    // V*0.5+0.5 (valor lógico con signo)

float sampleVol(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
    return texture(uVolume, uvw).r;
}
float samplePhase(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.5;
    return texture(uPhase, uvw).r;
}

float boxExit(vec3 ro, vec3 rd, float halfSize){
    vec3 invD = 1.0 / rd;
    vec3 t0 = (-halfSize - ro) * invD;
    vec3 t1 = ( halfSize - ro) * invD;
    vec3 tmax = max(t0, t1);
    return min(min(tmax.x, tmax.y), tmax.z);
}

// ── Paleta de MUSE — polaridad lógica ─────────────────────────
// ph ∈ [0,1] es V*0.5+0.5:
//   ph→0   (V negativo, bits apagados) → violeta/azul frío
//   ph→0.5 (V cero, neutro)            → gris tenue
//   ph→1   (V positivo, bits encendidos) → ámbar/dorado cálido
vec3 museColor(float intensity, float ph){
    vec3 cold = vec3(0.45, 0.30, 1.00);  // "0" lógico — violeta frío
    vec3 neutral = vec3(0.25, 0.30, 0.40); // neutro
    vec3 warm = vec3(1.00, 0.70, 0.20);  // "1" lógico — ámbar cálido

    vec3 col;
    if(ph < 0.5){
        col = mix(cold, neutral, ph * 2.0);
    } else {
        col = mix(neutral, warm, (ph - 0.5) * 2.0);
    }
    // el patrón fuerte (alta intensidad) brilla saturado; el débil se apaga
    return col * (0.4 + 0.6 * smoothstep(uThresh, uThresh * 3.0, intensity));
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

    float stepSize = 2.0 / 100.0;
    int steps = int(min((tMax - tStart) / stepSize, 128.0));

    vec4 acc = vec4(0.0);

    for(int i = 0; i < 128; i++){
        if(i >= steps) break;

        float t = tStart + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * t;

        float d = sampleVol(pos);
        if(d < uThresh) continue;

        float ph = samplePhase(pos);
        vec3 col = museColor(d, ph);

        float alpha = smoothstep(uThresh, uThresh * 3.0, d) * 0.07;

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);

        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
