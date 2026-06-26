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

// ── Muestreo ────────────────────────────────────────────────
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

// ── Ceros de j₀ normalizados al radio máximo ────────────────
// j₀(kr)=0 en k·r = π, 2π, 3π, 4π …
// Marcamos dónde el radio es múltiplo de π/k_max
float besselNode(float r, float k){
    // Distancia al nodo Bessel más cercano
    float phase_r = r * k;
    float nearest = round(phase_r / 3.14159);
    float dist = abs(phase_r - nearest * 3.14159);
    // Brillo en los nodos (dist ≈ 0), oscuro entre ellos
    return 1.0 - smoothstep(0.0, 0.4, dist);
}

// ── AABB exit ────────────────────────────────────────────────
float boxExit(vec3 ro, vec3 rd, float hs){
    vec3 invD = 1.0/rd;
    vec3 t0=(-hs-ro)*invD, t1=(hs-ro)*invD;
    vec3 tm=max(t0,t1);
    return min(min(tm.x,tm.y),tm.z);
}

void main(){
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos - ro);

    float tMax = boxExit(ro, rd, 1.0);
    if(tMax < 0.0) discard;

    float tStart = 0.0;
    if(all(greaterThan(ro,vec3(-1.0)))&&all(lessThan(ro,vec3(1.0)))){
        tStart = 0.001;
    } else {
        vec3 invD=1.0/rd;
        vec3 t0=(-1.0-ro)*invD, t1=(1.0-ro)*invD;
        vec3 tmin_v=min(t0,t1);
        tStart=max(max(tmin_v.x,tmin_v.y),tmin_v.z);
        if(tStart<0.0) tStart=0.001;
    }

    float stepSize = 2.0 / 64.0; // más pasos para ver nodos finos
    int steps = int(min((tMax-tStart)/stepSize, 128.0));

    vec4 acc = vec4(0.0);
    vec3 light = normalize(vec3(0.4, 1.0, 0.5));

    // k estimado para primer modo — ajustable via uThresh como proxy
    // π/R donde R≈0.15 del volumen normalizado (núcleo ~3 celdas en N=32)
    float k_bessel = 3.14159 / 0.18;

    for(int i = 0; i < 128; i++){
        if(i >= steps) break;
        float t = tStart + (float(i)+0.5)*stepSize;
        vec3 pos = ro + rd*t;

        float d = sampleVol(pos);

        // Radio normalizado al centro
        float r = length(pos);

        float ph = samplePhase(pos); // 0..1

        // ── Núcleo bipolar — siempre visible aunque d < uThresh ──
        // Fase A (+1 → ph≈1): polo norte — azul eléctrico
        // Fase B (-1 → ph≈0): polo sur — rojo magenta
        float nucleus_mask = smoothstep(0.25, 0.10, r); // solo en el centro
        vec3 colNucleus = mix(
            vec3(1.0, 0.1, 0.4),  // polo sur — magenta
            vec3(0.1, 0.5, 1.0),  // polo norte — azul
            ph
        );

        if(nucleus_mask > 0.01){
            float alpha_n = nucleus_mask * 0.12;
            acc.rgb += colNucleus * alpha_n * (1.0-acc.a);
            acc.a   += alpha_n * (1.0-acc.a);
        }

        // ── Campo orbital — solo donde hay densidad ──────────
        if(d < uThresh * 0.3) continue;

        // ── Color base por fase bifásica ──────────────────────
        vec3 colA = vec3(0.15, 0.55, 1.00); // fase +1 — azul frío
        vec3 colB = vec3(1.00, 0.30, 0.10); // fase -1 — ámbar
        vec3 colFrontera = vec3(0.2, 1.0, 0.6); // φ≈0 — verde eléctrico

        float border = 1.0 - 2.0*abs(ph-0.5);
        border = smoothstep(0.0, 0.6, border);

        vec3 col = mix(colB, colA, ph);
        col = mix(col, colFrontera, border*0.6);

        // ── Anillos de nodo Bessel ─────────────────────────────
        // Los nodos j₀ aparecen como anillos brillantes donde |u|→0
        // El shader invierte: oscuro donde hay campo, BRILLANTE en los nodos
        float node_glow = besselNode(r, k_bessel);
        // Pulso temporal — los nodos Bessel "respiran" con el bombeo
        node_glow *= 0.5 + 0.5*sin(uTime*1.5 + r*k_bessel);

        // Mezclar color orbital con el glow de nodo
        vec3 nodeColor = vec3(0.9, 0.85, 0.3); // amarillo dorado en los nodos
        col = mix(col, nodeColor, node_glow * 0.5);

        // ── Bandas de radio para debugging visual ─────────────
        // Oscilación suave para revelar estructura radial
        float radial_band = 0.5 + 0.5*sin(r * k_bessel);
        col *= 0.7 + 0.3*radial_band;

        // ── Alpha — más contraste que el shader anterior ──────
        float alpha = smoothstep(uThresh*0.3, uThresh*2.0, d) * 0.07;

        // Iluminación
        float dL = sampleVol(pos + light*stepSize*2.0);
        col *= 0.55 + 0.45*exp(-dL*1.5);

        // Pulso en fronteras de fase
        col += colFrontera * border * 0.12 * (0.5+0.5*sin(uTime*2.5+d*8.0));

        acc.rgb += col * alpha * (1.0-acc.a);
        acc.a   += alpha * (1.0-acc.a);
        if(acc.a > 0.95) break;
    }

    // Vignette suave
    float vign = 1.0 - dot(vLocalPos.xy, vLocalPos.xy)*0.4;
    acc.rgb *= vign;

    gl_FragColor = acc;
}
