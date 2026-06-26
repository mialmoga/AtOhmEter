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

// Normal de faceta — aproximada con gradiente cuantizado
// Las facetas emergen de la discretización del gradiente
vec3 facetNormal(vec3 pos, float d){
    float eps=0.06;
    float dx=sampleVol(pos+vec3(eps,0,0))-sampleVol(pos-vec3(eps,0,0));
    float dy=sampleVol(pos+vec3(0,eps,0))-sampleVol(pos-vec3(0,eps,0));
    float dz=sampleVol(pos+vec3(0,0,eps))-sampleVol(pos-vec3(0,0,eps));
    // Cuantizar el normal — crea las "facetas" del cristal
    vec3 n=vec3(dx,dy,dz);
    n=normalize(floor(n*4.0+0.5)/4.0 + 0.001);
    return n;
}

// Dispersión prismática — separar el blanco en colores del espectro
// El índice de refracción varía con la longitud de onda
vec3 prismDispersion(vec3 rd, vec3 normal, float ior_base, float phase){
    // Tres "longitudes de onda" — R, G, B
    float ior_r=ior_base + 0.02;
    float ior_g=ior_base;
    float ior_b=ior_base - 0.02;

    // Refracción aproximada para cada canal
    float cosi=abs(dot(rd,normal));
    float r_comp=sqrt(max(0.0,1.0-(1.0-cosi*cosi)/(ior_r*ior_r)));
    float g_comp=sqrt(max(0.0,1.0-(1.0-cosi*cosi)/(ior_g*ior_g)));
    float b_comp=sqrt(max(0.0,1.0-(1.0-cosi*cosi)/(ior_b*ior_b)));

    return vec3(r_comp, g_comp, b_comp);
}

// Color del cristal: transparente con destellos de prisma
vec3 crystalColor(float density, vec3 normal, vec3 rd, float phase, vec3 pos){
    // Color base del cristal según fase
    vec3 crystal_tint;
    if(phase < 0.2){
        crystal_tint=vec3(0.9,0.95,1.0);  // cristal de cuarzo
    } else if(phase < 0.4){
        crystal_tint=vec3(0.7,0.85,1.0);  // zafiro
    } else if(phase < 0.6){
        crystal_tint=vec3(0.7,1.0,0.75);  // esmeralda
    } else if(phase < 0.8){
        crystal_tint=vec3(1.0,0.7,0.7);   // rubí
    } else {
        crystal_tint=vec3(1.0,0.9,0.6);   // citrino
    }

    // Reflexión especular en facetas — highlight muy duro
    vec3 lightDir1=normalize(vec3(0.5,1.0,0.3));
    vec3 lightDir2=normalize(vec3(-0.7,0.5,-0.4));
    float spec1=pow(max(0.0,dot(reflect(-lightDir1,normal),-rd)),64.0);
    float spec2=pow(max(0.0,dot(reflect(-lightDir2,normal),-rd)),32.0);

    // Dispersión prismática
    float ior=1.45+phase*0.1; // diamante=2.4, vidrio=1.5, cuarzo=1.45
    vec3 disp=prismDispersion(rd,normal,ior,phase);
    vec3 rainbow=disp*2.0;

    // Color final
    vec3 col=crystal_tint*(0.1+0.3*density);
    col+=crystal_tint*spec1*2.0; // highlight principal
    col+=vec3(0.5,0.5,1.0)*spec2*0.5; // highlight secundario azulado
    col+=rainbow*spec1*1.5; // dispersión prismática en el highlight

    // Brillo interno — el cristal atrapa luz
    float internal=0.5+0.5*sin(dot(pos,vec3(7.3,11.1,5.7))+uTime*0.3);
    col+=crystal_tint*internal*density*0.15;

    return col;
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

    float stepSize=2.0/64.0;
    int steps=int(min((tMax-tStart)/stepSize,128.0));
    vec4 acc=vec4(0.0);

    for(int i=0;i<128;i++){
        if(i>=steps) break;
        float t=tStart+(float(i)+0.5)*stepSize;
        vec3 pos=ro+rd*t;
        float d=sampleVol(pos);
        if(d<uThresh) continue;

        float ph=samplePhase(pos);
        float density=smoothstep(uThresh,uThresh*3.0,d);

        vec3 normal=facetNormal(pos,d);
        vec3 col=crystalColor(density,normal,rd,ph,pos);

        // Cristal es muy transparente — alpha bajo
        // Pero los highlights son brillantes
        float spec=pow(max(0.0,dot(reflect(-normalize(vec3(0.5,1.0,0.3)),normal),-rd)),64.0);
        float alpha=(density*0.03 + spec*0.15)*(1.0-acc.a);

        acc.rgb+=col*alpha;
        acc.a  +=alpha;
        if(acc.a>0.95) break;
    }

    gl_FragColor=acc;
}
