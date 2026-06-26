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

// ── Paletas científicas ──────────────────────────────────────

// Viridis — perceptualmente uniforme, seguro para daltónicos
vec3 viridis(float t){
    t=clamp(t,0.0,1.0);
    vec3 c0=vec3(0.267,0.005,0.329);
    vec3 c1=vec3(0.282,0.301,0.614);
    vec3 c2=vec3(0.128,0.567,0.551);
    vec3 c3=vec3(0.369,0.788,0.383);
    vec3 c4=vec3(0.993,0.906,0.144);
    if(t<0.25) return mix(c0,c1,t*4.0);
    if(t<0.50) return mix(c1,c2,(t-0.25)*4.0);
    if(t<0.75) return mix(c2,c3,(t-0.50)*4.0);
    return mix(c3,c4,(t-0.75)*4.0);
}

// Plasma — violeta→rojo→amarillo, alto contraste
vec3 plasma(float t){
    t=clamp(t,0.0,1.0);
    vec3 c0=vec3(0.050,0.030,0.527);
    vec3 c1=vec3(0.491,0.012,0.657);
    vec3 c2=vec3(0.798,0.280,0.470);
    vec3 c3=vec3(0.974,0.585,0.254);
    vec3 c4=vec3(0.940,0.975,0.131);
    if(t<0.25) return mix(c0,c1,t*4.0);
    if(t<0.50) return mix(c1,c2,(t-0.25)*4.0);
    if(t<0.75) return mix(c2,c3,(t-0.50)*4.0);
    return mix(c3,c4,(t-0.75)*4.0);
}

// Inferno — negro→rojo→amarillo→blanco
vec3 inferno(float t){
    t=clamp(t,0.0,1.0);
    vec3 c0=vec3(0.001,0.000,0.014);
    vec3 c1=vec3(0.341,0.063,0.429);
    vec3 c2=vec3(0.722,0.215,0.334);
    vec3 c3=vec3(0.988,0.645,0.119);
    vec3 c4=vec3(0.988,1.000,0.643);
    if(t<0.25) return mix(c0,c1,t*4.0);
    if(t<0.50) return mix(c1,c2,(t-0.25)*4.0);
    if(t<0.75) return mix(c2,c3,(t-0.50)*4.0);
    return mix(c3,c4,(t-0.75)*4.0);
}

// Turbo — arcoiris mejorado, más suave que HSV puro
vec3 turbo(float t){
    t=clamp(t,0.0,1.0);
    // Aproximación polinomial de Turbo (Google, 2019)
    vec3 v = vec3(
        0.13572138 + t*(4.61539260 + t*(-42.66032258 + t*(132.13108234 + t*(-152.94239396 + t*(59.28637943))))),
        0.09140261 + t*(2.19418839 + t*(4.84296658 + t*(-14.18503333 + t*(4.27729857 + t*(2.82956604))))),
        0.10667330 + t*(12.64194608 + t*(-60.58204715 + t*(110.22373950 + t*(-89.90310912 + t*(27.34824973)))))
    );
    return clamp(v, 0.0, 1.0);
}

// Selección de paleta según fase
// La fase divide el campo en 4 zonas — cada una con su paleta
vec3 falsoColor(float density, float phase, vec3 pos){
    float t = smoothstep(uThresh, uThresh*5.0, density);

    vec3 col;
    if(phase < 0.25){
        col = viridis(t);
    } else if(phase < 0.50){
        col = plasma(t);
    } else if(phase < 0.75){
        col = inferno(t);
    } else {
        col = turbo(t);
    }

    // Isolíneas — líneas de nivel que muestran la estructura cuantizada
    float isoline = abs(sin(density*20.0))*0.15;
    col -= isoline * col * 0.5; // oscurecer levemente en las isolíneas

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
        vec3 col=falsoColor(d, ph, pos);

        float alpha=smoothstep(uThresh,uThresh*4.0,d)*0.06;
        acc.rgb+=col*alpha*(1.0-acc.a);
        acc.a  +=alpha*(1.0-acc.a);
        if(acc.a>0.95) break;
    }

    gl_FragColor=acc;
}
