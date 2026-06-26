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

vec3 volGrad(vec3 p){
    float e = 0.06;
    return vec3(
        sampleVol(p+vec3(e,0,0)) - sampleVol(p-vec3(e,0,0)),
        sampleVol(p+vec3(0,e,0)) - sampleVol(p-vec3(0,e,0)),
        sampleVol(p+vec3(0,0,e)) - sampleVol(p-vec3(0,0,e))
    ) / (2.0*e);
}

vec3 phaseColor(float ph, float density){
    vec3 c0 = vec3(1.0,  0.35, 0.1);   
    vec3 c1 = vec3(0.1,  0.7,  1.0);   
    vec3 c2 = vec3(0.8,  0.2,  1.0);   

    vec3 col;
    if(ph < 0.5) col = mix(c0, c1, ph*2.0);
    else         col = mix(c1, c2, (ph-0.5)*2.0);

    col += vec3(1.2, 1.0, 0.6) * smoothstep(0.75, 1.0, density) * 0.5;
    return col;
}

void main(){
    vec3 rayDir = normalize(vLocalPos - uCameraLocal);
    vec3 rayPos = vLocalPos + rayDir * 0.002;

    int   STEPS    = 96;
    float stepSize = 3.46 / float(STEPS); 

    vec4 col = vec4(0.0);

    for(int i=0; i<96; i++){
        if(col.a > 0.95) break;
        vec3 p = rayPos + rayDir * float(i) * stepSize;

        if(any(greaterThan(abs(p), vec3(1.0)))) break;

        float density = sampleVol(p);
        float vacuum = density * 0.12 + density*density * 0.2;
        col.rgb += vec3(0.1, 0.2, 0.5) * vacuum * (1.0-col.a);
        col.a   += vacuum * 0.6 * (1.0-col.a);

        if(density > uThresh){
            float phase  = samplePhase(p);
            vec3  grad   = volGrad(p);
            float gMag   = length(grad);
            vec3  normal = gMag > 0.001 ? -normalize(grad) : vec3(0,1,0);
            float diff   = max(0.0, dot(normal, normalize(vec3(0.5,1.0,0.8)))) * 0.6 + 0.4;

            vec3  baseCol = phaseColor(phase, density);
            float excess  = (density - uThresh) / (1.0 - uThresh + 0.001);
            float alpha   = smoothstep(0.0, 0.4, excess) * 0.4;

            col.rgb += baseCol * diff * alpha * (1.0-col.a);
            col.a   += alpha * (1.0-col.a);
        }

        if(density > uThresh * 1.6){
            float core  = smoothstep(uThresh*1.6, 1.0, density);
            float phase = samplePhase(p);
            col.rgb += phaseColor(phase, 1.0) * core * 0.15 * (1.0-col.a);
            col.a   += core * 0.1 * (1.0-col.a);
        }
    }

    if(col.a < 0.002) discard;
    gl_FragColor = col;
}
