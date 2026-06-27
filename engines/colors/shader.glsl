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
//  COLORS — Cubo de Agua con Luces RGB
//
//  renderVolume → brillo total (fluido + luz + sono)
//  phaseData    → color dominante codificado en [0,1]
//                 0.0=rojo, 0.33=verde, 0.66=azul, 0.5=blanco
//
//  El shader decodifica phaseData para reconstruir el color RGB
//  y añade: iridiscencia, cáustics, fresnel, sonoluminiscencia
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
// Raycaster
uniform vec3      uTouchPos;
uniform float     uTouchActive;
uniform float     uTouchTime;

float sampleVol(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.0;
    return texture(uVolume,uvw).r;
}
float samplePhase(vec3 p){
    vec3 uvw=p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.0)))||any(greaterThan(uvw,vec3(1.0)))) return 0.5;
    return texture(uPhase,uvw).r;
}

// Decodificar phase → color RGB
// 0.0=rojo, 0.33=verde, 0.66=azul, 0.5=blanco, 0.16=amarillo, 0.83=magenta
vec3 decodeColor(float ph){
    // Rueda de colores de 3 picos: R(0), G(0.33), B(0.66)
    float a = ph * 6.28318 * 1.5; // 1.5 ciclos para mapear 0→1 a RGB
    float r = clamp(1.0 - abs(ph - 0.0)*6.0, 0.0, 1.0)
            + clamp(1.0 - abs(ph - 1.0)*6.0, 0.0, 1.0);
    float g = clamp(1.0 - abs(ph - 0.333)*6.0, 0.0, 1.0);
    float b = clamp(1.0 - abs(ph - 0.666)*6.0, 0.0, 1.0);
    // Blanco en ph=0.5
    float white = clamp(1.0 - abs(ph - 0.5)*8.0, 0.0, 1.0);
    vec3 col = vec3(r, g, b);
    col = mix(col, vec3(1.0), white);
    return clamp(col, 0.0, 1.0);
}

// Iridiscencia — thin-film interference
// Varía el color según el ángulo de vista y la posición
vec3 iridescence(vec3 rd, vec3 normal, float thickness, float ph){
    float cosAngle = abs(dot(-rd, normal));
    // Interferencia de película delgada
    float phase1 = thickness * cosAngle * 8.0 + uTime*0.2;
    float phase2 = thickness * cosAngle * 12.0 + uTime*0.15;
    float phase3 = thickness * cosAngle * 6.0 + uTime*0.25;
    vec3 iri = vec3(
        0.5 + 0.5*sin(phase1),
        0.5 + 0.5*sin(phase2 + 2.094),
        0.5 + 0.5*sin(phase3 + 4.189)
    );
    return iri;
}

// Normal aproximada del fluido
vec3 fluidNormal(vec3 pos){
    float eps=0.04;
    float dx=sampleVol(pos+vec3(eps,0,0))-sampleVol(pos-vec3(eps,0,0));
    float dy=sampleVol(pos+vec3(0,eps,0))-sampleVol(pos-vec3(0,eps,0));
    float dz=sampleVol(pos+vec3(0,0,eps))-sampleVol(pos-vec3(0,0,eps));
    return normalize(vec3(dx,dy,dz)+0.001);
}

// Cáustics tipo filamentos — redes de luz en las caras del cubo
// Inspirado en cáustics reales de superficie de agua
float causticFilaments(vec3 pos, float t){
    // Múltiples capas de ruido sinusoidal que crean filamentos
    vec3 p = pos * 8.0;
    float c1 = sin(p.x*1.3 + t*0.8) * sin(p.z*1.1 - t*0.6);
    float c2 = sin(p.x*0.7 - p.z*1.4 + t*1.1) * sin(p.y*0.9 + t*0.4);
    float c3 = sin(p.x*2.1 + p.y*0.8 - t*0.7) * sin(p.z*1.7 + t*0.5);
    // Los filamentos emergen donde los cosenos se cruzan cerca de 1
    float caustic = c1*c1 + c2*c2 + c3*c3;
    // Umbral alto para crear filamentos delgados y brillantes
    return smoothstep(0.7, 1.0, caustic) * 2.0;
}

// Efecto de toque — ondas que emanan del punto tocado
float touchRipple(vec3 pos){
    if(uTouchPos.x > 5.0) return 0.0; // sin toque activo
    float dist = length(pos - uTouchPos);
    float t = uTouchTime;
    // Onda que se expande desde el punto de toque
    float wave = sin(dist*15.0 - t*8.0) * exp(-dist*3.0) * exp(-t*1.5);
    return max(0.0, wave) * (1.0 - smoothstep(0.0, 0.3, t));
}

// Sonoluminiscencia — destello puntual de luz blanca
float sonoFlash(vec3 pos){
    // El sono está codificado en el volumen como alta densidad puntual
    // Lo detectamos con un sample local
    float s = sampleVol(pos);
    return s > 0.8 ? (s - 0.8) * 5.0 : 0.0;
}

float boxExit(vec3 ro,vec3 rd,float hs){
    vec3 invD=1.0/rd;
    vec3 t0=(-hs-ro)*invD,t1=(hs-ro)*invD;
    vec3 tm=max(t0,t1);
    return min(min(tm.x,tm.y),tm.z);
}

void main(){
    vec3 ro=uCameraLocal;
    vec3 rd=normalize(vLocalPos-ro);
    float tMax=boxExit(ro,rd,1.0);
    if(tMax<0.0) discard;

    float tStart=0.001;
    if(!all(greaterThan(ro,vec3(-1.0)))||!all(lessThan(ro,vec3(1.0)))){
        vec3 invD=1.0/rd;
        vec3 t0=(-1.0-ro)*invD,t1=(1.0-ro)*invD;
        vec3 tm=min(t0,t1);
        tStart=max(max(tm.x,tm.y),tm.z);
        if(tStart<0.0) tStart=0.001;
    }

    float stepSize=2.0/80.0;
    int steps=int(min((tMax-tStart)/stepSize,128.0));
    vec4 acc=vec4(0.0);

    for(int i=0;i<128;i++){
        if(i>=steps) break;
        float t=tStart+(float(i)+0.5)*stepSize;
        vec3 pos=ro+rd*t;
        float d=sampleVol(pos);
        float ph=samplePhase(pos);

        // Umbral más bajo para ver el fluido tenue
        if(d < uThresh*0.3) continue;

        float density=smoothstep(uThresh*0.3, uThresh*4.0, d);

        // ── Color base desde phaseData ────────────────────────
        vec3 baseCol = decodeColor(ph);

        // ── Normal del fluido ──────────────────────────────────
        vec3 normal = fluidNormal(pos);

        // ── Iridiscencia — thin-film interference ─────────────
        float thickness = 0.3 + 0.2*sin(pos.x*3.0+uTime*0.3)
                              + 0.2*sin(pos.z*2.5-uTime*0.2);
        vec3 iri = iridescence(rd, normal, thickness, ph);
        // Mezclar color base con iridiscencia según ángulo
        float fresnelAngle = pow(1.0 - abs(dot(-rd, normal)), 2.0);
        vec3 col = mix(baseCol, iri, fresnelAngle*0.6);

        // ── Cáustics ──────────────────────────────────────────
        float caust = causticFilaments(pos, uTime);
        col += baseCol * caust * 0.5 * density;

        // ── Especular del fluido ───────────────────────────────
        vec3 lightDir = normalize(vec3(0.3, 1.0, 0.2));
        float spec = pow(max(0.0, dot(reflect(-lightDir,normal),-rd)), 48.0);
        col += vec3(1.0) * spec * 0.8;

        // ── Ripple de toque ────────────────────────────────────
        float ripple = touchRipple(pos);
        col += vec3(0.8,0.9,1.0) * ripple * 0.5;

        // ── Sonoluminiscencia ─────────────────────────────────
        float sono = sonoFlash(pos);
        col += vec3(1.0, 0.97, 0.9) * sono * 3.0; // destello blanco cálido

        // ── Profundidad — el fluido es translúcido ─────────────
        // Las partes más profundas del cubo tienen más color
        float depth = (t - tStart) / (tMax - tStart);
        col *= 0.7 + 0.3*depth;

        float alpha = density * 0.055 + spec*0.1 + sono*0.2;
        acc.rgb += col * alpha * (1.0-acc.a);
        acc.a   += alpha * (1.0-acc.a);
        if(acc.a>0.95) break;
    }

    // ── Cáustics proyectados en las caras del cubo ────────────
    // Los filamentos son más intensos cerca de las caras
    float face_dist = 1.0 - min(
        min(abs(abs(vLocalPos.x)-0.95), abs(abs(vLocalPos.y)-0.95)),
        abs(abs(vLocalPos.z)-0.95)
    );
    float face_caust = causticFilaments(vLocalPos*2.0, uTime*0.8) * face_dist * 0.8;

    // Borde del cubo — reflexión interna iridiscente
    float edge = 1.0 - smoothstep(0.85, 1.0,
        max(max(abs(vLocalPos.x),abs(vLocalPos.y)),abs(vLocalPos.z)));
    if(acc.a < 0.05 && edge > 0.0){
        float edgePh = fract(vLocalPos.x*2.0+vLocalPos.y*1.5+uTime*0.1);
        vec3 edgeCol = decodeColor(edgePh);
        // Cáustics en los bordes con color de luz dominante
        vec3 faceCol = edgeCol + vec3(face_caust);
        acc.rgb += faceCol * (edge * 0.15 + face_caust * 0.1);
        acc.a   += edge * 0.1;
    }

    gl_FragColor = acc;
}
