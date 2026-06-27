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
//  AGUA — Fluido Incompresible con Scattering de Luz
//
//  renderVolume: densidad del fluido + contribución de luz
//  phaseData:    velocidad normalizada → color
//    0.0 = lento, cayendo  → azul profundo
//    0.5 = velocidad media → cian / verde agua
//    1.0 = rápido          → blanco / amarillo
//
//  El rayo de luz entra por la cara superior (Y=+1) y se
//  dispersa según la densidad local — scattering de Mie
//  simplificado. Las gotas y remolinos se hacen visibles
//  porque atrapan y dispersan la luz.
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
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uPhase, uvw).r;
}

// ── Paleta de agua por velocidad / fase ───────────────────────
// ph=0 → azul noche (fluido quieto, profundo)
// ph=0.4 → cian verdoso (fluido en movimiento)
// ph=0.7 → verde agua (corriente rápida)
// ph=1.0 → blanco amarillento (turbulencia / luz directa)
vec3 waterColor(float ph, float density) {
    vec3 col;
    if(ph < 0.25) {
        col = mix(vec3(0.0,  0.02, 0.12), vec3(0.0,  0.12, 0.45), ph/0.25);
    } else if(ph < 0.5) {
        col = mix(vec3(0.0,  0.12, 0.45), vec3(0.0,  0.55, 0.72), (ph-0.25)/0.25);
    } else if(ph < 0.75) {
        col = mix(vec3(0.0,  0.55, 0.72), vec3(0.35, 0.85, 0.75), (ph-0.5)/0.25);
    } else {
        col = mix(vec3(0.35, 0.85, 0.75), vec3(0.95, 0.98, 0.92), (ph-0.75)/0.25);
    }
    // Oscurecer el fluido denso — el agua es más opaca en el interior
    col *= 0.6 + density * 0.4;
    return col;
}

// ── Scattering de Mie simplificado ────────────────────────────
// La luz se dispersa más hacia adelante (anisotropía)
// g = factor de asimetría [0=isótropo, 1=todo hacia adelante]
float phaseHG(float cosTheta, float g) {
    float g2 = g * g;
    return (1.0 - g2) / pow(1.0 + g2 - 2.0*g*cosTheta, 1.5) / (4.0*3.14159);
}

// ── Normal del fluido ─────────────────────────────────────────
vec3 fluidNormal(vec3 pos) {
    float eps = 0.06;
    float dx = sampleVol(pos+vec3(eps,0,0)) - sampleVol(pos-vec3(eps,0,0));
    float dy = sampleVol(pos+vec3(0,eps,0)) - sampleVol(pos-vec3(0,eps,0));
    float dz = sampleVol(pos+vec3(0,0,eps)) - sampleVol(pos-vec3(0,0,eps));
    return normalize(vec3(dx,dy,dz) + 0.001);
}

// ── Fresnel para la superficie del agua ───────────────────────
float fresnel(vec3 rd, vec3 n) {
    return pow(max(0.0, 1.0 - abs(dot(rd, n))), 3.5);
}

// ── Ondas de toque ────────────────────────────────────────────
float touchRipple(vec3 pos) {
    if(uTouchPos.x > 5.0) return 0.0;
    float dist = length(pos.xz - uTouchPos.xz);
    float t = uTouchTime;
    float wave = sin(dist*20.0 - t*12.0) * exp(-dist*3.0) * exp(-t*1.5);
    return max(0.0, wave) * max(0.0, 1.0 - t*2.5);
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

    // Dirección de la luz — viene desde arriba y ligeramente diagonal
    vec3 lightDir = normalize(vec3(0.2, -1.0, 0.1));

    // Ángulo de scattering: cos(θ) entre rayo visual y rayo de luz
    float cosTheta = dot(rd, -lightDir);

    float stepSize = 2.0 / 80.0;
    int steps = int(min((tMax - tStart) / stepSize, 128.0));
    vec4 acc = vec4(0.0);

    // Transmitancia acumulada — cuánta luz llega al observador
    float transmittance = 1.0;

    for(int i = 0; i < 128; i++){
        if(i >= steps) break;
        float tt = tStart + (float(i) + 0.5) * stepSize;
        vec3 pos = ro + rd * tt;

        float d  = sampleVol(pos);
        float ph = samplePhase(pos);

        if(d < uThresh * 0.3) continue;

        float density = smoothstep(uThresh*0.3, uThresh*5.0, d);

        // ── Color base del fluido ─────────────────────────────
        vec3 baseCol = waterColor(ph, density);

        // ── Scattering de la luz ──────────────────────────────
        // La luz proviene de arriba — más intensa donde la densidad
        // es alta Y la posición es cerca de la parte superior
        float heightFactor = (pos.y + 1.0) * 0.5; // 0=abajo, 1=arriba
        float lightContrib = ph * 0.4 + heightFactor * 0.3;

        // Función de fase de Henyey-Greenstein (scattering anisótropo)
        float scatter = phaseHG(cosTheta, 0.4);

        // Color de la luz scattered: blanco-amarillo cálido
        vec3 lightCol = vec3(0.9, 0.95, 1.0);
        // Tinte cálido donde la luz es directa
        lightCol = mix(lightCol, vec3(1.0, 0.97, 0.85), heightFactor * 0.5);

        // Mezcla: color del agua + scattering de luz
        vec3 col = mix(baseCol, lightCol, lightContrib * scatter * 0.8);

        // ── Fresnel en la superficie (zonas de gradiente alto) ─
        vec3 normal = fluidNormal(pos);
        float fr = fresnel(rd, normal);
        // Reflexión: tinte del cielo (azul claro)
        col += vec3(0.5, 0.8, 1.0) * fr * density * 0.3;

        // ── Ondas de toque ────────────────────────────────────
        float ripple = touchRipple(pos);
        col += vec3(0.8, 0.95, 1.0) * abs(ripple) * 0.4 * density;

        // ── Acumulación volumétrica con transmitancia ──────────
        // Beer-Lambert: luz se atenúa exponencialmente con densidad
        float extinction = density * 1.2;
        float alpha = 1.0 - exp(-extinction * stepSize * 4.0);
        alpha = clamp(alpha, 0.0, 0.95);

        acc.rgb += col * alpha * transmittance;
        acc.a   += alpha * transmittance;
        transmittance *= (1.0 - alpha * 0.6);

        if(transmittance < 0.02) break;
    }

    // ── Borde del cubo — reflexión interna del agua ───────────
    float edgeMask = max(max(abs(vLocalPos.x), abs(vLocalPos.y)), abs(vLocalPos.z));
    float edge = smoothstep(0.87, 1.0, edgeMask);
    if(edge > 0.0 && acc.a < 0.3) {
        // El borde tiene el color del agua en esa zona
        float edgePh = samplePhase(vLocalPos * 0.85);
        vec3 edgeCol = waterColor(edgePh, 0.5);
        // Borde inferior más oscuro (profundo), superior más luminoso
        float yFactor = (vLocalPos.y + 1.0) * 0.5;
        edgeCol = mix(edgeCol * 0.4, edgeCol * 1.2, yFactor);
        acc.rgb += edgeCol * edge * 0.2 * (1.0 - acc.a);
        acc.a   += edge * 0.1 * (1.0 - acc.a);
    }

    // ── Fondo del cubo — caústicas proyectadas ────────────────
    float floorDist = 1.0 - smoothstep(-1.0, -0.7, vLocalPos.y);
    if(floorDist > 0.01) {
        // Patrón de caústicas usando la densidad del fluido proyectada
        float floorPh  = samplePhase(vec3(vLocalPos.x, -0.85, vLocalPos.z));
        float floorVol = sampleVol(vec3(vLocalPos.x, -0.6, vLocalPos.z));

        // Caústicas simples: interferencia de la densidad proyectada
        float caust = pow(max(0.0, floorVol), 2.0) * floorPh;
        caust += sin(vLocalPos.x*12.0 + uTime*1.5) * sin(vLocalPos.z*11.0 + uTime*1.3)
               * floorVol * 0.15;
        caust = max(0.0, caust);

        vec3 floorCol = mix(
            vec3(0.0, 0.08, 0.25),       // azul oscuro de fondo
            vec3(0.4, 0.85, 1.0) * 1.5,  // cián brillante donde llega la luz
            caust
        );
        float fAlpha = floorDist * min(1.0, caust * 2.0 + 0.05);
        acc.rgb += floorCol * fAlpha * (1.0 - acc.a);
        acc.a   += fAlpha * 0.15 * (1.0 - acc.a);
    }

    gl_FragColor = clamp(acc, 0.0, 1.0);
}
