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

uniform vec3    uCameraPos;
uniform vec3    uCameraLocal;
uniform float   uTime;
uniform float   uThresh;
uniform float   uEnergy;
uniform sampler3D uVolume;
uniform sampler3D uPhase;

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

// Paleta lava: negro → rojo oscuro → naranja → amarillo → blanco
vec3 lavaColor(float t, float phase) {
    // t = intensidad [0,1], phase = fase del campo

    // Variación de tono por fase — lava no es uniforme
    float hue_shift = phase * 0.15;
    t = clamp(t + hue_shift * 0.2, 0.0, 1.0);

    vec3 col;
    if (t < 0.2) {
        // Negro → rojo oscuro (roca solidificada)
        col = mix(vec3(0.02, 0.01, 0.01),
                  vec3(0.4, 0.05, 0.02),
                  t / 0.2);
    } else if (t < 0.5) {
        // Rojo oscuro → naranja (magma)
        col = mix(vec3(0.4, 0.05, 0.02),
                  vec3(0.9, 0.3, 0.02),
                  (t - 0.2) / 0.3);
    } else if (t < 0.8) {
        // Naranja → amarillo dorado (núcleo caliente)
        col = mix(vec3(0.9, 0.3, 0.02),
                  vec3(1.0, 0.85, 0.1),
                  (t - 0.5) / 0.3);
    } else {
        // Amarillo → blanco (máxima temperatura)
        col = mix(vec3(1.0, 0.85, 0.1),
                  vec3(1.0, 0.98, 0.9),
                  (t - 0.8) / 0.2);
    }

    // Pulso de brillo — la lava "late"
    float pulse = 1.0 + 0.08 * sin(uTime * 1.2 + phase * 8.0 + t * 15.0);
    return col * pulse;
}

float boxExit(vec3 ro, vec3 rd, float hs){
    vec3 invD=1.0/rd;
    vec3 t0=(-hs-ro)*invD, t1=(hs-ro)*invD;
    vec3 tm=max(t0,t1);
    return min(min(tm.x,tm.y),tm.z);
}

void main(){
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos - ro);
    float tMax = boxExit(ro, rd, 1.0);
    if(tMax < 0.0) discard;

    float tStart = 0.001;
    if(!all(greaterThan(ro,vec3(-1.0)))||!all(lessThan(ro,vec3(1.0)))){
        vec3 invD=1.0/rd;
        vec3 t0=(-1.0-ro)*invD, t1=(1.0-ro)*invD;
        vec3 tm=min(t0,t1);
        tStart=max(max(tm.x,tm.y),tm.z);
        if(tStart<0.0) tStart=0.001;
    }

    float stepSize = 2.0/64.0;
    int steps = int(min((tMax-tStart)/stepSize, 128.0));
    vec4 acc = vec4(0.0);

    for(int i=0; i<128; i++){
        if(i>=steps) break;
        float t = tStart + (float(i)+0.5)*stepSize;
        vec3 pos = ro + rd*t;
        float d = sampleVol(pos);
        if(d < uThresh) continue;

        float ph = samplePhase(pos);
        float intensity = smoothstep(uThresh, uThresh*4.0, d);
        vec3 col = lavaColor(intensity, ph);

        // Sombra volumétrica — la lava tiene profundidad
        float d_ahead = sampleVol(pos + rd*stepSize*3.0);
        float shadow = 0.7 + 0.3*exp(-d_ahead*3.0);
        col *= shadow;

        float alpha = intensity * 0.07;
        acc.rgb += col * alpha * (1.0-acc.a);
        acc.a   += alpha * (1.0-acc.a);
        if(acc.a > 0.95) break;
    }

    gl_FragColor = acc;
}
