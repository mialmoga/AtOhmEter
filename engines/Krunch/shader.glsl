// ══════════════════════════════════════════════════════════════
//  shader.glsl — KRUNCH
//
//  "El cristal que se astilla"
//  (inspiración visual: render de Velvet)
//
//  Render:
//    COLOR (fase): hue de la realidad. El motor escribe en phaseData el
//      tono de cada celda (0.60 azul cristal, 0.08 naranja, 0.33 verde,
//      0.85 magenta, 0.50 cyan). Rueda de color → RGB.
//    BRILLO (densidad): el cristal liso es muy tenue; las VENAS de astilla
//      brillan finas y nítidas con un destello blanco en el filo; el núcleo
//      de Menger visto por las grietas se ve como cubos luminosos.
//
//  Estética: cristal translúcido con venas de vidrio estrellado finas,
//  mostrando un corazón fractal cúbico de otro color por las astillas.
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
uniform sampler3D uVolume;   // brillo: cristal tenue / venas / núcleo Menger
uniform sampler3D uPhase;    // hue de la realidad [0,1]

float sampleVol(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
    return texture(uVolume, uvw).r;
}
float samplePhase(vec3 p){
    vec3 uvw = p * 0.5 + 0.5;
    if(any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.6;
    return texture(uPhase, uvw).r;
}

float boxExit(vec3 ro, vec3 rd, float halfSize){
    vec3 invD = 1.0 / rd;
    vec3 t0 = (-halfSize - ro) * invD;
    vec3 t1 = ( halfSize - ro) * invD;
    vec3 tmax = max(t0, t1);
    return min(min(tmax.x, tmax.y), tmax.z);
}

vec3 hue2rgb(float h){
    float r = abs(h * 6.0 - 3.0) - 1.0;
    float g = 2.0 - abs(h * 6.0 - 2.0);
    float b = 2.0 - abs(h * 6.0 - 4.0);
    return clamp(vec3(r, g, b), 0.0, 1.0);
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

        float h = samplePhase(pos);
        vec3 col = hue2rgb(h);

        // las venas finas (brillo alto) brillan nítidas con destello blanco;
        // el cristal liso (brillo bajo) es translúcido tenue.
        float vein = smoothstep(0.3, 0.85, d);   // qué tan "vena" es
        col = mix(col * 0.45, col * 1.2, vein);   // cristal apagado, vena viva
        col += vec3(vein * vein) * 0.4;           // filo blanco del vidrio

        // alpha: el cristal liso casi transparente; las venas más opacas
        float alpha = mix(0.025, 0.12, vein) * smoothstep(uThresh, uThresh*2.0, d);

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);

        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
