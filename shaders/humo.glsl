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

// Fase de Henyey-Greenstein — scattering anisotrópico del humo
float HG(float cosTheta, float g){
    float g2=g*g;
    return (1.0-g2)/(4.0*3.14159*pow(1.0+g2-2.0*g*cosTheta,1.5));
}

// Color del humo según fase y temperatura
// phase baja = humo frío (gris), phase alta = humo caliente (ámbar/rojo)
vec3 smokeColor(float density, float phase, float scatter, float cosTheta){
    // Humo base — gris con tinte
    vec3 cold_smoke  = vec3(0.55, 0.55, 0.58); // gris frío
    vec3 warm_smoke  = vec3(0.72, 0.62, 0.48); // gris cálido
    vec3 ember       = vec3(0.95, 0.45, 0.10); // brasa
    vec3 hot_core    = vec3(1.00, 0.85, 0.40); // núcleo caliente

    vec3 base;
    if(phase < 0.25){
        base = cold_smoke;
    } else if(phase < 0.5){
        base = mix(cold_smoke, warm_smoke, (phase-0.25)/0.25);
    } else if(phase < 0.75){
        base = mix(warm_smoke, ember, (phase-0.5)/0.25);
    } else {
        base = mix(ember, hot_core, (phase-0.75)/0.25);
    }

    // Scattering de Henyey-Greenstein
    float hg = HG(cosTheta, 0.3); // g=0.3 — scattering levemente frontal
    base *= (0.6 + 0.4*hg);

    // Iluminación lateral — fuente de luz difusa
    base *= (0.5 + 0.5*scatter);

    // Las partes más densas son más oscuras (auto-oclusión)
    base *= 1.0 - density*0.3;

    return base;
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

    // Humo usa pasos más grandes pero muchos — acumula niebla
    float stepSize=2.0/80.0;
    int steps=int(min((tMax-tStart)/stepSize,160.0));
    vec4 acc=vec4(0.0);

    // Dirección de luz
    vec3 lightDir=normalize(vec3(0.6,1.0,0.4));
    float cosTheta=dot(rd,lightDir);

    for(int i=0;i<160;i++){
        if(i>=steps) break;
        float t=tStart+(float(i)+0.5)*stepSize;
        vec3 pos=ro+rd*t;
        float d=sampleVol(pos);

        // El humo empieza a verse desde densidades muy bajas
        if(d<uThresh*0.2) continue;

        float ph=samplePhase(pos);
        float density=smoothstep(uThresh*0.2,uThresh*3.0,d);

        // Scattering lateral — qué tanta luz llega desde el lado
        float d_light=sampleVol(pos+lightDir*stepSize*5.0);
        float scatter=exp(-d_light*4.0);

        vec3 col=smokeColor(density,ph,scatter,cosTheta);

        // Alpha alto y suave — el humo es muy transparente pero acumula
        float alpha=density*0.04;

        // Variación de densidad — el humo no es uniforme
        // Simular turbulencia con la fase
        float turb=0.8+0.2*sin(pos.x*6.0+uTime*0.5)*sin(pos.z*4.0-uTime*0.3);
        alpha*=turb;

        acc.rgb+=col*alpha*(1.0-acc.a);
        acc.a  +=alpha*(1.0-acc.a);
        if(acc.a>0.95) break;
    }

    // Fondo oscuro — el humo emerge de la oscuridad
    acc.rgb=mix(vec3(0.02,0.02,0.03)*acc.a, acc.rgb, min(1.0,acc.a*2.0));
    gl_FragColor=acc;
}
