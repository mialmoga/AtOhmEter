// ══════════════════════════════════════════════════════════════
//  shader.glsl — BLOOM
//
//  Glow líquido para el enjambre: las partículas se pintaron como
//  metaballs gaussianos en uVolume, y su color (hue por tipo o por
//  velocidad) viene en uPhase. Aquí lo volvemos luz: cuerpos brillantes
//  con halo suave que se funden visualmente al solaparse — el bloom de
//  Velvet llevado a campo volumétrico.
//
//  Datos del motor:
//    uVolume — densidad de los metaballs (cuerpo + halo de cada partícula)
//    uPhase  — hue [0,1]:  0.08 naranja/magma · 0.52 cian · reactivas varían
//              (lento → azul ~0.6, rápido → rojo ~0.0)
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

// hue [0,1] → RGB (saturación y brillo plenos, estilo neón)
vec3 hue2rgb(float h){
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h*6.0, 6.0);
    return 1.0 - clamp(min(k, 4.0 - k), 0.0, 1.0);
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
    int steps = int(min((tMax - tStart) / stepSize, 128.0));

    vec4 acc = vec4(0.0);
    float glow = 0.0; // acumulador de resplandor para el bloom

    for(int i = 0; i < 128; i++){
        if(i >= steps) break;

        float t = tStart + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * t;

        float d = sampleVol(pos);
        if(d < uThresh) { continue; }

        float h = samplePhase(pos);
        vec3 col = hue2rgb(h);

        // núcleo brillante + halo: el centro del metaball (densidad alta)
        // brilla casi blanco; los bordes guardan el color saturado.
        float core = smoothstep(0.45, 0.9, d);
        col = mix(col, vec3(1.0), core * 0.7);

        // emisión: las zonas densas emiten más luz (glow líquido)
        float emis = d * d;
        glow += emis * 0.06;

        // alpha: cuerpos translúcidos que se suman
        float alpha = smoothstep(uThresh, uThresh*2.0, d) * 0.12;
        alpha += core * 0.06;

        col *= (0.7 + 1.3 * d); // más densa = más luminosa

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);

        if(acc.a > 0.96) break;
    }

    // bloom barato: sumar el resplandor acumulado teñido por el color final
    vec3 glowColor = acc.rgb / max(acc.a, 0.001);
    acc.rgb += glowColor * glow * 0.5;

    gl_FragColor = acc;
}
