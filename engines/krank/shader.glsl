// ══════════════════════════════════════════════════════════════
//  shader.glsl — KRANK
//
//  "El campo que se quiebra"
//
//  Render:
//    COLOR (fase): el tono de la realidad. El motor escribe en phaseData
//      directamente el HUE de cada celda (0.60 azul superficie, 0.08
//      naranja, 0.33 verde, 0.85 magenta, 0.50 cyan...). El shader lo
//      convierte a RGB por rueda de color. Dos realidades = dos colores
//      a ambos lados de la grieta.
//    BRILLO (densidad): la superficie lisa es tenue; el BORDE FRACTAL de
//      la grieta brilla (es donde vive el Mandelbulb), y la otra realidad
//      vista por la fractura se muestra a cuerpo lleno.
//
//  La grieta se lee como una herida luminosa de filo fractal abriéndose
//  sobre un campo liso, mostrando otro color detrás.
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
uniform sampler3D uVolume;   // brillo: borde fractal + cuerpo de la grieta
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

// hue [0,1] → RGB (rueda de color). Saturación alta, luminосidad media.
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

    float stepSize = 2.0 / 110.0;
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

        // realzar el borde fractal: donde el brillo es alto, satura y aclara
        float edge = smoothstep(uThresh, 0.6, d);
        col = mix(col * 0.5, col, edge);          // cuerpo más apagado, borde vivo
        col += vec3(edge * edge) * 0.25;          // destello blanco en el filo

        float alpha = smoothstep(uThresh, uThresh * 3.0, d) * 0.075;

        acc.rgb += col * alpha * (1.0 - acc.a);
        acc.a   += alpha * (1.0 - acc.a);

        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
