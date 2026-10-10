/** Depth-aware, world-space low mist. Integrated in linear HDR before grading.
 *  The mist is lit by the afterglow (forward-scattering phase), glows around
 *  every lantern and spirit flame, and turns luminous beyond the bridge. */
export const MAX_MIST_LIGHTS = 24;

export function createHeightFogPass(THREE, ShaderPass, camera) {
  const size=64, data=new Uint8Array(size*size*4);
  let seed=729419;
  for(let i=0;i<data.length;i+=4){for(let c=0;c<3;c++){seed=(1664525*seed+1013904223)>>>0;data[i+c]=seed>>>24;}data[i+3]=255;}
  const noise=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  noise.wrapS=noise.wrapT=THREE.RepeatWrapping;
  noise.minFilter=noise.magFilter=THREE.LinearFilter;
  noise.needsUpdate=true;
  const lightPosition=Array.from({length:MAX_MIST_LIGHTS},()=>new THREE.Vector3());
  const lightColor=Array.from({length:MAX_MIST_LIGHTS},()=>new THREE.Vector3());
  const pass=new ShaderPass({
    defines:{MAX_LIGHTS:MAX_MIST_LIGHTS},
    uniforms:{
      tDiffuse:{value:null},tDepth:{value:null},tNoise:{value:noise},
      time:{value:0},cameraWorld:{value:new THREE.Vector3()},
      inverseProjection:{value:camera.projectionMatrixInverse.clone()},
      inverseView:{value:camera.matrixWorld.clone()},
      mistAmbient:{value:new THREE.Color().setRGB(.0105,.0155,.026)},
      glowDirection:{value:new THREE.Vector3(0,0,-1)},
      glowColor:{value:new THREE.Color().setRGB(.24,.075,.026)},
      glowStrength:{value:1},
      beyondColor:{value:new THREE.Color().setRGB(.36,.17,.06)},
      beyondDensity:{value:1.7},beyondStart:{value:-49.5},beyondEnd:{value:-63},
      density:{value:.032},nearMist:{value:new THREE.Vector2(5,19)},
      resolution:{value:new THREE.Vector2(1920,1080)},
      focusDistance:{value:8},aperturePx:{value:0},maxBlur:{value:18},
      aoStrength:{value:.62},projectionScale:{value:1},
      lightPosition:{value:lightPosition},lightColor:{value:lightColor},
      haloDensity:{value:.10},haloRadius:{value:.9},
    },
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`
      uniform sampler2D tDiffuse,tDepth,tNoise;
      uniform mat4 inverseProjection,inverseView;
      uniform vec3 cameraWorld,mistAmbient,glowDirection,glowColor,beyondColor;
      uniform float time,density,focusDistance,aperturePx,maxBlur,aoStrength,projectionScale;
      uniform float glowStrength,beyondDensity,beyondStart,beyondEnd,haloDensity,haloRadius;
      uniform vec2 resolution,nearMist;
      uniform vec3 lightPosition[MAX_LIGHTS],lightColor[MAX_LIGHTS];
      varying vec2 vUv;
      vec3 viewAt(vec2 uv){
        float d=texture2D(tDepth,uv).r;
        vec4 v=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);
        return v.xyz/v.w;
      }
      float coc(float z){return min(maxBlur,aperturePx*abs(z-focusDistance)/max(z,.05));}
      float hg(float c,float g){float g2=g*g;return (1.-g2)/(12.5663706*pow(1.+g2-2.*g*c,1.5));}
      void main(){
        vec3 scene=texture2D(tDiffuse,vUv).rgb;
        float depth=texture2D(tDepth,vUv).r;
        vec4 view=inverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);
        view/=view.w;
        // View-space contact occlusion. A surface normal rejects slopes, keeping
        // river reflections and broad ground planes free of false dark halos.
        vec3 normal=normalize(cross(dFdx(view.xyz),dFdy(view.xyz)));
        if(dot(normal,-view.xyz)<0.)normal=-normal;
        float occ=0.;
        float radius=.38;
        float screenRadius=min(56.,resolution.y*.5*projectionScale*radius/max(-view.z,.1));
        for(int j=0;j<12;j++){
          float f=float(j)+.5,a=f*2.39996323;
          vec2 offset=vec2(cos(a),sin(a))*sqrt(f/12.)*screenRadius/resolution;
          vec3 diff=viewAt(clamp(vUv+offset,vec2(.001),vec2(.999)))-view.xyz;
          float dl=length(diff);
          float horizon=max(0.,dot(normal,diff/max(dl,.0001))-.16);
          occ+=horizon*(1.-smoothstep(radius*.18,radius,dl))*smoothstep(.006,.025,dl);
        }
        scene*=1.-min(.27,occ/12.*aoStrength*2.4);
        // Thin-lens depth-of-field is measured in 1080p pixels so oversampling
        // preserves the lens character. Foreground samples are depth gated.
        float blur=coc(-view.z);
        if(blur>.2){
          vec3 accumulated=scene;float weight=1.;
          float rotation=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)*6.2831853;
          for(int j=0;j<128;j++){
            float f=float(j)+.5,a=f*2.39996323+rotation;
            float ring=sqrt(f/128.);
            vec2 uv=clamp(vUv+vec2(cos(a),sin(a))*ring*blur/vec2(resolution.x/resolution.y*1080.,1080.),vec2(.001),vec2(.999));
            float z=-viewAt(uv).z;
            float sampleBlur=coc(z);
            float w=mix(1.,smoothstep(ring*blur-1.,ring*blur+1.,sampleBlur),step(z,-view.z-.15));
            accumulated+=texture2D(tDiffuse,uv).rgb*w;
            weight+=w;
          }
          scene=accumulated/weight;
        }
        vec3 endpoint=(inverseView*vec4(view.xyz,1.)).xyz;
        vec3 delta=endpoint-cameraWorld;
        float distanceToSurface=length(delta);
        vec3 direction=delta/max(distanceToSurface,.001);
        float distanceLimit=min(distanceToSurface,160.);
        float optical=0.,beyondOptical=0.;
        // Quadratic spacing keeps definition in the closer wisps. The samples
        // remain anchored in world coordinates, so camera motion causes parallax.
        for(int i=0;i<32;i++){
          float a=float(i)/32.,b=float(i+1)/32.;
          float lo=a*a*distanceLimit,hi=b*b*distanceLimit;
          float d=(lo+hi)*.5;
          vec3 p=cameraWorld+direction*d;
          vec2 wind=vec2(time*.09,time*-.026);
          float n=texture2D(tNoise,(p.xz+wind)*.0016+vec2(p.y*.0013)).r;
          float f=texture2D(tNoise,(p.xz+wind*.71)*.0055+vec2(p.y*.004)).g;
          float ceiling=.35+n*1.05;
          float height=exp(-pow(max(p.y-.16,0.)/ceiling,1.65));
          float wetEdge=smoothstep(-.15,.04,p.y);
          float cameraGap=smoothstep(nearMist.x,nearMist.y,d);
          float wisp=.42+.9*smoothstep(.22,.8,n*.62+f*.38);
          optical+=(hi-lo)*density*height*wetEdge*cameraGap*wisp;
          // Beyond the bridge a low bank of luminous air receives the boat.
          float beyond=1.-smoothstep(beyondEnd,beyondStart,p.z+6.*(n-.5));
          float curtain=exp(-pow(max(p.y-.15,0.)/(2.7+1.3*f),2.));
          beyondOptical+=(hi-lo)*beyondDensity*beyond*curtain*wetEdge*(.55+.7*n);
        }
        // The afterglow scatters forward through the mist: warm toward the
        // west, cold slate everywhere else.
        float cosine=dot(direction,glowDirection);
        float phase=.72*hg(cosine,.86)+.28*hg(cosine,.40);
        vec3 mistLight=mistAmbient*(.85+.3*smoothstep(.2,-.2,direction.y))+glowColor*glowStrength*phase;
        vec3 beyondLight=beyondColor*(.55+1.6*phase);
        float totalOptical=optical+beyondOptical;
        float transmit=exp(-totalOptical);
        vec3 inscatter=(mistLight*optical+beyondLight*beyondOptical)/max(totalOptical,1e-4);
        vec3 color=scene*transmit+inscatter*(1.-transmit);
        // Closed-form single scattering from each small light in a uniform
        // medium: the integral of 1/(h²+(s−b)²) along the visible ray segment.
        vec3 halo=vec3(0.);
        for(int i=0;i<MAX_LIGHTS;i++){
          vec3 toLight=lightPosition[i]-cameraWorld;
          float along=dot(toLight,direction);
          vec3 across=toLight-along*direction;
          float h=sqrt(dot(across,across)+.0225);
          float integral=(atan((distanceToSurface-along)/h)+atan(along/h))/h;
          // Only the mist close to each flame lights up; extinction removes
          // far halos, so dozens of lanterns never veil the whole frame.
          halo+=lightColor[i]*integral*exp(-h/haloRadius)*exp(-.08*max(along,0.));
        }
        color+=halo*haloDensity;
        gl_FragColor=vec4(color,1.);
      }
    `,
  });
  pass.material.depthTest=false;
  pass.material.depthWrite=false;
  pass.lights={position:pass.uniforms.lightPosition.value,color:pass.uniforms.lightColor.value};
  pass.sharedDepth={texture:null};
  // Derive matrices and depth from the actual current render target on each
  // invocation. This also handles EffectComposer's alternating buffer order.
  const render=pass.render.bind(pass);
  pass.render=(renderer,writeBuffer,readBuffer,deltaTime,maskActive)=>{
    camera.updateMatrixWorld();
    pass.uniforms.tDepth.value=readBuffer.depthTexture;
    pass.sharedDepth.texture=readBuffer.depthTexture;
    pass.uniforms.resolution.value.set(readBuffer.width,readBuffer.height);
    pass.uniforms.projectionScale.value=camera.projectionMatrix.elements[5];
    pass.uniforms.cameraWorld.value.copy(camera.position);
    pass.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    pass.uniforms.inverseView.value.copy(camera.matrixWorld);
    render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
  };
  return pass;
}
