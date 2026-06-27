// === VERTEX ===
varying vec3 vLocalPos;
uniform float uBoxSize;
void main(){
    vLocalPos = position / uBoxSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}

// === FRAGMENT ===
precision highp float;
precision highp sampler3D;

varying vec3 vLocalPos;
uniform vec3      uCameraPos;
uniform vec3      uCameraLocal;
uniform float     uTime;
uniform float     uThresh;
uniform sampler3D uVolume;
uniform sampler3D uPhase;

float sampleVol(vec3 p){
    vec3 uvw = p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.)))||any(greaterThan(uvw,vec3(1.)))) return 0.;
    return texture(uVolume,uvw).r;
}
float samplePhase(vec3 p){
    vec3 uvw = p*0.5+0.5;
    if(any(lessThan(uvw,vec3(0.)))||any(greaterThan(uvw,vec3(1.)))) return 0.5;
    return texture(uPhase,uvw).r;
}

// Decodificar hue → color RGB de tinta
vec3 inkColor(float hue, float density){
    // hue: 0=rojo, 0.33=verde, 0.66=azul, ~1=blanco (mezcla)
    vec3 red   = vec3(0.9, 0.05, 0.15);
    vec3 green = vec3(0.05, 0.85, 0.2);
    vec3 blue  = vec3(0.05, 0.2, 0.95);
    vec3 white = vec3(0.95, 0.95, 1.0);

    vec3 col;
    if(hue < 0.33){
        col = mix(red, green, hue/0.33);
    } else if(hue < 0.66){
        col = mix(green, blue, (hue-0.33)/0.33);
    } else {
        col = mix(blue, white, (hue-0.66)/0.34);
    }
    // Iridiscencia leve con el tiempo y la posición
    float irid = 0.06*sin(uTime*1.2 + hue*12.0);
    col += vec3(irid, -irid*0.5, irid*0.8);
    return clamp(col, 0.0, 1.0);
}

float boxExit(vec3 ro, vec3 rd, float hs){
    vec3 invD=1./rd;
    vec3 t0=(-hs-ro)*invD, t1=(hs-ro)*invD;
    return min(min(max(t0.x,t1.x),max(t0.y,t1.y)),max(t0.z,t1.z));
}

void main(){
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos - ro);

    float tMax = boxExit(ro,rd,1.0);
    if(tMax<0.) discard;

    vec3 invD=1./rd;
    vec3 t0m=(-1.-ro)*invD, t1m=(1.-ro)*invD;
    float tStart=max(max(min(t0m.x,t1m.x),min(t0m.y,t1m.y)),min(t0m.z,t1m.z));
    tStart=max(tStart,0.001);

    float stepSize = 2./80.;
    int steps = int(min((tMax-tStart)/stepSize, 120.0));

    vec4 acc = vec4(0.);

    for(int i=0;i<120;i++){
        if(i>=steps) break;
        float t = tStart + (float(i)+0.5)*stepSize;
        vec3 pos = ro + rd*t;

        float d = sampleVol(pos);
        if(d < uThresh) continue;

        float ph = samplePhase(pos);
        vec3 col = inkColor(ph, d);

        // Efecto de dispersión — las gotas de tinta tienen profundidad
        float scatter = 0.15*sin(uTime*0.8 + length(pos)*4.0 + ph*6.28);
        col += scatter * vec3(0.1, 0.05, 0.2);

        // Alpha — la tinta es más opaca cuanto más concentrada
        float alpha = smoothstep(uThresh, uThresh*6., d) * 0.12;

        // Mezcla aditiva para el blanco en las intersecciones
        acc.rgb += col * alpha * (1.-acc.a);
        acc.a   += alpha * (1.-acc.a);
        if(acc.a>0.96) break;
    }

    // Vignette sutil
    float vign = 1.-dot(vLocalPos.xy,vLocalPos.xy)*0.3;
    acc.rgb *= vign;

    // Fondo muy oscuro con tinte azul profundo
    vec3 bg = vec3(0.005, 0.005, 0.015);
    acc.rgb = mix(bg, acc.rgb, acc.a);
    acc.a   = max(acc.a, 0.02);

    gl_FragColor = acc;
}
